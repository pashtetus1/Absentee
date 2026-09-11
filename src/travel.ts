// ---- правила перемещения между звёздами ------------------------------

import { galaxyRange, markSpeedOf } from "./galaxy";
import { MARKRANGE, MARKSPEED, bestMarkMade, partMark } from "./data";
import { bestMarkAt } from "./tech";
import { S, dateStr, gates, say, systems } from "./state";
import { dist } from "./util";
import type { Gate, Portal, VType } from "./types";

export function routeKey(a: number, b: number): string{ return Math.min(a, b) + "-" + Math.max(a, b); }
export function gateOf(a: number, b: number): Gate{ return gates[routeKey(a, b)]; }
export function routeOpen(a: number, b: number): boolean{ const g = gateOf(a, b); return !!(g && g.built); }
/** Ворота этой системы: столько, сколько от неё расходится маршрутов. */
export function gatesAt(i: number): Gate[] {
  return Object.keys(gates).map((k) => gates[k]).filter((g) => { return g.a === i || g.b === i; });
}
/** Другой конец маршрута. */
export function otherEnd(g: Gate, i: number): number{ return g.a === i ? g.b : g.a; }
/** Система в сети: хоть одни готовые ворота. */
export function inNet(i: number): boolean{ return gatesAt(i).some((g) => { return g.built; }); }

// Обход сети ворот вширь: сколько ворот придётся пройти от a до каждой
// системы и через какого соседа туда идти. Нужен трижды — для проверки
// достижимости, для платы за проход (топливо жжётся на КАЖДЫХ воротах) и
// для отрисовки: корабль обязан уйти в те самые ворота, что ведут к цели.
export function spread(a: number): { hop: number[]; via: number[] } {
  const hop: number[] = [], via: number[] = [], q = [a];
  hop[a] = 0; via[a] = a;
  while (q.length) {
    const i = q.shift();
    for (let j = 0; j < systems.length; j++) {
      if (hop[j] !== undefined || !routeOpen(i, j)) continue;
      hop[j] = hop[i] + 1; via[j] = i === a ? j : via[i];
      q.push(j);
    }
  }
  return { hop:hop, via:via };
}

// ---- створы -----------------------------------------------------------
// Створ смотрит в свою сторону и ведёт ко ВСЕМ звёздам в конусе ±40° от
// неё: один створ обслуживает несколько маршрутов, если соседи лежат кучно.
// Маршрут открыт, когда створы на обоих концах смотрят друг на друга и
// младшая из их марок дотягивается до другого конца. Маршруты (gates) так и
// остаются рёбрами сети — только теперь они складываются из створов, а не
// ставятся по одному на пару звёзд.
export const CONE = 0.6981;                                  // 40°
export function dirTo(a: number, b: number): number{ return Math.atan2(systems[b].y - systems[a].y, systems[b].x - systems[a].x); }
export function angDiff(a: number, b: number): number{ const d = ((a - b) % 6.2832 + 9.4248) % 6.2832 - 3.1416; return Math.abs(d); }
/** Створ системы a, в конус которого попадает звезда b. */
export function portalFor(a: number, b: number): Portal | null {
  const d = dirTo(a, b);
  let out: Portal = null, bd = CONE;
  systems[a].portals.forEach((p) => { const k = angDiff(p.ang, d); if (k < bd) { bd = k; out = p; } });
  return out;
}
/** Куда смотрит створ к звезде b: готовый створ, иначе отведённое при
 *  генерации место, иначе сам луч (сосед, до которого марки не доставали). */
export function portalAng(a: number, b: number): number {
  const p = portalFor(a, b);
  if (p) return p.ang;
  const slot = systems[a].gateAngs && systems[a].gateAngs[b];
  return slot !== undefined ? slot : dirTo(a, b);
}
/** Портальный корабль пришёл: створ в a в сторону b либо уже есть — тогда он
 *  получает марку не ниже привезённой, — либо ставится на отведённое место. */
export function ensurePortal(a: number, b: number, owner: number, mark: number): Portal {
  let p = portalFor(a, b);
  if (p) { p.mark = Math.max(p.mark, mark); return p; }
  p = { ang:portalAng(a, b), mark:Math.max(1, mark), owner:owner, born:dateStr() };
  systems[a].portals.push(p);
  return p;
}
/** Пересчитать маршруты по створам: пара звёзд, чьи створы смотрят друг на
 *  друга и достают, соединена — даже если портальный корабль между ними не
 *  летал. Марка маршрута — младшая из двух. */
export function syncRoutes(): void {
  for (let i = 0; i < systems.length; i++) {
    if (!systems[i].portals.length) continue;
    for (let j = i + 1; j < systems.length; j++) {
      const pi = portalFor(i, j), pj = pi && portalFor(j, i);
      if (!pj) continue;
      const mark = Math.min(pi.mark, pj.mark);
      const key = routeKey(i, j);
      let g = gates[key];
      // проложенный маршрут остаётся, даже если марка створов до него уже не
      // достаёт (комплект оказался младше, чем знал хозяин при заказе)
      if (g && g.built) { g.mark = mark; continue; }
      if (dist(systems[i], systems[j]) > MARKRANGE[Math.min(MARKRANGE.length, mark) - 1]) continue;
      if (g) { g.built = true; g.building = false; g.mark = mark; g.born = g.born || dateStr(); continue; }
      gates[key] = { a:i, b:j, built:true, building:false, owner:pj.owner, born:dateStr(), mark:mark, trips:0 };
      say("Створы " + systems[i].name + " и " + systems[j].name + " смотрят друг на друга: маршрут открыт.");
    }
  }
}

/** Створы на пути от a к b по сети, в порядке прохода; пусто, если пути нет. */
export function gatesOn(a: number, b: number): Gate[] {
  const out: Gate[] = [];
  let cur = a, guard = 0;
  while (cur !== b && guard++ < systems.length) {
    const n = spread(cur).via[b];
    if (n === undefined) return [];
    out.push(gateOf(cur, n)); cur = n;
  }
  return out;
}

// Скорость межзвёздного рейса. Под движками решает марка компании: двигатель
// стоит на корабле. Под воротами корабль двигателя не несёт — его ведёт
// створ, и скорость задаёт САМЫЙ СТАРЫЙ комплект на пути. Отсюда и смысл
// переделывать створы: пока стоит Mk1, по маршруту всё ползёт как в первый
// год, сколько бы марок ни открыли потом.
export function routeSpeed(a: number, b: number, corpId: number, parts?: { k: string }[]): number {
  // под движками корабль идёт на ТОМ двигателе, что на нём стоит
  const own = partMark(parts);
  if (a === b || S.move.key === "drives") return own ? own.speed : markSpeedOf(corpId);
  const gs = gatesOn(a, b).filter((g) => { return g && g.built; });
  if (!gs.length) return markSpeedOf(corpId);
  let slow = 1e9;
  gs.forEach((g) => { slow = Math.min(slow, MARKSPEED[Math.max(1, Math.min(MARKSPEED.length, g.mark || 1)) - 1]); });
  return slow;
}

/** Рейс прошёл: каждому маршруту на пути засчитывается проход. По этому
 *  счёту компании решают, окупится ли переделка створов на старшую марку. */
export function useRoute(a: number, b: number): void {
  if (a === b || S.move.key === "drives") return;
  gatesOn(a, b).forEach((g) => { if (g) g.trips = (g.trips || 0) + 1; });
}

/** Запись о маршруте, который только прокладывают. */
export function newGate(a: number, b: number, owner: number, mark: number): Gate {
  return { a:a, b:b, built:false, building:true, owner:owner, mark:Math.max(1, mark), trips:0 };
}

// Можно ли отправить обычный рейс (еду, людей) из системы в систему.
// Под движками — можно всегда, но корабль обязан нести двигатель; под
// воротами — только по проложенной сети, зато без двигателя.
// Здесь и лежит выгода каждого способа:
//   ворота  — на маршрут нужен портальный корабль, зато потом по нему летает
//             кто угодно без двигателя. Даром не выходит: каждые ворота на
//             пути жгут межзвёздное топливо, и длинный крюк по сети дороже
//             короткого;
//   движки  — платишь двигателем за каждый рейс, и каждый рейс не длиннее
//             дальности марки.
export function canTravel(a: number, b: number): boolean {
  if (a === b) return true;
  if (S.move.key === "drives") return dist(systems[a], systems[b]) <= galaxyRange();
  return spread(a).hop[b] !== undefined;
}

// Открыть систему мало — до неё надо ДОТЯНУТЬСЯ, иначе способ перемещения
// остаётся косметикой: первый прогон показал, что оба дают одинаковую партию,
// потому что в открытой системе можно было строить даром.
export function reachable(id: number): boolean {
  if (id === 0) return true;
  if (S.move.key === "drives") return canTravel(0, id) || systems[id].unlocked && dist(systems[0], systems[id]) <= galaxyRange() * 3;
  return canTravel(0, id);
}

// Сколько межзвёздного топлива стоит рейс. Под движками — один бак, как и
// было. Под воротами — по баку на каждый створ: проход через портал жжёт
// топливо, и сеть в обход обходится дороже прямого маршрута.
export function fuelCost(a: number, b: number): number {
  if (a === b || S.move.key === "drives") return 1;
  const h = spread(a).hop[b];
  return h === undefined ? 1 : Math.max(1, h);
}

// Что должен нести межзвёздный транспорт сверх обычного набора.
export function travelExtra(a: number, b: number): Record<string, number> {
  if (a === b || S.move.key !== "drives") return null;
  // марка — та, что лежит в системе отправления; нет ни одной — лучшая в
  // галактике (рейс всё равно не соберётся, но заказ будет честным)
  const mk = bestMarkAt(a) || bestMarkMade();
  if (!mk) return null;
  const out: Record<string, number> = {}; out[mk] = 1; return out;
}
export function needWith(vt: VType, extra: Record<string, number>): Record<string, number> {
  const n = JSON.parse(JSON.stringify(vt.need));
  if (extra) Object.keys(extra).forEach((k) => { n[k] = (n[k] || 0) + extra[k]; });
  return n;
}
