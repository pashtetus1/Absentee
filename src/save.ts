// ===================== сохранение партии =====================
//
// Игра задумана МЕДЛЕННЫМ симом: заходишь раз в несколько дней посмотреть, что
// сделалось без тебя (журнал, п. 1). Пока партия жила только в памяти вкладки,
// это было обещанием, а не правдой: F5 — и империи нет. Здесь партия целиком
// ложится в localStorage и разворачивается обратно.
//
// ЧТО ЗДЕСЬ ТРУДНОГО. Состояние — не дерево, а связанный граф с кольцами:
// planet.world ссылается на мир, а мир обратно на планету; филиал знает и
// контору, и мир, и тот же самый объект филиала лежит в списках у обоих.
// JSON.stringify на таком зацикливается, а если рвать кольца руками, то при
// разворачивании вместо ОДНОГО филиала получаются два одинаковых — и мир
// начинает жить отдельно от конторы. Поэтому пишется не дерево, а таблица:
// каждому объекту номер, ссылка — {r:номер}. Одинаковость объектов при этом
// сохраняется, а кольца перестают быть проблемой.
//
// ТАБЛИЦЫ ПРАВИЛ (типы планет, корабли, способы перелёта) в сохранение НЕ
// попадают: они часть сборки, а не партии. Ссылка на запись таблицы уходит
// ключом — {t:"p:terran"} — и разворачивается в ТУ ЖЕ запись, а не в её копию.
//
// НЕСОВМЕСТИМОСТЬ. Прототип правится каждый день, и сохранение, сделанное
// другой сборкой, — это не «немного другие числа», а чужой набор правил под
// видом своего. Молча подставлять его в игру нельзя: партия поедет вкривь, и
// виноват будет не тот файл. Поэтому в сохранении лежит отпечаток правил, и
// при несовпадении разворачивание падает ошибкой СОХРАНЕНИЕ НЕСОВМЕСТИМО —
// громко, в браузере видно полосой во всю ширину (render/ui.ts).

import { BTYPES, CLASSES, COLTECH, COMPS, MOVES, PTYPES, VTYPES, makeMarks, moveOf, ptypeOf, vtype } from "./data";
import { ENGKEYS } from "./data";
import { rngAt, seedOf, setRng } from "./rng";
import { seqOf, setSeq } from "./shipyard";
import { DEVS, ensureDev } from "./tech";
import { L, S, U, cam, clear, corps, docks, feed, fill, flash, gates, hits, market, patents,
         projects, proposals, purses, resetTickCache, say, shipyards, staged, systems, voyages, worlds } from "./state";

/** Где лежит партия. Рычаги хранятся отдельно и по-старому (levers.ts): они
 *  переживают «Заново», а партия — нет. */
export const KEY = "absentee.save";

/** Номер формата записи. ПРИБАВЛЯТЬ РУКАМИ, когда меняется форма состояния —
 *  появилось поле у мира, у конторы, у рейса. Отпечаток ниже ловит правки
 *  таблиц сам, а вот новое поле в объекте ему не видно: старое сохранение
 *  развернулось бы без него и тихо повело бы себя не так. */
export const FORMAT = 1;

/** Ровно тот текст, который видит игрок. */
export const BAD = "СОХРАНЕНИЕ НЕСОВМЕСТИМО";

/** Ошибка с причиной: игроку — одна строка, в консоль — из-за чего именно. */
function fail(why: string): never {
  const e = new Error(BAD) as Error & { why: string };
  e.why = why;
  throw e;
}
function need(ok: unknown, why: string): void { if (!ok) fail(why); }

/** Отпечаток правил: всё, на что сохранение ссылается ключами, плюс поля
 *  показателей и рычагов. Марки перехода в него не входят — они зависят от
 *  выпавшего партии способа, а не от сборки. */
function stamp(): string {
  const keys = (a: { key: string }[]): string => a.map((x) => x.key).join(",");
  return [FORMAT,
          keys(COMPS.filter((c) => !/^(drive|gkit)\d$/.test(c.key))),
          keys(PTYPES), keys(VTYPES), keys(BTYPES), keys(CLASSES), keys(COLTECH), keys(MOVES),
          ENGKEYS.join(","), Object.keys(S).join(","), Object.keys(L).join(",")].join("|");
}

// ---- ссылки на таблицы правил -----------------------------------------
// Сравнение по ссылке живёт в коде (w.type === b.type), поэтому запись
// таблицы обязана вернуться той же самой, а не похожей.
let tags: Map<unknown, string> = null;
function tagOf(v: unknown): string {
  if (!tags) {
    tags = new Map();
    PTYPES.forEach((p) => tags.set(p, "p:" + p.key));
    VTYPES.forEach((t) => tags.set(t, "v:" + t.key));
    MOVES.forEach((m) => tags.set(m, "m:" + m.key));
  }
  return tags.get(v);
}
function byTag(t: string): unknown {
  const k = t.slice(2);
  const v = t[0] === "p" ? ptypeOf(k) : t[0] === "v" ? vtype(k) : t[0] === "m" ? moveOf(k) : null;
  if (!v) fail("в таблицах нет записи " + t);
  return v;
}

// ---- запись -----------------------------------------------------------
// Обход НЕ рекурсивный, и это не вкусовщина: у графа партии бывают длинные
// цепочки (мир -> филиал -> контора -> мир...), и рекурсия на трёхсотом году
// упёрлась бы в стек — редко и непонятно.
function encode(root: unknown): string {
  const seen = new Map<unknown, number>();
  const objs: unknown[][] = [];
  const queue: unknown[] = [];
  const shapes: string[][] = [];
  const shapeId: Record<string, number> = {};

  function num(v: unknown): number {
    let i = seen.get(v);
    if (i === undefined) { i = objs.length; seen.set(v, i); objs.push(null); queue.push(v); }
    return i;
  }
  function cell(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") return v;
    if (t === "function") throw new Error("в состоянии партии оказалась функция: её нечем сохранить");
    const tag = tagOf(v);
    return tag ? { t: tag } : { r: num(v) };
  }

  num(root);
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    if (Array.isArray(v)) {
      const row: unknown[] = [-1];
      for (let j = 0; j < v.length; j++) row.push(cell(v[j]));
      objs[i] = row;
      continue;
    }
    // Форма объекта — отдельной строкой в общей таблице: имена полей у тысяч
    // однотипных записей одни и те же, и повторять их тысячу раз значит втрое
    // раздуть файл. Отсутствующие поля (те, что undefined) в форму не входят:
    // "поля нет" и "поле пустое" — разные вещи, вторую код читает как значение.
    const names: string[] = [];
    const vals: unknown[] = [];
    for (const k in v as object) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      if ((v as Record<string, unknown>)[k] === undefined) continue;
      names.push(k);
    }
    const sig = names.join(",");
    let sid = shapeId[sig];
    if (sid === undefined) { sid = shapes.length; shapes.push(names); shapeId[sig] = sid; }
    vals.push(sid);
    for (let j = 0; j < names.length; j++) vals.push(cell((v as Record<string, unknown>)[names[j]]));
    objs[i] = vals;
  }
  return JSON.stringify({ f: FORMAT, s: stamp(), h: shapes, o: objs });
}

// ---- чтение -----------------------------------------------------------
function decode(text: string): Record<string, unknown> {
  let raw: { f?: number; s?: string; h?: string[][]; o?: unknown[][] } = null;
  try { raw = JSON.parse(text); } catch (e) { fail("не разбирается как JSON"); }
  need(raw && typeof raw === "object", "не объект");
  need(raw.f === FORMAT, "формат " + raw.f + ", а нужен " + FORMAT);
  need(raw.s === stamp(), "правила игры другие");
  need(Array.isArray(raw.h) && Array.isArray(raw.o) && raw.o.length > 0, "нет таблицы объектов");

  const objs = raw.o, shapes = raw.h;
  const made: unknown[] = objs.map((e) => {
    need(Array.isArray(e) && e.length > 0, "испорченная запись");
    return e[0] === -1 ? [] : {};
  });
  function un(v: unknown): unknown {
    if (v === null || typeof v !== "object") return v;
    const r = (v as { r?: number }).r, t = (v as { t?: string }).t;
    if (typeof t === "string") return byTag(t);
    need(typeof r === "number" && r >= 0 && r < made.length, "ссылка в никуда");
    return made[r];
  }
  objs.forEach((e, i) => {
    if (e[0] === -1) {
      const arr = made[i] as unknown[];
      for (let j = 1; j < e.length; j++) arr.push(un(e[j]));
      return;
    }
    const names = shapes[e[0] as number];
    need(names && names.length === e.length - 1, "форма записи не сходится");
    const obj = made[i] as Record<string, unknown>;
    for (let j = 0; j < names.length; j++) obj[names[j]] = un(e[j + 1]);
  });
  return made[0] as Record<string, unknown>;
}

// ---- партия целиком ---------------------------------------------------

// Списки и таблицы партии — ОДНИМ перечнем: по нему и записывается, и
// проверяется, и разворачивается. Перечислять их трижды значило бы однажды
// забыть в одном месте из трёх, и забытое вылезло бы не ошибкой, а тем, что
// после перезапуска, например, пропали стоянки.
const LISTS: Record<string, unknown[]> = {
  corps: corps, systems: systems, worlds: worlds, voyages: voyages, projects: projects,
  docks: docks, shipyards: shipyards, proposals: proposals, staged: staged, feed: feed
};
const TABLES: Record<string, object> = { market: market, patents: patents, gates: gates, purses: purses };

/** Партия в виде строки: ровно то, что ложится в localStorage. */
export function gameText(): string {
  const root: Record<string, unknown> = {
    seed: seedOf(), at: rngAt(), seq: seqOf(),
    // Марки освоения заводятся по ходу партии (tech.ts), и порядок в списке
    // значим: по нему наука перебирает, во что вкладываться. Поэтому пишется
    // не список объектов, а порядок их появления — и он же повторяется.
    devs: DEVS.map((d) => [d.cls, d.mark]),
    S: S, L: L, view: U.view, cam: cam
  };
  Object.keys(LISTS).forEach((k) => { root[k] = LISTS[k]; });
  Object.keys(TABLES).forEach((k) => { root[k] = TABLES[k]; });
  return encode(root);
}


/** Развернуть партию из строки. Несовместимая — ошибка СОХРАНЕНИЕ
 *  НЕСОВМЕСТИМО, и НИЧЕГО при этом не трогается: проверка и разбор идут
 *  целиком до того, как тронуто состояние. Иначе неудачное чтение оставляло
 *  бы полупартию, в которой нельзя ни играть, ни разобраться. */
export function restore(text: string): void {
  const g = decode(text);
  need(g && typeof g === "object", "пустая запись");
  need(typeof g.seed === "number" && typeof g.at === "number" && typeof g.seq === "number", "нет генератора");
  need(g.S && g.L && g.view && g.cam && Array.isArray(g.devs), "неполная запись");
  Object.keys(LISTS).forEach((k) => need(Array.isArray(g[k]), "нет списка " + k));
  Object.keys(TABLES).forEach((k) => need(g[k] && typeof g[k] === "object", "нет таблицы " + k));
  const gs = g.S as Record<string, unknown>, gl = g.L as Record<string, unknown>;
  need(gs.move && typeof (gs.move as { key: string }).key === "string", "нет способа перелёта");

  setRng(g.seed as number, g.at as number);
  // Способ перелёта поднимается ПЕРВЫМ: от него зависят марки, а от марок —
  // список деталей, по которому считается всё остальное.
  S.move = gs.move as typeof S.move;
  makeMarks();
  Object.keys(S).forEach((k) => { (S as Record<string, unknown>)[k] = gs[k]; });
  Object.keys(L).forEach((k) => { (L as Record<string, unknown>)[k] = gl[k]; });

  Object.keys(LISTS).forEach((k) => { fill(LISTS[k], g[k] as unknown[]); });
  Object.keys(TABLES).forEach((k) => {
    const live = TABLES[k] as Record<string, unknown>, saved = g[k] as Record<string, unknown>;
    clear(live);
    Object.keys(saved).forEach((n) => { live[n] = saved[n]; });
  });

  // Марки освоения — после контор и патентов: ensureDev дописывает и туда, и
  // туда, и на восстановленном оно уже есть.
  DEVS.length = 0;
  (g.devs as [string, number][]).forEach((d) => { ensureDev(d[0], d[1]); });
  setSeq(g.seq as number);

  const view = g.view as { mode: string; sys: number }, c = g.cam as { x: number; y: number; k: number };
  U.view = { mode: view.mode, sys: view.sys };
  U.pick = null; U.hover = null;
  cam.x = c.x; cam.y = c.y; cam.k = c.k;
  clear(flash); hits.length = 0; resetTickCache();
}

// ---- localStorage -----------------------------------------------------
// Записывается не каждый месяц, а не чаще раза в две секунды: снять партию на
// трёхсотом году стоит около десяти миллисекунд (сто сорок килобайт), а на x20
// ход идёт пятнадцать — запись на каждом съела бы треть игры. Зато
// принудительно, не глядя на часы, — когда вкладку прячут, ставят на паузу или
// закрывают: именно там теряется последнее, а не при крахе браузера.

const EVERY = 2000;
let lastAt = 0;
let armed = true;

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch (e) { return null; }
}

/** Отложить партию. force — не глядя на часы. */
export function keep(force?: boolean): void {
  const ls = store();
  if (!armed || !ls) return;
  const now = Date.now();
  if (!force && now - lastAt < EVERY) return;
  lastAt = now;
  try { ls.setItem(KEY, gameText()); }
  catch (e) {
    // Место в браузере кончилось или запись запрещена. Молчать нельзя — игрок
    // считает, что партия хранится, — но и долбиться каждый месяц незачем.
    armed = false;
    say("Партию не удалось сохранить: в браузере нет места. Дальше игра идёт только в этой вкладке.");
  }
}

/** Забыть отложенную партию: «Заново» и отказ от несовместимой. */
export function drop(): void {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(KEY); } catch (e) {}
  armed = true; lastAt = 0;
}

/** Развернуть отложенную партию; false — её просто нет. Несовместимая
 *  бросает ошибку, и вызывающий обязан её показать, а не проглотить. */
export function resume(): boolean {
  const ls = store();
  if (!ls) return false;
  let text: string = null;
  try { text = ls.getItem(KEY); } catch (e) { return false; }
  if (!text) return false;
  restore(text);
  return true;
}

/** Больше не писать (несовместимое сохранение ждёт решения игрока — затирать
 *  его новой партией нельзя, пока он не сказал «заново»). */
export function hold(): void { armed = false; }
