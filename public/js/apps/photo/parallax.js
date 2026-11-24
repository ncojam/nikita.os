/* ================= Параллакс по карте глубины (WebGL2) =================
 * Точка картинки с глубиной d (1 — близко, 0 — далеко) при взгляде сбоку сдвигается на off · (d − focus).
 * Для каждого пикселя экрана идём «лучом» от ближнего слоя к дальнему и берём первую поверхность, которая
 * его закрывает (steep parallax): ближнее честно перекрывает дальнее, без растягивания краёв.
 *
 *   const p = new Parallax(canvas, img, depthImg);  p.set({ x, y, strength, focus, zoom });  p.dispose();
 * x, y — угол взгляда −1..1 (центр — 0); strength — сила сдвига (доля кадра); focus — какая глубина стоит на месте.
 */
const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D img, dep;
uniform vec2 off, fit;      // fit: масштаб uv под «вписать» (letterbox)
uniform float focus, zoom;
const int N = 40;
void main() {
  vec2 s = (vUv - 0.5) / fit / zoom + 0.5;          // экран → картинка
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) { o = vec4(0.0); return; }
  vec2 uv = s; float prevL = 1.0; vec2 prevUv = s - off * (1.0 - focus); float prevD = texture(dep, prevUv).r;
  for (int i = 1; i <= N; i++) {
    float L = 1.0 - float(i) / float(N);
    vec2 q = s - off * (L - focus);
    float d = texture(dep, q).r;
    if (d >= L) {   // поверхность перед лучом: уточняем между прошлым и этим слоем
      float a = (prevD - prevL), b = (d - L), t = a / (a - b + 1e-5);
      uv = mix(prevUv, q, clamp(t, 0.0, 1.0));
      break;
    }
    prevL = L; prevUv = q; prevD = d; uv = q;
  }
  o = texture(img, clamp(uv, 0.0, 1.0));
}`;

export class Parallax {
  constructor(canvas, img, depth) {
    this.cv = canvas;
    const gl = this.gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL2 недоступен");
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = this.pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    gl.useProgram(pr);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = [this.texture(img, 0), this.texture(depth, 1)];
    gl.uniform1i(gl.getUniformLocation(pr, "img"), 0);
    gl.uniform1i(gl.getUniformLocation(pr, "dep"), 1);
    this.u = Object.fromEntries(["off", "fit", "focus", "zoom"].map(n => [n, gl.getUniformLocation(pr, n)]));
    this.aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
    this.v = { x: 0, y: 0, strength: 0.04, focus: 0.5, zoom: 1.04 };
  }
  texture(src, unit) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  set(v) { Object.assign(this.v, v); this.draw(); }
  draw() {
    const gl = this.gl, cv = this.cv, dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H);
    const ca = W / H, fit = ca > this.aspect ? [this.aspect / ca, 1] : [1, ca / this.aspect];
    const { x, y, strength, focus, zoom } = this.v;
    gl.uniform2f(this.u.off, x * strength, y * strength * this.aspect);
    gl.uniform2f(this.u.fit, fit[0], fit[1]);
    gl.uniform1f(this.u.focus, focus);
    gl.uniform1f(this.u.zoom, zoom);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose() { const gl = this.gl; this.tex.forEach(t => gl.deleteTexture(t)); gl.deleteProgram(this.pr); gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}
