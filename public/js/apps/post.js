import { baseName, el, fsUrl, joinPath, parentOf } from "../core/util.js";
import { VFS } from "../core/vfs.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= записи («твиты») =================
 * Запись — файл «Имя.запись» в общей ФС.
 *  • В СЕРВЕРНОЙ папке (fs/ufs) — общая запись (слой posts.py): видят все, правит только автор.
 *  • В ЛОКАЛЬНОЙ (браузерной) папке — локальный ЧЕРНОВИК: живёт в браузере, только у вас.
 * Картинку жмём в браузере (canvas → 256px JPEG-шакал). На сервер — отдельным файлом,
 * в черновик — data-URL внутри самого файла записи.
 */
const TITLE_MAX = 80;
const TEXT_MAX = 560;
const IMG_DIM = 256;
const IMG_LIMIT = 60 * 1024;

const now = () => Math.floor(Date.now() / 1000);
const fmtStamp = ts => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

async function myNick() {
  try { const r = await fetch("/api/chat/me", { cache: "no-store" }); if (r.ok) return (await r.json()).nick; } catch {}
  return null;
}

const blobToDataURL = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
});

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
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

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
  WM.open({ title: baseName(path).replace(/\.запись$/, ""), icon: "📝", width: 440, height: 420,
    key: "post:" + path, async render(c, w) {
      const wrap = el("div", { className: "post", textContent: "Загрузка…" });
      c.append(wrap);
      let data, nick;
      try {
        const r = await fetch(fsUrl(path), { cache: "no-store" });
        if (!r.ok) throw new Error("запись не найдена");
        data = await r.json();
      } catch (e) { wrap.textContent = "Ошибка: " + e.message; return; }
      const draft = data.draft === true;      // локальный черновик (в браузере)
      if (!draft) nick = await myNick();
      renderView();

      // сохранить черновик на диск: upload не перезаписывает по тому же имени, поэтому remove+write
      async function persist() {
        await VFS.remove([path]).catch(() => {});
        await VFS.writeFile(path, JSON.stringify(data), "application/json");
      }

      function renderView() {
        const mine = draft || (nick && nick === data.author);
        const imgSrc = draft ? (typeof data.img === "string" ? data.img : null)
          : (data.img && !data.img_hidden ? "/media/" + data.id + "?t=" + (data.edited || data.created) : null);
        const imgHidden = !draft && data.img && data.img_hidden;
        wrap.replaceChildren();
        const when = draft ? " · только у вас"
          : (data.edited && data.edited !== data.created ? " · изм." : "");
        wrap.append(el("div", { className: "post-head" },
          el("span", { className: "post-ava", textContent: draft ? "📝" : "👤" }),
          el("div", {}, el("div", { className: "post-author", textContent: draft ? "Черновик" : data.author }),
            el("div", { className: "post-time", textContent: fmtStamp(data.edited || data.created) + when }))));
        if (data.title) wrap.append(el("div", { className: "post-title", textContent: data.title }));
        if (data.text) wrap.append(el("div", { className: "post-text", textContent: data.text }));
        if (imgHidden) wrap.append(el("div", { className: "post-hidden", textContent: "🚫 Картинка скрыта на проверке" }));
        else if (imgSrc) {
          const im = el("img", { className: "post-img", src: imgSrc, alt: "картинка записи", loading: "lazy" });
          im.onerror = () => im.remove();
          wrap.append(im);
        }
        if (!draft && !mine && nick && data.img && !data.img_hidden) {
          wrap.append(el("div", { className: "post-actions" },
            el("button", { className: "btn small", textContent: "🚩 Пожаловаться (NSFW)", onclick: report })));
        }
        if (mine) {
          wrap.append(el("div", { className: "post-actions" },
            el("button", { className: "btn small", textContent: "✎ Изменить текст", onclick: editText }),
            el("button", { className: "btn small", textContent: data.img ? "🖼 Сменить картинку" : "🖼 Добавить картинку", onclick: setImage }),
            data.img && el("button", { className: "btn small", textContent: "Убрать картинку", onclick: dropImage }),
            el("button", { className: "btn small danger", textContent: "🗑 Удалить", onclick: del })));
        }
      }

      function editText() {
        wrap.replaceChildren();
        const ta = el("textarea", { className: "post-edit", rows: 5, maxLength: TEXT_MAX, value: data.text });
        const save = el("button", { className: "btn primary small", textContent: "Сохранить" });
        const cancel = el("button", { className: "btn small", textContent: "Отмена", onclick: renderView });
        save.onclick = async () => {
          save.disabled = true;
          if (draft) {
            data.text = ta.value.trim(); data.edited = now();
            try { await persist(); } catch (e) { notify("⚠ " + e.message); save.disabled = false; return; }
            return renderView();
          }
          const r = await fetch("/api/posts/" + data.id, { method: "PATCH",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: ta.value }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { notify(d.error || "Не сохранилось"); save.disabled = false; return; }
          data.text = ta.value.trim(); data.edited = now();
          changed(parentOf(path)); renderView();
        };
        wrap.append(ta, el("div", { className: "post-actions" }, cancel, save));
        ta.focus();
      }

      async function setImage() {
        const blob = await pickImage();
        if (!blob) return;
        if (draft) {
          data.img = await blobToDataURL(blob); data.edited = now();
          try { await persist(); } catch (e) { return notify("⚠ " + e.message); }
          return renderView();
        }
        const r = await fetch("/api/posts/" + data.id + "/image", { method: "POST",
          headers: { "Content-Type": "application/octet-stream" }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return notify(d.error || "Картинка не принята");
        data.img = true; data.edited = now();
        changed(parentOf(path)); renderView();
      }

      async function dropImage() {
        if (draft) {
          data.img = null; data.edited = now();
          try { await persist(); } catch (e) { return notify("⚠ " + e.message); }
          return renderView();
        }
        const r = await fetch("/api/posts/" + data.id + "/image", { method: "DELETE" });
        if (!r.ok) return notify("Не вышло убрать");
        data.img = false; data.edited = now();
        changed(parentOf(path)); renderView();
      }

      async function report() {
        if (!confirm("Пожаловаться на картинку как на непотребство (NSFW)?")) return;
        const r = await fetch("/api/posts/" + data.id + "/report", { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return notify(d.error || "Не отправилось");
        if (d.hidden) { data.img_hidden = true; changed(parentOf(path)); renderView();
          notify("Жалоба принята — картинка скрыта на проверке"); }
        else notify("Жалоба отправлена");
      }

      async function del() {
        if (draft) {
          if (!confirm("Удалить черновик? (он только у вас)")) return;
          try { await VFS.remove([path]); } catch (e) { return notify("⚠ " + e.message); }
          notify("Черновик удалён"); return WM.close(w);
        }
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
      const titleInput = el("input", { className: "post-title-input", type: "text", maxLength: TITLE_MAX,
        placeholder: "Название записи" });
      const ta = el("textarea", { className: "post-edit", rows: 5, maxLength: TEXT_MAX,
        placeholder: "Что нового? (до " + TEXT_MAX + " символов)" });
      const preview = el("div", { className: "post-prev" });
      const attach = el("button", { className: "btn small", textContent: "🖼 Прикрепить картинку" });
      const drop = el("div", { className: "post-drop", textContent: "…или перетащи картинку сюда" });
      const publish = el("button", { className: "btn primary", textContent: "Опубликовать" });
      const where = el("div", { className: "hint", textContent: "Папка: " + dir });

      const showPrev = () => {
        preview.replaceChildren();
        if (!imgBlob) return;
        preview.append(el("img", { className: "post-img", src: URL.createObjectURL(imgBlob) }),
          el("button", { className: "btn small", textContent: "Убрать картинку", onclick: () => { imgBlob = null; showPrev(); } }));
      };
      attach.onclick = async () => { const b = await pickImage(); if (b) { imgBlob = b; showPrev(); } };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = async e => {
        e.preventDefault(); drop.classList.remove("over");
        const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/"));
        if (f) { imgBlob = await shrink(f).catch(() => null); showPrev(); }
      };

      // в локальной папке запись становится черновиком — подскажем это
      VFS.isLocal(dir).then(loc => {
        if (loc) { publish.textContent = "Сохранить черновик";
          where.textContent = "Локальная папка: " + dir + " — это будет черновик, только у вас"; }
      }).catch(() => {});

      publish.onclick = async () => {
        const title = titleInput.value.trim();
        const text = ta.value.trim();
        if (!title) return notify("Дайте записи название");
        if (!text && !imgBlob) return notify("Пустую запись не делаем");
        publish.disabled = true;
        const local = VFS.ready && await VFS.isLocal(dir).catch(() => false);

        if (local) {   // ---- локальный черновик ----
          const base = title.slice(0, 40).replace(/[/\\\x00]/g, "") || "Черновик";
          const draft = { draft: true, title, text, img: imgBlob ? await blobToDataURL(imgBlob) : null,
            created: now(), edited: now() };
          try { await VFS.writeFile(joinPath(dir, base + ".запись"), JSON.stringify(draft), "application/json"); }
          catch (e) { notify("⚠ " + e.message); publish.disabled = false; return; }
          notify("Черновик сохранён (только у вас)");
          WM.close(w); onDone?.();
          return;
        }

        // ---- серверная публикация ----
        const r = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir, title, text }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { notify(d.error || "Не опубликовалось"); publish.disabled = false; return; }
        if (imgBlob) {
          const ri = await fetch("/api/posts/" + d.id + "/image", { method: "POST",
            headers: { "Content-Type": "application/octet-stream" }, body: imgBlob });
          if (!ri.ok) notify((await ri.json().catch(() => ({}))).error || "Картинка не принялась, текст сохранён");
        }
        changed(dir);
        notify("Опубликовано");
        WM.close(w); onDone?.();
        openPost(d.path);
      };

      c.append(el("div", { className: "post-new" }, titleInput, ta, el("div", { className: "post-new-row" }, attach), preview, drop, where,
        el("div", { className: "post-actions" }, publish)));
      titleInput.focus();
    } });
}

/* пожаловаться на запись по пути (из контекстного меню файла) */
async function reportPostByPath(path) {
  try {
    const r = await fetch(fsUrl(path), { cache: "no-store" });
    if (!r.ok) throw new Error();
    const d = await r.json();
    if (d.draft) return notify("Это ваш черновик — на него не жалуются");
    if (!d.img || d.img_hidden) return notify("Жаловаться не на что");
    if (!confirm("Пожаловаться на картинку как на непотребство (NSFW)?")) return;
    const rr = await fetch("/api/posts/" + d.id + "/report", { method: "POST" });
    const rd = await rr.json().catch(() => ({}));
    if (!rr.ok) return notify(rd.error || "Не отправилось");
    notify(rd.hidden ? "Жалоба принята — картинка скрыта на проверке" : "Жалоба отправлена");
    if (rd.hidden) changed(parentOf(path));
  } catch { notify("Не удалось пожаловаться"); }
}

export { openPost, createPost, reportPostByPath };
