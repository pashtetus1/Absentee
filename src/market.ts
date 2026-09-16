// ===================== рынок деталей =====================
// Ходовая цена — не закон, а память рынка: скользящее среднее по СОСТОЯВШИМСЯ
// сделкам плюс поправка на дефицит. От неё продавец и покупатель пляшут в
// торге, но сама по себе она никого ни к чему не обязывает.

import { COMPS, ORES, compOf, isOre, pickCaptain, shipNeed, vtype } from "./data";
import { addLot, lotsOf, unflyLot } from "./freight";
import { bestEngineAt } from "./tech";
import { freeRocks, releaseOrder } from "./orders";
import { L, S, corps, dateStr, docks, freight, local, market, patLive, patents, projects, proposals, say, shipyards, systems, tickCache, voyages, worlds } from "./state";
import { canTravel, fuelCost, needWith, routeSpeed, travelExtra } from "./travel";
import { clamp } from "./util";
import { addStock, firstStockSys, stockAt, totalStock } from "./world";
import type { Consign, Corp, MarketRow, Order, Part, Project, Proposal, Voyage, World } from "./types";

import type { FlyAcct } from "./types";

import { rnd } from "./rng";

export function repriceMarket(): void {
  // Купленное и уже едущее — не спрос, а поставка: без этой поправки цена
  // годами карабкалась к потолку, пока грузовики были в пути. Считается это
  // ОДИН раз на тик, а не заново под каждую деталь: рейсов бывают десятки,
  // деталей за сорок, и перебор одного внутри другого обходился дороже, чем всё
  // остальное ценообразование вместе. Числа те же до последнего знака —
  // меняется только порядок счёта.
  const fly: Record<string, number> = {};
  voyages.forEach((v) => { lotsOf(v).forEach((l) => { fly[l.k] = (fly[l.k] || 0) + 1; }); });
  freight.forEach((l) => { fly[l.k] = (fly[l.k] || 0) + 1; });   // купленное на погрузке — тоже поставка
  COMPS.forEach((f) => {
    let m = market[f.key], stock = 0, want = 0, sellers: Corp[] = [];
    // Сырьё ценится ПО СИСТЕМАМ (repriceLocal ниже), а в market у него стоит
    // средняя по галактике. Общий счёт спроса и склада ему всё равно нужен:
    // по нему видно, много ли его вообще и кто им торгует.
    if (isOre(f.key)) {
      corps.forEach((c) => {
        const have = totalStock(c, f.key);
        stock += have;
        if (have > 0) sellers.push(c);
      });
      if (!tickCache.sellers) tickCache.sellers = {};
      tickCache.sellers[f.key] = sellers;
      m.stock = stock;
      return;
    }
    corps.forEach((c) => {
      const have = totalStock(c, f.key);
      stock += have;
      if (have > 0) sellers.push(c);                   // индекс продавцов на этот тик
      if (c.order) want += Math.max(0, (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0));
    });
    if (!tickCache.sellers) tickCache.sellers = {};
    tickCache.sellers[f.key] = sellers;
    projects.forEach((pr) => { want += Math.max(0, (pr.need[f.key] || 0) - (pr.got[f.key] || 0)); });
    want -= fly[f.key] || 0;
    want = Math.max(0, want);
    m.last = m.price;
    m.price = clamp(m.price * clamp(1 + 0.05 * (want - stock) / (want + stock + 2), 0.95, 1.06),
                    f.base * 0.35, f.base * 5);
    m.stock = stock; m.want = want;
  });
}

// ---- сырьё: своя цена в каждой системе ---------------------------------
// Деталь стоит одинаково по всей галактике, и это честно: её везут откуда
// угодно, она не портится и ждёт покупателя сколько надо. С сырьём не так. Вар
// жгут там, где стоит корабль, металл съедает цех той планеты, где он стоит, а
// энергию выпивают люди того мира, на который её привезли. Поэтому у сырья
// цена МЕСТНАЯ: у камня, с которого его добыли, оно почти ничего не стоит, а за
// пять звёзд, где его ждут, — втрое дороже. Разница этих двух цен и есть весь
// смысл транспортника.
//
// Коридор у местной цены уже, чем у детали (0.45..3 базы против 0.35..5):
// сырьё — расходник, и вилка в семь раз между двумя концами галактики уже
// делает перевозку выгоднее любой добычи.
export const ORE_LOW = 0.45, ORE_HIGH = 3;
/** Память спроса: съеденное в этом месяце забывается за год. */
export const USE_MEMORY = 12;

export function localKey(sys: number, k: string): string { return sys + "|" + k; }
/** Строка местного рынка; заводится при первом обращении — по базовой цене. */
export function localRow(sys: number, k: string): MarketRow {
  const key = localKey(sys, k), row = local[key];
  if (row) return row;
  const base = compOf(k).base;
  return (local[key] = { price: base, last: base, want: 0, stock: 0 });
}
/** Почём это здесь. У детали цена одна на галактику, у сырья — своя в каждой
 *  системе, и спрашивать её надо ИМЕННО ЗДЕСЬ: тем и живёт торговля. */
export function priceAt(k: string, sys: number): number {
  return isOre(k) ? localRow(sys, k).price : market[k].price;
}
/** Сырьё здесь съели: спрос запоминается на год и тянет местную цену вверх. */
export function noteUse(sys: number, k: string, n: number): void {
  const s = systems[sys];
  if (!s) return;
  if (!s.use) s.use = {};
  s.use[k] = (s.use[k] || 0) + n;
}
/** Есть ли это сырьё в галактике вообще: лежит у кого-нибудь или его качает
 *  живая платформа. Без вара не взлетает ничего, без металла не делается ни
 *  одна деталь — и заказ, который нечем будет спустить, лучше не начинать. */
export function anyRes(k: string): boolean {
  if (corps.some((c) => totalStock(c, k) > 0)) return true;
  return systems.some((s) => s.ventures.some((v) => v.live && v.kind === k));
}

/** Месячная пересчётка местных цен. Спрос — сколько сырья здесь съели за
 *  последний год (s.use, с затуханием), предложение — сколько его здесь лежит
 *  прямо сейчас. Там, где лежит годовой запас, цена падает к полу; там, где
 *  жгут, а на складе пусто, — упирается в потолок. */
export function repriceLocal(): void {
  const have: Record<string, number> = {};
  corps.forEach((c) => {
    for (const sys in c.stock) {
      const row = c.stock[sys];
      ORES.forEach((k) => { if (row[k] > 0) have[sys + "|" + k] = (have[sys + "|" + k] || 0) + row[k]; });
    }
  });
  const sum: Record<string, number> = {}, weight: Record<string, number> = {};
  systems.forEach((s) => {
    if (!s.use) s.use = {};
    ORES.forEach((k) => {
      const key = localKey(s.id, k);
      const use = s.use[k] || 0, stock = have[key] || 0;
      // Строк на пустом месте не заводим: пятьдесят систем на четыре вещества —
      // это две сотни записей в сохранении, из которых почти все были бы про
      // звезду, где никто ничего не жёг и не добывал.
      if (!use && !stock && !local[key]) return;
      const row = localRow(s.id, k), base = compOf(k).base;
      row.last = row.price;
      row.want = use; row.stock = stock;
      // МЁРТВЫЙ РЫНОК СПОЛЗАЕТ К ПОЛУ. Система, где это сырьё никто не жжёт и
      // никто не держит, — не «рынок по базовой цене», а место, где за него не
      // дадут ничего: везти туда некому и незачем. Пока цена там стояла на
      // базе, она выглядела лучшей в галактике, и сырьевые рейсы уходили в
      // пустые системы, где груз ложился мёртвым грузом.
      row.price = use + stock <= 0
        ? Math.max(base * ORE_LOW, row.price * 0.98)
        : clamp(row.price * clamp(1 + 0.06 * (use - stock) / (use + stock + 2), 0.94, 1.07),
                base * ORE_LOW, base * ORE_HIGH);
      s.use[k] = use * (1 - 1 / USE_MEMORY);
      // Средняя по галактике — по складу: цена в системе, где лежит сотня
      // единиц, весит больше, чем в той, где не лежит ничего.
      const w = stock + 0.5;
      sum[k] = (sum[k] || 0) + row.price * w; weight[k] = (weight[k] || 0) + w;
    });
  });
  ORES.forEach((k) => {
    const m = market[k];
    m.last = m.price;
    if (weight[k]) m.price = sum[k] / weight[k];
  });
}

// ---- топливо и прочее сырьё -------------------------------------------
// Сырьём торгуют БЕЗ отказов: это расходник, на нём не выигрывают гонку, а
// запрет на него мгновенно запирает всю галактику и убивает партию. Берём
// своё, если есть в этой системе, иначе покупаем у соседа по цеху.
// n — сколько единиц нужно: под воротами топливо жжётся на КАЖДОМ створе, и
// дальний конец сети обходится дороже ближнего; цеху на корпус нужно пять
// металла, а на трюм один.
export function takeRes(c: Corp, sys: number, k: string, direct?: boolean, n?: number): boolean {
  const want = n || 1;
  const own = Math.min(want, stockAt(c, sys, k));
  const need = want - own;
  if (need > 0) {
    // Кто продаст: все, у кого это лежит В ЭТОЙ системе, от самого запасливого.
    // Берём у нескольких, если у одного не хватает: три бака просини на дальний
    // конец сети редко находятся в одних руках.
    const sellers = corps.filter((s) => { return s.id !== c.id && stockAt(s, sys, k) > 0; })
                         .sort((a, b) => { return stockAt(b, sys, k) - stockAt(a, sys, k); });
    const pool = sellers.reduce((a, s) => { return a + stockAt(s, sys, k); }, 0);
    if (pool < need) {
      // В этой системе сырья не хватает — заказываем подвоз из другой. Он
      // приедет через годы, и до тех пор корабль стоит, а цех не работает.
      // direct запрещает вложенный заказ: танкеру за варом для танкера ехать
      // некуда.
      if (!direct) orderRes(c, sys, k);
      return false;
    }
    const price = priceAt(k, sys) * (1 + L.tradeFee);
    if (c.cash < price * need + 10) return false;
    let left = need;
    sellers.forEach((s) => {
      if (left <= 0) return;
      const take = Math.min(left, stockAt(s, sys, k));
      left -= take;
      addStock(s, sys, k, -take);
      c.cash -= price * take; s.cash += price * take / (1 + L.tradeFee); s.sold++;
      S.treasury += (price - price / (1 + L.tradeFee)) * take;
      S.trades++; S.turnover += price * take;
    });
  }
  if (own > 0) addStock(c, sys, k, -own);
  spend(sys, k, want);
  return true;
}
/** Заказать подвоз сырья в эту систему: купить его там, где оно есть, и
 *  положить на свой склад здесь. НИЧЕГО НЕ РАСХОДУЕТ — это заказ, а не расход,
 *  и звать его можно каждый месяц: подвоз заказывают ОДИН раз, пока летит
 *  предыдущий, и на это у каждой системы свой счёт летящего. */
export function orderRes(c: Corp, sys: number, k: string): void {
  if (!c.resAcct) c.resAcct = {};
  const acct = c.resAcct[sys] || (c.resAcct[sys] = { fly:{} });
  if ((acct.fly[k] || 0) > 0) return;
  buyPart(c, k, sys, 0.6,
          (sum: number) => { if (c.cash < sum + 10) return false; c.cash -= sum; return true; },
          "stock", true, acct);
}
/** Сырьё СЪЕДЕНО здесь: спрос в местную цену, и, если это топливо, ещё и в
 *  счётчик сожжённого. Одна дверь на все расходы, потому что и цена, и счётчик
 *  врут одинаково, когда расход мимо неё проходит. */
export function spend(sys: number, k: string, n: number): void {
  noteUse(sys, k, n);
  if (k === "fuel" || k === "sfuel") S.burned += n;
}
// есть ли в системе мира продавец топлива, и хватит ли казне — проверяется
// ДО покупки корабля, чтобы не остаться с оплаченным корпусом без горючего
export function govFuelAvail(payer: World, at: World, k: string, n?: number): boolean {
  const want = n || 1;
  return payer.gov.cash >= fuelBill(k, want, at.sys) + 10 &&
         corps.some((s) => { return stockAt(s, at.sys, k) >= want; });
}
/** Во что обойдётся заправка ЗДЕСЬ: местная цена с наценкой за все баки.
 *  Считается в одном месте, потому что по этому счёту и проверяют кассу, и
 *  списывают с неё. Система обязательна: у вара в разных концах галактики
 *  цена разная, и прикидка по средней обманула бы кассу в обе стороны. */
export function fuelBill(k: string, n: number, sys: number): number {
  return priceAt(k, sys) * (1 + L.tradeFee) * (n || 1);
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
  const net = priceAt(k, at.sys) * want, price = net * (1 + L.tradeFee);
  if (payer.gov.cash < price + 10) return false;
  payer.gov.cash -= price; seller.cash += net; seller.sold++;
  S.treasury += price - net;
  addStock(seller, at.sys, k, -want);
  S.trades++; S.turnover += price;
  spend(at.sys, k, want);
  return true;
}

// ---- торг -------------------------------------------------------------
// Продавец называет свою цену, покупатель — потолок, и сделка случается
// только если они пересеклись; итог делится пополам. Без этого "рынок" был
// наполовину декорацией: цена одна на всех и торговаться не о чем.
// После каждой попытки обе стороны подвигают свои притязания, поэтому цены
// сходятся сами, а жадный продавец какое-то время сидит без сделок.
// Цена, от которой пляшет торг, — МЕСТНАЯ (priceAt): у детали она одна на
// галактику, у сырья своя в каждой системе, и торговаться о варе по средней
// цене значило бы не заметить, что здесь его девать некуда, а там за него
// дерутся. Система — та, ГДЕ ЛЕЖИТ ТОВАР: продавец назначает цену по своему
// складу, покупатель соглашается или нет.
export function askPrice(seller: Corp, k: string, sys: number): number {
  return priceAt(k, sys) * clamp(seller.ask[k], 0.7, 2.2);
}
export function bidCap(buyer: Corp, k: string, urgency: number, sys: number): number {
  // чем дольше ждёт заказ и чем богаче покупатель, тем выше он готов задрать
  return priceAt(k, sys) * clamp(0.9 + urgency * 0.5 + (buyer.cash > 1200 ? 0.15 : 0), 0.8, 2.0);
}
export function haggle(seller: Corp, buyer: Corp, k: string, urgency: number, sys: number): number {
  const ask = askPrice(seller, k, sys), cap = bidCap(buyer, k, urgency, sys);
  if (ask > cap) {                                   // не сошлись
    seller.ask[k] = clamp(seller.ask[k] - 0.02, 0.7, 2.2);
    return 0;
  }
  seller.ask[k] = clamp(seller.ask[k] + 0.012, 0.7, 2.2);
  const price = (ask + cap) / 2;
  // ходовая цена подтягивается к состоявшейся сделке — та самая, по которой
  // торговались: местная у сырья, галактическая у детали
  const base = compOf(k).base;
  if (isOre(k)) {
    const row = localRow(sys, k);
    row.price = clamp(row.price * 0.96 + price * 0.04, base * ORE_LOW, base * ORE_HIGH);
  } else {
    market[k].price = clamp(market[k].price * 0.96 + price * 0.04, base * 0.35, base * 5);
  }
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
  // «Последний астероид» считается по ВСЕМУ, что хоть кто-то знает: делить
  // галактику конторы начинают ровно тогда, когда свободных камней мало у
  // всех вместе, а не у каждого по отдельности.
  systems.forEach((s) => { if (s.unlocked) rocks += freeRocks(s).length; });
  tickCache.prize = rocks <= 2;
  return tickCache.prize;
}

export function willSell(seller: Corp, buyer: Corp, k: string): boolean {
  // Сырьём не отказывают торговать НИКОГДА, и это не поблажка, а то же
  // правило, что было у топлива: расходником запирают не соперника, а
  // галактику. Без вара не взлетает ни один корабль, без металла не делается
  // ни одна деталь — и одна обиженная контора остановила бы всех разом.
  if (isOre(k)) return true;
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

// ---- кому достанется деталь -------------------------------------------
// Раньше это было ЗАМЫКАНИЕ, которое покупатель вкладывал в рейс: грузовик нёс
// с собой функцию, знавшую и счёт летящего, и заказ, к которому деталь
// приписана. Пока партия жила только в памяти вкладки, разницы не было.
// Сохранению функцию не записать ничем — и рейс с деталью оказался
// единственным, что нельзя уложить в файл. Теперь на рейсе лежит запись:
// consign — куда деталь, acct — в чей счёт, forCorp — кому. Поведение то же
// до числа, проверено сличителем (test/compare.ts).
function giveTo(buyer: Corp, dest: number, to: Consign, acct: FlyAcct, part: Part): void {
  if (to === "order") {
    const o = acct as Order;
    // грузовик мог прилететь к уже свёрнутому заказу — тогда на склад
    if (buyer.order !== o) { addStock(buyer, o.sys, part.k, 1); return; }
    o.got[part.k] = (o.got[part.k] || 0) + 1; o.parts.push(part);
    return;
  }
  if (to === "project") {
    const pr = acct as Project;
    if (projects.indexOf(pr) < 0) { addStock(buyer, pr.sys, part.k, 1); return; }
    pr.got[part.k] = (pr.got[part.k] || 0) + 1; pr.parts.push(part);
    return;
  }
  if (to === "proposal") {
    const p = acct as Proposal;
    if (proposals.indexOf(p) < 0) { addStock(buyer, p.world.sys, part.k, 1); return; }
    p.got[part.k] = (p.got[part.k] || 0) + 1; p.parts.push(part);
    return;
  }
  addStock(buyer, dest, part.k, 1);            // топливо просто ложится на склад
}

/** Рейс с деталью долетел: закрыть счёт летящего и выдать деталь тому, кому
 *  она куплена. Второй конец у покупки один, и он здесь. */
export function landPart(v: Voyage): void {
  lotsOf(v).forEach((l) => {
    unflyLot(l);
    giveTo(corps[l.owner], l.dest, l.consign, l.acct, { k:l.k, from:l.from });
  });
}

// Покупка = договор о цене плюс ДОСТАВКА. Если деталь лежит в другой системе,
// она не появляется у покупателя по щелчку: за ней идёт грузовик, тратит
// межзвёздное топливо и летит годами. Купленное в пути видно на карте.
// acct — заказ или подписка, за которую покупают: в acct.fly считаются детали,
// уже оплаченные и летящие. Без этого счёта покупатель заказывал одно и то же
// каждый месяц, пока груз годами шёл, и в воздухе висели десятки грузовиков.
export function buyPart(buyer: Corp, k: string, dest: number, urgency: number, pay: (sum: number) => boolean, to: Consign, noRefuse: boolean, acct: FlyAcct): boolean {
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
    const p = haggle(cnd.s, buyer, k, urgency, cnd.from);
    if (!p) continue;                                                   // не сошлись в цене
    seller = cnd.s; sysFrom = cnd.from; price = p;
    break;
  }
  if (!seller) return false;
  const full = price * (1 + L.tradeFee);
  if (!pay(full)) return false;

  addStock(seller, sysFrom, k, -1); seller.cash += price; seller.sold++;
  S.treasury += full - price; S.trades++; S.turnover += full; buyer.bought++;
  if (sysFrom === dest) { giveTo(buyer, dest, to, acct, { k:k, from:seller.id }); return true; }
  // Деталь из другой системы ложится НА ПОГРУЗКУ и ждёт грузовик (freight.ts).
  // Раньше грузовик находился или собирался прямо здесь, в тот же месяц: со
  // стоянки — будто он уже у причала, а без неё — из деталей со складов, мимо
  // верфи. И на каждую деталь свой рейс со своим баком.
  addLot(buyer, k, seller.id, sysFrom, dest, to, acct);
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
  lotsOf(v).forEach(unflyLot);                    // ровно то, что прибавили при покупке
}

export function trade(): void {
  repriceMarket();
  repriceLocal();
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
              "order", false, o);
    });
  });
  projects.forEach((pr) => {
    const urgency = Math.min(1, (pr.wait || 0) / 48), lead = corps[pr.lead];
    COMPS.forEach((f) => {
      if (!pr.fly) pr.fly = {};
      if ((pr.need[f.key] || 0) - (pr.got[f.key] || 0) - (pr.fly[f.key] || 0) <= 0) return;
      // своё, лежащее на месте, ведущий продаёт консорциуму по ходовой
      if (stockAt(lead, pr.sys, f.key) > 0) {
        const p = priceAt(f.key, pr.sys);
        if (pr.purse < p) return;
        pr.purse -= p; lead.cash += p; addStock(lead, pr.sys, f.key, -1);
        pr.got[f.key] = (pr.got[f.key] || 0) + 1; pr.parts.push({ k:f.key, from:lead.id });
        return;
      }
      buyPart(lead, f.key, pr.sys, urgency,
              (sum: number) => { if (pr.purse < sum) return false; pr.purse -= sum; return true; },
              "project", false, pr);
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
              "proposal", false, p);
    });
  });
  // индекс продавцов верен только внутри торгов: позже в тике склады
  // сдвигаются, и танкер за топливом обязан видеть всех
  tickCache.sellers = null;
}

