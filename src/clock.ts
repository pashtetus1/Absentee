// Кадры идут шестьдесят раз в секунду, а тик — раз в месяц (300 мс на x1).
// Если считать положение прямо от t, корабль стоит и прыгает. Поэтому кадр
// рисует положение МЕЖДУ прошлым и нынешним t, по настенным часам: какая
// доля месяца уже прошла, на столько и продвинулся.

import { clamp } from "./util";

export let tickAt = 0, tickMs = 300;
export function markTick(): void { tickAt = Date.now(); }
export function setTickMs(ms: number): void { tickMs = ms; }
export function vis(o: { t: number; tp?: number }): number {
  const f = clamp((Date.now() - tickAt) / tickMs, 0, 1), tp = o.tp === undefined ? o.t : o.tp;
  return tp + (o.t - tp) * f;
}
