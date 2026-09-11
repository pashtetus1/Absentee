
import { markTick } from "./clock";
import { abandon, despair } from "./colony";
import { economy, ventureIncome } from "./economy";
import { produce } from "./factory";
import { foodRun } from "./food";
import { labour } from "./labour";
import { stalledOrders, stalledProjects, trade } from "./market";
import { migrationRun } from "./migration";
import { moveShips } from "./motion";
import { assemble, branchTrade, reviewOrders, reviewProjects } from "./orders";
import { corpRelief, events, piracy } from "./relief";
import { keep } from "./save";
import { panels } from "./render/panels";
import { watchProposals } from "./render/ui";
import { patentsExpire, research } from "./science";
import { edgeYards, proposalsTick, reviewProposals } from "./shipyard";
import { L, S, U, headless, resetTickCache, tickCache, worlds, gates } from "./state";

export function step(): void {
  S.tick++; markTick(); S.yearNow = Math.floor(S.tick / 12);
  resetTickCache();
  worlds.forEach(labour);
  economy(); proposalsTick(); edgeYards(); research(); tickCache.dev = new Map(); tickCache.devBest = null;
  produce(); trade(); stalledOrders(); stalledProjects();
  if (S.tick % 3 === 0) { patentsExpire(); tickCache.dev = new Map(); tickCache.devBest = null; }
  if (S.tick % 6 === 0) { foodRun(); corpRelief(); migrationRun(); despair(); }
  piracy();
  if (S.tick % 12 === 0) { reviewOrders(); reviewProjects(); reviewProposals(); branchTrade(); events(); }
  assemble(); moveShips(); ventureIncome();
  // Мир, где не осталось людей, перестаёт быть миром. Метём в КОНЦЕ месяца, а
  // не сразу после labour: населением за месяц двигает не только убыль, но и
  // переселение, эпидемия и прилетевший рейс, и только здесь оно уже не
  // шевельнётся. Иначе мир с нулём людей доживал бы до следующего тика.
  abandon();
  // трафик маршрутов затухает: за пять лет счёт без новых рейсов сходит на нет
  Object.keys(gates).forEach((k) => { gates[k].trips = (gates[k].trips || 0) * (1 - 1 / 60); });
  if (!headless) { watchProposals(); keep(); }
  if (!headless && (L.speed <= 4 || Date.now() - U.lastPanel > 120)) { panels(); U.lastPanel = Date.now(); }
}

