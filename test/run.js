// Тесты прототипа. Запуск: node test/run.js
//
// Проверяют не красоту, а то, что экономика не рассыпается МОЛЧА. Каждая
// проверка стоит здесь потому, что соответствующая поломка уже случалась или
// случилась бы незаметно: в браузере такая ошибка выглядит как замерший экран
// или как правдоподобное, но неверное число в панели.

const { load } = require("./harness");

let failed = 0, passed = 0;
const results = [];

function test(name, fn) {
  try { fn(); passed++; results.push("  ок   " + name); }
  catch (e) { failed++; results.push("  ПЛОХО " + name + "\n         " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function close(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) throw new Error(msg + " (" + a.toFixed(3) + " против " + b.toFixed(3) + ")");
}

function runYears(sim, years, check) {
  for (let i = 0; i < years * 12; i++) {
    sim.step();
    if (check) check(sim.state(), i);
  }
  return sim.state();
}

// ── ядро запускается и не падает ────────────────────────────────────────────
test("ядро стартует без браузера", () => {
  const sim = load("threshold-market.html", { seed: 1 });
  const st = sim.state();
  assert(st.corps.length === 5, "должно быть пять компаний");
  assert(st.worlds.length === 1, "на старте освоена только Тира");
  assert(st.systems.length === 9, "девять систем");
});

test("двести лет без исключений", () => {
  const sim = load("threshold-market.html", { seed: 7 });
  runYears(sim, 200);
});

// ── население: сумма каст равна итогу ───────────────────────────────────────
// Уже ломалось: убыль вычиталась только из свободных, и когда безработных не
// оставалось, итог расходился с суммой по занятиям — панель начинала врать.
test("население неотрицательно и конечно", () => {
  const sim = load("threshold-market.html", { seed: 3 });
  runYears(sim, 120, (st) => {
    st.worlds.forEach((w) => {
      ["farm","prod","sci","free"].forEach((k) => {
        assert(Number.isFinite(w.pop[k]), "население " + k + " на " + w.body.name + " стало не числом");
        assert(w.pop[k] >= -1e-9, "отрицательное население " + k + " на " + w.body.name);
      });
    });
  });
});

test("мир не переполняется сверх предела навсегда", () => {
  const sim = load("threshold-market.html", { seed: 11 });
  const st = runYears(sim, 150);
  st.worlds.forEach((w) => {
    const total = sim.popOf(w);
    assert(total <= w.cap * 1.35, w.body.name + ": населения " + total.toFixed(1) + " при пределе " + w.cap);
  });
});

// ── деньги ──────────────────────────────────────────────────────────────────
test("касса и цены остаются числами", () => {
  const sim = load("threshold-market.html", { seed: 5 });
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
  const sim = load("threshold-market.html", { seed: 9 });
  const st = runYears(sim, 200);
  sim.consts.COMPS.forEach((f) => {
    const p = st.market[f.key].price;
    assert(p >= f.base * 0.34 && p <= f.base * 5.1, f.short + ": цена " + p.toFixed(1) + " вне коридора");
  });
});

test("склад деталей не уходит в минус", () => {
  const sim = load("threshold-market.html", { seed: 13 });
  runYears(sim, 150, (st) => {
    st.corps.forEach((c) => {
      Object.keys(c.stock).forEach((k) => {
        assert(c.stock[k] >= 0, c.name + ": отрицательный склад " + k);
        assert(Number.isInteger(c.stock[k]), c.name + ": дробная деталь " + k);
      });
    });
  });
});

// ── цеха не работают на пустой склад ────────────────────────────────────────
// Уже ломалось: к 29 году лежало 222 товара при нуле заказов, и весь труд
// планеты уходил в никуда.
test("склад не забивается деталями без спроса", () => {
  const sim = load("threshold-market.html", { seed: 17 });
  const st = runYears(sim, 120);
  st.corps.forEach((c) => {
    Object.keys(c.stock).forEach((k) => {
      assert(c.stock[k] <= 12, c.name + ": " + c.stock[k] + " штук «" + k + "» на складе — работа в пустоту");
    });
  });
});

// ── технологии, патенты, монополия ──────────────────────────────────────────
test("за сто лет осваивают хотя бы половину деталей", () => {
  const sim = load("threshold-market.html", { seed: 23 });
  const st = runYears(sim, 100);
  const known = sim.consts.COMPS.filter((f) => st.corps.some((c) => c.known[f.key])).length;
  assert(known >= 3, "освоено всего " + known + " деталей из " + sim.consts.COMPS.length);
});

test("патент даёт монополию на производство", () => {
  const sim = load("threshold-market.html", { seed: 29 });
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
      assert(c.stock[k] === 0, c.name + " делает «" + k + "» вопреки патенту " + st.corps[p.owner].name);
    });
  });
});

// ── рынок реально работает ──────────────────────────────────────────────────
test("к ста годам детали покупаются друг у друга", () => {
  const sim = load("threshold-market.html", { seed: 31 });
  const st = runYears(sim, 100);
  assert(st.trades > 0, "за сто лет ни одной сделки: рынок мёртв");
});

test("корабли собираются из чужих деталей", () => {
  const sim = load("threshold-market.html", { seed: 37 });
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
  const sim = load("threshold-market.html", { seed: 61 });
  const st = runYears(sim, 150);
  assert(st.refusals > 0, "за сто пятьдесят лет ни одного отказа: рычаг не работает");
});

test("отказ помнится годами, а не перерешается каждый месяц", () => {
  const sim = load("threshold-market.html", { seed: 67 });
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
  const sim = load("threshold-market.html", { seed: 71 });
  const st = runYears(sim, 200);
  assert(st.trades > 50, "всего " + st.trades + " сделок: рынок задушен отказами");
  assert(st.worlds.length > 1, "из-за отказов не основано ни одной колонии");
});

test("свёрнутая сборка возвращает детали на склад", () => {
  const sim = load("threshold-market.html", { seed: 73 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => {
      Object.keys(c.stock).forEach((k) => assert(c.stock[k] >= 0, c.name + ": отрицательный склад после отмены"));
    });
  });
});

// ── корабли долетают ────────────────────────────────────────────────────────
test("флот не зависает в пути", () => {
  const sim = load("threshold-market.html", { seed: 41 });
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
  const sim = load("threshold-market.html", { seed: 2 });
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
  const sim = load("threshold-market.html", { seed: 4 });
  const st = runYears(sim, 250);
  assert(st.movedPops > 0.5, "за двести пятьдесят лет переселено " + st.movedPops.toFixed(1) + " человечков");
});

test("за двести лет осваивают новые миры", () => {
  const sim = load("threshold-market.html", { seed: 43 });
  const st = runYears(sim, 200);
  assert(st.worlds.length > 1, "за двести лет не основано ни одной колонии");
});

test("бесплодные миры получают привозную еду", () => {
  const sim = load("threshold-market.html", { seed: 47 });
  const st = runYears(sim, 250);
  const barren = st.worlds.filter((w) => w.type.farm < 1 && w.founder >= 0);
  if (!barren.length) return;                       // в этой партии таких не колонизовали
  assert(st.shipped > 0, "есть бесплодные миры, но еда ни разу не возилась");
});

test("еда не берётся из ниоткуда", () => {
  const sim = load("threshold-market.html", { seed: 53 });
  runYears(sim, 150, (st) => {
    st.worlds.forEach((w) => {
      assert(w.food.stock >= -1e-9, w.body.name + ": отрицательный запас еды");
      assert(Number.isFinite(w.food.stock), w.body.name + ": запас еды стал не числом");
    });
  });
});

// ── воспроизводимость ───────────────────────────────────────────────────────
// Ради этого стенд и городился: увидел странную партию — вбил сейм и смотришь
// ту же самую партию глазами.
test("один сейм даёт одну и ту же партию", () => {
  const a = load("threshold-market.html", { seed: 101 });
  const b = load("threshold-market.html", { seed: 101 });
  runYears(a, 60); runYears(b, 60);
  const sa = a.state(), sb = b.state();
  close(sa.treasury, sb.treasury, 1e-6, "казна разошлась при одном сейме");
  assert(sa.worlds.length === sb.worlds.length, "число миров разошлось при одном сейме");
  assert(sa.trades === sb.trades, "число сделок разошлось при одном сейме");
});

// ── отрисовка тоже не должна падать ─────────────────────────────────────────
test("код отрисовки не падает на заглушках DOM", () => {
  const sim = load("threshold-market.html", { withDom: true, seed: 59 });
  runYears(sim, 40);
});

console.log("\n" + results.join("\n"));
console.log("\n  прошло " + passed + ", упало " + failed + "\n");
process.exit(failed ? 1 : 0);
