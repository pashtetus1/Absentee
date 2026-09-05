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

// склад теперь с адресом: c.stock[система][деталь]
const stockOf = (c, k) => Object.values(c.stock).reduce((a, s) => a + (s[k] || 0), 0);
const eachStock = (c, fn) => Object.keys(c.stock).forEach((sys) =>
  Object.keys(c.stock[sys]).forEach((k) => fn(k, c.stock[sys][k], sys)));

function runYears(sim, years, check) {
  for (let i = 0; i < years * 12; i++) {
    sim.step();
    if (check) check(sim.state(), i);
  }
  return sim.state();
}

// ── ядро запускается и не падает ────────────────────────────────────────────
test("ядро стартует без браузера", () => {
  const sim = load("index.html", { seed: 1 });
  const st = sim.state();
  assert(st.corps.length === 5, "должно быть пять компаний");
  assert(st.worlds.length === 1, "на старте освоена только Тира");
  assert(st.systems.length === 50, "пятьдесят систем");
});

test("двести лет без исключений", () => {
  const sim = load("index.html", { seed: 7 });
  runYears(sim, 200);
});

// ── население: сумма каст равна итогу ───────────────────────────────────────
// Уже ломалось: убыль вычиталась только из свободных, и когда безработных не
// оставалось, итог расходился с суммой по занятиям — панель начинала врать.
test("население неотрицательно и конечно", () => {
  const sim = load("index.html", { seed: 3 });
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
  const sim = load("index.html", { seed: 11 });
  const st = runYears(sim, 150);
  st.worlds.forEach((w) => {
    const total = sim.popOf(w);
    assert(total <= w.cap * 1.35, w.body.name + ": населения " + total.toFixed(1) + " при пределе " + w.cap);
  });
});

// ── деньги ──────────────────────────────────────────────────────────────────
test("касса и цены остаются числами", () => {
  const sim = load("index.html", { seed: 5 });
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
  const sim = load("index.html", { seed: 9 });
  const st = runYears(sim, 200);
  sim.consts.COMPS.forEach((f) => {
    const p = st.market[f.key].price;
    assert(p >= f.base * 0.34 && p <= f.base * 5.1, f.short + ": цена " + p.toFixed(1) + " вне коридора");
  });
});

test("склад деталей не уходит в минус", () => {
  const sim = load("index.html", { seed: 13 });
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
  const sim = load("index.html", { seed: 17 });
  const st = runYears(sim, 120);
  st.corps.forEach((c) => {
    eachStock(c, (k, n, sys) => {
      assert(n <= 12, c.name + ": " + n + " штук «" + k + "» на складе в системе " + sys + " — работа в пустоту");
    });
  });
});

// ── технологии, патенты, монополия ──────────────────────────────────────────
test("за сто лет осваивают хотя бы половину деталей", () => {
  const sim = load("index.html", { seed: 23 });
  const st = runYears(sim, 100);
  const known = sim.consts.COMPS.filter((f) => st.corps.some((c) => c.known[f.key])).length;
  assert(known >= 3, "освоено всего " + known + " деталей из " + sim.consts.COMPS.length);
});

test("патент даёт монополию на производство", () => {
  const sim = load("index.html", { seed: 29 });
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
  const sim = load("index.html", { seed: 31 });
  const st = runYears(sim, 100);
  assert(st.trades > 0, "за сто лет ни одной сделки: рынок мёртв");
});

test("корабли собираются из чужих деталей", () => {
  const sim = load("index.html", { seed: 37 });
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
  const sim = load("index.html", { seed: 61 });
  const st = runYears(sim, 150);
  assert(st.refusals > 0, "за сто пятьдесят лет ни одного отказа: рычаг не работает");
});

test("отказ помнится годами, а не перерешается каждый месяц", () => {
  const sim = load("index.html", { seed: 67 });
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
  const sim = load("index.html", { seed: 71 });
  const st = runYears(sim, 200);
  assert(st.trades > 50, "всего " + st.trades + " сделок: рынок задушен отказами");
  assert(st.worlds.length > 1, "из-за отказов не основано ни одной колонии");
});

test("свёрнутая сборка возвращает детали на склад", () => {
  const sim = load("index.html", { seed: 73 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => {
      eachStock(c, (k, n) => assert(n >= 0, c.name + ": отрицательный склад " + k + " после отмены"));
    });
  });
});

// ── корабли долетают ────────────────────────────────────────────────────────
test("флот не зависает в пути", () => {
  const sim = load("index.html", { seed: 41 });
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
  const sim = load("index.html", { seed: 2 });
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
  const sim = load("index.html", { seed: 4 });
  const st = runYears(sim, 250);
  assert(st.movedPops > 0.5, "за двести пятьдесят лет переселено " + st.movedPops.toFixed(1) + " человечков");
});

test("за двести лет осваивают новые миры", () => {
  const sim = load("index.html", { seed: 43 });
  const st = runYears(sim, 200);
  assert(st.worlds.length > 1, "за двести лет не основано ни одной колонии");
});

test("бесплодные миры получают привозную еду", () => {
  const sim = load("index.html", { seed: 47 });
  const st = runYears(sim, 250);
  const barren = st.worlds.filter((w) => w.type.farm < 1 && w.founder >= 0);
  if (!barren.length) return;                       // в этой партии таких не колонизовали
  assert(st.shipped > 0, "есть бесплодные миры, но еда ни разу не возилась");
});

test("еда не берётся из ниоткуда", () => {
  const sim = load("index.html", { seed: 53 });
  runYears(sim, 150, (st) => {
    st.worlds.forEach((w) => {
      assert(w.food.stock >= -1e-9, w.body.name + ": отрицательный запас еды");
      assert(Number.isFinite(w.food.stock), w.body.name + ": запас еды стал не числом");
    });
  });
});

// ── три способа межзвёздного перехода ───────────────────────────────────────
// Способ выпадает партии один и случайно. Каждый обязан доводить партию до
// расселения — иначе на трети сеймов игра просто стоит.
["drives", "opener", "gates"].forEach((mode) => {
  test("способ «" + mode + "»: системы открываются", () => {
    const sim = load("index.html", { seed: 83 });
    sim.build(mode);
    const st = runYears(sim, 250);
    assert(st.move.key === mode, "режим не установился");
    const open = st.systems.filter((s) => s.unlocked).length;
    assert(open > 1, "за двести пятьдесят лет открыта одна система: экспансия стоит");
  });
});

test("под воротами хлебовоз летает только между воротами", () => {
  const sim = load("index.html", { seed: 89 });
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
  const sim = load("index.html", { seed: 97 });
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
  const sim = load("index.html", { seed: 103 });
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
  const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = load("index.html", { seed });
    const S = sim.state().systems;
    const R = sim.consts.MARKS[sim.consts.MARKS.length - 1].range;
    const seen = new Set([0]), q = [0];
    while (q.length) {
      const i = q.shift();
      S.forEach((s, j) => { if (!seen.has(j) && D(S[i], s) <= R) { seen.add(j); q.push(j); } });
    }
    assert(seen.size === S.length, "сейм " + seed + ": достижимо " + seen.size + " из " + S.length);
  }
});

test("звёзды стоят не по кольцам", () => {
  const sim = load("index.html", { seed: 5 });
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
  const sim = load("index.html", { seed: 7 });
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
  const sim = load("index.html", { seed: 3 });
  runYears(sim, 200, (st) => {
    st.projects.forEach((pr) => {
      assert((pr.wait || 0) < 90, "подписка на " + pr.body.name + " висит без движения " + pr.wait + " месяцев");
    });
    st.systems.forEach((s) => s.bodies.forEach((b) => {
      if (!b.claimed || b.world) return;
      const live = st.projects.some((pr) => pr.body === b);
      const flying = st.systems.some((sy) => sy.ships.some((sh) => sh.body === b)) ||
                     st.systems.some((sy) => sy.yards.some((y) => y.body === b));
      assert(live || flying, b.name + ": планета числится занятой, а взять её некому");
    }));
  });
});

test("распавшаяся подписка не съедает деньги вкладчиков", () => {
  const sim = load("index.html", { seed: 5 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => assert(Number.isFinite(c.cash) && c.cash >= -41, c.name + ": касса " + c.cash));
  });
});

// ── перевозка деталей, топливо, торг ────────────────────────────────────────
// Деталь лежит там, где сделана; в другую систему её ВЕЗУТ, и рейс жжёт
// межзвёздное топливо. Если это не происходит, значит склад опять общий на
// всю галактику и рынок телепортирует.
test("детали возят грузовиком, а не телепортируют", () => {
  const sim = load("index.html", { seed: 3 });
  const st = runYears(sim, 200);
  assert(st.hauled > 0, "за двести лет ни одного грузовика с деталями");
  assert(st.burned > 0, "топливо не сжигается: рейсы бесплатны");
});

test("грузовик с деталями долетает и отдаёт груз", () => {
  const sim = load("index.html", { seed: 5 });
  runYears(sim, 200, (st) => {
    st.voyages.forEach((v) => {
      if (v.kind !== "parts") return;
      assert(v.t <= 1.001, "грузовик пролетел мимо: t=" + v.t.toFixed(2));
      assert(typeof v.take === "function", "у грузовика нет получателя");
    });
  });
});

test("топлива на складах не бывает меньше нуля", () => {
  const sim = load("index.html", { seed: 7 });
  runYears(sim, 150, (st) => {
    st.corps.forEach((c) => eachStock(c, (k, n) => {
      if (k === "fuel" || k === "sfuel") assert(n >= 0, c.name + ": " + k + " ушло в минус");
    }));
  });
});

test("запросы продавцов остаются в коридоре торга", () => {
  const sim = load("index.html", { seed: 11 });
  runYears(sim, 200, (st) => {
    st.corps.forEach((c) => Object.keys(c.ask).forEach((k) => {
      assert(c.ask[k] >= 0.7 - 1e-9 && c.ask[k] <= 2.2 + 1e-9, c.name + ": запрос ×" + c.ask[k].toFixed(2) + " за " + k);
    }));
  });
});

test("торг не одинаков у всех: запросы расходятся", () => {
  const sim = load("index.html", { seed: 13 });
  const st = runYears(sim, 120);
  const asks = st.corps.map((c) => c.ask.hull);
  assert(Math.max(...asks) - Math.min(...asks) > 0.03, "все просят одно и то же: торга нет");
});

// ── воспроизводимость ───────────────────────────────────────────────────────
// Ради этого стенд и городился: увидел странную партию — вбил сейм и смотришь
// ту же самую партию глазами.
test("один сейм даёт одну и ту же партию", () => {
  const a = load("index.html", { seed: 101 });
  const b = load("index.html", { seed: 101 });
  runYears(a, 60); runYears(b, 60);
  const sa = a.state(), sb = b.state();
  close(sa.treasury, sb.treasury, 1e-6, "казна разошлась при одном сейме");
  assert(sa.worlds.length === sb.worlds.length, "число миров разошлось при одном сейме");
  assert(sa.trades === sb.trades, "число сделок разошлось при одном сейме");
});

// ── отрисовка тоже не должна падать ─────────────────────────────────────────
// Кадр здесь дёргается руками после каждого шага и по очереди рисует карту и
// систему: иначе отрисовка вовсе не исполняется, и в ней годами живут
// падения — так уже прятался рейс открывателя без поля from.
test("код отрисовки не падает на заглушках DOM", () => {
  const sim = load("index.html", { withDom: true, seed: 59 });
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
