// ---- правила перемещения между звёздами ------------------------------

import { galaxyRange, within } from "./galaxy";
import { S, routes, systems } from "./state";
import { dist } from "./util";
import type { VType } from "./types";

export function routeKey(a: number, b: number): string{ return Math.min(a, b) + "-" + Math.max(a, b); }
export function routeOpen(a: number, b: number): boolean{ return !!routes[routeKey(a, b)]; }
export function gated(i: number): boolean{ return !!systems[i].gate.built; }

// Можно ли отправить обычный рейс (еду, людей) из системы в систему.
// Под движками — можно всегда, но корабль обязан нести двигатель; под
// проходами — только по прожжённому; под воротами — только между воротами.
// Здесь и лежит выгода каждого способа:
//   ворота       — между воротами летают ДАРОМ и на любое расстояние, но
//                  ворота нужны в каждой системе;
//   открыватели  — по прожжённому проходу даром и навсегда, но каждый проход
//                  прожигается отдельно и не длиннее дальности марки;
//   движки       — платишь двигателем за каждый рейс, и каждый рейс не
//                  длиннее дальности марки.
export function canTravel(a: number, b: number): boolean {
  if (a === b) return true;
  if (S.move.key === "gates") return gated(a) && gated(b);
  if (S.move.key === "drives") return dist(systems[a], systems[b]) <= galaxyRange();
  const seen: Record<number, number> = {}, q = [a];                      // проходы складываются в сеть
  seen[a] = 1;
  while (q.length) {
    const i = q.shift();
    if (i === b) return true;
    for (let j = 0; j < systems.length; j++) {
      if (!seen[j] && routeOpen(i, j)) { seen[j] = 1; q.push(j); }
    }
  }
  return false;
}

// Открыть систему мало — до неё надо ДОТЯНУТЬСЯ, иначе способ перемещения
// остаётся косметикой: первый прогон показал, что все три дают одинаковую
// партию, потому что в открытой системе можно было строить даром.
export function reachable(id: number): boolean {
  if (id === 0) return true;
  if (S.move.key === "drives") return canTravel(0, id) || systems[id].unlocked && dist(systems[0], systems[id]) <= galaxyRange() * 3;
  if (S.move.key === "gates") return gated(id) || within(id, galaxyRange()).some(gated);
  return canTravel(0, id);
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

