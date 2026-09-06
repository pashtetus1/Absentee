// Проверка честности переезда: два файла на одном сейме обязаны дать
// побитово одинаковую партию.
//
// Журнал, п.9: "старый и новый файл на одном сейме дают побитово одинаковую
// казну, сделки, миры и перехваты на 300 году". Раньше это делалось руками и
// поэтому делалось редко. Теперь так:
//
//     node test/compare.js старый.html dist/index.html
//
// Сравнивается не картинка, а слепок состояния: казна, счётчики, цены рынка,
// патенты, компании, миры, рейсы. Первое же расхождение печатается с адресом
// внутри слепка — этого хватает, чтобы понять, ЧТО разъехалось.

const { load } = require("./harness");

const SEEDS = [1, 7, 42];
const YEARS = 300;

// Слепок нарочно плоский: пары "адрес — число". Глубокое сравнение объектов
// спотыкается о цикл body.world -> w.body, а плоский список ещё и показывает
// место расхождения без раскопок.
function digest(st) {
  const out = [];
  const put = (k, v) => out.push([k, typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v]);

  put("tick", st.tick);
  put("treasury", st.treasury);
  ["trades","shipped","movedPops","refusals","dropped","hauled","burned","raids"].forEach((k) => put(k, st[k]));
  put("move", st.move && st.move.key);
  put("worlds", st.worlds.length);
  put("voyages", st.voyages.length);
  put("projects", st.projects.length);
  put("docks", st.docks.length);
  put("corps", st.corps.length);
  put("routes", Object.keys(st.routes).length);

  Object.keys(st.market).sort().forEach((k) => {
    put("market." + k + ".price", st.market[k].price);
    put("market." + k + ".last", st.market[k].last);
    put("market." + k + ".want", st.market[k].want);
    put("market." + k + ".stock", st.market[k].stock);
  });

  Object.keys(st.patents).sort().forEach((k) => {
    put("patent." + k + ".owner", st.patents[k].owner);
    put("patent." + k + ".since", st.patents[k].since);
  });

  st.corps.forEach((c, i) => {
    const at = "corp[" + i + "]";
    put(at + ".name", c.name);
    put(at + ".cash", c.cash);
    put(at + ".sold", c.sold);
    put(at + ".bought", c.bought);
    put(at + ".branches", c.branches.length);
    put(at + ".known", Object.keys(c.known).filter((k) => c.known[k]).sort().join(","));
    Object.keys(c.spent).sort().forEach((k) => put(at + ".spent." + k, c.spent[k]));
    Object.keys(c.stock).sort().forEach((sys) =>
      Object.keys(c.stock[sys]).sort().forEach((k) => put(at + ".stock." + sys + "." + k, c.stock[sys][k])));
  });

  st.worlds.forEach((w, i) => {
    const at = "world[" + i + "]";
    put(at + ".name", w.body.name);
    put(at + ".sys", w.sys);
    ["farm","prod","sci","free"].forEach((k) => put(at + ".pop." + k, w.pop[k]));
    put(at + ".food", w.food.stock);
    put(at + ".gov", w.gov.cash);
    put(at + ".branches", w.branches.length);
  });

  st.systems.forEach((s, i) => {
    put("sys[" + i + "].unlocked", !!s.unlocked);
    put("sys[" + i + "].mines", s.mines);
  });

  return out;
}

function run(file, seed) {
  const sim = load(file, { seed });
  for (let i = 0; i < YEARS * 12; i++) sim.step();
  return digest(sim.state());
}

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("нужно два файла: node test/compare.js A.html B.html"); process.exit(2); }

let bad = 0;
for (const seed of SEEDS) {
  const da = run(a, seed), db = run(b, seed);
  const diffs = [];
  const len = Math.max(da.length, db.length);
  for (let i = 0; i < len && diffs.length < 12; i++) {
    const ka = da[i], kb = db[i];
    if (!ka || !kb) { diffs.push("длина слепка разная: " + da.length + " против " + db.length); break; }
    if (ka[0] !== kb[0]) { diffs.push("разный состав: " + ka[0] + " против " + kb[0]); break; }
    if (ka[1] !== kb[1]) diffs.push("  " + ka[0] + ": " + ka[1] + " -> " + kb[1]);
  }
  if (diffs.length) { bad++; console.log("сейм " + seed + ": РАСХОЖДЕНИЕ"); diffs.forEach((d) => console.log(d)); }
  else console.log("сейм " + seed + ": совпадает (" + da.length + " значений на " + YEARS + " году)");
}
process.exit(bad ? 1 : 0);
