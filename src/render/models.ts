// ===================== сцена: примитивы и модельки =====================
//
// Здесь всё, что умеет нарисовать одну вещь: силуэт корабля, астероид, рамку
// с подписью. Кто и когда это зовёт — в scene.ts. Разделено потому, что
// модельки нужны ещё и панелям (значки в легенде рисуются ими же).

import { vis } from "../clock";
import { compOf } from "../data";
import { dockValue } from "../docks";
import { realmCharge, realmColor } from "../realm";
import { corps, systems } from "../state";
import { Build, Dock, Part, Ship, Shipyard, Sys, Voyage } from "../types";
import { clamp } from "../util";
import { CH, CW, cx, getCx, glow, setCx, uiz } from "./canvas";

export function posOf(o: { ang: number; r: number }, mx: number, my: number): { x: number; y: number; } { return { x:mx + Math.cos(o.ang) * o.r, y:my + Math.sin(o.ang) * o.r }; }

// ---- модельки кораблей ------------------------------------------------
// Один силуэт на ТИП корабля; между компаниями он не меняется, различает их
// только цвет. Это прямое продолжение правила из журнала: форма отвечает на
// "что это", цвет — на "чьё это". Рисуется в поле восьми единиц, нос смотрит
// вверх (вызывающий код доворачивает на atan2 + 90 градусов).
export function poly(pts: number[]): void {
  cx.beginPath();
  for (let i = 0; i < pts.length; i += 2) i ? cx.lineTo(pts[i], pts[i+1]) : cx.moveTo(pts[i], pts[i+1]);
  cx.closePath(); cx.fill();
}
// Огонёк за кормой. Дрожит по glow, чтобы корабль читался живым, а не
// штампом; рисуется ДО корпуса, чтобы корпус его перекрывал.
export function flame(x: number, y: number, s: number, rot: number): void {
  cx.save();
  cx.translate(x, y); cx.rotate(rot || 0); cx.scale(s / 8, s / 8);
  const flick = 1 + Math.sin(glow * 23 + x * 0.7 + y * 0.3) * 0.28;
  const len = 9 * flick;
  cx.globalAlpha = 0.55;
  cx.fillStyle = "#ff8b3d";
  cx.beginPath(); cx.moveTo(-2.6, 5.2); cx.lineTo(0, 5.2 + len); cx.lineTo(2.6, 5.2); cx.closePath(); cx.fill();
  cx.globalAlpha = 0.85;
  cx.fillStyle = "#ffe08a";
  cx.beginPath(); cx.moveTo(-1.2, 5.2); cx.lineTo(0, 5.2 + len * 0.55); cx.lineTo(1.2, 5.2); cx.closePath(); cx.fill();
  cx.restore();
}
// Прыжок под движками. Корабль у края системы не просто сжимается в точку:
// перед ним раскрывается дыра в пространстве — тёмный провал с ярким ободом
// и волнами вокруг, — а сам он вытягивается к ней, как будто его втягивает.
// k — раскрытие, 0..1.
export function rift(x: number, y: number, r: number, k: number): void {
  if (k <= 0.01) return;
  const rr = r * (0.25 + 0.75 * k) * uiz;
  cx.save();
  const g = cx.createRadialGradient(x, y, 0, x, y, rr);
  g.addColorStop(0, "#02040a"); g.addColorStop(0.72, "rgba(2,4,10,0.95)"); g.addColorStop(1, "rgba(154,168,255,0)");
  cx.beginPath(); cx.arc(x, y, rr, 0, 6.2832); cx.fillStyle = g; cx.fill();
  cx.beginPath(); cx.arc(x, y, rr * 0.86, 0, 6.2832);
  cx.strokeStyle = "#b9c3ff"; cx.globalAlpha = k * (0.55 + 0.35 * Math.sin(glow * 9 + x)); cx.lineWidth = 1.4 * uiz; cx.stroke();
  // искажение вокруг: волны пространства расходятся и тают
  for (let q = 1; q <= 3; q++) {
    const ph = (glow * 0.9 + q / 3) % 1;
    cx.beginPath(); cx.arc(x, y, rr * (1 + ph * 1.6), 0, 6.2832);
    cx.strokeStyle = "#9aa8ff"; cx.globalAlpha = k * 0.25 * (1 - ph); cx.lineWidth = uiz; cx.stroke();
  }
  cx.restore();
}
// Корабль, которого тянет в дыру: вытянут вдоль курса, сжат поперёк, дрожит и
// тускнеет. k — сила искажения, 0..1; при нуле это обычный корабль с факелом.
export function warped(kind: string, x: number, y: number, s: number, rot: number, col: string, k: number): void {
  cx.save();
  cx.translate(x, y); cx.rotate(rot || 0);
  cx.scale(1 - k * 0.4, 1 + k * 1.1);
  cx.translate(Math.sin(glow * 31 + x) * k * 0.9, 0);
  cx.globalAlpha = 1 - k * 0.4;
  flame(0, 0, s, 0); ship(kind, 0, 0, s, 0, col);
  cx.restore();
}
// Взлёт и посадка одной формулой. Корабль не возникает и не пропадает
// целиком: на первой доле пути он вырастает из точки у планеты, на последней
// сжимается обратно в точку у цели. Так видно, ОТКУДА он вышел и КУДА делся,
// а не "моргнул" посреди пустоты. out/back — доли пути на рост и на сжатие;
// ноль означает "с этого конца не анимировать" (корабль там уходит за край).
export function grow(k: number, out?: number, back?: number): number {
  const a = out === undefined ? 0.2 : out, b = back === undefined ? 0.2 : back;
  return Math.min(a > 0 ? clamp(k / a, 0, 1) : 1, b > 0 ? clamp((1 - k) / b, 0, 1) : 1);
}
// Окошко с подписью, которое тащится за кораблём. Рейсы идут годами, и весь
// смысл долгого полёта в том, чтобы захотелось посмотреть: кто летит, куда,
// с чем и сколько ещё. Первая строка — кто и что, вторая — куда и когда.
export function caption(x: number, y: number, lines: string[], col: string): void {
  cx.save();
  cx.font = "500 " + (9.5 * uiz) + "px system-ui, sans-serif";
  let w = 0;
  lines.forEach((l) => { w = Math.max(w, cx.measureText(l).width); });
  const pad = 5 * uiz, h = lines.length * 12 * uiz + pad * 2 - 2 * uiz, bw = w + pad * 2;
  // Границы экрана в координатах карты: при зуме видно CW/cam.k на CH/cam.k,
  // то есть ровно CW*uiz на CH*uiz, — иначе окошко прижималось бы к краю
  // ГАЛАКТИКИ, а не к краю вида.
  let bx = x + 14 * uiz, by = clamp(y - h / 2, 4 * uiz, CH * uiz - h - 4 * uiz);
  if (bx + bw > CW * uiz - 4 * uiz) bx = x - 14 * uiz - bw;   // не вылезать за правый край
  cx.beginPath(); cx.moveTo(x + 6 * uiz, y); cx.lineTo(bx < x ? bx + bw : bx, y);
  cx.strokeStyle = col; cx.globalAlpha = 0.5; cx.lineWidth = uiz; cx.stroke(); cx.globalAlpha = 1;
  cx.fillStyle = "rgba(11,17,32,0.88)"; cx.fillRect(bx, by, bw, h);
  cx.strokeStyle = col; cx.globalAlpha = 0.7; cx.strokeRect(bx + 0.5 * uiz, by + 0.5 * uiz, bw - uiz, h - uiz); cx.globalAlpha = 1;
  cx.textAlign = "left"; cx.textBaseline = "top";
  lines.forEach((l, i) => {
    cx.fillStyle = i ? "#8894ae" : "#e4e9f4";
    cx.fillText(l, bx + pad, by + pad - uiz + i * 12 * uiz);
  });
  cx.restore();
}
export function eta(t: number, dur: number): string {
  const m = Math.max(0, Math.round((1 - clamp(t, 0, 1)) * dur)), yr = Math.floor(m / 12), mo = m % 12;
  return "ещё " + (yr ? yr + " г. " : "") + mo + " мес.";
}
export function shipLines(sh: Ship): string[] {              // корабль внутри системы
  const who = corps[sh.corp].name;
  if (sh.kind === "colony") return ["Колониальный модуль · " + who, "→ " + sh.body.name + " · " + eta(sh.t, sh.dur)];
  return ["Платформа · " + who, "→ " + sh.dest.label + " · " + eta(sh.t, sh.dur)];
}
// Перегон везёт не тонны, а другой корабль. Слово для него одно и то же и в
// подписи на карте, и в панели, и внутри системы (shipLines): одна вещь не
// должна называться в трёх местах по-разному.
export function cargoName(v: Voyage): string {
  return v.cargo === "colony" ? "Колониальный модуль"
       : v.cargo === "mine"   ? "Платформа"
       : v.cargo === "gate"   ? "Портальный корабль"
       :                        "Прыжковый корабль";
}
export function voyageLines(v: Voyage): string[] {             // рейс между звёздами или между мирами
  if (v.kind === "jump" || v.kind === "gate")
    return [(v.kind === "gate" ? (v.upgrade ? "Портальный, переделка · " : "Портальный · ") : "Прыжковый · ") + corps[v.corp].name,
            "→ " + systems[v.to].name + " · " + eta(v.t, v.dur)];
  if (v.kind === "parts")
    return ["Грузовик · " + compOf(v.k).name.toLowerCase() + " для " + corps[v.forCorp].name,
            systems[v.sysFrom].name + " → " + systems[v.to].name + " · " + eta(v.t, v.dur)];
  if (v.kind === "food")
    return ["Хлебовоз · " + v.qty + " еды" + (v.relief !== undefined ? " · помощь от " + corps[v.relief].name : ""),
            v.from.body.name + " → " + v.to.body.name + " · " + eta(v.t, v.dur)];
  // Перегон готового корабля и уход прыжкового к точке старта. У обоих нет ни
  // груза в тоннах, ни миров на концах — только системы, и оба доезжали до
  // хвоста функции, где v.qty.toFixed роняло кадр: карта переставала
  // рисоваться, а вместе с ней вставала и партия.
  if (v.kind === "ferry" || v.kind === "reloc")
    return [cargoName(v) + (v.kind === "reloc" ? " · к точке старта · " : " · перегон · ") + corps[v.corp].name,
            systems[v.sysFrom].name + " → " + systems[v.to].name + " · " + eta(v.t, v.dur)];
  if (v.kind === "pops")
    return ["Переселенцы · " + v.qty.toFixed(1) + " чел.", v.from.body.name + " → " + v.to.body.name + " · " + eta(v.t, v.dur)];
  return ["Рейс · " + v.kind, eta(v.t, v.dur)];     // незнакомый вид рейса подписывается, а не роняет кадр
}
// Без клика — только имя командира, мелко и тускло. Полное окно с деталями
// и их изготовителями тащится за кораблём лишь после клика по нему: карта с
// окошками у всех превращалась в кашу, а имя узнаётся и на 8 пикселях.
export function tiny(x: number, y: number, text: string, col: string): void {
  cx.save();
  cx.font = "500 " + (8 * uiz) + "px system-ui, sans-serif"; cx.textAlign = "left"; cx.textBaseline = "middle";
  cx.fillStyle = col; cx.globalAlpha = 0.75;
  cx.fillText(text, x + 9 * uiz, y + uiz);
  cx.restore();
}
// строки полного окна: кто и что, куда и когда, командир, изготовители деталей
export function makersOfParts(parts: Part[], ownerId: number): string[] {
  const by: Record<string, number> = {};
  (parts || []).forEach((p) => { const k = p.k + "|" + p.from; by[k] = (by[k] || 0) + 1; });
  return Object.keys(by).map((k) => {
    const bits = k.split("|"), f = compOf(bits[0]), from = corps[+bits[1]];
    return f.short + (by[k] > 1 ? " ×" + by[k] : "") + " — " + (+bits[1] === ownerId ? "своё" : from.name);
  });
}
export function dockLines(d: Dock): string[] {
  const owner = d.corp >= 0 ? corps[d.corp].name : "правительство " + (d.gov ? d.gov.body.name : "?");
  let lines = [(d.kind === "liner" ? "Переселенческий" : "Грузовик") + " · на стоянке у " + d.world.body.name,
               "хозяин: " + owner + " · цена " + Math.round(dockValue(d)),
               "командир " + d.captain];
  const mk = makersOfParts(d.parts, d.corp);
  if (mk.length) lines = lines.concat(["из чего собран:"]).concat(mk);
  return lines;
}
// Одно окошко на корабль в системе и на рейс между звёздами: сверху разное,
// снизу одинаковое (командир и из чего собран). Что именно пришло, говорит
// isVoyage — поэтому приведение здесь не догадка, а разбор по этому признаку.
/** Где верфь на экране: своя орбита вокруг своей планеты, медленнее стоянок.
 *  Нужна и отрисовке, и движению — корабль должен выходить ОТСЮДА. */
export function yardPos(y: Shipyard, mx: number, my: number): { x: number; y: number } {
  const p = posOf(y.world.body, mx, my), off = y.world.body.rad + 34;
  const a = y.ang + glow * 0.12;
  return { x: p.x + Math.cos(a) * off, y: p.y + Math.sin(a) * off };
}

/** Кому и куда пойдёт эта сборка. Одна фраза на все виды кораблей: в очереди
 *  из пяти позиций «Артель · грузовик» ничего не отвечает на главный вопрос —
 *  зачем он строится. У транспорта это хозяин (компания или казна мира), у
 *  остальных — цель, к которой он уйдёт со стапеля. */
export function buildAim(b: Build): string {
  if (b.vt.key === "cargo" || b.vt.key === "liner")
    return b.forCorp !== undefined ? "для " + corps[b.forCorp].name
         : "для казны " + (b.forWorld ? b.forWorld.body.name : "мира");
  if (b.body) return "курс на " + b.body.name;
  if (b.dest) return "курс на " + b.dest.label;
  if (b.to !== undefined) return "курс на " + systems[b.to].name;
  if (b.dst !== undefined) return "перегон в " + systems[b.dst].name;
  return "";
}

/** Готовность позиции, 0..1. Держится в одном месте потому, что её считают
 *  трижды: в окошке у верфи, в панели и в списке дел системы. */
export function buildDone(b: Build): number { return clamp(1 - Math.max(0, b.left) / Math.max(1, b.total), 0, 1); }

/** Что с позицией происходит прямо сейчас. Готовый корабль без топлива стоит
 *  у стапеля и НЕ держит очередь (motion), и по одной готовности этого не
 *  видно: 100% и «уже улетел» выглядят одинаково. */
export function buildState(b: Build, first: boolean): string {
  if (b.left > 0) return first ? "на стапеле" : "ждёт очереди";
  return b.fuelWait ? "готов, без топлива " + b.fuelWait + " мес." : "готов";
}

/** Через сколько месяцев сойдёт со стапеля каждая позиция очереди. Руки идут
 *  ПЕРВОЙ недостроенной сборке, поэтому третья ждёт ещё и первые две — без
 *  этой суммы «в очереди четыре» не отличает пять лет от пятидесяти.
 *  null — рук на стапеле нет вовсе, и очередь не двигается. */
export function queueEta(y: Shipyard): (number | null)[] {
  let acc = 0;
  return y.queue.map((b) => {
    acc += Math.max(0, b.left);
    return y.crew > 0 ? Math.ceil(acc / y.crew) : null;
  });
}

/** Строки окошка верфи: кто хозяин, руки, и вся очередь по порядку. Раньше
 *  показывалась только голова и число «ждут следом», то есть посмотреть
 *  очередь было нельзя нигде: кто стоит вторым и когда дойдёт — не узнать. */
export function yardLines(y: Shipyard): string[] {
  const out = [y.owner >= 0 ? "верфь «" + corps[y.owner].name + "»" : "верфь, общая"];
  out.push("людей на стапеле " + y.crew.toFixed(1));
  if (!y.queue.length) { out.push("очередь пуста"); return out; }
  const eta = queueEta(y);
  // В окошко на сцене лезет немного строк, поэтому здесь первые четыре, а
  // полная очередь с составом деталей — в панели справа.
  y.queue.slice(0, 4).forEach((b, i) => {
    out.push((i + 1) + ". " + corps[b.lead].name + " · " + b.vt.name + " · " +
             Math.round(buildDone(b) * 100) + "%" +
             (eta[i] === null ? "" : " · " + eta[i] + " мес."));
  });
  if (y.queue.length > 4) out.push("и ещё " + (y.queue.length - 4) + " в очереди");
  return out;
}

export function windowLines(o: Ship | Voyage, isVoyage: boolean): string[] {
  const v = o as Voyage, sh = o as Ship;
  const head = isVoyage ? voyageLines(v) : shipLines(sh);
  const owner = isVoyage ? (v.forCorp !== undefined ? v.forCorp : v.corp) : sh.corp;
  let lines = head.concat(["командир " + o.captain]);
  if (isVoyage && v.kind === "parts") lines.push("везёт: " + compOf(v.k).short + " — " + corps[v.corp].name);
  const mk = makersOfParts(o.parts, owner);
  if (mk.length) lines = lines.concat(["из чего собран:"]).concat(mk);
  return lines;
}
export function ship(kind: string, x: number, y: number, s: number, rot: number, col: string): void {
  cx.save();
  cx.translate(x, y); cx.rotate(rot || 0); cx.scale(s / 8, s / 8);
  cx.fillStyle = col; cx.lineJoin = "round";
  if (kind === "jump") {
    // стреловидный: длинный нос, отогнутые крылья, вырез под дюзы
    poly([0,-9, 2.1,-1.5, 6.6,4.6, 2.4,3.4, 0,6.2, -2.4,3.4, -6.6,4.6, -2.1,-1.5]);
    cx.fillStyle = "#0b1120"; poly([0,-5.4, 1.1,-1.8, 0,-0.6, -1.1,-1.8]);   // фонарь
  } else if (kind === "mine") {
    // буровая платформа: два бура вперёд, тяжёлое основание
    poly([-3.4,-1.6, -2.2,-8.4, -1.1,-8.4, -1.5,-1.6]);
    poly([3.4,-1.6, 2.2,-8.4, 1.1,-8.4, 1.5,-1.6]);
    poly([-4.2,-2.2, 4.2,-2.2, 5.2,3.2, -5.2,3.2]);
    poly([-6.4,3.2, 6.4,3.2, 6.4,5.6, -6.4,5.6]);
    cx.fillStyle = "#0b1120"; poly([-2,-0.8, 2,-0.8, 2,1.8, -2,1.8]);
  } else if (kind === "colony") {
    // колониальный модуль: капсула с юбкой посадочного узла
    cx.beginPath(); cx.moveTo(0,-8.4);
    cx.bezierCurveTo(3.6,-6.2, 4,0.4, 3,3.4);
    cx.lineTo(-3,3.4);
    cx.bezierCurveTo(-4,0.4, -3.6,-6.2, 0,-8.4);
    cx.closePath(); cx.fill();
    poly([-5.6,3.4, 5.6,3.4, 4.4,6.4, -4.4,6.4]);
    cx.fillStyle = "#0b1120"; cx.beginPath(); cx.arc(0, -3.2, 1.7, 0, 6.2832); cx.fill();
  } else {
    // грузовик: коробчатый корпус с контейнерами по бортам
    poly([0,-8.4, 2.8,-4.6, -2.8,-4.6]);
    poly([-2.8,-4.6, 2.8,-4.6, 2.8,5.4, -2.8,5.4]);
    poly([-6.2,-2.2, -3.4,-2.2, -3.4,4.2, -6.2,4.2]);
    poly([3.4,-2.2, 6.2,-2.2, 6.2,4.2, 3.4,4.2]);
    cx.fillStyle = "#0b1120"; poly([-1.6,-3.4, 1.6,-3.4, 1.6,-1.4, -1.6,-1.4]);
  }
  cx.restore();
}
// Пятиконечная звёздочка — знак столицы, и больше ничей. Форма отвечает на
// «что это» (см. журнал), поэтому звезда нужна ровно одна на всю галактику: та
// планета, с которой всё началось, и та система, где она лежит. Рисуется через
// две окружности вершин — внешнюю и внутреннюю, — чтобы луч не зависел от
// размера и читался и на 4 пикселях в системе, и на карте под зумом.
export function star(x: number, y: number, rad: number, col: string): void {
  cx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -1.5708 + i * 0.6283, rr = rad * (i % 2 ? 0.42 : 1);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? cx.lineTo(px, py) : cx.moveTo(px, py);
  }
  cx.closePath(); cx.fillStyle = col; cx.fill();
}
// Герб государства: щит с фигурой. Ось опознания здесь та же, что у кораблей,
// только на этаж выше: ЦВЕТ щита говорит, чья это контора, ФИГУРА — какое это
// государство. Родное носит звезду — тот же знак, что столица, и он же
// объясняет, почему звезда в игре одна: она была гербом ещё до того, как
// появилось второе государство. Отделившимся достаётся одна из шести фигур по
// очереди появления; седьмое государство берёт первую фигуру снова, но у него
// уже другой цвет.
//
// Рисуется в поле восьми единиц по ширине, как корпус корабля, и ужимается
// множителем r: щит обязан читаться и на шести пикселях над планетой, и на
// четырёх над корабликом, поэтому фигуры крупные и без мелких деталей.
export function crest(x: number, y: number, r: number, realm: number): void {
  const col = realmColor(realm), ch = realmCharge(realm);
  cx.save();
  cx.translate(x, y); cx.scale(r / 4, r / 4);
  cx.beginPath();
  cx.moveTo(-4, -5); cx.lineTo(4, -5); cx.lineTo(4, 1.4);
  // Низ нарочно ШИРОКИЙ и почти без острия. Настоящий геральдический щит
  // сходится в точку, но на двенадцати пикселях обводка с двух сторон
  // схлопывается там в сплошную каплю, и вместо щита выходит кубок на ножке.
  cx.quadraticCurveTo(4, 5, 0, 5.4);
  cx.quadraticCurveTo(-4, 5, -4, 1.4);
  cx.closePath();
  cx.fillStyle = "rgba(8,13,25,0.88)"; cx.fill();
  cx.strokeStyle = col; cx.lineWidth = 0.95; cx.lineJoin = "round"; cx.lineCap = "round"; cx.stroke();
  cx.fillStyle = col;
  if (ch === 1) poly([-3.1,-1.5, 3.1,-1.5, 3.1,1.1, -3.1,1.1]);                  // пояс
  else if (ch === 2) poly([-1.3,-4.1, 1.3,-4.1, 1.3,3.4, -1.3,3.4]);             // столб
  else if (ch === 3) {                                                            // косой крест
    cx.beginPath();
    cx.moveTo(-2.7,-3.5); cx.lineTo(2.7,2.3); cx.moveTo(2.7,-3.5); cx.lineTo(-2.7,2.3);
    cx.lineWidth = 1.5; cx.stroke();
  }
  else if (ch === 4) poly([0,-3.6, 3.3,0.3, 1.5,0.3, 0,-1.5, -1.5,0.3, -3.3,0.3]);  // шеврон
  else if (ch === 5) {                                                            // кольцо
    cx.beginPath(); cx.arc(0, -0.6, 2.3, 0, 6.2832); cx.lineWidth = 1.5; cx.stroke();
  }
  else if (ch === 6) poly([0,-3.9, 2.7,-0.4, 0,3.1, -2.7,-0.4]);                  // ромб
  else star(0, -0.4, 2.8, col);                                                   // родное государство
  cx.restore();
}
export function rock(x: number, y: number, rad: number, seed: number, col: string): void {
  cx.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.2832, rr = rad * (0.74 + 0.36 * Math.abs(Math.sin(seed + i * 2.3)));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? cx.lineTo(px, py) : cx.moveTo(px, py);
  }
  cx.closePath(); cx.fillStyle = col; cx.fill();
}

export function advance(s: Sys, dt: number): void {
  if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - dt * 0.5);
  const mx = CW/2, my = CH/2;
  s.ships.forEach((sh) => {
    // Корабль выходит С ВЕРФИ, на которой собран. Раньше все стартовали от
    // s.bodies[0] — первой планеты в списке, безо всякой причины: выглядело так,
    // будто их отпускает случайная планета, а не стапель.
    const op = sh.yard ? yardPos(sh.yard, mx, my) : posOf(s.bodies[0], mx, my);
    const tp = posOf(sh.kind === "colony" ? sh.body : sh.dest.ref, mx, my);
    const k = clamp(vis(sh), 0, 1), e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2;
    sh.x = op.x + (tp.x - op.x) * e; sh.y = op.y + (tp.y - op.y) * e;
    sh.ang = Math.atan2(tp.y - op.y, tp.x - op.x) + 1.5708;
    const tl = sh.trail, lp = tl[tl.length - 1];
    if (!lp || Math.abs(lp.x - sh.x) + Math.abs(lp.y - sh.y) > 1.5) {
      tl.push({ x:sh.x, y:sh.y }); if (tl.length > 40) tl.shift();
    }
  });
}


// Нарисовать модельку в ЧУЖОЙ контекст: ею красится легенда в панели, ею же
// её отдают наружу через THRESHOLD.icon. Контекст подменяется на время вызова
// и возвращается обратно — иначе следующий кадр рисовал бы в значок.
export function icon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number, col: string): void {
  const keep = getCx();
  setCx(ctx); ship(kind, x, y, s, 0, col); setCx(keep);
}
