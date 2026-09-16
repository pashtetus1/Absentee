// ---- стоянка отработанных транспортников -----------------------------
// Хлебовоз и переселенческий после рейса не исчезают: корабль остаётся на
// орбите мира, куда пришёл, и виден там. Следующий рейс из этой системы
// возьмёт его вместо того, чтобы покупать корпус и трюм заново; чужой
// корабль покупают у хозяина по цене БИРЖИ этой системы (ниже). Владелец —
// либо компания (частная помощь), либо правительство мира-получателя.

import { markOf } from "./data";
import { askPrice } from "./market";
import { L, S, corps, docks, market, shipMarket, systems } from "./state";
import { canTravel } from "./travel";
import { clamp, rnd6 } from "./util";
import { addStock, stockAt } from "./world";
import type { Corp, Dock, Part, ShipRow, Voyage, World } from "./types";

// ---- биржа кораблей ------------------------------------------------------
// Все корабли на стоянках выставлены на продажу, и цена у каждой системы СВОЯ:
// стоимость деталей корабля по ходовым ценам, умноженная на местный множитель.
// Раньше множитель был один на всю галактику и навсегда — 60%, — и корабль
// стоил одинаково там, где их скопился десяток, и там, где их ждут годами.
//
// Множитель ходит от спроса и предложения В ЭТОЙ СИСТЕМЕ:
//   предложение — сколько кораблей такого типа стоит здесь без дела сейчас;
//   спрос — сколько раз в год здесь ищут такой корабль (под погрузку) или
//           покупают, сглаженно за последние лет пять.
// Цена тянется к SHIP_START × √(спрос / предложение) — по 5% разрыва в месяц.
// Корабли копятся там, куда возят (хлебовоз остаётся у голодной колонии), и там
// же дешевеют, пока их не станет выгодно купить и перегнать; купили — спрос
// вырос, и цена отскакивает. Где корабли ищут и не находят — дорожают, и
// строить становится выгоднее.
//   Первая версия сдвигала множитель на 3% в месяц просто от простоя, и там, где
// корабли стояли, цена сидела на полу почти всегда: корабль стоит годами, а
// ищут его раз в полгода. Отношение спроса к предложению этим не страдает.
export const SHIP_START = 0.6;
export const SHIP_MIN = 0.15, SHIP_MAX = 1.5;
export const SHIP_PULL = 0.05;      // на какую долю разрыва цена сдвигается за месяц
export const SHIP_MEMORY = 60;      // за сколько месяцев сглаживается спрос

function shipRow(sys: number, kind: string): ShipRow {
  const key = sys + ":" + kind;
  return shipMarket[key] || (shipMarket[key] = { k: SHIP_START, want: 0, rate: 0 });
}
/** Здесь искали или купили корабль такого типа: это спрос. */
export function wantShip(sys: number, kind: string): void { shipRow(sys, kind).want++; }
/** Местный множитель к стоимости деталей. */
export function shipFactor(sys: number, kind: string): number {
  const row = shipMarket[sys + ":" + kind];
  return row ? row.k : SHIP_START;
}
/** Раз в месяц: множители тянутся за спросом и предложением. */
export function repriceShips(): void {
  const idle: Record<string, number> = {};
  docks.forEach((d) => { shipRow(d.sys, d.kind); const k = d.sys + ":" + d.kind; idle[k] = (idle[k] || 0) + 1; });
  Object.keys(shipMarket).forEach((key) => {
    const row = shipMarket[key];
    row.rate += (row.want * 12 - row.rate) / SHIP_MEMORY;
    row.want = 0;
    const target = clamp(SHIP_START * Math.sqrt((row.rate + 0.5) / ((idle[key] || 0) + 0.5)), SHIP_MIN, SHIP_MAX);
    row.k += (target - row.k) * SHIP_PULL;
  });
}

export function dockShip(v: Voyage): void {
  let world: World, corp: number, gov: World | null;
  if (v.kind === "food" || v.kind === "pops") {
    world = v.to; corp = v.relief !== undefined ? v.relief : -1; gov = v.relief !== undefined ? null : v.to;
  } else if ((v.kind === "parts" || v.kind === "ore") && v.parts && v.parts.length) {
    // грузовик покупателя остаётся на орбите первого заселённого мира системы;
    // в системе без миров ему негде встать — списывается
    const b = systems[v.to].bodies.find((o) => { return o.world; });
    if (!b) return;
    world = b.world; corp = v.shipOwner !== undefined ? v.shipOwner : v.corp; gov = null;
  } else return;
  const d = { kind: v.kind === "pops" ? "liner" : "cargo", parts:v.parts || [], captain:v.captain,
            sys:world.sys, world:world, ang:rnd6(), since:S.tick, corp:corp, gov:gov } as Dock;
  // Дорожка запоминается у корабля, а не считается от места в общем массиве:
  // иначе списание одного заставляло всех остальных прыгнуть на другую орбиту.
  d.lane = docks.filter((x) => { return x.world === world; }).length % 3;
  // Потолка на стоянку нет. Был: больше шести на орбите одного мира не держали,
  // старейший списывали. Замер по 24 партиям показал, что он не срабатывал ни
  // разу (в среднем 1.8 корабля на всех стоянках), а корабль, собранный годами,
  // пропадать просто так не должен.
  docks.push(d);
}
/** Сколько стоят детали корабля по ходовым ценам — во столько обошлось бы
 *  собрать такой же. */
export function partsValue(parts: Part[]): number {
  return parts.reduce((a, p) => { return a + market[p.k].price; }, 0);
}
/** Цена корабля на бирже его системы. */
export function dockValue(d: Dock): number {
  return partsValue(d.parts) * shipFactor(d.sys, d.kind);
}
// payer — компания (corp) или мир (gov); берёт корабль нужного типа в системе
// need — что обязан нести корабль для ЭТОГО рейса: под движками между звёздами
// без двигателя не уйти, и корабль, пришедший внутрисистемным рейсом, не годится
export function fits(parts: Part[], need: Record<string, number>): boolean {
  const have: Record<string, number> = {};
  let marks = 0;
  parts.forEach((p) => { have[p.k] = (have[p.k] || 0) + 1; if (markOf(p.k)) marks++; });
  // прыжковый двигатель ЛЮБОЙ марки годится: между звёздами уйдёт и на Mk1,
  // просто медленнее — корабль со стоянки не бракуют за старый двигатель
  return Object.keys(need).every((k) => { return (markOf(k) ? marks : have[k] || 0) >= need[k]; });
}
export function takeDock(payerCorp: Corp | null, payerWorld: World | null, sys: number, kind: string, need: Record<string, number>): Dock {
  let own: Dock = null, other: Dock = null;
  // Свою систему предпочитаем, но берём и из достижимой: перегон корабля к
  // месту погрузки отдельным рейсом не считаем — он уходит в срок самого рейса.
  let ownFar: Dock = null, otherFar: Dock = null;
  wantShip(sys, kind);                         // корабль здесь искали — это спрос
  docks.forEach((d) => {
    if (d.kind !== kind) return;
    if (need && !fits(d.parts, need)) return;
    const here = d.sys === sys;
    if (!here && !canTravel(d.sys, sys)) return;
    const mine = payerCorp ? d.corp === payerCorp.id : d.gov === payerWorld;
    if (mine) { if (here) own = own || d; else ownFar = ownFar || d; }
    else { if (here) other = other || d; else otherFar = otherFar || d; }
  });
  own = own || ownFar; other = other || otherFar;
  const d = own || other;
  if (!d) return null;
  if (!own) {
    const price = dockValue(d), purse = payerCorp ? payerCorp.cash : payerWorld.gov.cash;
    if (purse < price + 20) return null;
    if (payerCorp) payerCorp.cash -= price; else payerWorld.gov.cash -= price;
    if (d.corp >= 0) corps[d.corp].cash += price; else if (d.gov) d.gov.gov.cash += price;
    S.trades++; S.turnover += price;
    if (d.sys !== sys) wantShip(d.sys, kind);  // и там, где купили
  }
  docks.splice(docks.indexOf(d), 1);
  return d;
}

// ---- частная помощь ---------------------------------------------------
// Компания с филиалом на голодающем мире не ждёт правительство: она сама
// покупает еду и хлебовоз и шлёт их — из корысти, не из милосердия. Семь лет
// голода — и мир отделяется, забирая филиал; дешевле накормить. Помощь идёт
// не чаще раза в два года на мир, и только пока у компании есть деньги.
export function corpBuyShip(c: Corp, at: World, need: Record<string, number>): { k: string; from: number; }[] {
  let taken: Part[] = [], ok = true;
  Object.keys(need).forEach((k) => {
    for (let i = 0; i < need[k]; i++) {
      if (!ok) return;
      if (stockAt(c, at.sys, k) > 0) { addStock(c, at.sys, k, -1); taken.push({ k:k, from:c.id, price:0 }); continue; }
      let seller: Corp = null;
      corps.forEach((s) => {
        if (s.id === c.id || stockAt(s, at.sys, k) <= 0) return;
        if (!seller || stockAt(s, at.sys, k) > stockAt(seller, at.sys, k)) seller = s;
      });
      if (!seller) { ok = false; return; }
      const p = askPrice(seller, k, at.sys) * (1 + L.tradeFee);
      if (c.cash < p + 20) { ok = false; return; }
      c.cash -= p; seller.cash += p / (1 + L.tradeFee); seller.sold++; S.treasury += p - p / (1 + L.tradeFee);
      addStock(seller, at.sys, k, -1); S.trades++; S.turnover += p;
      taken.push({ k:k, from:seller.id, price:p });
    }
  });
  if (!ok) { taken.forEach((t) => { addStock(corps[t.from], at.sys, t.k, 1); corps[t.from].cash -= t.price / (1 + L.tradeFee); c.cash += t.price; }); return null; }
  return taken.map((t) => { return { k:t.k, from:t.from }; });
}

