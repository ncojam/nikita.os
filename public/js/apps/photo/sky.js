/* ================= Небо 3D-сцены: звёзды, изредка планеты, слепящая звезда, волны-полосы =================
 * Рисуется на двух 2D-холстах вокруг холста three.js: «за» сценой — небо, «перед» — блики линзы и засветка.
 * Всё привязано к направлениям в мире (а не к экрану): повернул голову — небо поехало как надо.
 * Что именно на небе, зависит от зерна (путь картинки): у каждой сцены своё небо, но всегда одно и то же.
 *
 *   const sky = createSky(box, { seed, visible(dir) });   // visible — не закрыта ли яркая звезда сценой
 *   sky.draw(cam, T, timeSec);  sky.dispose();
 */
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const dirFrom = (az, el) => [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];

export function createSky(box, { seed = "", visible = () => true } = {}) {
  const R = rng(seed);
  const back = document.createElement("canvas"), front = document.createElement("canvas");
  back.className = "ph-sky"; front.className = "ph-flare";
  box.prepend(back); box.append(front);
  const bg = back.getContext("2d"), fg = front.getContext("2d");

  // звёзды: равномерно по сфере, яркость — степенью (ярких мало)
  const stars = Array.from({ length: 1600 }, () => {
    const z = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const tint = R();
    return { d: [r * Math.cos(a), z, r * Math.sin(a)], m: Math.pow(R(), 3.2), tw: R() * 6.28, c: tint < 0.15 ? "255,214,170" : tint < 0.3 ? "180,205,255" : "255,255,255" };
  });
  // планеты — редко: одна в трети сцен, две — в десятой части
  const planets = [];
  const nPl = R() < 0.1 ? 2 : R() < 0.35 ? 1 : 0;
  const PAL = [["#c9a27a", "#6b4a33"], ["#8fb6d9", "#2b4466"], ["#c98fa8", "#4f2a3d"], ["#b9c48a", "#3f4a26"]];
  for (let i = 0; i < nPl; i++) planets.push({ d: dirFrom(R() * 6.28, 0.15 + R() * 0.7), r: 0.03 + R() * 0.05, col: PAL[Math.floor(R() * PAL.length)], ring: R() < 0.4, tilt: R() * 0.8 - 0.4 });
  // самая яркая звезда
  const sun = dirFrom(R() * 6.28, 0.2 + R() * 0.35);
  // волны-полосы
  const bands = [0, 1, 2].map(k => ({ base: 0.25 + k * 0.17 + R() * 0.08, amp: 0.05 + R() * 0.06, k: 1 + Math.floor(R() * 3), sp: (0.04 + R() * 0.05) * (R() < 0.5 ? -1 : 1), ph: R() * 6.28,
    col: ["127,214,255", "180,140,255", "127,255,208"][k] }));
  let vis = 1, frame = 0;

  function size(cv) {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(box.clientWidth * dpr), H = Math.round(box.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    return [W, H];
  }

  function draw(cam, T, t) {
    const [W, H] = size(back); size(front);
    const v = new T.Vector3(), fwd = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const far = 1000;
    const proj = d => {   // направление → пиксели (null — за спиной или за краем)
      if (d[0] * fwd.x + d[1] * fwd.y + d[2] * fwd.z <= 0.02) return null;
      v.set(cam.position.x + d[0] * far, cam.position.y + d[1] * far, cam.position.z + d[2] * far).project(cam);
      if (v.z > 1) return null;
      return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
    };
    const f = H / 2 / Math.tan(cam.fov * Math.PI / 360);   // пикселей на радиан у центра

    // фон: тёмно-синий, чуть светлее у горизонта
    const g0 = bg.createLinearGradient(0, 0, 0, H);
    const up = Math.max(-1, Math.min(1, fwd.y));
    g0.addColorStop(0, "#03040a"); g0.addColorStop(Math.min(0.95, Math.max(0.05, 0.55 + up * 0.5)), "#0a0d1c"); g0.addColorStop(1, "#05060d");
    bg.globalCompositeOperation = "source-over";
    bg.fillStyle = g0; bg.fillRect(0, 0, W, H);

    // волны: полупрозрачные ленты по небу, медленно ползут
    bg.globalCompositeOperation = "lighter";
    bg.lineCap = "round"; bg.lineJoin = "round";
    for (const b of bands) {
      const pts = [];
      for (let i = 0; i <= 140; i++) {
        const az = i / 140 * Math.PI * 2;
        const el = b.base + b.amp * Math.sin(az * b.k + t * b.sp + b.ph) + 0.02 * Math.sin(az * 7 - t * 0.35 + b.ph);
        pts.push(proj(dirFrom(az, el)));
      }
      for (const [lw, a] of [[H * 0.09, 0.035], [H * 0.035, 0.05], [H * 0.008, 0.09]]) {
        bg.lineWidth = lw; bg.strokeStyle = `rgba(${b.col},${a})`;
        bg.beginPath();
        let open = false;
        for (const p of pts) { if (!p) { open = false; continue; } if (!open) { bg.moveTo(p[0], p[1]); open = true; } else bg.lineTo(p[0], p[1]); }
        bg.stroke();
      }
    }

    // звёзды
    for (const s of stars) {
      const p = proj(s.d);
      if (!p) continue;
      const tw = 0.75 + 0.25 * Math.sin(t * 1.7 + s.tw);
      const a = Math.min(1, (0.25 + s.m * 1.4) * tw), r = (0.5 + s.m * 1.6) * (W / back.clientWidth || 1);
      bg.fillStyle = `rgba(${s.c},${a.toFixed(3)})`;
      bg.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
    }

    // планеты: освещены со стороны яркой звезды
    bg.globalCompositeOperation = "source-over";
    const sp = proj(sun);
    for (const pl of planets) {
      const p = proj(pl.d);
      if (!p) continue;
      const r = Math.tan(pl.r / 2) * f;
      let lx = sun[0] - pl.d[0], ly = sun[1] - pl.d[1];
      if (sp) { lx = sp[0] - p[0]; ly = sp[1] - p[1]; }
      const ll = Math.hypot(lx, ly) || 1;
      const gr = bg.createRadialGradient(p[0] + lx / ll * r * 0.45, p[1] + ly / ll * r * 0.45, r * 0.1, p[0], p[1], r * 1.05);
      gr.addColorStop(0, pl.col[0]); gr.addColorStop(0.65, pl.col[1]); gr.addColorStop(1, "#05060d");
      if (pl.ring) { bg.save(); bg.translate(p[0], p[1]); bg.rotate(pl.tilt); bg.strokeStyle = "rgba(230,220,200,.35)"; bg.lineWidth = r * 0.12; bg.beginPath(); bg.ellipse(0, 0, r * 1.9, r * 0.45, 0, Math.PI, Math.PI * 2); bg.stroke(); bg.restore(); }
      bg.fillStyle = gr; bg.beginPath(); bg.arc(p[0], p[1], r, 0, Math.PI * 2); bg.fill();
      if (pl.ring) { bg.save(); bg.translate(p[0], p[1]); bg.rotate(pl.tilt); bg.strokeStyle = "rgba(230,220,200,.45)"; bg.lineWidth = r * 0.12; bg.beginPath(); bg.ellipse(0, 0, r * 1.9, r * 0.45, 0, 0, Math.PI); bg.stroke(); bg.restore(); }
    }

    // яркая звезда и блики линзы — поверх сцены; закрыта сценой — плавно гаснет
    fg.clearRect(0, 0, W, H);
    if (frame++ % 6 === 0) vis = visible(sun) ? Math.min(1, vis + 0.34) : Math.max(0, vis - 0.34);
    const align = Math.max(0, sun[0] * fwd.x + sun[1] * fwd.y + sun[2] * fwd.z);
    if (sp && vis > 0) {
      const [x, y] = sp, k = vis;
      fg.globalCompositeOperation = "lighter";
      const halo = fg.createRadialGradient(x, y, 0, x, y, H * 0.35);
      halo.addColorStop(0, `rgba(255,252,240,${0.95 * k})`); halo.addColorStop(0.04, `rgba(255,240,210,${0.55 * k})`);
      halo.addColorStop(0.25, `rgba(255,200,150,${0.12 * k})`); halo.addColorStop(1, "rgba(0,0,0,0)");
      fg.fillStyle = halo; fg.fillRect(x - H * 0.35, y - H * 0.35, H * 0.7, H * 0.7);
      // лучи и анаморфная полоса
      fg.save(); fg.translate(x, y); fg.rotate(t * 0.05);
      for (let i = 0; i < 6; i++) {
        fg.rotate(Math.PI / 3);
        const L = H * (0.18 + 0.06 * Math.sin(t * 0.8 + i));
        const gl = fg.createLinearGradient(0, 0, L, 0);
        gl.addColorStop(0, `rgba(255,245,225,${0.5 * k})`); gl.addColorStop(1, "rgba(255,245,225,0)");
        fg.fillStyle = gl; fg.fillRect(0, -1, L, 2);
      }
      fg.restore();
      const st = fg.createLinearGradient(x - W * 0.5, y, x + W * 0.5, y);
      st.addColorStop(0, "rgba(120,170,255,0)"); st.addColorStop(0.5, `rgba(150,190,255,${0.35 * k})`); st.addColorStop(1, "rgba(120,170,255,0)");
      fg.fillStyle = st; fg.fillRect(x - W * 0.5, y - 1.5, W, 3);
      // «призраки» на линии звезда → центр кадра
      const cx = W / 2, cy = H / 2;
      for (const [tt, rr, col, a] of [[0.45, 0.03, "255,190,120", 0.18], [0.8, 0.06, "140,200,255", 0.12], [1.25, 0.02, "200,255,180", 0.2], [1.6, 0.09, "190,150,255", 0.08], [-0.3, 0.015, "255,230,200", 0.2]]) {
        const gx = x + (cx - x) * tt * 2, gy = y + (cy - y) * tt * 2, gr2 = rr * H;
        const gg = fg.createRadialGradient(gx, gy, 0, gx, gy, gr2);
        gg.addColorStop(0, `rgba(${col},${a * k})`); gg.addColorStop(0.7, `rgba(${col},${a * 0.5 * k})`); gg.addColorStop(1, `rgba(${col},0)`);
        fg.fillStyle = gg; fg.beginPath(); fg.arc(gx, gy, gr2, 0, Math.PI * 2); fg.fill();
      }
      fg.globalCompositeOperation = "source-over";
    }
    // слепит: чем точнее смотришь на звезду, тем сильнее свет растекается от неё по экрану
    const ang = Math.acos(Math.min(1, align));
    const blind = Math.pow(Math.max(0, 1 - ang / 0.3), 2) * vis;
    if (blind > 0.01 && sp) {
      const Rw = Math.hypot(W, H) * (0.4 + blind * 0.6), gw = fg.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], Rw);
      gw.addColorStop(0, `rgba(255,250,236,${(0.85 * blind).toFixed(3)})`);
      gw.addColorStop(0.35, `rgba(255,236,210,${(0.35 * blind).toFixed(3)})`);
      gw.addColorStop(1, "rgba(255,236,210,0)");
      fg.fillStyle = gw; fg.fillRect(0, 0, W, H);
    }
  }

  return { draw, sun, dispose() { back.remove(); front.remove(); } };
}
