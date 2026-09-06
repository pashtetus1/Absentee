// Ходовые двигатели: пять марок, каждая быстрее. Патентуются как всё
// остальное — держатель Mk3 какое-то время летает вдвое быстрее соседей.
// Базовые рейсы нарочно медленные: ускорение должно ощущаться как награда,
// а не как возврат к норме.

import { COLTECH, COMPS, MARKS, colOf, compOf, markOf } from "./data";
import { canBuild, corps, patents, tickCache } from "./state";
import type { Corp, Dev, Engine, Tech, World } from "./types";

export var ENGINES: Engine[] = [
  { key:"eng1", name:"Ходовые двигатели Mk1", short:"ход Mk1", diff:700,  mult:1.3 },
  { key:"eng2", name:"Ходовые двигатели Mk2", short:"ход Mk2", diff:1500, mult:1.6 },
  { key:"eng3", name:"Ходовые двигатели Mk3", short:"ход Mk3", diff:2600, mult:2.0 },
  { key:"eng4", name:"Ходовые двигатели Mk4", short:"ход Mk4", diff:4000, mult:2.5 },
  { key:"eng5", name:"Ходовые двигатели Mk5", short:"ход Mk5", diff:5600, mult:3.1 }
];
export function engOf(k: string){ for (var i=0;i<ENGINES.length;i++) if (ENGINES[i].key===k) return ENGINES[i]; }
// во сколько раз корабли этой компании быстрее базы (по лучшей доступной марке)
export function speedOf(corpId: number) {
  var c = corps[corpId], best = 1;
  if (!c) return 1;
  ENGINES.forEach(function (e) { if (canBuild(c, e.key)) best = Math.max(best, e.mult); });
  return best;
}
// Освоение миров по классам, Mk1 и до бесконечности: каждая марка даёт +12%
// урожая и +1 к пределу населения на мирах этого класса — там, где у
// знающей компании есть филиал. Список растёт лениво: следующая марка
// появляется, когда кто-нибудь доводит предыдущую. Отделившиеся колонии
// вкладываются сюда в первую очередь — это единственное, что им по-настоящему
// нужно.
export const DEVS: Dev[] = [];
export function devOf(k: string){ for (var i=0;i<DEVS.length;i++) if (DEVS[i].key===k) return DEVS[i]; }
export function devKey(cls: string, n: number){ return "dev_" + cls + "_" + n; }
export function ensureDev(cls: string, n: number) {
  if (devOf(devKey(cls, n))) return;
  var col = colOf(cls);
  var d = { key:devKey(cls, n), cls:cls, mark:n, short:col.short + " Mk" + n,
            name:"Освоение: " + col.name.toLowerCase() + " Mk" + n,
            diff:Math.round(900 * Math.pow(1.45, n - 1)) };
  DEVS.push(d);
  corps.forEach(function (c) { if (c.spent[d.key] === undefined) c.spent[d.key] = 0; });
  if (!patents[d.key]) patents[d.key] = { owner:-1, since:0, told:false };
}
// лучшая марка освоения, действующая на этом мире: среди компаний с филиалом
// лучшая марка класса у компании считается раз за тик на компанию, а не на
// каждую пару филиал x мир: марок освоения к концу партии под сотню
export function corpDevBest(c: Corp, cls: string) {
  var byCorp = tickCache.devBest || (tickCache.devBest = {});
  var mine = byCorp[c.id] || (byCorp[c.id] = {});
  if (mine[cls] !== undefined) return mine[cls];
  var best = 0;
  DEVS.forEach(function (d) { if (d.cls === cls && canBuild(c, d.key)) best = Math.max(best, d.mark); });
  mine[cls] = best;
  return best;
}
export function devLevel(w: World) {
  if (tickCache.dev.has(w)) return tickCache.dev.get(w);
  var best = 0;
  w.branches.forEach(function (b) { best = Math.max(best, corpDevBest(corps[b.corp], w.type.tech)); });
  tickCache.dev.set(w, best);
  return best;
}
export function devMult(w: World){ return 1 + 0.12 * devLevel(w); }
export function devCap(w: World){ return devLevel(w); }
// Пять таблиц в одном списке: всё, во что можно вкладываться. Порядок тот же,
// что и раньше — от него зависит, что компания выберет при равных прочих.
export function allTech(): Tech[] { return ([] as Tech[]).concat(COMPS, COLTECH, MARKS, ENGINES, DEVS); }
export function techOf(k: string){ return compOf(k) || colOf(k) || markOf(k) || engOf(k) || devOf(k); }
