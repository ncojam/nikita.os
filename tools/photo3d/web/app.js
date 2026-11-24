/* Тулчейн фото → глубина и 3D: интерфейс. Сервер — toolchain.py; читалка .nvx и three.js — те же, что у сайта (/site/…). */
import { buildPoints, parseNVX, placeCamera } from "/site/js/apps/photo/nvx.js";

const $ = s => document.querySelector(s);
const api = (u, o) => fetch(u, o).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); });
const fileUrl = p => "/api/file?path=" + encodeURIComponent(p) + "&t=" + Date.now();
let cur = null, items = [], sel = new Set(), tab = "img", watching = false, anchor = -1;
const paint = () => { document.querySelectorAll(".card").forEach((x, i) => x.classList.toggle("sel", sel.has(items[i]?.path))); showSel(); };
const selectAll = () => { sel = new Set(items.map(i => i.path)); paint(); };

async function state() {
  const s = await api("/api/state");
  const chip = (ok, t) => `<span class="${ok ? "ok" : "no"}">${t}</span>`;
  $("#chips").innerHTML = chip(s.models.base || s.models.small || s.models.large, "модели: " + (Object.entries(s.models).filter(([, v]) => v).map(([k]) => k).join(", ") || "скачаются сами"))
    + chip(s.site.ready, s.site.ready ? "сайт готов" : "сайту нужны файлы")
    + `<span>${(s.providers || []).map(p => p.replace("ExecutionProvider", "")).join(" · ")}</span>`;
  return s;
}

async function open(dir) {
  const d = await api("/api/ls?dir=" + encodeURIComponent(dir || ""));
  cur = d; $("#dir").value = d.dir; localStorage.setItem("p3d.dir", d.dir);
  items = d.images;
  sel = new Set([...sel].filter(p => items.some(i => i.path === p)));
  $("#dirs").replaceChildren(...d.dirs.map(n => { const b = document.createElement("button"); b.textContent = "📁 " + n; b.onclick = () => open(d.dir + "/" + n); return b; }));
  $("#imgs").replaceChildren(...items.map(card));
  if (!items.length) $("#imgs").textContent = "Картинок нет";
  showSel();
}

function card(it) {
  const c = document.createElement("div");
  c.className = "card" + (sel.has(it.path) ? " sel" : "");
  c.innerHTML = `<img loading="lazy"><div class="bd">${it.depth ? "<i>🌊</i>" : ""}${it.scene ? "<i>🧊</i>" : ""}</div><div class="nm"></div>`;
  c.querySelector("img").src = fileUrl(it.path);
  c.querySelector(".nm").textContent = it.name;
  c.onclick = e => {
    const i = items.indexOf(it);
    if (e.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) sel.add(items[k].path); }
    else if (e.ctrlKey || e.metaKey) sel.has(it.path) ? sel.delete(it.path) : sel.add(it.path);
    else sel = new Set([it.path]);
    if (!e.shiftKey) anchor = i;
    paint();
  };
  return c;
}

const one = () => items.find(i => i.path === [...sel].at(-1));
function showSel() {
  $("#sel").textContent = sel.size ? `выбрано: ${sel.size}` : "";
  $("#hint").style.display = sel.size ? "none" : "";
  $("#doScene").disabled = !sel.size;
  $("#doDepth").disabled = !sel.size;
  $("#doDepth").title = sel.size ? "" : "Сначала выбери картинки слева";
  $("#doScene").title = sel.size ? (sel.size > 1 ? `Сцены для всех ${sel.size} по очереди, с одинаковыми настройками` : "") : "Сначала выбери картинки слева";
  setTab(tab);
}

/* ---------- просмотр ---------- */
let v3 = null;
async function setTab(t) {
  tab = t;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  const it = one();
  $("#pv").style.display = t === "3d" ? "none" : "";
  $("#v3").style.display = t === "3d" ? "block" : "none";
  v3?.stop(); v3 = null;
  if (!it) { $("#pv").removeAttribute("src"); return; }
  if (t === "img") $("#pv").src = fileUrl(it.path);
  if (t === "depth") it.depth ? $("#pv").src = fileUrl(it.path + ".depth.png") : $("#pv").removeAttribute("src");
  if (t === "3d" && it.scene) v3 = await preview3d(it.path + ".scene.nvx");
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => setTab(b.dataset.t));

async function preview3d(path) {
  const T = await import("/site/vendor/three/three-gltf.min.js");
  const S = parseNVX(await (await fetch(fileUrl(path))).arrayBuffer());
  const box = $("#v3");
  box.replaceChildren();
  if (S.count > 1_500_000) { box.textContent = `Сцена слишком большая для превью (${S.count.toLocaleString()} вокселей) — уменьши разрешение или задай «Блоков до центра»`; return { stop() {} }; }
  const r = new T.WebGLRenderer({ antialias: true });
  box.append(r.domElement);
  const scene = new T.Scene(); scene.background = new T.Color(0x07070a);
  const mesh = new T.Points(buildPoints(T, S), new T.PointsMaterial({ vertexColors: true, size: (S.head.size || 1) * 1.2, sizeAttenuation: true }));
  scene.add(mesh);
  const c = mesh.geometry.boundingSphere.center, R = mesh.geometry.boundingSphere.radius;
  const cam = new T.PerspectiveCamera(60, 1, R / 1000, R * 20);
  placeCamera(T, cam, S.head);
  const target = c.clone();
  let drag = null, raf = 0, live = true;
  box.onpointerdown = e => { drag = [e.clientX, e.clientY]; box.setPointerCapture(e.pointerId); };
  box.onpointerup = () => { drag = null; };
  box.onpointermove = e => {
    if (!drag) return;
    const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
    const o = cam.position.clone().sub(target), rr = o.length();
    let th = Math.atan2(o.x, o.z), ph = Math.acos(Math.max(-1, Math.min(1, o.y / rr)));
    th -= dx * 0.006; ph = Math.max(0.05, Math.min(3.09, ph - dy * 0.006));
    cam.position.set(target.x + rr * Math.sin(ph) * Math.sin(th), target.y + rr * Math.cos(ph), target.z + rr * Math.sin(ph) * Math.cos(th));
    cam.lookAt(target);
  };
  box.onwheel = e => { e.preventDefault(); const o = cam.position.clone().sub(target); cam.position.copy(target).add(o.multiplyScalar(Math.exp(e.deltaY * 0.001))); };
  const frame = () => {
    if (!live) return;
    const W = box.clientWidth, H = box.clientHeight;
    r.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix();
    r.render(scene, cam);
    raf = requestAnimationFrame(frame);
  };
  frame();
  $("#sel").textContent = `${S.head.kind === "minecraft" ? "⛏" : "🧊"} ${S.count.toLocaleString()} вокселей` + (S.head.params?.fit != null ? ` · сетка ${S.head.params.fit}` : "");
  return { stop() { live = false; cancelAnimationFrame(raf); mesh.geometry.dispose(); r.dispose(); box.replaceChildren(); } };
}

/* ---------- задачи ---------- */
async function job(body) {
  await api("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  watch();
}
async function watch() {
  if (watching) return;
  watching = true;
  let busy = true;
  while (busy) {
    const list = await api("/api/jobs").catch(() => []);
    $("#jobs").replaceChildren(...list.slice(0, 12).map(j => {
      const d = document.createElement("div");
      d.className = "job" + (j.state === "ошибка" ? " err" : j.state === "готово" ? " done" : "");
      d.innerHTML = "<b></b> <span></span><pre></pre>";
      d.querySelector("b").textContent = { depth: "🌊 глубина", scene: "🧊 сцена", site: "📦 сайт", model: "⬇ модель" }[j.kind] + " · " + j.state;
      d.querySelector("span").textContent = (j.args.path || (j.args.paths || []).join(", ")).split("/").pop();
      d.querySelector("pre").textContent = j.log.join("\n");
      return d;
    }));
    busy = list.some(j => j.state === "ждёт" || j.state === "идёт");
    if (!busy) break;
    await new Promise(r => setTimeout(r, 900));
  }
  watching = false;
  await open(cur?.dir);
  state();
}

$("#doDepth").onclick = () => job({ kind: "depth", paths: [...sel], model: $("#model").value, res: +$("#res").value });
$("#doScene").onclick = () => {
  const mode = document.querySelector("input[name=mode]:checked").value, num = s => $(s).value === "" ? null : +$(s).value;
  for (const path of sel)   // по очереди: задачи идут одна за другой
    job({ kind: "scene", path, mode, model: $("#model").value, fov: num("#fov"), fill: $("#fill").checked,
      range: mode === "minecraft" ? num("#mcrange") : num("#range"), res: num("#vres") || 256, blocks: mode === "minecraft" ? num("#blocks") : null });
  tab = "3d";
};
$("#site").onclick = () => job({ kind: "site" });
$("#all").onclick = selectAll;
$("#none").onclick = () => { sel.clear(); paint(); };
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyA" && !e.target.closest("input, select, textarea")) { e.preventDefault(); selectAll(); }
});
document.querySelectorAll("input[name=mode]").forEach(r => r.onchange = () => document.body.classList.toggle("mc", r.value === "minecraft" && r.checked));
$("#go").onclick = () => open($("#dir").value);
$("#dir").onkeydown = e => { if (e.key === "Enter") open($("#dir").value); };
$("#up").onclick = () => cur && open(cur.parent);

const s = await state();
await open(localStorage.getItem("p3d.dir") || s.home).catch(() => open(s.home));
watch();
