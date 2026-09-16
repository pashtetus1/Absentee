
import { seatsOf, seatsOfType, shipNeed, vtype } from "./data";
import { bestOffer, buildCost, cargoTo, launch, takeOffer } from "./fleet";
import { dispatch, govBuyShip } from "./food";
import { fuelBill, govFuel, govFuelAvail } from "./market";
import { realmOf } from "./realm";
import { onOrder, orderTransport } from "./shipyard";
import { S, docks, say, voyages, worlds } from "./state";
import { bestEngineAt } from "./tech";
import { canTravel, fuelCost, needWith, travelExtra } from "./travel";
import { popsWord } from "./util";
import { popOf } from "./world";
import type { Corp, World } from "./types";

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

// Переселенческий сажает РОВНО столько, сколько на нём жизнеобеспечений (одно
// на человечка, data.ts), и не уходит неполным. Поэтому и звать, и отдавать
// люди должны не меньше полного корабля: ни «хватит и голодной горстки», ни
// полтора человечка за рейс, как раньше.
export function migrationRun(): void {
  const seats = seatsOfType(vtype("liner"));
  worlds.forEach((w) => {
    if (w.wantIn < seats || w.gov.cash < 90) return;
    if (cargoTo("pops", w).length) return;          // уже летят или корабль идёт за ними
    let src: World = null, bs = 0;
    worlds.forEach((o) => {
      const can = leavers(o);
      if (o === w || can < seats) return;
      if (!canTravel(o.sys, w.sys)) return;
      if (can > bs) { bs = can; src = o; }
    });
    if (!src) return;
    const fk2 = src.sys === w.sys ? "fuel" : "sfuel";
    // переселенческий строит и заправляет ПРИНИМАЮЩИЙ мир: у голодной колонии цехов нет
    const tanks2 = fuelCost(src.sys, w.sys);
    if (!govFuelAvail(w, w, fk2, tanks2)) return;
    // Корабль нужен там, где садятся люди, — у src. Берётся с биржи (оттуда же
    // или из-за звёзд с порожним перегоном) или строится у принимающего мира,
    // что дешевле вместе с ожиданием (fleet.ts). За место в очереди не платит.
    const payer = { world: w, corp: null as Corp };
    const offer = bestOffer(payer, "liner", needWith(vtype("liner"), travelExtra(src.sys, w.sys)), src);
    const recipe = shipNeed(vtype("liner"), bestEngineAt(w.sys), travelExtra(src.sys, w.sys));
    const build = recipe ? buildCost(payer, "liner", recipe, w.sys, src, realmOf(w), false) : null;
    if (!offer || (build !== null && build < offer.cost)) {
      if (!onOrder("liner", w, null)) {
        const buy = shipNeed(vtype("liner"), bestEngineAt(w.sys), travelExtra(src.sys, w.sys));
        const bought = buy && govBuyShip(w, w, buy);
        if (bought) orderTransport("liner", bought, w.sys, w, null);
      }
      return;
    }
    const dkl = offer.dock;
    // Мест у корабля со стоянки может оказаться больше рецепта — тогда и людей
    // нужно больше; не набирается полный — корабль остаётся на стоянке.
    const qty = seatsOf(dkl.parts);
    if (qty <= 0 || leavers(src) < qty || w.wantIn < qty) return;
    if (w.gov.cash < offer.price + offer.fuel + fuelBill(fk2, tanks2, src.sys) + 10 || !takeOffer(payer, offer, src)) return;
    govFuel(w, w, fk2, tanks2);
    const takeFree = Math.min(src.pop.free, qty);
    src.pop.free -= takeFree;
    src.pop.farm = Math.max(0, src.pop.farm - (qty - takeFree));
    src.wantOut -= qty;
    launch(dkl, "pops", src, w, qty);             // люди уже на погрузке и ждут корабль
    S.movedPops += qty;
    say("С " + src.body.name + " на " + w.body.name + " уходят переселенцы: " + popsWord(qty) + ".");
  });
}

