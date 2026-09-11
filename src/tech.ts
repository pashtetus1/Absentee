// Ходовые двигатели: четыре модели, каждая быстрее. Патентуются как всё
// остальное — держатель Mk3 какое-то время летает вдвое быстрее соседей.
// Базовые рейсы нарочно медленные: ускорение должно ощущаться как награда,
// а не как возврат к норме.
//
// Отдельной таблицы у них больше нет: двигатель — это ДЕТАЛЬ, она лежит в
// COMPS рядом с корпусом, её исследуют, делают и продают тем же кодом. Здесь
// остался только взгляд на те же записи под другим углом (ENGINES) и правила,
// которые к ним прилагаются. Пока таблица была своя, множитель скорости висел
// на компании и на корабле его не было видно: два одинаковых грузовика летели
// с разной скоростью, и объяснить это, глядя на корабль, было нечем.

import { COLTECH, COMPS, ENGKEYS, MARKS, clsOf, colOf, compOf, isEngine, markOf } from "./data";
import { anyMakes, canBuild, corps, patents, tickCache } from "./state";
import { stockAt } from "./world";
import type { ColTech, Corp, Dev, Engine, Tech, World } from "./types";

/** Модели ходового двигателя как технологии: те же записи COMPS, отобранные
 *  по mult. Порядок — от слабой к сильной, как в ENGKEYS. */
export const ENGINES: Engine[] = ENGKEYS.map((k) => compOf(k) as unknown as Engine);
export function engOf(k: string): Engine{ return isEngine(k) ? compOf(k) as unknown as Engine : undefined; }
// во сколько раз корабли этой компании быстрее базы (по лучшей модели, какую
// она умеет делать). Это НЕ скорость её кораблей: корабль идёт на том
// двигателе, который на нём стоит (engMult), а эта величина говорит лишь, что
// компания способна поставить на новый корабль.
export function speedOf(corpId: number): number {
  let c = corps[corpId], best = 1;
  if (!c) return 1;
  ENGINES.forEach((e) => { if (canBuild(c, e.key)) best = Math.max(best, e.mult); });
  return best;
}
/** Множитель лучшей модели, которую компания умеет делать САМА; 0 — не умеет
 *  ни одной.
 *
 *  Отличается от speedOf ровно нулём, и этот ноль важен: speedOf возвращает
 *  единицу и тому, у кого двигателя нет вовсе, а множитель Mk1 — тоже единица.
 *  Пока наука сравнивала модель со speedOf, Mk1 отсеивалась как «эту скорость
 *  уже имеем», и самая дешёвая ступень лестницы была недостижима в принципе:
 *  партия ждала Mk2 за 1500, чтобы взлетел первый корабль. */
export function ownEngine(c: Corp): number {
  let best = 0;
  ENGINES.forEach((e) => { if (canBuild(c, e.key)) best = Math.max(best, e.mult); });
  return best;
}
/** Лучшая модель, которую в галактике хоть кто-то умеет делать: её и закажет
 *  компания, потому что деталь ей привезут откуда угодно. */
export function bestEngineMade(): string | null {
  let out: string | null = null;
  ENGKEYS.forEach((k) => { if (anyMakes(k)) out = k; });
  return out;
}
/** Лучшая модель, которая ПРЯМО СЕЙЧАС лежит на складе в этой системе.
 *
 *  Правительство мира и частная помощь покупают только из местного склада —
 *  возить детали ради хлебовоза они не умеют. Спрашивать у них лучшую модель
 *  галактики значило бы обрекать окраину на вечное ожидание двигателя, какого
 *  тут отродясь не было. */
/** Лучшая марка перехода, что лежит на складе в этой системе: её и ставят на
 *  грузовик, который собирают на месте. Спрашивать лучшую марку галактики
 *  бессмысленно — детали с другого конца сети сюда никто не привезёт. */
export function bestMarkAt(sys: number): string | null {
  let out: string | null = null;
  MARKS.forEach((m) => { if (corps.some((c) => stockAt(c, sys, m.key) > 0)) out = m.key; });
  return out;
}
export function bestEngineAt(sys: number): string | null {
  let out: string | null = null;
  ENGKEYS.forEach((k) => { if (corps.some((c) => stockAt(c, sys, k) > 0)) out = k; });
  return out;
}
// Освоение миров по классам, Mk1..Mk5: каждая марка даёт +12%
// урожая и +1 к пределу населения на мирах этого класса — там, где у
// знающей компании есть филиал. Список растёт лениво: следующая марка
// появляется, когда кто-нибудь доводит предыдущую. Отделившиеся колонии
// вкладываются сюда в первую очередь — это единственное, что им по-настоящему
// нужно.
export const DEVS: Dev[] = [];
export const DEV_MAX = 5;                 // марок освоения у класса ровно пять
export function devOf(k: string): Dev{ for (let i=0;i<DEVS.length;i++) if (DEVS[i].key===k) return DEVS[i]; }
export function devKey(cls: string, n: number): string{ return "dev_" + cls + "_" + n; }
export function ensureDev(cls: string, n: number): void {
  if (n > DEV_MAX || devOf(devKey(cls, n))) return;
  const col = clsOf(cls);
  const d = { key:devKey(cls, n), cls:cls, mark:n, short:col.short + " Mk" + n,
            name:"Освоение: " + col.name.toLowerCase() + " Mk" + n,
            diff:Math.round(900 * Math.pow(1.9, n - 1)) };
  DEVS.push(d);
  corps.forEach((c) => { if (c.spent[d.key] === undefined) c.spent[d.key] = 0; });
  if (!patents[d.key]) patents[d.key] = { owner:-1, since:0, told:false };
}
// лучшая марка освоения, действующая на этом мире: среди компаний с филиалом
// лучшая марка класса у компании считается раз за тик на компанию, а не на
// каждую пару филиал x мир: марок освоения к концу партии под сотню
export function corpDevBest(c: Corp, cls: string): number {
  const byCorp = tickCache.devBest || (tickCache.devBest = {});
  const mine = byCorp[c.id] || (byCorp[c.id] = {});
  if (mine[cls] !== undefined) return mine[cls];
  let best = 0;
  DEVS.forEach((d) => { if (d.cls === cls && canBuild(c, d.key)) best = Math.max(best, d.mark); });
  mine[cls] = best;
  return best;
}
export function devLevel(w: World): number {
  if (tickCache.dev.has(w)) return tickCache.dev.get(w);
  let best = 0;
  w.branches.forEach((b) => { best = Math.max(best, corpDevBest(corps[b.corp], w.type.cls)); });
  tickCache.dev.set(w, best);
  return best;
}
export function devMult(w: World): number{ return 1 + 0.12 * devLevel(w); }
export function devCap(w: World): number{ return devLevel(w); }
// Технологии С МАРКАМИ — ступени лестницы: межзвёздный переход, ходовые
// двигатели, освоение классов миров. У них своя судьба, не как у прочих
// деталей: патентов нет, зато берутся строго по порядку, и ступень становится
// общим достоянием, лишь когда кто-то освоил две следующие. Пока же ею
// пользуется лишь тот, кто дошёл сам.
export function markStep(k: string): { fam: string; n: number } | null {
  const m = markOf(k);
  if (m) return { fam:"move", n:m.mark };
  if (isEngine(k)) return { fam:"eng", n:ENGKEYS.indexOf(k) + 1 };
  const d = devOf(k);
  if (d) return { fam:"dev_" + d.cls, n:d.mark };
  return null;
}
/** Ключ n-й ступени семейства; null, если такой ступени (пока) нет. */
export function stepKey(fam: string, n: number): string | null {
  if (n < 1) return null;
  if (fam === "move") return MARKS[n - 1] ? MARKS[n - 1].key : null;
  if (fam === "eng") return ENGKEYS[n - 1] || null;
  const k = devKey(fam.slice(4), n);
  return devOf(k) ? k : null;
}
/** Ступень, без которой эту не взять; null у первой и у технологий без марок. */
export function prevStep(k: string): string | null {
  const st = markStep(k);
  return st ? stepKey(st.fam, st.n - 1) : null;
}

// Четыре таблицы в одном списке: всё, во что можно вкладываться. Порядок тот же,
// что и раньше — от него зависит, что компания выберет при равных прочих.
// ENGINES сюда НЕ добавляются: это те же записи, что уже пришли в COMPS, и
// вторым вхождением компания вкладывалась бы в один двигатель дважды.
// MARKS сюда тоже НЕ добавляются: с тех пор как марка — деталь, она уже в COMPS.
export function allTech(): Tech[] { return ([] as Tech[]).concat(COMPS, COLTECH, DEVS); }
export function techOf(k: string): ColTech{ return compOf(k) || colOf(k) || markOf(k) || engOf(k) || devOf(k); }
