// ===================== галактика =====================

import { BODYNAMES, MARKRANGE, MARKS, ROCKKINDS, ROCKNAMES, SYSNAMES, ptypeOf, rollType } from "./data";
import { CH, CW } from "./render/canvas";
import { rnd } from "./rng";
import { canBuild, corps, fill, systems } from "./state";
import { dist, rnd6 } from "./util";
import type { Corp, Mark, PType, Sys } from "./types";

// pts — координаты ВСЕХ звёзд: направления на соседей, до которых когда-нибудь
// дотянется портал, резервируются под ворота ещё при расстановке планет.
export function makeSystem(i: number, name: string, x: number, y: number, pool: string[], pts: { x: number; y: number }[]): Sys {
  // belt и gate дописываются ниже: камни раскидываются в самом конце, и
  // перенос этого в литерал сдвинул бы весь поток случайности — партии
  // перестали бы воспроизводиться
  const s = { id:i, name:name, x:x, y:y, unlocked:i === 0, depth:0, pulse:0,
            bodies:[], rocks:[], ventures:[], ships:[], stations:[], sats:[], mines:0, portals:[],
            use:{} } as unknown as Sys;
  // Планет в системе от ОДНОЙ до пяти. Одна — это не бедная система, а другая
  // система: в ней негде поставить вторую колонию, некуда переселять и почти
  // некому покупать энергию, зато и делить её не с кем. В стартовой планет
  // четыре, и это единственное исключение.
  const np = i === 0 ? 4 : 1 + Math.floor(rnd() * 5);
  const types: PType[] = [], rs: number[] = [];
  for (let k = 0; k < np; k++) {
    types.push((i === 0 && k === 0) ? ptypeOf("terran") : rollType());
    rs.push(150 + k*52 + rnd()*16);
  }
  // Ворота стоят на ПОСЛЕДНЕЙ орбите системы, а не на своём кольце за краем:
  // прежний фиксированный радиус 420 у системы из двух планет уводил створы
  // в пустоту и заставлял ужимать всю сцену ради них. Створов ещё нет, но
  // где они встанут — известно: у луча к каждой звезде, до которой вообще
  // достаёт лучшая марка. Створу не обязательно смотреть ТОЧНО на свою
  // звезду: допускается уход до 30° в любую сторону, и место выбирается
  // ближайшее к лучу из тех, где нет планеты. Планеты при этом стоят где
  // хотят; углы перебираются лишь когда какому-то створу места не нашлось.
  // Створы стоят на ПОСЛЕДНЕЙ орбите — но не ближе 220 от звезды. Оговорка
  // появилась вместе с системами из одной планеты: там последняя орбита это же
  // первая, около 150, и кольцо створов ложилось прямо на планету — места под
  // створ не находилось, и он вставал поверх неё.
  s.gateR = Math.max(rs[np - 1], 220);
  s.gateAngs = {};
  const reach = MARKRANGE[MARKRANGE.length - 1];
  const aims: { id: number; ang: number }[] = [];
  pts.forEach((p, j) => {
    if (j !== i && dist(p, s) <= reach) aims.push({ id:j, ang:Math.atan2(p.y - y, p.x - x) });
  });
  const gatePts: { x: number; y: number }[] = [];
  let angs: number[] = [], tries = 0;
  do {
    const base = rnd6();
    angs = [];
    for (let k = 0; k < np; k++) angs.push(base + k * (1.5 + rnd()*0.8));
    gatePts.length = 0;
    // подпись планеты — две строки вниз, кольцо створа — ещё 18, отсюда запас
    const free = (gx: number, gy: number): boolean => {
      return angs.every((a, k) => { return Math.hypot(Math.cos(a) * rs[k] - gx, Math.sin(a) * rs[k] - gy) > 8 + types[k].cap * 0.7 + 44; })
          && gatePts.every((g) => { return Math.hypot(g.x - gx, g.y - gy) > 36; });
    };
    let ok = true;
    aims.forEach((aim) => {
      if (!ok) return;
      let found = false;
      for (let step = 0; step <= 10 && !found; step++) {          // 0, ±3°, ±6°, … ±30°
        for (const sign of (step ? [1, -1] : [1])) {
          const ga = aim.ang + sign * step * (Math.PI / 60);
          const gx = Math.cos(ga) * s.gateR, gy = Math.sin(ga) * s.gateR;
          if (!free(gx, gy)) continue;
          s.gateAngs[aim.id] = ga; gatePts.push({ x:gx, y:gy }); found = true; break;
        }
      }
      if (!found) ok = false;
    });
    if (ok) break;
  } while (++tries < 300);
  if (tries >= 300) aims.forEach((aim) => { if (s.gateAngs[aim.id] === undefined) s.gateAngs[aim.id] = aim.ang; });
  const away = (px: number, py: number, m: number): boolean => {
    return gatePts.every((g) => { return Math.hypot(g.x - px, g.y - py) > m; });
  };
  for (let k = 0; k < np; k++) {
    const t = types[k];
    // пятьдесят систем по пять планет — имён в пуле меньше, дальше идут
    // номера: "Кадм II", а не "Безымянная"
    const nm = pool.pop() || (BODYNAMES[(i * 5 + k) % BODYNAMES.length] + " " + ROMAN[1 + Math.floor((i * 5 + k) / BODYNAMES.length) % 4]);
    s.bodies.push({ name: nm, type:t, r:rs[k], ang:angs[k], rad:8 + t.cap * 0.7,
                    kind:"planet", sys:i, world:null });
  }
  // Астероиды раскиданы по всей системе, а не выстроены в кольцо: пояс
  // читался как ещё одна орбита, хотя это просто камни, у каждого из которых
  // своё место. Держим их подальше от планет и друг от друга, чтобы подписи
  // не слипались. Меряем ОБЫЧНОЕ расстояние между точками: прежняя прикидка
  // «радиусы разные ИЛИ углы разные» сравнивала разность углов не с тем
  // знаком и пропускала почти всё — камень ложился прямо под планету, и её
  // подпись накрывала его имя.
  // СКОЛЬКО ИХ. От нуля до семи, и ноль здесь такой же законный ответ, как
  // семь: система без единого камня — это система, в которой нечего добывать,
  // и лететь в неё имеет смысл только ради планет. Стартовая — исключение, и
  // оно одно на всю галактику: в Тире камней не меньше четырёх, и первые
  // четыре РАЗНЫХ ПОРОД. Иначе партия начиналась бы с жребия, который решает
  // всё: без вара не взлетает ни один корабль, без металла цех не делает ни
  // одной детали, а добыть их можно только платформой, которую надо из чего-то
  // собрать и чем-то спустить.
  const n = i === 0 ? 4 + Math.floor(rnd() * 4) : Math.floor(rnd() * 8);
  {
    let guard = 0,
        names = ROCKNAMES.slice().sort(() => { return rnd() - 0.5; });
    // Породы стартовой системы: четыре разные, вперемешку, дальше как повезёт.
    const first = ROCKKINDS.slice().sort(() => { return rnd() - 0.5; });
    while (s.rocks.length < n && guard++ < 400) {
      const rr = 78 + rnd() * 244, aa = rnd6();
      const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
      // под планетой две строки подписи (до rad+32), под камнем — одна
      const far = s.bodies.every((b) => {
        return Math.hypot(Math.cos(b.ang) * b.r - x, Math.sin(b.ang) * b.r - y) > b.rad + 48;
      });
      if (!far || !away(x, y, 40)) continue;
      const clear = s.rocks.every((o) => {
        return Math.hypot(Math.cos(o.ang) * o.r - x, Math.sin(o.ang) * o.r - y) > 34;
      });
      if (!clear) continue;
      const kind = (i === 0 && s.rocks.length < first.length)
                 ? first[s.rocks.length]
                 : ROCKKINDS[Math.floor(rnd() * ROCKKINDS.length)];
      s.rocks.push({ name:names[s.rocks.length], kind:kind, r:rr, ang:aa,
                     s:4.2 + rnd()*2.6, seed:rnd()*6.28, taken:false });
    }
  }
  s.belt = s.rocks.length > 0;
  return s;
}

// Карта: пятьдесят звёзд кольцами вокруг Тиры, и чем дальше кольцо, тем реже
// в нём звёзды. Поэтому дальний край галактики — это не "ещё немного", а
// пропасть: до соседа в пятом кольце вчетверо дальше, чем в первом.
// Всё в экранных единицах, чтобы дальности портала и расстояния меряли
// одним и тем же — иначе баланс дальностей невозможно держать в голове.

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
    // И НЕ ОСТРОВОМ: звезда ставится только в досягаемости лучшей марки от
    // какой-нибудь уже поставленной. Иначе генератор изредка (одна галактика
    // из сорока) оставлял звезду, до которой нельзя долететь ни с одной другой,
    // — а раз нельзя долететь, то и телескоп её не достанет (дальности у
    // ступеней одни и те же), и в партии она не существует вовсе. Связность
    // получается ПО ПОСТРОЕНИЮ: каждая новая точка цепляется к уже связному
    // множеству, а первая и есть Тира.
    const reach = MARKRANGE[MARKRANGE.length - 1];
    if (!pts.some((q) => { return dist(p, q) <= reach; })) continue;
    pts.push(p);
  }
  fill(systems, pts.map((p, i) => {
    const s = makeSystem(i, i < names.length ? names[i] : sysName(i), p.x, p.y, pool, pts);
    s.depth = Math.round(dist(p, pts[0]) / 62);      // "переход N" — теперь по удалённости
    return s;
  }));
}

// Соседство теперь не рисуется заранее, а считается дальностью: "рядом" —
// значит, дотягивается техника, а не значит, что кто-то провёл линию на карте.
// Дальностей две, и они отвечают на разные вопросы: телескоп спутника
// (SCOPE_RANGE) говорит, что вокруг ЕСТЬ, марка перехода — куда можно
// ДОЛЕТЕТЬ. От спутника к спутнику карта раскрывается кольцами, от марки к
// марке — догоняет дорога.
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
/** Номер лучшей марки, которую компания умеет; 0 — никакой. */
export function markLevelOf(c: Corp): number {
  let best = 0;
  MARKS.forEach((m) => { if (canBuild(c, m.key)) best = Math.max(best, m.mark); });
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

