
import { markTick } from "./clock";
import { despair } from "./colony";
import { economy, ventureIncome } from "./economy";
import { produce } from "./factory";
import { foodRun } from "./food";
import { labour } from "./labour";
import { stalledOrders, stalledProjects, trade } from "./market";
import { migrationRun } from "./migration";
import { moveShips } from "./motion";
import { assemble, branchTrade, reviewOrders, reviewProjects } from "./orders";
import { corpRelief, events, piracy } from "./relief";
import { panels } from "./render/panels";
import { patentsExpire, research } from "./science";
import { L, S, U, headless, resetTickCache, tickCache, worlds } from "./state";

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

