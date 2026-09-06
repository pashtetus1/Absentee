// ===================== заказы, консорциумы, филиалы =====================

import { vtype } from "./data";
import { galaxyRange, rangeOf, within } from "./galaxy";
import { rnd } from "./rng";
import { YARD_WORK, nearestYard, yardAt } from "./shipyard";
import { S, anyMakes, canBuild, corps, dateStr, fill, market, projects, say, systems, voyages, worlds } from "./state";
import { gated, reachable } from "./travel";
import { clamp, dist } from "./util";
import { hasBranch, openBranch, popOf } from "./world";
import type { Corp, Order, Part, Planet, Rock, Sys, VType } from "./types";

export function freeRocks(s: Sys): Rock[]{ return s.rocks.filter((r) => { return !r.taken; }); }
// Заказ не начинают, пока нет горючего, на котором это полетит: иначе корабль
// собирают, а потом он десятилетиями стоит у стапеля и ест деньги впустую.
export function buildable(vt: VType): boolean {
  const fuelKey = (vt.key === "mine" || vt.key === "colony") ? "fuel" : "sfuel";
  if (!anyMakes(fuelKey)) return false;
  return Object.keys(vt.need).every((k) => { return anyMakes(k); });
}
export function anyRock(): boolean{ return systems.some((s) => { return s.unlocked && reachable(s.id) && freeRocks(s).length; }); }
// Ближайшая закрытая звезда, до которой ДОТЯГИВАЕТСЯ марка этой компании.
// Отсюда и берётся ощущение края карты: дальние звёзды видны, но пока не
// осилена следующая марка, до них не дострелить.
export function jumpTarget(c: Corp): { from: number; to: number } | null {
  const range = c ? rangeOf(c) : galaxyRange();
  if (range <= 0) return null;
  let out: { from: number; to: number } = null, bd = 1e9;
  systems.forEach((s) => {
    if (!s.unlocked) return;
    // Стартовать можно только там, где живут люди, и куда верфь может пригнать
    // корабль. Голая открытая звезда — цель, а не площадка.
    if (!s.bodies.some((b) => b.world)) return;
    if (!nearestYard(s.id, c)) return;
    within(s.id, range).forEach((n) => {
      if (systems[n].unlocked) return;
      if (voyages.some((v) => { return v.to === n && (v.kind === "jump" || v.kind === "opener"); })) return;
      if (corps.some((o) => { return o.order && o.order.to === n; })) return;   // туда уже собираются
      const d = dist(s, systems[n]);
      if (d < bd) { bd = d; out = { from:s.id, to:n }; }
    });
  });
  return out;
}

// Ворота ставят там, где от них больше толку: где за системой лежат закрытые
// соседи и где колония сидит на привозной еде — без ворот хлебовоз до неё
// просто не долетит.
// Ворота ставят в системе, до которой дотягивается марка от УЖЕ построенных
// ворот. Первые ворота ставят дома. Дальше сеть растёт кольцами, и каждая
// новая система стоит отдельных ворот — зато внутри сети возят даром.
export function gateTarget(c: Corp): { sys: number; score: number } | null {
  const range = c ? rangeOf(c) : galaxyRange();
  if (!systems[0].gate.built && !systems[0].gate.building) return { sys:0, score:99 };
  if (range <= 0) return null;
  let best: { sys: number; score: number } = null;
  systems.forEach((s) => {
    if (s.gate.built || s.gate.building) return;
    if (!within(s.id, range).some(gated)) return;
    const hungry = s.bodies.some((b) => {
      return b.world && b.world.pop.farm * b.world.type.farm < popOf(b.world);
    });
    // ценнее ворота там, где за ними ещё не открытые звёзды, и там, где
    // колония сидит на привозной еде: без ворот хлебовоз не долетит
    const beyond = within(s.id, range).filter((n) => { return !systems[n].unlocked; }).length;
    const score = (s.unlocked ? 0 : 3) + beyond * 1.5 + (hungry ? 4 : 0);
    if (score <= 0) return;
    if (!best || score > best.score) best = { sys:s.id, score:score };
  });
  return best;
}
export function expandTarget(c: Corp): { sys: number; score: number; } | { from: number; to: number; }{ return S.move.key === "gates" ? gateTarget(c) : jumpTarget(c); }
export function orderCost(vt: VType): number {
  let sum = 0;
  Object.keys(vt.need).forEach((k) => { sum += market[k].price * vt.need[k]; });
  return sum;
}
// Наружу выходят те, у кого есть филиал хоть в одной колонии — не только
// основатель. Иначе из пяти компаний расширяться могли две-три, и если
// держатель марки в их число не попадал, галактика стояла двести лет.
export function hasColonyAnywhere(c: Corp): boolean{ return c.branches.length > 1; }

export function reviewOrders(): void {
  corps.forEach((c) => {
    if (c.order || c.cool > 0) return;
    let best: VType = null, top = -1;
    [vtype("mine"), vtype(S.move.vt)].forEach((vt) => {
      if (!buildable(vt)) return;
      if (vt.key === "mine" && !anyRock()) return;
      if (vt.key !== "mine" && (!hasColonyAnywhere(c) || !expandTarget(c))) return;
      let score = vt.key !== "mine" ? 46 : (vt.yield * 0.55 * vt.term) / Math.max(20, orderCost(vt));
      let own = 0, all = 0;
      Object.keys(vt.need).forEach((k) => { all += vt.need[k]; if (canBuild(c, k)) own += vt.need[k]; });
      score *= 1 + own / all * 0.6;
      if (score > top) { top = score; best = vt; }
    });
    if (!best || rnd() > clamp(0.55 / c.nerve, 0.2, 0.9)) return;
    // Место назначения выбирается СЕЙЧАС, а не когда комплект собран: детали
    // надо свозить в конкретную систему, и заранее должно быть ясно, в какую.
    const o = { type:best.key, need:JSON.parse(JSON.stringify(best.need)), got:{}, parts:[] as Part[], born:dateStr() } as Order;
    if (best.key === "mine") {
      let pickS: Sys = null, top2 = -1;
      systems.forEach((s) => {
        if (!s.unlocked || !reachable(s.id) || !freeRocks(s).length) return;
        const score = 1 / (1 + s.depth * 0.25);
        if (score > top2) { top2 = score; pickS = s; }
      });
      if (!pickS) return;
      const free = freeRocks(pickS);
      o.rock = free[Math.floor(rnd() * free.length)];
      o.rock.taken = true;
      const ym = nearestYard(baseSys(c, pickS.id), c);
      if (!ym) { o.rock.taken = false; c.needYard = true; return; }
      o.dst = pickS.id; o.sys = ym.world.sys; o.yard = ym;   // собирают на верфи, везут к астероиду
    } else if (best.key === "gate") {
      // Ворота для ЗАКРЫТОЙ системы собираются у ближайших готовых ворот и
      // уходят туда одним рейсом: свозить детали в систему, до которой ещё
      // нет дороги, невозможно — на этом экспансия под воротами и встала.
      const gt = gateTarget(c);
      if (!gt) return;
      o.gateAt = gt.sys; systems[gt.sys].gate.building = true;
      let base = gt.sys;
      if (gt.sys !== 0 && !gated(gt.sys)) {
        base = null;
        within(gt.sys, rangeOf(c)).forEach((n) => {
          if (!gated(n)) return;
          if (base === null || dist(systems[n], systems[gt.sys]) < dist(systems[base], systems[gt.sys])) base = n;
        });
        if (base === null) base = 0;
      }
      const yg = nearestYard(base, c);
      if (!yg) { systems[gt.sys].gate.building = false; c.needYard = true; return; }
      o.sys = yg.world.sys; o.yard = yg;
    } else {
      const jt = jumpTarget(c);
      if (!jt) return;
      const yj = nearestYard(jt.from, c);        // jumpTarget уже отсеял старты без верфи
      o.sys = yj.world.sys; o.yard = yj; o.from = jt.from; o.to = jt.to;
    }
    c.order = o; c.needYard = false;
    say("<b>" + c.name + "</b> взялась собирать " + best.name + " в " + systems[o.sys].name + ".");
  });
}

// Где компания СОБИРАЕТ корабль: в своей системе с филиалом, ближайшей к
// цели. Раньше собирали прямо в системе назначения — детали летели в пустую
// систему, где у компании нет ни цеха, ни склада, ни человека: 85% рейсов с
// деталями шли в никуда. Теперь туда летит готовый корабль, а не запчасти.
export function baseSys(c: Corp, target: number): number {
  let best: number = null, bd = 1e9;
  c.branches.forEach((b) => {
    const s = b.world.sys;
    if (!reachable(s)) return;
    const d = s === target ? -1 : dist(systems[s], systems[target]);
    if (d < bd) { bd = d; best = s; }
  });
  return best === null ? 0 : best;
}

// отменённый заказ отдаёт назад то, что успел занять
export function releaseOrder(o: Order): void {
  if (!o) return;
  if (o.rock) o.rock.taken = false;
  if (o.type === "gate" && systems[o.gateAt]) systems[o.gateAt].gate.building = false;
}

// Колония — консорциум: держатель технологии кладёт своё, остальные доносят
// за право на филиал. Деньги подписки тратятся на детали, поэтому в колонии
// потом видно, чей корпус и чьё жизнеобеспечение.
export function colonyCost(s: Sys): number{ return Math.round(260 * (1 + s.depth * 0.3)); }

export function reviewProjects(): void {
  corps.forEach((c) => {
    if (projects.some((p) => { return p.lead === c.id; })) return;
    if (c.cash < 200 || !anyMakes("fuel")) return;      // модулю нечем взлететь
    let target: { b: Planet; s: Sys } = null, top = -1;
    systems.forEach((s) => {
      if (!s.unlocked || !reachable(s.id)) return;
      s.bodies.forEach((b) => {
        // claimed держится от начала подписки до посадки модуля. Без него
        // вторая компания открывала подписку на ту же планету, пока первый
        // модуль был в пути, и на одной планете вырастало по десять колоний.
        if (b.world || b.claimed || !canBuild(c, b.type.tech)) return;
        const score = (b.type.cap + b.type.farm * 3) / (1 + s.depth * 0.4);
        if (score > top) { top = score; target = { b:b, s:s }; }
      });
    });
    if (!target) return;
    const yc = nearestYard(baseSys(c, target.s.id), c);
    if (!yc) { c.needYard = true; return; }
    const cost = colonyCost(target.s), put = Math.min(c.cash * 0.45, cost);
    c.cash -= put; target.b.claimed = true;
    projects.push({ lead:c.id, body:target.b, dst:target.s.id, sys:yc.world.sys, yard:yc, cost:cost, purse:put,
                    need:JSON.parse(JSON.stringify(vtype("colony").need)), got:{}, parts:[],
                    backers:[{ corp:c.id, sum:put }], age:0, born:dateStr() });
    say("<b>" + c.name + "</b> открыла подписку на колонию " + target.b.name +
        " (" + target.b.type.name + "), нужно " + cost + ".");
  });

  projects.forEach((pr) => {
    if (pr.purse >= pr.cost) return;
    corps.forEach((c) => {
      if (pr.backers.some((b) => { return b.corp === c.id; })) return;
      if (c.cash < 260 || rnd() > 0.35) return;
      const share = Math.min(Math.max(70, c.cash * 0.2), pr.cost - pr.purse);
      if (share < 70) return;
      c.cash -= share; pr.purse += share;
      pr.backers.push({ corp:c.id, sum:share });
      say("<b>" + c.name + "</b> вошла в колонию " + pr.body.name + " на " + Math.round(share) +
          " — за право на филиал.");
    });
  });
}

// Опоздавшие покупают место у правительства колонии, если оно осталось.
export function branchTrade(): void {
  worlds.forEach((w) => {
    if (w === S.home || w.branches.length >= w.slots) return;
    corps.forEach((c) => {
      if (hasBranch(c, w) || c.cash < 420 || rnd() > 0.04) return;
      c.cash -= 140; w.gov.cash += 140;
      openBranch(c, w, false);
    });
  });
}

export function full(need: Record<string, number>, got: Record<string, number>): boolean {
  return Object.keys(need).every((k) => { return (got[k] || 0) >= need[k]; });
}

export function assemble(): void {
  corps.forEach((c) => {
    if (!c.order || !full(c.order.need, c.order.got)) return;
    const vt = vtype(c.order.type), o = c.order;
    const yard = o.yard;
    if (!yard || yard.owner >= 0 && yard.owner !== c.id) return;   // верфь ушла из-под заказа (отделение); ждём
    if (vt.key === "gate") {
      yard.queue.push({ vt:vt, lead:c.id, color:c.color, glyph:vt.glyph, gateHere:o.gateAt,
                     parts:o.parts.slice(), left:vt.build * YARD_WORK, total:vt.build * YARD_WORK });
    } else if (vt.key === "jump" || vt.key === "opener") {
      // цель могла открыться, пока свозили детали — тогда летим к другой
      let to = o.to;
      if (systems[to].unlocked) { const jt = jumpTarget(c); if (!jt) { releaseOrder(o); c.order = null; return; } to = jt.to; }
      yard.queue.push({ vt:vt, lead:c.id, color:c.color, glyph:vt.glyph, to:to, from:o.from,
                     parts:o.parts.slice(), left:vt.build * YARD_WORK, total:vt.build * YARD_WORK });
    } else {
      // предприятие числится в системе АСТЕРОИДА, а не сборки
      const r = o.rock, ds = systems[o.dst];
      const v = { sys:o.dst, lead:c.id, type:"mine", name:vt.name, parts:o.parts.slice(),
                left:vt.term, yield:vt.yield, born:dateStr(), dest:{ kind:"rock", ref:r, label:r.name },
                live:false, building:true };
      ds.ventures.push(v);
      yard.queue.push({ vt:vt, vent:v, lead:c.id, color:c.color, glyph:vt.glyph, dest:v.dest,
                     dst:o.dst, parts:v.parts, left:vt.build * YARD_WORK, total:vt.build * YARD_WORK });
    }
    const from: Record<number, number> = {};
    c.order.parts.forEach((p) => { from[p.from] = 1; });
    const names = Object.keys(from).filter((id) => { return +id !== c.id; })
                      .map((id) => { return corps[+id].name; });
    say("<b>" + c.name + "</b> собрала комплект и заложила " + vt.name + "." +
        (names.length ? " Детали от: " + names.join(", ") + "." : " Всё своё."));
    c.order = null; c.cool = 24 + Math.floor(rnd() * 24);
  });

  projects.forEach((pr) => {
    pr.age++;
    if (!full(pr.need, pr.got)) return;
    const yp = pr.yard;
    if (!yp) return;
    yp.queue.push({ vt:vtype("colony"), lead:pr.lead, color:corps[pr.lead].color, glyph:"cir",
                                 body:pr.body, dst:pr.dst, backers:pr.backers.slice(), parts:pr.parts.slice(),
                                 left:vtype("colony").build * YARD_WORK, total:vtype("colony").build * YARD_WORK });
    say("<b>" + corps[pr.lead].name + "</b> заложила колониальный модуль для " + pr.body.name +
        " (вкладчиков " + pr.backers.length + ").");
    pr.done = true;
  });
  fill(projects, projects.filter((pr) => { return !pr.done; }));
}

