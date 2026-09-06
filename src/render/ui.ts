// ===================== вид и управление =====================
import { L, U, Y, cam, hits, patents, resetCam, systems, worlds } from "../state";
import { el, panels } from "./panels";
import { markName, markOf, moveName } from "../data";
import { allTech, techOf } from "../tech";
import { setTickMs, tickMs } from "../clock";
import { step } from "../tick";
import { CH, CW, cv, cx, setCanvas } from "./canvas";
import { icon } from "./models";
import { clamp } from "../util";
import { loadLevers, saveLevers } from "../levers";
import { build } from "../setup";
import { frame } from "./scene";

export function scene() {
  var map = U.view.mode === "map";
  el("tomap").style.display = map ? "none" : "inline-block";
  el("sname").textContent = map ? "Галактика" : systems[U.view.sys].name;
  if (map) {
    var op = systems.filter(function (s) { return s.unlocked; }).length;
    el("smeta").textContent = "открыто систем " + op + " из " + systems.length + " · миров " + worlds.length + " · " + moveName();
  } else {
    var s = systems[U.view.sys];
    el("smeta").textContent = "планет " + s.bodies.length + " · " +
      s.bodies.map(function (b) { return b.type.name; }).join(", ");
  }
  el("ventlab").textContent = map ? "Что происходит в системах" : "Предприятия · " + systems[U.view.sys].name;
  panels();
}
export function open(i) { U.view = { mode:"system", sys:i }; U.pick = null; scene(); }

export function taxhint() {
  var p = Math.round(L.tax * 100);
  el("taxhint").textContent =
    p < 10 ? "У компаний много денег: они держат много мест, зарплаты растут."
  : p < 25 ? "Рабочий баланс: наём растёт, казна пополняется."
  : p < 42 ? "Компании сжимают штат, зато есть чем субсидировать науку."
  : "Компаниям не на что содержать ни цеха, ни лаборатории.";
}
export function subhint() {
  el("subhint").textContent = L.subYear === 0
    ? "Государство не вмешивается: кто во что верит, то и ищет."
    : "Казна доплачивает всем, кто ищет «" + (markOf(L.subKey) ? markName(markOf(L.subKey)) : techOf(L.subKey).name).toLowerCase() + "».";
}
export function pathint() {
  el("pathint").textContent = L.patTerm <= 12
    ? "Короткий патент: монополия не успевает сложиться, цены низкие."
    : L.patTerm >= 50 ? "Долгий патент: держатель технологии колонизации решает, кто вообще расселяется."
    : "Держатель успевает нажиться, но конкуренты копят знание к сроку.";
}
export function feehint() {
  var p = Math.round(L.tradeFee * 100);
  el("feehint").textContent = p === 0
    ? "Торговля свободна: комплекты собираются быстро, казна с этого не имеет ничего."
    : p < 15 ? "Умеренный сбор: казна зарабатывает, сборка почти не страдает."
    : "Высокий сбор: выгоднее делать всё самому. Заодно дорожают транспорты, и голодные миры голодают дольше.";
}
export function dolehint() {
  el("dolehint").textContent = L.dole === 0
    ? "Без пособия свободные хватаются за любую работу, и зарплаты внизу."
    : L.dole > 1.6 ? "Щедрое пособие: люди не спешат наниматься, зарплаты растут, казна пустеет."
    : "Пособие держит зарплаты чуть выше дна.";
}
export function run() { if (U.timer) clearInterval(U.timer); setTickMs(300 / L.speed); U.timer = setInterval(step, tickMs); }

export function syncControls() {
  el("tax").value = Math.round(L.tax * 100);
  el("taxval").textContent = Math.round(L.tax * 100) + "%";
  el("sub").value = L.subYear; el("subval").textContent = L.subYear;
  el("pat").value = L.patTerm; el("patval").textContent = L.patTerm + " лет";
  el("fee").value = Math.round(L.tradeFee * 100);
  el("feeval").textContent = Math.round(L.tradeFee * 100) + "%";
  el("dole").value = Math.round(L.dole * 5);
  el("doleval").textContent = L.dole.toFixed(1);
  el("speed").textContent = "×" + L.speed;
  el("subfield").value = L.subKey;
}

export function bindUI() {
  setCanvas(el("view"));
  var dpr = window.devicePixelRatio || 1;
  cv.width = CW * dpr; cv.height = CH * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // экран -> координаты сцены (на карте ещё и через камеру)
  function scenePos(e) {
    var rect = cv.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width * CW, y = (e.clientY - rect.top) / rect.height * CH;
    if (U.view.mode === "map") { x = (x - cam.x) / cam.k; y = (y - cam.y) / cam.k; }
    return { x:x, y:y };
  }

  var drag = null, moved = 0;
  cv.addEventListener("mousedown", function (e) {
    if (U.view.mode !== "map") return;
    drag = { x:e.clientX, y:e.clientY, cx:cam.x, cy:cam.y }; moved = 0;
  });
  window.addEventListener("mousemove", function (e) {
    if (!drag) {
      // наведение на рейс на карте показывает его окошко
      if (U.view.mode !== "map") return;
      var p = scenePos(e); U.hover = null;
      hits.forEach(function (h) {
        if (h.kind !== "cargo" && h.kind !== "jumpship") return;
        if (Math.abs(p.x - h.x) <= h.r && Math.abs(p.y - h.y) <= h.r) U.hover = h.data;
      });
      return;
    }
    var rect = cv.getBoundingClientRect();
    var sx = CW / rect.width, sy = CH / rect.height;
    var dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    cam.x = drag.cx + dx; cam.y = drag.cy + dy;
  });
  window.addEventListener("mouseup", function () { setTimeout(function () { drag = null; }, 0); });

  // Зум ТОЛЬКО с зажатым Ctrl. Простое колесо обязано прокручивать страницу:
  // канвас занимает пол-экрана, и перехват колеса читается как зависание —
  // страница не едет, а карта визуально не меняется.
  cv.addEventListener("wheel", function (e) {
    if (U.view.mode !== "map" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomAt(scenePos(e), e.deltaY < 0 ? 1.15 : 0.87);
  }, { passive:false });

  function zoomAt(p, mul) {
    var k = clamp(cam.k * mul, 0.7, 4);
    // приближаем к точке под курсором, а не к углу канваса
    cam.x += p.x * (cam.k - k); cam.y += p.y * (cam.k - k);
    cam.k = k;
  }
  el("zin").addEventListener("click", function () { zoomAt({ x:CW/2, y:CH/2 }, 1.3); });
  el("zout").addEventListener("click", function () { zoomAt({ x:CW/2, y:CH/2 }, 0.77); });
  el("zfit").addEventListener("click", function () { resetCam(); });

  cv.addEventListener("dblclick", function () { resetCam(); });

  cv.addEventListener("click", function (e) {
    if (moved > 4) { moved = 0; return; }          // это было перетаскивание
    var p = scenePos(e);
    var best = null, bd = 1e9;
    hits.forEach(function (h) {
      var d = Math.sqrt((p.x - h.x) * (p.x - h.x) + (p.y - h.y) * (p.y - h.y));
      if (d <= h.r && d < bd) { bd = d; best = h; }
    });
    if (!best) return;
    if (best.kind === "sys" && U.view.mode === "map") { open(best.data.id); return; }
    U.pick = best; panels();
  });

  var sel = el("subfield");
  sel.innerHTML = allTech().map(function (f) {
    return '<option value="' + f.key + '">' + (markOf(f.key) ? markName(f) : f.name) + '</option>';
  }).join("");
  sel.addEventListener("change", function (e) { L.subKey = e.target.value; subhint(); saveLevers(); });

  el("tax").addEventListener("input", function (e) {
    L.tax = +e.target.value / 100;
    el("taxval").textContent = Math.round(L.tax * 100) + "%"; taxhint(); saveLevers();
  });
  el("sub").addEventListener("input", function (e) {
    L.subYear = +e.target.value; el("subval").textContent = L.subYear; subhint(); saveLevers();
  });
  el("pat").addEventListener("input", function (e) {
    L.patTerm = +e.target.value; el("patval").textContent = L.patTerm + " лет";
    allTech().forEach(function (f) { var p = patents[f.key]; if (p.owner >= 0 && Y() - p.since < L.patTerm) p.told = false; });
    pathint(); saveLevers();
  });
  el("fee").addEventListener("input", function (e) {
    L.tradeFee = +e.target.value / 100;
    el("feeval").textContent = Math.round(L.tradeFee * 100) + "%"; feehint(); saveLevers();
  });
  el("dole").addEventListener("input", function (e) {
    L.dole = +e.target.value / 5; el("doleval").textContent = L.dole.toFixed(1); dolehint(); saveLevers();
  });
  function togglePause() {
    U.running = !U.running;
    var b = el("play");
    b.textContent = U.running ? "Пауза" : "Пуск";
    b.className = U.running ? "live" : "";
    if (U.running) run(); else clearInterval(U.timer);
  }
  el("play").addEventListener("click", togglePause);
  // Прилипшую снизу кнопку на айфоне НАКРЫВАЕТ нижняя панель браузера.
  // position:fixed отсчитывается от layout-вьюпорта, а тот у мобильного
  // сафари/хрома уходит ПОД панель — bottom:0 оказывается за ней. Полоса
  // жестов тут ни при чём, поэтому env(safe-area-inset-bottom) не помогал.
  // Меряем, сколько видимой области отъедено снизу, и поднимаем кнопку на
  // столько же. clientHeight — это по определению высота layout-вьюпорта, то
  // есть та самая система координат, в которой живёт fixed; innerHeight
  // считаем вторым мнением и берём большее, потому что у разных мобильных
  // браузеров эти два числа означают разное. Панель прячется при прокрутке —
  // visualViewport присылает событие, и кнопка опускается обратно.
  var vv = window.visualViewport;
  if (vv) {
    // Пинч-зум — вторая беда того же корня: fixed раздувается вместе со
    // страницей, кнопка занимала пол-экрана и вылезала за левый край, потому
    // что left:50% — это середина СТРАНИЦЫ, а не видимого окошка. Отдаём в CSS
    // и обратный множитель зума, и границы видимой области.
    var fitPause = function () {
      var st = document.documentElement.style, seen = vv.height + vv.offsetTop;
      var gap = Math.max(document.documentElement.clientHeight - seen, window.innerHeight - seen, 0);
      st.setProperty("--vvbot", Math.round(gap) + "px");
      st.setProperty("--vvleft", Math.round(vv.offsetLeft) + "px");
      st.setProperty("--vvw", Math.round(vv.width) + "px");
      st.setProperty("--vvz", (1 / (vv.scale || 1)).toFixed(3));
    };
    vv.addEventListener("resize", fitPause);
    vv.addEventListener("scroll", fitPause);
    fitPause();
  }
  // пробел — пауза; но не когда курсор в ползунке или выпадающем списке,
  // там пробел свой
  window.addEventListener("keydown", function (e) {
    if (e.code !== "Space" || e.repeat) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    togglePause();
  });
  el("speed").addEventListener("click", function () {
    var ladder = [1, 2, 4, 10, 20];
    L.speed = ladder[(ladder.indexOf(L.speed) + 1) % ladder.length];
    this.textContent = "×" + L.speed; if (U.running) run(); saveLevers();
  });
  el("map").addEventListener("click", function () { U.view.mode = "map"; scene(); });
  el("tomap").addEventListener("click", function () { U.view.mode = "map"; scene(); });
  el("reset").addEventListener("click", function () { build(); scene(); if (U.running) run(); });
  el("ventures").addEventListener("click", function (e) {
    var row = e.target.closest(".clickrow");
    if (row) open(+row.getAttribute("data-sys"));
  });
  el("worlds").addEventListener("click", function (e) {
    var row = e.target.closest(".clickrow");
    if (!row) return;
    var w = worlds[+row.getAttribute("data-world")];
    U.view = { mode:"system", sys:w.sys };
    U.pick = { kind:"body", data:w.body };
    scene();
  });

  Array.prototype.forEach.call(document.querySelectorAll("canvas.ikon"), function (c) {
    icon(c.getContext("2d"), c.getAttribute("data-kind"), 11, 10, 8, "#8894ae");
  });

  loadLevers(); syncControls();
  build(); scene(); taxhint(); subhint(); pathint(); feehint(); dolehint();
  requestAnimationFrame(frame);
  run();
}


// Стенд запускает ядро без браузера: см. test/. Отдаём только чтение
