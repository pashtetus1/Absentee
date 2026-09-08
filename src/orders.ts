// ===================== заказы, консорциумы, филиалы =====================

import { shipNeed, vtype, MARKSPEED } from "./data";
import { galaxyRange, rangeOf, within, markLevelOf } from "./galaxy";
import { rnd } from "./rng";
import { YARD_WORK, nearestYard, yardAt } from "./shipyard";
import { S, anyMakes, canBuild, corps, dateStr, fill, gates, market, projects, say, systems, voyages, worlds } from "./state";
import { bestEngineMade } from "./tech";
import { gateOf, newGate, reachable, routeKey } from "./travel";
import { clamp, dist } from "./util";
import { addStock, hasBranch, openBranch, popOf } from "./world";
import type { Corp, Order, Part, Planet, Rock, Sys, VType } from "./types";

export function freeRocks(s: Sys): Rock[]{ return s.rocks.filter((r) => { return !r.taken; }); }
// Заказ не начинают, пока нет горючего, на котором это полетит: иначе корабль
// собирают, а потом он десятилетиями стоит у стапеля и ест деньги впустую.
export function buildable(vt: VType): boolean {
  const fuelKey = (vt.key === "mine" || vt.key === "colony") ? "fuel" : "sfuel";
  if (!anyMakes(fuelKey)) return false;
  if (!bestEngineMade()) return false;     // без ходового двигателя корабль не тронется с места
  return Object.keys(vt.need).every((k) => { return anyMakes(k); });
}
export function anyRock(): boolean{ return systems.some((s) => { return s.unlocked && reachable(s.id) && freeRocks(s).length; }); }
// Ближайшая закрытая звезда, до которой ДОТЯГИВАЕТСЯ марка этой компании.
// Отсюда и берётся ощущение края карты: дальние звёзды видны, но пока не
// осилена следующая марка, до них не дострелить.
export function jumpTarget(c: Corp): { from: number; to: number; upgrade?: boolean } | null {
  const range = c ? rangeOf(c) : galaxyRange();
  if (range <= 0) return null;
  let out: { from: number; to: number; upgrade?: boolean } = null, bd = 1e9;
  systems.forEach((s) => {
    if (!s.unlocked) return;
    // Стартовать можно только там, где живут люди, и куда верфь может пригнать
    // корабль. Голая открытая звезда — цель, а не площадка.
    if (!s.bodies.some((b) => b.world)) return;
    if (!nearestYard(s.id, c)) return;
    within(s.id, range).forEach((n) => {
      if (systems[n].unlocked) return;
      if (voyages.some((v) => { return v.to === n && (v.kind === "jump" || v.kind === "gate"); })) return;
      if (corps.some((o) => { return o.order && o.order.to === n; })) return;   // туда уже собираются
      const g = gateOf(s.id, n);
      if (g && (g.built || g.building)) return;             // на этот маршрут уже поставили
      const d = dist(s, systems[n]);
      if (d < bd) { bd = d; out = { from:s.id, to:n }; }
    });
  });
  return out;
}

// Цель у экспансии одна на оба способа: ближайшая закрытая звезда, до которой
// дотягивается марка. Разница только в том, ЧТО туда летит — прыжковый корабль
// или портальный, который на этом маршруте останется воротами.
export function expandTarget(c: Corp): { from: number; to: number; upgrade?: boolean } | null{ return jumpTarget(c); }

// Переделка створов на старшую марку. Створ ведёт корабль со скоростью СВОЕГО
// комплекта, и маршрут, проложенный Mk1 в первый год, ползёт так и через сто
// лет. Компания, освоившая старшую марку, гонит по нему новый комплект — но
// только если это окупается: у маршрута считается недавний трафик (g.trips,
// затухает за ~5 лет), и выигрыш в рейсах должен перекрыть порог. Самый
// оживлённый маршрут — первым. Комплект переделывает створы на ОБОИХ концах,
// а с ними — все маршруты, что через эти створы идут.
export const UPGRADE_WORTH = 0.6;
export function upgradeTarget(c: Corp): { from: number; to: number; upgrade: boolean } | null {
  if (S.move.key !== "gates") return null;
  const lvl = markLevelOf(c);
  if (lvl < 2) return null;
  const vt = vtype("gate");
  if (!buildable(vt) || c.cash < orderCost(vt) * 1.5) return null;
  let out: { from: number; to: number; upgrade: boolean } = null, top = UPGRADE_WORTH;
  Object.keys(gates).forEach((k) => {
    const g = gates[k];
    if (!g.built || g.upgrading || (g.mark || 1) >= lvl) return;
    if (corps.some((o) => { return o.order && o.order.upgrade && o.order.from !== undefined &&
                                   routeKey(o.order.from, o.order.to) === k; })) return;
    // стартовать можно с любого конца, где есть люди и верфь под рукой
    const ends = [g.a, g.b].filter((e) => { return systems[e].bodies.some((b) => b.world) && nearestYard(e, c); });
    if (!ends.length) return;
    // выигрыш: трафик × (во сколько раз быстрее пойдёт − 1), в рейсах
    const gain = (g.trips || 0) * (MARKSPEED[lvl - 1] / MARKSPEED[(g.mark || 1) - 1] - 1);
    if (gain > top) { top = gain; out = { from:ends[0], to:g.a === ends[0] ? g.b : g.a, upgrade:true }; }
  });
  return out;
}
export function orderCost(vt: VType): number {
  const need = shipNeed(vt, bestEngineMade()) || vt.need;
  let sum = 0;
  Object.keys(need).forEach((k) => { sum += market[k].price * need[k]; });
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
    // Модель двигателя выбирается ОДИН раз на заказ, до выбора типа корабля:
    // ставят лучшую, какую в галактике вообще умеют делать — деталь всё равно
    // привезут, а лишний месяц в пути дешевле, чем вечно медленный корабль.
    const eng = bestEngineMade();
    [vtype("mine"), vtype(S.move.vt)].forEach((vt) => {
      if (!buildable(vt)) return;
      if (vt.key === "mine" && !anyRock()) return;
      if (vt.key !== "mine" && (!hasColonyAnywhere(c) || !(expandTarget(c) || upgradeTarget(c)))) return;
      let score = vt.key !== "mine" ? 46 : (vt.yield * 0.55 * vt.term) / Math.max(20, orderCost(vt));
      let own = 0, all = 0;
      const need = shipNeed(vt, eng);
      Object.keys(need).forEach((k) => { all += need[k]; if (canBuild(c, k)) own += need[k]; });
      score *= 1 + own / all * 0.6;
      if (score > top) { top = score; best = vt; }
    });
    if (!best || rnd() > clamp(0.55 / c.nerve, 0.2, 0.9)) return;
    // Место назначения выбирается СЕЙЧАС, а не когда комплект собран: детали
    // надо свозить в конкретную систему, и заранее должно быть ясно, в какую.
    const o = { type:best.key, need:shipNeed(best, eng), got:{}, parts:[] as Part[], born:dateStr() } as Order;
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
    } else {
      const jt = jumpTarget(c) || upgradeTarget(c);
      if (!jt) return;
      const yj = nearestYard(jt.from, c);        // jumpTarget уже отсеял старты без верфи
      o.sys = yj.world.sys; o.yard = yj; o.from = jt.from; o.to = jt.to;
      // Маршрут занимается сразу, а не по прилёте: пока портальный корабль
      // собирают и ведут к старту, никто другой на этот же створ не тратится.
      if (best.key === "gate") {
        // Переделка: маршрут уже есть, корабль идёт по нему со старшим комплектом
        if (jt.upgrade) { o.upgrade = true; gateOf(jt.from, jt.to).upgrading = true; }
        else gates[routeKey(jt.from, jt.to)] = newGate(jt.from, jt.to, c.id, markLevelOf(c));
      }
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
  if (o.type === "gate" && o.from !== undefined) {
    const g = gateOf(o.from, o.to);
    if (o.upgrade) { if (g) g.upgrading = false; }
    else if (g && !g.built) delete gates[routeKey(o.from, o.to)];
  }
}

// Колония — консорциум: держатель технологии кладёт своё, остальные доносят
// за право на филиал. Деньги подписки тратятся на детали, поэтому в колонии
// потом видно, чей корпус и чьё жизнеобеспечение.
export function colonyCost(s: Sys): number{ return Math.round(260 * (1 + s.depth * 0.3)); }

export function reviewProjects(): void {
  corps.forEach((c) => {
    if (projects.some((p) => { return p.lead === c.id; })) return;
    if (c.cash < 200 || !anyMakes("fuel")) return;      // модулю нечем взлететь
    const eng = bestEngineMade();
    if (!eng) return;                                   // и не на чем: двигателя нет ни у кого
    let target: { b: Planet; s: Sys } = null, top = -1;
    systems.forEach((s) => {
      if (!s.unlocked || !reachable(s.id)) return;
      s.bodies.forEach((b) => {
        // claimed держится от начала подписки до посадки модуля. Без него
        // вторая компания открывала подписку на ту же планету, пока первый
        // модуль был в пути, и на одной планете вырастало по десять колоний.
        if (b.world || b.claimed || (b.type.tech && !canBuild(c, b.type.tech))) return;
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
                    need:shipNeed(vtype("colony"), eng), got:{}, parts:[],
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
    // Верфь ушла из-под заказа (планета отделилась). Держать заказ незачем:
    // детали возвращаются на склад, а в следующий раз компания встанет в
    // другую очередь. Иначе заказ висел бы вечно у чужого стапеля.
    if (!yard || (yard.owner >= 0 && yard.owner !== c.id)) {
      if (yard) { o.parts.forEach((p) => { addStock(c, o.sys, p.k, 1); }); releaseOrder(o); c.order = null; }
      return;
    }
    if (vt.key === "jump" || vt.key === "gate") {
      // цель могла открыться, пока свозили детали — тогда летим к другой
      let to = o.to, from = o.from;
      if (!o.upgrade && systems[to].unlocked) {
        const jt = jumpTarget(c);
        if (!jt) { releaseOrder(o); c.order = null; return; }
        releaseOrder(o); to = jt.to; from = jt.from;
        if (vt.key === "gate") gates[routeKey(from, to)] = newGate(from, to, c.id, markLevelOf(c));
      }
      yard.queue.push({ vt:vt, lead:c.id, color:c.color, glyph:vt.glyph, to:to, from:from, upgrade:o.upgrade,
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

