// Мелочи без памяти: чистые функции, которые нужны всем и не знают ни про
// состояние партии, ни про экран. Вынесены отдельно, чтобы модуль, которому
// нужен только clamp, не тянул за собой всё состояние.

export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
export function fmt(n: number): string { return n < 20 ? n.toFixed(1) : String(Math.round(n)); }
export function rnd6(): number { return Math.random() * 6.2832; }
export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
