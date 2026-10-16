import { baseName, el, fsUrl, parentOf } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= записи («твиты») =================
 * Запись — виртуальный файл «Имя.запись» в общей ФС (живёт на сервере, слой posts.py).
 * Создавать может любой вошедший в чат; текст и картинку правит только автор.
 * Картинку жмём в браузере (canvas → 256px JPEG-шакал) и шлём готовой — сервер валидирует.
 *
 * Фаза 1: одна картинка на запись, вложение внутри карточки. Перемещения, ярлыки,
 * картинки как отдельные файлы и «пуф»-анимация — Фаза 2.
 */
const TEXT_MAX = 560;
const IMG_DIM = 256;             // максимальная сторона
const IMG_LIMIT = 60 * 1024;    // держимся ниже серверного потолка (64 КБ)

const fmtStamp = ts => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

async function myNick() {
  try { const r = await fetch("/api/chat/me", { cache: "no-store" }); if (r.ok) return (await r.json()).nick; } catch {}
  return null;
}

/* сжать картинку шакалом: вписать в IMG_DIM, JPEG с понижением качества до лимита. Blob | null */
async function shrink(src) {
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("не картинка")); i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("пустая картинка");
    const k = Math.min(1, IMG_DIM / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const cv = el("canvas"); cv.width = cw; cv.height = ch;
    cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
    let blob = null;
    for (const q of [0.14, 0.1, 0.07, 0.05]) {
      blob = await new Promise(res => cv.toBlob(res, "image/jpeg", q));
      if (blob && blob.size <= IMG_LIMIT) return blob;
    }
    return blob; // последний (самый сжатый) — сервер добьёт отказом, если всё равно велик
  } finally { URL.revokeObjectURL(url); }
}

// выбрать картинку с компьютера → сжать
function pickImage() {
  return new Promise(res => {
    const inp = el("input", { type: "file", accept: "image/*" });
    inp.onchange = async () => { const f = inp.files?.[0]; res(f ? await shrink(f).catch(() => null) : null); };
    inp.click();
  });
}

const changed = dir => window.dispatchEvent(new CustomEvent("nos-posts-changed", { detail: { dir } }));

/* ---------- просмотр записи ---------- */
async function openPost(path) {
  const url = fsUrl(path);
  WM.open({ title: baseName(path).replace(/\.запись$/, ""), icon: "📝", width: 440, height: 420,
    key: "post:" + path, async render(c, w) {
      const wrap = el("div", { className: "post", textContent: "Загрузка…" });
      c.append(wrap);
      let data, nick;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("запись не найдена");
        data = await r.json();
      } catch (e) { wrap.textContent = "Ошибка: " + e.message; return; }
      nick = await myNick();
      renderView();

      function renderView() {
        const mine = nick && nick === data.author;
        wrap.replaceChildren();
        const head = el("div", { className: "post-head" },
          el("span", { className: "post-ava", textContent: "👤" }),
          el("div", {}, el("div", { className: "post-author", textContent: data.author }),
            el("div", { className: "post-time", textContent: fmtStamp(data.edited || data.created) +
              (data.edited && data.edited !== data.created ? " · изм." : "") })));
        wrap.append(head);
        if (data.text) wrap.append(el("div", { className: "post-text", textContent: data.text }));
        if (data.img) {
          const im = el("img", { className: "post-img", src: "/media/" + data.id + "?t=" + (data.edited || data.created),
            alt: "картинка записи", loading: "lazy" });
          im.onerror = () => im.remove();
          wrap.append(im);
        }
        if (mine) {
          const act = el("div", { className: "post-actions" },
            el("button", { className: "btn small", textContent: "✎ Изменить текст", onclick: editText }),
            el("button", { className: "btn small", textContent: data.img ? "🖼 Сменить картинку" : "🖼 Добавить картинку", onclick: setImage }),
            data.img && el("button", { className: "btn small", textContent: "Убрать картинку", onclick: dropImage }),
            el("button", { className: "btn small danger", textContent: "🗑 Удалить", onclick: del }));
          wrap.append(act);
        }
      }

      function editText() {
        wrap.replaceChildren();
        const ta = el("textarea", { className: "post-edit", rows: 5, maxLength: TEXT_MAX, value: data.text });
        const save = el("button", { className: "btn primary small", textContent: "Сохранить" });
        const cancel = el("button", { className: "btn small", textContent: "Отмена", onclick: renderView });
        save.onclick = async () => {
          save.disabled = true;
          const r = await fetch("/api/posts/" + data.id, { method: "PATCH",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: ta.value }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { notify(d.error || "Не сохранилось"); save.disabled = false; return; }
          data.text = ta.value.trim(); data.edited = Math.floor(Date.now() / 1000);
          changed(parentOf(path)); renderView();
        };
        wrap.append(ta, el("div", { className: "post-actions" }, cancel, save));
        ta.focus();
      }

      async function setImage() {
        const blob = await pickImage();
        if (!blob) return;
        const r = await fetch("/api/posts/" + data.id + "/image", { method: "POST",
          headers: { "Content-Type": "application/octet-stream" }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return notify(d.error || "Картинка не принята");
        data.img = true; data.edited = Math.floor(Date.now() / 1000);
        changed(parentOf(path)); renderView();
      }

      async function dropImage() {
        const r = await fetch("/api/posts/" + data.id + "/image", { method: "DELETE" });
        if (!r.ok) return notify("Не вышло убрать");
        data.img = false; data.edited = Math.floor(Date.now() / 1000);
        changed(parentOf(path)); renderView();
      }

      async function del() {
        if (!confirm("Удалить запись? Это навсегда и для всех.")) return;
        const r = await fetch("/api/posts/" + data.id, { method: "DELETE" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return notify(d.error || "Не удалилось");
        changed(parentOf(path));
        notify("Запись удалена");
        WM.close(w);
      }
    } });
}

/* ---------- создание записи ---------- */
function createPost(dir, onDone) {
  WM.open({ title: "Новая запись", icon: "📝", width: 440, height: 400, key: "post-new:" + dir,
    render(c, w) {
      let imgBlob = null;
      const ta = el("textarea", { className: "post-edit", rows: 5, maxLength: TEXT_MAX,
        placeholder: "Что нового? (до " + TEXT_MAX + " символов)" });
      const preview = el("div", { className: "post-prev" });
      const attach = el("button", { className: "btn small", textContent: "🖼 Прикрепить картинку" });
      const drop = el("div", { className: "post-drop", textContent: "…или перетащи картинку сюда" });
      const publish = el("button", { className: "btn primary", textContent: "Опубликовать" });
      const where = el("div", { className: "hint", textContent: "Появится в папке: " + dir });

      const showPrev = () => {
        preview.replaceChildren();
        if (!imgBlob) return;
        const im = el("img", { className: "post-img", src: URL.createObjectURL(imgBlob) });
        preview.append(im, el("button", { className: "btn small", textContent: "Убрать картинку",
          onclick: () => { imgBlob = null; showPrev(); } }));
      };
      attach.onclick = async () => { const b = await pickImage(); if (b) { imgBlob = b; showPrev(); } };
      const onDrop = async e => {
        e.preventDefault(); drop.classList.remove("over");
        const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/"));
        if (f) { imgBlob = await shrink(f).catch(() => null); showPrev(); }
      };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = onDrop;

      publish.onclick = async () => {
        const text = ta.value.trim();
        if (!text && !imgBlob) return notify("Пустую запись не публикуем");
        publish.disabled = true;
        const base = (text.split("\n")[0] || "Запись").slice(0, 24).trim() || "Запись";
        const r = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir, name: base, text }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { notify(d.error || "Не опубликовалось"); publish.disabled = false; return; }
        if (imgBlob) {
          const ri = await fetch("/api/posts/" + d.id + "/image", { method: "POST",
            headers: { "Content-Type": "application/octet-stream" }, body: imgBlob });
          if (!ri.ok) notify((await ri.json().catch(() => ({}))).error || "Картинка не принялась, текст сохранён");
        }
        changed(dir);
        notify("Опубликовано");
        WM.close(w);
        onDone?.();
        openPost(d.path);
      };

      c.append(el("div", { className: "post-new" }, ta, el("div", { className: "post-new-row" }, attach), preview, drop, where,
        el("div", { className: "post-actions" }, publish)));
      ta.focus();
    } });
}

export { openPost, createPost };
