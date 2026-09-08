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

/** Деталь: её производят, продают и возят.
 *
 *  mult есть ТОЛЬКО у ходовых двигателей: их четыре модели, и различаются они
 *  ровно этим числом — во сколько раз быстрее идёт корабль, на котором стоит
 *  такой двигатель. У остальных деталей множителя нет, и его отсутствие
 *  означает «это не двигатель», а не «забыли заполнить». */
export interface Comp extends Tech { work: number; base: number; glyph: string; mult?: number; }
/** Класс миров: право колонизировать такие планеты. */
export interface ColTech extends Tech {}
/** Марка межзвёздного перехода: чем выше, тем дальше бьёт и тем быстрее идёт
 *  межзвёздный рейс. Марка отвечает за дорогу МЕЖДУ звёздами — и за дальность,
 *  и за скорость; внутри системы её нет вовсе, там правит ходовой двигатель. */
export interface Mark extends Tech { range: number; mark: number; speed: number; }
/** Ходовой двигатель: множитель скорости ВНУТРИ системы. Это деталь (см. Comp
 *  с mult), а не отдельная таблица: моделей четыре, и корабль несёт одну из
 *  них — ту, что на него поставили при сборке. */
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

/** Способ межзвёздного перемещения. Партии достаётся ОДИН и случайно.
 *
 *  comp — деталь, без которой этот способ не работает: прыжковый двигатель под
 *  движками, портальный набор под воротами. Деталь ЧУЖОГО способа в партии не
 *  нужна вообще, и наука обязана это знать — иначе компании годами вкладываются
 *  в то, что здесь никогда не полетит. */
export interface Move { key: string; name: string; vt: string; comp: string; hint: string; }

// ---- галактика --------------------------------------------------------

/** Крупный именованный астероид. taken — уже занят чьей-то разработкой. */
export interface Rock { name: string; r: number; ang: number; s: number; seed: number; taken: boolean; }

/** Место под звёздные ворота. Пока не построены, built ложно. */
/** Ворота стоят НА МАРШРУТЕ, а не в системе: одни на пару звёзд, и в системе
 *  их столько, сколько от неё расходится проложенных маршрутов. Прежние
 *  «ворота в системе» дотягивались сразу до всех других ворот — сеть без
 *  рёбер, где нечего прокладывать и не на что смотреть. */
export interface Gate {
  a: number; b: number;                 // какие системы соединяет
  built: boolean; building: boolean;
  owner: number; born?: string;
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
  ships: Ship[]; stations: Station[];
  mines: number;
  belt: boolean;                  // есть ли пояс астероидов
}

// ---- мир --------------------------------------------------------------

export interface Pop { farm: number; prod: number; sci: number; free: number; }
export interface Wage { farm: number; prod: number; sci: number; }
export interface Food {
  stock: number; price: number; short: number;
  /** Что казна мира получила с хлеба в ПРОШЕДШЕМ месяце: продала едокам минус
   *  закупила у фермеров. Считается в labour() по складу ДО еды, поэтому
   *  панель не может восстановить это число сама — только соврать. */
  gain: number;
}

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
  capTop?: number;                // жёсткий потолок: выше него не поднимает даже освоение
  pop: Pop; wage: Wage; food: Food;
  gov: { cash: number };
  slots: number;
  rights: number[];                // номера компаний, получивших право на филиал
  branches: Branch[];
  wantOut: number; wantIn: number;
  founder: number;                // кто основал; -1 у родины
  born: string;
  parts: Part[];                  // из чего был собран колониальный модуль
  flow: string; blight: number;
  rough: number;                  // месяцы разрухи: свежая колония живёт на привозном
  yard?: Shipyard;                // верфь у планеты, если построена
  yardTries?: number;             // сколько раз предлагали верфь здесь
  yardRetryAt?: number;           // раньше этого месяца не предложат снова
  edge?: boolean;                 // планета дошла до края, жребий уже брошен
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
  needYard?: boolean;                    // хотела заказать, но собрать негде — повод предлагать верфь
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
  sys?: number;                   // где собирают (система верфи; детали едут сюда)
  yard?: Shipyard;                // на какой именно верфи: в системе их может быть несколько
  dst?: number;                   // куда полетит готовое
  to?: number;                    // цель прыжка
  from?: number;                  // точка старта прыжка: система с заселённой планетой
  rock?: Rock;                    // какой астероид разрабатывать
}

/** Счёт того, что уже везут: чтобы не заказать одно и то же дважды.
 *  Есть и у заказа, и у подписки, и у топливного счёта компании. */
export interface FlyAcct { fly?: Record<string, number>; }

/** Одна купленная деталь: что (k), у кого (from), почём. */
export interface Part { k: string; from: number; price?: number; sys?: number; }

/** Подписка на колонию: скидываются несколько компаний. */
export interface Project {
  lead: number; body: Planet; dst: number; sys: number;
  yard?: Shipyard;                // где собирают модуль
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
export interface Dest { kind: string; ref: Rock | Planet; label: string; }

/** Платформа, вставшая на астероид: видимый след предприятия в системе. */
export interface Station {
  dest: Dest; color: string; glyph: string; size: number; vent: Venture; ang: number;
}

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
  to?: number; fuelWait?: number;
  forWorld?: World;               // транспорт: чьей планете он достанется
  forCorp?: number;               // транспорт: чьей компании (иначе государственный)
  from?: number;                  // прыжок: откуда стартовать; не система верфи, если её нет в дальности
  body?: Planet; backers?: { corp: number; sum: number }[];
}

/** Как государство отвечает на предложения. В браузере manual — решает игрок;
 *  остальное — для стенда, иначе партия без игрока встала бы на первом же
 *  предложении. random берёт монетку из своего генератора: воспроизводимо. */
export type ApproveMode = "manual" | "always" | "never" | "random";

/** Верфь: постройка у планеты. Строит по очереди, тем быстрее, чем больше рук. */
export interface Shipyard {
  id: number; world: World;
  owner: number;                  // -1 государственная, пользуются все; иначе — хозяин
  ang: number;                    // орбита вокруг своей планеты
  queue: Build[];                 // кто первый встал
  crew: number;                   // сколько людей удалось нанять в этом месяце
  born: number;
  backers: { corp: number; sum: number }[];   // кто скидывался на постройку
}

/** Позиция очереди верфи. Пока это Yard; шаг 3 плана уводит Sys.yards сюда. */
export type Build = Yard;

/** Предложение компаний построить верфь. Первое место, где решает игрок. */
export interface Proposal {
  id: number; world: World; lead: number;
  cost: number;                   // деньгами
  purse: number;                  // сколько внесли компании
  share: number;                  // их доля, не выше SHARE_CAP
  stateSum: number;               // сколько доложила казна
  need: Record<string, number>; got: Record<string, number>; parts: Part[];   // детали, как у Project
  fly?: Record<string, number>;   // что уже везут
  backers: { corp: number; sum: number }[];
  state: "pending" | "approved" | "declined" | "building" | "done";
  since: number; until: number;   // подано; до какого месяца висит
  attempt: number;                // которая попытка для этой планеты
  left: number;                   // сколько осталось строить
}

/** Корабль внутри системы: идёт от верфи к цели. */
export interface Ship {
  kind: string; corp: number; color: string; glyph: string; size: number;
  t: number; dur: number; tp?: number;
  trail: { x: number; y: number }[];
  x: number; y: number; ang: number;
  born: string; captain: string;
  parts: Part[];
  yard?: Shipyard;                // с какой верфи сошёл: оттуда и стартует
  dest?: Dest; vent?: Venture;
  body?: Planet; backers?: { corp: number; sum: number }[];
}

/** Прыжковый корабль у точки старта: ждёт межзвёздного топлива, потом прыгает. */
export interface Staged {
  kind: string; corp: number; color: string; parts: Part[];
  at: number;                     // где стоит
  to: number;                     // куда прыгнет
  fuelWait: number; captain: string; born: string;
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
  kind: string;
  // ЕДИНСТВЕННОЕ оставшееся any в ядре, и оно намеренное. Здесь лежит либо мир,
  // либо номер системы — смотря какой это рейс. Написать "World | number"
  // недорого, но тогда двадцать два места в коде движения обрастут
  // приведениями, а приведение не проверяет, оно только переносит допущение.
  // Настоящее решение — разбить Voyage на два типа с разбором по kind, и код
  // движения к этому уже готов: он почти везде и так ветвится по kind.
  // Это отдельная работа, а не побочный эффект типизации.
  to: any;
  qty?: number;                   // сколько везёт; у парома и прыжка груза нет
  parts?: Part[];                 // груз деталей; у рейса с ОДНОЙ деталью его нет
  color: string; t: number; dur: number; tp?: number;
  born?: string; captain?: string;
  from?: any;                     // мир отправления (у рейсов между мирами)
  sysFrom?: number;               // система отправления (у рейсов с деталью)
  k?: string;                     // какая деталь
  corp?: number;                  // чей корабль
  forCorp?: number;               // для кого везут
  acct?: FlyAcct;
  take?: (part: Part) => void;    // что сделать по прибытии
  relief?: number;                // чья частная помощь; иначе везёт правительство
  cargo?: string;                 // что за груз у платформы или модуля
  jumpTo?: number;                // паром везёт прыжковый к точке старта: куда прыгать оттуда
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

/** Кеш на один тик. Живёт ровно один месяц симуляции, см. state.ts. */
export interface TickCache {
  wealth: Record<number, number>;              // богатство компании по её номеру
  prize: boolean | null;                       // остался ли "последний астероид"
  dev: Map<World, number>;                     // уровень освоения мира
  sellers: Record<string, Corp[]> | null;      // у кого есть эта деталь
  devBest: Record<number, Record<string, number>> | null;   // лучшая марка освоения: компания -> класс
}

/** Куда можно ткнуть на текущем кадре. Собирается заново каждой отрисовкой.
 *
 *  data нарочно широкое: под одним кругом на экране может оказаться планета,
 *  корабль, рейс, стоянка или предприятие, и разбирается это по kind. Сузить
 *  до объединения можно, но тогда каждое обращение к data потребует проверки
 *  kind ещё раз — ту самую, которую панель уже сделала.
 */
/** Что сейчас выбрано игроком: планета, корабль, рейс, стоянка, предприятие.
 *  Названо Chosen, а не Pick: Pick — встроенный служебный тип TypeScript, и
 *  своё определение с таким именем он молча перекрывает (см. журнал, п. 9). */
export interface Chosen { kind: string; data: any; }

/** То же, но с кругом на экране: чем именно попадают мышью. */
export interface Hit extends Chosen { x: number; y: number; r: number; }

/** Снимок партии, который ядро отдаёт наружу: стенду и тестам.
 *
 *  Это ДОГОВОР с test/, а не внутренняя структура. Поле, убранное отсюда,
 *  ломает тесты при сборке — так и задумано: раньше они узнавали об этом
 *  падением на середине прогона.
 */
export interface Snapshot {
  tick: number; treasury: number;
  corps: Corp[]; worlds: World[]; systems: Sys[];
  move: Move; gates: Record<string, Gate>;
  market: Record<string, MarketRow>; patents: Record<string, Patent>;
  voyages: Voyage[]; projects: Project[]; docks: Dock[];
  shipyards: Shipyard[]; proposals: Proposal[]; staged: Staged[];
  trades: number; shipped: number; movedPops: number; refusals: number;
  dropped: number; hauled: number; burned: number; raids: number;
  feed: { d: string; t: string }[];
}

/** Ядро, каким его видит стенд и тесты: см. src/main.ts.
 *
 *  Всё, что экспортирует main.ts, становится полем THRESHOLD в собранном
 *  файле. Этот интерфейс — тот же список, записанный один раз, чтобы тесты
 *  спорили с компилятором, а не с прогоном на трёхстах годах.
 */
export interface Core {
  step(): void;
  build(forcedMove?: string, seed?: number): void;
  /** Сид текущей партии: по нему она разворачивается заново. */
  seedOf(): number;
  state(): Snapshot;
  setLever(k: string, v: number | string): void;
  icon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number, col: string): void;
  consts: {
    COMPS: Comp[]; COLTECH: ColTech[]; PTYPES: PType[];
    VTYPES: VType[]; MOVES: Move[]; ENGINES: Engine[]; MARKS: Mark[];
  };
  speedOf(corpId: number): number;
  popOf(w: World): number;
  setView(mode: string, sys?: number): void;
  /** Как отвечать на предложения без игрока: стенду нужна политика. */
  setApproval(mode: ApproveMode): void;
  /** Решить судьбу предложения по его id; false — такого нет. */
  decide(id: number, ok: boolean): boolean;
}
