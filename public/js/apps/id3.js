import { kindOf } from "../core/types.js";
import { baseName, fsUrl } from "../core/util.js";

/* ================= ID3-теги (название, исполнитель, обложка) ================= */
const ID3 = (() => {
  const cache = new Map();
  const syncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
  const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

  async function range(url, a, b) {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
    if (!r.ok) return new Uint8Array();
    return new Uint8Array(await r.arrayBuffer());
  }
  // кодировка 0 по стандарту latin1, но русские теги там почти всегда в cp1251
  function decode(enc, bytes) {
    let label = ["windows-1251", "utf-16le", "utf-16be", "utf-8"][enc] || "utf-8";
    if (enc === 1 && bytes.length >= 2) {
      if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
      if (bytes[0] <= 0xff && (bytes[0] === 0xfe || bytes[0] === 0xff)) bytes = bytes.subarray(2);
    }
    return new TextDecoder(label).decode(bytes).split("\0")[0].trim();
  }
  function term(b, start, wide) {
    if (!wide) { const k = b.indexOf(0, start); return k < 0 ? b.length : k + 1; }
    for (let k = start; k + 1 < b.length; k += 2) if (b[k] === 0 && b[k + 1] === 0) return k + 2;
    return b.length;
  }
  function picture(b) {
    const enc = b[0];
    const mEnd = term(b, 1, false);
    let mime = new TextDecoder("latin1").decode(b.subarray(1, mEnd - 1)).toLowerCase();
    if (!mime || mime === "image/jpg" || !mime.includes("/")) mime = mime.includes("png") ? "image/png" : "image/jpeg";
    const dataStart = term(b, mEnd + 1, enc === 1 || enc === 2); // +1 — пропускаем тип картинки
    return URL.createObjectURL(new Blob([b.subarray(dataStart)], { type: mime }));
  }

  async function read(url) {
    const out = {};
    try {
      const h = await range(url, 0, 9);
      if (h.length < 10 || h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return out; // "ID3"
      const ver = h[3], flags = h[5], size = syncsafe(h, 6);
      if (ver < 3 || ver > 4 || !size || size > 12 * 1024 * 1024) return out;
      let tag = await range(url, 10, 10 + size - 1);
      if (ver === 3 && flags & 0x80) { // unsynchronisation: FF 00 -> FF
        const r = []; for (let i = 0; i < tag.length; i++) { r.push(tag[i]); if (tag[i] === 0xff && tag[i + 1] === 0) i++; }
        tag = Uint8Array.from(r);
      }
      let pos = 0;
      if (flags & 0x40) pos = ver === 4 ? syncsafe(tag, 0) : u32(tag, 0) + 4;
      while (pos + 10 <= tag.length) {
        const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fsize = ver === 4 ? syncsafe(tag, pos + 4) : u32(tag, pos + 4);
        const body = tag.subarray(pos + 10, pos + 10 + fsize);
        pos += 10 + fsize;
        if (!body.length) continue;
        if (id === "TIT2") out.title = decode(body[0], body.subarray(1));
        else if (id === "TPE1") out.artist = decode(body[0], body.subarray(1));
        else if (id === "TALB") out.album = decode(body[0], body.subarray(1));
        else if (id === "APIC" && !out.cover) out.cover = picture(body);
      }
    } catch (e) { console.warn("ID3:", e); }
    return out;
  }

  function fromName(path) {
    const n = baseName(path).replace(/\.[^.]+$/, "").replace(/_/g, " ");
    const m = n.match(/^(.+?)\s+[-–—]\s+(.+)$/); // "Artist - Title"
    return m ? { artist: m[1], title: m[2] } : { title: n };
  }

  return {
    get(path) {
      if (!cache.has(path)) {
        cache.set(path, (kindOf(path) === "audio" && /\.mp3$/i.test(path) ? read(fsUrl(path)) : Promise.resolve({}))
          .then(t => ({ ...fromName(path), ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)) })));
      }
      return cache.get(path);
    },
  };
})();

export { ID3 };
