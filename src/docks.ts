// ---- стоянка отработанных транспортников -----------------------------
// Хлебовоз и переселенческий после рейса не исчезают: корабль остаётся на
// орбите мира, куда пришёл, и виден там. Следующий рейс из этой системы
// возьмёт его вместо того, чтобы покупать корпус и трюм заново; чужой
// корабль покупают у хозяина за 60% от цены его деталей. Владелец — либо
// компания (частная помощь), либо правительство мира-получателя.

import { askPrice } from "./market";
import { L, S, corps, docks, market, systems } from "./state";
import { rnd6 } from "./util";
import { addStock, stockAt } from "./world";
import type { Corp, Dock, Part, Voyage, World } from "./types";

export function dockShip(v: Voyage): void {
  if (v.kind !== "food" && v.kind !== "pops") return;
  const s = systems[v.to.sys];
  const d = { kind: v.kind === "pops" ? "liner" : "cargo", parts:v.parts || [], captain:v.captain,
            sys:s.id, world:v.to, ang:rnd6(), since:S.tick,
            corp: v.relief !== undefined ? v.relief : -1, gov: v.relief !== undefined ? null : v.to } as Dock;
  // Дорожка запоминается у корабля, а не считается от места в общем массиве:
  // иначе списание одного заставляло всех остальных прыгнуть на другую орбиту.
  d.lane = docks.filter((x) => { return x.world === v.to; }).length % 3;
  docks.push(d);
  // на орбите одного мира больше шести не держат: старейший списывают
  const here = docks.filter((x) => { return x.world === v.to; });
  if (here.length > 6) docks.splice(docks.indexOf(here[0]), 1);
}
export function dockValue(d: Dock): number {
  return d.parts.reduce((a, p) => { return a + market[p.k].price; }, 0) * 0.6;
}
// payer — компания (corp) или мир (gov); берёт корабль нужного типа в системе
// need — что обязан нести корабль для ЭТОГО рейса: под движками между звёздами
// без двигателя не уйти, и корабль, пришедший внутрисистемным рейсом, не годится
export function fits(parts: Part[], need: Record<string, number>): boolean {
  const have: Record<string, number> = {};
  parts.forEach((p) => { have[p.k] = (have[p.k] || 0) + 1; });
  return Object.keys(need).every((k) => { return (have[k] || 0) >= need[k]; });
}
export function takeDock(payerCorp: Corp | null, payerWorld: World | null, sys: number, kind: string, need: Record<string, number>): Dock {
  let own: Dock = null, other: Dock = null;
  docks.forEach((d) => {
    if (d.sys !== sys || d.kind !== kind) return;
    if (need && !fits(d.parts, need)) return;
    const mine = payerCorp ? d.corp === payerCorp.id : d.gov === payerWorld;
    if (mine) own = own || d; else other = other || d;
  });
  const d = own || other;
  if (!d) return null;
  if (!own) {
    const price = dockValue(d), purse = payerCorp ? payerCorp.cash : payerWorld.gov.cash;
    if (purse < price + 20) return null;
    if (payerCorp) payerCorp.cash -= price; else payerWorld.gov.cash -= price;
    if (d.corp >= 0) corps[d.corp].cash += price; else if (d.gov) d.gov.gov.cash += price;
    S.trades++; S.turnover += price;
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
      const p = askPrice(seller, k) * (1 + L.tradeFee);
      if (c.cash < p + 20) { ok = false; return; }
      c.cash -= p; seller.cash += p / (1 + L.tradeFee); seller.sold++; S.treasury += p - p / (1 + L.tradeFee);
      addStock(seller, at.sys, k, -1); S.trades++; S.turnover += p;
      taken.push({ k:k, from:seller.id, price:p });
    }
  });
  if (!ok) { taken.forEach((t) => { addStock(corps[t.from], at.sys, t.k, 1); corps[t.from].cash -= t.price / (1 + L.tradeFee); c.cash += t.price; }); return null; }
  return taken.map((t) => { return { k:t.k, from:t.from }; });
}

