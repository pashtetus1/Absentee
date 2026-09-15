// Куда на самом деле летят грузы с деталями и что в системе назначения.
import { load } from "./test/harness.ts";
const file = process.argv[2] || "dist/index.html";
const N = +(process.argv[3] || 24);
let tot = 0, noWorld = 0, bare = 0;
const byType: Record<string, number> = {}, badByType: Record<string, number> = {};
const per: number[] = [];
for (let seed = 1; seed <= N; seed++) {
  const sim = load(file, { seed });
  const seen = new Set<any>();
  let t = 0, b = 0;
  for (let i = 0; i < 300 * 12; i++) {
    sim.step();
    const st = sim.state();
    (st.voyages as any[]).forEach((v) => {
      if (v.kind !== "parts" || seen.has(v)) return;
      seen.add(v); t++; tot++;
      const c = st.corps[v.forCorp];
      const type = c && c.order ? c.order.type : "прочее";
      byType[type] = (byType[type] || 0) + 1;
      const s = st.systems[v.to];
      if (s.bodies.some((x: any) => x.world)) return;
      b++; noWorld++;
      badByType[type] = (badByType[type] || 0) + 1;
      if (!s.yards.length && !s.ventures.length && !s.mines) bare++;
    });
  }
  per.push(t ? Math.round(100 * b / t) : 0);
}
console.log("  грузов с деталями всего: " + tot + " за " + N + " партий");
console.log("  из них в систему без заселённой планеты: " + noWorld +
            " (" + Math.round(100 * noWorld / tot) + "%), из них в совсем пустую: " + bare);
console.log("  по типу заказа — всего / из них в незаселённую:");
Object.keys(byType).sort().forEach((k) =>
  console.log("    " + k.padEnd(10) + String(byType[k]).padStart(6) + " / " + String(badByType[k] || 0).padStart(5)));
console.log("  по партиям, %: " + per.join(" "));
