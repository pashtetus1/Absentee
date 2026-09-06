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

import { pickCaptain, vtype } from "./data";
import { takeDock } from "./docks";
import { harvestOf } from "./labour";
import { askPrice, govFuel, govFuelAvail } from "./market";
import { rnd } from "./rng";
import { orderTransport } from "./shipyard";
import { L, S, corps, dateStr, say, voyages, worlds } from "./state";
import { speedOf } from "./tech";
import { canTravel, needWith, travelExtra } from "./travel";
import { addStock, popOf, stockAt } from "./world";
import type { Corp, Part, Voyage, World } from "./types";

export const RESERVE = 18;          // месяцев прокорма
export const GIVE_OVER = 1.2;       // отдаёт лишь то, что сверх этой доли резерва
export const ASK_UNDER = 0.6;       // просит, когда запас упал ниже этой доли

export function reserveOf(w: World): number { return popOf(w) * RESERVE; }

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
            // корабль летит на двигателях того, кто его построил
            t:0, dur: (from.sys === to.sys ? 54 + rnd() * 18 : 150 + rnd() * 60) / speedOf(parts.length ? parts[0].from : -1),
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
    if (!govFuelAvail(w, src, fk)) return;                 // без горючего хлебовоз не полетит
    // сперва корабль со стоянки у поставщика, и только потом покупка нового
    const dk = takeDock(null, w, src.sys, "cargo", needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
    if (!dk) {
      // Готового нет — заказываем на верфи и ждём. Заказ висит, пока корабль не
      // сойдёт со стапеля: без этого голодная планета заказывала бы каждые
      // полгода, и верфь забивалась хлебовозами, которых никто не дождётся.
      if ((w.ordered || 0) < 1) {
        const bought = govBuyShip(w, src, needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
        if (bought && orderTransport("cargo", bought, src.sys, w, null)) w.ordered = (w.ordered || 0) + 1;
      }
      return;
    }
    const parts = dk.parts;
    govFuel(w, src, fk);
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

