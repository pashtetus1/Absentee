// Точка входа. Собирается в один тег script с обёрткой THRESHOLD, поэтому всё
// экспортированное отсюда становится полем THRESHOLD — тем самым API, которое
// раньше было объектом в конце файла.
//
// Стенд запускает ядро без браузера: см. test/. Отдаём только чтение состояния
// и шаг — отрисовка в тестах не участвует принципиально.

import { S, L, U, corps, worlds, systems, links, routes, market, patents, voyages, projects, docks, feed, headless } from "./state";
import { COMPS, COLTECH, PTYPES, VTYPES, MOVES, MARKS } from "./data";
import { ENGINES, speedOf } from "./tech";
import { popOf } from "./world";
import { build } from "./setup";
import { step } from "./tick";
import { icon } from "./render/models";

import { bindUI } from "./render/ui";

export { step, build, speedOf, popOf, icon };

export function state() {
  return { tick: S.tick, treasury: S.treasury, corps: corps, worlds: worlds, systems: systems, links: links,
           move: S.move, routes: routes, market: market, patents: patents, voyages: voyages, projects: projects,
           trades: S.trades, shipped: S.shipped, movedPops: S.movedPops, refusals: S.refusals, dropped: S.dropped,
           hauled: S.hauled, burned: S.burned, raids: S.raids, docks: docks, feed: feed };
}

export function setLever(k: string, v: any) {
  if (k === "tax") L.tax = v; else if (k === "sub") L.subYear = v; else if (k === "subKey") L.subKey = v;
  else if (k === "fee") L.tradeFee = v; else if (k === "dole") L.dole = v; else if (k === "patTerm") L.patTerm = v;
}


// MARKS больше не переприсваивается (чистится на месте), поэтому геттер,
// который раньше ловил подмену массива, больше не нужен.
export const consts = { COMPS, COLTECH, PTYPES, VTYPES, MOVES, ENGINES, MARKS };

// для стенда: переключить вид, чтобы кадр отрисовал и карту, и систему
export function setView(mode: string, sys?: number) { U.view = { mode: mode, sys: sys || 0 }; }

// Запуск ПОСЛЕ объявления API: легенда рисуется через него, и при обратном
// порядке падала бы на первой же загрузке.
if (!headless) bindUI(); else build();
