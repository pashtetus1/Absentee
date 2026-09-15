
import { shipNeed, vtype } from "./data";
import { takeDock } from "./docks";
import { dispatch, govBuyShip } from "./food";
import { govFuel, govFuelAvail } from "./market";
import { onOrder, orderTransport } from "./shipyard";
import { S, say, voyages, worlds } from "./state";
import { bestEngineAt } from "./tech";
import { canTravel, fuelCost, needWith, travelExtra } from "./travel";
import { popOf } from "./world";
import type { World } from "./types";

// Из голодного мира уезжают только БЕЗРАБОТНЫЕ, и ни из какого — больше трети
// мира за раз. Раньше недостача добиралась из поля всегда: 97% отъездов из
// колоний шли из голодных миров, а увозили именно фермеров, так что отъезд сам
// углублял голод, из-за которого уезжали. И один переселенческий (до 1.6)
// опустошал колонию на полтора человечка целиком.
//   Фермера с СЫТОГО мира отпускать можно и нужно: у столицы безработных почти
// нет, и её переселенцы — как раз люди из поля. Когда увозили только
// незанятых, переселение в колонии упало вчетверо.
export const LEAVE_SHARE = 1 / 3;

/** Сколько человечков этот мир может отдать прямо сейчас. */
export function leavers(o: World): number {
  const fromFarm = o.food.short > 0 ? 0 : o.pop.farm * 0.3;
  return Math.min(o.wantOut, o.pop.free + fromFarm, popOf(o) * LEAVE_SHARE);
}

export function migrationRun(): void {
  worlds.forEach((w) => {
    if (w.wantIn < 0.6 || w.gov.cash < 90) return;
    if (voyages.some((v) => { return v.kind === "pops" && v.to === w; })) return;
    let src: World = null, bs = 0;
    worlds.forEach((o) => {
      const can = leavers(o);
      if (o === w || can < 0.12) return;           // хватит и голодной горстки
      if (!canTravel(o.sys, w.sys)) return;
      if (can > bs) { bs = can; src = o; }
    });
    if (!src) return;
    const fk2 = src.sys === w.sys ? "fuel" : "sfuel";
    // переселенческий строит и заправляет ПРИНИМАЮЩИЙ мир: у голодной колонии цехов нет
    const tanks2 = fuelCost(src.sys, w.sys);
    if (!govFuelAvail(w, w, fk2, tanks2)) return;
    const dkl = takeDock(null, w, w.sys, "liner", needWith(vtype("liner"), travelExtra(src.sys, w.sys)));
    if (!dkl) {
      if (!onOrder("liner", w, null)) {
        const buy = shipNeed(vtype("liner"), bestEngineAt(w.sys), travelExtra(src.sys, w.sys));
        const bought = buy && govBuyShip(w, w, buy);
        if (bought) orderTransport("liner", bought, w.sys, w, null);
      }
      return;
    }
    const parts = dkl.parts;
    govFuel(w, w, fk2, tanks2);
    const qty = Math.min(leavers(src), w.wantIn, 1.6);
    const takeFree = Math.min(src.pop.free, qty);
    src.pop.free -= takeFree;
    src.pop.farm = Math.max(0, src.pop.farm - (qty - takeFree));
    src.wantOut -= qty;
    const vp = dispatch(src, w, "pops", qty, parts);
    if (dkl) vp.captain = dkl.captain;
    S.movedPops += qty;
    say("С " + src.body.name + " на " + w.body.name + " уходит " + qty.toFixed(1) + " человечков.");
  });
}

