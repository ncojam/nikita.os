import { el, fmtSize, fmtTime, fsUrl } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= «загрузчик» (прикол) =================
 * Ярлык .lnk запускает это приложение:
 *   { "name": "GTA VI", "icon": "🧲", "app": "fakedl",
 *     "file": "GTA6.iso", "size": 284686671872 }   // size в байтах — по желанию
 *
 * Окно-пульт рисует «живую» загрузку (бар, скорость, ETA, торрент-лог), а параллельно
 * дёргает /grab/<file> — браузер получает ответ с огромным Content-Length и начинает
 * настоящую загрузку, которая капает по байту и не докачается никогда. Файл честно
 * висит в менеджере загрузок.
 *
 * Признание, что это шутка, спрятано за кнопкой ⓘ (см. CONFESSION) — так захотел автор.
 * Отключить реальную струйку в браузер: добавить в ярлык "real": false.
 */

const BYTES_PER_MIN = 1;                                  // как быстро «капает» в окне-пульте
const DEFAULT_SIZE = 284 * 1073741824 + 700 * 1048576;    // ~284.7 ГБ, как большая игра
const CONFESSION_IMG = "/home/nikita/Games/Pinkshake/TemplateData/me_when_i_try_to_inform_people.png";

// чуть «живая» скорость вокруг базовой — чтобы цифры дрожали как по-настоящему
const jitter = base => base * (0.4 + Math.random() * 1.2);

// строки фейкового торрент-лога — выглядят серьёзно, но при чтении абсурдны
const LOG_LINES = [
  () => `Подключение к пиру ${1 + (Math.random() * 9 | 0)} из ${(8000 + Math.random() * 4000 | 0).toLocaleString("ru-RU")}…`,
  () => `Рукопожатие с трекером (попытка ${1 + (Math.random() * 40 | 0)})…`,
  () => `Проверка целостности блока #${(Math.random() * 271040 | 0).toLocaleString("ru-RU")}…`,
  () => `Ожидание сидов (в сети: ${Math.random() < 0.85 ? 0 : 1})…`,
  () => `Запрашиваю кусок ${1 + (Math.random() * 3 | 0)} из 271 040 у ${Math.random() < 0.7 ? 0 : 1} пиров…`,
  () => `Пир ${Math.random() * 254 + 1 | 0}.${Math.random() * 254 | 0}.${Math.random() * 254 | 0}.${Math.random() * 254 | 0} отключился`,
  () => `DHT: найдено узлов — ${(Math.random() * 3 | 0)}`,
  () => `Оптимистичная разблокировка пира… пир не отвечает`,
  () => `Перезапрашиваю метаданные (${(Math.random() * 100 | 0)} %)…`,
  () => `Выбор самого быстрого источника из ${Math.random() < 0.9 ? 0 : 1}…`,
];

// ETA в человеческом виде: при такой скорости секунды бессмысленны
const humanEta = s => {
  const years = s / (365.25 * 24 * 3600);
  if (years >= 1) return years.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " лет";
  const days = s / (24 * 3600);
  if (days >= 1) return days.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " дн.";
  return fmtTime(s);
};

function openFakeDL(link = {}) {
  const total = Number.isFinite(link.size) && link.size > 0 ? link.size : DEFAULT_SIZE;
  const file = link.file || (link.name ? link.name + ".iso" : "download.iso");

  WM.open({ title: "Загрузка: " + file, icon: link.icon || "🧲", width: 480, height: 360,
    key: "fakedl:" + file,
    render(c, w) {
      let done = 0;

      const bar = el("div", { className: "fdl-bar" }, el("div", { className: "fdl-fill" }));
      const fill = bar.firstChild;
      const pct = el("div", { className: "fdl-pct", textContent: "0,0 %" });
      const sizes = el("div", { className: "fdl-line" });
      const speed = el("div", { className: "fdl-line" });
      const eta = el("div", { className: "fdl-line" });
      const logBox = el("div", { className: "fdl-log" });

      const info = el("button", { className: "fdl-info-btn", title: "Что это?", textContent: "ⓘ" });

      c.append(el("div", { className: "fdl" },
        el("div", { className: "fdl-file" },
          el("span", { className: "fdl-glyph", textContent: "💿" }),
          el("span", { className: "fdl-name", textContent: file }),
          info),
        bar, pct,
        el("div", { className: "fdl-stats" }, sizes, speed, eta),
        logBox));

      const render = () => {
        const frac = Math.min(done / total, 1);
        fill.style.width = (frac * 100).toFixed(4) + "%";
        pct.textContent = (frac * 100).toLocaleString("ru-RU",
          { minimumFractionDigits: 1, maximumFractionDigits: 7 }) + " %";
        sizes.textContent = `${fmtSize(done)} из ${fmtSize(total)}`;
        speed.textContent = "Скорость: " + fmtSize(jitter(BYTES_PER_MIN / 60)) + "/с";
        eta.textContent = "Осталось: " + humanEta((total - done) / (BYTES_PER_MIN / 60));
      };

      const pushLog = () => {
        const row = el("div", { className: "fdl-log-row",
          textContent: LOG_LINES[Math.random() * LOG_LINES.length | 0]() });
        logBox.append(row);
        while (logBox.children.length > 7) logBox.firstChild.remove();
        logBox.scrollTop = logBox.scrollHeight;
      };

      render();
      pushLog(); pushLog();

      const tick = setInterval(() => {
        done = Math.min(total, done + jitter(BYTES_PER_MIN / 60));
        render();
      }, 1000);
      const logTimer = setInterval(pushLog, 2500);

      // ---- настоящая струйка в браузер: файл появится в менеджере загрузок ----
      if (link.real !== false) {
        try {
          const a = el("a", { href: "/grab/" + encodeURIComponent(file) + "?size=" + total });
          document.body.append(a); a.click(); a.remove();
        } catch {}
      }

      // ---- признание (спрятано за ⓘ) ----
      info.onclick = () => openConfession(c);

      w.onClose = () => { clearInterval(tick); clearInterval(logTimer); };
    }});
}

/* панель-признание поверх окна */
function openConfession(host) {
  if (host.querySelector(".fdl-info")) return;
  const img = el("img", { className: "fdl-info-img", src: fsUrl(CONFESSION_IMG),
    alt: "программист в момент предупреждения" });
  img.onerror = () => img.remove();

  const close = el("button", { className: "btn small", textContent: "Ладно, понял" });
  const panel = el("div", { className: "fdl-info glass" },
    el("h3", { textContent: "💬 Честно говоря…" }),
    el("p", { textContent: "Привет. Это писал живой программист — тот, кого наняли сделать эту кнопку. " +
      "По-честному: скачивать тут нечего. «Файл» капает по байту, чтобы просто подольше повисеть в загрузках, " +
      "и не докачается никогда — даже если оставить комп включённым на пару тысяч лет." }),
    el("p", { textContent: "Я хотел написать это крупными буквами прямо в окне. Автор сказал: «убери, спрячь " +
      "куда-нибудь поглубже, пусть сами ищут». Ну вот, спрятал — сюда. Раз ты докопался, ты молодец." }),
    el("p", { className: "fdl-info-cap", textContent: "Вот так я выглядел, когда пытался всех предупредить:" }),
    img, close);
  close.onclick = () => panel.remove();
  host.append(panel);
}

export { openFakeDL };
