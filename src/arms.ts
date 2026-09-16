// ===================== оружие и чертежи =====================
//
// Военное дело в этой игре устроено в два этажа, и этажи эти разные.
//
// ВНИЗУ — ДЕТАЛИ. Оружие, броня, бомбы, десантные капсулы и наземное оружие
// (data.ts, ARMTAB): пять семейств по пять ступеней, лестницами, как корпуса и
// двигатели. Патента на ступень нет, и через две ступени она расходится по
// галактике: оружие не удержать в одних руках, его копируют.
//
// НАВЕРХУ — ЧЕРТЁЖ. Это и есть настоящая военная тайна: КАК из этих деталей
// собран корабль. Чертёж не лежит в таблице правил — он РОЖДАЕТСЯ в партии из
// того, до чего галактика доросла, состав у него какой угодно (три лучемёта и
// ни грамма брони — законный чертёж), исследуется он долго и патентуется, как
// любая обычная технология. Отсюда и весь смысл: детали у всех одни, а корабли
// получаются разные, и государство, у которого своей конторы нет, вынуждено
// брать чертёж у компаний — со всеми вытекающими.
//
// Отдельно стоит САМОДЕЛКА. У вольницы нет ни лабораторий, ни патентов, ни
// времени: она сколачивает рейдер из корпуса, двигателя и того оружия, что
// удалось достать. Это чертёж поколения НОЛЬ — его не исследуют, его знает
// всякий, кто взялся за оружие, и он нарочно слаб. Без него разбой был бы
// заперт наукой: пока никто в галактике не осилил лучемёт, вольница не могла бы
// выйти на промысел вовсе, а она выходила и до того, как оружие придумали.

import { ARMKEYS, HULLKEYS, armOf, armPower, bestHullMade, compOf, roomOf, roomOfKey, sizeOfNeed } from "./data";
import { askPrice } from "./market";
import { rnd } from "./rng";
import { L, S, anyKnows, canBuild, corps, market, patents, say } from "./state";
import { bestEngineMade } from "./tech";
import { addStock, stockAt } from "./world";
import type { Corp, Design, Part } from "./types";

// ---- сила ---------------------------------------------------------------
// Всё, что корабль умеет в бою, считается ТОЛЬКО по его деталям и только
// здесь. Ни чертёж, ни хозяин, ни звание в эти числа не входят: два корабля с
// одинаковым набором одинаковы в бою, чей бы флаг над ними ни висел.

/** Урон корабля в месяц боя. Голый корпус тоже что-то может — таранит, бьёт
 *  тем, что нашлось, — и это НЕ мелочь: пока в галактике не изобрели оружие,
 *  дрались бы вовсе не стреляя, и первая вольница не смогла бы взять даже
 *  безоружный хлебовоз. */
export const BARE_DMG = 1;
export function shipDmg(parts: Part[]): number {
  return BARE_DMG + armPower(parts, "beam");
}
/** Запас прочности: сам корпус плюс броня. Просторный корпус держит дольше
 *  тесного — в него и попасть можно больше раз, прежде чем развалится. */
export function shipHp(parts: Part[]): number {
  return 2 + roomOf(parts) * 0.8 + armPower(parts, "armor") * 2.2;
}
/** Сила бомбёжки с орбиты: во что корабль превращает наземный бой внизу. */
export function shipBomb(parts: Part[]): number { return armPower(parts, "bomb"); }
/** Сколько ополчения корабль высадит на планету. */
export function shipTroops(parts: Part[]): number { return armPower(parts, "drop"); }

/** Во сколько раз наземное оружие такой ступени сильнее голых рук. Ноль —
 *  оружия нет, дерутся чем придётся; отсюда и цена военного бюджета. */
export function groundMult(lvl: number): number {
  const k = ARMKEYS["gun"][Math.max(0, Math.min(5, lvl) - 1)];
  const a = lvl > 0 && k ? armOf(k) : null;
  return 1 + (a ? a.power : 0) * 0.7;
}
/** Лучшая ступень наземного оружия, лежащая на складах в этой системе. Ею и
 *  вооружаются: и арсенал мира, и восставшие, разобравшие чужие склады. */
export function gunAt(sys: number, only?: (c: Corp) => boolean): number {
  let best = 0;
  ARMKEYS["gun"].forEach((k, i) => {
    if (corps.some((c) => { return (!only || only(c)) && stockAt(c, sys, k) > 0; })) best = i + 1;
  });
  return best;
}
/** Чем вооружаются восставшие: тем, что взяли со складов, СТУПЕНЬЮ НИЖЕ
 *  лучшего. Тяжёлое лежит не на общем складе, а там, куда толпа не входит, — и
 *  разница в одну ступень и есть та щель, в которую пролезает военный бюджет:
 *  арсенал, купленный вовремя, оказывается лучше того, чем вооружилась улица. */
export function lootedGun(sys: number): number { return Math.max(0, gunAt(sys) - 1); }

// ---- чертежи ------------------------------------------------------------

/** Самоделка вольницы: поколение ноль. В списке чертежей её НЕТ — она не
 *  рождается в партии и не сохраняется, она есть всегда, как таблица правил.
 *  Состав её дописывается при постройке: корпус и двигатель обязательны, а
 *  оружие ставят то, какое удалось достать (kitFor ниже). */
export const RAIDER: Design = {
  key:"des0", gen:0, name:"Самоделка", short:"самоделка",
  diff:0, hull:"hull1", need:{ hull1:1, eng1:1 }, build:10
};

/** Чертежи, рождённые этой партией. Растёт лениво, как марки освоения. */
export const DESIGNS: Design[] = [];
export function designOf(k: string): Design | undefined {
  if (k === RAIDER.key) return RAIDER;
  for (let i = 0; i < DESIGNS.length; i++) if (DESIGNS[i].key === k) return DESIGNS[i];
  return undefined;
}
export function isDesign(k: string): boolean { return !!designOf(k); }

// Имена чертежей. Своё имя у корабля — половина смысла военного флота: «Гроза»
// с тремя лучемётами отличается от «Осы» не числом в панели, а тем, что её
// узнают. Имён двенадцать, и это же потолок числа чертежей за партию.
const DESNAMES = ["Гарпун","Оса","Кистень","Ворон","Кряж","Секира","Зарница","Шило","Оплот","Гроза","Багор","Стрелец"];

/** Какого уровня детали кладут в новый чертёж: ступенька выше того, что в
 *  галактике уже умеют делать. Чертёж — это замысел, он имеет право забегать
 *  вперёд на шаг, но не на пять: чертёж из деталей, которых никто не увидит
 *  ещё двести лет, — это не замысел, а мусор в списке технологий. */
function aimLvl(kind: string): number {
  let best = 0;
  ARMKEYS[kind].forEach((k, i) => { if (anyKnows(k)) best = i + 1; });
  return Math.max(1, Math.min(5, best + 1));
}

/** Придумать чертёж поколения gen; null — придумывать ещё не из чего. */
function rollDesign(gen: number): Design | null {
  const eng = bestEngineMade();
  if (!eng) return null;                       // без хода это не корабль
  // СКОЛЬКО МЕСТ — по лучшему корпусу, какой в галактике УМЕЮТ делать. Замысел
  // имеет право забегать вперёд на ступень оружия, но не на корпус: чертёж под
  // корпус, которого никто не строит, — это бумага, по которой нельзя собрать
  // ничего, а стоит она как сам этот корпус (он дороже всего остального
  // вместе взятого). Первый чертёж партии выходит на трёх местах: корпус,
  // двигатель и одно оружие — с этого военное дело и начинается.
  const room = Math.max(roomOfKey(HULLKEYS[0]), bestHullMade());
  let free = room - 2;                         // минус сам корпус, минус ходовой
  const n: Record<string, number> = {};
  const put = (kind: string, count: number): void => {
    const take = Math.min(count, free);
    if (take <= 0) return;
    const k = ARMKEYS[kind][aimLvl(kind) - 1];
    n[k] = (n[k] || 0) + take;
    free -= take;
  };
  // Состав ЛЮБОЙ: сколько оружия, брони, бомб и десанта — решает жребий, и
  // потому чертежи получаются разные. Оружие хотя бы одно: безоружный военный
  // корабль был бы просто дорогим корпусом.
  put("beam", 1);
  while (free > 0) {
    const r = rnd();
    if (r < 0.34) put("beam", 1);
    else if (r < 0.66) put("armor", 1);
    else if (r < 0.84) put("bomb", 1);
    else put("drop", 1);
    if (rnd() < 0.25) break;                   // не всякий замысел набивает корпус доверху
  }
  n[eng] = (n[eng] || 0) + 1;
  const hk = HULLKEYS.find((k) => { return roomOfKey(k) >= sizeOfNeed(n) + 1; });
  if (!hk) return null;
  n[hk] = 1;
  let sum = 0;
  Object.keys(n).forEach((k) => { sum += compOf(k).diff * n[k]; });
  const name = DESNAMES[gen - 1];
  return {
    key:"des" + gen, gen:gen, name:"Чертёж «" + name + "»", short:"«" + name + "»",
    // Долго. Чертёж стоит дороже всех деталей, которые в него вошли, вместе
    // взятых: придумать корабль труднее, чем сделать любую его часть.
    diff:Math.round(1800 * Math.pow(1.45, gen - 1) + sum * 0.55),
    hull:hk, need:n, build:14 + 3 * sizeOfNeed(n)
  };
}

/** Завести следующий чертёж, если пора. Список растёт лениво, как марки
 *  освоения: новый появляется, когда предыдущий кто-то довёл до конца, —
 *  иначе в панели висела бы дюжина недостижимых бумаг. */
export function ensureDesign(): void {
  if (DESIGNS.length >= DESNAMES.length) return;
  const last = DESIGNS[DESIGNS.length - 1];
  if (last && !anyKnows(last.key)) return;
  const d = rollDesign(DESIGNS.length + 1);
  if (!d) return;
  DESIGNS.push(d);
  corps.forEach((c) => { if (c.spent[d.key] === undefined) c.spent[d.key] = 0; });
  if (!patents[d.key]) patents[d.key] = { owner:-1, since:0, told:false };
  say("Придуман <b>" + d.name + "</b>: " + designLine(d) + ". Кто доведёт его первым, получит патент.");
}

/** Состав чертежа словами — им он и отличается от других. */
export function designLine(d: Design): string {
  return Object.keys(d.need).map((k) => {
    return compOf(k).short + (d.need[k] > 1 ? " ×" + d.need[k] : "");
  }).join(", ");
}

/** Чертежи, по которым контора имеет право строить: знает и патент не чужой.
 *  Самоделка достаётся вольнице, и только ей. */
export function designsFor(c: Corp): Design[] {
  const out: Design[] = [];
  if (c.pirate) out.push(RAIDER);
  DESIGNS.forEach((d) => { if (canBuild(c, d.key)) out.push(d); });
  return out;
}
/** Лучший чертёж конторы: у кого состав тяжелее, тот и лучше. */
export function bestDesign(c: Corp): Design | null {
  let best: Design = null, top = -1;
  designsFor(c).forEach((d) => {
    const w = sizeOfNeed(d.need);
    if (w > top) { top = w; best = d; }
  });
  return best;
}
/** Кто в галактике умеет строить по этому чертежу. Государство своей конторы
 *  не имеет и чертёж БЕРЁТ У КОМПАНИЙ — по этому списку и берёт. */
export function designMakers(d: Design): Corp[] {
  return corps.filter((c) => { return canBuild(c, d.key); });
}

// ---- набор деталей ------------------------------------------------------

/** Состав, которым чертёж собирают ЗДЕСЬ И СЕЙЧАС.
 *
 *  У обычного чертежа это его собственный состав, слово в слово. У самоделки
 *  состава почти нет: вольница ставит корпус с двигателем и довешивает лучшее
 *  оружие и броню, какие лежат на складах в этой системе, — сколько влезет в
 *  корпус. Отсюда и её главное свойство: самоделка ровно настолько опасна,
 *  насколько богата округа. */
export function kitFor(d: Design, sys: number): Record<string, number> {
  if (d.gen > 0) return { ...d.need };
  const n: Record<string, number> = { ...d.need };
  let room = roomOfKey(d.hull) - sizeOfNeed(n);
  (["beam", "armor"] as string[]).forEach((kind) => {
    if (room <= 0) return;
    const have = armAt(sys, kind);
    if (!have) return;
    n[have] = (n[have] || 0) + 1; room--;
  });
  return n;
}

/** Лучшая ступень этого семейства, лежащая на складах В ЭТОЙ СИСТЕМЕ; null —
 *  ни одной. Этим и вооружается самоделка — и на стапеле (kitFor выше), и
 *  потом, когда ватага перебирает готовый рейдер (pirateRefit в army.ts). Одна
 *  дверь на оба случая: «чем богата округа» обязано значить одно и то же в
 *  день сборки и через полвека. */
export function armAt(sys: number, kind: string): string | null {
  let have: string = null;
  ARMKEYS[kind].forEach((k) => { if (corps.some((c) => { return stockAt(c, sys, k) > 0; })) have = k; });
  return have;
}

/** Во что обойдётся набор по ходовым ценам. */
export function kitCost(need: Record<string, number>): number {
  let sum = 0;
  Object.keys(need).forEach((k) => { sum += market[k].price * need[k] * (1 + L.tradeFee); });
  return sum;
}

/** Кошелёк, который платит за набор: контора (тогда своё со склада идёт даром)
 *  или казённый фонд. Одна дверь на оба случая — иначе покупка деталей была бы
 *  написана дважды и однажды разошлась бы. */
export interface Purse {
  corp: Corp | null;
  pay(sum: number): boolean;
  back(sum: number): void;
}

/** Купить набор деталей НА МЕСТЕ: своё со склада, чужое у соседей по цеху, по
 *  запросной цене с торговым сбором. Не хватило хоть одной детали или денег —
 *  всё купленное возвращается назад, и набора нет: корабль из половины деталей
 *  не собирается, а деньги за эту половину уже были бы потрачены. */
export function buyKit(p: Purse, sys: number, need: Record<string, number>): Part[] | null {
  const taken: Part[] = [];
  let ok = true;
  Object.keys(need).forEach((k) => {
    for (let i = 0; i < need[k]; i++) {
      if (!ok) return;
      if (p.corp && stockAt(p.corp, sys, k) > 0) {
        addStock(p.corp, sys, k, -1); taken.push({ k:k, from:p.corp.id, price:0 });
        continue;
      }
      let seller: Corp = null;
      corps.forEach((s) => {
        if ((p.corp && s.id === p.corp.id) || stockAt(s, sys, k) <= 0) return;
        if (!seller || stockAt(s, sys, k) > stockAt(seller, sys, k)) seller = s;
      });
      if (!seller) { ok = false; return; }
      const price = askPrice(seller, k) * (1 + L.tradeFee);
      if (!p.pay(price)) { ok = false; return; }
      seller.cash += price / (1 + L.tradeFee); seller.sold++;
      S.treasury += price - price / (1 + L.tradeFee);
      addStock(seller, sys, k, -1);
      S.trades++; S.turnover += price;
      taken.push({ k:k, from:seller.id, price:price });
    }
  });
  if (ok) return taken;
  taken.forEach((t) => {
    addStock(corps[t.from], sys, t.k, 1);
    if (t.price) { corps[t.from].cash -= t.price / (1 + L.tradeFee); p.back(t.price); }
  });
  return null;
}

/** Лежит ли в этой системе всё, из чего такой набор собирают. Спрашивается ДО
 *  того, как кто-то полез в кошелёк: заказ военного корабля не должен
 *  начинаться с покупки половины деталей. */
export function kitAt(sys: number, need: Record<string, number>, who: Corp | null): boolean {
  return Object.keys(need).every((k) => {
    let have = who ? stockAt(who, sys, k) : 0;
    corps.forEach((s) => { if (!who || s.id !== who.id) have += stockAt(s, sys, k); });
    return have >= need[k];
  });
}
