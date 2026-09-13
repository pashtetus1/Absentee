// ===================== вид и управление =====================

import { setTickMs, tickMs } from "../clock";
import { markName, markOf, moveName } from "../data";
import { loadLevers, saveLevers } from "../levers";
import { drop, hold, keep, resume } from "../save";
import { seedOf } from "../rng";
import { build } from "../setup";
import { decideById } from "../shipyard";
import { L, U, Y, cam, hits, patents, proposals, resetCam, systems, worlds } from "../state";
import { allTech, techOf } from "../tech";
import { step } from "../tick";
import { clamp } from "../util";
import { CH, CW, cv, cx, setCanvas, sysK } from "./canvas";
import { icon } from "./models";
import { Ctl, el, panels } from "./panels";
import { frame } from "./scene";
import type { Hit } from "../types";

export function scene(): void {
  const map = U.view.mode === "map";
  el("tomap").style.display = map ? "none" : "inline-block";
  el("sname").textContent = map ? "Галактика" : systems[U.view.sys].name;
  if (map) {
    const op = systems.filter((s) => { return s.unlocked; }).length;
    el("smeta").textContent = "открыто систем " + op + " из " + systems.length + " · миров " + worlds.length + " · " + moveName();
  } else {
    const s = systems[U.view.sys];
    el("smeta").textContent = "планет " + s.bodies.length + " · " +
      s.bodies.map((b) => { return b.type.name; }).join(", ");
  }
  el("ventlab").textContent = map ? "Что происходит в системах" : "Предприятия · " + systems[U.view.sys].name;
  panels();
}
export function open(i: number): void { U.view = { mode:"system", sys:i }; U.pick = null; scene(); }

export function taxhint(): void {
  const p = Math.round(L.tax * 100);
  el("taxhint").textContent =
    p < 10 ? "У компаний много денег: они держат много мест, зарплаты растут."
  : p < 25 ? "Рабочий баланс: наём растёт, казна пополняется."
  : p < 42 ? "Компании сжимают штат, зато есть чем субсидировать науку."
  : "Компаниям не на что содержать ни цеха, ни лаборатории.";
}
export function subhint(): void {
  el("subhint").textContent = L.subYear === 0
    ? "Государство не вмешивается: кто во что верит, то и ищет."
    : "Казна доплачивает всем, кто ищет «" + (markOf(L.subKey) ? markName(markOf(L.subKey)) : techOf(L.subKey).name).toLowerCase() + "».";
}
export function pathint(): void {
  el("pathint").textContent = L.patTerm <= 12
    ? "Короткий патент: монополия не успевает сложиться, цены низкие."
    : L.patTerm >= 50 ? "Долгий патент: держатель технологии колонизации решает, кто вообще расселяется."
    : "Держатель успевает нажиться, но конкуренты копят знание к сроку.";
}
export function feehint(): void {
  const p = Math.round(L.tradeFee * 100);
  el("feehint").textContent = p === 0
    ? "Торговля свободна: комплекты собираются быстро, казна с этого не имеет ничего."
    : p < 15 ? "Умеренный сбор: казна зарабатывает, сборка почти не страдает."
    : "Высокий сбор: выгоднее делать всё самому. Заодно дорожают транспорты, и голодные миры голодают дольше.";
}
export function run(): void { if (U.timer) clearInterval(U.timer); setTickMs(300 / L.speed); U.timer = setInterval(step, tickMs); }

export function syncControls(): void {
  el("tax").value = Math.round(L.tax * 100);
  el("taxval").textContent = Math.round(L.tax * 100) + "%";
  el("sub").value = L.subYear; el("subval").textContent = L.subYear;
  el("pat").value = L.patTerm; el("patval").textContent = L.patTerm + " лет";
  el("fee").value = Math.round(L.tradeFee * 100);
  el("feeval").textContent = Math.round(L.tradeFee * 100) + "%";
  el("speed").textContent = "×" + L.speed;
  el("subfield").value = L.subKey;
}

// Сид в адресе страницы: партию можно прислать ссылкой, и она развернётся
// точно та же. Из адреса он и читается при загрузке — иначе воспроизвести
// увиденное было бы нечем.
function seedFromUrl(): number | undefined {
  if (typeof location === "undefined") return undefined;
  const m = /(?:^|[#&?])seed=(\d+)/.exec(location.hash + location.search);
  return m ? (+m[1] >>> 0) : undefined;
}
function seedToUrl(): void {
  if (typeof location === "undefined") return;
  const tail = "#seed=" + seedOf();
  // replaceState не всегда разрешён для file://, поэтому с запасным путём
  try { history.replaceState(null, "", tail); } catch (e) { location.hash = tail; }
}

// Новое предложение останавливает время: без верфи экономика стоит вовсе, и
// пропущенное решение выглядит как сломанная игра. Пауза только на ПЕРВОЕ
// появление каждого предложения, чтобы не дёргать на каждом кадре.
export function togglePause(): void {
  U.running = !U.running;
  const b = el("play");
  b.textContent = U.running ? "Пауза" : "Пуск";
  b.className = U.running ? "live" : "";
  // На паузе партия откладывается НЕ ДОЖИДАЯСЬ часов: пауза — это ровно то
  // место, где вкладку закрывают, а сама по себе она ходов больше не даёт,
  // и следующая запись случилась бы неизвестно когда.
  if (U.running) run(); else { clearInterval(U.timer); keep(true); }
}

let seenProposals = 0;
export function watchProposals(): void {
  const pending = proposals.filter((p) => p.state === "pending").length;
  if (pending > seenProposals && U.running) togglePause();
  seenProposals = pending;
}

export function bindUI(): void {
  // el() отдаёт общий тип элемента управления, а тут нужен именно холст
  setCanvas(el("view") as unknown as HTMLCanvasElement);
  const dpr = window.devicePixelRatio || 1;
  cv.width = CW * dpr; cv.height = CH * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // экран -> координаты сцены (на карте ещё и через камеру)
  function scenePos(e: { clientX: number; clientY: number }): { x: number; y: number; } {
    const rect = cv.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width * CW, y = (e.clientY - rect.top) / rect.height * CH;
    if (U.view.mode === "map") { x = (x - cam.x) / cam.k; y = (y - cam.y) / cam.k; }
    // вид системы теперь тоже ужат под холст — переводим обратно, иначе клик
    // приходит мимо всего, что дальше середины
    else if (sysK !== 1) { x = (x - CW / 2) / sysK + CW / 2; y = (y - CH / 2) / sysK + CH / 2; }
    return { x:x, y:y };
  }

  let drag: { x: number; y: number; cx: number; cy: number } = null, moved = 0;
  cv.addEventListener("mousedown", (e: MouseEvent) => {
    if (U.view.mode !== "map") return;
    drag = { x:e.clientX, y:e.clientY, cx:cam.x, cy:cam.y }; moved = 0;
  });
  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (!drag) {
      // наведение на рейс на карте показывает его окошко
      if (U.view.mode !== "map") return;
      const p = scenePos(e); U.hover = null;
      hits.forEach((h) => {
        if (h.kind !== "cargo" && h.kind !== "jumpship") return;
        if (Math.abs(p.x - h.x) <= h.r && Math.abs(p.y - h.y) <= h.r) U.hover = h.data;
      });
      return;
    }
    const rect = cv.getBoundingClientRect();
    const sx = CW / rect.width, sy = CH / rect.height;
    const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    cam.x = drag.cx + dx; cam.y = drag.cy + dy;
  });
  window.addEventListener("mouseup", () => { setTimeout(() => { drag = null; }, 0); });

  // Зум ТОЛЬКО с зажатым Ctrl. Простое колесо обязано прокручивать страницу:
  // канвас занимает пол-экрана, и перехват колеса читается как зависание —
  // страница не едет, а карта визуально не меняется.
  cv.addEventListener("wheel", (e: WheelEvent) => {
    if (U.view.mode !== "map" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomAt(scenePos(e), e.deltaY < 0 ? 1.15 : 0.87);
  }, { passive:false });

  function zoomAt(p: { x: number; y: number }, mul: number): void {
    const k = clamp(cam.k * mul, 0.7, 4);
    // приближаем к точке под курсором, а не к углу канваса
    cam.x += p.x * (cam.k - k); cam.y += p.y * (cam.k - k);
    cam.k = k;
  }
  el("zin").addEventListener("click", () => { zoomAt({ x:CW/2, y:CH/2 }, 1.3); });
  el("zout").addEventListener("click", () => { zoomAt({ x:CW/2, y:CH/2 }, 0.77); });
  el("zfit").addEventListener("click", () => { resetCam(); });

  cv.addEventListener("dblclick", () => { resetCam(); });

  cv.addEventListener("click", (e: MouseEvent) => {
    if (moved > 4) { moved = 0; return; }          // это было перетаскивание
    const p = scenePos(e);
    let best: Hit = null, bd = 1e9;
    hits.forEach((h) => {
      const d = Math.sqrt((p.x - h.x) * (p.x - h.x) + (p.y - h.y) * (p.y - h.y));
      if (d <= h.r && d < bd) { bd = d; best = h; }
    });
    if (!best) return;
    if (best.kind === "sys" && U.view.mode === "map") { open(best.data.id); return; }
    U.pick = best; panels();
  });

  const sel = el("subfield");
  sel.innerHTML = allTech().map((f) => {
    return '<option value="' + f.key + '">' + (markOf(f.key) ? markName(f) : f.name) + '</option>';
  }).join("");
  sel.addEventListener("change", (e: Event) => { L.subKey = (e.target as Ctl).value; subhint(); saveLevers(); });

  el("tax").addEventListener("input", (e: Event) => {
    L.tax = +(e.target as Ctl).value / 100;
    el("taxval").textContent = Math.round(L.tax * 100) + "%"; taxhint(); saveLevers();
  });
  el("sub").addEventListener("input", (e: Event) => {
    L.subYear = +(e.target as Ctl).value; el("subval").textContent = L.subYear; subhint(); saveLevers();
  });
  el("pat").addEventListener("input", (e: Event) => {
    L.patTerm = +(e.target as Ctl).value; el("patval").textContent = L.patTerm + " лет";
    allTech().forEach((f) => { const p = patents[f.key]; if (p.owner >= 0 && Y() - p.since < L.patTerm) p.told = false; });
    pathint(); saveLevers();
  });
  el("fee").addEventListener("input", (e: Event) => {
    L.tradeFee = +(e.target as Ctl).value / 100;
    el("feeval").textContent = Math.round(L.tradeFee * 100) + "%"; feehint(); saveLevers();
  });
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
  const vv = window.visualViewport;
  if (vv) {
    // Пинч-зум — вторая беда того же корня: fixed раздувается вместе со
    // страницей, кнопка занимала пол-экрана и вылезала за левый край, потому
    // что left:50% — это середина СТРАНИЦЫ, а не видимого окошка. Отдаём в CSS
    // и обратный множитель зума, и границы видимой области.
    const fitPause = () => {
      const st = document.documentElement.style, seen = vv.height + vv.offsetTop;
      const gap = Math.max(document.documentElement.clientHeight - seen, window.innerHeight - seen, 0);
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
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    const tag = (e.target && (e.target as HTMLElement).tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    togglePause();
  });
  el("speed").addEventListener("click", () => {
    const ladder = [1, 2, 4, 10, 20];
    L.speed = ladder[(ladder.indexOf(L.speed) + 1) % ladder.length];
    // раньше здесь стояло this — та же кнопка, но из-за него обработчик не мог
    // стать стрелкой; у стрелки this чужой
    el("speed").textContent = "×" + L.speed; if (U.running) run(); saveLevers();
  });
  el("map").addEventListener("click", () => { U.view.mode = "map"; scene(); });
  el("tomap").addEventListener("click", () => { U.view.mode = "map"; scene(); });
  // «Заново» — это НОВАЯ партия, поэтому сид новый; чтобы повторить прежнюю,
  // достаточно вернуться по прежнему адресу
  el("reset").addEventListener("click", () => { fresh(); });
  el("badnew").addEventListener("click", () => { fresh(seedFromUrl()); });
  el("ventures").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest(".clickrow");
    if (row) open(+row.getAttribute("data-sys"));
  });
  el("proposals").addEventListener("click", (e: Event) => {
    const b = (e.target as HTMLElement).closest(".decide") as HTMLElement;
    if (!b) return;
    decideById(+b.getAttribute("data-prop"), b.getAttribute("data-ok") === "1");
    panels();
  });
  el("worlds").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest(".clickrow");
    if (!row) return;
    const w = worlds[+row.getAttribute("data-world")];
    U.view = { mode:"system", sys:w.sys };
    U.pick = { kind:"body", data:w.body };
    scene();
  });

  Array.prototype.forEach.call(document.querySelectorAll("canvas.ikon"), (c) => {
    icon(c.getContext("2d"), c.getAttribute("data-kind"), 11, 10, 8, "#8894ae");
  });

  // Смена якоря в адресе НЕ перезагружает страницу, поэтому вручную вписанный
  // сид иначе не сработал бы: пришлось бы догадаться нажать F5. Сверяем с
  // текущим, чтобы собственная запись адреса не вызвала пересборку по кругу.
  if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
    const want = seedFromUrl();
    if (want === undefined || want === seedOf()) return;
    // Вписанный руками сид — это заказ на другую партию, то же самое, что
    // «Заново» с номером: прежняя кончилась, и отложенная вместе с ней.
    fresh(want);
  });

  // Вкладку прячут чаще, чем закрывают: на телефоне это любое переключение
  // приложения, и именно там теряется последнее. pagehide — единственное
  // событие, на которое можно рассчитывать в мобильном сафари.
  window.addEventListener("pagehide", () => { keep(true); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keep(true); });

  loadLevers(); syncControls();
  start();
}

// Общее окончание запуска: и у развёрнутой партии, и у собранной заново.
// Рычаги сюда попадают из сохранения, поэтому ползунки синхронизируются
// ПОСЛЕ, а не до: иначе на экране стояли бы прошлые числа.
function live(): void {
  seedToUrl(); syncControls(); scene(); taxhint(); subhint(); pathint(); feehint();
  // Предложения, с которыми партия пришла, уже виденные: иначе первый же ход
  // после разворачивания встал бы на паузу из-за решения, принятого вчера.
  seenProposals = proposals.filter((p) => p.state === "pending").length;
  if (U.running) run();
}

let framing = false;
function start(): void {
  const want = seedFromUrl();
  let on = false;
  try { on = resume(); }
  catch (e) {
    // Сохранение чужое. Партия НЕ собирается и не запускается: собрать новую
    // значило бы затереть чужую следующей же записью, а игрок, может быть,
    // просто открыл файл другой сборки и вернётся к прежней. Решает он.
    hold(); showBad(e as Error & { why?: string });
    return;
  }
  // Ссылка с сидом сильнее отложенной партии: по ней пришли за конкретной
  // партией, и разворачивать вместо неё свою было бы подменой. Отложенная при
  // этом теряется — сохранение в игре одно, и это его цена.
  if (!on || (want !== undefined && want !== seedOf())) build(undefined, want);
  live();
  if (!framing) { framing = true; requestAnimationFrame(frame); }
}

/** Новая партия по кнопке: прежней больше нет, поэтому и отложенная стирается
 *  — иначе следующий запуск развернул бы её поверх новой. */
function fresh(seed?: number): void {
  drop();
  el("badsave").hidden = true;
  lock(false);
  build(undefined, seed);
  live();
  if (!framing) { framing = true; requestAnimationFrame(frame); }
}

// Пока полоса висит, партии НЕТ вовсе — ни миров, ни рынка. Управление при
// этом выглядит рабочим и им можно пользоваться: «Пуск» запустил бы ходы по
// пустому состоянию, а ползунок патента полез бы в пустую таблицу патентов.
// Поэтому всё, что трогает партию, на это время заперто; «Заново» — нет, это
// единственный выход отсюда.
const LOCKED = ["play", "speed", "map", "tomap", "zin", "zout", "zfit",
                "tax", "sub", "pat", "fee", "subfield"];
function lock(on: boolean): void { LOCKED.forEach((id) => { el(id).disabled = on; }); }

/** Полоса во всю ширину вместо игры. Громко — и нарочно: молчаливое
 *  «начали новую партию» выглядело бы как пропавшая империя. */
function showBad(e: Error & { why?: string }): void {
  console.error(e.message + (e.why ? ": " + e.why : ""));
  lock(true);
  el("badwhy").textContent = "Отложенная партия сделана другой сборкой игры" +
    (e.why ? " (" + e.why + ")" : "") + ": продолжить её нечем. " +
    "Можно открыть прежнюю сборку и доиграть там — сохранение цело, пока не нажата кнопка.";
  el("badsave").hidden = false;
}


// Стенд запускает ядро без браузера: см. test/. Отдаём только чтение
