
// ===================== рычаги в localStorage =====================

import { L } from "./state";
import { techOf } from "./tech";

export const LSKEY = "threshold.worlds.levers";
export function saveLevers(): void {
  try { localStorage.setItem(LSKEY, JSON.stringify({ tax:L.tax, subKey:L.subKey, subYear:L.subYear, fee:L.tradeFee,
                                                     dole:L.dole, patTerm:L.patTerm, speed:L.speed })); } catch (e) {}
}
export function loadLevers(): void {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(LSKEY) || "null"); } catch (e) {}
  if (!v) return;
  if (typeof v.tax === "number" && v.tax >= 0 && v.tax <= 0.6) L.tax = v.tax;
  if (typeof v.subYear === "number" && v.subYear >= 0 && v.subYear <= 360) L.subYear = v.subYear;
  if (typeof v.fee === "number" && v.fee >= 0 && v.fee <= 0.4) L.tradeFee = v.fee;
  if (typeof v.dole === "number" && v.dole >= 0 && v.dole <= 3) L.dole = v.dole;
  if (typeof v.patTerm === "number" && v.patTerm >= 5 && v.patTerm <= 70) L.patTerm = v.patTerm;
  if (techOf(v.subKey)) L.subKey = v.subKey;
  if ([1, 2, 4, 10, 20].indexOf(v.speed) >= 0) L.speed = v.speed;
}

