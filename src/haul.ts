// ===================== сырьевой рейс =====================
//
// Платформа выдаёт сырьё ТАМ, ГДЕ СТОИТ КАМЕНЬ, а нужно оно там, где живут и
// строят. Между этими двумя местами и ходит транспортник — не за деталью для
// чьей-то сборки (это freight.ts), а с грузом навалом: десять единиц на трюм,
// двадцать в межзвёздный грузовик.
//
// РЕШЕНИЕ ОДНО И ПРОСТОЕ: где дороже. Контора смотрит на свои склады, на цены в
// системах, которые знает, и шлёт груз туда, где разница цен окупает просинь,
// сожжённую по дороге. Отсюда всё остальное само: энергия едет к людям (только
// там её и пьют), металл — к цехам, вар — туда, где взлетают, а система, где
// добыли больше, чем съели, дешевеет и перестаёт быть целью.
//
// ПОЧЕМУ НЕ ПОКУПАТЕЛЬ ЕДЕТ ЗА ГРУЗОМ. Покупатель у сырья бывает и молчащий:
// люди на планете не заказывают энергию, они её просто пьют, а цех заказывает
// металл, только когда уже встал. Если ждать заказа, сырьё так и лежало бы у
// камня. Поэтому возит ПРОДАВЕЦ, на свой страх: цена к приходу могла и упасть.

import { ORE_PER_HOLD, ORES, oreRoomOf, shipNeed, vtype } from "./data";
import { knowsSys } from "./charts";
import { takeDock } from "./docks";
import { orderFreighter } from "./freight";
import { fuelBill, priceAt, takeRes } from "./market";
import { realmOfCorp } from "./realm";
import { rnd } from "./rng";
import { nearestYard, orderCount } from "./shipyard";
import { S, corps, dateStr, docks, local, voyages } from "./state";
import { bestEngineAt } from "./tech";
import { canTravel, fuelCost, needWith, routeSpeed, travelExtra } from "./travel";
import { addStock, stockAt } from "./world";
import type { Corp, Voyage } from "./types";

/** Меньше этого в рейс не отправляют: полупустой трюм не окупает бак. */
export const HAUL_MIN = 6;
/** Как часто контора вообще думает о вывозе: раз в три месяца. Чаще незачем —
 *  рейс идёт годами, а перебор цен по всем складам стоит времени тика. */
export const HAUL_EVERY = 3;
/** Ниже этой выгоды рейс не затевают: возить ради двух монет — не торговля. */
export const HAUL_GAIN = 40;
/** Сколько систем-целей рассматривается на каждое вещество: только самые
 *  дорогие. Перебирать все пятьдесят на каждый склад каждой конторы — это
 *  квадрат, который в тике не нужен. */
export const HAUL_TOP = 4;

/** Самые дорогие рынки по каждому веществу. */
function topMarkets(): Record<string, { sys: number; price: number }[]> {
  const out: Record<string, { sys: number; price: number }[]> = {};
  ORES.forEach((k) => { out[k] = []; });
  Object.keys(local).forEach((key) => {
    const i = key.indexOf("|");
    const sys = +key.slice(0, i), k = key.slice(i + 1);
    if (!out[k]) return;
    out[k].push({ sys: sys, price: local[key].price });
  });
  ORES.forEach((k) => {
    out[k].sort((a, b) => { return b.price - a.price; });
    out[k] = out[k].slice(0, HAUL_TOP);
  });
  return out;
}

interface Haul { src: number; dst: number; k: string; qty: number; gain: number; }

/** Что этой конторе выгоднее всего вывезти прямо сейчас. */
function bestHaul(c: Corp, top: Record<string, { sys: number; price: number }[]>): Haul | null {
  let best: Haul = null;
  for (const sysKey in c.stock) {
    const src = +sysKey;
    ORES.forEach((k) => {
      const have = stockAt(c, src, k);
      if (have < HAUL_MIN) return;
      const from = priceAt(k, src);
      top[k].forEach((m) => {
        if (m.sys === src || m.price <= from) return;
        if (!knowsSys(c, m.sys) || !canTravel(src, m.sys)) return;
        // Грузят столько, сколько увезут: больше двух трюмов межзвёздному
        // грузовику не дают, и прикидка выгоды считается по тому же числу.
        const qty = Math.min(have, ORE_PER_HOLD * 2);
        const gain = (m.price - from) * qty - fuelBill("sfuel", fuelCost(src, m.sys), src);
        if (gain < HAUL_GAIN) return;
        if (!best || gain > best.gain) best = { src: src, dst: m.sys, k: k, qty: qty, gain: gain };
      });
    });
  }
  return best;
}

export function haulRun(): void {
  if (S.tick % HAUL_EVERY !== 0) return;
  const top = topMarkets();
  corps.forEach((c) => {
    // Вольница сырьём не торгует: у неё склад — награбленное, а не товар.
    if (c.pirate) return;
    const h = bestHaul(c, top);
    if (!h) return;
    const extra = travelExtra(h.src, h.dst);
    const need = needWith(vtype("cargo"), extra);
    const d = takeDock(c, null, h.src, "cargo", need);
    if (!d) {
      // Грузовика нет — заказываем на ближайшей верфи и ждём. Заказ висит один:
      // без этого контора закладывала бы по грузовику каждые три месяца.
      //
      // Двигатель берётся тот, что лежит В СИСТЕМЕ ВЕРФИ, а не в системе
      // погрузки: грузят у камня, где нет ни цеха, ни склада, ни одной детали,
      // и спрашивать двигатель там — значит не построить корабль никогда.
      // Ровно на этом сырьевые рейсы и стояли: вывозить было чем, не на чем.
      const y = nearestYard(h.src, c, realmOfCorp(c));
      if (!y) return;
      const recipe = shipNeed(vtype("cargo"), bestEngineAt(y.world.sys), travelExtra(y.world.sys, h.dst));
      // Двух заказанных грузовиков конторе хватает: один возит детали чужим
      // сборкам, второй — своё сырьё. Больше — и верфь забивается транспортом.
      if (recipe && orderCount("cargo", c) < 2) orderFreighter(c, y.world, recipe);
      return;
    }
    const room = oreRoomOf(d.parts);
    const qty = Math.min(h.qty, room, stockAt(c, h.src, h.k));
    const tanks = fuelCost(h.src, h.dst);
    // Корабль уже взят: не вышло с топливом или грузом — он остаётся у конторы
    // на стоянке, а не исчезает вместе с уплаченными деньгами.
    if (qty < HAUL_MIN || !takeRes(c, h.src, "sfuel", false, tanks)) {
      d.corp = c.id; d.gov = null; docks.push(d);
      return;
    }
    addStock(c, h.src, h.k, -qty);
    const v = { kind: "ore", sysFrom: h.src, to: h.dst, k: h.k, qty: qty, corp: c.id,
                forCorp: c.id, shipOwner: c.id, color: c.color, parts: d.parts,
                t: 0, dur: (140 + rnd() * 50) / routeSpeed(h.src, h.dst, c.id, d.parts),
                born: dateStr(), captain: d.captain } as Voyage;
    voyages.push(v);
    S.oreHauled += qty;
  });
}
