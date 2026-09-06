// ===================== рынок деталей =====================
// Ходовая цена — не закон, а память рынка: скользящее среднее по СОСТОЯВШИМСЯ
// сделкам плюс поправка на дефицит. От неё продавец и покупатель пляшут в
// торге, но сама по себе она никого ни к чему не обязывает.

import { COMPS, compOf, pickCaptain } from "./data";
import { freeRocks, releaseOrder } from "./orders";
import { L, S, corps, dateStr, market, patLive, patents, projects, say, systems, tickCache, voyages, worlds } from "./state";
import { speedOf } from "./tech";
import { canTravel } from "./travel";
import { clamp } from "./util";
import { addStock, firstStockSys, stockAt, totalStock } from "./world";
import type { Corp, Part, World } from "./types";

export function repriceMarket() {
  COMPS.forEach(function (f) {
    var m = market[f.key], stock = 0, want = 0, sellers: Corp[] = [];
    corps.forEach(function (c) {
      var have = totalStock(c, f.key);
      stock += have;
      if (have > 0) sellers.push(c);                   // индекс продавцов на этот тик
      if (c.order) want += Math.max(0, (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0));
    });
    if (!tickCache.sellers) tickCache.sellers = {};
    tickCache.sellers[f.key] = sellers;
    projects.forEach(function (pr) { want += Math.max(0, (pr.need[f.key] || 0) - (pr.got[f.key] || 0)); });
    // купленное и уже едущее — не спрос, а поставка: без этой поправки цена
    // годами карабкалась к потолку, пока грузовики были в пути
    voyages.forEach(function (v) { if (v.kind === "parts" && v.k === f.key) want -= v.qty; });
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
export function takeFuel(c: Corp, sys: number, k: string, direct?: boolean) {
  if (stockAt(c, sys, k) > 0) { addStock(c, sys, k, -1); return true; }
  var seller: Corp = null;
  corps.forEach(function (s) {
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
    var acct = c.fuelAcct[sys] || (c.fuelAcct[sys] = { fly:{} });
    if ((acct.fly[k] || 0) > 0) return false;
    buyPart(c, k, sys, 0.6,
            function (sum: number) { if (c.cash < sum + 10) return false; c.cash -= sum; return true; },
            function (part: Part) { addStock(c, sys, part.k, 1); }, true, acct);
    return false;
  }
  var price = market[k].price * (1 + L.tradeFee);
  if (c.cash < price + 10) return false;
  c.cash -= price; seller.cash += market[k].price; seller.sold++;
  S.treasury += price - market[k].price;
  addStock(seller, sys, k, -1);
  S.trades++; S.turnover += price; S.burned++;
  return true;
}
// есть ли в системе мира продавец топлива, и хватит ли казне — проверяется
// ДО покупки корабля, чтобы не остаться с оплаченным корпусом без горючего
export function govFuelAvail(payer: World, at: World, k: string) {
  var price = market[k].price * (1 + L.tradeFee);
  return payer.gov.cash >= price + 10 && corps.some(function (s) { return stockAt(s, at.sys, k) > 0; });
}
// правительство мира жжёт своё топливо так же, только платит из своей казны
export function govFuel(payer: World, at: World, k: string) {
  var seller: Corp = null;
  corps.forEach(function (s) {
    if (stockAt(s, at.sys, k) <= 0) return;
    if (!seller || stockAt(s, at.sys, k) > stockAt(seller, at.sys, k)) seller = s;
  });
  if (!seller) return false;
  var price = market[k].price * (1 + L.tradeFee);
  if (payer.gov.cash < price + 10) return false;
  payer.gov.cash -= price; seller.cash += market[k].price; seller.sold++;
  S.treasury += price - market[k].price;
  addStock(seller, at.sys, k, -1);
  S.trades++; S.turnover += price; S.burned++;
  return true;
}

// ---- торг -------------------------------------------------------------
// Продавец называет свою цену, покупатель — потолок, и сделка случается
// только если они пересеклись; итог делится пополам. Без этого "рынок" был
// наполовину декорацией: цена одна на всех и торговаться не о чем.
// После каждой попытки обе стороны подвигают свои притязания, поэтому цены
// сходятся сами, а жадный продавец какое-то время сидит без сделок.
export function askPrice(seller: Corp, k: string) {
  return market[k].price * clamp(seller.ask[k], 0.7, 2.2);
}
export function bidCap(buyer: Corp, k: string, urgency: number) {
  // чем дольше ждёт заказ и чем богаче покупатель, тем выше он готов задрать
  return market[k].price * clamp(0.9 + urgency * 0.5 + (buyer.cash > 1200 ? 0.15 : 0), 0.8, 2.0);
}
export function haggle(seller: Corp, buyer: Corp, k: string, urgency: number) {
  var ask = askPrice(seller, k), cap = bidCap(buyer, k, urgency);
  if (ask > cap) {                                   // не сошлись
    seller.ask[k] = clamp(seller.ask[k] - 0.02, 0.7, 2.2);
    return 0;
  }
  seller.ask[k] = clamp(seller.ask[k] + 0.012, 0.7, 2.2);
  var price = (ask + cap) / 2;
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
export function embKey(buyerId: number, k: string){ return buyerId + "|" + k; }

// Касса меняется прямо во время торгов, поэтому кешируются только активы —
// филиалы, основанные миры, предприятия, — а касса берётся живая. Иначе
// решения об отказе внутри тика чуть сдвигались, и партии расходились.
export function wealth(c: Corp) {
  var a = tickCache.wealth[c.id];
  if (a === undefined) {
    a = c.branches.length * 120;
    worlds.forEach(function (o) { if (o.founder === c.id) a += 220; });
    systems.forEach(function (s) { s.ventures.forEach(function (v) { if (v.lead === c.id) a += 160; }); });
    tickCache.wealth[c.id] = a;
  }
  return c.cash + a;
}
export function sameGoal(a: Corp, b: Corp) {
  if (a.order && b.order && a.order.type === b.order.type) return true;
  var pa = projects.some(function (p) { return p.lead === a.id; });
  var pb = projects.some(function (p) { return p.lead === b.id; });
  return pa && pb;
}
export function lastPrize() {
  if (tickCache.prize !== null) return tickCache.prize;
  var rocks = 0;
  systems.forEach(function (s) { if (s.unlocked) rocks += freeRocks(s).length; });
  tickCache.prize = rocks <= 2;
  return tickCache.prize;
}

export function willSell(seller: Corp, buyer: Corp, k: string) {
  var e = seller.embargo[embKey(buyer.id, k)];
  if (e && e > S.tick) return false;                    // отказ ещё в силе
  if (e && e <= S.tick) delete seller.embargo[embKey(buyer.id, k)];

  var f = compOf(k), rich = market[k].price / f.base;
  var refuse = 0.14;
  if (patLive(k) && patents[k].owner === seller.id) refuse += 0.30;  // это моя монополия
  if (sameGoal(seller, buyer)) refuse += 0.26;                       // метим в одно и то же
  if (wealth(buyer) > wealth(seller) * 1.25) refuse += 0.20;         // и он уже впереди
  if (lastPrize()) refuse += 0.15;                                   // делить почти нечего
  refuse *= seller.nerve;                                            // смелый душит охотнее
  refuse *= clamp(1.4 - rich * 0.5, 0.4, 1.4);                       // за дорого продаст и врагу
  if (seller.cash < 200) refuse *= 0.35;                             // бедному не до принципов
  refuse = clamp(refuse, 0, 0.92);

  if (Math.random() >= refuse) return true;
  seller.embargo[embKey(buyer.id, k)] = S.tick + 24 + Math.floor(Math.random() * 36);
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
export function stalledProjects() {
  for (var i = projects.length - 1; i >= 0; i--) {
    var pr = projects[i];
    var got = COMPS.reduce(function (a, f) { return a + (pr.got[f.key] || 0); }, 0);
    if (got !== pr.seen || pr.purse !== pr.seenPurse) {
      pr.seen = got; pr.seenPurse = pr.purse; pr.wait = 0; continue;
    }
    pr.wait = (pr.wait || 0) + 1;
    if (pr.wait < 84) continue;                    // семь лет без движения
    var blockers: Record<string, number> = {};
    COMPS.forEach(function (f) {
      if ((pr.need[f.key] || 0) - (pr.got[f.key] || 0) <= 0) return;
      corps.forEach(function (o) { if (o.embargo[embKey(pr.lead, f.key)] > S.tick) blockers[o.name] = 1; });
    });
    var who = Object.keys(blockers);
    // деньги возвращаются вкладчикам по долям, детали — ведущему на склад
    var total = pr.backers.reduce(function (a, b) { return a + b.sum; }, 0) || 1;
    pr.backers.forEach(function (b) { corps[b.corp].cash += pr.purse * b.sum / total; });
    pr.parts.forEach(function (p) { addStock(corps[pr.lead], pr.sys, p.k, 1); });
    pr.body.claimed = false;
    say("Подписка на колонию " + pr.body.name + " распалась" +
        (who.length ? ": " + who.join(" и ") + " не продают детали." : ": собрать нечего.") +
        " Деньги вернулись вкладчикам.");
    S.dropped++;
    projects.splice(i, 1);
  }
}

export function stalledOrders() {
  corps.forEach(function (c) {
    if (!c.order) return;
    var missing = COMPS.filter(function (f) {
      return (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0) > 0;
    });
    if (!missing.length) { c.order.wait = 0; return; }
    c.order.wait = (c.order.wait || 0) + 1;
    if (c.order.wait < 72) return;
    var blockers: Record<string, number> = {};
    missing.forEach(function (f) {
      corps.forEach(function (o) {
        if (o.embargo[embKey(c.id, f.key)] > S.tick) blockers[o.name] = 1;
      });
    });
    var who = Object.keys(blockers);
    say("<b>" + c.name + "</b> свернула сборку: " + missing.map(function (f) { return f.short; }).join(", ") +
        (who.length ? " не продают " + who.join(" и ") : " взять негде") + ".");
    // купленное остаётся на складе там, где собиралось; деньги не пропадают
    c.order.parts.forEach(function (p) { addStock(c, c.order.sys, p.k, 1); });
    releaseOrder(c.order);
    c.order = null; c.cool = 24; S.dropped++;
  });
}

// Покупка = договор о цене плюс ДОСТАВКА. Если деталь лежит в другой системе,
// она не появляется у покупателя по щелчку: за ней идёт грузовик, тратит
// межзвёздное топливо и летит годами. Купленное в пути видно на карте.
// acct — заказ или подписка, за которую покупают: в acct.fly считаются детали,
// уже оплаченные и летящие. Без этого счёта покупатель заказывал одно и то же
// каждый месяц, пока груз годами шёл, и в воздухе висели десятки грузовиков.
export function buyPart(buyer: Corp, k: string, dest: number, urgency: number, pay: any, take: any, noRefuse: boolean, acct: any) {
  // Кандидаты: сначала те, у кого деталь лежит прямо здесь, потом дальние.
  // Перебираем ВСЕХ: раньше брали одного, и если он отказывал, покупка
  // срывалась на месяц — при том, что у соседа та же деталь лежала без дела.
  // перебираем не все компании, а только тех, у кого деталь есть — индекс
  // построен в repriceMarket этим же тиком; до него каждая покупка сканировала
  // всех, и на шестидесяти компаниях это было главной статьёй расхода
  var cands: { s: Corp; from: number; n: number }[] = [];
  var pool: Corp[] = (tickCache.sellers && tickCache.sellers[k]) || corps;
  pool.forEach(function (s) {
    if (s.id === buyer.id) return;
    if (stockAt(s, dest, k) > 0) cands.push({ s:s, from:dest, n:stockAt(s, dest, k) });
    else if (totalStock(s, k) > 0) cands.push({ s:s, from:firstStockSys(s, k), n:0 });
  });
  cands.sort(function (a, b) { return b.n - a.n; });
  var seller: Corp = null, sysFrom = -1, price = 0;
  for (var i = 0; i < cands.length; i++) {
    var cnd = cands[i];
    if (!noRefuse && !willSell(cnd.s, buyer, k)) continue;
    if (cnd.from !== dest && !canTravel(cnd.from, dest)) continue;      // дороги нет
    var p = haggle(cnd.s, buyer, k, urgency);
    if (!p) continue;                                                   // не сошлись в цене
    seller = cnd.s; sysFrom = cnd.from; price = p;
    break;
  }
  if (!seller) return false;
  var full = price * (1 + L.tradeFee);
  if (!pay(full)) return false;

  addStock(seller, sysFrom, k, -1); seller.cash += price; seller.sold++;
  S.treasury += full - price; S.trades++; S.turnover += full; buyer.bought++;
  if (sysFrom === dest) { take({ k:k, from:seller.id }); return true; }
  // грузовик заправляется там, где грузится: топливо покупается у отправителя
  if (!takeFuel(buyer, sysFrom, "sfuel", true)) {                       // нечем везти
    addStock(seller, sysFrom, k, 1); seller.cash -= price; S.treasury -= full - price;
    S.trades--; S.turnover -= full;
    return false;
  }
  if (acct) { if (!acct.fly) acct.fly = {}; acct.fly[k] = (acct.fly[k] || 0) + 1; }
  voyages.push({ kind:"parts", sysFrom:sysFrom, to:dest, k:k, qty:1, corp:seller.id,
                 color:corps[seller.id].color, forCorp:buyer.id, acct:acct,
                 take:function (part: Part) {
                   if (acct && acct.fly) acct.fly[part.k] = Math.max(0, (acct.fly[part.k] || 0) - 1);
                   take(part);
                 },
                 t:0, dur:(140 + Math.random() * 50) / speedOf(seller.id), born:dateStr(), captain:pickCaptain() });
  S.hauled++;
  return true;
}

export function trade() {
  repriceMarket();
  corps.forEach(function (c) {
    if (!c.order) return;
    var urgency = Math.min(1, (c.order.wait || 0) / 48);
    COMPS.forEach(function (f) {
      var o = c.order;
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
              function (sum: number) { if (c.cash < sum + 25) return false; c.cash -= sum; return true; },
              function (part: Part) {
                // грузовик мог прилететь к уже свёрнутому заказу — тогда на склад
                if (c.order !== o) { addStock(c, o.sys, part.k, 1); return; }
                o.got[part.k] = (o.got[part.k] || 0) + 1; o.parts.push(part);
              }, false, o);
    });
  });
  projects.forEach(function (pr) {
    var urgency = Math.min(1, (pr.wait || 0) / 48), lead = corps[pr.lead];
    COMPS.forEach(function (f) {
      if (!pr.fly) pr.fly = {};
      if ((pr.need[f.key] || 0) - (pr.got[f.key] || 0) - (pr.fly[f.key] || 0) <= 0) return;
      // своё, лежащее на месте, ведущий продаёт консорциуму по ходовой
      if (stockAt(lead, pr.sys, f.key) > 0) {
        var p = market[f.key].price;
        if (pr.purse < p) return;
        pr.purse -= p; lead.cash += p; addStock(lead, pr.sys, f.key, -1);
        pr.got[f.key] = (pr.got[f.key] || 0) + 1; pr.parts.push({ k:f.key, from:lead.id });
        return;
      }
      buyPart(lead, f.key, pr.sys, urgency,
              function (sum: number) { if (pr.purse < sum) return false; pr.purse -= sum; return true; },
              function (part: Part) {
                if (projects.indexOf(pr) < 0) { addStock(lead, pr.sys, part.k, 1); return; }
                pr.got[part.k] = (pr.got[part.k] || 0) + 1; pr.parts.push(part);
              }, false, pr);
    });
  });
  // индекс продавцов верен только внутри торгов: позже в тике склады
  // сдвигаются, и танкер за топливом обязан видеть всех
  tickCache.sellers = null;
}

