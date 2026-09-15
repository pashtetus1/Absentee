// Партия ПОЛНАЯ: хлебовоз везёт ровно столько, сколько в его трюмах (один трюм —
// FOOD_PER_HOLD, data.ts), и не уходит, пока у поставщика нет излишка на полный
// трюм. Раньше партия была частичной — «сколько есть», от одной единицы, — и
// корабль, собранный годами, мог лететь двадцать лет ради горсти зерна.
// Полгода резерва у поставщика по-прежнему мера: запас родины ходит от 12 до 40
// месяцев, в плохие годы падает к нулю, и тогда экспорт замирает сам собой.
// Голод должен случаться не от безденежья, а от того, что еды физически нет.




// Резерв мира — сколько месяцев прокорма он держит про запас. Одно число на
// два решения, и вокруг него ЗАЗОР: отдают только сверх 120% резерва, просят
// только ниже 60%. Раньше пороги были разными по построению (отдавал сверх
// шести месяцев, просил ниже двенадцати), полосы перекрывались, и мир попадал
// под оба условия сразу. Зазор разводит их вдвое: между "могу отдать" и "надо
// просить" лежит пустая полоса, в которой мир не делает ничего.

import { engMult, holdOf, holdOfType, pickCaptain, shipNeed, vtype } from "./data";
import { takeDock } from "./docks";
import { harvestOf } from "./labour";
import { askPrice, fuelBill, govFuel, govFuelAvail } from "./market";
import { HOME, payTreasury, realmOf, treasuryOf } from "./realm";
import { rnd } from "./rng";
import { onOrder, orderTransport } from "./shipyard";
import { L, S, corps, dateStr, docks, say, voyages, worlds } from "./state";
import { bestEngineAt } from "./tech";
import { canTravel, fuelCost, needWith, routeSpeed, travelExtra } from "./travel";
import { addStock, popOf, reserveOf, stockAt } from "./world";
import type { Corp, Part, Voyage, World } from "./types";

export const GIVE_OVER = 1.2;       // отдаёт лишь то, что сверх этой доли резерва
export const ASK_UNDER = 0.6;       // просит, когда запас упал ниже этой доли

export function surplusWorld(need: number, from: World): { w: World; extra: number; } {
  let best: World = null, bs = 0;
  worlds.forEach((w) => {
    if (w === from) return;
    // Донор — мир, который РАСТИТ не меньше, чем съедает. Раньше такого понятия
    // не было вовсе: отдавал тот, у кого в эту минуту больше на складе, — а склад
    // ледника набит привозным, и резерв ему считали по его крошечному населению.
    // Отсюда выходило смешное: мир отдавал последнее большому соседу, уходил в
    // голод, и сосед вёз ему обратно ещё больше. Проверка закрывает это в корне:
    // мир в дефиците не может оказаться источником, а значит не может быть
    // донором и просителем одновременно.
    if (harvestOf(w) < popOf(w)) return;
    const extra = w.food.stock - reserveOf(w) * GIVE_OVER;
    if (extra > bs) { bs = extra; best = w; }
  });
  // Только на полный трюм: полупустым хлебовоз не уходит.
  return bs >= need ? { w:best, extra:bs } : null;
}

// Правительство покупает корабль у компаний: те же детали, тот же рынок.
// Если собрать не удалось, все взятые детали возвращаются на склад — иначе
// они пропадают, а деньги остаются, и рынок тихо худеет.
// Правительствам не отказывают: они покупатели еды, а не соперники.
// need — уже готовый набор деталей, потому что под движками межзвёздный
// рейс обязан нести ещё и двигатель, а под воротами и проходами не обязан.
// Правительство покупает только то, что лежит В ЕГО СИСТЕМЕ: возить детали
// ради хлебовоза оно не умеет, и это правильно — окраина без своего цеха
// сидит без транспорта, пока кто-нибудь не откроет там филиал.
// payer платит, at — чья система даёт детали и топливо. Хлебовоз для голодной
// колонии строится у ПОСТАВЩИКА еды: у колонии цехов нет, а без этого правила
// она умирала с полным складом провизии, не дождавшись первого рейса.
export function govBuyShip(payer: World, at: World, need: Record<string, number>): { k: string; from: number; }[] {
  const w = payer;
  let taken: Part[] = [], cost = 0, ok = true;
  Object.keys(need).forEach((k) => {
    for (let i = 0; i < need[k]; i++) {
      if (!ok) return;
      let seller: Corp = null;
      corps.forEach((c) => {
        if (stockAt(c, at.sys, k) > 0 && (!seller || stockAt(c, at.sys, k) > stockAt(seller, at.sys, k))) seller = c;
      });
      if (!seller) { ok = false; return; }
      addStock(seller, at.sys, k, -1);
      taken.push({ k:k, from:seller.id, price:askPrice(seller, k) });
      cost += taken[taken.length - 1].price * (1 + L.tradeFee);
    }
  });
  if (!ok || w.gov.cash < cost) {
    taken.forEach((t) => { addStock(corps[t.from], at.sys, t.k, 1); });
    return null;
  }
  w.gov.cash -= cost;
  taken.forEach((t) => {
    corps[t.from].cash += t.price; corps[t.from].sold++;
    S.treasury += t.price * L.tradeFee; S.trades++; S.turnover += t.price;
  });
  return taken.map((t) => { return { k:t.k, from:t.from }; });
}

export function dispatch(from: World, to: World, kind: string, qty: number, parts: Part[]): Voyage {
  const v = { kind:kind, from:from, to:to, qty:qty, parts:parts,
            color: parts.length ? corps[parts[0].from].color : "#8894ae",
            // Внутри системы корабль идёт на СВОЁМ ходовом двигателе — том,
            // что на нём стоит. Между звёздами ходовой ни при чём: там считает
            // марка межзвёздного перехода, и берётся она у того, кто корабль
            // собрал (у государственного рейса своей марки нет — годится любая
            // освоенная в галактике).
            t:0, dur: from.sys === to.sys
                      ? (54 + rnd() * 18) / engMult(parts)
                      : (150 + rnd() * 60) / routeSpeed(from.sys, to.sys, parts.length ? parts[0].from : -1, parts),
            born:dateStr(), captain:pickCaptain() } as Voyage;
  voyages.push(v);
  return v;
}

/** Казна государства докладывает своему миру на хлеб.
 *
 *  Это ЕДИНСТВЕННЫЙ расход казны отделившихся, и без него она мёртвое число:
 *  налог она собирает, а тратить его больше не на что — дотация науки и
 *  докладка по верфи остались рычагами родного государства, у которого их и
 *  крутит игрок. Так история замыкается: новое государство копит налог со своих
 *  миров и кормит на него свои миры.
 *
 *  Родную казну сюда не зовём НАРОЧНО. У неё уже есть свои расходы и рычаги, а
 *  докладка родным мирам сдвинула бы весь базовый баланс — и заодно сломала бы
 *  правило, по которому партия без отделения обязана идти как прежде.
 */
function topUp(w: World, need: number): void {
  const r = realmOf(w);
  if (r === HOME || w.gov.cash >= need) return;
  const give = Math.min(treasuryOf(r), need - w.gov.cash);
  if (give <= 0) return;
  payTreasury(r, -give);
  w.gov.cash += give;
  say("Казна «" + corps[r].name + "» доложила " + Math.round(give) + " на хлеб для " + w.body.name + ".");
}

export function foodRun(): void {
  worlds.forEach((w) => {
    // Урожай спрашиваем у harvestOf — у той же функции, которой мир кормится на
    // самом деле и по которой чуть ниже решается, может ли он быть донором.
    // Пока здесь стояла своя грубая оценка (фермеры на урожайность типа, без
    // освоения), освоенный мир проходил ОБЕ проверки сразу: по настоящему
    // урожаю кормил себя и потому отдавал соседу, а по грубой числился в
    // дефиците и тут же просил у него же. Отсюда и брались встречные хлебовозы.
    const total = popOf(w), grown = harvestOf(w), deficit = total - grown;
    if (deficit <= 0.05) return;
    const incoming = voyages.reduce((a, v) => { return a + (v.kind === "food" && v.to === w ? v.qty : 0); }, 0);
    // порог и партия под долгие рейсы: хлебовоз идёт годами, и заказывать
    // надо задолго до того, как склад опустеет
    if (w.food.stock + incoming > reserveOf(w) * ASK_UNDER) return;
    const qty = holdOfType(vtype("cargo"));
    const pickSrc = surplusWorld(qty, w);
    if (!pickSrc) return;
    const src = pickSrc.w;
    if (!canTravel(src.sys, w.sys)) return;          // дороги нет — мир голодает
    // Цена РЫНОЧНАЯ, а не плоские 1.2: у голодного поставщика еда дорогая, и
    // каждый вывоз дорожит её ещё на 4% (см. ниже). Раньше food.price жила
    // сама по себе и в сделке не участвовала — кормить было одинаково дёшево
    // всегда, сколько бы рейсов ни ушло.
    const price = qty * src.food.price;
    // Горючее считаем ДО кассы: чтобы доложить, надо знать полную цену рейса, а
    // обе эти величины ничего не трогают и не двигают.
    const fk = src.sys === w.sys ? "fuel" : "sfuel";
    const tanks = fuelCost(src.sys, w.sys);                // под воротами — по баку на створ
    topUp(w, price + fuelBill(fk, tanks) + 10);            // казна своего государства, если она есть
    if (w.gov.cash < price + 10) return;
    if (!govFuelAvail(w, src, fk, tanks)) return;          // без горючего хлебовоз не полетит
    // сперва корабль со стоянки у поставщика, и только потом покупка нового
    const dk = takeDock(null, w, src.sys, "cargo", needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
    if (!dk) {
      // Готового нет — заказываем на верфи и ждём. Заказ висит, пока корабль не
      // сойдёт со стапеля: без этого голодная планета заказывала бы каждые
      // полгода, и верфь забивалась хлебовозами, которых никто не дождётся.
      if (!onOrder("cargo", w, null)) {
        // Двигатель ставят тот, что лежит в системе поставщика: правительство
        // деталей не возит, и лучшей модели галактики ему тут никто не подаст.
        const buy = shipNeed(vtype("cargo"), bestEngineAt(src.sys), travelExtra(src.sys, w.sys));
        const bought = buy && govBuyShip(w, src, buy);
        if (bought) orderTransport("cargo", bought, src.sys, w, null);
      }
      return;
    }
    const parts = dk.parts;
    // Корабль со стоянки бывает чужим, и тогда его УЖЕ оплатили — между первой
    // проверкой кассы и оплатой еды она успела похудеть. Поэтому считаем заново
    // и разом: еда плюс заправка. Не хватило — корабль возвращается на стоянку,
    // а мир ждёт следующего месяца. Пока этой проверки не было, касса мира
    // уходила в минус, а на неотрицательность её кассы опирается весь код
    // покупок. Везёт корабль по СВОИМ трюмам, а не по рецепту: со стоянки может
    // прийти и двухтрюмный, и тогда заново проверяются и касса, и излишек.
    const load = holdOf(parts), cost = load * src.food.price;
    if (load <= 0 || src.food.stock - reserveOf(src) * GIVE_OVER < load ||
        w.gov.cash < cost + fuelBill(fk, tanks) + 10) { docks.push(dk); return; }
    govFuel(w, src, fk, tanks);
    w.gov.cash -= cost; src.gov.cash += cost; src.food.stock -= load;
    // вывоз дорожит еду у поставщика: фермеру платят больше, в поле идут
    // люди, излишек растёт — так экспорт сам себя кормит
    src.food.price = Math.min(6, src.food.price * 1.04);
    const vf = dispatch(src, w, "food", load, parts);
    if (dk) vf.captain = dk.captain;                     // тот же корабль, тот же командир
    S.shipped += load;
    say("Правительство " + w.body.name + " закупило " + load + " еды на " + src.body.name +
        (dk ? " — на корабле со стоянки." : "."));
  });
}

