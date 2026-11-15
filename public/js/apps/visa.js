import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { isOwner, whoami } from "./share.js";

/* ================= слежение за записью на визу (только для cojam) =================
 * Сервер (visa.py) сам раз в пару минут открывает страницу BLS и пишет в журнал только изменения:
 * «403 → 403 → 403» — одна строка, а не сотня. Когда ответ перестаёт быть 403 или меняется заголовок
 * страницы, сервер сохраняет снимок ответа, и у строки появляется «👁 Состояние».
 * Право проверяет СЕРВЕР; проверка в openVisa — лишь чтобы не показывать пустое окно.
 * Снимок показываем текстом (textContent) — чужой HTML мы не исполняем и не вставляем в страницу.
 */
const REFRESH_MS = 30_000;

const fmt = t => new Date(t * 1000).toLocaleString(globalThis.NOS_LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const ago = t => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 90) return s + " с назад";
  if (s < 5400) return Math.round(s / 60) + " мин назад";
  if (s < 172800) return Math.round(s / 3600) + " ч назад";
  return Math.round(s / 86400) + " дн назад";
};

async function api(path, opt) {
  const r = await fetch(path, { cache: "no-store", ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

export async function openVisa() {
  const nick = await whoami();
  if (!isOwner(nick)) {
    notify(nick ? "Слежение за визой — только для cojam" : "Войди в чат под ником cojam", 2600);
    return;
  }
  WM.open({ title: "Виза", icon: "🛂", width: 600, height: 520, key: "visa", render(c, w) {
    const status = el("div", { className: "visa-status" });
    const list = el("div", { className: "visa-list" });
    const check = el("button", { className: "visa-btn", textContent: "🔄 Проверить сейчас", onclick: () => load(true) });
    c.append(el("div", { className: "visa" },
      el("div", { className: "visa-head" }, el("div", { className: "visa-title", textContent: "🛂 BLS Spain · Москва" }), check),
      status, list));

    let busy = false, timer = 0, closed = false;

    async function load(force) {
      if (busy) return;
      busy = true; check.disabled = true;
      try {
        const j = await api(force ? "/api/visa/check" : "/api/visa", force ? { method: "POST" } : undefined);
        if (!closed) draw(j);
      } catch (e) {
        if (force) notify("⚠ " + e.message, 2600);
        else status.textContent = "⚠ " + e.message;
      } finally { busy = false; check.disabled = false; }
    }

    function draw(j) {
      const names = Object.fromEntries(j.targets.map(t => [t.id, t.name]));
      const open = j.targets.some(t => t.last && t.last.status !== "403" && t.last.status !== "error");
      status.className = "visa-status" + (open ? " open" : "");
      status.replaceChildren(
        ...(j.enabled ? j.targets.map(t => el("div", { className: "visa-target" },
          el("div", { textContent: `${t.name}: ` + (t.last ? `${t.last.status}${t.last.title ? " · " + t.last.title : ""}` : "ждём первую проверку…") }),
          el("a", { className: "visa-sub", href: t.url, target: "_blank", rel: "noopener noreferrer", textContent: t.url }),
          el("div", { className: "visa-sub", textContent: t.last
            ? `в этом состоянии с ${fmt(t.last.since)} · проверка ${ago(t.last.t)} · всего: ${t.checks}` : "" })))
          : [el("div", { textContent: "Слежение выключено на сервере (NOS_VISA_ENABLED=0)" })]),
        el("div", { className: "visa-sub", textContent: `сейчас раз в ~${j.interval < 90 ? j.interval + " с" : Math.round(j.interval / 60) + " мин"} · ${j.night ? "ночной режим" : "дневной режим"}` }));
      const rows = [...j.log].reverse().map(e => row(e, names));
      list.replaceChildren(...(rows.length ? rows : [el("div", { className: "visa-empty", textContent: "Журнал пуст" })]));
    }

    function row(e, names) {
      const ok = e.status !== "403" && e.status !== "error";
      const r = el("div", { className: "visa-row" + (ok ? " open" : "") },
        el("span", { className: "visa-time", textContent: fmt(e.t) }),
        el("span", { className: "visa-tag", textContent: names[e.target] || e.target }),
        el("span", { className: "visa-badge", textContent: e.status }),
        el("span", { className: "visa-note", textContent: e.note + (e.title ? " · " + e.title : ""), title: e.note }));
      if (e.snap) r.append(el("button", { className: "visa-btn", textContent: "👁 Состояние", onclick: () => openSnap(e) }));
      return r;
    }

    load(false);
    timer = setInterval(() => load(false), REFRESH_MS);
    w.onClose = () => { closed = true; clearInterval(timer); };
  } });
}

function openSnap(e) {
  WM.open({ title: "Снимок · " + fmt(e.t), icon: "👁", width: 640, height: 520, key: "visa-snap-" + e.snap, render(c) {
    const body = el("pre", { className: "visa-pre", textContent: "Загрузка…" });
    c.append(el("div", { className: "visa" }, body));
    api("/api/visa/snap/" + encodeURIComponent(e.snap)).then(s => {
      const head = Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
      body.textContent = `${s.status} · ${s.url}\n${head}\n\n${s.body}${s.truncated ? "\n\n… (тело обрезано)" : ""}`;
    }).catch(err => { body.textContent = "⚠ " + err.message; });
  } });
}
