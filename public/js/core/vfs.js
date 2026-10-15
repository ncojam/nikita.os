/*
 * VFS — изменения файловой системы, которые видит только этот пользователь (в его браузере).
 * Сервер не трогаем: Service Worker (/sw.js) накладывает слой на ответы /api/ls, /api/entry, /fs/...
 *
 * Для приложений: ничего делать не нужно — читайте папки через /api/ls и файлы через /fs/... как раньше.
 * Чтобы приложение само меняло файлы, используйте VFS.move/remove/rename/mkdir/upload/writeFile
 * и VFS.onChange(cb), чтобы перерисоваться после изменений.
 */
const C = self.OverlayCore;
const bc = "BroadcastChannel" in self ? new BroadcastChannel("nikita-vfs") : null;
const listeners = new Set();
let queue = Promise.resolve();

const enc = encodeURIComponent;

async function entry(p) {
  const r = await fetch("/api/entry?path=" + enc(p), { cache: "no-store" });
  return r.ok ? r.json() : { exists: false };
}

// просим Service Worker перечитать слой и ждём ответа — иначе следующий /api/ls может прийти по-старому
function swSync() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve();
  return new Promise(res => {
    const ch = new MessageChannel();
    const t = setTimeout(res, 700);
    ch.port1.onmessage = () => { clearTimeout(t); res(); };
    sw.postMessage({ type: "vfs-invalidate" }, [ch.port2]);
  });
}

function emit(info) {
  for (const cb of listeners) { try { cb(info); } catch (e) { console.warn("vfs listener:", e); } }
}
bc?.addEventListener("message", e => emit(e.data)); // изменения из других вкладок

// все изменения строго по очереди: прочитать слой → изменить → сохранить → сообщить
function mutate(fn) {
  const run = queue.then(async () => {
    const s = await C.loadState();
    const res = await fn(s);
    await C.saveState(s);
    await swSync();
    const info = { dirs: res?.dirs || [] };
    emit(info);
    bc?.postMessage(info);
    return res;
  });
  queue = run.catch(() => {});
  return run;
}

// перенос всех ключей с префиксом from в to (сам путь и всё внутри)
function renamePrefix(obj, from, to) {
  for (const k of Object.keys(obj)) {
    if (k === from || k.startsWith(from + "/")) {
      const v = obj[k];
      delete obj[k];
      obj[to + k.slice(from.length)] = v;
    }
  }
}
function dropPrefix(obj, p, self = true) {
  const gone = [];
  for (const k of Object.keys(obj)) if ((self && k === p) || k.startsWith(p + "/")) { gone.push(obj[k]); delete obj[k]; }
  return gone;
}

function checkName(name) {
  name = String(name || "").trim();
  if (!name || name === "." || name === ".." || /[/\\\x00]/.test(name)) throw new Error("Недопустимое имя");
  if (name.startsWith(".")) throw new Error("Имя не может начинаться с точки");
  return name;
}

async function freeName(dir, name) {
  if (!(await entry(C.join(dir, name))).exists) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  for (let i = 2; ; i++) {
    const n = `${m[1]} (${i})${m[2] || ""}`;
    if (!(await entry(C.join(dir, n))).exists) return n;
  }
}

const VFS = {
  ready: false,        // Service Worker управляет страницей — слой работает
  supported: "serviceWorker" in navigator && isSecureContext && "indexedDB" in self,

  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

  // путь создан пользователем (а не лежит на сервере)
  async isLocal(p) { const s = await C.loadState(); return !!s.nodes[C.norm(p)] && s.nodes[C.norm(p)].t !== "link"; },

  /* переместить пути paths в папку dir (newName — только для одного пути, это и есть переименование) */
  move(paths, dir, newName = null) {
    this._need();
    dir = C.norm(dir);
    return mutate(async s => {
      const de = await entry(dir);
      if (!de.exists || de.type !== "dir") throw new Error("Папка назначения не найдена");
      const moved = [];
      for (let src of paths) {
        src = C.norm(src);
        if (src === "/") throw new Error("Корень переместить нельзя");
        if (C.under(dir, src)) throw new Error(`Нельзя переместить «${C.base(src)}» внутрь самой себя`);
        const name = checkName(newName ?? C.base(src));
        const dst = C.join(dir, name);
        if (dst === src) continue;
        // переименование только регистра — та же сущность
        if ((await entry(dst)).exists && dst.toLowerCase() !== src.toLowerCase()) throw new Error(`«${name}» уже есть в этой папке`);
        const n = s.nodes[src];
        if (n) {
          renamePrefix(s.nodes, src, dst);
          renamePrefix(s.hidden, src + "/", dst + "/"); // скрытия внутри переезжают вместе с папкой
          // ярлык вернули на родное место — убираем и ярлык, и скрытие оригинала
          if (n.t === "link" && n.target === dst && s.hidden[dst] && C.serverOf(s, C.parent(dst)) === C.parent(dst)) {
            delete s.nodes[dst]; delete s.hidden[dst];
          }
        } else {
          const info = await entry(src);
          const sp = C.serverOf(s, src);
          if (!info.exists || sp === null) throw new Error(`«${C.base(src)}» не найден`);
          renamePrefix(s.nodes, src + "/", dst + "/");
          renamePrefix(s.hidden, src + "/", dst + "/");
          s.hidden[src] = 1;
          s.nodes[dst] = { t: "link", target: sp, kind: info.type, size: info.size || 0, mtime: info.mtime || 0 };
        }
        moved.push(dst);
      }
      return { dirs: [dir, ...paths.map(C.parent)], moved };
    });
  },

  rename(path, name) { path = C.norm(path); return this.move([path], C.parent(path), name); },

  /* «удалить»: свои файлы удаляются по-настоящему, серверные — просто скрываются */
  remove(paths) {
    this._need();
    return mutate(async s => {
      const blobs = [];
      for (let p of paths) {
        p = C.norm(p);
        if (p === "/") throw new Error("Корень удалить нельзя");
        const own = !!s.nodes[p];
        const server = !own && C.serverOf(s, p) !== null;
        for (const n of dropPrefix(s.nodes, p)) if (n.t === "file") blobs.push(n.blob);
        dropPrefix(s.hidden, p, false);
        if (server) s.hidden[p] = 1;
      }
      await C.delBlobs(blobs);
      return { dirs: paths.map(p => C.parent(C.norm(p))) };
    });
  },

  mkdir(dir, name = "Новая папка") {
    this._need();
    dir = C.norm(dir);
    return mutate(async s => {
      const nm = await freeName(dir, checkName(name));
      s.nodes[C.join(dir, nm)] = { t: "dir", mtime: Math.floor(Date.now() / 1000) };
      return { dirs: [dir], created: C.join(dir, nm) };
    });
  },

  /* загрузить файлы: items = [{ file: File|Blob, path: "имя" или "папка/вложенная/имя" }] */
  upload(dir, items) {
    this._need();
    dir = C.norm(dir);
    navigator.storage?.persist?.().catch(() => {}); // просим браузер не вычищать хранилище
    return mutate(async s => {
      const created = [], mapped = new Map(); // верхний уровень: исходное имя -> свободное имя
      for (const { file, path } of items) {
        const parts = String(path || file.name).split("/").filter(Boolean).map(checkName);
        if (!parts.length) continue;
        if (!mapped.has(parts[0])) mapped.set(parts[0], s.nodes[C.join(dir, parts[0])] && parts.length > 1 && s.nodes[C.join(dir, parts[0])].t === "dir"
          ? parts[0] : await freeName(dir, parts[0]));
        parts[0] = mapped.get(parts[0]);
        let cur = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = C.join(cur, parts[i]);
          if (!s.nodes[cur]) s.nodes[cur] = { t: "dir", mtime: Math.floor(Date.now() / 1000) };
        }
        const dst = C.join(cur, parts.at(-1));
        const old = s.nodes[dst];
        if (old?.t === "file") await C.delBlobs([old.blob]);
        const id = self.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
        await C.putBlob(id, file);
        s.nodes[dst] = { t: "file", blob: id, size: file.size, mime: file.type || "",
          mtime: Math.floor((file.lastModified || Date.now()) / 1000) };
        if (parts.length === 1) created.push(dst);
      }
      return { dirs: [dir], created: [...new Set([...created, ...[...mapped.values()].map(n => C.join(dir, n))])] };
    });
  },

  /* записать текст/Blob в файл (для приложений-редакторов) */
  writeFile(path, data, mime = "") {
    path = C.norm(path);
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain" });
    return this.upload(C.parent(path), [{ file: new File([blob], C.base(path), { type: blob.type }), path: C.base(path) }]);
  },

  /* вернуть всё как на сервере: файлы, перемещения, раскладку значков рабочего стола */
  async reset() {
    await queue;
    try { localStorage.removeItem("desk.pos"); } catch {}
    if (this.ready || "indexedDB" in self) await C.clearAll().catch(() => {});
    await swSync();
    emit({ dirs: [], reset: true });
    bc?.postMessage({ dirs: [], reset: true });
  },

  async usage() {
    const s = await C.loadState();
    let size = 0, files = 0;
    for (const p in s.nodes) if (s.nodes[p].t === "file") { size += s.nodes[p].size || 0; files++; }
    const est = await navigator.storage?.estimate?.().catch(() => null);
    return { size, files, changes: Object.keys(s.nodes).length + Object.keys(s.hidden).length, quota: est?.quota || 0 };
  },

  _need() { if (!this.ready) throw new Error("Браузер не поддерживает пользовательскую файловую систему (нужен HTTPS и Service Worker)"); },
};

/* регистрация Service Worker; вызывается из main.js до запуска остального */
async function init_vfs() {
  if (!VFS.supported) return;
  try {
    const sw = navigator.serviceWorker;
    await sw.register("/sw.js", { scope: "/" });
    if (!sw.controller) {
      // первый заход или жёсткая перезагрузка (Ctrl+Shift+R идёт мимо SW): просим SW забрать страницу
      const reg = await sw.ready;
      await new Promise(res => {
        sw.addEventListener("controllerchange", res, { once: true });
        reg.active?.postMessage({ type: "vfs-claim" });
        setTimeout(res, 3000);
      });
    }
    // браузер не дал забрать страницу — одна обычная перезагрузка, она уже идёт через SW
    if (!sw.controller && !sessionStorage.getItem("vfs-reloaded")) {
      sessionStorage.setItem("vfs-reloaded", "1");
      location.reload();
      await new Promise(() => {});
    }
    if (sw.controller) sessionStorage.removeItem("vfs-reloaded");
    VFS.ready = !!sw.controller;
  } catch (e) {
    console.warn("VFS: Service Worker не зарегистрирован:", e);
  }
}

/* перетаскивание файлов с компьютера: DataTransfer -> [{ file, path }] (папки — рекурсивно) */
async function filesFromDrop(dt) {
  const out = [];
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])].map(f => ({ file: f, path: f.name }));
  const walk = async (en, prefix) => {
    if (en.isFile) {
      const f = await new Promise((res, rej) => en.file(res, rej)).catch(() => null);
      if (f) out.push({ file: f, path: prefix + f.name });
    } else if (en.isDirectory) {
      const r = en.createReader();
      let batch;
      do {
        batch = await new Promise(res => r.readEntries(res, () => res([])));
        for (const c of batch) await walk(c, prefix + en.name + "/");
      } while (batch.length);
    }
  };
  for (const en of entries) await walk(en, "");
  return out;
}

export { VFS, init_vfs, filesFromDrop };
