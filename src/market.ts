// ===================== рынок деталей =====================
// Ходовая цена — не закон, а память рынка: скользящее среднее по СОСТОЯВШИМСЯ
// сделкам плюс поправка на дефицит. От неё продавец и покупатель пляшут в
// торге, но сама по себе она никого ни к чему не обязывает.

import { COMPS, compOf, pickCaptain, shipNeed, vtype } from "./data";
import { corpBuyShip, takeDock } from "./docks";
import { bestEngineAt } from "./tech";
import { freeRocks, releaseOrder } from "./orders";
import { L, S, corps, dateStr, docks, market, patLive, patents, projects, proposals, say, shipyards, systems, tickCache, voyages, worlds } from "./state";
import { canTravel, fuelCost, needWith, routeSpeed, travelExtra } from "./travel";
import { clamp } from "./util";
import { addStock, firstStockSys, stockAt, totalStock } from "./world";
import type { Corp, Part, Project, Voyage, World } from "./types";

import type { FlyAcct } from "./types";

import { rnd } from "./rng";

export function repriceMarket(): void {
  COMPS.forEach((f) => {
    let m = market[f.key], stock = 0, want = 0, sellers: Corp[] = [];
    corps.forEach((c) => {
      const have = totalStock(c, f.key);
      stock += have;
      if (have > 0) sellers.push(c);                   // индекс продавцов на этот тик
      if (c.order) want += Math.max(0, (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0));
    });
    if (!tickCache.sellers) tickCache.sellers = {};
    tickCache.sellers[f.key] = sellers;
    projects.forEach((pr) => { want += Math.max(0, (pr.need[f.key] || 0) - (pr.got[f.key] || 0)); });
    // купленное и уже едущее — не спрос, а поставка: без этой поправки цена
    // годами карабкалась к потолку, пока грузовики были в пути
    voyages.forEach((v) => { if (v.kind === "parts" && v.k === f.key) want -= v.qty; });
    want = Math.max(0, want);
    m.last = m.price;
    m.price = clamp(m.price * clamp(1 + 0.05 * (want - stock) / (want + stock + 2), 0.95, 1.06),
                    f.base * 0.35, f.base * 5);
    m.stock = stock; m.want = want;
  });
}

// ---- топливо ----------------------------------------------------------
// Топливом торгуют БЕЗ отказов: это расходник, на нём не выигрывают гонку, а
// запрет на него мгновенно запирает всю галактику и убивает партию. Берём
// своё, если есть в этой системе, иначе покупаем у соседа по цеху.
// n — сколько баков нужно на рейс: под воротами топливо жжётся на КАЖДОМ
// створе, и дальний конец сети обходится дороже ближнего.
export function takeFuel(c: Corp, sys: number, k: string, direct?: boolean, n?: number): boolean {
  const want = n || 1;
  if (stockAt(c, sys, k) >= want) { addStock(c, sys, k, -want); return true; }
  let seller: Corp = null;
  corps.forEach((s) => {
    if (s.id === c.id || stockAt(s, sys, k) <= 0) return;
    if (!seller || stockAt(s, sys, k) > stockAt(seller, sys, k)) seller = s;
  });
  if (!seller) {
    // В этой системе топлива нет — заказываем танкер из другой. Он приедет
    // через годы, и до тех пор корабль стоит. direct запрещает вложенный
    // заказ: танкеру за топливом для танкера ехать некуда.
    if (direct) return false;
    // танкер тоже заказывают один раз, а не каждый месяц: у топлива свой
    // счёт летящего на каждую систему
    if (!c.fuelAcct) c.fuelAcct = {};
    const acct = c.fuelAcct[sys] || (c.fuelAcct[sys] = { fly:{} });
    if ((acct.fly[k] || 0) > 0) return false;
    buyPart(c, k, sys, 0.6,
            (sum: number) => { if (c.cash < sum + 10) return false; c.cash -= sum; return true; },
            (part: Part) => { addStock(c, sys, part.k, 1); }, true, acct);
    return false;
  }
  const price = market[k].price * (1 + L.tradeFee);
  if (c.cash < price + 10) return false;
  c.cash -= price; seller.cash += market[k].price; seller.sold++;
  S.treasury += price - market[k].price;
  addStock(seller, sys, k, -1);
  S.trades++; S.turnover += price; S.burned++;
  return true;
}
// есть ли в системе мира продавец топлива, и хватит ли казне — проверяется
// ДО покупки корабля, чтобы не остаться с оплаченным корпусом без горючего
export function govFuelAvail(payer: World, at: World, k: string, n?: number): boolean {
  const want = n || 1;
  return payer.gov.cash >= fuelBill(k, want) + 10 && corps.some((s) => { return stockAt(s, at.sys, k) >= want; });
}
/** Во что обойдётся заправка: цена с наценкой за все баки. Считается в одном
 *  месте, потому что по этому счёту и проверяют кассу, и списывают с неё. */
export function fuelBill(k: string, n?: number): number {
  return market[k].price * (1 + L.tradeFee) * (n || 1);
}
// правительство мира жжёт своё топливо так же, только платит из своей казны
export function govFuel(payer: World, at: World, k: string, n?: number): boolean {
  const want = n || 1;
  let seller: Corp = null;
  corps.forEach((s) => {
    if (stockAt(s, at.sys, k) < want) return;
    if (!seller || stockAt(s, at.sys, k) > stockAt(seller, at.sys, k)) seller = s;
  });
  if (!seller) return false;
  const price = market[k].price * (1 + L.tradeFee) * want;
  if (payer.gov.cash < price + 10) return false;
  payer.gov.cash -= price; seller.cash += market[k].price * want; seller.sold++;
  S.treasury += price - market[k].price * want;
  addStock(seller, at.sys, k, -want);
  S.trades++; S.turnover += price; S.burned += want;
  return true;
}

// ---- торг -------------------------------------------------------------
// Продавец называет свою цену, покупатель — потолок, и сделка случается
// только если они пересеклись; итог делится пополам. Без этого "рынок" был
// наполовину декорацией: цена одна на всех и торговаться не о чем.
// После каждой попытки обе стороны подвигают свои притязания, поэтому цены
// сходятся сами, а жадный продавец какое-то время сидит без сделок.
export function askPrice(seller: Corp, k: string): number {
  return market[k].price * clamp(seller.ask[k], 0.7, 2.2);
}
export function bidCap(buyer: Corp, k: string, urgency: number): number {
  // чем дольше ждёт заказ и чем богаче покупатель, тем выше он готов задрать
  return market[k].price * clamp(0.9 + urgency * 0.5 + (buyer.cash > 1200 ? 0.15 : 0), 0.8, 2.0);
}
export function haggle(seller: Corp, buyer: Corp, k: string, urgency: number): number {
  const ask = askPrice(seller, k), cap = bidCap(buyer, k, urgency);
  if (ask > cap) {                                   // не сошлись
    seller.ask[k] = clamp(seller.ask[k] - 0.02, 0.7, 2.2);
    return 0;
  }
  seller.ask[k] = clamp(seller.ask[k] + 0.012, 0.7, 2.2);
  const price = (ask + cap) / 2;
  // ходовая цена подтягивается к состоявшейся сделке
  market[k].price = clamp(market[k].price * 0.96 + price * 0.04,
                          compOf(k).base * 0.35, compOf(k).base * 5);
  return price;
}
// ---- отказ продавать -------------------------------------------------
// Деталь на складе — это не товар, а рычаг. Продать двигатель тому, кто
// рвётся к последнему свободному астероиду, значит своими руками устроить
// его рывок. Поэтому продавец решает, а не автоматически меняет вещь на
// деньги. Решение ЗАПОМИНАЕТСЯ на годы: если перекидывать монетку каждый
// месяц, отказ ничего не значит — рано или поздно выпадет "да".
export function embKey(buyerId: number, k: string): string{ return buyerId + "|" + k; }

// Касса меняется прямо во время торгов, поэтому кешируются только активы —
// филиалы, основанные миры, предприятия, — а касса берётся живая. Иначе
// решения об отказе внутри тика чуть сдвигались, и партии расходились.
export function wealth(c: Corp): number {
  let a = tickCache.wealth[c.id];
  if (a === undefined) {
    a = c.branches.length * 120;
    worlds.forEach((o) => { if (o.founder === c.id) a += 220; });
    systems.forEach((s) => { s.ventures.forEach((v) => { if (v.lead === c.id) a += 160; }); });
    tickCache.wealth[c.id] = a;
  }
  return c.cash + a;
}
export function sameGoal(a: Corp, b: Corp): boolean {
  if (a.order && b.order && a.order.type === b.order.type) return true;
  const pa = projects.some((p) => { return p.lead === a.id; });
  const pb = projects.some((p) => { return p.lead === b.id; });
  return pa && pb;
}
export function lastPrize(): boolean {
  if (tickCache.prize !== null) return tickCache.prize;
  let rocks = 0;
  systems.forEach((s) => { if (s.unlocked) rocks += freeRocks(s).length; });
  tickCache.prize = rocks <= 2;
  return tickCache.prize;
}

export function willSell(seller: Corp, buyer: Corp, k: string): boolean {
  const e = seller.embargo[embKey(buyer.id, k)];
  if (e && e > S.tick) return false;                    // отказ ещё в силе
  if (e && e <= S.tick) delete seller.embargo[embKey(buyer.id, k)];

  const f = compOf(k), rich = market[k].price / f.base;
  let refuse = 0.14;
  if (patLive(k) && patents[k].owner === seller.id) refuse += 0.30;  // это моя монополия
  if (sameGoal(seller, buyer)) refuse += 0.26;                       // метим в одно и то же
  if (wealth(buyer) > wealth(seller) * 1.25) refuse += 0.20;         // и он уже впереди
  if (lastPrize()) refuse += 0.15;                                   // делить почти нечего
  refuse *= seller.nerve;                                            // смелый душит охотнее
  refuse *= clamp(1.4 - rich * 0.5, 0.4, 1.4);                       // за дорого продаст и врагу
  if (seller.cash < 200) refuse *= 0.35;                             // бедному не до принципов
  refuse = clamp(refuse, 0, 0.92);

  if (rnd() >= refuse) return true;
  seller.embargo[embKey(buyer.id, k)] = S.tick + 24 + Math.floor(rnd() * 36);
  S.refusals++;
  say("<b>" + seller.name + "</b> отказалась продавать " + f.name.toLowerCase() + " " + buyer.name + ".");
  return false;
}

// Заказ, который некому снабдить, не висит вечно: через шесть лет ожидания
// компания сворачивает сборку. Это и есть цена отказов — не все могут в
// принципе что-то запустить, и видно, кто именно перекрыл кислород.
// Подписка на колонию тоже обязана иметь предохранитель. Без него она висит
// вечно: деньги собраны, а корпус никто не продаёт — и планета всё это время
// помечена занятой, так что её не может взять никто другой. В прогоне из-за
// этого первая колония уезжала со сорокового года на сто четвёртый.
/** Подписка распалась: деньги вкладчикам по долям, детали ведущему на склад,
 *  планета снова свободна. Одна дверь на два повода — семь лет без движения
 *  (ниже) и исчезнувшая верфь (colony.ts, запустение мира). Пометку claimed
 *  снять обязан КАЖДЫЙ из них: пока она стоит, планету не возьмёт никто. */
export function dropProject(pr: Project, why: string): void {
  const total = pr.backers.reduce((a, b) => { return a + b.sum; }, 0) || 1;
  pr.backers.forEach((b) => { corps[b.corp].cash += pr.purse * b.sum / total; });
  pr.parts.forEach((p) => { addStock(corps[pr.lead], pr.sys, p.k, 1); });
  pr.body.claimed = false;
  say("Подписка на колонию " + pr.body.name + " распалась" + why + " Деньги вернулись вкладчикам.");
  S.dropped++;
  projects.splice(projects.indexOf(pr), 1);
}

/** Сборка свёрнута: купленное остаётся на складе там, где собиралось, занятое
 *  под неё (камень, маршрут) освобождается. Тоже одна дверь на два повода —
 *  шесть лет без деталей и исчезнувшая верфь. */
export function dropOrder(c: Corp, why: string): void {
  if (!c.order) return;
  say("<b>" + c.name + "</b> свернула сборку: " + why + ".");
  c.order.parts.forEach((p) => { addStock(c, c.order.sys, p.k, 1); });
  releaseOrder(c.order);
  c.order = null; c.cool = 24; S.dropped++;
}

export function stalledProjects(): void {
  for (let i = projects.length - 1; i >= 0; i--) {
    const pr = projects[i];
    const got = COMPS.reduce((a, f) => { return a + (pr.got[f.key] || 0); }, 0);
    if (got !== pr.seen || pr.purse !== pr.seenPurse) {
      pr.seen = got; pr.seenPurse = pr.purse; pr.wait = 0; continue;
    }
    pr.wait = (pr.wait || 0) + 1;
    if (pr.wait < 84) continue;                    // семь лет без движения
    const blockers: Record<string, number> = {};
    COMPS.forEach((f) => {
      if ((pr.need[f.key] || 0) - (pr.got[f.key] || 0) <= 0) return;
      corps.forEach((o) => { if (o.embargo[embKey(pr.lead, f.key)] > S.tick) blockers[o.name] = 1; });
    });
    const who = Object.keys(blockers);
    dropProject(pr, who.length ? ": " + who.join(" и ") + " не продают детали." : ": собрать нечего.");
  }
}

export function stalledOrders(): void {
  corps.forEach((c) => {
    if (!c.order) return;
    // Летящее вычитается: деталь в пути — это не нехватка, а доставка. Рейс идёт
    // 140-190 месяцев, порог сворачивания — 72, и без этой поправки заказ, у
    // которого всё уже куплено и летит, объявлялся застрявшим, сворачивался, а
    // компания покупала те же детали заново: четыре бура в воздухе вместо двух.
    const fly = c.order.fly || {};
    const missing = COMPS.filter((f) => {
      return (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0) - (fly[f.key] || 0) > 0;
    });
    if (!missing.length) { c.order.wait = 0; return; }
    c.order.wait = (c.order.wait || 0) + 1;
    if (c.order.wait < 72) return;
    const blockers: Record<string, number> = {};
    missing.forEach((f) => {
      corps.forEach((o) => {
        if (o.embargo[embKey(c.id, f.key)] > S.tick) blockers[o.name] = 1;
      });
    });
    const who = Object.keys(blockers);
    dropOrder(c, missing.map((f) => { return f.short; }).join(", ") +
                 (who.length ? " не продают " + who.join(" и ") : " взять негде"));
  });
}

// Покупка = договор о цене плюс ДОСТАВКА. Если деталь лежит в другой системе,
// она не появляется у покупателя по щелчку: за ней идёт грузовик, тратит
// межзвёздное топливо и летит годами. Купленное в пути видно на карте.
// acct — заказ или подписка, за которую покупают: в acct.fly считаются детали,
// уже оплаченные и летящие. Без этого счёта покупатель заказывал одно и то же
// каждый месяц, пока груз годами шёл, и в воздухе висели десятки грузовиков.
export function buyPart(buyer: Corp, k: string, dest: number, urgency: number, pay: (sum: number) => boolean, take: (part: Part) => void, noRefuse: boolean, acct: FlyAcct): boolean {
  // Кандидаты: сначала те, у кого деталь лежит прямо здесь, потом дальние.
  // Перебираем ВСЕХ: раньше брали одного, и если он отказывал, покупка
  // срывалась на месяц — при том, что у соседа та же деталь лежала без дела.
  // перебираем не все компании, а только тех, у кого деталь есть — индекс
  // построен в repriceMarket этим же тиком; до него каждая покупка сканировала
  // всех, и на шестидесяти компаниях это было главной статьёй расхода
  const cands: { s: Corp; from: number; n: number }[] = [];
  const pool: Corp[] = (tickCache.sellers && tickCache.sellers[k]) || corps;
  pool.forEach((s) => {
    if (s.id === buyer.id) return;
    if (stockAt(s, dest, k) > 0) cands.push({ s:s, from:dest, n:stockAt(s, dest, k) });
    else if (totalStock(s, k) > 0) cands.push({ s:s, from:firstStockSys(s, k), n:0 });
  });
  cands.sort((a, b) => { return b.n - a.n; });
  let seller: Corp = null, sysFrom = -1, price = 0;
  for (let i = 0; i < cands.length; i++) {
    const cnd = cands[i];
    if (!noRefuse && !willSell(cnd.s, buyer, k)) continue;
    if (cnd.from !== dest && !canTravel(cnd.from, dest)) continue;      // дороги нет
    const p = haggle(cnd.s, buyer, k, urgency);
    if (!p) continue;                                                   // не сошлись в цене
    seller = cnd.s; sysFrom = cnd.from; price = p;
    break;
  }
  if (!seller) return false;
  const full = price * (1 + L.tradeFee);
  if (!pay(full)) return false;

  addStock(seller, sysFrom, k, -1); seller.cash += price; seller.sold++;
  S.treasury += full - price; S.trades++; S.turnover += full; buyer.bought++;
  if (sysFrom === dest) { take({ k:k, from:seller.id }); return true; }
  const undo = (): boolean => {
    addStock(seller, sysFrom, k, 1); seller.cash -= price; S.treasury -= full - price;
    S.trades--; S.turnover -= full;
    return false;
  };
  // Грузовик — настоящий корабль, с корпусом, трюмом и ходовым двигателем, а
  // под движками ещё и с прыжковым: берётся со стоянки продавца в системе
  // погрузки, а нет — собирается из деталей, что лежат тут же. Раньше деталь
  // летела между звёздами сама по себе, без корабля и без двигателя, и была
  // единственным рейсом в игре, у которого нечем было определить скорость.
  const extra = travelExtra(sysFrom, dest);
  // платит за грузовик ПОКУПАТЕЛЬ: деталь нужна ему, и корабль остаётся его —
  // встанет на стоянку у него дома и повезёт следующую покупку
  const dk = takeDock(buyer, null, sysFrom, "cargo", needWith(vtype("cargo"), extra));
  let shipParts: Part[] = dk ? dk.parts : null;
  if (!shipParts) {
    const at = seller.branches.map((b) => { return b.world; }).find((w) => { return w.sys === sysFrom; })
            || worlds.find((w) => { return w.sys === sysFrom; });
    const buy = at ? shipNeed(vtype("cargo"), bestEngineAt(sysFrom), extra) : null;
    shipParts = buy ? corpBuyShip(buyer, at, buy) : null;
  }
  if (!shipParts) return undo();                                          // везти нечем
  // грузовик заправляется там, где грузится: топливо покупается у отправителя
  if (!takeFuel(buyer, sysFrom, "sfuel", true, fuelCost(sysFrom, dest))) {   // нечем везти
    if (dk) docks.push(dk); else shipParts.forEach((p) => { addStock(buyer, sysFrom, p.k, 1); });
    return undo();
  }
  if (acct) { if (!acct.fly) acct.fly = {}; acct.fly[k] = (acct.fly[k] || 0) + 1; }
  voyages.push({ kind:"parts", sysFrom:sysFrom, to:dest, k:k, qty:1, corp:seller.id, parts:shipParts, shipOwner:buyer.id,
                 color:corps[seller.id].color, forCorp:buyer.id, acct:acct,
                 take:(part: Part) => {
                   if (acct && acct.fly) acct.fly[part.k] = Math.max(0, (acct.fly[part.k] || 0) - 1);
                   take(part);
                 },
                 t:0, dur:(140 + rnd() * 50) / routeSpeed(sysFrom, dest, seller.id, shipParts), born:dateStr(),
                 captain:dk ? dk.captain : pickCaptain() });
  S.hauled++;
  return true;
}

// Счёт летящего закрывает посадка (take выше) — и другого конца у рейса не
// было: единственным способом исчезнуть была цель. Теперь конца два, и второй
// — перехват. Если груз просто выкинуть из voyages, счёт останется навсегда:
// покупателю нехватки не видно (деталь «летит»), stalledOrders каждый месяц
// обнуляет ожидание, и сборка висит вечно — ничего не докупает и не
// сворачивается, а контора с таким заказом больше не строит ничего. С
// топливом тише и хуже: танкер заказывают по одному на систему, и потерянный
// не заменяется никогда. Поэтому рейс, который не долетел, обязан пройти
// ЧЕРЕЗ эту дверь, а не через voyages.splice напрямую.
export function unfly(v: Voyage): void {
  if (!v.acct || !v.acct.fly || !v.k) return;
  v.acct.fly[v.k] = Math.max(0, (v.acct.fly[v.k] || 0) - 1);   // ровно то, что прибавили при покупке
}

export function trade(): void {
  repriceMarket();
  corps.forEach((c) => {
    if (!c.order) return;
    const urgency = Math.min(1, (c.order.wait || 0) / 48);
    COMPS.forEach((f) => {
      const o = c.order;
      // Купленное и ещё летящее — это уже НЕ потребность. Без этого счёта
      // заказ каждый месяц покупал корпус заново, пока предыдущие годами
      // летели: под восемьдесят грузовиков в воздухе и деньги на ветер.
      if (!o.fly) o.fly = {};
      if ((o.need[f.key] || 0) - (o.got[f.key] || 0) - (o.fly[f.key] || 0) <= 0) return;
      if (stockAt(c, o.sys, f.key) > 0) {                    // своё, и лежит где надо
        addStock(c, o.sys, f.key, -1);
        o.got[f.key] = (o.got[f.key] || 0) + 1;
        o.parts.push({ k:f.key, from:c.id });
        return;
      }
      buyPart(c, f.key, o.sys, urgency,
              (sum: number) => { if (c.cash < sum + 25) return false; c.cash -= sum; return true; },
              (part: Part) => {
                // грузовик мог прилететь к уже свёрнутому заказу — тогда на склад
                if (c.order !== o) { addStock(c, o.sys, part.k, 1); return; }
                o.got[part.k] = (o.got[part.k] || 0) + 1; o.parts.push(part);
              }, false, o);
    });
  });
  projects.forEach((pr) => {
    const urgency = Math.min(1, (pr.wait || 0) / 48), lead = corps[pr.lead];
    COMPS.forEach((f) => {
      if (!pr.fly) pr.fly = {};
      if ((pr.need[f.key] || 0) - (pr.got[f.key] || 0) - (pr.fly[f.key] || 0) <= 0) return;
      // своё, лежащее на месте, ведущий продаёт консорциуму по ходовой
      if (stockAt(lead, pr.sys, f.key) > 0) {
        const p = market[f.key].price;
        if (pr.purse < p) return;
        pr.purse -= p; lead.cash += p; addStock(lead, pr.sys, f.key, -1);
        pr.got[f.key] = (pr.got[f.key] || 0) + 1; pr.parts.push({ k:f.key, from:lead.id });
        return;
      }
      buyPart(lead, f.key, pr.sys, urgency,
              (sum: number) => { if (pr.purse < sum) return false; pr.purse -= sum; return true; },
              (part: Part) => {
                if (projects.indexOf(pr) < 0) { addStock(lead, pr.sys, part.k, 1); return; }
                pr.got[part.k] = (pr.got[part.k] || 0) + 1; pr.parts.push(part);
              }, false, pr);
    });
  });

  // Одобренная верфь: ведущий свозит детали на планету. Платит сам — это его
  // вклад сверх денег в складчину, как и у ведущего колонии.
  proposals.forEach((p) => {
    if (p.state !== "approved") return;
    const lead = corps[p.lead], sys = p.world.sys;
    COMPS.forEach((f) => {
      if (!p.fly) p.fly = {};
      if ((p.need[f.key] || 0) - (p.got[f.key] || 0) - (p.fly[f.key] || 0) <= 0) return;
      if (stockAt(lead, sys, f.key) > 0) {
        addStock(lead, sys, f.key, -1);
        p.got[f.key] = (p.got[f.key] || 0) + 1; p.parts.push({ k:f.key, from:lead.id });
        return;
      }
      buyPart(lead, f.key, sys, 0.5,
              (sum: number) => { if (lead.cash < sum + 25) return false; lead.cash -= sum; return true; },
              (part: Part) => {
                if (proposals.indexOf(p) < 0) { addStock(lead, sys, part.k, 1); return; }
                p.got[part.k] = (p.got[part.k] || 0) + 1; p.parts.push(part);
              }, false, p);
    });
  });
  // индекс продавцов верен только внутри торгов: позже в тике склады
  // сдвигаются, и танкер за топливом обязан видеть всех
  tickCache.sellers = null;
}

