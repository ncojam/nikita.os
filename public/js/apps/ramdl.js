import { el, fmtSize, store } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= «Скачать RAM» (прикол) =================
 * Ярлык .lnk: { "name": "Скачать RAM", "icon": "🐏", "app": "ramdl" }
 *
 * Выбираешь объём, и планка памяти заполняется за DURATION секунд на бешеной скорости.
 * В отличие от fakedl, сети здесь нет совсем: всё считает браузер, а большая скорость
 * не стоит серверу ни байта трафика. Скачанное копится в store("ramdl.total").
 *
 * Признание, что это шутка, спрятано за ⓘ — как и в fakedl.
 */

const GB = 1073741824;
const SIZES = [16, 32, 64, 128];   // варианты объёма, ГБ
const CHIPS = 8;                   // микросхем на планке — это и есть прогресс-бар
const DURATION = 18;               // секунд на загрузку: чем больше объём, тем выше скорость
const TICK_MS = 200;
const FALLBACK_RAM = 8;            // deviceMemory есть не во всех браузерах
const LOG_MAX = 6;

const pick = n => 1 + (Math.random() * n | 0);

const LOG_LINES = [
  () => "Подключение к складу в Шэньчжэне…",
  () => `Сид «Дядя Вася» раздаёт ${pick(64)} ГБ`,
  () => `Согласование таймингов CL${pick(9) + 13}…`,
  () => "Сортировка битов: нули налево, единицы направо",
  () => "Дефрагментация кэша L3…",
  () => "Прогрев конденсаторов…",
  () => "Проверка чётности: вроде чётно",
  () => `Уговариваю слот DIMM${pick(4)}…`,
  () => "Распаковка .rar в .ram…",
  () => "BIOS не против",
];

function installed() {
  return (navigator.deviceMemory || FALLBACK_RAM) + (Number(store.get("ramdl.total", 0)) || 0);
}

function openRamDL() {
  WM.open({ title: "Скачать RAM", icon: "🐏", width: 480, height: 470, key: "ramdl",
    render(c, w) {
      let tick = 0, logTimer = 0;
      const stopTimers = () => { clearInterval(tick); clearInterval(logTimer); };

      const fills = [];
      const chips = Array.from({ length: CHIPS }, () => {
        const fill = el("div", { className: "rdl-chip-fill" });
        fills.push(fill);
        return el("div", { className: "rdl-chip" }, fill);
      });
      const stick = el("div", { className: "rdl-stick" },
        el("div", { className: "rdl-chips" }, ...chips),
        el("div", { className: "rdl-pins" }, el("span"), el("span")));

      const name = el("span", { className: "fdl-name", textContent: "Выбери объём" });
      const info = el("button", { className: "fdl-info-btn", title: "Что это?", textContent: "ⓘ" });
      const pct = el("div", { className: "fdl-pct", textContent: "0,0 %" });
      const sizes = el("div", { className: "fdl-line" });
      const speed = el("div", { className: "fdl-line" });
      const logBox = el("div", { className: "fdl-log" });
      const buttons = el("div", { className: "rdl-sizes" });

      c.append(el("div", { className: "fdl" },
        el("div", { className: "fdl-file" }, name, info),
        stick, pct,
        el("div", { className: "fdl-stats" }, sizes, speed),
        buttons, logBox));

      const showIdle = () => {
        sizes.textContent = "Сейчас установлено: " + fmtSize(installed() * GB);
        speed.textContent = "";
      };

      const pushLog = text => {
        logBox.append(el("div", { className: "fdl-log-row", textContent: text }));
        while (logBox.children.length > LOG_MAX) logBox.firstChild.remove();
      };

      const paint = frac => {
        const filled = frac * CHIPS;
        fills.forEach((f, i) => { f.style.height = Math.min(Math.max(filled - i, 0), 1) * 100 + "%"; });
        pct.textContent = (frac * 100).toLocaleString(globalThis.NOS_LOCALE,
          { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
      };

      const finish = (gb, before) => {
        stopTimers();
        store.set("ramdl.total", (Number(store.get("ramdl.total", 0)) || 0) + gb);
        stick.classList.add("done");
        name.textContent = "Память установлена";
        sizes.textContent = `Было: ${fmtSize(before * GB)} → стало: ${fmtSize((before + gb) * GB)}`;
        speed.textContent = "Перезагрузка не требуется";
        pushLog("Готово. Компьютер стал умнее");
        buttons.hidden = false;
      };

      const start = gb => {
        const total = gb * GB, base = total / DURATION, before = installed();
        let done = 0, rate = base, last = performance.now();

        stick.classList.remove("done");
        buttons.hidden = true;
        name.textContent = `DDR5-${gb}GB.ram`;
        logBox.replaceChildren();
        pushLog(LOG_LINES[0]());

        tick = setInterval(() => {
          const now = performance.now();
          const dt = (now - last) / 1000;   // по часам: в фоновой вкладке таймеры редеют
          last = now;
          rate += (base * (0.65 + Math.random() * 0.7) - rate) * 0.2;   // плавно дрожит вокруг base
          done = Math.min(total, done + rate * dt);
          paint(done / total);
          sizes.textContent = `${fmtSize(done)} из ${fmtSize(total)}`;
          speed.textContent = "Скорость: " + fmtSize(rate) + "/с";
          if (done >= total) finish(gb, before);
        }, TICK_MS);
        let line = 0;
        const order = LOG_LINES.slice(1).sort(() => Math.random() - 0.5);   // без повторов подряд
        logTimer = setInterval(() => pushLog(order[line++ % order.length]()), 1400);
      };

      for (const gb of SIZES) {
        buttons.append(el("button", { className: "btn small", textContent: fmtSize(gb * GB).replace(".00", ""),
          onclick: () => start(gb) }));
      }
      paint(0);
      showIdle();

      info.onclick = () => openConfession(c);
      w.onClose = stopTimers;
    }});
}

/* панель-признание поверх окна */
function openConfession(host) {
  if (host.querySelector(".fdl-info")) return;
  const close = el("button", { className: "btn small", textContent: "Ладно, понял" });
  const panel = el("div", { className: "fdl-info glass" },
    el("h3", { textContent: "💬 Опять я…" }),
    el("p", { textContent: "Снова тот самый программист. Оперативную память нельзя скачать: это физическая " +
      "планка в компьютере, а не файл. Здесь не загружается ни байта, цифры считает сам браузер." }),
    el("p", { textContent: "Число «стало» живёт только на этом сайте. Автор снова попросил спрятать " +
      "это поглубже. Ты снова докопался." }),
    close);
  close.onclick = () => panel.remove();
  host.append(panel);
}

export { openRamDL };
