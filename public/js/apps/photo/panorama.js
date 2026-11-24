/* ================= 3D-панорама (WebGL2) =================
 * Картинка — сферическая панорама 360° × 180° (равнопромежуточная, обычно 2:1). Для каждого пикселя экрана
 * считаем луч взгляда и берём цвет из панорамы по его долготе и широте — без three.js, один шейдер.
 *
 * Две проекции, плавно перетекают друг в друга (planet 0..1):
 *   обычная (прямолинейная) — как смотреть вокруг из центра сферы;
 *   «маленькая планета» (стереографическая, взгляд вниз) — мир сворачивается в шарик.
 *
 *   const p = new Panorama(canvas, img);  p.set({ yaw, pitch, fov, planet });  p.dispose();
 * yaw — градусы (поворот по горизонту), pitch — −89..89, fov — угол обзора по вертикали, 30..120.
 */
const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main() { vUv = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D pano;
uniform float yaw, pitch, tanHalf, aspect, planet;
const float PI = 3.14159265;
vec3 rotate(vec3 d, float yw, float pt) {
  float cp = cos(pt), sp = sin(pt);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);   // наклон вверх-вниз
  float cy = cos(yw), sy = sin(yw);
  return vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy); // поворот по горизонту
}
void main() {
  vec2 s = vec2(vUv.x * aspect, vUv.y);
  // обычная проекция: луч через плоскость экрана
  vec3 rect = normalize(vec3(s * tanHalf, -1.0));
  rect = rotate(rect, yaw, pitch);
  // маленькая планета: стереографическая проекция, взгляд строго вниз
  float r = length(s) * tanHalf * 2.4;   // горизонт — примерно на полпути к краю кадра (колесо — ближе/дальше)
  float th = 2.0 * atan(r), ph = atan(s.x, -s.y);
  vec3 st = vec3(sin(th) * sin(ph), -cos(th), sin(th) * cos(ph));
  st = rotate(st, yaw, 0.0);
  vec3 d = normalize(mix(rect, st, planet));
  float lon = atan(d.x, -d.z), lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  o = texture(pano, uv);
}`;

export class Panorama {
  constructor(canvas, img) {
    this.cv = canvas;
    const gl = this.gl = canvas.getContext("webgl2", { alpha: false });
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
    // текстура: по горизонтали — по кругу (шов на 180° не виден), мипмапы — без ряби при отдалении
    const t = this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let src = img;
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (W > max || H > max) {   // огромная панорама — ужать под видеокарту
      const k = max / Math.max(W, H), c = document.createElement("canvas");
      c.width = Math.floor(W * k); c.height = Math.floor(H * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      src = c;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = Object.fromEntries(["yaw", "pitch", "tanHalf", "aspect", "planet"].map(n => [n, gl.getUniformLocation(pr, n)]));
    this.v = { yaw: 0, pitch: 0, fov: 80, planet: 0 };
  }
  set(v) { Object.assign(this.v, v); this.draw(); }
  draw() {
    const gl = this.gl, cv = this.cv, dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H);
    const { yaw, pitch, fov, planet } = this.v, rad = Math.PI / 180;
    gl.uniform1f(this.u.yaw, yaw * rad);
    gl.uniform1f(this.u.pitch, Math.max(-89, Math.min(89, pitch)) * rad);
    gl.uniform1f(this.u.tanHalf, Math.tan(fov * rad / 2));
    gl.uniform1f(this.u.aspect, W / H);
    gl.uniform1f(this.u.planet, planet);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose() { const gl = this.gl; gl.deleteTexture(this.tex); gl.deleteProgram(this.pr); gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}
