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
      const last = j.last;
      status.replaceChildren(
        el("div", { textContent: j.enabled ? (last ? `Сейчас: ${last.status}${last.title ? " · " + last.title : ""}` : "Ждём первую проверку…") : "Слежение выключено на сервере (NOS_VISA_ENABLED=0)" }),
        el("div", { className: "visa-sub", textContent: last
          ? `в этом состоянии с ${fmt(last.since)} · последняя проверка ${ago(last.t)} · всего проверок: ${j.checks} · раз в ~${Math.round(j.interval / 60 * 10) / 10} мин`
          : "" }),
        el("a", { className: "visa-sub", href: j.url, target: "_blank", rel: "noopener noreferrer", textContent: j.url }));
      status.className = "visa-status" + (last && last.status !== "403" && last.status !== "error" ? " open" : "");
      const rows = [...j.log].reverse().map(row);
      list.replaceChildren(...(rows.length ? rows : [el("div", { className: "visa-empty", textContent: "Журнал пуст" })]));
    }

    function row(e) {
      const ok = e.status !== "403" && e.status !== "error";
      const r = el("div", { className: "visa-row" + (ok ? " open" : "") },
        el("span", { className: "visa-time", textContent: fmt(e.t) }),
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
