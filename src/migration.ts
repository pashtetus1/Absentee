
import { vtype } from "./data";
import { takeDock } from "./docks";
import { dispatch, govBuyShip } from "./food";
import { govFuel, govFuelAvail } from "./market";
import { S, say, voyages, worlds } from "./state";
import { canTravel, needWith, travelExtra } from "./travel";
import type { World } from "./types";

export function migrationRun() {
  worlds.forEach(function (w) {
    if (w.wantIn < 0.6 || w.gov.cash < 90) return;
    if (voyages.some(function (v) { return v.kind === "pops" && v.to === w; })) return;
    var src: World = null, bs = 0;
    worlds.forEach(function (o) {
      if (o === w || o.wantOut < 0.12) return;      // хватит и голодной горстки
      if (!canTravel(o.sys, w.sys)) return;
      if (o.wantOut > bs) { bs = o.wantOut; src = o; }
    });
    if (!src) return;
    var fk2 = src.sys === w.sys ? "fuel" : "sfuel";
    // переселенческий строит и заправляет ПРИНИМАЮЩИЙ мир: у голодной колонии цехов нет
    if (!govFuelAvail(w, w, fk2)) return;
    var dkl = takeDock(null, w, w.sys, "liner", needWith(vtype("liner"), travelExtra(src.sys, w.sys)));
    var parts = dkl ? dkl.parts : govBuyShip(w, w, needWith(vtype("liner"), travelExtra(src.sys, w.sys)));
    if (!parts) return;
    govFuel(w, w, fk2);
    var qty = Math.min(src.wantOut, w.wantIn, 1.6);
    var takeFree = Math.min(src.pop.free, qty);
    src.pop.free -= takeFree;
    src.pop.farm = Math.max(0, src.pop.farm - (qty - takeFree));
    src.wantOut -= qty;
    var vp = dispatch(src, w, "pops", qty, parts);
    if (dkl) vp.captain = dkl.captain;
    S.movedPops += qty;
    say("С " + src.body.name + " на " + w.body.name + " уходит " + qty.toFixed(1) + " человечков.");
  });
}

