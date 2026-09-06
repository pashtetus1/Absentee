// ---- правила перемещения между звёздами ------------------------------

import { galaxyRange } from "./galaxy";
import { S, gates, systems } from "./state";
import { dist } from "./util";
import type { Gate, VType } from "./types";

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
export function travelExtra(a: number, b: number): { drive: number; } {
  return (a !== b && S.move.key === "drives") ? { drive:1 } : null;
}
export function needWith(vt: VType, extra: Record<string, number>): Record<string, number> {
  const n = JSON.parse(JSON.stringify(vt.need));
  if (extra) Object.keys(extra).forEach((k) => { n[k] = (n[k] || 0) + extra[k]; });
  return n;
}
