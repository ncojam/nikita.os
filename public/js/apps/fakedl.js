import { el, fmtSize, fmtTime } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= «загрузчик» (прикол) =================
 * Ярлык .lnk запускает это приложение:
 *   { "name": "GTA VI", "icon": "🧲", "app": "fakedl",
 *     "file": "GTA6.iso", "size": 284686671872 }  // размер в байтах, по желанию
 * Окно честно качает ~1 байт в минуту: прогресс-бар живёт, соединение «держится»,
 * но до конца не доедет никогда. Внизу прямым текстом написано, что это шутка.
 */

// сколько «байт» капает в минуту — от этого и вся скорость
const BYTES_PER_MIN = 1;
const DEFAULT_SIZE = 284 * 1073741824 + 700 * 1048576; // ~284.7 ГБ, как у настоящей большой игры

// чуть «живая» скорость вокруг базовой, чтобы цифры дрожали как по-настоящему
const jitter = base => base * (0.4 + Math.random() * 1.2);

function openFakeDL(link = {}) {
  const total = Number.isFinite(link.size) && link.size > 0 ? link.size : DEFAULT_SIZE;
  const file = link.file || (link.name ? link.name + ".iso" : "download.iso");
  const title = "Загрузка: " + file;

  WM.open({ title, icon: link.icon || "🧲", width: 460, height: 300, key: "fakedl:" + file,
    render(c, w) {
      let done = 0;                 // «скачано» байт
      const start = performance.now();

      const bar = el("div", { className: "fdl-bar" });
      const fill = el("div", { className: "fdl-fill" });
      bar.append(fill);

      const pct = el("div", { className: "fdl-pct", textContent: "0,0 %" });
      const sizes = el("div", { className: "fdl-line" });
      const speed = el("div", { className: "fdl-line" });
      const eta = el("div", { className: "fdl-line" });

      const joke = el("div", { className: "fdl-joke",
        textContent: "(это шутка — на самом деле ничего не скачивается)" });

      c.append(el("div", { className: "fdl" },
        el("div", { className: "fdl-file" }, el("span", { className: "fdl-glyph", textContent: "💿" }),
          el("span", { textContent: file })),
        bar, pct,
        el("div", { className: "fdl-stats" }, sizes, speed, eta),
        joke));

      const render = () => {
        const frac = Math.min(done / total, 1);
        fill.style.width = (frac * 100).toFixed(4) + "%";
        pct.textContent = (frac * 100).toLocaleString("ru-RU",
          { minimumFractionDigits: 1, maximumFractionDigits: 7 }) + " %";
        sizes.textContent = `${fmtSize(done)} из ${fmtSize(total)}`;
        // мгновенная скорость «дрожит» вокруг 1 байта/мин ≈ 0,017 Б/с
        const bps = jitter(BYTES_PER_MIN / 60);
        speed.textContent = "Скорость: " + fmtSize(bps) + "/с";
        // при такой скорости остаток времени считаем по базовой (без дрожи), иначе прыгает
        const left = (total - done) / (BYTES_PER_MIN / 60);
        eta.textContent = "Осталось: " + humanEta(left);
      };

      // ETA в годах — секунды fmtTime тут бессмысленны
      const humanEta = s => {
        const years = s / (365.25 * 24 * 3600);
        if (years >= 1) return years.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " лет";
        const days = s / (24 * 3600);
        if (days >= 1) return days.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " дн.";
        return fmtTime(s);
      };

      render();

      // раз в секунду подкручиваем done так, чтобы в среднем выходил 1 байт/мин
      const tick = setInterval(() => {
        done = Math.min(total, done + jitter(BYTES_PER_MIN / 60));
        render();
      }, 1000);

      w.onClose = () => clearInterval(tick);
    }});
}

export { openFakeDL };
