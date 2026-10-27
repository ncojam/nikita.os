# /// script
# requires-python = ">=3.11"
# dependencies = ["yt-dlp[default]>=2026.1.1"]
# ///
"""
Домашний воркер «Находок» nikita.os.

Сайт сам никуда не ходит: этот скрипт на компьютере владельца забирает с сайта плейлисты,
примеры и голоса, ищет на YouTube/SoundCloud свежие треки и отдаёт сайту ленту — до 20 треков
на плейлист с оценкой и строкой «почему».

Сейчас (шаг 2) оценка — только по метаданным: теги и слова, тот же артист, свежесть, отклик
аудитории. Анализ звука (CLAP) появится шагом 3, в этом же файле.

Запуск (uv сам поставит зависимости из шапки файла):
    uv run worker/finds_worker.py --test          первый раз: не дольше 10 минут, с отчётом
    uv run worker/finds_worker.py                 обычный прогон (лимит из конфига, по умолчанию 30 мин)
    uv run worker/finds_worker.py --dry           ничего не отправлять, только показать ленты
Конфиг — ~/.config/nos-finds/config.toml (пример — worker/config.example.toml).

Правила:
- YouTube API не используется: поиск и метаданные — через yt-dlp, с паузами между запросами,
  чтобы не злить YouTube с домашнего IP.
- Обход по кругу между пользователями, у каждого — потолок разборов за прогон; владелец — первым.
- Лимит времени соблюдается всегда: что успели — отправляем, что не успели — в следующий раз.
- Метаданные кэшируются в ~/.cache/nos-finds/meta.db, повторно не качаем.
"""
import argparse
import json
import logging
import random
import re
import sqlite3
import ssl
import sys
import time
import tomllib
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

log = logging.getLogger("finds")

CONFIG = Path.home() / ".config" / "nos-finds" / "config.toml"
CACHE = Path.home() / ".cache" / "nos-finds"
META_TTL = 14 * 86400            # метаданные трека живут в кэше две недели
TEST_MINUTES = 10

DEFAULTS = {
    "site": "https://82.38.67.16",
    "token": "",
    "owner": "",                 # твой ник на сайте — твои плейлисты идут первыми и с бо́льшим лимитом
    "minutes": 30,               # лимит обычного прогона
    "per_user": 60,              # разборов треков за прогон на пользователя
    "per_owner": 150,            # … на владельца
    "insecure": False,           # True — не проверять сертификат сайта (самоподписанный)
    "sleep": 1.0,                # пауза между запросами к YouTube/SoundCloud, сек
}

MIN_DUR, MAX_DUR = 90, 8 * 60    # короче — сниппеты, длиннее — миксы и часовые подборки
CANDIDATES_PER_PL = 60           # сколько кандидатов набираем до предфильтра
SEARCH_N = 15                    # результатов на один поисковый запрос
LISTING_N = 10                   # последних загрузок с канала/страницы артиста
MIX_TRACKS = 15                  # треков вытаскиваем из треклиста микса

# слова, которые ничего не говорят о звуке
STOP = set("""the and for with from feat ft official video audio music lyrics lyric visualizer
hd hq full free download premiere out now new release track song original version edit extended
prod produced remastered remaster channel youtube soundcloud x vs и в на с по для из это""".split())
# признаки «не трека»: миксы, подборки, разборы
NOT_TRACK = re.compile(r"\b(mix|mixtape|megamix|1 ?hour|hour|hrs?|compilation|playlist|podcast|live set|"
                       r"dj set|full album|tutorial|how to|reaction|review|stream|radio|ep\.?\s*\d+|"
                       r"сборник|подборка|разбор|обзор|туториал)\b", re.I)
SEP = r"\s+[-–—]\s+"
TS = re.compile(r"(?:\d{1,2}:)?\d{1,2}:\d{2}")


# ================= id треков (как в finds.py на сервере) =================
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_SC_SEG = re.compile(r"^[a-z0-9_-]{1,160}$")
_SC_NOT_TRACK = {"sets", "tracks", "albums", "reposts", "likes", "popular-tracks"}


def url_to_id(url):
    """Ссылка -> yt:<id> | sc:<артист>/<трек> | scu:<артист> | None."""
    if not isinstance(url, str):
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    parts = [p for p in u.path.split("/") if p]
    if host in ("youtube.com", "music.youtube.com"):
        if u.path == "/watch":
            v = (parse_qs(u.query).get("v") or [""])[0]
            return "yt:" + v if _YT_ID.match(v) else None
        if len(parts) == 2 and parts[0] in ("shorts", "embed", "live") and _YT_ID.match(parts[1]):
            return "yt:" + parts[1]
        return None
    if host == "youtu.be":
        return "yt:" + parts[0] if parts and _YT_ID.match(parts[0]) else None
    if host == "soundcloud.com":
        parts = [p.lower() for p in parts]
        if not parts or not all(_SC_SEG.match(p) for p in parts):
            return None
        if len(parts) == 1:
            return "scu:" + parts[0][:64]
        if len(parts) == 2 and parts[1] not in _SC_NOT_TRACK:
            return "sc:" + parts[0][:64] + "/" + parts[1]
    return None


def id_to_url(tid):
    if tid.startswith("yt:"):
        return "https://www.youtube.com/watch?v=" + tid[3:]
    if tid.startswith("sc:"):
        return "https://soundcloud.com/" + tid[3:]
    if tid.startswith("scu:"):
        return "https://soundcloud.com/" + tid[4:]
    return ""


# ================= время =================
class Budget:
    def __init__(self, minutes):
        self.t0 = time.monotonic()
        self.end = self.t0 + minutes * 60

    def left(self):
        return self.end - time.monotonic()

    def over(self, reserve=0):
        return self.left() <= reserve

    def spent(self):
        return time.monotonic() - self.t0


# ================= сайт =================
class Site:
    def __init__(self, cfg):
        self.base = cfg["site"].rstrip("/")
        self.token = cfg["token"]
        self.ctx = ssl._create_unverified_context() if cfg["insecure"] else ssl.create_default_context()

    def call(self, method, path, body=None):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "X-Finds-Token": self.token, "Content-Type": "application/json", "User-Agent": "nos-finds-worker"})
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=30) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 404 and path.startswith("/api/finds/w/"):
                raise SystemExit("Сайт ответил 404 на API воркера: на сервере не задан NOS_FINDS_TOKEN "
                                 "или токен в конфиге не совпадает.")
            raise SystemExit(f"Сайт ответил {e.code}: {e.read()[:300].decode(errors='replace')}")
        except urllib.error.URLError as e:
            raise SystemExit(f"Не достучаться до сайта {self.base}: {e.reason}")

    def state(self):
        return self.call("GET", "/api/finds/w/state")

    def push(self, tracks, feed):
        return self.call("POST", "/api/finds/w/push", {"tracks": tracks, "feed": feed})


# ================= кэш метаданных =================
class Cache:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY, data TEXT, at INTEGER)")

    def get(self, tid):
        r = self.db.execute("SELECT data, at FROM meta WHERE id = ?", (tid,)).fetchone()
        if r and time.time() - r[1] < META_TTL:
            return json.loads(r[0])
        return None

    def put(self, tid, data):
        self.db.execute("INSERT OR REPLACE INTO meta VALUES(?,?,?)", (tid, json.dumps(data, ensure_ascii=False), int(time.time())))
        self.db.commit()


# ================= YouTube / SoundCloud через yt-dlp =================
def _ts(info):
    """Unix-время публикации из того, что отдал yt-dlp."""
    if info.get("timestamp"):
        return int(info["timestamp"])
    d = info.get("upload_date") or info.get("release_date")
    if d and re.fullmatch(r"\d{8}", str(d)):
        return int(datetime.strptime(str(d), "%Y%m%d").replace(tzinfo=timezone.utc).timestamp())
    return 0


def slim(tid, info):
    """Из огромного info yt-dlp — только то, что нужно для оценки и карточки."""
    yt = tid.startswith("yt:")
    tags = [str(t) for t in (info.get("tags") or [])][:40]
    for g in (info.get("genres") or []) + ([info["genre"]] if info.get("genre") else []):
        tags.append(str(g))
    if yt:
        akey = "ytc:" + str(info.get("channel_id") or info.get("uploader_id") or "")
        artist = info.get("artist") or info.get("channel") or info.get("uploader") or ""
        thumb = f"https://i.ytimg.com/vi/{tid[3:]}/mqdefault.jpg"
    else:
        akey = "scu:" + tid[3:].split("/")[0]
        artist = info.get("uploader") or tid[3:].split("/")[0]
        thumb = info.get("thumbnail") or ""
        thumb = thumb.replace("-large.", "-t300x300.") if thumb.startswith("https://") else ""
    return {
        "id": tid, "title": str(info.get("track") or info.get("title") or "")[:200], "artist": str(artist)[:200],
        "akey": akey, "duration": int(info.get("duration") or 0), "published": _ts(info), "thumb": thumb,
        "tags": tags, "desc": str(info.get("description") or "")[:1500],
        "views": int(info.get("view_count") or 0), "likes": int(info.get("like_count") or 0),
        "followers": int(info.get("channel_follower_count") or info.get("uploader_followers") or 0),
        "chapters": [str(c.get("title") or "") for c in (info.get("chapters") or [])][:60],
        "channel_url": str(info.get("channel_url") or info.get("uploader_url") or ""),
    }


class Source:
    """Всё общение с YouTube/SoundCloud. В --selftest подменяется заглушкой."""

    def __init__(self, sleep):
        import yt_dlp
        base = {"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 15,
                "sleep_interval_requests": sleep, "extractor_retries": 1, "noplaylist": True,
                "logger": _QuietLog()}
        self.full = yt_dlp.YoutubeDL({**base})
        self.flat = yt_dlp.YoutubeDL({**base, "extract_flat": "in_playlist", "noplaylist": False})
        self.sleep = sleep
        self.calls = 0
        self.errors = Counter()          # текст ошибки -> сколько раз (в итог прогона)
        self.ok = 0

    def fail(self, what, url, e):
        msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).replace("ERROR: ", "").strip()
        log.debug("%s %s: %s", what, url, msg)
        # ид видео/трека в тексте ошибки разные — сводим одинаковые причины вместе
        self.errors[re.sub(r"\[[^\]]+\]\s*[\w-]+:\s*", "", msg)[:220]] += 1

    def info(self, url):
        """Полные метаданные одного трека или None."""
        self.calls += 1
        try:
            r = self.full.extract_info(url, download=False, process=False)
            self.ok += 1
            return r
        except Exception as e:
            self.fail("нет метаданных", url, e)
            return None

    def listing(self, url, n):
        """Плоский список: поиск (ytsearchdate15:…, scsearch15:…) или страница канала/артиста."""
        self.calls += 1
        try:
            r = self.flat.extract_info(url, download=False)
            self.ok += 1
        except Exception as e:
            self.fail("не получился список", url, e)
            return []
        out = []
        for e in (r or {}).get("entries") or []:
            if not e:
                continue
            u = e.get("webpage_url") or e.get("url") or ""
            tid = url_to_id(u) or (("yt:" + e["id"]) if e.get("ie_key") == "Youtube" and _YT_ID.match(str(e.get("id"))) else None)
            item = {"id": tid, "title": e.get("title") or "", "duration": int(e.get("duration") or 0),
                    "views": int(e.get("view_count") or 0), "artist": e.get("channel") or e.get("uploader") or ""}
            if tid and not tid.startswith("scu:"):
                out.append(item)
            elif not tid and "soundcloud.com/" in u:
                # SoundCloud в плоском списке отдаёт ссылки API — настоящий адрес узнаем при разборе
                out.append({**item, "raw": u})
            if len(out) >= n:
                break
        return out


class _QuietLog:
    def debug(self, m): pass
    def info(self, m): pass
    def warning(self, m): log.debug(m)
    def error(self, m): log.debug(m)


# ================= разбор текста =================
def words(*texts):
    out = []
    for t in texts:
        for w in re.findall(r"[a-zа-яё0-9]+", str(t).lower()):
            if len(w) >= 3 and w not in STOP and not w.isdigit():
                out.append(w)
    return out


def tracklist(meta):
    """Треклист микса из глав и описания: ["Артист - Трек", …]."""
    lines = list(meta.get("chapters") or [])
    for ln in (meta.get("desc") or "").splitlines():
        if TS.search(ln):
            lines.append(ln)
    out, seen = [], set()
    for ln in lines:
        ln = TS.sub(" ", ln)
        ln = re.sub(r"^[\s\d.)\]#|:-]+", "", ln).strip(" -–—|[]()")
        ln = re.sub(r"\s+", " ", ln)
        if not re.search(SEP, ln) or len(ln) > 120:
            continue
        k = ln.lower()
        if k not in seen:
            seen.add(k)
            out.append(ln)
        if len(out) >= MIX_TRACKS:
            break
    return out


def ago_days(ts):
    return (time.time() - ts) / 86400 if ts else None


# ================= оценка =================
class Taste:
    """Что известно о вкусе для одного плейлиста: слова, артисты «да» и «нет»."""

    def __init__(self, pl):
        self.pl = pl
        self.vocab = Counter()
        self.pos_artists, self.neg_artists = Counter(), Counter()
        # название и описание — самые надёжные слова
        for w in words(pl["name"], pl.get("descr") or ""):
            self.vocab[w] += 3

    def add(self, meta, sign):
        if sign > 0:
            for w in words(*meta.get("tags", [])):
                self.vocab[w] += 1
            self.pos_artists[meta["akey"]] += 1
        else:
            self.neg_artists[meta["akey"]] += 1

    def text_score(self, meta):
        if not self.vocab:
            return 0.0, []
        ws = set(words(meta["title"], *meta.get("tags", []), meta.get("desc", "")[:300]))
        hits = sorted((w for w in ws if w in self.vocab), key=lambda w: -self.vocab[w])
        top = sum(self.vocab[w] for w in hits[:6])
        ceiling = sum(c for _, c in self.vocab.most_common(6)) or 1
        return min(1.0, top / ceiling), hits[:3]

    def score(self, meta, rnd):
        why = []
        text, hits = self.text_score(meta)
        if hits:
            why.append("теги: " + ", ".join(hits))
        art = 0.0
        if self.pos_artists.get(meta["akey"]):
            art = 1.0
            why.insert(0, "тот же артист, что в примерах/bump")
        if self.neg_artists.get(meta["akey"]) and not self.pos_artists.get(meta["akey"]):
            art = -1.0
        d = ago_days(meta["published"])
        fresh = 0.3 if d is None else max(0.0, 1.0 - d / 365) ** 2
        if d is not None and d <= 14:
            why.append("вышел " + ("сегодня" if d < 1 else f"{int(d)} дн. назад"))
        eng = 0.0
        if meta["views"]:
            ratio = meta["likes"] / meta["views"] if meta["likes"] else 0
            eng = min(1.0, ratio / 0.06)              # 6% лайков от просмотров — очень тепло
            small = meta["followers"] and meta["followers"] < 20000
            if small and ratio > 0.04:
                eng = min(1.0, eng + 0.2)
                why.append("тёплый отклик у небольшого канала")
        penalty = 0.5 if NOT_TRACK.search(meta["title"]) else 0.0
        s = 0.40 * text + 0.30 * art + 0.15 * fresh + 0.10 * eng + 0.05 * rnd - penalty
        return round(s, 4), "; ".join(why[:2])


# ================= прогон =================
class Run:
    def __init__(self, cfg, site, src, cache, budget, test=False, dry=False):
        self.cfg, self.site, self.src, self.cache, self.budget = cfg, site, src, cache, budget
        self.test, self.dry = test, dry
        self.report = {"playlists": 0, "examples": 0, "candidates": 0, "parsed": 0, "pushed": 0, "skipped_time": 0}

    # --- метаданные с кэшем ---
    def meta(self, tid, raw=None):
        """Метаданные по id (или по сырой ссылке SoundCloud API, если id ещё неизвестен)."""
        if tid:
            m = self.cache.get(tid)
            if m is not None:
                return m
        info = self.src.info(raw or id_to_url(tid))
        if not info:
            return None
        if not tid:
            tid = url_to_id(info.get("webpage_url") or info.get("permalink_url") or "")
            if not tid or tid.startswith("scu:"):
                return None
            m = self.cache.get(tid)
            if m is not None:
                return m
        m = slim(tid, info)
        self.cache.put(tid, m)
        self.report["parsed"] += 1
        return m

    def search(self, query, n=1):
        """ytsearch: «Артист - Трек» -> первый найденный id."""
        hits = self.src.listing(f"ytsearch{n}:{query}", n)
        return [h["id"] for h in hits]

    # --- примеры и голоса -> вкус ---
    def taste(self, pl):
        t = Taste(pl)
        t.seed_ids = set()               # треки из треклистов миксов-примеров: в ленту не предлагаем
        seeds_yt_channels, seeds_sc_artists = [], []
        examples = [x["id"] for x in pl.get("examples", [])]
        t.ex_total = sum(1 for x in examples if not x.startswith("scu:"))
        t.ex_ok = 0
        for tid in examples:
            if self.budget.over(60):
                break
            if tid.startswith("scu:"):
                seeds_sc_artists.append(tid[4:])
                t.pos_artists[tid] += 1
                continue
            m = self.meta(tid)
            if not m:
                continue
            self.report["examples"] += 1
            t.ex_ok += 1
            if m["duration"] > 15 * 60:          # микс: его треки — примеры, сам микс — нет
                for line in tracklist(m)[: (5 if self.test else MIX_TRACKS)]:
                    for fid in self.search(line):
                        t.seed_ids.add(fid)
                        fm = self.meta(fid)
                        if fm:
                            t.add(fm, +1)
                            self._seed_source(fm, seeds_yt_channels, seeds_sc_artists)
                continue
            t.add(m, +1)
            self._seed_source(m, seeds_yt_channels, seeds_sc_artists)
        for v in pl.get("votes", []):
            m = self.cache.get(v["track"])       # голоса — только из кэша: эти треки мы уже разбирали
            if m:
                t.add(m, v["v"])
                if v["v"] > 0:
                    self._seed_source(m, seeds_yt_channels, seeds_sc_artists)
        return t, seeds_yt_channels, seeds_sc_artists

    @staticmethod
    def _seed_source(m, yt_channels, sc_artists):
        if m["akey"].startswith("ytc:") and len(m["akey"]) > 4:
            cid = m["akey"][4:]
            if cid not in yt_channels:
                yt_channels.append(cid)
        elif m["akey"].startswith("scu:"):
            a = m["akey"][4:]
            if a not in sc_artists:
                sc_artists.append(a)

    # --- кандидаты ---
    def candidates(self, pl, taste, yt_channels, sc_artists):
        skip = {x["id"] for x in pl.get("examples", [])} | {v["track"] for v in pl.get("votes", [])} | taste.seed_ids
        found = {}

        def take(items):
            for c in items:
                key = c["id"] or c.get("raw")
                if c["id"] in skip or key in found:
                    continue
                if c["duration"] and not (MIN_DUR <= c["duration"] <= MAX_DUR):
                    continue
                if NOT_TRACK.search(c["title"] or ""):
                    continue
                found[key] = c

        lim_src = 3 if self.test else 8
        # 1) свежие загрузки артистов из примеров и bump
        for cid in yt_channels[:lim_src]:
            if self.budget.over(90) or len(found) >= CANDIDATES_PER_PL:
                break
            take(self.src.listing(f"https://www.youtube.com/channel/{cid}/videos", LISTING_N))
        for a in sc_artists[:lim_src]:
            if self.budget.over(90) or len(found) >= CANDIDATES_PER_PL:
                break
            take(self.src.listing(f"https://soundcloud.com/{a}/tracks", LISTING_N))
        # 2) поиск по названию, описанию и самым частым тегам
        queries = [pl["name"]]
        top = [w for w, _ in taste.vocab.most_common(8) if w not in words(pl["name"])]
        if top:
            queries.append(" ".join([*words(pl["name"])[:2], *top[:2]]))
        for q in queries[: (1 if self.test else 2)]:
            if self.budget.over(90):
                break
            take(self.src.listing(f"ytsearchdate{SEARCH_N}:{q}", SEARCH_N))
            take(self.src.listing(f"scsearch{SEARCH_N}:{q}", SEARCH_N))
        self.report["candidates"] += len(found)
        return list(found.values())

    # --- один плейлист ---
    def playlist(self, pl, quota):
        taste, ytc, sca = self.taste(pl)
        cands = self.candidates(pl, taste, ytc, sca)
        self.last = f"примеры {taste.ex_ok}/{taste.ex_total}, кандидатов {len(cands)}"
        # предфильтр по тому, что известно без разбора: слова в названии
        rnd = random.Random(pl["id"] + str(int(time.time() // 86400)))
        for c in cands:
            c["pre"] = len(set(words(c["title"])) & set(taste.vocab)) + rnd.random()
        cands.sort(key=lambda c: -c["pre"])
        skip = {x["id"] for x in pl.get("examples", [])} | {v["track"] for v in pl.get("votes", [])} | taste.seed_ids
        scored, seen = [], set()
        for c in cands[:quota]:
            if self.budget.over(45):
                self.report["skipped_time"] += 1
                continue
            m = self.meta(c["id"], c.get("raw"))
            if not m or m["id"] in skip or m["id"] in seen:
                continue
            seen.add(m["id"])
            if (m["duration"] and not (MIN_DUR <= m["duration"] <= MAX_DUR)) or NOT_TRACK.search(m["title"]):
                continue
            s, why = taste.score(m, rnd.random())
            scored.append((s, why, m))
        scored.sort(key=lambda x: -x[0])
        return scored[:self.feed_max], len(cands[:quota])

    def go(self):
        st = self.site.state()
        self.feed_max = st.get("feedMax", 20)
        pls = st["playlists"]
        owner = (self.cfg["owner"] or "").lower()
        # владелец первым, дальше — по кругу между пользователями
        by_user = {}
        for p in pls:
            by_user.setdefault(p["uid"], []).append(p)
        users = sorted(by_user, key=lambda u: (by_user[u][0]["owner"].lower() != owner, u))
        used = Counter()
        order = []
        while any(by_user.values()):
            for u in users:
                if by_user[u]:
                    order.append(by_user[u].pop(0))
        if self.test:
            order = order[:3]
        for pl in order:
            if self.budget.over(60):
                log.info("время вышло — остальные плейлисты в следующий раз")
                break
            is_owner = pl["owner"].lower() == owner and owner
            cap = self.cfg["per_owner"] if is_owner else self.cfg["per_user"]
            mine = sum(1 for p in pls if p["uid"] == pl["uid"])
            quota = max(5, min(40, (cap - used[pl["uid"]]) // max(1, mine)))
            if self.test:
                quota = min(quota, 10)
            t0 = time.monotonic()
            feed, n = self.playlist(pl, quota)
            used[pl["uid"]] += n
            self.report["playlists"] += 1
            log.info("«%s» (%s): %s, разобрано %d, в ленте %d, %.0f с", pl["name"], pl["owner"], self.last, n, len(feed), time.monotonic() - t0)
            for s, why, m in feed[:5]:
                log.info("   %.2f  %s — %s%s", s, m["artist"], m["title"], f"  [{why}]" if why else "")
            if feed and not self.dry:
                tracks = [{k: m[k] for k in ("id", "title", "artist", "duration", "published", "thumb")} for _, _, m in feed]
                r = self.site.push(tracks, {pl["id"]: [{"track": m["id"], "score": s, "why": why} for s, why, m in feed]})
                self.report["pushed"] += r.get("feed", 0)
        return self.report


# ================= запуск =================
def load_config(path):
    cfg = dict(DEFAULTS)
    if path.exists():
        with open(path, "rb") as f:
            cfg.update(tomllib.load(f))
    elif not cfg["token"]:
        raise SystemExit(f"Нет конфига {path}. Скопируй worker/config.example.toml туда и впиши token.")
    if not cfg["token"]:
        raise SystemExit(f"В {path} пустой token — впиши тот же NOS_FINDS_TOKEN, что на сервере.")
    return cfg


def main(argv=None):
    ap = argparse.ArgumentParser(description="Домашний воркер «Находок» nikita.os")
    ap.add_argument("--test", action="store_true", help="пробный прогон: до 3 плейлистов, не дольше 10 минут")
    ap.add_argument("--dry", action="store_true", help="ничего не отправлять на сайт")
    ap.add_argument("--minutes", type=float, help="лимит времени (иначе из конфига)")
    ap.add_argument("--config", type=Path, default=CONFIG)
    ap.add_argument("--check", metavar="URL", help="проверить одну ссылку: что о ней видит yt-dlp")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(message)s")
    if a.check:
        return check(a.check)
    cfg = load_config(a.config)
    minutes = TEST_MINUTES if a.test else (a.minutes or cfg["minutes"])
    budget = Budget(minutes)
    run = Run(cfg, Site(cfg), Source(cfg["sleep"]), Cache(CACHE / "meta.db"), budget, test=a.test, dry=a.dry)
    log.info("Находки: %s, лимит %d мин%s", cfg["site"], minutes, " (пробный прогон)" if a.test else "")
    rep = run.go()
    log.info("\nИтог за %.1f мин: плейлистов %d, примеров %d, кандидатов %d, разобрано новых %d, "
             "запросов к сайтам %d, отправлено в ленты %d%s",
             budget.spent() / 60, rep["playlists"], rep["examples"], rep["candidates"], rep["parsed"],
             run.src.calls, rep["pushed"], " (dry — ничего не отправлено)" if a.dry else "")
    if rep["skipped_time"]:
        log.info("Не успели разобрать %d кандидатов — доберём в следующий раз.", rep["skipped_time"])
    report_errors(run.src)


def report_errors(src):
    """Что не получилось у yt-dlp — сводкой, с подсказкой по известным причинам."""
    if not src.errors:
        return
    total = sum(src.errors.values())
    log.info("\n⚠ Неудачных запросов: %d из %d. Частые причины:", total, total + src.ok)
    for msg, n in src.errors.most_common(5):
        log.info("  ×%d  %s", n, msg)
    text = " ".join(src.errors).lower()
    if "javascript" in text or "js runtime" in text or "challenge" in text or "deno" in text:
        log.info("→ yt-dlp нужен JavaScript-движок для YouTube: sudo pacman -S deno")
    if "sign in" in text or "not a bot" in text or "429" in text:
        log.info("→ YouTube притормаживает этот IP: подожди час и увеличь sleep в конфиге")
    if "unsupported url" in text:
        log.info("→ Обнови yt-dlp: uv run --upgrade worker/finds_worker.py --check <ссылка>")
    if src.ok == 0:
        log.info("→ Ни один запрос не прошёл. Проверь одну ссылку: finds --check <ссылка на трек>")


def check(url):
    """Диагностика одной ссылки: что видит yt-dlp, без глушения его сообщений."""
    import yt_dlp
    print("yt-dlp", yt_dlp.version.__version__)
    tid = url_to_id(url)
    print("id:", tid or "— ссылка не распознана (нужен трек YouTube/SoundCloud)")
    opts = {"skip_download": True, "noplaylist": True}
    try:
        info = yt_dlp.YoutubeDL(opts).extract_info(url, download=False, process=False)
    except Exception as e:
        print("\nОШИБКА:", e)
        src = type("S", (), {})(); src.errors = Counter({str(e): 1}); src.ok = 0
        report_errors(src)
        return
    if tid and not tid.startswith("scu:"):
        m = slim(tid, info)
        print(json.dumps({k: m[k] for k in ("title", "artist", "akey", "duration", "published", "tags", "views", "likes")},
                         ensure_ascii=False, indent=1))
        if m["duration"] > 15 * 60:
            print("микс, треклист:", tracklist(m) or "не найден")
    with yt_dlp.YoutubeDL({**opts, "extract_flat": "in_playlist", "noplaylist": False, "playlistend": 3}) as y:
        r = y.extract_info("ytsearchdate3:riddim", download=False)
        print("\nпоиск ytsearchdate3:riddim ->", [e.get("title") for e in (r.get("entries") or [])])


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nПрервано.")
