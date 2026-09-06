// ===================== верфь: предложение, складчина, стройка =====================
//
// Верфь — постройка у планеты. Строит по очереди, тем быстрее, чем больше рук
// (шаг 2 плана); через неё идёт всё, что летает (шаг 3). Здесь — как она
// ПОЯВЛЯЕТСЯ, и это первое место в игре, где игрок решает прямо.
//
// Компания, которой негде строить, открывает предложение: своя планета, доля,
// которую компании готовы внести деньгами, и детали, которые они свезут.
// Остальное — казна. Предложение висит PROPOSAL_LIFE месяцев и ждёт игрока.
// Одобрено — казна докладывает остаток, когда может, детали едут на планету,
// планета строит. Отклонено или просрочено — взносы возвращаются, и через
// RETRY месяцев компании приходят снова, подняв свою долю: ещё не построенная
// верфь дорожает для них с каждым отказом, но не для государства.
//
// Деньги за стройку получает планета: верфь не строится верфью, её строит
// планета, и её казне за это платят.

import { vtype } from "./data";
import { rnd } from "./rng";
import { L, S, corps, proposals, say, shipyards, systems } from "./state";
import { canTravel } from "./travel";
import { dist } from "./util";
import type { Corp, Part, Proposal, Shipyard, World } from "./types";

export const PROPOSAL_LIFE = 24;            // месяцев висит, ожидая игрока
export const RETRY_MIN = 36, RETRY_MAX = 60; // через сколько предложат снова
export const SHARE_START = 0.4;             // доля компаний в первой попытке
export const SHARE_STEP = 0.1;              // на сколько растёт с каждым отказом
export const SHARE_CAP = 0.7;               // больше компании не дадут
export const YARD_PARTS: Record<string, number> = { hull: 3, life: 1 };
export const YARD_BUILD = 36;               // месяцев стройки самой верфи
export const QUEUE_MAX = 3;                 // очередь длиннее — повод строить ещё одну верфь
// Рабочие руки. Верфь просит долю YARD_SHARE промышленных рук планеты (не
// меньше YARD_MIN, не больше YARD_MAX мест) наравне с цехами филиалов и
// получает ту же долю людей, что и они (kp в labour). Сборка стоит
// vt.build × YARD_WORK человеко-месяцев. Команда растёт с планетой: на
// родине с тридцатью рабочими верфь строит вчетверо быстрее прежних
// календарных сроков, на молодой колонии с двумя — вдвое медленнее. Потолок
// в шесть человек держал очередь в полсотни сборок при полной верфи.
export const YARD_SHARE = 0.35;
export const YARD_MIN = 2, YARD_MAX = 14;
export const YARD_WORK = 3;

let seq = 0;

/** Цена верфи деньгами: дороже вдали от родины, как и колония. */
export function yardCost(w: World): number {
  return Math.round(400 * (1 + systems[w.sys].depth * 0.3));
}

/** Верфь, куда компании выгоднее всего встать; null — строить негде.
 *
 *  Сначала по длине очереди, расстоянием только разрешаем ничью. Длина рейса
 *  здесь от расстояния почти не зависит (140-190 месяцев плюс случай), а
 *  место в очереди стоит десятки месяцев. Пока выбирали ближайшую, все вставали
 *  в домашнюю, а новые верфи стояли пустыми. */
export function nearestYard(sys: number, c: Corp | null): Shipyard | null {
  let best: Shipyard = null, bq = 1e9, bd = 1e9;
  shipyards.forEach((y) => {
    if (y.owner >= 0 && (!c || y.owner !== c.id)) return;   // частная — только хозяину
    const ys = y.world.sys;
    if (ys !== sys && !canTravel(ys, sys)) return;
    const q = y.queue.length, d = ys === sys ? 0 : dist(systems[ys], systems[sys]);
    if (q < bq || (q === bq && d < bd)) { bq = q; bd = d; best = y; }
  });
  return best;
}

/** Заказать транспорт на верфи. Возвращает false, если строить негде.
 *
 *  Раньше грузовик и переселенческий возникали мгновенно из купленных деталей:
 *  поля build у них не использовались вообще. Теперь они идут через верфь, как
 *  всё остальное, и оттого стоянка отработанных кораблей стала по-настоящему
 *  ценной — взять готовый почти всегда быстрее, чем заказать новый.
 */
export function orderTransport(kind: string, parts: Part[], sys: number,
                               forWorld: World | null, forCorp: Corp | null): boolean {
  const y = nearestYard(sys, forCorp);
  if (!y) return false;
  const vt = vtype(kind);
  y.queue.push({
    vt: vt, lead: forCorp ? forCorp.id : (forWorld.branches.length ? forWorld.branches[0].corp : 0),
    color: forCorp ? forCorp.color : "#8894ae", glyph: vt.glyph, parts: parts.slice(),
    left: vt.build * YARD_WORK, total: vt.build * YARD_WORK,
    forWorld: forWorld, forCorp: forCorp ? forCorp.id : undefined
  });
  return true;
}

/** Верфь в этой системе, если есть. */
export function yardAt(sys: number): Shipyard | null {
  return shipyards.find((y) => y.world.sys === sys) || null;
}

function activeAt(w: World): Proposal | undefined {
  return proposals.find((p) => p.world === w && p.state !== "done");
}

// ---- кто предлагает -----------------------------------------------------
// Раз в год, вместе с заказами. Компания с заказом, которой негде его собрать,
// предлагает верфь на своей самой промышленной планете. Одна компания ведёт
// не больше одного предложения; на одну планету — не больше одного.
export function reviewProposals(): void {
  corps.forEach((c) => {
    // повод — заказ, который негде собрать: либо уже сделанный, либо тот, что
    // компания хотела сделать, но не нашла верфи (needYard)
    if (!(c.order || c.needYard) || c.pirate || c.cash < 200) return;
    if (proposals.some((p) => p.lead === c.id && p.state !== "done")) return;
    const homeSys = c.branches.length ? c.branches[0].world.sys : 0;
    // Есть верфь, и очередь в ней короткая — незачем строить ещё. Длинная
    // очередь — тот самый повод: без него в партии навсегда оставалась одна
    // верфь на родине, и экспансия упиралась в её дальность.
    const near = nearestYard(c.order ? c.order.sys : homeSys, c);
    if (near && near.queue.length < QUEUE_MAX) return;
    let w: World = null, top = -1;
    c.branches.forEach((b) => {
      const x = b.world;
      if (x.yard || activeAt(x) || (x.yardRetryAt || 0) > S.tick) return;
      if (x.pop.prod < 2) return;                 // без рабочих рук верфь стояла бы вечно
      if (x.pop.prod > top) { top = x.pop.prod; w = x; }
    });
    if (!w) return;
    const tries = w.yardTries || 0;
    const share = Math.min(SHARE_CAP, SHARE_START + SHARE_STEP * tries);
    const cost = yardCost(w);
    const put = Math.min(c.cash * 0.4, cost * share);
    if (put < 40) return;
    c.cash -= put;
    proposals.push({
      id: ++seq, world: w, lead: c.id, cost: cost, purse: put, share: share, stateSum: 0,
      need: { ...YARD_PARTS }, got: {}, parts: [],
      backers: [{ corp: c.id, sum: put }],
      state: "pending", since: S.tick, until: S.tick + PROPOSAL_LIFE,
      attempt: tries + 1, left: YARD_BUILD
    });
    say("<b>" + c.name + "</b> предлагает построить верфь у " + w.body.name + ": компании дадут " +
        Math.round(share * 100) + "%, от казны просят " + Math.round(cost * (1 - share)) +
        (tries ? " (попытка " + (tries + 1) + ")" : "") + ".");
  });

  // остальные входят в складчину, как в колонию — пока доля компаний не набрана
  proposals.forEach((p) => {
    if (p.state === "done" || p.state === "declined") return;
    const cap = p.cost * p.share;
    if (p.purse >= cap) return;
    corps.forEach((c) => {
      if (p.backers.some((b) => b.corp === c.id)) return;
      if (c.cash < 260 || rnd() > 0.35) return;
      const sum = Math.min(Math.max(50, c.cash * 0.15), cap - p.purse);
      if (sum < 50) return;
      c.cash -= sum; p.purse += sum;
      p.backers.push({ corp: c.id, sum: sum });
      say("<b>" + c.name + "</b> вошла в складчину на верфь у " + p.world.body.name + " на " + Math.round(sum) + ".");
    });
  });
}

// ---- решение ------------------------------------------------------------
function refund(p: Proposal): void {
  p.backers.forEach((b) => { corps[b.corp].cash += b.sum; });
  p.purse = 0;
}

function retryLater(p: Proposal, why: string): void {
  const w = p.world;
  w.yardTries = (w.yardTries || 0) + 1;
  w.yardRetryAt = S.tick + RETRY_MIN + Math.floor(rnd() * (RETRY_MAX - RETRY_MIN));
  refund(p);
  p.state = "declined";
  say("Верфь у " + w.body.name + ": " + why + ". Взносы возвращены; компании вернутся с этим позже" +
      (p.share < SHARE_CAP ? ", готовые дать больше." : "."));
}

/** Игрок (или политика стенда) решает судьбу предложения. */
export function decide(p: Proposal, ok: boolean): void {
  if (p.state !== "pending") return;
  if (!ok) { retryLater(p, "государство отказало"); return; }
  p.state = "approved";
  say("Государство одобрило верфь у " + p.world.body.name + ": казна доложит " +
      Math.round(p.cost - p.cost * p.share) + ", компании свозят детали.");
}

export function decideById(id: number, ok: boolean): boolean {
  const p = proposals.find((x) => x.id === id);
  if (!p) return false;
  decide(p, ok);
  return true;
}

// ---- каждый месяц ---------------------------------------------------------
export function proposalsTick(): void {
  proposals.forEach((p) => {
    if (p.state === "pending") {
      // Политика стенда: без игрока предложения повисли бы. В браузере manual.
      // Монетка в random — из своего генератора, партия остаётся воспроизводимой.
      if (L.approve === "always") decide(p, true);
      else if (L.approve === "never") decide(p, false);
      else if (L.approve === "random") decide(p, rnd() < 0.5);
      else if (S.tick >= p.until) retryLater(p, "государство не ответило в срок");
      return;
    }
    if (p.state === "approved") {
      // казна докладывает свою долю, когда есть из чего, не опустошаясь до дна
      const due = p.cost - Math.min(p.purse, p.cost * p.share) - p.stateSum;
      if (due > 0 && S.treasury > 60) {
        const pay = Math.min(due, S.treasury - 60);
        S.treasury -= pay; p.stateSum += pay;
      }
      const companies = Math.min(p.purse, p.cost * p.share);
      const funded = companies + p.stateSum >= p.cost - 1e-9;
      const partsOk = Object.keys(p.need).every((k) => (p.got[k] || 0) >= p.need[k]);
      if (funded && partsOk) {
        // планета получает деньги за стройку: верфь строит она
        p.world.gov.cash += p.cost;
        p.state = "building";
        say("Верфь у " + p.world.body.name + ": деньги и детали собраны, планета начала стройку.");
      }
      return;
    }
    if (p.state === "building") {
      if (--p.left > 0) return;
      const y: Shipyard = {
        id: ++seq, world: p.world, owner: -1, ang: rnd() * 6.2832,
        queue: [], crew: 0, born: S.tick, backers: p.backers.slice()
      };
      p.world.yard = y;
      shipyards.push(y);
      p.state = "done";
      say("<b>Верфь у " + p.world.body.name + " построена.</b> Пользоваться могут все.");
    }
  });
  // сделанные и отклонённые выбывают из списка
  for (let i = proposals.length - 1; i >= 0; i--)
    if (proposals[i].state === "done" || proposals[i].state === "declined") proposals.splice(i, 1);
}
