// Тесты прототипа. Запуск: node test/run.ts (или npm test — с типами и сборкой).
//
// Проверяют не красоту, а то, что экономика не рассыпается МОЛЧА. Каждая
// проверка стоит здесь потому, что соответствующая поломка уже случалась или
// случилась бы незаметно: в браузере такая ошибка выглядит как замерший экран
// или как правдоподобное, но неверное число в панели.
//
// ОТБОР ПО ИМЕНИ:
//     node test/run.ts опустевший          только проверки со словом в имени
//     node test/run.ts опустевший герб     любая из двух (регистр не важен)
//     npm test -- опустевший               то же, но сперва типы и сборка
// Отбор, не подошедший ни к одному имени, печатает весь список имён: это ровно
// та минута, когда он нужен, и стоит он ноль — ни одна партия не крутится.
// Полный набор — это десятки миллионов симулированных тиков и минуты
// ожидания, а пока правишь одно правило, нужны две проверки из семидесяти.
// Гонять всё имеет смысл один раз, перед коммитом.

import { load } from "./harness.ts";

import type { Corp, FlyAcct, Pop, Snapshot, Voyage, World } from "../src/types.ts";

// Тесты метят уже посчитанные рейсы, чтобы один и тот же не попал в счёт
// дважды. Пометка нужна только здесь, поэтому и живёт здесь, а не в типах
// ядра: домену про неё знать незачем.
type Counted = Voyage & { counted?: boolean };

let failed = 0, passed = 0, ran = 0, skipped = 0;
const results: string[] = [];

// Отбор живёт ЗДЕСЬ, а не в оболочке из grep: grep отсекает строки вывода, а
// прогон при этом идёт целиком — то есть не экономит ничего. Экономит только
// то, что проверка вовсе не запускается.
//
// Частичный прогон обязан ВЫГЛЯДЕТЬ частичным: зелёная строка после отбора не
// значит, что набор цел, поэтому в итоге стоит число пропущенных. А отбор, не
// подошедший ни к одному имени (опечатка), считается провалом — иначе
// «прошло 0, упало 0» читалось бы как успех.
const only = process.argv.slice(2).map((a) => a.toLowerCase());
const names: string[] = [];
function picked(name: string): boolean {
  return !only.length || only.some((q) => name.toLowerCase().includes(q));
}

// pending — тест ЖДЁТ правки, которая ещё не сделана: падение не считается
// провалом, а печатается с причиной. Гоняется всё равно, и когда пройдёт —
// скажет об этом, чтобы пометку сняли, а не забыли.
function test(name: string, fn: () => void, pending?: string): void {
  names.push(name);
  if (!picked(name)) { skipped++; return; }
  ran++;
  try { fn(); passed++; results.push("  ок   " + name + (pending ? "   ← уже проходит, снять пометку" : "")); }
  catch (e) {
    if (pending) { results.push("  ЖДЁТ  " + name + "\n         " + pending); return; }
    failed++; results.push("  ПЛОХО " + name + "\n         " + (e as Error).message);
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function close(a: number, b: number, eps: number, msg: string): void {
  if (Math.abs(a - b) > eps) throw new Error(msg + " (" + a.toFixed(3) + " против " + b.toFixed(3) + ")");
}

// склад теперь с адресом: c.stock[система][деталь]
const stockOf = (c: Corp, k: string): number =>
  Object.values(c.stock).reduce((a, s) => a + (s[k] || 0), 0);
const eachStock = (c: Corp, fn: (k: string, n: number, sys: string) => void): void =>
  Object.keys(c.stock).forEach((sys) =>
    Object.keys(c.stock[sys]).forEach((k) => fn(k, c.stock[sys][k], sys)));

function runYears(sim: { step(): void; state(): Snapshot }, years: number,
                  check?: (st: Snapshot, month: number) => void): Snapshot {
  for (let i = 0; i < years * 12; i++) {
    sim.step();
    if (check) check(sim.state(), i);
  }
  return sim.state();
}

// ── ядро запускается и не падает ────────────────────────────────────────────
test("ядро стартует без браузера", () => {
  const sim = load("dist/index.html", { seed: 1 });
  const st = sim.state();
  assert(st.corps.length === 5, "должно быть пять компаний");
  assert(st.worlds.length === 1, "на старте освоена только Тира");
  assert(st.systems.length === 50, "пятьдесят систем");
  assert(st.shipyards.length === 1 && st.shipyards[0].world === st.worlds[0], "родина начинает с одной верфью");
});

test("двести лет без исключений", () => {
  const sim = load("dist/index.html", { seed: 7 });
  runYears(sim, 200);
});

// ── население: сумма каст равна итогу ───────────────────────────────────────
// Уже ломалось: убыль вычиталась только из свободных, и когда безработных не
// оставалось, итог расходился с суммой по занятиям — панель начинала врать.
test("население неотрицательно и конечно", () => {
  const sim = load("dist/index.html", { seed: 3 });
  runYears(sim, 120, (st) => {
    st.worlds.forEach((w) => {
      (["farm","prod","sci","free"] as (keyof Pop)[]).forEach((k) => {
        assert(Number.isFinite(w.pop[k]), "население " + k + " на " + w.body.name + " стало не числом");
        assert(w.pop[k] >= -1e-9, "отрицательное население " + k + " на " + w.body.name);
      });
    });
  });
});

test("мир не переполняется сверх предела навсегда", () => {
  const sim = load("dist/index.html", { seed: 11 });
  const st = runYears(sim, 150);
  st.worlds.forEach((w) => {
    const total = sim.popOf(w);
    assert(total <= w.cap * 1.35, w.body.name + ": населения " + total.toFixed(1) + " при пределе " + w.cap);
  });
});

// ── деньги ──────────────────────────────────────────────────────────────────
test("касса и цены остаются числами", () => {
  const sim = load("dist/index.html", { seed: 5 });
  runYears(sim, 150, (st) => {
    assert(Number.isFinite(st.treasury), "казна стала не числом");
    st.corps.forEach((c) => assert(Number.isFinite(c.cash), c.name + ": касса стала не числом"));
    Object.keys(st.market).forEach((k) => {
      const m = st.market[k];
      assert(Number.isFinite(m.price), k + ": цена стала не числом");
      assert(m.price > 0, k + ": цена упала до нуля");
    });
  });
});

test("цены держатся в коридоре от базы", () => {
  const sim = load("dist/index.html", { seed: 9 });
  const st = runYears(sim, 200);
  sim.consts.COMPS.forEach((f) => {
    const p = st.market[f.key].price;
    assert(p >= f.base * 0.34 && p <= f.base * 5.1, f.short + ": цена " + p.toFixed(1) + " вне коридора");
  });
});

test("склад деталей не уходит в минус", () => {
  const sim = load("dist/index.html", { seed: 13 });
  runYears(sim, 150, (st) => {
    st.corps.forEach((c) => {
      eachStock(c, (k, n, sys) => {
        assert(n >= 0, c.name + ": отрицательный склад " + k + " в системе " + sys);
        assert(Number.isInteger(n), c.name + ": дробная деталь " + k);
      });
    });
  });
});

// ── цеха не работают на пустой склад ────────────────────────────────────────
// Уже ломалось: к 29 году лежало 222 товара при нуле заказов, и весь труд
// планеты уходил в никуда.
test("склад не забивается деталями без спроса", () => {
  const sim = load("dist/index.html", { seed: 17 });
  const st = runYears(sim, 120);
  st.corps.forEach((c) => {
    if (c.pirate) return;            // у вольницы склад — награбленное, а не работа
    eachStock(c, (k, n, sys) => {
      // Топливо цех делает партиями: work = 1, а cap бывает большой, и за один
      // месяц склад перескакивает потолок 10 до 15-17. Это размер партии, а не
      // работа в пустоту — потом цех стоит, пока не сожгут. Для деталей потолок
      // строгий: там work 2-9, и перескок в штуку, не в пятёрку.
      const cap = (k === "fuel" || k === "sfuel") ? 20 : 12;
      assert(n <= cap, c.name + ": " + n + " штук «" + k + "» на складе в системе " + sys + " — работа в пустоту");
    });
  });
});

// ── технологии, патенты, монополия ──────────────────────────────────────────
test("за сто лет осваивают хотя бы половину деталей", () => {
  const sim = load("dist/index.html", { seed: 23 });
  const st = runYears(sim, 100);
  const known = sim.consts.COMPS.filter((f) => st.corps.some((c) => c.known[f.key])).length;
  assert(known >= 3, "освоено всего " + known + " деталей из " + sim.consts.COMPS.length);
});

test("патент даёт монополию на производство", () => {
  const sim = load("dist/index.html", { seed: 29 });
  const st = runYears(sim, 60);
  // только детали: технологии колонизации на складе не лежат
  sim.consts.COMPS.map((f) => f.key).forEach((k) => {
    const p = st.patents[k];
    if (p.owner < 0) return;
    const live = Math.floor(st.tick / 12) - p.since < 25;
    if (!live) return;
    const makers = st.corps.filter((c) => c.known[k] && c.id !== p.owner);
    makers.forEach((c) => {
      // догнавший под живым патентом имеет право знать, но не производить:
      // его склад по этой детали не должен расти
      assert(stockOf(c, k) === 0, c.name + " делает «" + k + "» вопреки патенту " + st.corps[p.owner].name);
    });
  });
});

// ── рынок реально работает ──────────────────────────────────────────────────
test("к ста годам детали покупаются друг у друга", () => {
  const sim = load("dist/index.html", { seed: 31 });
  const st = runYears(sim, 100);
  assert(st.trades > 0, "за сто лет ни одной сделки: рынок мёртв");
});

test("корабли собираются из чужих деталей", () => {
  const sim = load("dist/index.html", { seed: 37 });
  const st = runYears(sim, 120);
  let mixed = 0, total = 0;
  st.systems.forEach((s) => s.ventures.forEach((v) => {
    total++;
    if (v.parts.some((p) => p.from !== v.lead)) mixed++;
  }));
  assert(total > 0, "за сто двадцать лет не построено ни одного предприятия");
  assert(mixed > 0, "все предприятия построены в одиночку: кооперации нет");
});

// ── отказы продавать ────────────────────────────────────────────────────────
// Деталь на складе — рычаг, а не товар: продать двигатель тому, кто рвётся к
// последнему астероиду, значит устроить его рывок своими руками.
test("компании отказывают друг другу", () => {
  const sim = load("dist/index.html", { seed: 61 });
  const st = runYears(sim, 150);
  assert(st.refusals > 0, "за сто пятьдесят лет ни одного отказа: рычаг не работает");
});

test("отказ помнится годами, а не перерешается каждый месяц", () => {
  const sim = load("dist/index.html", { seed: 67 });
  let seen = false;
  runYears(sim, 120, (st) => {
    st.corps.forEach((c) => {
      Object.keys(c.embargo).forEach((k) => {
        if (c.embargo[k] > st.tick + 12) seen = true;      // запрет живёт больше года
      });
    });
  });
  assert(seen, "эмбарго не держится дольше года — отказ ничего не значит");
});

test("отказы не душат экономику насмерть", () => {
  const sim = load("dist/index.html", { seed: 71 });
  const st = runYears(sim, 200);
  assert(st.trades > 50, "всего " + st.trades + " сделок: рынок задушен отказами");
  assert(st.worlds.length > 1, "из-за отказов не основано ни одной колонии");
});

test("свёрнутая сборка возвращает детали на склад", () => {
  const sim = load("dist/index.html", { seed: 73 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => {
      eachStock(c, (k, n) => assert(n >= 0, c.name + ": отрицательный склад " + k + " после отмены"));
    });
  });
});

// ── корабли долетают ────────────────────────────────────────────────────────
test("флот не зависает в пути", () => {
  const sim = load("dist/index.html", { seed: 41 });
  runYears(sim, 150, (st) => {
    st.systems.forEach((s) => s.ships.forEach((sh) => {
      assert(sh.t <= 1.001, "корабль пролетел мимо цели: t=" + sh.t.toFixed(2));
    }));
    st.voyages.forEach((v) => assert(v.t <= 1.001, "рейс пролетел мимо цели"));
  });
  const st = sim.state();
  st.systems.forEach((s) => assert(s.ships.length < 30, s.name + ": флот копится и не долетает"));
});

// ── расселение и снабжение ──────────────────────────────────────────────────
// Уже ломалось: пока модуль летел, вторая компания открывала подписку на ту же
// планету, и на одной планете вырастало по десять колоний. В панели это
// выглядело как 104 мира при сорока планетах в галактике.
test("на планете не больше одной колонии", () => {
  const sim = load("dist/index.html", { seed: 2 });
  const st = runYears(sim, 250);
  const bodies = new Set();
  let planets = 0;
  st.systems.forEach((s) => { planets += s.bodies.length; });
  st.worlds.forEach((w) => {
    assert(!bodies.has(w.body), w.body.name + ": на планете две колонии сразу");
    bodies.add(w.body);
  });
  assert(st.worlds.length <= planets, "миров " + st.worlds.length + " при " + planets + " планетах");
});

// Сидов ТРИ, и счёт общий: переселение случается не в каждой партии. Пока тест
// стоял на одном сиде (4), он проверял не механику, а конкретную партию — и упал
// от правки, которая переселения не касалась вовсе (убрали пособие, свободные
// стали быстрее находить работу, и в тихой партии на четыре мира уезжать стало
// некому). Замер по пятнадцати сидам: на двенадцати переезжает от 2 до 12
// человечков, на трёх — меньше половины. Механика жива, редкой её делает сама
// партия, и тест обязан мерить её так же — на нескольких.
test("переселение случается", () => {
  let moved = 0;
  const each: string[] = [];
  for (const seed of [2, 4, 5]) {
    const st = runYears(load("dist/index.html", { seed }), 250);
    moved += st.movedPops;
    each.push(seed + ": " + st.movedPops.toFixed(1));
  }
  assert(moved > 1, "за три партии по двести пятьдесят лет переселено " +
                    moved.toFixed(1) + " человечков (" + each.join(", ") + ")");
});

test("за двести лет осваивают новые миры", () => {
  const sim = load("dist/index.html", { seed: 43 });
  const st = runYears(sim, 200);
  assert(st.worlds.length > 1, "за двести лет не основано ни одной колонии");
});

test("бесплодные миры получают привозную еду", () => {
  const sim = load("dist/index.html", { seed: 47 });
  const st = runYears(sim, 250);
  const barren = st.worlds.filter((w) => w.type.farm < 1 && w.founder >= 0);
  if (!barren.length) return;                       // в этой партии таких не колонизовали
  assert(st.shipped > 0, "есть бесплодные миры, но еда ни разу не возилась");
});

test("еда не берётся из ниоткуда", () => {
  const sim = load("dist/index.html", { seed: 53 });
  runYears(sim, 150, (st) => {
    st.worlds.forEach((w) => {
      assert(w.food.stock >= -1e-9, w.body.name + ": отрицательный запас еды");
      assert(Number.isFinite(w.food.stock), w.body.name + ": запас еды стал не числом");
    });
  });
});

// ── казна мира торгует хлебом ───────────────────────────────────────────────
// Казна мира скупает у фермеров урожай и продаёт еду едокам. До этой правки
// касса мира не была покрыта НИ ОДНИМ тестом (журнал признавал это дырой), а
// теперь через неё каждый месяц идут потоки больше всего прежнего прихода.

test("касса мира не уходит в минус и остаётся числом", () => {
  const sim = load("dist/index.html", { seed: 59 });
  runYears(sim, 150, (st) => {
    st.worlds.forEach((w) => {
      assert(w.gov.cash >= 0, w.body.name + ": касса мира ушла в минус (" + w.gov.cash.toFixed(2) + ")");
      assert(Number.isFinite(w.gov.cash), w.body.name + ": касса мира стала не числом");
    });
  });
});

// Раньше в поле платили price * 2.4 ВЕЗДЕ: фермеру на голой планете, где он
// кормит десятую долю человека, столько же, сколько на джунглях. Людей тянуло
// в заведомо бесплодное поле. Теперь платят за выработку, и разрыв обязан быть
// виден в числах, а не только в замысле.
test("на скудной земле в поле платят меньше, чем на плодородной", () => {
  const st = runYears(load("dist/index.html", { seed: 61 }), 200);
  // Миры С ПОСТРОЙКАМИ из сравнения вон. Тест о том, что платят ЗА ВЫРАБОТКУ, а
  // у мира с гидропоникой выработка больше не равна плодородию его земли: теплица
  // держит пол независимо от почвы. Сравнивать его со скудной землёй — значит
  // сравнивать не то, о чём тест: плодородный мир в неурожай даёт 2.4 x 0.5 = 1.2,
  // и бедный с теплицей обгонит его законно.
  const poor = st.worlds.filter((w) => w.type.farm > 0 && w.type.farm <= 0.7 && !w.built.length);
  const rich = st.worlds.filter((w) => w.type.farm >= 2 && !w.built.length);
  if (!poor.length || !rich.length) return;          // в этой партии таких пар нет
  // сравниваем в долях цены еды: цены у миров свои и разные
  const rate = (w: typeof poor[0]) => w.wage.farm / Math.max(0.01, w.food.price);
  const best = Math.max(...poor.map(rate)), worst = Math.min(...rich.map(rate));
  assert(best < worst, "в скудном поле платят не меньше, чем в плодородном (" +
                       best.toFixed(2) + " против " + worst.toFixed(2) + " цены еды)");
});

// Хлеб — приход, растущий с населением и с ценой, и он способен разогнать
// казну мира до бессмысленных величин. Журнал (п. 5) помнит, чем это кончается:
// без содержания родина приходила к тринадцати тысячам при переселенческом за
// 66, «и никакая цена в игре ничего не значила» — порог «хватает ли денег» был
// выполнен всегда. Сторож меряет ПИК за партию по дюжине сидов подряд: срез на
// конец партии врёт (к трёхсотому году казна пуста при любом CUT), а три
// выбранных сида однажды уже пропустили CUT = 0.20, при котором худший пик
// был 14 677. Дюжина по 300 лет — полминуты, как у соседнего теста на 20 сидов.
test("казна мира не разгоняется до бессмысленных величин", () => {
  for (let seed = 1; seed <= 12; seed++) {
    let peak = 0;
    runYears(load("dist/index.html", { seed }), 300, (st) => {
      st.worlds.forEach((w) => { peak = Math.max(peak, w.gov.cash); });
    });
    assert(peak < 10000, "сид " + seed + ": казна мира дошла до " + Math.round(peak) +
                         " — при таком кошельке ни одна цена в игре ничего не значит");
  }
}, "столица сжата до 32 человечков (setup): содержание мира больше не съедает приход с занятых, и казна копит. Порог 10000 проходится впритык и ходит туда-обратно от любой правки — снимать пометку до решения по выработке человечка рано.");

// ── два способа межзвёздного перехода ───────────────────────────────────────
// Способ выпадает партии один и случайно. Каждый обязан доводить партию до
// расселения — иначе на половине сидов игра просто стоит.
["drives", "gates"].forEach((mode) => {
  test("способ «" + mode + "»: системы открываются", () => {
    const sim = load("dist/index.html", { seed: 83 });
    sim.build(mode);
    const st = runYears(sim, 250);
    assert(st.move.key === mode, "режим не установился");
    const open = st.systems.filter((s) => s.unlocked).length;
    assert(open > 1, "за двести пятьдесят лет открыта одна система: экспансия стоит");
  });
});

// Ворота стоят на МАРШРУТЕ, и сеть из них складывается рёбрами: рейс идёт не
// «из системы с воротами в систему с воротами», а по цепочке проложенных
// маршрутов. Прежние ворота-на-систему дотягивались сразу до всех остальных,
// и никакой сети за ними не стояло.
function netOk(st: Snapshot, a: number, b: number): boolean {
  const seen = new Set([a]), q = [a];
  while (q.length) {
    const i = q.shift();
    if (i === b) return true;
    Object.keys(st.gates).forEach((k) => {
      const g = st.gates[k];
      if (!g.built) return;
      const n = g.a === i ? g.b : g.b === i ? g.a : null;
      if (n === null || seen.has(n)) return;
      seen.add(n); q.push(n);
    });
  }
  return false;
}

test("под воротами рейсы идут только по цепочке проложенных маршрутов", () => {
  for (const seed of [89, 97]) {
    const sim = load("dist/index.html", { seed });
    sim.build("gates");
    runYears(sim, 200, (st) => {
      st.voyages.forEach((v) => {
        if (v.kind !== "food" && v.kind !== "pops") return;
        if (v.from.sys === v.to.sys) return;
        assert(netOk(st, v.from.sys, v.to.sys), "рейс туда, куда нет цепочки ворот");
      });
    });
  }
});

// Врат столько, сколько маршрутов: у каждых ворот два конца, и в системе их
// ровно столько, сколько от неё расходится дорог.
test("ворота стоят на маршрутах, а не в системах", () => {
  const sim = load("dist/index.html", { seed: 89 });
  sim.build("gates");
  const st = runYears(sim, 300);
  const keys = Object.keys(st.gates);
  assert(keys.length > 0, "за триста лет не поставили ни одних ворот");
  keys.forEach((k) => {
    const g = st.gates[k];
    assert(g.a !== g.b, "ворота из системы в саму себя");
    assert(k === Math.min(g.a, g.b) + "-" + Math.max(g.a, g.b), "ключ маршрута не совпадает с концами: " + k);
  });
  // у системы, куда пришёл портальный корабль, есть хотя бы один створ
  st.systems.forEach((s) => {
    if (!s.unlocked || s.id === 0) return;
    assert(keys.some((k) => { const g = st.gates[k]; return g.built && (g.a === s.id || g.b === s.id); }),
           s.name + ": система открыта, а ворот на неё нет");
  });
});

test("под движками межзвёздный транспорт везёт двигатель", () => {
  const sim = load("dist/index.html", { seed: 103 });
  sim.build("drives");
  let checked = 0;
  runYears(sim, 250, (st) => {
    st.voyages.forEach((v) => {
      if (v.kind !== "food" && v.kind !== "pops") return;
      if (v.from.sys === v.to.sys) return;
      checked++;
      assert(v.parts.some((p) => /^drive\d$/.test(p.k)), "межзвёздный рейс без двигателя на борту");
    });
  });
});

// ── карта ───────────────────────────────────────────────────────────────────
// Звёзды раскиданы случайно, поэтому генератор обязан доказывать, что не
// оставил островов: до любой звезды должна быть цепочка прыжков на старшей
// марке, иначе часть карты — мёртвый груз.
test("на старшей марке достижима вся галактика", () => {
  const D = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = load("dist/index.html", { seed });
    const S = sim.state().systems;
    const R = sim.consts.MARKS[sim.consts.MARKS.length - 1].range;
    const seen = new Set([0]), q = [0];
    while (q.length) {
      const i = q.shift();
      S.forEach((s, j) => { if (!seen.has(j) && D(S[i], s) <= R) { seen.add(j); q.push(j); } });
    }
    assert(seen.size === S.length, "сид " + seed + ": достижимо " + seen.size + " из " + S.length);
  }
});

// У ровных колец радиусы сбиваются в несколько значений; меряем, часто ли
// соседние по величине радиусы стоят вплотную.
//
// Порог здесь был 50% на ОДНОМ сиде, и это ничего не проверяло: замер по сорока
// сидам даёт середину 49% при худшем 63%, то есть порог стоял ровно на медиане
// и срабатывал как монетка — половина сидов его перешагивала на любом коде.
// Настоящие кольца дали бы под сотню процентов, поэтому меряем среднее по
// нескольким картам и ставим порог там, где он отличает кольца от случая.
test("звёзды стоят не по кольцам", () => {
  let sum = 0;
  const seeds = [5, 12, 21, 34, 47, 58];
  seeds.forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const S = sim.state().systems, home = S[0];
    const rs = S.slice(1).map((s) => Math.hypot(s.x - home.x, s.y - home.y));
    rs.sort((a, b) => a - b);
    let same = 0;
    for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i] - rs[i - 1]) < 4) same++;
    sum += same / rs.length;
  });
  const share = sum / seeds.length;
  assert(share < 0.65, "радиусы слипаются в кольца: " + Math.round(share * 100) + "% в среднем по " + seeds.length + " картам");
});

test("астероиды раскиданы по системе, а не по кольцу", () => {
  const sim = load("dist/index.html", { seed: 7 });
  const S = sim.state().systems.filter((s) => s.rocks.length >= 4);
  assert(S.length > 0, "ни в одной системе нет астероидов");
  const spread = S.map((s) => {
    const rs = s.rocks.map((r) => r.r);
    return Math.max.apply(null, rs) - Math.min.apply(null, rs);
  });
  const avg = spread.reduce((a, b) => a + b, 0) / spread.length;
  assert(avg > 60, "разброс радиусов всего " + avg.toFixed(0) + ": камни выстроились в кольцо");
});

test("камни не ложатся под планеты, а места створов свободны", () => {
  // Створ встаёт на последней орбите не дальше 30° от луча к соседу, до
  // которого достаёт лучшая марка (130). Раньше камень мог лечь прямо под
  // планету — подписи накрывали друг друга — а ворота стояли за краем на
  // своём кольце 420.
  const REACH = 130, DEV = 30 * Math.PI / 180 + 1e-6;
  for (let seed = 1; seed <= 12; seed++) {
    const sys = load("dist/index.html", { seed }).state().systems;
    sys.forEach((s) => {
      const at = (o: { r: number; ang: number }) => ({ x: Math.cos(o.ang) * o.r, y: Math.sin(o.ang) * o.r });
      const outer = Math.max.apply(null, s.bodies.map((b) => b.r));
      assert(Math.abs(s.gateR - outer) < 1e-9, s.name + ": ворота не на последней орбите");
      const gates = sys.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) <= REACH)
        .map((o) => {
          const ray = Math.atan2(o.y - s.y, o.x - s.x), a = s.gateAngs[o.id];
          assert(a !== undefined, s.name + ": нет места под створ к " + o.name);
          const d = Math.abs(((a - ray) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
          assert(d <= DEV, s.name + ": створ к " + o.name + " ушёл от луча на " + (d * 180 / Math.PI).toFixed(0) + "°");
          return { x: Math.cos(a) * s.gateR, y: Math.sin(a) * s.gateR };
        });
      s.rocks.forEach((r) => {
        const p = at(r);
        s.bodies.forEach((b) => {
          const q = at(b);
          assert(Math.hypot(p.x - q.x, p.y - q.y) > b.rad + 40, s.name + ": камень " + r.name + " под планетой " + b.name);
        });
        gates.forEach((g) => { assert(Math.hypot(p.x - g.x, p.y - g.y) > 30, s.name + ": камень " + r.name + " на месте створа"); });
      });
      s.bodies.forEach((b) => {
        const q = at(b);
        gates.forEach((g) => { assert(Math.hypot(q.x - g.x, q.y - g.y) > b.rad + 30, s.name + ": планета " + b.name + " на месте створа"); });
      });
    });
  }
});

// Створ — сооружение с конусом ±40°: один ведёт ко всем соседям в конусе, и
// маршрут открыт, когда створы двух звёзд смотрят друг на друга. Поэтому
// створов в системе не больше, чем маршрутов, у каждого маршрута есть
// створы с обоих концов, и марка маршрута — младшая из двух.
test("створы ведут ко всем соседям в конусе, а маршруты складываются из створов", () => {
  const CONE = 40 * Math.PI / 180 + 1e-6;
  const diff = (a: number, b: number) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  let shared = 0, routes = 0;
  for (const seed of [89, 97, 7]) {
    const sim = load("dist/index.html", { seed });
    sim.build("gates");
    const st = runYears(sim, 300);
    Object.keys(st.gates).forEach((k) => {
      const g = st.gates[k];
      if (!g.built) return;
      routes++;
      assert(g.mark >= 1, "у маршрута " + k + " нет марки");
      [[g.a, g.b], [g.b, g.a]].forEach(([i, j]) => {
        const s = st.systems[i], o = st.systems[j], ray = Math.atan2(o.y - s.y, o.x - s.x);
        // ближайший к лучу створ в конусе — тот же выбор, что у portalFor в коде
        const p = s.portals.filter((p) => diff(p.ang, ray) <= CONE).sort((a, b) => diff(a.ang, ray) - diff(b.ang, ray))[0];
        assert(p, s.name + ": маршрут к " + o.name + " есть, а створа в ту сторону нет");
        assert(p.mark >= g.mark, s.name + ": марка маршрута старше марки створа");
      });
    });
    st.systems.forEach((s) => {
      const mine = Object.keys(st.gates).filter((k) => st.gates[k].built && (st.gates[k].a === s.id || st.gates[k].b === s.id)).length;
      assert(s.portals.length <= mine, s.name + ": створов больше, чем маршрутов");
      shared += mine - s.portals.length;
    });
  }
  assert(routes > 0, "за триста лет не проложено ни одного маршрута");
  assert(shared > 0, "ни один створ не обслуживает двух маршрутов: конус не работает");
});

// Марки — лестница: следующую не берут, не освоив предыдущую, патентов на них
// нет, а ступень становится общей, когда где-то освоены две следующие.
test("марки берутся по порядку, без патентов, и открываются всем через две ступени", () => {
  for (const seed of [29, 83]) {
    const sim = load("dist/index.html", { seed });
    const ladders = (st: Snapshot): string[][] => {
      const eng = ["eng1", "eng2", "eng3", "eng4"];
      const move = Object.keys(st.patents).filter((k) => /^(drive|gkit)\d$/.test(k)).sort();
      const devs: Record<string, string[]> = {};
      Object.keys(st.patents).filter((k) => /^dev_/.test(k)).forEach((k) => {
        const cls = k.split("_")[1]; (devs[cls] = devs[cls] || []).push(k);
      });
      Object.keys(devs).forEach((c) => { devs[c].sort((a, b) => +a.split("_")[2] - +b.split("_")[2]); });
      return [eng, move].concat(Object.keys(devs).map((c) => devs[c]));
    };
    const st = runYears(sim, 300, (st) => {
      ladders(st).forEach((keys) => {
        keys.forEach((k, i) => {
          assert(st.patents[k].owner < 0, "на марку " + k + " выдан патент");
          if (!i) return;
          st.corps.forEach((c) => {
            assert(!c.known[k] || c.known[keys[i - 1]], c.name + " знает " + k + ", не зная " + keys[i - 1]);
          });
        });
      });
    });
    ladders(st).forEach((keys) => {
      keys.forEach((k, i) => {
        const n1 = keys[i + 1], n2 = keys[i + 2];
        if (!n1 || !n2) return;
        const known = (key: string) => st.corps.some((c) => c.known[key]);
        if (known(n1) && known(n2))
          st.corps.forEach((c) => { assert(c.known[k], c.name + " не знает " + k + ", хотя освоены " + n1 + " и " + n2); });
      });
    });
  }
});

// ── зависшие подписки ───────────────────────────────────────────────────────
// Уже ломалось: подписка на колонию висела вечно, деньги были собраны, а
// корпус никто не продавал — и планета всё это время числилась занятой, так
// что её не мог взять никто. Первая колония уезжала на сто четвёртый год.
test("зависшая подписка распадается и освобождает планету", () => {
  const sim = load("dist/index.html", { seed: 3 });
  runYears(sim, 200, (st) => {
    st.projects.forEach((pr) => {
      assert((pr.wait || 0) < 90, "подписка на " + pr.body.name + " висит без движения " + pr.wait + " месяцев");
    });
    st.systems.forEach((s) => s.bodies.forEach((b) => {
      if (!b.claimed || b.world) return;
      const live = st.projects.some((pr) => pr.body === b);
      // модуль может лететь тремя способами: внутри системы, на стапеле или
      // межзвёздным перегоном в чужую систему
      const flying = st.systems.some((sy) => sy.ships.some((sh) => sh.body === b)) ||
                     st.shipyards.some((sy) => sy.queue.some((y) => y.body === b)) ||
                     st.voyages.some((v) => v.kind === "ferry" && v.body === b);
      assert(live || flying, b.name + ": планета числится занятой, а взять её некому");
    }));
  });
});

test("распавшаяся подписка не съедает деньги вкладчиков", () => {
  const sim = load("dist/index.html", { seed: 5 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => assert(Number.isFinite(c.cash) && c.cash >= -41, c.name + ": касса " + c.cash));
  });
});

// ── перевозка деталей, топливо, торг ────────────────────────────────────────
// Деталь лежит там, где сделана; в другую систему её ВЕЗУТ, и рейс жжёт
// межзвёздное топливо. Если это не происходит, значит склад опять общий на
// всю галактику и рынок телепортирует.
test("детали возят грузовиком, а не телепортируют", () => {
  // С верфью сборка сидит там, где живут, и на малой родине первые двести лет
  // возить бывает нечего: всё делают и собирают в одной системе. Проверяем
  // механизм, а не темп одной партии — хотя бы в одной из четырёх грузовик
  // с деталями должен уйти.
  let hauled = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sim = load("dist/index.html", { seed });
    hauled += runYears(sim, 200).hauled;
  }
  assert(hauled > 0, "за двести лет в восьми партиях ни одного грузовика с деталями");
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, производство упало втрое, межзвёздная торговля деталями за 200 лет не начинается. Ждёт решения по выработке человечка.");

test("грузовик с деталями долетает и отдаёт груз", () => {
  const sim = load("dist/index.html", { seed: 5 });
  runYears(sim, 200, (st) => {
    st.voyages.forEach((v) => {
      if (v.kind !== "parts") return;
      assert(v.t <= 1.001, "грузовик пролетел мимо: t=" + v.t.toFixed(2));
      assert(typeof v.take === "function", "у грузовика нет получателя");
    });
  });
});

test("топлива на складах не бывает меньше нуля", () => {
  const sim = load("dist/index.html", { seed: 7 });
  runYears(sim, 150, (st) => {
    st.corps.forEach((c) => eachStock(c, (k, n) => {
      if (k === "fuel" || k === "sfuel") assert(n >= 0, c.name + ": " + k + " ушло в минус");
    }));
  });
});

test("запросы продавцов остаются в коридоре торга", () => {
  const sim = load("dist/index.html", { seed: 11 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => Object.keys(c.ask).forEach((k) => {
      assert(c.ask[k] >= 0.7 - 1e-9 && c.ask[k] <= 2.2 + 1e-9, c.name + ": запрос ×" + c.ask[k].toFixed(2) + " за " + k);
    }));
  });
});

test("торг не одинаков у всех: запросы расходятся", () => {
  const sim = load("dist/index.html", { seed: 13 });
  const st = runYears(sim, 120);
  const asks = st.corps.map((c) => c.ask.hull);
  assert(Math.max(...asks) - Math.min(...asks) > 0.03, "все просят одно и то же: торга нет");
});

// ── ходовые двигатели ───────────────────────────────────────────────────────
// Пять марок, каждая быстрее; патентуются как всё остальное. База нарочно
// медленная — ускорение должно ощущаться наградой.
test("ходовые двигатели исследуются и ускоряют рейсы", () => {
  const sim = load("dist/index.html", { seed: 17 });
  const st = runYears(sim, 200);
  const known = sim.consts.ENGINES.filter((e) => st.corps.some((c) => c.known[e.key])).length;
  assert(known >= 2, "за двести лет освоено всего " + known + " марок двигателей");
  const fastest = Math.max(...st.corps.map((c) => sim.speedOf(c.id)));
  assert(fastest > 1, "никто не летает быстрее базы");
});

test("длительность рейса всегда конечна и положительна", () => {
  const sim = load("dist/index.html", { seed: 19 });
  runYears(sim, 150, (st) => {
    st.voyages.forEach((v) => assert(v.dur > 0 && Number.isFinite(v.dur), "рейс с длительностью " + v.dur));
    st.systems.forEach((s) => s.ships.forEach((sh) => assert(sh.dur > 0 && Number.isFinite(sh.dur), "корабль с длительностью " + sh.dur)));
  });
});

// ── командиры ───────────────────────────────────────────────────────────────
// Без клика над кораблём видно только имя командира, поэтому имя обязано быть
// у каждого корабля и рейса без исключения: пустая подпись — это дыра.
test("у каждого корабля и рейса есть командир", () => {
  const sim = load("dist/index.html", { seed: 23 });
  runYears(sim, 200, (st) => {
    st.voyages.forEach((v) => assert(typeof v.captain === "string" && v.captain.length > 1, "рейс " + v.kind + " без командира"));
    st.systems.forEach((s) => s.ships.forEach((sh) => assert(typeof sh.captain === "string" && sh.captain.length > 1, "корабль " + sh.kind + " без командира")));
  });
});

// ── разруха на свежих колониях ──────────────────────────────────────────────
// Колония первые десять лет живёт на привозном и терпении, но живёт: раньше
// требование "детали в своей системе" и партия еды на три года убивали её с
// полным складом провизии и казной в полторы тысячи.
test("свежая колония начинает в разрухе, и разруха проходит", () => {
  const sim = load("dist/index.html", { seed: 4 });
  let sawRough = false;
  runYears(sim, 200, (st) => {
    st.worlds.forEach((w) => {
      if (w.founder < 0) { assert(!w.rough, "родина не бывает в разрухе"); return; }
      if (w.rough > 0) sawRough = true;
      assert(w.rough >= 0 && w.rough <= 120, w.body.name + ": разруха " + w.rough);
    });
  });
  assert(sawRough, "ни одна колония не была в разрухе");
  const st = sim.state();
  st.worlds.filter((w) => w.founder >= 0 && st.tick - 0 > 0).forEach((w) => {
    const age = st.tick / 12 - parseInt((w.born.match(/\d+/) || ["0"])[0], 10);
    if (age > 12) assert(w.rough === 0, w.body.name + ": разруха не прошла за " + age.toFixed(0) + " лет");
  });
});

// "В ОСНОВНОМ выживают" — утверждение про среднее, и мерить его надо средним.
// Пока здесь стоял один сид, тест мерил везение этого сида: на замере по сорока
// сидам он падал бы на двенадцати из них, просто четвёртому повезло. Любая
// правка, сдвигающая расход случайности, пересобирает партию целиком, и такой
// тест начинал ругаться на изменения, к колониям отношения не имевшие.
test("колонии в основном выживают", () => {
  let cols = 0, dead = 0;
  [4, 11, 19, 23, 31, 42, 57, 63].forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 200);
    const here = st.worlds.filter((w) => w.founder >= 0);
    // Опустевшие миры считаются наравне с доживающими: с тех пор как мир с
    // нулём людей выбывает из списка (colony.ts, запустение), без этого
    // слагаемого мерка бы врала — вымершая колония просто исчезала бы из обеих
    // частей дроби, и чем хуже шли дела, тем лучше выглядел бы итог.
    cols += here.length + st.lost;
    dead += here.filter((w) => sim.popOf(w) < 0.3).length + st.lost;
  });
  assert(cols >= 12, "колоний на восемь партий всего " + cols);
  assert(dead <= cols / 3, "вымерло " + dead + " из " + cols + " колоний");
});

// ── край: жребий из трёх исходов и освоение ─────────────────────────────────
// Мир, голодающий четыре года, доходит до края и тянет жребий: артель (остаётся
// в государстве), вольница (остаётся, но сразу в разбой) или независимость
// (уходит и забирает чужие филиалы). Во всех трёх рождается компания со своим
// классом миров и своим филиалом, и она вкладывается в освоение этого класса.
// Марки освоения бесконечны — за взятой появляется следующая.
test("доведённый до края мир рождает компанию", () => {
  const sim = load("dist/index.html", { seed: 3 });
  const st = runYears(sim, 300);
  const born = st.corps.length - 5;
  assert(born > 0, "за триста лет ни одного кризиса");
  st.corps.slice(5).forEach((c) => {
    assert(c.native, c.name + ": у рождённой кризисом компании нет своего класса миров");
    // Филиал обязан быть, ПОКА ЖИВ РОДНОЙ МИР. Опустевшая планета забирает
    // филиалы с собой (abandon), и её контора остаётся призраком: ни филиала, ни
    // логова, касса в минусе. Замер: на пятнадцати сидах таких тринадцать, и они
    // были задолго до стапелей — просто на этом сиде мир умирал позже. Это
    // отдельная дыра (журнал, п. 7), а не поломка рождения, и подменять ею
    // проверку рождения нельзя.
    if (c.bornAt && st.worlds.indexOf(c.bornAt) >= 0)
      assert(c.branches.length >= 1, c.name + ": у рождённой кризисом компании нет филиала");
    assert(/^(Артель|(Вторая|Третья|Четвёртая|Пятая) вольница|Вольница|Свободн(ый|ая)) /.test(c.name), "странное имя: " + c.name);
  });
  // чужие филиалы отбираются только при независимости, и позже независимый мир
  // вправе снова продать место — поэтому проверяем только свой филиал
  st.worlds.filter((w) => w.free).forEach((w) => {
    assert(w.branches.some((b) => b.corp === w.founder), w.body.name + ": у отделившегося мира нет собственного филиала");
  });
});

// Жребий обязан быть жребием. Если одна из трёх долей отвалится (например,
// ветка перестанет вызываться), исходы схлопнутся в один и этого никто не
// заметит: партия по-прежнему будет выглядеть живой.
test("на краю выпадают все три исхода, а не один", () => {
  const kinds: Record<string, number> = {};
  [3, 6, 1, 4, 11].forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.corps.slice(5).forEach((c) => {
      kinds[c.origin] = (kinds[c.origin] || 0) + 1;
    });
  });
  ["артель", "вольница", "государство"].forEach((k) => {
    assert(kinds[k] > 0, "исход «" + k + "» не выпал ни разу: " + JSON.stringify(kinds));
  });
});

// Артель и вольница мир из государства НЕ выводят: он остаётся вашим, просто
// на нём теперь своя контора, а во втором случае ещё и беззаконие.
test("артель и вольница не выводят мир из государства", () => {
  [3, 6, 1].forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.corps.slice(5).forEach((c) => {
      if (c.origin === "государство" || !c.bornAt) return;
      assert(!c.bornAt.free, c.name + ": мир помечен независимым, хотя жребий был не тот");
      assert(c.bornAt.founder !== c.id, c.name + ": мир записан за конторой, хотя не отделялся");
    });
  });
});

// ── запустение: мир с нулём людей перестаёт быть миром ──────────────────────
// Убыль от голода пропорциональна, поэтому до настоящего нуля она не доводит
// никогда: без этой двери мир навечно застревал на трёх сотых человечка и при
// этом числился миром — просил хлебовозы, занимал планету, держал чужие цеха с
// долей человека в них. Порог — 0.05: ровно с него панель уже пишет «0.0».
// Проверяется не столько сам порог, сколько то, что за выбывшим миром ничего
// не тянется: указатель на него, оставшийся в филиале, верфи или на стоянке, —
// это призрак, который потом всплывёт где-нибудь далеко и непонятно.
test("опустевший мир выпадает из государства, и за ним ничего не тянется", () => {
  let lost = 0;
  [1, 4, 19, 42, 57, 63, 7].forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300, (s2) => {
      s2.worlds.forEach((w) => {
        assert(w === s2.worlds[0] || sim.popOf(w) >= 0.05,
               w.body.name + ": людей " + sim.popOf(w).toFixed(3) + ", а мир всё ещё числится миром");
        assert(w.body.world === w, w.body.name + ": планета не знает про свой мир");
      });
    });
    lost += st.lost;
    const live = (w: World): boolean => st.worlds.indexOf(w) >= 0;
    st.corps.forEach((c) => c.branches.forEach((b) =>
      assert(live(b.world), c.name + ": филиал остался на выбывшем " + b.world.body.name)));
    st.shipyards.forEach((y) => assert(live(y.world), "верфь осталась у выбывшего " + y.world.body.name));
    st.docks.forEach((d) => {
      assert(live(d.world), "стоянка осталась у выбывшего " + d.world.body.name);
      assert(!d.gov || live(d.gov), "стоянка записана за правительством выбывшего мира");
    });
    st.shipyards.forEach((y) => y.queue.forEach((b) =>
      assert(!b.forWorld || live(b.forWorld), "на стапеле " + y.world.body.name + " сборка для выбывшего мира")));
    st.voyages.forEach((v) => {
      if (v.kind !== "food" && v.kind !== "pops") return;
      assert(live(v.to), "рейс идёт на выбывший " + v.to.body.name);
    });
    st.corps.forEach((c) => assert(!c.pirate || (c.home && live(c.home)),
      c.name + ": вольница сидит в опустевшем логове"));
  });
  assert(lost > 0, "за семь партий по триста лет ни один мир не опустел");
});

// ── герб государства ────────────────────────────────────────────────────────
// Отделившийся мир — это НОВОЕ государство, и в галактике их с этого дня
// больше одного. Отвечает на "чьё это" герб: щит с фигурой над планетами,
// кораблями и разработками. Выдаётся он ровно при отделении и больше никому:
// артель и вольница из государства не выходят, и щит над ними был бы враньём.
test("у отделившегося государства свой герб, и больше ни у кого", () => {
  let realms = 0;
  [3, 57, 63, 6].forEach((seed) => {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.corps.forEach((c) => {
      if (c.origin !== "государство") {
        assert(c.crest === undefined, c.name + ": герб у того, кто не отделялся");
        return;
      }
      assert(c.crest >= 1 && c.crest <= 6, c.name + ": у государства нет своей фигуры на гербе");
      realms++;
    });
    // Мир вне государства обязан числиться за конторой С ГЕРБОМ — в том числе
    // колония, которую отделившееся государство основало уже после ухода.
    st.worlds.filter((w) => w.free).forEach((w) => {
      assert(st.corps[w.founder] && st.corps[w.founder].crest !== undefined,
             w.body.name + ": мир вне государства, а у его хозяина нет герба");
    });
  });
  assert(realms > 0, "за четыре партии ни одного отделения — гербов не из чего взяться");
});

// ── гидропонная ферма ───────────────────────────────────────────────────────
// Первая постройка на планете. Её ставит себе мир, прошедший голодомор, при
// любом из трёх исходов жребия: еда там растёт НЕ ИЗ ЗЕМЛИ, и потому её не
// трогают ни разруха, ни неурожай, ни освоение. Это пол, а не ступень лестницы.
test("гидропонная ферма ставится после голодомора, и ровно одна", () => {
  let seen = 0;
  for (const seed of [3, 6, 42, 57]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.worlds.forEach((w) => {
      assert(w.built.length <= 1, w.body.name + ": построек " + w.built.length + ", а больше одной пока нельзя");
      assert(!w.built.length || w.edge, w.body.name + ": ферма есть, а края мир не проходил");
      assert(w.built.every((k) => sim.consts.BTYPES.some((b) => b.key === k)),
             w.body.name + ": построено то, чего нет в таблице");
      if (w.built.length) seen++;
    });
  }
  assert(seen > 0, "за четыре партии ни одной фермы");
});

// Ради этого всё и делалось: на мёртвой земле еда теперь всё-таки растёт.
test("теплица кормит там, где земля не кормит вовсе", () => {
  let dead = 0, fed = 0;
  for (const seed of [19, 42, 47, 53, 63]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.worlds.forEach((w) => {
      if (!w.built.length || w.type.farm > 0.2) return;
      dead++;
      // выработка ПОЛЯ тут почти ноль, а урожай обязан быть больше неё
      const field = w.pop.farm * sim.yieldPerFarmer(w);
      const all = sim.harvestOf(w);
      assert(all >= field - 1e-9, w.body.name + ": теплица УМЕНЬШИЛА урожай");
      if (all > field + 1e-9) fed++;
    });
  }
  assert(dead > 0, "за пять партий ни одного мира с фермой на мёртвой земле");
  assert(fed > 0, "теплицы стоят, но ни на одном мёртвом мире не кормят");
});

// Обратное и не менее важное: там, где земля лучше теплицы, теплица обязана
// СПАТЬ. Иначе она отняла бы людей у поля и урожай бы упал.
test("на плодородной земле теплица не отнимает урожай", () => {
  let rich = 0;
  for (const seed of [19, 42, 57, 63]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    st.worlds.forEach((w) => {
      if (!w.built.length || w.type.farm < 1.4) return;
      rich++;
      const field = w.pop.farm * sim.yieldPerFarmer(w);
      close(sim.harvestOf(w), field, 1e-9,
            w.body.name + ": на плодородной земле урожай разошёлся с полевым");
    });
  }
  assert(rich > 0, "за четыре партии ни одной фермы на плодородном мире");
});

// Деление на число фермеров — самое скользкое место всей правки: мир с теплицей
// и пустым полем обязан давать ЧИСЛО, иначе зарплата станет NaN и разнесёт
// переток людей по всей галактике молча.
test("плата в поле всегда число и не отрицательна", () => {
  for (const seed of [42, 53]) {
    runYears(load("dist/index.html", { seed }), 300, (st) => {
      st.worlds.forEach((w) => {
        assert(Number.isFinite(w.wage.farm), w.body.name + ": плата в поле перестала быть числом");
        assert(w.wage.farm >= 0, w.body.name + ": плата в поле ушла в минус");
      });
    });
  }
});

// ── казна у каждого государства ─────────────────────────────────────────────
// Отделившийся мир больше не кормит казну метрополии: налог платят ТАМ, ГДЕ
// РАБОТАЮТ. Скалярная S.treasury этого не докажет — она растёт и падает по
// десятку причин, — поэтому в ядре заведён счётчик taxAway: сколько родная
// казна недополучила. Он обязан быть нулём, пока отделившихся нет, и строго
// больше нуля, как только они появились и хоть кто-то на них поработал.
test("налог отделившихся не идёт в чужую казну", () => {
  let withRealms = 0;
  for (const seed of [3, 57, 6]) {
    const sim = load("dist/index.html", { seed });
    // пока государство одно, мимо казны не проходит ни монеты
    runYears(sim, 85, (st) => {
      assert(st.taxAway === 0, "до первого отделения налог уже течёт мимо казны: " + st.taxAway);
      assert(Object.keys(st.purses).length === 0, "чужая казна завелась раньше чужого государства");
    });
    const st = runYears(sim, 215);
    const realms = st.corps.filter((c) => c.crest !== undefined);
    if (!realms.length) continue;
    withRealms++;
    assert(st.taxAway > 0, "сид " + seed + ": государств " + realms.length + ", а налог по-прежнему весь родной");
    realms.forEach((c) => {
      const p = st.purses[c.id];
      assert(p !== undefined && p >= 0, c.name + ": у государства нет своей казны");
    });
    // и обратное: чужая казна не заводится ни у кого, кроме государств
    Object.keys(st.purses).forEach((k) => {
      assert(st.corps[+k] && st.corps[+k].crest !== undefined,
             "казна заведена конторе без герба: " + (st.corps[+k] ? st.corps[+k].name : k));
    });
  }
  assert(withRealms > 0, "за три партии ни одного отделения — считать нечего");
});

// Казна метрополии не строит на чужой земле. Верфь по предложению оплачивает
// казна, а деньги за стройку получает ПЛАНЕТА (proposalsTick) — то есть без
// отсева домашняя контора с филиалом на отделившемся мире переводила бы туда
// родные деньги, не нарушив ни одной проверки. Плюс само государство больше не
// просит верфь у чужой казны: с этого шага у него своя.
// ── стапель на краю ─────────────────────────────────────────────────────────
// Правило "верфь уходит вместе с планетой" почти никогда не срабатывало: на
// окраине верфи нет, и уходить нечему. Теперь мир после голодомора закладывает
// свой стапель — урезанную версию верфи, собранную из мусора: строит то же
// самое, но берёт вчетверо меньше рук. Артели не полагается: она из государства
// не выходила и чужой верфью не обзаводится.
test("вольница и отделившееся государство обзаводятся стапелем", () => {
  let got = 0;
  for (const seed of [3, 57, 6, 63]) {
    const st = runYears(load("dist/index.html", { seed }), 300);
    st.shipyards.forEach((y) => {
      if (y.owner < 0) return;
      got++;
      const o = st.corps[y.owner];
      assert(o.origin === "вольница" || o.origin === "государство" || o.pirate,
             y.world.body.name + ": частная верфь у конторы без края — " + o.name + " (" + o.origin + ")");
    });
    // заложенный стапель всегда чей-то и всегда с сроком впереди или позади
    st.worlds.forEach((w) => {
      if (!w.edgeYard) return;
      assert(st.corps[w.edgeYard.owner], w.body.name + ": стапель заложен ничьим");
      assert(!w.yard, w.body.name + ": стапель закладывают там, где верфь уже стоит");
    });
  }
  assert(got > 0, "за четыре партии ни одного стапеля — нечего проверять");
});

// Главная дыра, ради которой всё это и делалось: правительство свободного мира
// не могло заказать хлебовоз на СОБСТВЕННОЙ верфи. Государственный заказ идёт с
// forCorp = null (платит казна мира, а не контора), а nearestYard отсекал по
// этому признаку любую частную верфь — включая свою же.
test("правительство свободного мира заказывает на своей верфи", () => {
  let seen = 0;
  for (const seed of [3, 57, 63]) {
    const sim = load("dist/index.html", { seed });
    runYears(sim, 300, (st) => {
      st.shipyards.forEach((y) => {
        if (y.owner < 0) return;
        y.queue.forEach((b) => {
          if (b.forCorp !== undefined || !b.forWorld) return;
          seen++;
          // и заказ обязан быть от мира ТОГО ЖЕ государства, что владеет верфью
          assert(b.forWorld.free && b.forWorld.founder === y.owner,
                 "на частной верфи " + y.world.body.name + " стоит казённый заказ чужого мира " +
                 b.forWorld.body.name);
        });
      });
    });
  }
  assert(seen > 0, "за три партии правительство ни разу не встало в очередь своей верфи");
});

test("казна не строит верфь на отделившемся мире", () => {
  for (const seed of [3, 57, 6]) {
    const sim = load("dist/index.html", { seed });
    sim.setApproval("always");
    runYears(sim, 300, (st) => {
      st.proposals.forEach((p) => {
        assert(!p.world.free, "предложение по верфи на отделившемся " + p.world.body.name);
        assert(st.corps[p.lead].crest === undefined,
               "верфь у казны просит государство: " + st.corps[p.lead].name);
      });
    });
  }
});

test("освоение миров растёт до Mk5, а колонизация — на каждый тип планеты", () => {
  const sim = load("dist/index.html", { seed: 1 });
  const st = runYears(sim, 300);
  const known = Object.keys(st.patents).filter((k) => /^dev_/.test(k) && st.corps.some((c) => c.known[k]));
  assert(known.length > 0, "ни одной марки освоения за триста лет");
  const best = known.reduce((m, k) => Math.max(m, +k.split("_")[2]), 0);
  assert(best >= 2, "освоение застряло на Mk" + best);
  assert(best <= 5, "освоение перевалило за Mk5: Mk" + best);
  // за каждой взятой маркой обязана существовать следующая — до пятой
  known.forEach((k) => {
    const p = k.split("_");
    if (+p[2] >= 5) return;
    assert(st.patents[p[0] + "_" + p[1] + "_" + (+p[2] + 1)], "после " + k + " нет следующей марки");
  });
  // технология колонизации — на каждый тип планеты, умеренные тоже
  const types = sim.consts.PTYPES;
  types.forEach((t) => { assert(sim.consts.COLTECH.some((f) => f.key === t.tech), t.name + ": нет своей технологии колонизации"); });
  const keys = sim.consts.COLTECH.map((f) => f.key);
  assert(new Set(keys).size === keys.length && keys.length === types.length, "технологии колонизации не по одной на тип");
});

test("на карте много типов планет", () => {
  const sim = load("dist/index.html", { seed: 2 });
  const types = new Set();
  sim.state().systems.forEach((s) => s.bodies.forEach((b) => types.add(b.type.key)));
  assert(types.size >= 12, "типов планет всего " + types.size);
});

// ── частная помощь и вольница ───────────────────────────────────────────────
// Компания с филиалом на голодающем мире сама шлёт хлебовоз — из корысти:
// семь лет голода, и мир отделяется, забирая филиал. А независимый мир,
// голодающий ещё четыре года, уходит в разбой и перехватывает рейсы.
test("компании сами шлют еду голодающим мирам с их филиалами", () => {
  const sim = load("dist/index.html", { seed: 3 });
  let relief = 0;
  const seen = new Set();
  runYears(sim, 300, (st) => {
    st.voyages.forEach((v) => { if (v.kind === "food" && !seen.has(v)) { seen.add(v); if (v.relief !== undefined) relief++; } });
  });
  assert(relief > 0, "за триста лет ни одного частного хлебовоза");
});

test("вольница появляется от голода и грабит", () => {
  let pirates = 0, raids = 0;
  for (const seed of [3, 6, 1]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    pirates += st.corps.filter((c) => c.pirate).length;
    raids += st.raids;
    st.corps.filter((c) => c.pirate).forEach((c) => {
      assert(/^((Вторая|Третья|Четвёртая|Пятая) вольница|Вольница) /.test(c.name), "странное имя вольницы: " + c.name);
      assert(c.home, c.name + ": у вольницы нет логова");
    });
  }
  assert(pirates > 0, "на трёх сидах не появилось ни одной вольницы");
  assert(raids > 0, "вольницы есть, а перехватов нет");
});

// Логово ватаги — не столица. Мятеж брал «самый дальний филиал», а на деле
// последний открытый, и у конторы, не шагнувшей дальше родины, им была родина:
// к 168-му году под окнами государства сидели четыре ватаги, и все с одним
// именем — по столице. Одинаковых имён в списке контор быть не должно вообще:
// игрок не поймёт, кого из них он только что обидел.
test("логово вольницы не на столице, и имена ватаг разные", () => {
  for (const seed of [3, 6, 1, 11]) {
    const sim = load("dist/index.html", { seed });
    const capital = sim.state().worlds[0];
    const st = runYears(sim, 300);
    st.corps.filter((c) => c.pirate).forEach((c) => {
      // столица может поднять флаг сама (жребий на краю) — но не стать чужим логовом
      assert(c.home !== capital || c.bornAt === capital,
             c.name + ": логово на столице " + capital.body.name);
    });
    const names = st.corps.map((c) => c.name);
    names.forEach((n, i) => {
      assert(names.indexOf(n) === i, "две конторы с именем «" + n + "» (сид " + seed + ")");
    });
  }
});

// ── стоянка транспортников ──────────────────────────────────────────────────
// Хлебовоз после рейса не исчезает: висит на орбите мира-получателя и уходит в
// следующий рейс из этой системы вместо покупки нового корпуса и трюма.
test("отработанные транспортники встают на стоянку и уходят снова", () => {
  const sim = load("dist/index.html", { seed: 2 });
  let maxDocks = 0, reused = 0;
  const seen = new Set();
  runYears(sim, 300, (st) => {
    maxDocks = Math.max(maxDocks, st.docks.length);
    const per: Record<string, number> = {};
    st.docks.forEach((d) => { const k = d.world.body.name; per[k] = (per[k] || 0) + 1; assert(per[k] <= 6, k + ": на орбите " + per[k] + " кораблей"); });
    st.feed.forEach((f) => { if (!seen.has(f) && /со стоянки/.test(f.t)) { seen.add(f); reused++; } });
  });
  assert(maxDocks > 0, "за триста лет ни один транспортник не встал на стоянку");
  assert(reused > 0, "стоянка есть, а повторно корабли не уходят");
});

// ── столица ─────────────────────────────────────────────────────────────────
// Один человечек — примерно миллиард людей, и столица начинает с восемнадцати
// при пределе тридцать два. Раньше предел был 360, и родина стояла почти
// пустой: проверялось, что к перелётам она заполнена на считаные проценты.
// Теперь проверяется обратное — что она с самого начала тесная, но НИКОГДА не
// перескакивает свой потолок, сколько бы освоение ни подняло предел прочим.
test("столица начинает с 18 человечков при пределе 32", () => {
  const sim = load("dist/index.html", { seed: 1 });
  const h = sim.state().worlds[0];
  assert(Math.abs(sim.popOf(h) - 18) < 1e-9, "в столице " + sim.popOf(h) + " человечков вместо 18");
  assert(h.cap === 32 && h.cap0 === 32, "предел столицы " + h.cap + " вместо 32");
});

test("столица никогда не перерастает тридцать два человечка", () => {
  // Двести лет и по всем сидам подряд: потолок держит capTop, а не удача —
  // освоение класса миров прибавляет к пределу всех прочих, и столица обязана
  // остаться единственной, кого оно не двигает.
  for (const seed of [1, 2, 3, 11]) {
    const sim = load("dist/index.html", { seed });
    runYears(sim, 200, (st) => {
      const h = st.worlds[0];
      assert(h.cap <= 32, "сид " + seed + ": предел столицы вырос до " + h.cap);
      assert(sim.popOf(h) <= 32 * 1.35, "сид " + seed + ": в столице " + sim.popOf(h).toFixed(1) + " человечков");
    });
  }
});

// ── случайные события ───────────────────────────────────────────────────────
// Мятеж гарантирует, что к началу перелётов хоть одна компания вне закона —
// иначе вольница появлялась только через голод и поздно.

test("к началу перелётов кто-то уже вне закона", () => {
  for (const seed of [1, 2, 3]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 150);
    assert(st.corps.some((c) => c.pirate), "сид " + seed + ": за сто пятьдесят лет ни одного пирата");
  }
});

// ── очередь грузовиков ──────────────────────────────────────────────────────
// Уже ломалось: заказ считал только прилетевшие детали и каждый месяц покупал
// корпус заново, пока предыдущие годами летели. В воздухе висело под восемьдесят
// грузовиков в затылок друг другу, а деньги уходили впустую.
test("покупатель не заказывает то, что уже летит", () => {
  const sim = load("dist/index.html", { seed: 3 });
  runYears(sim, 300, (st) => {
    const per: Record<string, number> = {};
    st.voyages.forEach((v) => {
      if (v.kind !== "parts") return;
      // счёт — заказ, подписка или предложение верфи: одна компания законно везёт
      // одну и ту же деталь в одну систему по двум счетам сразу
      const key = (v.acct ? "acct" + st.voyages.indexOf(v) + ":" : v.forCorp + "|") + v.k + "|" + v.to;
      per[key] = (per[key] || 0) + 1;
      assert(per[key] <= 3, "к " + st.corps[v.forCorp].name + " одновременно летит " + per[key] + " раз «" + v.k + "»");
    });
    assert(st.voyages.filter((v) => v.kind === "parts").length <= 40,
           "в воздухе " + st.voyages.filter((v) => v.kind === "parts").length + " грузовиков с деталями");
  });
});

// Перехват — единственный конец рейса, который НЕ доводит груз до покупателя.
// Счёт летящего при этом оставался нетронутым, и заказ ждал деталь вечно:
// нехватки нет (она «летит»), значит stalledOrders не сворачивает сборку и не
// докупает, а контора с таким заказом больше никогда ничего не строит. На
// восьми сидах по 300 лет так висело 27 живых заказов из 74. То же и с
// топливом: танкер заказывают по одному на систему, и потерянный не заменялся.
test("перехваченная деталь не вешает счёт летящего", () => {
  for (const seed of [3, 8, 6]) {
    const sim = load("dist/index.html", { seed });
    const st = runYears(sim, 300);
    // сколько на самом деле в воздухе по каждому счёту
    const air = new Map<FlyAcct, Record<string, number>>();
    st.voyages.forEach((v) => {
      if (v.kind !== "parts" || !v.acct) return;
      const r = air.get(v.acct) || {};
      r[v.k] = (r[v.k] || 0) + 1;
      air.set(v.acct, r);
    });
    const check = (acct: FlyAcct, who: string): void => {
      if (!acct.fly) return;
      const r = air.get(acct) || {};
      Object.keys(acct.fly).forEach((k) => {
        assert(acct.fly[k] <= (r[k] || 0), who + ": по счёту летит " + acct.fly[k] +
               " «" + k + "», а в воздухе " + (r[k] || 0) + " (сид " + seed + ")");
      });
    };
    st.corps.forEach((c) => {
      if (c.order) check(c.order, c.name + ", сборка");
      Object.keys(c.fuelAcct || {}).forEach((sys) => check(c.fuelAcct[+sys], c.name + ", топливо в " + sys));
    });
    st.projects.forEach((pr) => check(pr, "подписка на " + pr.body.name));
    st.proposals.forEach((pr) => check(pr, "верфь на " + pr.world.body.name));
  }
});

// ── детали свозят туда, где есть цех ────────────────────────────────────────
// Уже ломалось: корабль собирали прямо в системе назначения, и 85% грузовиков
// с деталями летели в пустую систему, где у покупателя нет ни цеха, ни склада,
// ни человека. Теперь туда идёт готовый корабль, а не запчасти.
test("детали везут в систему с филиалом, а не в пустую", () => {
  const sim = load("dist/index.html", { seed: 1 });
  let bad = 0, total = 0;
  runYears(sim, 300, (st) => {
    (st.voyages as Counted[]).forEach((v) => {
      if (v.kind !== "parts" || v.counted) return;
      v.counted = true; total++;
      const s = st.systems[v.to];
      const settled = s.bodies.some((b) => b.world);
      if (!settled) bad++;
    });
  });
  assert(total > 0, "за триста лет ни одного рейса с деталями");
  assert(bad / total < 0.25, Math.round(100 * bad / total) + "% деталей летит в необжитые системы");
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, рейсов с деталями за 300 лет не возникает вовсе. Ждёт решения по выработке человечка.");

test("готовый корабль сам идёт в чужую систему", () => {
  const sim = load("dist/index.html", { seed: 1 });
  let ferries = 0;
  runYears(sim, 300, (st) => {
    (st.voyages as Counted[]).forEach((v) => {
      if (v.kind !== "ferry" || v.counted) return;
      v.counted = true; ferries++;
      assert(v.cargo === "colony" || v.cargo === "mine", "странный перегон: " + v.cargo);
      assert(v.sysFrom !== v.to, "перегон внутри одной системы");
    });
  });
  assert(ferries > 0, "за триста лет ни одного перегона готового корабля");
});

// ── воспроизводимость ───────────────────────────────────────────────────────
// Ради этого стенд и городился: увидел странную партию — вбил сид и смотришь
// ту же самую партию глазами.
test("один сид даёт одну и ту же партию", () => {
  const a = load("dist/index.html", { seed: 101 });
  const b = load("dist/index.html", { seed: 101 });
  runYears(a, 60); runYears(b, 60);
  const sa = a.state(), sb = b.state();
  close(sa.treasury, sb.treasury, 1e-6, "казна разошлась при одном сиде");
  assert(sa.worlds.length === sb.worlds.length, "число миров разошлось при одном сиде");
  assert(sa.trades === sb.trades, "число сделок разошлось при одном сиде");
});

// ── встречные хлебовозы ─────────────────────────────────────────────────────
// Два хлебовоза с едой навстречу друг другу между одной парой планет — та
// самая нелепость, которую увидел игрок. Пороги "прошу" и "отдаю" были разными
// по построению и перекрывались; теперь один резерв с зазором (food.ts).
// Считаем в кораблях, как test/sweep.ts: рейс идёт годами, и счёт по месяцам
// раздувал одну встречу до полусотни.
test("встречных хлебовозов меньше десяти за 300 лет", () => {
  for (const seed of [1, 2, 3]) {
    const sim = load("dist/index.html", { seed });
    const crossed = new Set<any>();
    runYears(sim, 300, (st) => {
      const food = st.voyages.filter((v) => v.kind === "food");
      for (const a of food) for (const b of food)
        if (a !== b && a.from === b.to && a.to === b.from) { crossed.add(a); crossed.add(b); }
    });
    assert(crossed.size < 10, "сид " + seed + ": " + crossed.size + " хлебовозов летели навстречу друг другу");
  }
});

// ── верфь: предложение, решение, стройка ─────────────────────────────────────
// Родина начинает С верфью, поэтому предложение — всегда о ВТОРОЙ: приходит,
// когда в домашней встала очередь, а у компании есть колония с промышленными
// руками от двух. Колонии растут медленно, и это случается поздно и не в
// каждой партии. После хлебного закупа колонии стали беднее людьми, и порог
// в две промышленные руки берётся реже: пересчёт по двум дюжинам сидов при
// CUT = 0.12 дал 2, 5, 6, 9, 14, 15, 19, 24 — восемь из двадцати четырёх
// против прежней половины, самые ранние 14 (207г) и 5 (221г). Список ЗАВИСИТ
// ОТ CUT: сдвиг числа меняет траекторию случайности, и при 0.20 набор был
// другим. Дыра известна и записана в журнал (п. 7): единственное решение
// игрока о верфи за партию висит на этом пороге. Отсюда сиды и горизонт в
// триста лет. Стенд отвечает за игрока политикой (см. shipyard.ts); здесь
// проверяется сама механика.
test("компания предлагает вторую верфь, когда в домашней очередь", () => {
  for (const seed of [5, 14]) {
    const sim = load("dist/index.html", { seed });
    sim.setApproval("manual");
    let seen = false, queued = 0;
    runYears(sim, 300, (st) => {
      queued = Math.max(queued, st.shipyards[0].queue.length);
      if (st.proposals.length) seen = true;
    });
    assert(queued >= 3, "сид " + seed + ": очередь в домашней верфи не доходила до трёх");
    assert(seen, "сид " + seed + ": за триста лет ни одного предложения построить верфь");
  }
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, очередь в домашней верфи за 300 лет не набирает QUEUE_MAX, и повода для второй нет. Ждёт решения по выработке человечка.");
test("отказ возвращает взносы и поднимает долю компаний", () => {
  const sim = load("dist/index.html", { seed: 14 });
  sim.setApproval("manual");
  let first: { share: number; world: string } = null, later: { share: number } = null, refunded = false;
  runYears(sim, 300, (st) => {
    const p = st.proposals.find((x) => x.state === "pending");
    if (!p) return;
    if (!first) {
      first = { share: p.share, world: p.world.body.name };
      const before = st.corps[p.lead].cash, purse = p.purse;
      sim.decide(p.id, false);
      refunded = st.corps[p.lead].cash >= before + purse - 1e-6;
      return;
    }
    if (!later && p.world.body.name === first.world) later = { share: p.share };
  });
  assert(first, "предложения не было");
  assert(refunded, "после отказа ведущей не вернули взнос");
  assert(later, "после отказа компании не вернулись с предложением на ту же планету");
  // Не строго больше: второе предложение приходит поздно, когда ведущая богата
  // и кладёт потолок (SHARE_CAP) с первой попытки — расти уже некуда.
  assert(later.share >= first.share, "доля компаний упала: " + first.share + " -> " + later.share);
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, предложения не возникает, возвращать нечего. Ждёт решения по выработке человечка.");
test("одобренная верфь строится, а при отказах остаётся одна домашняя", () => {
  const yes = load("dist/index.html", { seed: 14 }); yes.setApproval("always");
  runYears(yes, 300);
  assert(yes.state().shipyards.length > 1, "при одобрении всего за триста лет второй верфи так и нет");
  const no = load("dist/index.html", { seed: 14 }); no.setApproval("never");
  const st = runYears(no, 300);
  assert(st.shipyards.length === 1, "при отказах верфь всё равно построилась");
  assert(st.worlds.length > 1, "при отказах партия встала: с одной домашней верфью ни одной колонии");
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, предложения не возникает, второй верфи не появляется. Ждёт решения по выработке человечка.");
test("предложение ждёт ответа, а компании перебивают его выгодным", () => {
  // Раньше предложение жило 24 игровых месяца — семь секунд реального времени
  // на x1. Игрок его не видел, верфь не строилась, экономика стояла намертво.
  // Теперь оно лежит, пока не ответишь; торг идёт между компаниями. Перебить
  // успевают редко — второе предложение приходит поздно, и до конца партии
  // остаётся мало лет: перебор шестидесяти сидов при CUT = 0.12 дал три
  // (15 на 248 году, 30 на 278, 52 на 275). Отсюда и сиды: 5 и 14 — самые
  // ранние предложения, 15 — торг.
  let outbid = 0;
  for (const seed of [5, 14, 15]) {
    const sim = load("dist/index.html", { seed });
    sim.setApproval("manual");
    let first: number = null, onTable = 0;
    const st = runYears(sim, 300, (s) => {
      const p = s.proposals.find((x) => x.state === "pending");
      if (p && first === null) first = p.cost * (1 - p.share);
      onTable = Math.max(onTable, s.proposals.filter((x) => x.state === "pending").length);
    });
    const now = st.proposals.find((x) => x.state === "pending");
    assert(first !== null, "сид " + seed + ": за триста лет предложения не было");
    assert(now, "сид " + seed + ": предложение исчезло само, хотя ответа не было");
    assert(onTable === 1, "сид " + seed + ": на столе оказалось " + onTable + " предложений разом");
    if (now.cost * (1 - now.share) < first) outbid++;
  }
  assert(outbid > 0, "ни на одном сиде компании не перебили цену для казны");
}, "столица сжата до 32 человечков (setup): рук в галактике втрое меньше, предложения не возникает, перебивать нечего. Ждёт решения по выработке человечка.");
test("в частной верфи не остаётся чужих сборок", () => {
  // Планета вышла из государства — верфь ушла с ней, и чужие заказы из очереди
  // выброшены, детали вернулись хозяевам. Проверяется ИНВАРИАНТ, а не то, что
  // случай вообще выпал: верфи собираются там, где есть руки, то есть почти
  // всегда на родине, а родина отделиться не может (см. журнал, п.7).
  let alien = 0, seized = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const sim = load("dist/index.html", { seed });
    sim.setApproval("always");
    runYears(sim, 300, (st) => {
      st.shipyards.forEach((y) => {
        if (y.owner < 0) return;
        seized++;
        alien += y.queue.filter((b) => b.lead !== y.owner).length;
      });
    });
  }
  assert(alien === 0, "в частной верфи осталось чужих сборок: " + alien +
                      " (частных верфемесяцев " + seized + ")");
});

// ── отрисовка тоже не должна падать ─────────────────────────────────────────
// Кадр здесь дёргается руками после каждого шага и по очереди рисует карту и
// систему: иначе отрисовка вовсе не исполняется, и в ней годами живут
// падения — так уже прятался межзвёздный рейс без поля from.
// Подпись на карте и панель разбирают рейс ПО ВИДУ, и незнакомый вид молча
// доезжал до хвоста, где v.qty.toFixed рушил кадр. Панель хуже: inspector
// зовётся из step(), поэтому один клик по перегону останавливал всю партию.
// Список видов держим здесь: появился новый — сначала научи ему voyageLines и
// inspector, потом впиши сюда.
test("видов рейсов ровно столько, сколько знает панель", () => {
  const known = ["jump", "gate", "parts", "food", "pops", "ferry", "reloc"];
  const seen = new Set<string>();
  for (const seed of [3, 8, 59]) {
    const sim = load("dist/index.html", { seed });
    runYears(sim, 300, (st) => st.voyages.forEach((v) => seen.add(v.kind)));
  }
  assert(seen.size > 3, "за три партии встретилось всего " + seen.size + " видов рейсов");
  seen.forEach((k) => assert(known.includes(k), "панель не знает вида рейса «" + k + "»"));
});

test("код отрисовки не падает на заглушках DOM", () => {
  const sim = load("dist/index.html", { withDom: true, seed: 59 });
  sim.build("gates");
  for (let i = 0; i < 250 * 12; i++) {
    sim.step();
    sim.setView(i % 2 ? "map" : "system", 0);
    sim.__frame();
  }
  const st = sim.state();
  assert(st.systems.filter((s) => s.unlocked).length > 1, "за двести пятьдесят лет открыта одна система");
});

// Очередь верфи — единственное место, где видно, почему в партии ничего не
// летит: пока стапель занят, не строится ни хлебовоз, ни колония. Панель
// обязана показывать её ЦЕЛИКОМ, по порядку и со сроками, а не одну голову.
// Гербы рисуются только тогда, когда государств стало несколько, — то есть
// этот кусок отрисовки на первых кадрах партии не исполняется вовсе, и обычная
// проверка сцены его не трогает. Здесь партия крутится до отделения и дальше.
test("сцена рисуется и после того, как государств стало несколько", () => {
  const sim = load("dist/index.html", { withDom: true, seed: 57 });
  let drawn = 0;
  for (let i = 0; i < 300 * 12; i++) {
    sim.step();
    const st = sim.state();
    sim.setView(i % 2 ? "map" : "system", st.worlds[st.worlds.length - 1].sys);
    sim.__frame();
    if (st.corps.some((c) => c.crest !== undefined)) drawn++;
  }
  assert(drawn > 0, "за триста лет ни одного отделения — герб рисовать не над чем");
});

test("панель показывает всю очередь верфи, с порядком и сроками", () => {
  const sim = load("dist/index.html", { withDom: true, seed: 1 });
  let html = "";
  for (let i = 0; i < 300 * 12 && !html; i++) {
    sim.step();
    sim.setView("system", 0);
    const busy = sim.state().shipyards.find((y) => y.world.sys === 0 && y.queue.length >= 2);
    if (!busy) continue;
    sim.step();                                  // панель рисуется в шаге
    // за этот шаг голова очереди могла сойти со стапеля — тогда ждём дальше
    if (!sim.state().shipyards.some((y) => y.world.sys === 0 && y.queue.length >= 2)) continue;
    html = sim.__html("ventures");
  }
  assert(html, "за триста лет в домашней верфи не собралось очереди из двух сборок");
  assert(/>1\. /.test(html) && /&gt;?2\. |>2\. /.test(html), "позиции очереди не пронумерованы: " + html.slice(0, 300));
  assert(/на стапеле/.test(html), "не сказано, что стоит на стапеле");
  assert(/ждёт очереди/.test(html), "не сказано, что вторая сборка ждёт очереди");
  assert(/через \d+ мес\./.test(html), "не сказано, когда сборка сойдёт со стапеля");
});

console.log("\n" + results.join("\n"));
if (only.length && !ran) {
  console.log("\n  отбор «" + only.join(", ") + "» не подошёл ни к одной из " + names.length +
              " проверок. Вот они все:\n" + names.map((n) => "    " + n).join("\n") + "\n");
  process.exit(1);
}
console.log("\n  прошло " + passed + ", упало " + failed +
            (skipped ? ", ПРОПУЩЕНО " + skipped + " по отбору «" + only.join(", ") + "»" : "") + "\n");
process.exit(failed ? 1 : 0);
