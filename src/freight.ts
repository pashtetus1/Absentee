// ===================== погрузка: купленные детали ждут корабль =====================
//
// Деталь, купленная в другой системе, раньше улетала в тот же месяц: грузовик
// брали со стоянки так, будто он уже у причала, а если его не было — СОБИРАЛИ
// тут же из деталей, лежащих на складах, без верфи и без очереди. И на каждую
// деталь — отдельный рейс со своим баком межзвёздного топлива.
//
// Теперь купленная деталь ложится НА ПОГРУЗКУ в системе продавца и ждёт корабль.
// Раз в месяц погрузка собирает детали одного покупателя, которые идут одним
// путём, и ищет им грузовик тем же порядком, что хлебовоз (fleet.ts): с биржи —
// оттуда же или с порожним перегоном — или с верфи, и за место в очереди
// компания платит: грузовик для деталей — её собственное дело.
//
// В трюм влезает PARTS_PER_HOLD деталей (data.ts). Горючее жжёт рейс, а не
// деталь, поэтому пара едет вдвое дешевле двух одиночек: одинокая деталь ждёт
// пару FREIGHT_WAIT месяцев и лишь потом уходит одна. А если корабля нет
// FREIGHT_GIVEUP месяцев, деталь остаётся на складе покупателя там, где лежит, —
// иначе заказ ждал бы её вечно: она числится летящей и нехваткой не считается.

import { partsRoomOf, shipNeed, vtype } from "./data";
import { corpBuyShip } from "./docks";
import { bestOffer, buildCost, takeOffer } from "./fleet";
import { dispatch } from "./food";
import { fuelBill, takeRes } from "./market";
import { realmOfCorp } from "./realm";
import { rnd } from "./rng";
import { nearestYard, onOrder, orderTransport, paySlot, slotPrice } from "./shipyard";
import { L, S, corps, dateStr, docks, freight, market, say, voyages, worlds } from "./state";
import { bestEngineAt } from "./tech";
import { fuelCost, needWith, routeSpeed, travelExtra } from "./travel";
import { addStock, stockAt } from "./world";
import type { Corp, FlyAcct, Lot, Part, Voyage, World } from "./types";

export const FREIGHT_WAIT = 12;
export const FREIGHT_GIVEUP = 120;

/** Детали на борту рейса. У рейсов из сохранений до погрузки деталь одна и
 *  лежит прямо на рейсе — оттуда её и достаём, чтобы старые рейсы долетали. */
export function lotsOf(v: Voyage): Lot[] {
  if (v.lots) return v.lots;
  if (v.kind === "empty" && v.next && v.next.lots) return v.next.lots;
  if (v.kind === "parts" && v.k)
    return [{ owner: v.forCorp, k: v.k, from: v.corp, sys: v.sysFrom, dest: v.to, consign: v.consign, acct: v.acct, at: 0 }];
  return [];
}

/** Деталь куплена и ложится на погрузку. Счёт летящего растёт сразу: она уже
 *  оплачена и едет, просто пока стоит. */
export function addLot(owner: Corp, k: string, from: number, sys: number, dest: number,
                       consign: Lot["consign"], acct: FlyAcct): void {
  if (acct) { if (!acct.fly) acct.fly = {}; acct.fly[k] = (acct.fly[k] || 0) + 1; }
  freight.push({ owner: owner.id, k, from, sys, dest, consign, acct, at: S.tick });
}

/** Счёт летящего по детали закрывается — долетела, перехвачена или оставлена. */
export function unflyLot(l: Lot): void {
  if (l.acct && l.acct.fly) l.acct.fly[l.k] = Math.max(0, (l.acct.fly[l.k] || 0) - 1);
}

/** У какой планеты грузиться: у филиала того, кто продал, иначе у любой в системе. */
function berthOf(g: Lot[]): World | null {
  const seller = corps[g[0].from];
  const b = seller && seller.branches.find((x) => x.world.sys === g[0].sys);
  return b ? b.world : worlds.find((w) => w.sys === g[0].sys) || null;
}

/** Грузовик с деталями уходит. */
export function sendParts(lots: Lot[], shipParts: Part[], captain: string): Voyage {
  const l = lots[0], owner = corps[l.owner];
  const v = { kind: "parts", sysFrom: l.sys, to: l.dest, lots, qty: lots.length, corp: l.from,
              parts: shipParts, shipOwner: owner.id, color: owner.color, forCorp: owner.id,
              t: 0, dur: (140 + rnd() * 50) / routeSpeed(l.sys, l.dest, l.from, shipParts),
              born: dateStr(), captain } as Voyage;
  voyages.push(v);
  S.hauled++;
  return v;
}

/** Грузовик для деталей строится на верфи; место в очереди оплачивает компания.
 *  Тем же порядком заказывает себе грузовик сырьевой рейс (haul.ts): корабль
 *  один и тот же, разница только в том, что он повезёт. */
export function orderFreighter(owner: Corp, at: World, recipe: Record<string, number>): void {
  const y = nearestYard(at.sys, owner, realmOfCorp(owner));
  if (!y) return;
  const fee = slotPrice(y, vtype("cargo"));
  let parts = 0;
  Object.keys(recipe).forEach((k) => { parts += market[k].price * recipe[k] * (1 + L.tradeFee); });
  if (owner.cash < fee + parts + 20) return;
  const bought = corpBuyShip(owner, at, recipe);
  if (!bought) return;
  if (!paySlot(y, fee, (s) => { if (owner.cash < s) return false; owner.cash -= s; return true; })) {
    bought.forEach((p) => { addStock(owner, at.sys, p.k, 1); });            // детали уже куплены — на склад
    return;
  }
  orderTransport("cargo", bought, at.sys, null, owner);
}

export function freightRun(): void {
  // Группы — по покупателю и пути. Порядок — порядок покупок: партия должна
  // разворачиваться одинаково, а у Map он как раз порядок вставки.
  const groups = new Map<string, Lot[]>();
  freight.forEach((l) => {
    const key = l.owner + "|" + l.sys + "|" + l.dest;
    const g = groups.get(key);
    if (g) g.push(l); else groups.set(key, [l]);
  });
  groups.forEach((g) => {
    const owner = corps[g[0].owner], sys = g[0].sys, dest = g[0].dest;
    const waited = S.tick - g[0].at;
    const berth = berthOf(g);
    if (waited >= FREIGHT_GIVEUP || !berth) {
      g.forEach((l) => { addStock(owner, sys, l.k, 1); unflyLot(l); freight.splice(freight.indexOf(l), 1); });
      say("<b>" + owner.name + "</b> не дождалась грузовика: " + g.length + " дет. остались на складе в системе отправки.");
      return;
    }
    if (g.length < 2 && waited < FREIGHT_WAIT) return;                  // одна ждёт пару: топливо жжёт рейс
    const extra = travelExtra(sys, dest);
    const pay = { world: null as World, corp: owner };
    const offer = bestOffer(pay, "cargo", needWith(vtype("cargo"), extra), berth);
    const recipe = shipNeed(vtype("cargo"), bestEngineAt(sys), extra);
    const build = recipe ? buildCost(pay, "cargo", recipe, sys, berth, realmOfCorp(owner), true) : null;
    if (!offer || (build !== null && build < offer.cost)) {
      if (recipe && !onOrder("cargo", null, owner)) orderFreighter(owner, berth, recipe);
      return;
    }
    const d = offer.dock, room = partsRoomOf(d.parts), tanks = fuelCost(sys, dest);
    if (room <= 0) return;
    if (!corps.some((s) => stockAt(s, sys, "sfuel") > 0) && stockAt(owner, sys, "sfuel") < tanks) return;
    if (owner.cash < offer.price + offer.fuel + fuelBill("sfuel", tanks, sys) + 20) return;
    if (!takeOffer(pay, offer, berth)) return;
    // корабль уже куплен — рейс не вышел, он остаётся на стоянке, но уже её
    if (!takeRes(owner, sys, "sfuel", true, tanks)) { d.corp = owner.id; d.gov = null; docks.push(d); return; }
    const take = g.slice(0, room);
    take.forEach((l) => { freight.splice(freight.indexOf(l), 1); });
    if (d.world === berth) { sendParts(take, d.parts, d.captain); return; }
    const v = dispatch(d.world, berth, "empty", 0, d.parts);
    v.captain = d.captain;
    v.next = { kind: "parts", from: berth, to: dest, qty: take.length, lots: take, forCorp: owner.id };
  });
}
