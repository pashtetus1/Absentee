// Партия ЧАСТИЧНАЯ: везём сколько есть, а не ждём, пока накопится на всю.
// Раньше требовали излишек на 36 месяцев, дом столько не держал, заказ
// срывался почти каждый месяц — и бесплодные колонии вымирали при полной
// казне. Обратная крайность была не лучше: при резерве в два месяца родина
// отдавала последнее и кормила всю галактику без перебоев. Полгода — это
// мера: запас родины ходит от 12 до 40 месяцев, но в плохие годы падает к
// нулю, и тогда экспорт замирает сам собой. Голод должен случаться не от
// безденежья, а от того, что еды физически нет.




// Резерв мира — сколько месяцев прокорма он держит про запас. Одно число на
// два решения, и вокруг него ЗАЗОР: отдают только сверх 120% резерва, просят
// только ниже 60%. Раньше пороги были разными по построению (отдавал сверх
// шести месяцев, просил ниже двенадцати), полосы перекрывались, и мир попадал
// под оба условия сразу. Зазор разводит их вдвое: между "могу отдать" и "надо
// просить" лежит пустая полоса, в которой мир не делает ничего.

import { engMult, pickCaptain, shipNeed, vtype } from "./data";
import { takeDock } from "./docks";
import { harvestOf } from "./labour";
import { askPrice, fuelBill, govFuel, govFuelAvail } from "./market";
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
  return bs >= Math.min(need, 4) ? { w:best, extra:bs } : null;
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
                      : (150 + rnd() * 60) / routeSpeed(from.sys, to.sys, parts.length ? parts[0].from : -1),
            born:dateStr(), captain:pickCaptain() } as Voyage;
  voyages.push(v);
  return v;
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
    const want = Math.ceil(deficit * 36);
    const pickSrc = surplusWorld(want, w);
    if (!pickSrc) return;
    const src = pickSrc.w, qty = Math.max(1, Math.min(want, Math.floor(pickSrc.extra)));
    if (!canTravel(src.sys, w.sys)) return;          // дороги нет — мир голодает
    // Цена РЫНОЧНАЯ, а не плоские 1.2: у голодного поставщика еда дорогая, и
    // каждый вывоз дорожит её ещё на 4% (см. ниже). Раньше food.price жила
    // сама по себе и в сделке не участвовала — кормить было одинаково дёшево
    // всегда, сколько бы рейсов ни ушло.
    const price = qty * src.food.price;
    if (w.gov.cash < price + 10) return;
    const fk = src.sys === w.sys ? "fuel" : "sfuel";
    const tanks = fuelCost(src.sys, w.sys);                // под воротами — по баку на створ
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
    // покупок.
    if (w.gov.cash < price + fuelBill(fk, tanks) + 10) { docks.push(dk); return; }
    govFuel(w, src, fk, tanks);
    w.gov.cash -= price; src.gov.cash += price; src.food.stock -= qty;
    // вывоз дорожит еду у поставщика: фермеру платят больше, в поле идут
    // люди, излишек растёт — так экспорт сам себя кормит
    src.food.price = Math.min(6, src.food.price * 1.04);
    const vf = dispatch(src, w, "food", qty, parts);
    if (dk) vf.captain = dk.captain;                     // тот же корабль, тот же командир
    S.shipped += qty;
    say("Правительство " + w.body.name + " закупило " + qty + " еды на " + src.body.name +
        (dk ? " — на корабле со стоянки." : "."));
  });
}

