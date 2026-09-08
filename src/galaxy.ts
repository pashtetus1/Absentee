// ===================== галактика =====================

import { BODYNAMES, MARKS, ROCKNAMES, SYSNAMES, ptypeOf, rollType } from "./data";
import { CH, CW } from "./render/canvas";
import { rnd } from "./rng";
import { canBuild, corps, fill, systems } from "./state";
import { dist, rnd6 } from "./util";
import type { Corp, Mark, Sys } from "./types";

export function makeSystem(i: number, name: string, x: number, y: number, pool: string[]): Sys {
  // belt и gate дописываются ниже: belt тянет случайное число, и перенос его
  // в литерал сдвинул бы весь поток — партии перестали бы воспроизводиться
  const s = { id:i, name:name, x:x, y:y, unlocked:i === 0, depth:0, pulse:0,
            bodies:[], rocks:[], ventures:[], ships:[], stations:[], mines:0 } as unknown as Sys;
  const np = i === 0 ? 4 : 2 + Math.floor(rnd() * 4);      // до пяти планет
  const base = rnd6();
  for (let k = 0; k < np; k++) {
    const t = (i === 0 && k === 0) ? ptypeOf("terran") : rollType();
    // пятьдесят систем по пять планет — имён в пуле меньше, дальше идут
    // номера: "Кадм II", а не "Безымянная"
    const nm = pool.pop() || (BODYNAMES[(i * 5 + k) % BODYNAMES.length] + " " + ROMAN[1 + Math.floor((i * 5 + k) / BODYNAMES.length) % 4]);
    s.bodies.push({ name: nm, type:t, r:150 + k*52 + rnd()*16,
                    ang: base + k * (1.5 + rnd()*0.8), rad:8 + t.cap * 0.7,
                    kind:"planet", sys:i, world:null });
  }
  // Астероиды раскиданы по всей системе, а не выстроены в кольцо: пояс
  // читался как ещё одна орбита, хотя это просто камни, у каждого из которых
  // своё место. Держим их подальше от планет и друг от друга, чтобы подписи
  // не слипались.
  s.belt = i === 0 || rnd() < 0.75;
  if (s.belt) {
    let n = 5 + Math.floor(rnd()*4), guard = 0,
        names = ROCKNAMES.slice().sort(() => { return rnd() - 0.5; });
    while (s.rocks.length < n && guard++ < 400) {
      const rr = 78 + rnd() * 244, aa = rnd6();
      const far = s.bodies.every((b) => {
        return Math.abs(b.r - rr) > b.rad + 16 || Math.abs(((b.ang - aa + 9.42) % 6.2832) - 3.1416) < 2.5;
      });
      if (!far) continue;
      const clear = s.rocks.every((o) => {
        return Math.abs(o.r - rr) > 22 || Math.abs(((o.ang - aa + 9.42) % 6.2832) - 3.1416) < 2.9;
      });
      if (!clear) continue;
      s.rocks.push({ name:names[s.rocks.length], r:rr, ang:aa,
                     s:4.2 + rnd()*2.6, seed:rnd()*6.28, taken:false });
    }
  }
  return s;
}

// Карта: пятьдесят звёзд кольцами вокруг Тиры, и чем дальше кольцо, тем реже
// в нём звёзды. Поэтому дальний край галактики — это не "ещё немного", а
// пропасть: до соседа в пятом кольце вчетверо дальше, чем в первом.
// Всё в экранных единицах, чтобы дальности портала и расстояния меряли
// одним и тем же — иначе баланс дальностей невозможно держать в голове.
// Ворота стоят на КРАЮ системы, за последней орбитой (планеты доходят до
// 150 + 4*52 + 16 = 374), и смотрят на ту звезду, к которой ведут.
export const GATE_R = 420;

export const RINGS = [{ r:0, n:1 }, { r:38, n:7 }, { r:86, n:10 }, { r:145, n:12 }, { r:216, n:12 }, { r:300, n:8 }];
export const ROMAN = ["", "II", "III", "IV", "V"];

export function sysName(i: number): string {
  if (i < SYSNAMES.length) return SYSNAMES[i];
  return SYSNAMES[i % SYSNAMES.length] + " " + ROMAN[Math.floor(i / SYSNAMES.length)];
}

// Звёзды раскидываются случайно, а не по ровным кольцам: правильные круги
// читались как чертёж, а не как галактика. Держится только одно свойство —
// чем дальше от Тиры, тем реже соседи: минимальный зазор растёт с радиусом.
// Плюс мягкая спиральная закрутка и лёгкая сплюснутость, как в ES2.
export function makeGalaxy(): void {
  const pool = BODYNAMES.slice().sort(() => { return rnd() - 0.5; });
  const names = SYSNAMES.slice(1).sort(() => { return rnd() - 0.5; });
  names.unshift(SYSNAMES[0]);
  const cxp = CW / 2, cyp = CH / 2, arms = 2, twist = 0.010 + rnd() * 0.006;
  let pts = [{ x:cxp, y:cyp }], guard = 0;
  while (pts.length < 50 && guard++ < 40000) {
    // степень больше 0.5 разрежает середину: у края звёзд меньше на площадь
    const r = 20 + 292 * Math.pow(rnd(), 0.62);
    const a = rnd() < 0.72
          ? Math.floor(rnd() * arms) * (6.2832 / arms) + r * twist + (rnd() - 0.5) * 1.15
          : rnd6();                                  // четверть звёзд вне рукавов
    const p = { x:cxp + Math.cos(a) * r, y:cyp + Math.sin(a) * r * 0.88 };
    if (p.x < 24 || p.x > CW - 24 || p.y < 24 || p.y > CH - 24) continue;
    const minD = 24 + r * 0.14;
    if (!pts.every((q) => { return dist(p, q) > minD; })) continue;
    pts.push(p);
  }
  fill(systems, pts.map((p, i) => {
    const s = makeSystem(i, i < names.length ? names[i] : sysName(i), p.x, p.y, pool);
    s.depth = Math.round(dist(p, pts[0]) / 62);      // "переход N" — теперь по удалённости
    return s;
  }));
}

// Соседство теперь не рисуется заранее, а считается дальностью портала:
// "рядом" — значит, дотягивается техника, а не значит, что кто-то провёл
// линию на карте. От марки к марке карта сама раскрывается кольцами.
export function within(i: number, range: number): number[] {
  const out = [];
  for (let j = 0; j < systems.length; j++)
    if (j !== i && dist(systems[i], systems[j]) <= range) out.push(j);
  return out;
}
export function rangeOf(c: Corp): number {
  let best = 0;
  MARKS.forEach((m) => { if (canBuild(c, m.key)) best = Math.max(best, m.range); });
  return best;
}
/** Во сколько раз быстрее идёт МЕЖЗВЁЗДНЫЙ рейс этой компании: по лучшей
 *  марке, которую она умеет. Внутри системы марка не значит ничего.
 *
 *  Отрицательный номер — рейс государства (хлебовоз, переселенческий): казна
 *  своих марок не держит и пользуется тем, что освоено в галактике. */
export function markSpeedOf(corpId: number): number {
  const c = corps[corpId];
  let best = 1;
  MARKS.forEach((m) => {
    if (c ? canBuild(c, m.key) : corps.some((o) => canBuild(o, m.key))) best = Math.max(best, m.speed);
  });
  return best;
}
export function galaxyRange(): number {
  let best = 0;
  corps.forEach((c) => { best = Math.max(best, rangeOf(c)); });
  return best;
}
export function bestMark(): Mark | null {
  let out = null;
  MARKS.forEach((m) => { if (corps.some((c) => { return canBuild(c, m.key); })) out = m; });
  return out;
}

