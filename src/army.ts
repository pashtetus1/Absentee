// ===================== военный бюджет и тот, кто его тратит =====================
//
// У казны до сих пор было два прихода и почти ни одного расхода: деньги
// копились, и высокий налог ничем не наказывал игрока — тратить всё равно было
// не на что (журнал, п. 7). Военный бюджет — первый расход, который РАСТЁТ САМ
// и отвечает на то, как идут дела: чем больше в галактике вольницы, тем дороже
// обходится порядок.
//
// Рычаг тут ровно один — сколько денег в год уходит в военный фонд. Дальше
// решает ГЕНЕРАЛ, и он не игрок: игрок по-прежнему не приказывает, а меняет
// выгодность. Генерал тратит фонд на две вещи, в этом порядке:
//
//   АРСЕНАЛЫ. Наземное оружие в миры, которым грозит восстание: голодным и тем,
//     у кого под боком логово. Это дёшево и это единственное, чем корпорации
//     перевешивают численность в наземной битве (ground.ts). Бюджет, залитый
//     заранее, спасает колонию; бюджет, включённый после начала восстания,
//     опаздывает — оружие покупают не в разгар боя.
//
//   ПОЛИЦИЯ. Военные корабли, которые стоят в обжитых системах и вступаются за
//     рейсы под своим флагом. Своей конторы у государства нет, поэтому ЧЕРТЁЖ
//     ОНО БЕРЁТ У КОМПАНИЙ: выбирается контора, имеющая право строить по
//     чертежу, ей платится лицензия, и её же верфь корабль собирает. Без
//     компаний государство не построит ни одного корабля — как и всё остальное
//     в этой игре.
//
// Компании и вольница заказывают военные корабли здесь же, в одном месте с
// казной: у всех троих это один и тот же разговор — чертёж, детали на месте,
// место в очереди верфи. Разница только в том, чей кошелёк и зачем корабль.

import { RAIDER, bestDesign, buyKit, designMakers, designsFor, kitAt, kitCost, kitFor } from "./arms";
import { ARMKEYS, vtype } from "./data";
import { fleetOf } from "./battle";
import { askPrice } from "./market";
import { HOME, isRealm, realmOf, realmOfCorp, treasuryOf, payTreasury } from "./realm";
import { rnd } from "./rng";
import { QUEUE_MAX, YARD_WORK, edgeShipyard, nearestYard, paySlot, slotPrice } from "./shipyard";
import { L, S, corps, say, shipyards, systems, warships, worlds } from "./state";
import { addStock, popOf, stockAt } from "./world";
import type { Corp, Design, Shipyard, World } from "./types";

/** Потолок рычага: сколько казна может отдавать на войско в год. Тем же числом
 *  размечен ползунок в shell.html — если менять, то в обоих местах. */
export const ARMY_MAX = 600;
/** Сколько военных кораблей держит каждая сторона. Вольница строит больше
 *  прочих: разбой — её единственное дело. */
export const POLICE_CAP = 6, GUARD_CAP = 2, RAID_CAP = 3;
/** Доля стоимости корабля, которая уходит держателю чертежа. Государство своей
 *  конторы не имеет и платит за чужой замысел; компания, строящая по своему
 *  чертежу, не платит никому. */
export const LICENSE = 0.15;

/** Верфь, на которой эта сторона может собрать корабль.
 *
 *  Вольница строит ТОЛЬКО У СЕБЯ, и это не мелочь: общая верфь принимает
 *  заказы от всех подряд (nearestYard), и без этой оговорки ватага собирала бы
 *  рейдеры на казённом стапеле у столицы. Свой стапель у неё есть всегда —
 *  его закладывают в тот же день, когда она берётся за оружие (ground.ts,
 *  relief.ts), и в этом весь смысл слов «контроль перешёл пиратам». */
function yardFor(c: Corp | null, sys: number, realm: number): Shipyard | null {
  if (c && c.pirate) {
    let own: Shipyard = null;
    shipyards.forEach((y) => {
      if (y.owner !== c.id) return;
      if (!own || (c.home && y.world.sys === c.home.sys)) own = y;
    });
    return own;
  }
  return nearestYard(sys, c, realm);
}

/** Поставить военный корабль в очередь верфи. Место в очереди оплачивается, как
 *  и всеми прочими: военный заказ не имеет перед верфью никаких преимуществ —
 *  планета строит его теми же руками. */
function queueWar(y: Shipyard, d: Design, parts: { k: string; from: number }[],
                  lead: number, color: string, role: string, forCorp?: number): void {
  const vt = vtype("war");
  // Сборка считается по ЧЕРТЕЖУ, а не по строке таблицы: «Гроза» из одиннадцати
  // деталей стоит вчетверо больше человеко-месяцев, чем самоделка из трёх, и
  // это единственное, чем они отличаются на стапеле. Строка таблицы (vt.build)
  // остаётся ценой МЕСТА в очереди: планета берёт за место по типу, а не по
  // чужому замыслу.
  const work = d.build * YARD_WORK;
  y.queue.push({ vt:vt, lead:lead, color:color, glyph:"war", parts:parts.slice(),
                 left:work, total:work, des:d.key, role:role, forCorp:forCorp });
}

/** Заказ военного корабля конторой: чертёж свой или лицензированный, детали
 *  свозить не надо — их берут на месте, у верфи. Возвращает false, если не
 *  вышло: нет верфи, нет деталей под рукой или нет денег. */
function orderWar(c: Corp, d: Design, y: Shipyard, role: string): boolean {
  const at = y.world;
  // В забитую очередь военный заказ НЕ встаёт, и это важнее, чем кажется:
  // верфь в партии обычно одна, через неё идёт всё — колонии, хлебовозы,
  // портальные корабли, — и флот, вставший в неё поперёк, останавливает
  // экспансию целиком. Корабль, который соберут через сорок лет, порядка всё
  // равно не наведёт. Вольницы это не касается: у неё свой стапель и на нём
  // больше ничего не строится.
  if (!c.pirate && y.queue.length >= QUEUE_MAX) return false;
  const need = kitFor(d, at.sys);
  if (!kitAt(at.sys, need, c)) return false;
  const fee = slotPrice(y, vtype("war"));
  if (c.cash < kitCost(need) + fee + 40) return false;
  const parts = buyKit({ corp:c, pay:(s) => { if (c.cash < s) return false; c.cash -= s; return true; },
                         back:(s) => { c.cash += s; } }, at.sys, need);
  if (!parts) return false;
  if (!paySlot(y, fee, (s) => { if (c.cash < s) return false; c.cash -= s; return true; })) {
    parts.forEach((p) => { addStock(c, at.sys, p.k, 1); });
    return false;
  }
  queueWar(y, d, parts, c.id, c.color, role, c.id);
  say("<b>" + c.name + "</b> закладывает " + d.short + " у " + y.world.body.name +
      (role === "raid" ? ": вольница вооружается." : ": охрана своим рейсам."));
  return true;
}

/** Сколько военных кораблей у стороны, считая те, что ещё на стапеле: без
 *  этого счёта контора заказывала бы пятый корабль, пока первые четыре стоят в
 *  очереди. */
function warCount(owner: number): number {
  let n = fleetOf(owner).length;
  shipyards.forEach((y) => {
    y.queue.forEach((b) => {
      if (b.vt.key !== "war") return;
      if (owner < 0 ? b.forCorp === undefined : b.forCorp === owner) n++;
    });
  });
  return n;
}

// ---- вольница -----------------------------------------------------------
// Ватага строит корабли у себя в логове, из награбленного и на награбленное.
// Чертёж у неё почти всегда самоделка (arms.ts, RAIDER): лабораторий нет,
// патентов нет, зато корпус с двигателем найдутся всегда, а оружие довесят то,
// какое лежит на складах округи.
function pirateArms(p: Corp): void {
  if (!p.home || warCount(p.id) >= RAID_CAP) return;
  const y = yardFor(p, p.home.sys, realmOfCorp(p));
  // Нет своего стапеля — закладывают: ватага без стапеля не ватага, а просто
  // сердитая контора. Кладут в логове, а если там уже чья-то верфь (мятеж на
  // чужой планете) — на своём самом людном мире без верфи. На столицу не
  // лезут: там не логово, а государство.
  if (!y) {
    if (p.home.edgeYard) return;
    let at: World = p.home.yard ? null : p.home, top = -1;
    if (!at) p.branches.forEach((b) => {
      const w = b.world;
      if (w === S.home || w.yard || w.edgeYard) return;
      const score = popOf(w);
      if (score > top) { top = score; at = w; }
    });
    if (at) edgeShipyard(at, p.id);
    return;
  }
  orderWar(p, bestDesign(p) || RAIDER, y, "raid");
}

// ---- компании -----------------------------------------------------------
// Охрана — дело неохотное: корабль стоит денег и не возит ничего. Контора
// берётся за него, только когда в галактике есть кого бояться и когда она уже
// потеряла рейс или у неё есть чертёж, по которому строить.
function corpGuard(c: Corp): void {
  if (c.pirate || isRealm(c) || !c.branches.length) return;
  if (warCount(c.id) >= GUARD_CAP) return;
  const d = bestDesign(c);
  if (!d || d.gen === 0) return;                      // самоделка — не для порядочных
  if (c.cash < 700) return;
  // Пугает не сама вольница, а вольница ПО ДОРОГЕ: смотрим, есть ли логово в
  // системе, где у конторы филиал, или рядом с ней.
  const danger = corps.some((p) => {
    return p.pirate && p.home && c.branches.some((b) => { return b.world.sys === p.home.sys; });
  }) || S.raids > 0;
  if (!danger || rnd() > 0.25) return;
  let at: World = null, top = -1;
  c.branches.forEach((b) => {
    const score = popOf(b.world) + (b.world.yard ? 4 : 0);
    if (score > top) { top = score; at = b.world; }
  });
  if (!at) return;
  const y = yardFor(c, at.sys, realmOfCorp(c));
  if (y) orderWar(c, d, y, "guard");
}

// ---- государство --------------------------------------------------------

/** Мир, которому нужнее всего арсенал: голод, близкое логово, отсутствие
 *  оружия. Восстание вспыхивает там, где четыре года голодали, и генерал
 *  смотрит ровно на это. */
function riskOf(w: World): number {
  if (realmOf(w) !== HOME || w.founder < 0) return 0;
  let risk = w.food.short * 0.05 + (w.rough > 0 ? 0.3 : 0);
  if (corps.some((p) => { return p.pirate && p.home && p.home.sys === w.sys; })) risk += 1.2;
  if (w.war) risk = 0;                        // в разгар боя оружие уже не подвезти
  return risk;
}

/** Генерал закупает наземное оружие в арсенал мира. Одна ступень за раз и не
 *  больше одного мира в месяц: войско собирают годами, а не одним платежом. */
function buyArsenal(): boolean {
  let best: World = null, top = 0.35;
  worlds.forEach((w) => {
    const r = riskOf(w);
    if (r > top) { top = r; best = w; }
  });
  if (!best) return false;
  // Берут лучшее, что лежит в системе: возить оружие через полгалактики
  // генерал не умеет, как не умеет этого и правительство мира с хлебом.
  let key: string = null, lvl = 0;
  ARMKEYS["gun"].forEach((k, i) => {
    if (corps.some((c) => { return stockAt(c, best.sys, k) > 0; })) { key = k; lvl = i + 1; }
  });
  if (!key || lvl <= best.arms) return false;
  let seller: Corp = null;
  corps.forEach((s) => {
    if (stockAt(s, best.sys, key) <= 0) return;
    if (!seller || stockAt(s, best.sys, key) > stockAt(seller, best.sys, key)) seller = s;
  });
  if (!seller) return false;
  const price = askPrice(seller, key) * (1 + L.tradeFee);
  if (S.armyFund < price) return false;
  S.armyFund -= price;
  seller.cash += price / (1 + L.tradeFee); seller.sold++;
  addStock(seller, best.sys, key, -1);
  S.trades++; S.turnover += price;
  best.arms = lvl;
  say("Генерал закупил наземное оружие Mk" + lvl + " в арсенал <b>" + best.body.name +
      "</b> у " + seller.name + " за " + Math.round(price) + ".");
  return true;
}

/** Казённый военный корабль. Чертёж берётся у компаний: государство платит
 *  лицензию тому, кто имеет право строить, и собирает на верфи. */
function buyPolice(): boolean {
  if (warCount(-1) >= POLICE_CAP) return false;
  // Где ставить: там, где мимо ходят рейсы и есть верфь. Проще всего — самый
  // населённый свой мир с верфью.
  let at: World = null, top = -1;
  worlds.forEach((w) => {
    if (realmOf(w) !== HOME || !w.yard || w.yard.owner >= 0) return;
    const score = popOf(w) + w.branches.length;
    if (score > top) { top = score; at = w; }
  });
  if (!at) return false;
  // Чертёж и подрядчик: лучший чертёж, который кто-то умеет строить.
  let pick: { d: Design; c: Corp } = null, best = -1;
  corps.forEach((c) => {
    if (c.pirate) return;
    designsFor(c).forEach((d) => {
      if (d.gen === 0) return;
      const w = Object.keys(d.need).length;
      if (w > best) { best = w; pick = { d:d, c:c }; }
    });
  });
  if (!pick) return false;
  const need = kitFor(pick.d, at.sys);
  if (!kitAt(at.sys, need, null)) return false;
  // Деньги считаются ДО поиска верфи, и это не вкусовщина: поиск верфи обходит
  // сеть маршрутов вширь на каждый стапель (canTravel), и делать это каждый
  // месяц ради заказа, на который всё равно нет денег, — самая дорогая строка
  // во всём тике. Сперва дешёвые проверки, потом дорогая.
  const kit = kitCost(need), lic = kit * LICENSE;
  if (S.armyFund < kit + lic) return false;
  const y = yardFor(null, at.sys, HOME);
  if (!y || y.queue.length >= QUEUE_MAX) return false;
  const fee = slotPrice(y, vtype("war"));
  if (S.armyFund < kit + fee + lic) return false;
  // ЛИЦЕНЗИЯ ПЛАТИТСЯ ПЕРВОЙ, до деталей. Не ради красоты: детали покупаются по
  // ЗАПРОСНОЙ цене продавца, а она выше ходовой, по которой сделана оценка, —
  // и если платить лицензию последней, фонда на неё может уже не хватить.
  // Фонд уходил в минус ровно так.
  S.armyFund -= lic; pick.c.cash += lic;
  const parts = buyKit({ corp:null, pay:(s) => { if (S.armyFund < s) return false; S.armyFund -= s; return true; },
                         back:(s) => { S.armyFund += s; } }, at.sys, need);
  if (!parts) { S.armyFund += lic; pick.c.cash -= lic; return false; }
  if (!paySlot(y, fee, (s) => { if (S.armyFund < s) return false; S.armyFund -= s; return true; })) {
    parts.forEach((p) => { addStock(corps[p.from], at.sys, p.k, 1); });
    S.armyFund += lic; pick.c.cash -= lic;
    return false;
  }
  queueWar(y, pick.d, parts, pick.c.id, "#8894ae", "police");
  say("Генерал заказал казённый " + pick.d.short + " у " + at.body.name +
      ", чертёж взят у <b>" + pick.c.name + "</b> за лицензию " + Math.round(lic) + ".");
  return true;
}

/** Сколько фонд держит про запас. Больше генерал не просит, и это НЕ мелочь:
 *  без потолка казна отдавала бы бюджет в фонд каждый месяц независимо от того,
 *  есть ли что покупать, и за триста лет там оседало двадцать тысяч — деньги
 *  уходили из экономики в никуда, а рычаг наказывал игрока за то, что в
 *  галактике тихо. Потолок примерно равен паре кораблей: генерал копит на
 *  следующий, но не на флот, которого некому строить. */
export const FUND_CAP = 1200;

/** Раз в месяц: бюджет перетекает в фонд, генерал тратит фонд.
 *
 *  Деньги идут в фонд КАЖДЫЙ месяц, а тратятся раз в квартал. Не ради экономии
 *  строк: закупка обходит склады, чертежи и верфи, то есть стоит дороже всего
 *  остального в тике, а решение «купить корабль» не становится лучше от того,
 *  что его принимают двенадцать раз в год вместо четырёх. */
export function armyRun(): void {
  const due = L.army / 12;
  if (due > 0 && S.armyFund < FUND_CAP && treasuryOf(HOME) > due) { payTreasury(HOME, -due); S.armyFund += due; }
  if (S.armyFund <= 0 || S.tick % 3 !== 0) return;
  // Сперва арсеналы: они дешевле и спасают то, что иначе будет потеряно
  // насовсем. Корабль строится годами и к восстанию всё равно не успеет.
  if (buyArsenal()) return;
  buyPolice();
}

/** Раз в год: кто заказывает военные корабли. Вольница — всегда, компании —
 *  когда есть чего бояться. */
export function warOrders(): void {
  corps.forEach((c) => {
    if (c.pirate) pirateArms(c); else corpGuard(c);
  });
}

/** Сколько ещё казна отдаёт на войско: строкой для подсказки под рычагом. */
export function armyLine(): string {
  const police = warCount(-1), fund = Math.round(S.armyFund);
  return "полиции " + police + " из " + POLICE_CAP + " · в фонде " + fund +
         " · арсеналов " + worlds.filter((w) => { return w.arms > 0; }).length;
}

/** Где сейчас стоит казённый флот — для сводки. */
export function policeLine(): string {
  const at: Record<number, number> = {};
  fleetOf(-1).forEach((s) => { at[s.sys] = (at[s.sys] || 0) + 1; });
  return Object.keys(at).map((k) => { return systems[+k].name + " " + at[+k]; }).join(", ");
}
