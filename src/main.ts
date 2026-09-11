// Точка входа. Собирается в один тег script с обёрткой THRESHOLD, поэтому всё
// экспортированное отсюда становится полем THRESHOLD — тем самым API, которое
// раньше было объектом в конце файла.
//
// Стенд запускает ядро без браузера: см. test/. Отдаём только чтение состояния
// и шаг — отрисовка в тестах не участвует принципиально.

import { BTYPES, COLTECH, COMPS, MARKS, MOVES, PTYPES, VTYPES } from "./data";
import { icon } from "./render/models";
import { bindUI } from "./render/ui";
import { build } from "./setup";
import { seedOf } from "./rng";
import { L, S, U, corps, docks, feed, gates, headless, market, patents, projects, proposals, purses, shipyards, staged, systems, voyages, worlds } from "./state";
import { ENGINES, speedOf } from "./tech";
import { step } from "./tick";
import { harvestOf, yieldPerFarmer } from "./labour";
import { popOf } from "./world";
import type { Snapshot } from "./types";

import { decideById } from "./shipyard";
import type { ApproveMode } from "./types";

export { step, build, speedOf, popOf, icon, seedOf };
export { harvestOf, yieldPerFarmer };
export { decideById as decide };

export function setApproval(mode: ApproveMode): void { L.approve = mode; }

export function state(): Snapshot {
  return { tick: S.tick, treasury: S.treasury, corps: corps, worlds: worlds, systems: systems,
           move: S.move, gates: gates, market: market, patents: patents, voyages: voyages, projects: projects, shipyards: shipyards, proposals: proposals, staged: staged,
           purses: purses, taxAway: S.taxAway,
           trades: S.trades, shipped: S.shipped, movedPops: S.movedPops, refusals: S.refusals, dropped: S.dropped,
           hauled: S.hauled, burned: S.burned, raids: S.raids, lost: S.lost, docks: docks, feed: feed };
}

export function setLever(k: string, v: number | string): void {
  // рычаг сам знает, число ему нужно или ключ технологии
  if (k === "tax") L.tax = v as number; else if (k === "sub") L.subYear = v as number;
  else if (k === "subKey") L.subKey = v as string;
  else if (k === "fee") L.tradeFee = v as number;
  else if (k === "patTerm") L.patTerm = v as number;
}


// MARKS больше не переприсваивается (чистится на месте), поэтому геттер,
// который раньше ловил подмену массива, больше не нужен.
export const consts = { COMPS, COLTECH, PTYPES, VTYPES, MOVES, ENGINES, MARKS, BTYPES };

// для стенда: переключить вид, чтобы кадр отрисовал и карту, и систему
export function setView(mode: string, sys?: number): void { U.view = { mode: mode, sys: sys || 0 }; }

// Запуск ПОСЛЕ объявления API: легенда рисуется через него, и при обратном
// порядке падала бы на первой же загрузке.
if (!headless) bindUI(); else build();
