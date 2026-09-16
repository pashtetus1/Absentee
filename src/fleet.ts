// ===================== корабль под рейс: купить или построить =====================
//
// Хлебовозу, переселенческому и частной помощи нужен корабль в системе ПОГРУЗКИ
// — там, где лежит еда или ждут люди. Раньше корабль брали с ближайшей стоянки
// так, будто он уже стоит у причала: корабль с орбиты соседней планеты или за
// пять звёзд оказывался на месте мгновенно, и перегон «уходил в срок самого
// рейса». Теперь он честно летит к погрузке порожним — из C в A, и только
// оттуда с грузом в B. Если корабль стоял у получателя, выходит B → A → B.
// Считается по ПЛАНЕТАМ, а не по системам: почти вся торговля идёт внутри
// домашней системы (там стоит 96% кораблей), а рейс между её планетами — те же
// пять лет, что и любой другой внутрисистемный.
//
// Выбор — по цене в ДЕНЬГАХ, в которой учтено и время:
//   с биржи   — цена в системе, где он стоит (свой корабль даром), плюс топливо
//               на порожний перегон, плюс месяцы перегона × MONTH_VALUE;
//   постройка — детали по ходовым ценам, плюс плата за место (если её берут),
//               плюс месяцы очереди верфи и перегона от неё × MONTH_VALUE;
//               если транспорт уже заказан — только оставшиеся месяцы.
// Побеждает меньшее. Поэтому дешёвый корабль в глуши проигрывает дорогому под
// боком, а биржа, где корабли скопились, выигрывает у забитой верфи.

import { engMult, vtype } from "./data";
import { dockValue, fits, wantShip } from "./docks";
import { dispatch } from "./food";
import { sendParts } from "./freight";
import { fuelBill, govFuel, takeRes } from "./market";
import { nearestYard, orderWait, slotPrice, yardWait } from "./shipyard";
import { L, corps, docks, market, say, voyages } from "./state";
import { canTravel, fuelCost, routeSpeed } from "./travel";
import { popsWord } from "./util";
import { stockAt } from "./world";
import type { Corp, Dock, Part, Voyage, World } from "./types";

/** Сколько денег стоит месяц ожидания корабля. Одно число на всех: по нему
 *  корабль в соседней системе сравнивается с кораблём за три звезды и с
 *  постройкой. */
export const MONTH_VALUE = 1;

/** Кто платит: правительство мира или компания. */
export interface Payer { world: World | null; corp: Corp | null; }

/** Средняя длина перегона между планетами — без броска кубика: оценка не должна
 *  сдвигать генератор партии. Сам рейс считает dispatch, с разбросом, и эти
 *  числа — середины его разброса. */
export function legMonths(from: World, to: World, parts: Part[]): number {
  if (from === to) return 0;
  if (from.sys === to.sys) return 63 / engMult(parts);
  return 180 / routeSpeed(from.sys, to.sys, parts.length ? parts[0].from : -1, parts);
}
/** Какое горючее и сколько баков жжёт перегон. */
function legFuel(from: World, to: World): { k: string; n: number } {
  return from.sys === to.sys ? { k: "fuel", n: 1 } : { k: "sfuel", n: fuelCost(from.sys, to.sys) };
}

export interface Offer { dock: Dock; cost: number; price: number; fuel: number; months: number; }

function isOwn(p: Payer, d: Dock): boolean { return p.corp ? d.corp === p.corp.id : d.gov === p.world; }

/** Лучший корабль с бирж под погрузку у планеты load. Корабль у самой этой
 *  планеты перегона не требует; от другой — нужен путь и горючее на месте. */
export function bestOffer(p: Payer, kind: string, need: Record<string, number>, load: World): Offer | null {
  wantShip(load.sys, kind);                              // корабль здесь искали — это спрос
  let best: Offer = null;
  docks.forEach((d) => {
    if (d.kind !== kind || !fits(d.parts, need)) return;
    if (d.sys !== load.sys && !canTravel(d.sys, load.sys)) return;
    const price = isOwn(p, d) ? 0 : dockValue(d);
    let fuel = 0, months = 0;
    if (d.world !== load) {
      const lf = legFuel(d.world, load);
      if (!corps.some((s) => stockAt(s, d.sys, lf.k) >= lf.n)) return;       // перегнать не на чем
      fuel = fuelBill(lf.k, lf.n, d.sys);
      months = legMonths(d.world, load, d.parts);
    }
    const cost = price + fuel + months * MONTH_VALUE;
    if (!best || cost < best.cost) best = { dock: d, cost, price, fuel, months };
  });
  return best;
}

/** Во что обойдётся построить: null — построить сейчас нельзя (негде или не из
 *  чего). Уже заказанный транспорт стоит только оставшегося ожидания. */
export function buildCost(p: Payer, kind: string, need: Record<string, number>, at: number, load: World,
                          realm: number, paysSlot: boolean): number | null {
  const on = orderWait(kind, p.world && !p.corp ? p.world : null, p.corp);
  if (on) return (on.months + legMonths(on.yard.world, load, [])) * MONTH_VALUE;
  const y = nearestYard(at, p.corp, realm);
  if (!y) return null;
  let parts = 0;
  for (const k of Object.keys(need)) {
    if (!corps.some((s) => stockAt(s, at, k) >= need[k])) return null;       // нечего купить на месте
    parts += market[k].price * need[k] * (1 + L.tradeFee);
  }
  const vt = vtype(kind);
  return parts + (paysSlot ? slotPrice(y, vt) : 0) +
         (yardWait(y, vt) + legMonths(y.world, load, [])) * MONTH_VALUE;
}

/** Забрать корабль с биржи: заплатить хозяину и за топливо на перегон. false —
 *  денег не хватило, корабль остаётся на месте. */
export function takeOffer(p: Payer, o: Offer, load: World): boolean {
  const d = o.dock;
  const purse = p.corp ? p.corp.cash : p.world.gov.cash;
  if (purse < o.price + o.fuel + 20) return false;
  if (d.world !== load) {
    const lf = legFuel(d.world, load);
    const ok = p.corp ? takeRes(p.corp, d.sys, lf.k, true, lf.n) : govFuel(p.world, d.world, lf.k, lf.n);
    if (!ok) return false;
  }
  if (o.price > 0) {
    if (p.corp) p.corp.cash -= o.price; else p.world.gov.cash -= o.price;
    if (d.corp >= 0) corps[d.corp].cash += o.price; else if (d.gov) d.gov.gov.cash += o.price;
    if (d.sys !== load.sys) wantShip(d.sys, d.kind);      // и там, где купили
  }
  docks.splice(docks.indexOf(d), 1);
  return true;
}

/** Рейс с грузом из from в to на корабле d. Корабль не у погрузки — сперва
 *  порожний перегон к ней; груз уже оплачен и отложен и ждёт корабль. */
export function launch(d: Dock, kind: string, from: World, to: World, qty: number, relief?: number): Voyage {
  if (d.world === from) {
    const v = dispatch(from, to, kind, qty, d.parts);
    v.captain = d.captain;
    if (relief !== undefined) v.relief = relief;
    return v;
  }
  const v = dispatch(d.world, from, "empty", 0, d.parts);
  v.captain = d.captain;
  v.next = { kind, from, to, qty, relief };
  return v;
}

/** Порожний перегон дошёл до погрузки: берёт груз и уходит к получателю. */
export function loadUp(v: Voyage): void {
  const n = v.next;
  if (n.kind === "parts") {
    sendParts(n.lots, v.parts, v.captain);
    say("Командир " + v.captain + " принял " + n.lots.length + " дет. в " + n.from.body.name + " для " + corps[n.forCorp].name + ".");
    return;
  }
  const nv = dispatch(n.from, n.to, n.kind, n.qty, v.parts);
  nv.captain = v.captain;
  if (n.relief !== undefined) nv.relief = n.relief;
  say("Командир " + v.captain + " принял на " + n.from.body.name + " " +
      (n.kind === "pops" ? popsWord(n.qty) : n.qty + " еды") + " и идёт на " + n.to.body.name + ".");
}

/** Что рейс везёт или за чем идёт. Порожний перегон уже везёт то, за чем идёт:
 *  груз оплачен и отложен, и хлебовоз к миру, за которым послали корабль, —
 *  это уже хлебовоз, иначе мир заказал бы второй. */
export function cargoOf(v: Voyage): { kind: string; to: World; qty: number; relief?: number } {
  return v.kind === "empty" && v.next ? v.next : { kind: v.kind, to: v.to, qty: v.qty || 0, relief: v.relief };
}
export function cargoTo(kind: string, w: World): Voyage[] {
  return voyages.filter((v) => { const c = cargoOf(v); return c.kind === kind && c.to === w; });
}