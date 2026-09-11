// ===================== верфь: предложение, складчина, стройка =====================
//
// Верфь — постройка у планеты. Строит по очереди, тем быстрее, чем больше рук
// (шаг 2 плана); через неё идёт всё, что летает (шаг 3). Здесь — как она
// ПОЯВЛЯЕТСЯ, и это первое место в игре, где игрок решает прямо.
//
// Компания, которой негде строить, открывает предложение: своя планета, доля,
// которую компании готовы внести деньгами, и детали, которые они свезут.
// Остальное — казна. Предложение лежит на столе, пока его не приняли или пока
// другая компания не перебила его БОЛЕЕ ВЫГОДНЫМ — таким, где казна платит
// меньше. Срока жизни у него нет: это решение ждёт человека, а не тик.
// Одобрено — казна докладывает остаток, когда может, детали едут на планету,
// планета строит. Отклонено или просрочено — взносы возвращаются, и через
// RETRY месяцев компании приходят снова, подняв свою долю: ещё не построенная
// верфь дорожает для них с каждым отказом, но не для государства.
//
// Деньги за стройку получает планета: верфь не строится верфью, её строит
// планета, и её казне за это платят.


// Предложение ЖДЁТ ответа сколько угодно. Раньше оно жило 24 игровых месяца —
// то есть около семи секунд реального времени на x1 и треть секунды на x20:
// игрок физически не успевал его увидеть, экономика стояла без верфи, и партия
// выглядела сломанной. Срок жизни в игровых месяцах для решения, которое ждёт
// ЧЕЛОВЕКА, — ошибка меры: тут время идёт по настенным часам, а не по тику.

import { vtype } from "./data";
import { HOME, isRealm, realmOf, realmOfCorp } from "./realm";
import { rnd } from "./rng";
import { L, S, corps, proposals, say, shipyards, systems, worlds } from "./state";
import { canTravel } from "./travel";
import { dist } from "./util";
import { addStock } from "./world";
import type { Corp, Part, Proposal, Shipyard, World } from "./types";

export const RETRY_MIN = 36, RETRY_MAX = 60; // после ОТКАЗА государства — через сколько вернутся
export const OUTBID_EDGE = 0.9;             // перебить можно, только став дешевле для казны на десятину
export const SHARE_START = 0.4;             // доля компаний в первой попытке
export const SHARE_STEP = 0.1;              // на сколько растёт с каждым отказом
export const SHARE_CAP = 0.7;               // больше компании не дадут
export const YARD_PARTS: Record<string, number> = { hull: 3, life: 1 };
export const YARD_BUILD = 36;               // месяцев стройки самой верфи
export const QUEUE_MAX = 3;                 // очередь длиннее — повод строить ещё одну верфь
// Рабочие руки и длина сборки. Верфь просит долю YARD_SHARE промышленных рук
// планеты (не меньше YARD_MIN, не больше YARD_MAX мест) наравне с цехами
// филиалов и получает ту же долю людей, что и они (kp в labour). Сборка стоит
// vt.build × YARD_WORK человеко-месяцев.
//
// Эти три числа настраиваются ВМЕСТЕ, и вот почему. Сборку удлинили нарочно,
// чтобы очередь на верфи была событием, а не формальностью. Но при прежней
// вместимости (доля 0.35, потолок 14) удлинение упиралось в лавину: корабль
// ждал очереди в среднем 250 месяцев, тогда как голод доводит колонию до края
// за 48 — помощь структурно не успевала, и «дольше строим» превращалось в «еда
// не приходит никогда». Поэтому вместе с длиной поднята и вместимость.
//
// Итог замера (24 партии по 300 лет, от заказа до спуска): середина 33-46
// месяцев, худшие десять процентов 190-210, самые тяжёлые случаи под тридцать
// лет. То есть обычно несколько лет, а иногда — беда.
export const YARD_SHARE = 0.6;
export const YARD_MIN = 2, YARD_MAX = 30;
// Стапель из мусора берёт рук вчетверо меньше и оттого собирает в разы дольше.
// Урезать пришлось ИМЕННО РУКИ, а не список того, что он умеет: мусорный стапель
// — это плохая верфь, а не другая машина, и разница должна читаться сроком, а не
// отказом. Потолок в шесть мест тут почти никогда не работает (на послеголодном
// мире цехов и так мало) — работает доля и низкий пол: там, где настоящая верфь
// нашла бы двоих по минимуму, стапель находит полчеловечка.
export const SCRAP_SHARE = 0.25;
export const SCRAP_MIN = 0.5, SCRAP_MAX = 6;
export const YARD_WORK = 6;

let seq = 0;

/** Общий счётчик номеров: им метятся и верфи, и предложения. Он часть партии,
 *  а не украшение — decideById ищет предложение по номеру, — поэтому его
 *  уносит сохранение (save.ts). Сбрасывать его в build() незачем: номер нужен
 *  только внутри партии, а сквозной счёт заодно не даёт спутать предложение
 *  прошлой партии с нынешним. */
export function seqOf(): number { return seq; }
export function setSeq(n: number): void { seq = n; }

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
export function nearestYard(sys: number, c: Corp | null, realm: number = HOME): Shipyard | null {
  let best: Shipyard = null, bq = 1e9, bd = 1e9;
  shipyards.forEach((y) => {
    // Частная верфь — хозяину и ПРАВИТЕЛЬСТВУ СВОЕГО ГОСУДАРСТВА. Второе тут
    // появилось не для красоты: государственный заказ идёт с forCorp = null
    // (хлебовоз покупает казна мира, а не контора), и отделившийся мир не мог
    // построить корабль на собственной верфи — единственной, какая у него есть.
    // Сравнение прямое, без новых полей: realmOf(w) возвращает НОМЕР КОНТОРЫ
    // основателя, и y.owner — тоже номер конторы. HOME = -1 с owner >= 0 не
    // пересекается, поэтому значения по умолчанию оставляют прежнее поведение.
    if (y.owner >= 0 && y.owner !== (c ? c.id : HOME) && y.owner !== realm) return;
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
  const realm = forCorp ? realmOfCorp(forCorp) : (forWorld ? realmOf(forWorld) : HOME);
  const y = nearestYard(sys, forCorp, realm);
  if (!y) return false;
  const vt = vtype(kind);
  // Ведущий сборки на ЧАСТНОЙ верфи — её хозяин. seizeYard оставляет "своё"
  // именно по этому полю, и тест на частную верфь требует того же. Раньше у
  // государственного заказа сюда попадал branches[0]: на отделившемся мире это
  // случайно совпадало с хозяином (его филиал открывают первым), а на мире
  // вольницы не совпало бы — там чужие филиалы не отбирают.
  y.queue.push({
    vt: vt, lead: forCorp ? forCorp.id
                : y.owner >= 0 ? y.owner
                : (forWorld.branches.length ? forWorld.branches[0].corp : 0),
    color: forCorp ? forCorp.color : "#8894ae", glyph: vt.glyph, parts: parts.slice(),
    left: vt.build * YARD_WORK, total: vt.build * YARD_WORK,
    forWorld: forWorld, forCorp: forCorp ? forCorp.id : undefined
  });
  return true;
}

/** Уже стоит ли в чьей-нибудь очереди такой транспорт для этого заказчика.
 *
 *  Счётчик на планете (w.ordered) этого не ловил: частная помощь заказывает от
 *  имени КОМПАНИИ, и ограничителя у неё не было вовсе — на одном сиде набежало
 *  283 грузовика в очередь. Считать по самой очереди надёжнее счётчика: он
 *  разъезжается, если сборку выбросили (например, при отделении планеты).
 */
export function onOrder(kind: string, forWorld: World | null, forCorp: Corp | null): boolean {
  return shipyards.some((y) => y.queue.some((b) =>
    b.vt.key === kind &&
    (forCorp ? b.forCorp === forCorp.id : b.forWorld === forWorld && b.forCorp === undefined)));
}

/** Верфь в этой системе, если есть. */
export function yardAt(sys: number): Shipyard | null {
  return shipyards.find((y) => y.world.sys === sys) || null;
}

/** Поставить верфь у планеты: общую, пустую, с этого месяца.
 *
 *  Одна дверь на два случая — достроенная по предложению и стартовая на
 *  родине. Родина начинает С верфью: пока её не было, первые сорок-сто лет
 *  партии уходили на то, чтобы компании допросили казну до первой стройки, а
 *  до неё не летало ничего вовсе. Первое решение игрока от этого не пропало,
 *  оно сдвинулось туда, где ему и место: вторая верфь, у колонии, когда в
 *  домашней встала очередь. */
export function foundYard(w: World, backers: { corp: number; sum: number }[],
                          owner: number = -1, scrap?: boolean): Shipyard {
  const y: Shipyard = {
    id: ++seq, world: w, owner: owner, ang: rnd() * 6.2832,
    queue: [], crew: 0, born: S.tick, backers: backers.slice()
  };
  if (scrap) y.scrap = true;
  w.yard = y;
  shipyards.push(y);
  return y;
}

// ---- стапель на краю --------------------------------------------------------
// Мир, прошедший голодомор, обзаводится верфью. Готовая просто меняет хозяина;
// а вот если её не было — а на окраине её обычно и нет, — мир закладывает свою.
// Ровно поэтому правило "верфь уходит вместе с планетой" почти никогда и не
// срабатывало: уходить было нечему.
//
// Денег стапель не стоит: ценой служат три года. Мир только что отдал четыре
// пятых кассы в общее дело, и требовать с него ещё и плату значило бы не
// достроить никогда. Три года — столько же, сколько верфь по предложению.
export const YARD_EDGE = 36;

export function edgeShipyard(w: World, owner: number): void {
  if (w.yard) { seizeYard(w, owner); return; }
  w.edgeYard = { at: S.tick + YARD_EDGE, owner: owner };
  say("<b>" + w.body.name + "</b> закладывает свой стапель: верфи тут не было, " +
      "и строить её будут сами — года три.");
}

/** Заложенный стапель встаёт, а вставший — дорастает до верфи.
 *
 *  Доводка идёт за счёт ХОЗЯИНА, а не казны и не складчины: стапель частный, и
 *  просить за него у чужого государства не у кого. Берётся она, только когда
 *  стапель кому-то мешает — то есть когда в очереди уже кто-то стоит; иначе
 *  контора вкладывала бы деньги в пустой стан просто потому, что они есть.
 *  Казну своего государства сюда не зовём: у неё один расход и он про хлеб.
 *
 *  Зовётся каждый месяц рядом с proposalsTick. */
export function edgeYards(): void {
  shipyards.forEach((y) => {
    if (!y.scrap || y.owner < 0 || !y.queue.length) return;
    const c = corps[y.owner], cost = yardCost(y.world);
    if (c.cash < cost * 1.25) return;           // не последние деньги
    c.cash -= cost;
    y.scrap = undefined;
    say("<b>" + c.name + "</b> довела стапель у " + y.world.body.name +
        " до настоящей верфи за " + cost + ": рук на неё теперь берут вчетверо больше.");
  });
  worlds.forEach((w) => {
    if (!w.edgeYard || S.tick < w.edgeYard.at) return;
    const owner = w.edgeYard.owner;
    w.edgeYard = undefined;
    if (w.yard) return;                 // пока строили, верфь взялась откуда-то ещё
    foundYard(w, [], owner, true);
    say("<b>У " + w.body.name + " встал свой стапель</b> — не верфь, а урезанная её " +
        "версия, собранная из мусора: строит то же самое, только в разы дольше. " +
        "Хозяин «" + corps[owner].name + "».");
  });
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
    if (!(c.order || c.needYard) || c.pirate || isRealm(c) || c.cash < 200) return;
    if (proposals.some((p) => p.lead === c.id && p.state !== "done")) return;
    // Пока на столе лежит нерешённое предложение, новое имеет смысл только
    // если оно ДЕШЕВЛЕ для казны: иначе игрок утонет в стопке равных бумаг.
    const onTable = proposals.find((p) => p.state === "pending");
    const homeSys = c.branches.length ? c.branches[0].world.sys : 0;
    // Есть верфь, и очередь в ней короткая — незачем строить ещё. Длинная
    // очередь — тот самый повод: без него в партии навсегда оставалась одна
    // верфь на родине, и экспансия упиралась в её дальность.
    const near = nearestYard(c.order ? c.order.sys : homeSys, c);
    if (near && near.queue.length < QUEUE_MAX) return;
    let w: World = null, top = -1;
    c.branches.forEach((b) => {
      const x = b.world;
      // Чужое предложение на этой же планете не мешает: перебить его можно,
      // и ниже оно снимается, если новое дешевле для казны. Своё — мешает.
      const act = activeAt(x);
      // Не на чужой земле. Верфь по предложению оплачивает казна, а деньги за
      // стройку получает ПЛАНЕТА (см. proposalsTick) — то есть домашняя контора
      // с филиалом на отделившемся мире могла бы перевести туда деньги родной
      // казны, ничего не нарушив ни одной проверкой.
      if (realmOf(x) !== HOME) return;
      if (x.yard || (act && act.state !== "pending") || (x.yardRetryAt || 0) > S.tick) return;
      if (x.pop.prod < 2) return;                 // без рабочих рук верфь стояла бы вечно
      if (x.pop.prod > top) { top = x.pop.prod; w = x; }
    });
    if (!w) return;
    const tries = w.yardTries || 0;
    const cost = yardCost(w);
    // Доля компаний зависит от КОШЕЛЬКА ведущего: богатая кладёт больше и тем
    // перебивает чужое предложение. Без этого доля была одна на всех, цена для
    // казны совпадала, и торг между компаниями не начинался никогда.
    const afford = (c.cash * 0.4) / cost;
    const share = Math.max(SHARE_START + SHARE_STEP * tries, Math.min(SHARE_CAP, afford));
    const put = Math.min(c.cash * 0.4, cost * share);
    if (put < 40) return;
    if (onTable && cost * (1 - share) >= askOf(onTable) * OUTBID_EDGE) return;
    c.cash -= put;
    proposals.push({
      id: ++seq, world: w, lead: c.id, cost: cost, purse: put, share: share, stateSum: 0,
      need: { ...YARD_PARTS }, got: {}, parts: [],
      backers: [{ corp: c.id, sum: put }],
      state: "pending", since: S.tick, until: 0,        // срока нет: ждёт человека
      attempt: tries + 1, left: YARD_BUILD
    });
    if (onTable) outbid(onTable, proposals[proposals.length - 1]);
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

/** Планета вышла из государства — верфь уходит с ней.
 *
 *  Казна вкладывалась в неё как в общую, и теперь эти деньги потеряны: это и
 *  есть цена того, что колонию не удержали. Чужие заказы из очереди выбрасывают,
 *  детали возвращают хозяевам на склад в этой системе — как при сворачивании
 *  сборки. Государственные заказы просто пропадают: платило государство.
 */
export function seizeYard(w: World, newOwner: number): void {
  const y = w.yard;
  if (!y) return;
  const wasState = y.owner < 0;
  let lost = 0;
  for (let i = y.queue.length - 1; i >= 0; i--) {
    const b = y.queue[i];
    if (b.lead === newOwner) continue;             // своё остаётся
    b.parts.forEach((p) => { addStock(corps[p.from], w.sys, p.k, 1); });
    y.queue.splice(i, 1); lost++;
  }
  y.owner = newOwner;
  const spent = y.backers.reduce((a, b) => a + b.sum, 0);
  say("Верфь у " + w.body.name + " отошла к «" + corps[newOwner].name + "»" +
      (wasState ? ": казна вложила в неё " + Math.round(spent) + " и потеряла их" : "") +
      (lost ? ", из очереди выброшено чужих сборок: " + lost : "") + ".");
}

/** Мир опустел — всё, что строится ИМ и ДЛЯ НЕГО, снимается со стапелей.
 *
 *  Верфь у него без людей не строит: crew считается по промышленным рукам
 *  планеты (labour), а их не осталось. Держать её в списке значило бы держать
 *  вечную очередь, в которую заказы встают и из которой не выходят, поэтому
 *  уходит вся постройка целиком. Детали возвращаются хозяевам на склад в той
 *  системе, где стоял стапель, — как при сворачивании сборки.
 *
 *  Отдельно снимается транспорт, заказанный ДЛЯ этого мира, но собираемый в
 *  чужой системе: хлебовоз голодной колонии строят у поставщика еды (food.ts),
 *  и его верфь никуда не делась. Сошёл бы он со стапеля — и встал бы на
 *  стоянку с хозяином, которого больше нет.
 *
 *  Поданное предложение по верфи здесь же отзывается, взносы возвращаются
 *  вкладчикам; отклонённые предложения выметает proposalsTick следующим
 *  месяцем. */
export function loseYard(w: World): void {
  // Заложенный стапель уходит вместе с миром: без этого опустевшая планета
  // достроила бы верфь через три года после того, как перестала быть миром.
  w.edgeYard = undefined;
  const y = w.yard;
  if (y) {
    y.queue.forEach((b) => { b.parts.forEach((p) => { addStock(corps[p.from], w.sys, p.k, 1); }); });
    y.queue.length = 0;
    const at = shipyards.indexOf(y);
    if (at >= 0) shipyards.splice(at, 1);
    w.yard = undefined;
  }
  shipyards.forEach((o) => {
    for (let i = o.queue.length - 1; i >= 0; i--) {
      if (o.queue[i].forWorld !== w) continue;
      o.queue[i].parts.forEach((p) => { addStock(corps[p.from], o.world.sys, p.k, 1); });
      o.queue.splice(i, 1);
    }
  });
  proposals.forEach((p) => {
    if (p.world !== w || p.state === "done" || p.state === "declined") return;
    refund(p); p.state = "declined";
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

/** Во сколько предложение обходится казне: по этому их и сравнивают. */
export function askOf(p: Proposal): number { return p.cost * (1 - p.share); }

/** Снять предложение, которое перебили более выгодным. */
function outbid(old: Proposal, better: Proposal): void {
  refund(old);
  old.state = "declined";
  say("Предложение по верфи у " + old.world.body.name + " (казне " + Math.round(askOf(old)) +
      ") снято: <b>" + corps[better.lead].name + "</b> просит меньше — " + Math.round(askOf(better)) +
      " за верфь у " + better.world.body.name + ".");
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
      // в manual ждём человека: не протухает
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
      foundYard(p.world, p.backers);
      p.state = "done";
      say("<b>Верфь у " + p.world.body.name + " построена.</b> Пользоваться могут все.");
    }
  });
  // сделанные и отклонённые выбывают из списка
  for (let i = proposals.length - 1; i >= 0; i--)
    if (proposals[i].state === "done" || proposals[i].state === "declined") proposals.splice(i, 1);
}
