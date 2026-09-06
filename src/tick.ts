import { L, S, U, headless, resetTickCache, tickCache, worlds } from "./state";
import { markTick } from "./clock";
import { labour } from "./labour";
import { economy, ventureIncome } from "./economy";
import { patentsExpire, research } from "./science";
import { produce } from "./factory";
import { stalledOrders, stalledProjects, trade } from "./market";
import { foodRun } from "./food";
import { corpRelief, events, piracy } from "./relief";
import { migrationRun } from "./migration";
import { despair } from "./colony";
import { assemble, branchTrade, reviewOrders, reviewProjects } from "./orders";
import { moveShips } from "./motion";
import { panels } from "./render/panels";

export function step() {
  S.tick++; markTick(); S.yearNow = Math.floor(S.tick / 12);
  resetTickCache();
  worlds.forEach(labour);
  economy(); research(); tickCache.dev = new Map(); tickCache.devBest = null;
  produce(); trade(); stalledOrders(); stalledProjects();
  if (S.tick % 3 === 0) { patentsExpire(); tickCache.dev = new Map(); tickCache.devBest = null; }
  if (S.tick % 6 === 0) { foodRun(); corpRelief(); migrationRun(); despair(); }
  piracy();
  if (S.tick % 12 === 0) { reviewOrders(); reviewProjects(); branchTrade(); events(); }
  assemble(); moveShips(); ventureIncome();
  if (!headless && (L.speed <= 4 || Date.now() - U.lastPanel > 120)) { panels(); U.lastPanel = Date.now(); }
}

