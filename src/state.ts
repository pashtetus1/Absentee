// ===================== состояние =====================
//
// Всё изменяемое состояние партии лежит здесь. Раньше это была россыпь
// переменных внутри одной большой функции, и любая из них была видна отовсюду
// даром. Теперь модулей два десятка, а модуль в ES-модулях умеет присваивать
// только СВОИМ переменным — отсюда три правила раскладки:
//
//   коллекции (corps, worlds, systems...) объявлены через const и НИКОГДА не
//     переприсваиваются: их чистят на месте через fill/clear. Так все модули
//     держат один и тот же массив, и ни одному не нужен сеттер;
//   S — показатели партии: месяц, год, казна, счётчики. Их правят все подряд;
//   L — рычаги игрока, единственное, что он крутит руками (и что сохраняется);
//   U — что сейчас на экране. К симуляции отношения не имеет: headless-прогон
//     эти поля не читает и не пишет.

import { MONTHS } from "./data";

export const corps: any[] = [], systems: any[] = [], links: any[] = [], voyages: any[] = [];
export const feed: any[] = [], worlds: any[] = [], projects: any[] = [], docks: any[] = [];
export const hits: any[] = [];                   // куда можно ткнуть на текущем кадре
export const market: any = {}, patents: any = {}, routes: any = {}, flash: any = {};
export const cam = { x: 0, y: 0, k: 1 };         // камера карты: перетаскивание и зум

export const S = {
  tick: 0, yearNow: 0, treasury: 320,
  jumped: false,
  // Какой из трёх способов достался государству — заранее НЕИЗВЕСТНО. Это
  // выясняется в тот месяц, когда кто-нибудь доводит первую марку до конца:
  // до тех пор вкладываешься в межзвёздный переход вслепую.
  moveKnown: false,
  trades: 0, turnover: 0, shipped: 0, movedPops: 0, refusals: 0, dropped: 0,
  hauled: 0, burned: 0, raids: 0,                // деталей отправлено; топлива сожжено; перехватов
  pirateCount: 0, capSeq: 0,
  home: null as any, move: null as any
};

export const L = { tax: 0.18, subKey: "drive", subYear: 90, tradeFee: 0.06, dole: 0.6, patTerm: 25, speed: 1 };

export const U = {
  view: { mode: "system", sys: 0 } as { mode: string; sys: number },
  pick: null as any, hover: null as any, lastPanel: 0, running: true, timer: null as any
};

// Содержание мира: сколько казна мира тратит на человека в месяц. Не рычаг —
// игрок не может это крутить, это цена существования людей.
export const UPKEEP = 0.3;

export const headless = typeof document === "undefined";

// Чистка коллекций на месте — замена прежним "worlds = []" и "market = {}".
// Присваивание сломало бы связь с модулями, которые этот же массив читают.
export function fill<T>(arr: T[], items: T[]): T[] {
  arr.length = 0;
  for (var i = 0; i < items.length; i++) arr.push(items[i]);
  return arr;
}
export function clear(obj: any): any {
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) delete obj[k];
  return obj;
}
export function resetCam() { cam.x = 0; cam.y = 0; cam.k = 1; }

export function Y() { return S.yearNow; }
export function dateStr() { return "год " + Y() + " · " + MONTHS[S.tick % 12]; }
export function say(t: string) { feed.unshift({ d: dateStr(), t: t }); if (feed.length > 90) feed.pop(); }
export function planets(s: any) { return s.bodies; }

// Патент — монополия НА ПРОИЗВОДСТВО (или на колонизацию класса миров), а не
// право продать лицензию. Догнавший обязан ждать истечения.
export function patLive(k: string) { var p = patents[k]; return !!(p && p.owner >= 0 && Y() - p.since < L.patTerm); }
export function knows(c: any, k: string) { return !!c.known[k]; }
export function canBuild(c: any, k: string) { return knows(c, k) && (!patLive(k) || patents[k].owner === c.id); }
export function makersOf(k: string) { return corps.filter(function (c) { return canBuild(c, k); }); }
export function anyKnows(k: string) { return corps.some(function (c) { return c.known[k]; }); }
export function anyMakes(k: string) { return makersOf(k).length > 0; }

// Кеш на один тик. Богатство компании, "последний астероид", уровень освоения
// мира и список продавцов детали не меняются внутри тика, а спрашивались
// тысячи раз за него — стоимость тика росла квадратично с числом компаний и
// миров (0.08 мс на пяти компаниях, 4 мс на тридцати). Ответы те же, счёт
// другой: воспроизводимость не трогаем.
//
// ПРАВИЛО: кеш нельзя строить на том, что меняется внутри тика — касса
// меняется во время торгов, canBuild после науки, — иначе партии расходятся.
export const tickCache: any = { wealth: {}, prize: null, dev: new Map(), sellers: null, devBest: null };
export function resetTickCache() {
  tickCache.wealth = {};
  tickCache.prize = null;
  tickCache.dev = new Map();
  tickCache.sellers = null;
  tickCache.devBest = null;
}
