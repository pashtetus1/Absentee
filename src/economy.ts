
import { compOf } from "./data";
import { sayAt, seenByState } from "./charts";
import { noteUse, priceAt } from "./market";
import { HOME, payTreasury, realmOf } from "./realm";
import { L, S, corps, say, systems, upkeepOf, worlds } from "./state";
import { addStock, popOf, stockAt } from "./world";
import type { Corp, Rock } from "./types";

// ===================== добыча =====================
// Платформа не приносит денег. Она даёт СЫРЬЁ, и кладёт его на склад хозяина
// В ТОЙ СИСТЕМЕ, где стоит камень: дальше его надо продать тем, кто здесь жжёт
// и строит, или увезти туда, где за него дадут больше (haul.ts). Отсюда вся
// разница между богатой жилой у дома и такой же жилой на краю галактики —
// раньше её не было вовсе, доход капал одинаково откуда угодно.
export function ventureWork(): void {
  systems.forEach((s) => {
    for (let i = s.ventures.length - 1; i >= 0; i--) {
      const v = s.ventures[i];
      if (!v.live) continue;
      // Сырьё капает дробно, а на складе лежит штуками: недобранное ждёт в wip.
      v.wip = (v.wip || 0) + v.yield;
      while (v.wip >= 1) { v.wip -= 1; addStock(corps[v.lead], s.id, v.kind, 1); }
      v.left--;
      if (v.left <= 0) {
        sayAt(s.id, "Платформа " + corps[v.lead].name + " на " + v.dest.label + " выработала камень (" +
              compOf(v.kind).short + ").");
        (v.dest.ref as Rock).taken = false; s.mines--;
        s.stations = s.stations.filter((st) => { return st.vent !== v; });
        s.ventures.splice(i, 1);
      }
    }
  });
}

// ===================== энергия: единственное сырьё, которое деньги ==========
// Металл съедает цех, вар и просинь жгут корабли — а энергию пьют ЛЮДИ, и
// платят за неё они же, а не казна мира: это не закупка правительства, а
// счёт, который приходит каждому. Поэтому деньги здесь появляются в галактике
// (как и выручка филиалов), а не перекладываются из чужого кармана, и ровно
// поэтому энергия — та сторона добычи, ради которой всё это возят: камень с
// энергией на краю галактики не стоит ничего, пока до него не довезли людей,
// а до людей — его.
//
// Налог с этой продажи берёт государство ТОЙ ПЛАНЕТЫ, на которой её продали:
// то же правило, что у филиалов («платят там, где работают»), иначе рычаг
// налога перестал бы доставать до главного дохода контор.
export const POWER_PER_POP = 0.12;   // сколько энергии съедает человечек в месяц
export const POWER_RESERVE = 12;     // на сколько месяцев мир старается держать запас

/** Сколько энергии сжигает мир за месяц. */
export function powerUse(w: { pop: { farm: number; prod: number; sci: number; free: number } }): number {
  return (w.pop.farm + w.pop.prod + w.pop.sci + w.pop.free) * POWER_PER_POP;
}

export function powerTrade(): void {
  worlds.forEach((w) => {
    const use = powerUse(w);
    w.power = Math.max(0, (w.power || 0) - use);
    noteUse(w.sys, "power", use);                 // спрос, по которому ходит местная цена
    const want = Math.floor(use * POWER_RESERVE - w.power);
    if (want <= 0) return;
    let seller: Corp = null;
    corps.forEach((c) => {
      if (stockAt(c, w.sys, "power") <= 0) return;
      if (!seller || stockAt(c, w.sys, "power") > stockAt(seller, w.sys, "power")) seller = c;
    });
    if (!seller) return;                          // энергии в системе нет — мир сидит без неё
    const n = Math.min(want, stockAt(seller, w.sys, "power"));
    if (n <= 0) return;
    const earn = priceAt("power", w.sys) * n;
    addStock(seller, w.sys, "power", -n);
    w.power += n;
    const due = earn * L.tax;
    payTreasury(realmOf(w), due);
    seller.cash += earn - due; seller.sold++;
    S.trades++; S.turnover += earn; S.powerSold += n;
  });
}

export function economy(): void {
  corps.forEach((c) => {
    if (c.cool > 0) c.cool--;
    // Налог платят ТАМ, ГДЕ РАБОТАЮТ, а не туда, откуда контора родом. Считать
    // по конторе было бы на строку короче, но тогда метрополия теряла бы налог
    // с чужого филиала на СВОЕЙ планете, а это уже не граница, а дыра. Тем же
    // правилом живёт местный налог тремя строками ниже.
    //
    // Выручка копится по государствам, а множится на ставку ОДИН раз в конце, а
    // не по филиалу: сумма произведений и произведение суммы в плавающей точке
    // не совпадают, и партия без отделения поехала бы от одной этой правки.
    //
    // НЕ ВИЖУ — НЕ ОБЛАГАЮ. Филиал в системе, которой государство не видит —
    // её знают меньше трёх контор (charts.ts), — налога не платит вовсе: для
    // казны ни этого мира, ни этой работы не существует. Отсюда прямая корысть
    // держать находку при себе и прямая цена того, чтобы продать карту.
    // Отделившихся это не касается: своё государство свои миры видит, потому
    // что живёт в них.
    let earn = 0, wages = 0, home = 0;
    const away: Record<number, number> = {};
    c.branches.forEach((b) => {
      const got = b.emp.prod * 6.5;
      earn += got;
      const r = realmOf(b.world);
      if (r !== HOME) away[r] = (away[r] || 0) + got;
      else if (seenByState(b.world.sys)) home += got;
      wages += b.emp.prod * b.world.wage.prod + b.emp.sci * b.world.wage.sci;
      b.world.gov.cash += b.emp.prod * (b.world.rough > 0 ? 0.3 : 0.8);   // местный налог; в разруху собирать почти нечего
    });
    payTreasury(HOME, home * L.tax);
    Object.keys(away).forEach((k) => {
      const due = away[+k] * L.tax;
      payTreasury(+k, due); S.taxAway += due;
    });
    c.cash += earn * (1 - L.tax) - wages;
    if (c.cash < -40) c.cash = -40;
  });
  worlds.forEach((w) => {
    // Пособия свободным здесь больше нет — ни расхода, ни рычага. Оно не могло
    // дойти до людей и потому было расходом без последствий, зато тормозило
    // наём (labour). Вместе с ним у L.tax пропал главный противовес: казна
    // теперь копит легче, а тратить ей по-прежнему почти не на что.
    // Подушной подати здесь больше нет. Плоские 1.2 в месяц на мир были
    // заглушкой на месте «люди платят своему правительству просто за то, что
    // живут»: они не зависели ни от населения, ни от цен, и родина на сорок
    // человек получала столько же, сколько колония на одного. Теперь это же
    // место занимает хлеб — казна мира скупает урожай и продаёт еду едокам
    // (labour), и приход растёт с населением и с ценой.
    // Содержание: люди стоят денег просто тем, что они есть. Раньше касса мира
    // была почти закрытым накопителем — приход капал полтора века, а тратить
    // его было почти не на что: родина приходила к тринадцати тысячам при
    // корабле за 66, и никакая цена ничего не значила. Приход идёт от ЗАНЯТЫХ
    // (emp.prod * 0.8), расход — от ВСЕХ, поэтому мир, где людям нечего
    // делать, начинает течь. По населению, а не по пределу: предел у родины
    // 360 и не меняется, а население отвечает на то, как идут дела.
    // Пол на нуле обязателен: до сих пор w.gov.cash не мог стать
    // отрицательным (все списания идут через проверки "хватает ли"), и весь
    // код покупок на это опирается.
    w.gov.cash = Math.max(0, w.gov.cash - upkeepOf(popOf(w)));
  });
}

