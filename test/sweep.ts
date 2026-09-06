// Прогон многих партий параллельно со сводкой по балансу.
//
//     node test/sweep.ts                      100 партий по 300 лет, dist/index.html
//     node test/sweep.ts dist/index.html 500  500 партий
//     node test/sweep.ts old.html 100 8       файл, партий, процессов
//
// Журнал (п.11) требует мерить баланс прогонами, а не глазами: числа несколько
// раз опровергали ощущения. Один поток тянет ~140 мкс на месяц, сто партий по
// 300 лет — минута с лишним. Здесь сиды режутся на части по числу ядер, и та же
// сотня идёт секунд за двенадцать. Потолок — физические ядра, не логические:
// нагрузка счётная, гипертрединг ничего не добавляет.
//
// Что считается на 300-м году каждой партии: миров, людей, голодающих; всего
// хлебовозов и сколько из них летели НАВСТРЕЧУ другому хлебовозу (A везёт еду
// в B, пока B везёт еду в A) — это и есть нелепость, которую ловим. Мера в
// кораблях, а не в месяцах: рейс идёт годами, и счёт по месяцам раздувал одну
// встречу до полусотни.

import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";

import { load } from "./harness.ts";

import type { ApproveMode } from "../src/types.ts";

interface Game { seed: number; worlds: number; pop: number; hungry: number; food: number; crossed: number; }
interface Tally {
  games: number; worlds: number; pop: number; hungry: number;
  food: number; crossed: number; pairs: string[]; each: Game[];
}

const YEARS = 300;

// ---- работник: свои сиды, ответ одной строкой JSON ------------------------
function work(file: string, seeds: number[], approve?: ApproveMode): Tally {
  const t: Tally = { games: seeds.length, worlds: 0, pop: 0, hungry: 0, food: 0, crossed: 0, pairs: [], each: [] };
  for (const seed of seeds) {
    const sim = load(file, { seed });
    if (approve) sim.setApproval(approve);
    const seen = new Set<any>(), crossed = new Set<any>();
    for (let i = 0; i < YEARS * 12; i++) {
      sim.step();
      const food = sim.state().voyages.filter((v) => v.kind === "food");
      food.forEach((v) => seen.add(v));
      for (const a of food) for (const b of food) {
        if (a === b || a.from !== b.to || a.to !== b.from) continue;
        crossed.add(a); crossed.add(b);
        const key = seed + ": " + [a.from.body.name, a.to.body.name].sort().join(" <-> ");
        if (!t.pairs.includes(key)) t.pairs.push(key);
      }
    }
    const st = sim.state();
    const g: Game = {
      seed, worlds: st.worlds.length,
      hungry: st.worlds.filter((w) => w.food.short > 2).length,
      pop: st.worlds.reduce((a, w) => a + w.pop.farm + w.pop.prod + w.pop.sci + w.pop.free, 0),
      food: seen.size, crossed: crossed.size
    };
    t.each.push(g);
    t.worlds += g.worlds; t.hungry += g.hungry; t.pop += g.pop; t.food += g.food; t.crossed += g.crossed;
  }
  return t;
}

// ---- раздатчик: режет сиды, собирает ответы --------------------------------
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") { console.log(JSON.stringify(work(argv[1], argv[2].split(",").map(Number), argv[3] as ApproveMode))); return; }

  const file = argv[0] || "dist/index.html";
  const total = +(argv[1] || 100);
  const jobs = Math.min(+(argv[2] || cpus().length), total);
  // политика одобрения: random по умолчанию; always/never показывают, что
  // теряет государство, которое всё принимает или всё отклоняет
  const approve = (argv[3] || "random") as ApproveMode;
  const self = fileURLToPath(import.meta.url);

  const shards: number[][] = Array.from({ length: jobs }, (): number[] => []);
  for (let s = 1; s <= total; s++) shards[(s - 1) % jobs].push(s);

  const started = Date.now();
  const parts = await Promise.all(shards.map((s) => new Promise<Tally>((res, rej) =>
    execFile(process.execPath, [self, "--worker", file, s.join(","), approve], { maxBuffer: 1 << 26 },
      (e, out) => e ? rej(e) : res(JSON.parse(out))))));

  const sum = (k: keyof Tally) => parts.reduce((a, p) => a + (p[k] as number), 0);
  const pairs = new Set<string>(); parts.forEach((p) => p.pairs.forEach((x) => pairs.add(x)));
  const n = sum("games"), food = sum("food"), crossed = sum("crossed");

  const each = parts.flatMap((p) => p.each).sort((a, b) => a.seed - b.seed);
  const clean = each.filter((g) => g.crossed === 0).length;

  console.log(file + " · " + n + " партий по " + YEARS + " лет · предложения: " + approve + " · " + ((Date.now() - started) / 1000).toFixed(1) + " с");
  console.log("");
  // при малом числе партий — каждая строкой: так виден разброс, а не только среднее
  if (n <= 16) {
    console.log("  сид  планет   людей   голодают   хлебовозов   из них навстречу");
    each.forEach((g) => console.log(
      "  " + String(g.seed).padStart(3) + String(g.worlds).padStart(8) + String(Math.round(g.pop)).padStart(8) +
      String(g.hungry).padStart(11) + String(g.food).padStart(13) + String(g.crossed).padStart(19)));
    console.log("");
  }
  console.log("  в среднем на партию: планет " + (sum("worlds") / n).toFixed(1) +
              ", людей " + (sum("pop") / n).toFixed(0) +
              ", голодают " + (sum("hungry") / n).toFixed(1) +
              ", хлебовозов " + (food / n).toFixed(0));
  console.log("  встречных хлебовозов за все партии: " + crossed +
              (crossed ? "  (в " + clean + " партиях из " + n + " — ни одного)" : ""));
}

main().catch((e) => { console.error(e); process.exit(1); });
