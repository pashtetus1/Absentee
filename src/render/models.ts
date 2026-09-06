// ===================== сцена: примитивы и модельки =====================
//
// Здесь всё, что умеет нарисовать одну вещь: силуэт корабля, астероид, рамку
// с подписью. Кто и когда это зовёт — в scene.ts. Разделено потому, что
// модельки нужны ещё и панелям (значки в легенде рисуются ими же).

import { CH, CW, cx, getCx, glow, setCx, uiz } from "./canvas";
import { clamp } from "../util";
import { corps, systems } from "../state";
import { compOf } from "../data";
import { dockValue } from "../docks";
import { vis } from "../clock";

export function posOf(o, mx, my) { return { x:mx + Math.cos(o.ang) * o.r, y:my + Math.sin(o.ang) * o.r }; }

// ---- модельки кораблей ------------------------------------------------
// Один силуэт на ТИП корабля; между компаниями он не меняется, различает их
// только цвет. Это прямое продолжение правила из журнала: форма отвечает на
// "что это", цвет — на "чьё это". Рисуется в поле восьми единиц, нос смотрит
// вверх (вызывающий код доворачивает на atan2 + 90 градусов).
export function poly(pts) {
  cx.beginPath();
  for (var i = 0; i < pts.length; i += 2) i ? cx.lineTo(pts[i], pts[i+1]) : cx.moveTo(pts[i], pts[i+1]);
  cx.closePath(); cx.fill();
}
// Огонёк за кормой. Дрожит по glow, чтобы корабль читался живым, а не
// штампом; рисуется ДО корпуса, чтобы корпус его перекрывал.
export function flame(x, y, s, rot) {
  cx.save();
  cx.translate(x, y); cx.rotate(rot || 0); cx.scale(s / 8, s / 8);
  var flick = 1 + Math.sin(glow * 23 + x * 0.7 + y * 0.3) * 0.28;
  var len = 9 * flick;
  cx.globalAlpha = 0.55;
  cx.fillStyle = "#ff8b3d";
  cx.beginPath(); cx.moveTo(-2.6, 5.2); cx.lineTo(0, 5.2 + len); cx.lineTo(2.6, 5.2); cx.closePath(); cx.fill();
  cx.globalAlpha = 0.85;
  cx.fillStyle = "#ffe08a";
  cx.beginPath(); cx.moveTo(-1.2, 5.2); cx.lineTo(0, 5.2 + len * 0.55); cx.lineTo(1.2, 5.2); cx.closePath(); cx.fill();
  cx.restore();
}
// Взлёт и посадка одной формулой. Корабль не возникает и не пропадает
// целиком: на первой доле пути он вырастает из точки у планеты, на последней
// сжимается обратно в точку у цели. Так видно, ОТКУДА он вышел и КУДА делся,
// а не "моргнул" посреди пустоты. out/back — доли пути на рост и на сжатие;
// ноль означает "с этого конца не анимировать" (корабль там уходит за край).
export function grow(k, out, back) {
  var a = out === undefined ? 0.2 : out, b = back === undefined ? 0.2 : back;
  return Math.min(a > 0 ? clamp(k / a, 0, 1) : 1, b > 0 ? clamp((1 - k) / b, 0, 1) : 1);
}
// Окошко с подписью, которое тащится за кораблём. Рейсы идут годами, и весь
// смысл долгого полёта в том, чтобы захотелось посмотреть: кто летит, куда,
// с чем и сколько ещё. Первая строка — кто и что, вторая — куда и когда.
export function caption(x, y, lines, col) {
  cx.save();
  cx.font = "500 " + (9.5 * uiz) + "px system-ui, sans-serif";
  var w = 0;
  lines.forEach(function (l) { w = Math.max(w, cx.measureText(l).width); });
  var pad = 5 * uiz, h = lines.length * 12 * uiz + pad * 2 - 2 * uiz, bw = w + pad * 2;
  // Границы экрана в координатах карты: при зуме видно CW/cam.k на CH/cam.k,
  // то есть ровно CW*uiz на CH*uiz, — иначе окошко прижималось бы к краю
  // ГАЛАКТИКИ, а не к краю вида.
  var bx = x + 14 * uiz, by = clamp(y - h / 2, 4 * uiz, CH * uiz - h - 4 * uiz);
  if (bx + bw > CW * uiz - 4 * uiz) bx = x - 14 * uiz - bw;   // не вылезать за правый край
  cx.beginPath(); cx.moveTo(x + 6 * uiz, y); cx.lineTo(bx < x ? bx + bw : bx, y);
  cx.strokeStyle = col; cx.globalAlpha = 0.5; cx.lineWidth = uiz; cx.stroke(); cx.globalAlpha = 1;
  cx.fillStyle = "rgba(11,17,32,0.88)"; cx.fillRect(bx, by, bw, h);
  cx.strokeStyle = col; cx.globalAlpha = 0.7; cx.strokeRect(bx + 0.5 * uiz, by + 0.5 * uiz, bw - uiz, h - uiz); cx.globalAlpha = 1;
  cx.textAlign = "left"; cx.textBaseline = "top";
  lines.forEach(function (l, i) {
    cx.fillStyle = i ? "#8894ae" : "#e4e9f4";
    cx.fillText(l, bx + pad, by + pad - uiz + i * 12 * uiz);
  });
  cx.restore();
}
export function eta(t, dur) {
  var m = Math.max(0, Math.round((1 - clamp(t, 0, 1)) * dur)), yr = Math.floor(m / 12), mo = m % 12;
  return "ещё " + (yr ? yr + " г. " : "") + mo + " мес.";
}
export function shipLines(sh) {              // корабль внутри системы
  var who = corps[sh.corp].name;
  if (sh.kind === "colony") return ["Колониальный модуль · " + who, "→ " + sh.body.name + " · " + eta(sh.t, sh.dur)];
  return ["Платформа · " + who, "→ " + sh.dest.label + " · " + eta(sh.t, sh.dur)];
}
export function voyageLines(v) {             // рейс между звёздами или между мирами
  if (v.kind === "jump" || v.kind === "opener")
    return [(v.kind === "opener" ? "Открыватель · " : "Прыжковый · ") + corps[v.corp].name,
            "→ " + systems[v.to].name + " · " + eta(v.t, v.dur)];
  if (v.kind === "parts")
    return ["Грузовик · " + compOf(v.k).name.toLowerCase() + " для " + corps[v.forCorp].name,
            systems[v.sysFrom].name + " → " + systems[v.to].name + " · " + eta(v.t, v.dur)];
  if (v.kind === "food")
    return ["Хлебовоз · " + v.qty + " еды" + (v.relief !== undefined ? " · помощь от " + corps[v.relief].name : ""),
            v.from.body.name + " → " + v.to.body.name + " · " + eta(v.t, v.dur)];
  return ["Переселенцы · " + v.qty.toFixed(1) + " чел.", v.from.body.name + " → " + v.to.body.name + " · " + eta(v.t, v.dur)];
}
// Без клика — только имя командира, мелко и тускло. Полное окно с деталями
// и их изготовителями тащится за кораблём лишь после клика по нему: карта с
// окошками у всех превращалась в кашу, а имя узнаётся и на 8 пикселях.
export function tiny(x, y, text, col) {
  cx.save();
  cx.font = "500 " + (8 * uiz) + "px system-ui, sans-serif"; cx.textAlign = "left"; cx.textBaseline = "middle";
  cx.fillStyle = col; cx.globalAlpha = 0.75;
  cx.fillText(text, x + 9 * uiz, y + uiz);
  cx.restore();
}
// строки полного окна: кто и что, куда и когда, командир, изготовители деталей
export function makersOfParts(parts, ownerId) {
  var by = {};
  (parts || []).forEach(function (p) { var k = p.k + "|" + p.from; by[k] = (by[k] || 0) + 1; });
  return Object.keys(by).map(function (k) {
    var bits = k.split("|"), f = compOf(bits[0]), from = corps[+bits[1]];
    return f.short + (by[k] > 1 ? " ×" + by[k] : "") + " — " + (+bits[1] === ownerId ? "своё" : from.name);
  });
}
export function dockLines(d) {
  var owner = d.corp >= 0 ? corps[d.corp].name : "правительство " + (d.gov ? d.gov.body.name : "?");
  var lines = [(d.kind === "liner" ? "Переселенческий" : "Грузовик") + " · на стоянке у " + d.world.body.name,
               "хозяин: " + owner + " · цена " + Math.round(dockValue(d)),
               "командир " + d.captain];
  var mk = makersOfParts(d.parts, d.corp);
  if (mk.length) lines = lines.concat(["из чего собран:"]).concat(mk);
  return lines;
}
export function windowLines(o, isVoyage) {
  var head = isVoyage ? voyageLines(o) : shipLines(o);
  var owner = isVoyage ? (o.forCorp !== undefined ? o.forCorp : o.corp) : o.corp;
  var lines = head.concat(["командир " + o.captain]);
  if (isVoyage && o.kind === "parts") lines.push("везёт: " + compOf(o.k).short + " — " + corps[o.corp].name);
  var mk = makersOfParts(o.parts, owner);
  if (mk.length) lines = lines.concat(["из чего собран:"]).concat(mk);
  return lines;
}
export function ship(kind, x, y, s, rot, col) {
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
export function rock(x, y, rad, seed, col) {
  cx.beginPath();
  for (var i = 0; i < 9; i++) {
    var a = i / 9 * 6.2832, rr = rad * (0.74 + 0.36 * Math.abs(Math.sin(seed + i * 2.3)));
    var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? cx.lineTo(px, py) : cx.moveTo(px, py);
  }
  cx.closePath(); cx.fillStyle = col; cx.fill();
}

export function advance(s, dt) {
  if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - dt * 0.5);
  var mx = CW/2, my = CH/2, op = posOf(s.bodies[0], mx, my);
  s.ships.forEach(function (sh) {
    var tp = posOf(sh.kind === "colony" ? sh.body : sh.dest.ref, mx, my);
    var k = clamp(vis(sh), 0, 1), e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2;
    sh.x = op.x + (tp.x - op.x) * e; sh.y = op.y + (tp.y - op.y) * e;
    sh.ang = Math.atan2(tp.y - op.y, tp.x - op.x) + 1.5708;
    var tl = sh.trail, lp = tl[tl.length - 1];
    if (!lp || Math.abs(lp.x - sh.x) + Math.abs(lp.y - sh.y) > 1.5) {
      tl.push({ x:sh.x, y:sh.y }); if (tl.length > 40) tl.shift();
    }
  });
}


// Нарисовать модельку в ЧУЖОЙ контекст: ею красится легенда в панели, ею же
// её отдают наружу через THRESHOLD.icon. Контекст подменяется на время вызова
// и возвращается обратно — иначе следующий кадр рисовал бы в значок.
export function icon(ctx, kind, x, y, s, col) {
  var keep = getCx();
  setCx(ctx); ship(kind, x, y, s, 0, col); setCx(keep);
}
