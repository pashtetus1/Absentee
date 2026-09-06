// Формы предметных объектов.
//
// Это не украшение и не документация: ядро когда-нибудь переедет на C#
// (журнал, п. 9), и здешние интерфейсы — черновик будущих структур /Sim.
// Ровно поэтому они описывают ВЕЩИ мира, а не удобство отрисовки.
//
// Правило раскладки: поле необязательное (со знаком ?) только тогда, когда его
// отсутствие ЗНАЧИМО — верфь без vent строит не предприятие, у рейса без relief
// нет частного благодетеля. Если поле просто дописывается позже, оно всё равно
// обязательное: пусть компилятор требует его завести сразу.

// ---- технологии -------------------------------------------------------
// Всё, во что компания может вкладывать деньги, устроено одинаково: ключ,
// имя и сложность. Отсюда общий Tech и allTech() поверх пяти таблиц.
export interface Tech { key: string; name: string; short: string; diff: number; }

/** Деталь: её производят, продают и возят. */
export interface Comp extends Tech { work: number; base: number; glyph: string; }
/** Класс миров: право колонизировать такие планеты. */
export interface ColTech extends Tech {}
/** Марка межзвёздного перехода: чем выше, тем дальше бьёт. */
export interface Mark extends Tech { range: number; mark: number; }
/** Ходовой двигатель: множитель скорости рейсов. */
export interface Engine extends Tech { mult: number; }
/** Освоение класса миров, Mk1 и до бесконечности. */
export interface Dev extends Tech { cls: string; mark: number; }

/** Тип планеты: предел населения, урожай с фермера, каким классом осваивается. */
export interface PType {
  key: string; name: string; cap: number; farm: number;
  tech: string; col: string; w: number;
}

/** Что можно построить: из каких деталей, сколько месяцев, что даёт. */
export interface VType {
  key: string; name: string; need: Record<string, number>; build: number; glyph: string;
  yield?: number;                 // только у разработки астероидов
  term?: number;                  // на сколько месяцев хватает жилы
}

/** Способ межзвёздного перемещения. Партии достаётся ОДИН и случайно. */
export interface Move { key: string; name: string; vt: string; hint: string; }

// ---- галактика --------------------------------------------------------

/** Крупный именованный астероид. taken — уже занят чьей-то разработкой. */
export interface Rock { name: string; r: number; ang: number; s: number; seed: number; taken: boolean; }

/** Место под звёздные ворота. Пока не построены, built ложно. */
export interface Gate {
  name: string; r: number; ang: number;
  built?: boolean; building?: boolean; owner?: number;
}

/** Планета. Пока не колонизирована, world пуст — миром она не является.
 *
 *  Названа Planet, а не Body, хотя поле в системе зовётся bodies: Body есть в
 *  стандартной библиотеке браузера (тело HTTP-ответа), и в файле без импорта
 *  тип молча разрешался в НЕЁ. Ошибка при этом всплывала где-то далеко и
 *  выглядела бессмысленно.
 */
export interface Planet {
  name: string; type: PType; r: number; ang: number; rad: number;
  kind: string; sys: number; world: World | null;
  claimed?: boolean;              // кто-то уже везёт сюда колониальный модуль
}

export interface Sys {
  id: number; name: string; x: number; y: number;
  unlocked: boolean;              // сюда уже кто-то долетел
  depth: number;                  // удалённость от родины, "переход N"
  pulse: number;
  bodies: Planet[]; rocks: Rock[]; ventures: Venture[];
  ships: Ship[]; yards: Yard[]; stations: any[];
  mines: number;
  belt: boolean;                  // есть ли пояс астероидов
  gate: Gate;
}

// ---- мир --------------------------------------------------------------

export interface Pop { farm: number; prod: number; sci: number; free: number; }
export interface Wage { farm: number; prod: number; sci: number; }
export interface Food { stock: number; price: number; short: number; }

/** Филиал компании на мире: её люди и её рабочие места здесь. */
export interface Branch {
  corp: number; world: World;
  emp: { prod: number; sci: number };
  jobs: { prod: number; sci: number };
  wip?: Record<string, number>;   // что цех сейчас делает
}

/** Населённая планета: люди, еда, кошелёк правительства, места под филиалы. */
export interface World {
  body: Planet; sys: number; type: PType;
  cap: number; cap0: number;
  pop: Pop; wage: Wage; food: Food;
  gov: { cash: number };
  slots: number; rights: any[]; branches: Branch[];
  wantOut: number; wantIn: number;
  founder: number;                // кто основал; -1 у родины
  born: string; parts: any[]; flow: string; blight: number;
  rough: number;                  // месяцы разрухи: свежая колония живёт на привозном
  edge?: boolean;                 // мир дошёл до края, жребий уже брошен
  free?: boolean;                 // мир объявил независимость и вышел из государства
  reliefAt?: number;              // когда сюда в последний раз слали помощь
}

// ---- компании ---------------------------------------------------------

export interface Corp {
  id: number; name: string; color: string;
  craft: string;                         // ремесло словом: «буры», «самолёты», «разбой»
  nerve: number;                         // смелость: во сколько раз просит выше ходовой
  apt: Record<string, number>;           // склонность к каждой технологии
  cash: number;
  known: Record<string, boolean>;        // что уже освоено
  spent: Record<string, number>;         // сколько вложено в каждую технологию
  stock: Record<string, Record<string, number>>;   // склад с адресом: система -> деталь
  tot?: Record<string, number>;          // сумма склада, держится вместе с ним
  target: string | null;                 // во что вкладывается сейчас
  order: Order | null;                   // что заказано на постройку
  branches: Branch[];
  sold: number; bought: number; cool: number;
  embargo: Record<string, number>;       // кому и в чём отказано
  ask: Record<string, number>;           // во сколько раз просит выше ходовой цены
  pirate?: boolean;                      // ушла в разбой
  home?: World;                          // логово вольницы
  origin?: string;                       // какой жребий её породил
  bornAt?: World;                        // мир, на котором она возникла
  native?: string;                       // класс миров, родной отделившейся колонии
  fuelAcct?: Record<number, { fly: Record<string, number> }>;   // топливо в пути, по системам
}

// ---- заказы и стройки -------------------------------------------------

/** Заказ компании: свезти детали и построить. */
export interface Order {
  type: string; need: Record<string, number>; got: Record<string, number>;
  parts: Part[]; born: string;
  wait?: number;                  // месяцев ждём недостающую деталь
  fly?: Record<string, number>;   // чего уже везут, чтобы не заказать дважды
  sys?: number;                   // где собирают
  dst?: number;                   // куда полетит готовое
  to?: number;                    // цель прыжка
  rock?: Rock;                    // какой астероид разрабатывать
  gateAt?: number;                // в какой системе ставят ворота
}

/** Одна купленная деталь: что (k), у кого (from), почём. */
export interface Part { k: string; from: number; price?: number; sys?: number; }

/** Подписка на колонию: скидываются несколько компаний. */
export interface Project {
  lead: number; body: Planet; dst: number; sys: number;
  cost: number; purse: number;
  need: Record<string, number>; got: Record<string, number>; parts: Part[];
  backers: { corp: number; sum: number }[];
  age: number; born: string;
  done?: boolean;
  wait?: number;                  // месяцев ждём недостающую деталь
  fly?: Record<string, number>;   // чего уже везут
  seen?: number; seenPurse?: number;      // на чём подписка стояла в прошлый раз
}

// ---- то, что летает и работает ----------------------------------------

/** Куда направляется корабль: астероид, планета, система. */
export interface Dest { kind: string; ref: any; label: string; }

/** Разработка астероидов: жила, из которой капает доход, пока не кончится. */
export interface Venture {
  sys: number; lead: number; type: string; name: string; parts: Part[];
  left: number; yield: number; born: string; dest: Dest;
  live: boolean; building: boolean;
}

/** Верфь: детали свезены, идёт сборка. */
export interface Yard {
  vt: VType; lead: number; color: string; glyph: string;
  parts: Part[]; left: number; total: number;
  vent?: Venture; dest?: Dest; dst?: number;
  to?: number; gateHere?: number; fuelWait?: number;
  body?: Planet; backers?: { corp: number; sum: number }[];
}

/** Корабль внутри системы: идёт от верфи к цели. */
export interface Ship {
  kind: string; corp: number; color: string; glyph: string; size: number;
  t: number; dur: number; tp?: number;
  trail: { x: number; y: number }[];
  x: number; y: number; ang: number;
  born: string; captain: string;
  parts: Part[];
  dest?: Dest; vent?: Venture;
  body?: Planet; backers?: { corp: number; sum: number }[];
}

/** Рейс между звёздами или между мирами.
 *
 *  Форм две, и они правда разные. Хлебовоз и переселенческий идут МЕЖДУ МИРАМИ:
 *  from и to — миры, есть qty и captain. Рейс с деталью идёт МЕЖДУ СИСТЕМАМИ:
 *  вместо from стоит sysFrom, to — номер системы, k — что везут, take — что
 *  сделать по прибытии. Разводить это в два типа значило бы разводить и весь
 *  код движения, который относится к ним одинаково: летит, долетел, перехватили.
 */
export interface Voyage {
  kind: string; to: any;
  qty?: number;                   // сколько везёт; у парома и прыжка груза нет
  parts?: Part[];                 // груз деталей; у рейса с ОДНОЙ деталью его нет
  color: string; t: number; dur: number; tp?: number;
  born?: string; captain?: string;
  from?: any;                     // мир отправления (у рейсов между мирами)
  sysFrom?: number;               // система отправления (у рейсов с деталью)
  k?: string;                     // какая деталь
  corp?: number;                  // чей корабль
  forCorp?: number;               // для кого везут
  acct?: { fly: Record<string, number> };
  take?: (part: Part) => void;    // что сделать по прибытии
  relief?: number;                // чья частная помощь; иначе везёт правительство
  cargo?: string;                 // что за груз у платформы или модуля
  dest?: Dest; vent?: Venture; body?: Planet;
  backers?: { corp: number; sum: number }[];
}

/** Отработанный транспортник на орбите: его перекупят под следующий рейс. */
export interface Dock {
  kind: string; parts: Part[]; captain: string;
  sys: number; world: World; ang: number; since: number;
  corp: number;                   // хозяин-компания; -1 если государственный
  gov: World | null;              // либо правительство мира
  lane: number;                   // дорожка на орбите, чтобы не слипались
}

// ---- рынок и патенты --------------------------------------------------

export interface MarketRow { price: number; last: number; want: number; stock: number; }
export interface Patent { owner: number; since: number; told: boolean; }
