// ===================== галактика =====================

import { BODYNAMES, MARKS, ROCKNAMES, SYSNAMES, ptypeOf, rollType } from "./data";
import { CH, CW } from "./render/canvas";
import { canBuild, corps, fill, systems } from "./state";
import { dist, rnd6 } from "./util";
import type { Corp, Mark, Sys } from "./types";

export function makeSystem(i: number, name: string, x: number, y: number, pool: string[]): Sys {
  // belt и gate дописываются ниже: belt тянет случайное число, и перенос его
  // в литерал сдвинул бы весь поток — партии перестали бы воспроизводиться
  var s = { id:i, name:name, x:x, y:y, unlocked:i === 0, depth:0, pulse:0,
            bodies:[], rocks:[], ventures:[], ships:[], yards:[], stations:[], mines:0 } as unknown as Sys;
  var np = i === 0 ? 4 : 2 + Math.floor(Math.random() * 4);      // до пяти планет
  var base = rnd6();
  for (var k = 0; k < np; k++) {
    var t = (i === 0 && k === 0) ? ptypeOf("terran") : rollType();
    // пятьдесят систем по пять планет — имён в пуле меньше, дальше идут
    // номера: "Кадм II", а не "Безымянная"
    var nm = pool.pop() || (BODYNAMES[(i * 5 + k) % BODYNAMES.length] + " " + ROMAN[1 + Math.floor((i * 5 + k) / BODYNAMES.length) % 4]);
    s.bodies.push({ name: nm, type:t, r:150 + k*52 + Math.random()*16,
                    ang: base + k * (1.5 + Math.random()*0.8), rad:8 + t.cap * 0.7,
                    kind:"planet", sys:i, world:null });
  }
  // Астероиды раскиданы по всей системе, а не выстроены в кольцо: пояс
  // читался как ещё одна орбита, хотя это просто камни, у каждого из которых
  // своё место. Держим их подальше от планет и друг от друга, чтобы подписи
  // не слипались.
  s.belt = i === 0 || Math.random() < 0.75;
  if (s.belt) {
    var n = 5 + Math.floor(Math.random()*4), guard = 0,
        names = ROCKNAMES.slice().sort(function () { return Math.random() - 0.5; });
    while (s.rocks.length < n && guard++ < 400) {
      var rr = 78 + Math.random() * 244, aa = rnd6();
      var far = s.bodies.every(function (b) {
        return Math.abs(b.r - rr) > b.rad + 16 || Math.abs(((b.ang - aa + 9.42) % 6.2832) - 3.1416) < 2.5;
      });
      if (!far) continue;
      var clear = s.rocks.every(function (o) {
        return Math.abs(o.r - rr) > 22 || Math.abs(((o.ang - aa + 9.42) % 6.2832) - 3.1416) < 2.9;
      });
      if (!clear) continue;
      s.rocks.push({ name:names[s.rocks.length], r:rr, ang:aa,
                     s:4.2 + Math.random()*2.6, seed:Math.random()*6.28, taken:false });
    }
  }
  s.gate = { name:"ворота", r:352, ang:rnd6() };
  return s;
}

// Карта: пятьдесят звёзд кольцами вокруг Тиры, и чем дальше кольцо, тем реже
// в нём звёзды. Поэтому дальний край галактики — это не "ещё немного", а
// пропасть: до соседа в пятом кольце вчетверо дальше, чем в первом.
// Всё в экранных единицах, чтобы дальности портала и расстояния меряли
// одним и тем же — иначе баланс дальностей невозможно держать в голове.
export var RINGS = [{ r:0, n:1 }, { r:38, n:7 }, { r:86, n:10 }, { r:145, n:12 }, { r:216, n:12 }, { r:300, n:8 }];
export var ROMAN = ["", "II", "III", "IV", "V"];

export function sysName(i: number): string {
  if (i < SYSNAMES.length) return SYSNAMES[i];
  return SYSNAMES[i % SYSNAMES.length] + " " + ROMAN[Math.floor(i / SYSNAMES.length)];
}

// Звёзды раскидываются случайно, а не по ровным кольцам: правильные круги
// читались как чертёж, а не как галактика. Держится только одно свойство —
// чем дальше от Тиры, тем реже соседи: минимальный зазор растёт с радиусом.
// Плюс мягкая спиральная закрутка и лёгкая сплюснутость, как в ES2.
export function makeGalaxy(): void {
  var pool = BODYNAMES.slice().sort(function () { return Math.random() - 0.5; });
  var names = SYSNAMES.slice(1).sort(function () { return Math.random() - 0.5; });
  names.unshift(SYSNAMES[0]);
  var cxp = CW / 2, cyp = CH / 2, arms = 2, twist = 0.010 + Math.random() * 0.006;
  var pts = [{ x:cxp, y:cyp }], guard = 0;
  while (pts.length < 50 && guard++ < 40000) {
    // степень больше 0.5 разрежает середину: у края звёзд меньше на площадь
    var r = 20 + 292 * Math.pow(Math.random(), 0.62);
    var a = Math.random() < 0.72
          ? Math.floor(Math.random() * arms) * (6.2832 / arms) + r * twist + (Math.random() - 0.5) * 1.15
          : rnd6();                                  // четверть звёзд вне рукавов
    var p = { x:cxp + Math.cos(a) * r, y:cyp + Math.sin(a) * r * 0.88 };
    if (p.x < 24 || p.x > CW - 24 || p.y < 24 || p.y > CH - 24) continue;
    var minD = 24 + r * 0.14;
    if (!pts.every(function (q) { return dist(p, q) > minD; })) continue;
    pts.push(p);
  }
  fill(systems, pts.map(function (p, i) {
    var s = makeSystem(i, i < names.length ? names[i] : sysName(i), p.x, p.y, pool);
    s.depth = Math.round(dist(p, pts[0]) / 62);      // "переход N" — теперь по удалённости
    return s;
  }));
}

// Соседство теперь не рисуется заранее, а считается дальностью портала:
// "рядом" — значит, дотягивается техника, а не значит, что кто-то провёл
// линию на карте. От марки к марке карта сама раскрывается кольцами.
export function within(i: number, range: number): number[] {
  var out = [];
  for (var j = 0; j < systems.length; j++)
    if (j !== i && dist(systems[i], systems[j]) <= range) out.push(j);
  return out;
}
export function rangeOf(c: Corp): number {
  var best = 0;
  MARKS.forEach(function (m) { if (canBuild(c, m.key)) best = Math.max(best, m.range); });
  return best;
}
export function galaxyRange(): number {
  var best = 0;
  corps.forEach(function (c) { best = Math.max(best, rangeOf(c)); });
  return best;
}
export function bestMark(): Mark | null {
  var out = null;
  MARKS.forEach(function (m) { if (corps.some(function (c) { return canBuild(c, m.key); })) out = m; });
  return out;
}

