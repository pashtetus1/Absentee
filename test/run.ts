// Тесты прототипа. Запуск: node test/run.js
//
// Проверяют не красоту, а то, что экономика не рассыпается МОЛЧА. Каждая
// проверка стоит здесь потому, что соответствующая поломка уже случалась или
// случилась бы незаметно: в браузере такая ошибка выглядит как замерший экран
// или как правдоподобное, но неверное число в панели.

import { load } from "./harness.ts";

import type { Corp, Pop, Snapshot, Voyage } from "../src/types.ts";

// Тесты метят уже посчитанные рейсы, чтобы один и тот же не попал в счёт
// дважды. Пометка нужна только здесь, поэтому и живёт здесь, а не в типах
// ядра: домену про неё знать незачем.
type Counted = Voyage & { counted?: boolean };

let failed = 0, passed = 0;
const results: string[] = [];

// pending — тест ЖДЁТ правки, которая ещё не сделана: падение не считается
// провалом, а печатается с причиной. Гоняется всё равно, и когда пройдёт —
// скажет об этом, чтобы пометку сняли, а не забыли.
function test(name: string, fn: () => void, pending?: string): void {
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

test("переселение случается", () => {
  const sim = load("dist/index.html", { seed: 4 });
  const st = runYears(sim, 250);
  assert(st.movedPops > 0.5, "за двести пятьдесят лет переселено " + st.movedPops.toFixed(1) + " человечков");
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

// ── три способа межзвёздного перехода ───────────────────────────────────────
// Способ выпадает партии один и случайно. Каждый обязан доводить партию до
// расселения — иначе на трети сидов игра просто стоит.
["drives", "opener", "gates"].forEach((mode) => {
  test("способ «" + mode + "»: системы открываются", () => {
    const sim = load("dist/index.html", { seed: 83 });
    sim.build(mode);
    const st = runYears(sim, 250);
    assert(st.move.key === mode, "режим не установился");
    const open = st.systems.filter((s) => s.unlocked).length;
    assert(open > 1, "за двести пятьдесят лет открыта одна система: экспансия стоит");
  });
});

test("под воротами хлебовоз летает только между воротами", () => {
  const sim = load("dist/index.html", { seed: 89 });
  sim.build("gates");
  runYears(sim, 200, (st) => {
    st.voyages.forEach((v) => {
      if (v.kind === "food" || v.kind === "pops") {
        if (v.from.sys === v.to.sys) return;
        assert(st.systems[v.from.sys].gate.built && st.systems[v.to.sys].gate.built,
               "рейс между системами без ворот");
      }
    });
  });
});

test("под порталооткрывателями рейсы идут только по прожжённым проходам", () => {
  const sim = load("dist/index.html", { seed: 97 });
  sim.build("opener");
  runYears(sim, 200, (st) => {
    st.voyages.forEach((v) => {
      if (v.kind !== "food" && v.kind !== "pops") return;
      if (v.from.sys === v.to.sys) return;
      // проходы складываются в сеть, поэтому маршрут может идти в несколько
      // прыжков — проверяем связность по прожжённым, а не прямой отрезок
      // линий на карте больше нет: сеть складывается из прожжённых проходов,
      // поэтому связность ищем прямо по ним
      const seen = new Set([v.from.sys]), q = [v.from.sys];
      let ok = false;
      while (q.length && !ok) {
        const i = q.shift();
        if (i === v.to.sys) { ok = true; break; }
        Object.keys(st.routes).forEach((k) => {
          const p = k.split("-").map(Number);
          const n = p[0] === i ? p[1] : p[1] === i ? p[0] : null;
          if (n === null || seen.has(n)) return;
          seen.add(n); q.push(n);
        });
      }
      assert(ok, "рейс туда, куда нет цепочки прожжённых проходов");
    });
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
      assert(v.parts.some((p) => p.k === "drive"), "межзвёздный рейс без двигателя на борту");
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

test("звёзды стоят не по кольцам", () => {
  const sim = load("dist/index.html", { seed: 5 });
  const S = sim.state().systems, home = S[0];
  const rs = S.slice(1).map((s) => Math.hypot(s.x - home.x, s.y - home.y));
  // у ровных колец радиусы сбиваются в несколько значений; проверяем, что
  // соседние по величине радиусы не повторяются пачками
  rs.sort((a, b) => a - b);
  let same = 0;
  for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i] - rs[i - 1]) < 4) same++;
  assert(same < rs.length * 0.5, "радиусы слипаются в кольца: " + same + " из " + rs.length);
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
});

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

test("колонии в основном выживают", () => {
  const sim = load("dist/index.html", { seed: 4 });
  const st = runYears(sim, 200);
  const cols = st.worlds.filter((w) => w.founder >= 0);
  const dead = cols.filter((w) => sim.popOf(w) < 0.3).length;
  assert(cols.length >= 3, "колоний всего " + cols.length);
  assert(dead <= Math.max(1, Math.floor(cols.length / 3)), "вымерло " + dead + " из " + cols.length + " колоний");
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
    assert(c.branches.length >= 1, c.name + ": у рождённой кризисом компании нет филиала");
    assert(/^(Артель|Вольница|Свободн(ый|ая)) /.test(c.name), "странное имя: " + c.name);
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

test("освоение миров растёт без предела", () => {
  const sim = load("dist/index.html", { seed: 1 });
  const st = runYears(sim, 300);
  const known = Object.keys(st.patents).filter((k) => /^dev_/.test(k) && st.corps.some((c) => c.known[k]));
  assert(known.length > 0, "ни одной марки освоения за триста лет");
  const best = known.reduce((m, k) => Math.max(m, +k.split("_")[2]), 0);
  assert(best >= 2, "освоение застряло на Mk" + best);
  // за каждой взятой маркой обязана существовать следующая
  known.forEach((k) => {
    const p = k.split("_");
    assert(st.patents[p[0] + "_" + p[1] + "_" + (+p[2] + 1)], "после " + k + " нет следующей марки");
  });
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
      assert(/^Вольница /.test(c.name), "странное имя вольницы: " + c.name);
      assert(c.home, c.name + ": у вольницы нет логова");
    });
  }
  assert(pirates > 0, "на трёх сидах не появилось ни одной вольницы");
  assert(raids > 0, "вольницы есть, а перехватов нет");
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

// ── случайные события ───────────────────────────────────────────────────────
// Родина огромна и почти пуста: к открытию межзвёздных перелётов заполнена на
// считаные проценты. А мятеж гарантирует, что к началу перелётов хоть одна
// компания вне закона — иначе вольница появлялась только через голод и поздно.
test("к открытию перелётов родина заполнена на проценты, а не наполовину", () => {
  // Двести лет, а не полтораста: замер по восьми сидам показал, что переход
  // открывается с 90-го по 162-й год, и прежнее окно стало впритык. Проверяется
  // здесь не срок, а заполненность родины В МОМЕНТ открытия — она и осталась.
  const sim = load("dist/index.html", { seed: 1 });
  let fillAtOpen: number = null;
  runYears(sim, 200, (st) => {
    if (fillAtOpen === null && st.systems.filter((s) => s.unlocked).length > 1) {
      const h = st.worlds[0];
      fillAtOpen = sim.popOf(h) / h.cap;
    }
  });
  assert(fillAtOpen !== null, "за двести лет перелёты не открылись");
  assert(fillAtOpen < 0.15, "родина заполнена на " + Math.round(fillAtOpen * 100) + "% к открытию перелётов");
});

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
});

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
// Первое место в игре, где игрок решает прямо. Стенд отвечает за него политикой
// (см. shipyard.ts); здесь проверяется сама механика.
test("компания предлагает верфь, когда ей негде строить", () => {
  const sim = load("dist/index.html", { seed: 1 });
  sim.setApproval("manual");
  let seen = false;
  runYears(sim, 40, (st) => { if (st.proposals.length) seen = true; });
  assert(seen, "за сорок лет ни одного предложения построить верфь");
});

test("отказ возвращает взносы и поднимает долю компаний", () => {
  const sim = load("dist/index.html", { seed: 1 });
  sim.setApproval("manual");
  let first: { share: number; world: string } = null, later: { share: number } = null, refunded = false;
  runYears(sim, 120, (st) => {
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
  assert(later.share > first.share, "доля компаний не выросла: " + first.share + " -> " + later.share);
});

test("одобренная верфь строится, а при отказах партия не встаёт", () => {
  const yes = load("dist/index.html", { seed: 1 }); yes.setApproval("always");
  runYears(yes, 150);
  assert(yes.state().shipyards.length > 0, "при одобрении всего за 150 лет ни одной верфи");
  const no = load("dist/index.html", { seed: 1 }); no.setApproval("never");
  const st = runYears(no, 150);
  assert(st.shipyards.length === 0, "при отказах верфь всё равно построилась");
  assert(st.corps.some((c) => Object.keys(c.known).length > 0), "при отказах партия встала: никто ничего не освоил");
});

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

test("предложение ждёт ответа, а компании перебивают его выгодным", () => {
  // Раньше предложение жило 24 игровых месяца — семь секунд реального времени
  // на x1. Игрок его не видел, верфь не строилась, экономика стояла намертво.
  // Теперь оно лежит, пока не ответишь; торг идёт между компаниями.
  for (const seed of [1, 2, 3]) {
    const sim = load("dist/index.html", { seed });
    sim.setApproval("manual");
    let first: number = null, onTable = 0;
    const st = runYears(sim, 200, (s) => {
      const p = s.proposals.find((x) => x.state === "pending");
      if (p && first === null) first = p.cost * (1 - p.share);
      onTable = Math.max(onTable, s.proposals.filter((x) => x.state === "pending").length);
    });
    const now = st.proposals.find((x) => x.state === "pending");
    assert(first !== null, "сид " + seed + ": за двести лет предложения не было");
    assert(now, "сид " + seed + ": предложение исчезло само, хотя ответа не было");
    assert(onTable === 1, "сид " + seed + ": на столе оказалось " + onTable + " предложений разом");
    assert(now.cost * (1 - now.share) < first,
           "сид " + seed + ": компании не перебили цену для казны (" + Math.round(first) + ")");
  }
});

// ── отрисовка тоже не должна падать ─────────────────────────────────────────
// Кадр здесь дёргается руками после каждого шага и по очереди рисует карту и
// систему: иначе отрисовка вовсе не исполняется, и в ней годами живут
// падения — так уже прятался рейс открывателя без поля from.
test("код отрисовки не падает на заглушках DOM", () => {
  const sim = load("dist/index.html", { withDom: true, seed: 59 });
  sim.build("opener");
  for (let i = 0; i < 250 * 12; i++) {
    sim.step();
    sim.setView(i % 2 ? "map" : "system", 0);
    sim.__frame();
  }
  const st = sim.state();
  assert(st.systems.filter((s) => s.unlocked).length > 1, "за двести пятьдесят лет открыта одна система");
});

console.log("\n" + results.join("\n"));
console.log("\n  прошло " + passed + ", упало " + failed + "\n");
process.exit(failed ? 1 : 0);
