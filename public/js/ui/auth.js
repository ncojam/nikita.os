import { el } from "../core/util.js";
import { WM } from "../wm.js";
import { notify } from "./notify.js";

/* ================= общее окошко входа / регистрации =================
 * Аккаунт один на всю систему (чат, форумы, NETWORK, записи, DAWN) — и окно для него одно.
 *   const nick = await askAuth({ why: "чтобы рисовать на стене" });   // ник или null (закрыли)
 * Нет такого ника — /api/chat/auth регистрирует, есть — входит. После входа летит событие
 *   window "nos-auth" {detail: {nick, created}} — открытые приложения могут перечитать «кто я».
 * Повторный вызов, пока окно открыто, получает тот же ответ (окно не плодится).
 */
const NICK_RE = /^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$/;
let pending = null;

export async function whoami() {
  try { const r = await fetch("/api/chat/me", { cache: "no-store" }); if (r.ok) return (await r.json()).nick || null; } catch {}
  return null;
}

export function askAuth({ why = "" } = {}) {
  if (pending) { WM.restore(pending.win); return pending.promise; }
  let done, win;
  const promise = new Promise(res => { done = res; });
  pending = { promise };
  const finish = nick => { if (!pending) return; pending = null; done(nick); };

  win = WM.open({ title: "Вход в nikita.os", icon: "🔑", width: 380, height: 400, key: "auth", render(c, w) {
    const nick = el("input", { className: "auth-in", maxLength: 20, placeholder: "Ник (он же логин)", autocomplete: "username", spellcheck: false });
    const pass = el("input", { className: "auth-in", type: "password", maxLength: 128, placeholder: "Пароль (от 6 символов)", autocomplete: "current-password" });
    const err = el("div", { className: "auth-err" });
    const go = el("button", { className: "btn primary auth-go", textContent: "Войти / зарегистрироваться" });
    const shake = () => w.node.animate([{ translate: "0" }, { translate: "-8px" }, { translate: "7px" }, { translate: "-4px" }, { translate: "0" }], { duration: 260 });
    const submit = async () => {
      err.textContent = "";
      const l = nick.value.trim();
      if (!NICK_RE.test(l)) { err.textContent = "Ник: 3–20 символов — буквы, цифры, _ и -"; return shake(); }
      if (pass.value.length < 6) { err.textContent = "Пароль — не короче 6 символов"; return shake(); }
      go.disabled = true;
      try {
        const r = await fetch("/api/chat/auth", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: l, password: pass.value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Ошибка " + r.status);
        notify(d.created ? `Аккаунт ${d.nick} создан — он работает во всей системе` : `Привет, ${d.nick}!`);
        dispatchEvent(new CustomEvent("nos-auth", { detail: { nick: d.nick, created: !!d.created } }));
        finish(d.nick);
        WM.close(w);
      } catch (e) { err.textContent = e.message; shake(); go.disabled = false; }
    };
    go.onclick = submit;
    nick.onkeydown = pass.onkeydown = e => { if (e.key === "Enter") submit(); };
    c.append(el("div", { className: "auth" },
      el("div", { className: "auth-badge", textContent: "🔑" }),
      el("h3", { textContent: "Один аккаунт на всю систему" }),
      why ? el("p", { className: "auth-why", textContent: why }) : "",
      el("p", { className: "auth-hint", textContent: "Нет такого ника — зарегистрируем, есть — войдём. Чат, форумы, NETWORK, записи и DAWN — под одним ником. Одна регистрация с адреса в месяц." }),
      nick, pass, go, err));
    w.onClose = () => finish(null);
    setTimeout(() => nick.focus(), 50);
  } });
  pending.win = win;
  return promise;
}
