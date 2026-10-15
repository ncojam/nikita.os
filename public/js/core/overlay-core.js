/*
 * Пользовательский слой файловой системы (overlay) — общая часть для страницы и Service Worker.
 * Обычный (не module) скрипт: подключается через <script> в index.html и через importScripts в sw.js.
 *
 * Сервер не меняется никогда. Всё, что пользователь «сделал» с файлами, хранится у него в браузере
 * (IndexedDB) и накладывается поверх серверной папки:
 *   state.hidden[vpath] = 1          — серверный файл/папка по этому пути скрыт («удалён»)
 *   state.nodes[vpath] = {
 *     t: "dir"                        — папка, созданная пользователем
 *     t: "file", blob, size, mime     — файл пользователя (содержимое в хранилище blobs)
 *     t: "link", target, kind, size   — ярлык на серверный путь target (так выглядит перемещённый файл/папка)
 *     mtime
 *   }
 * Все пути — виртуальные, как их видит пользователь. Узел в nodes важнее скрытия в hidden.
 */
(function (root) {
  const DB_NAME = "nikita-os-overlay", DB_VER = 1;
  let dbp = null;

  function db() {
    return dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }

  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }

  const empty = () => ({ v: 1, nodes: {}, hidden: {} });

  const Core = {
    empty,
    async loadState() {
      try {
        const s = await tx("meta", "readonly", st => st.get("state"));
        return s && s.nodes ? s : empty();
      } catch { return empty(); }
    },
    saveState: s => tx("meta", "readwrite", st => st.put(s, "state")),
    putBlob: (id, blob) => tx("blobs", "readwrite", st => st.put(blob, id)),
    getBlob: id => tx("blobs", "readonly", st => st.get(id)),
    delBlobs: ids => ids.length ? tx("blobs", "readwrite", st => { for (const id of ids) st.delete(id); }) : Promise.resolve(),
    clearAll: () => Promise.all([tx("meta", "readwrite", st => st.clear()), tx("blobs", "readwrite", st => st.clear())]),

    isEmpty: s => !Object.keys(s.nodes).length && !Object.keys(s.hidden).length,

    norm(p) {
      const out = [];
      for (const part of String(p || "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") out.pop(); else out.push(part);
      }
      return "/" + out.join("/");
    },
    join: (a, b) => (a === "/" ? "" : a) + "/" + b,
    parent: p => p.replace(/\/[^/]+$/, "") || "/",
    base: p => p.split("/").pop() || "/",
    under: (p, dir) => p === dir || p.startsWith(dir === "/" ? "/" : dir + "/"),

    /* виртуальный путь -> путь на сервере; null — на сервере за этим путём ничего нет */
    serverOf(s, v) {
      v = Core.norm(v);
      let sp = "/", vp = "";
      for (const part of v.split("/").filter(Boolean)) {
        vp += "/" + part;
        const n = s.nodes[vp];
        if (n) sp = n.t === "link" ? n.target : null;
        else if (sp === null || s.hidden[vp]) return null;
        else sp = Core.join(sp, part);
      }
      return sp;
    },

    /* виден ли путь вообще (узел пользователя или живой серверный путь по цепочке) */
    reachable(s, v) {
      let sp = "/", vp = "";
      for (const part of Core.norm(v).split("/").filter(Boolean)) {
        vp += "/" + part;
        const n = s.nodes[vp];
        if (n) sp = n.t === "link" ? n.target : null;
        else if (sp === null || s.hidden[vp]) return false;
        else sp = Core.join(sp, part);
      }
      return true;
    },

    /* узлы пользователя прямо внутри папки v: [[имя, узел], ...] */
    children(s, v) {
      const out = [];
      for (const p in s.nodes) if (p !== "/" && Core.parent(p) === v) out.push([Core.base(p), s.nodes[p]]);
      return out;
    },

    /* запись для /api/ls и /api/entry из узла пользователя */
    describe(n, name) {
      if (n.t === "link") return { name, type: n.kind === "dir" ? "dir" : "file", size: n.size || 0, mtime: n.mtime || 0, link: n.target };
      return { name, type: n.t === "dir" ? "dir" : "file", size: n.size || 0, mtime: n.mtime || 0, local: true };
    },

    fsUrl: p => "/fs" + p.split("/").map(encodeURIComponent).join("/"),
  };

  root.OverlayCore = Core;
})(self);
