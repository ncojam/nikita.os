/*
 * Service Worker nikita.os: накладывает пользовательский слой (js/core/overlay-core.js) на серверную fs.
 * Перехватывает /api/ls, /api/entry, /api/find, /api/listen и /fs/... — поэтому любые приложения
 * (проводник, плеер, эмуляторы в iframe, игры) видят изменения пользователя без доработок.
 * Пока пользователь ничего не менял, все запросы идут на сервер как есть.
 */
importScripts("/js/core/overlay-core.js");
const C = self.OverlayCore;

let stateP = null;
const state = () => stateP ||= C.loadState();
// страница поменяла слой — перечитаем (ответ через порт, чтобы страница дождалась)
self.addEventListener("message", e => {
  if (e.data?.type === "vfs-invalidate") { stateP = null; e.ports[0]?.postMessage("ok"); }
  // страница открылась без контроля SW (жёсткая перезагрузка) — забираем её
  if (e.data?.type === "vfs-claim") e.waitUntil(self.clients.claim());
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  const p = u.pathname;
  if (req.method === "GET" && (p === "/api/ls" || p === "/api/entry" || p === "/api/find" || p.startsWith("/fs/")))
    e.respondWith(handle(req, u));
  else if (req.method === "POST" && p === "/api/listen")
    e.respondWith(handle(req, u));
});

const SEC = { "Cross-Origin-Resource-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const json = (d, status = 200) => new Response(JSON.stringify(d), { status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC } });
const notFound = () => new Response("Not found", { status: 404, headers: SEC });
const q = (u, k) => C.norm(u.searchParams.get(k) || "/");
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function handle(req, u) {
  const s = await state();
  if (C.isEmpty(s)) return fetch(req);
  const p = u.pathname;
  try {
    if (p === "/api/ls") return await ls(s, q(u, "path"));
    if (p === "/api/entry") return await entry(s, q(u, "path"));
    if (p === "/api/find") return await find(s, req, u);
    if (p === "/api/listen") {
      const sp = C.serverOf(s, q(u, "path"));
      if (!sp) return json({ error: "Нет такого трека" }, 404);
      return fetch("/api/listen?path=" + encodeURIComponent(sp), { method: "POST", keepalive: true });
    }
    // /fs/...
    let v;
    try { v = C.norm(decodeURIComponent(p.slice(3))); } catch { return fetch(req); }
    const n = s.nodes[v];
    if (n?.t === "file") return await blobResponse(n, req);
    if (n?.t === "dir") return notFound();
    const sp = C.serverOf(s, v);
    if (sp === null) return notFound();
    if (sp === v) return fetch(req);
    return fetch(C.fsUrl(sp) + u.search, { headers: req.headers, cache: req.cache === "only-if-cached" ? "default" : req.cache });
  } catch (err) {
    return json({ error: "Ошибка пользовательского слоя: " + err.message }, 500);
  }
}

async function ls(s, v) {
  const n = s.nodes[v];
  if (n && n.t === "file") return json({ error: "Это не папка" }, 400);
  if (n && n.t === "link" && n.kind !== "dir") return json({ error: "Это не папка" }, 400);
  const sp = C.serverOf(s, v);
  let entries = [], ok = !!n || v === "/";
  if (sp !== null) {
    const r = await fetch("/api/ls?path=" + encodeURIComponent(sp), { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      ok = true;
      entries = d.entries.filter(e => { const c = C.join(v, e.name); return !s.nodes[c] && !s.hidden[c]; });
    } else if (!n) return json(d, r.status);
    // ярлык на папку, которой на сервере больше нет, — просто пустая папка
  }
  if (!ok) return json({ error: "Нет такой папки" }, 404);
  for (const [name, cn] of C.children(s, v)) entries.push(C.describe(cn, name));
  entries.sort((a, b) => (a.type !== "dir") - (b.type !== "dir") || natural(a.name, b.name));
  return json({ path: v, entries });
}

async function entry(s, v) {
  const n = s.nodes[v];
  if (n) return json({ path: v, exists: true, ...C.describe(n, C.base(v)) });
  const sp = C.serverOf(s, v);
  if (sp === null) return json({ path: v, exists: false });
  const r = await fetch("/api/entry?path=" + encodeURIComponent(sp), { cache: "no-store" });
  const d = await r.json().catch(() => ({ exists: false }));
  return json({ ...d, path: v, ...(d.exists && v !== "/" ? { name: C.base(v) } : {}) });
}

async function find(s, req, u) {
  const exts = (u.searchParams.get("ext") || "").split(",").map(e => "." + e.trim().toLowerCase().replace(/^\./, "")).filter(e => e.length > 1);
  const r = await fetch(req);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) return json(d || { error: "Ошибка поиска" }, r.status);
  const hasExt = p => exts.some(e => p.toLowerCase().endsWith(e));
  // серверные файлы, которые пользователь не трогал (содержимое перенесённых папок не ищем)
  const files = d.files.filter(f => C.serverOf(s, f) === f);
  for (const p in s.nodes) {
    const n = s.nodes[p];
    if ((n.t === "file" || (n.t === "link" && n.kind !== "dir")) && hasExt(p) && C.reachable(s, p)) files.push(p);
  }
  return json({ ...d, files });
}

async function blobResponse(n, req) {
  const blob = await C.getBlob(n.blob);
  if (!blob) return notFound();
  let type = n.mime || blob.type || "application/octet-stream";
  if (/^text\/|json|javascript|xml/.test(type) && !/charset/.test(type)) type += "; charset=utf-8";
  const size = blob.size, base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...SEC };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (m && (m[1] || m[2])) {
    let a, b;
    if (m[1] === "") { a = Math.max(0, size - Number(m[2])); b = size - 1; }
    else { a = Number(m[1]); b = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (a >= size || a > b) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, ...SEC } });
    return new Response(blob.slice(a, b + 1), { status: 206,
      headers: { ...base, "Content-Range": `bytes ${a}-${b}/${size}`, "Content-Length": String(b - a + 1) } });
  }
  return new Response(blob, { headers: { ...base, "Content-Length": String(size) } });
}
