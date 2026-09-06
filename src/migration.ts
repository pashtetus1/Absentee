
import { vtype } from "./data";
import { takeDock } from "./docks";
import { dispatch, govBuyShip } from "./food";
import { govFuel, govFuelAvail } from "./market";
import { onOrder, orderTransport } from "./shipyard";
import { S, say, voyages, worlds } from "./state";
import { canTravel, needWith, travelExtra } from "./travel";
import type { World } from "./types";

export function migrationRun(): void {
  worlds.forEach((w) => {
    if (w.wantIn < 0.6 || w.gov.cash < 90) return;
    if (voyages.some((v) => { return v.kind === "pops" && v.to === w; })) return;
    let src: World = null, bs = 0;
    worlds.forEach((o) => {
      if (o === w || o.wantOut < 0.12) return;      // хватит и голодной горстки
      if (!canTravel(o.sys, w.sys)) return;
      if (o.wantOut > bs) { bs = o.wantOut; src = o; }
    });
    if (!src) return;
    const fk2 = src.sys === w.sys ? "fuel" : "sfuel";
    // переселенческий строит и заправляет ПРИНИМАЮЩИЙ мир: у голодной колонии цехов нет
    if (!govFuelAvail(w, w, fk2)) return;
    const dkl = takeDock(null, w, w.sys, "liner", needWith(vtype("liner"), travelExtra(src.sys, w.sys)));
    if (!dkl) {
      if (!onOrder("liner", w, null)) {
        const bought = govBuyShip(w, w, needWith(vtype("liner"), travelExtra(src.sys, w.sys)));
        if (bought) orderTransport("liner", bought, w.sys, w, null);
      }
      return;
    }
    const parts = dkl.parts;
    govFuel(w, w, fk2);
    const qty = Math.min(src.wantOut, w.wantIn, 1.6);
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

