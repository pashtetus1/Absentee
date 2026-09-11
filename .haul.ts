// Насколько далеко возят детали и куда именно.
import { load } from "./test/harness.ts";
const file = process.argv[2] || "dist/index.html";
const N = +(process.argv[3] || 24);
const bag: Record<string, number[]> = { "jump→заселённая": [], "jump→пустая": [], "mine": [], "прочее": [] };
for (let seed = 1; seed <= N; seed++) {
  const sim = load(file, { seed });
  const seen = new Set<any>();
  for (let i = 0; i < 300 * 12; i++) {
    sim.step();
    const st = sim.state();
    (st.voyages as any[]).forEach((v) => {
      if (v.kind !== "parts" || seen.has(v)) return;
      seen.add(v);
      const a = st.systems[v.sysFrom], b = st.systems[v.to];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = st.corps[v.forCorp];
      const type = c && c.order ? c.order.type : "прочее";
      const settled = b.bodies.some((x: any) => x.world);
      const key = type === "jump" ? (settled ? "jump→заселённая" : "jump→пустая") : (type === "mine" ? "mine" : "прочее");
      bag[key].push(d);
    });
  }
}
const q = (a: number[], p: number) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : 0;
console.log("  куда                 рейсов   середина   худшие 10%   самый дальний");
Object.keys(bag).forEach((k) => {
  const a = bag[k];
  console.log("  " + k.padEnd(20) + String(a.length).padStart(6) +
    String(Math.round(q(a, 0.5))).padStart(11) + String(Math.round(q(a, 0.9))).padStart(13) +
    String(Math.round(q(a, 1))).padStart(16));
});
console.log("  (для сравнения: до первого кольца 38, до пятого 300; марка бьёт на 46-130)");
