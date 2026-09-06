// ===================== рынок труда на каждом мире =====================

import { YARD_MAX, YARD_MIN, YARD_SHARE } from "./shipyard";
import { L, corps } from "./state";
import { devCap, devMult } from "./tech";
import { clamp } from "./util";
import { popOf } from "./world";
import type { Pop, Wage, World } from "./types";

export function squeeze(jobs: number, workers: number): number { return clamp(1 + 0.5 * (jobs - workers) / Math.max(1.2, workers), 0.55, 2.2); }

// Сколько мир вырастит В ЭТОМ месяце — единственное место, где это считается.
// Раньше формула жила прямо в labour(), а те, кому урожай был нужен для
// решения, прикидывали его заново и каждый по-своему: foodRun брал фермеров на
// урожайность типа, relief — то же плюс освоение, orders — снова без освоения.
// Три оценки одного числа расходились с настоящим тем сильнее, чем лучше был
// освоен мир, и именно из-за этого освоенные миры записывались в нахлебники.
export function harvestOf(w: World): number {
  return w.pop.farm * w.type.farm *
         (w.rough > 0 ? 0.55 : 1) *          // разруха первых десяти лет
         (w.blight > 0 ? 0.5 : 1) *          // неурожай
         devMult(w);                          // освоение класса миров
}

export function labour(w: World): void {
  const p = w.pop, total = popOf(w);
  if (total <= 0.02) return;

  if (w.rough > 0) w.rough--;
  const rough = w.rough > 0;
  if (w.blight > 0) w.blight--;
  const grown = harvestOf(w);   // разруха, неурожай, освоение
  w.food.stock += grown - total;
  const hungry = w.food.stock < 0;
  if (hungry) w.food.stock = 0;
  w.food.short = hungry ? w.food.short + 1 : 0;
  w.food.price = clamp(w.food.price * (1 + 0.04 * (total - grown) / Math.max(1, total)), 0.2, 6);
  w.wage.farm = w.type.farm > 0 ? w.food.price * 2.4 : 0;

  let jp = 0, js = 0;
  // верфь с работой в очереди просит людей наравне с цехами
  const yardJobs = (w.yard && w.yard.queue.some((b) => b.left > 0)) ? clamp(p.prod * YARD_SHARE, YARD_MIN, YARD_MAX) : 0;
  jp += yardJobs;
  w.branches.forEach((b) => {
    const c = corps[b.corp], n = Math.max(1, c.branches.length);
    b.jobs.prod = clamp(c.cash / (180 * n), 0.3, 8) * (rough ? 0.35 : 1);   // цехов ещё нет
    b.jobs.sci = clamp(c.cash / (420 * n), 0.1, 5) * (rough ? 0.35 : 1) * (c.native ? 2.2 : 1);   // отделившиеся живут наукой
    jp += b.jobs.prod; js += b.jobs.sci;
  });
  w.wage.prod = 3.0 * squeeze(jp, p.prod);
  w.wage.sci = 4.2 * squeeze(js, p.sci);
  const kp = jp > 0 ? Math.min(1, p.prod / jp) : 0, ks = js > 0 ? Math.min(1, p.sci / js) : 0;
  w.branches.forEach((b) => { b.emp.prod = b.jobs.prod * kp; b.emp.sci = b.jobs.sci * ks; });
  if (w.yard) w.yard.crew = yardJobs * kp;

  const outP = Math.max(0, p.prod - jp) * 0.05, outS = Math.max(0, p.sci - js) * 0.05;
  p.prod -= outP; p.sci -= outS; p.free += outP + outS;

  const openP = Math.max(0, jp - p.prod), openS = Math.max(0, js - p.sci);
  const eager = clamp(0.32 - L.dole * 0.07, 0.04, 0.32);
  const take = Math.min(p.free * eager, openP + openS);
  if (take > 0 && openP + openS > 0) {
    const shareP = openP / (openP + openS);
    p.free -= take; p.prod += take * shareP; p.sci += take * (1 - shareP);
  }
  if (w.type.farm > 0) {
    const toFarm = p.free * clamp(0.04 - L.dole * 0.01, 0.005, 0.04);
    p.free -= toFarm; p.farm += toFarm;
  }

  let best: keyof Wage = w.type.farm > 0 ? "farm" : "prod";
  if (w.wage.prod > w.wage[best]) best = "prod";
  if (w.wage.sci > w.wage[best]) best = "sci";
  let mv = 0;
  (["farm","prod","sci"] as (keyof Wage)[]).forEach((k) => {
    if (k === best) return;
    if (w.wage[best] < w.wage[k] * 1.12) return;
    const open = best === "farm" ? 1e9 : (best === "prod" ? jp - p.prod : js - p.sci);
    if (open <= 0) return;
    const m = Math.min(p[k] * 0.012, open);
    p[k] -= m; p[best] += m; mv += m;
  });
  w.flow = mv > 0.02 ? "идут в " + ({ farm:"поле", prod:"цеха", sci:"лаборатории" })[best] : "перетока почти нет";

  // Рост и убыль. Тесно — растут медленнее, голодно — убывают. Убыль берётся
  // со ВСЕХ каст: если вычитать только из свободных, итог расходится с
  // суммой по занятиям и панель начинает врать (так уже было).
  w.cap = w.cap0 + devCap(w);                               // освоение поднимает предел
  const fill = total / w.cap;
  // рост медленный: родина огромна, и без этого она заполнялась на треть к
  // первому перелёту, а должна оставаться почти пустой и бедной
  // Голод должен КУСАТЬСЯ. При прежних 0.25% в месяц за четыре года голода мир
  // терял 11% людей — то есть голодал часто (треть месяцев) и безнаказанно.
  const g = hungry ? -0.004 : 0.0012 * (1 - fill);
  const add = total * g;
  if (add >= 0) p.free += add;
  else (["farm","prod","sci","free"] as (keyof Pop)[]).forEach((k) => { p[k] = Math.max(0, p[k] + add * p[k] / total); });

  // Желание уехать: теснота плюс безработица плюс голод. Это не приказ игрока
  // и не приказ компании — просто людям тут нечего ловить.
  const unemp = p.free / Math.max(0.05, total);
  const push = Math.max(0, fill - 0.7) * 1.4 + Math.max(0, unemp - 0.12) * 1.2 + (hungry ? 0.5 : 0) + (rough ? 0.3 : 0);
  w.wantOut = clamp(push * total * 0.25, 0, p.free + p.farm * 0.3);
  w.wantIn = Math.max(0, w.cap * 0.85 - total);
}

