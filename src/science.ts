// ===================== наука =====================

import { compOf, markOf } from "./data";
import { galaxyRange, rangeOf, within } from "./galaxy";
import { L, S, Y, anyKnows, corps, flash, knows, patLive, patents, say, systems, voyages } from "./state";
import { allTech, devOf, engOf, ensureDev, speedOf, techOf } from "./tech";
import type { Corp } from "./types";

export function sciOf(c: Corp): number{ return c.branches.reduce((a, b) => { return a + b.emp.sci; }, 0); }
export function prodOf(c: Corp): number{ return c.branches.reduce((a, b) => { return a + b.emp.prod; }, 0); }

export function pickTarget(c: Corp): string | null {
  let best = null, top = -1;
  allTech().forEach((f) => {
    if (knows(c, f.key)) return;
    let worth;
    if (markOf(f.key)) {
      // следующая марка стоит ровно столько, сколько звёзд она открывает
      // Сравнивать надо со СВОЕЙ дальностью, не с лучшей в галактике: чужой
      // патент на Mk1 не даёт тебе летать, а сравнение с ним гнало всех
      // исследовать Mk4 за 5800, пока ни один корабль не мог выйти из дома.
      const m = markOf(f.key), have = rangeOf(c);
      if (m.range <= have) return;                       // эту дальность уже имеем сами
      let gain = 0;
      systems.forEach((s) => {
        if (!s.unlocked) return;
        gain += within(s.id, m.range).filter((n) => { return !systems[n].unlocked; }).length;
      });
      worth = 1.2 + Math.min(12, gain) * 0.45;
    }
    else if (devOf(f.key)) {
      // освоение стоит столько, сколько у компании миров этого класса, и
      // особенно если они голодают; отделившейся колонии это всё, что нужно
      let d = devOf(f.key), mine = 0, starving = 0;
      c.branches.forEach((b) => {
        if (b.world.type.tech !== d.cls) return;
        mine++; if (b.world.food.short > 6) starving++;
      });
      if (!mine) return;
      worth = 0.8 + mine * 0.7 + starving * 1.2;
      if (c.native === d.cls) worth *= 4;                 // им нужно только это
    }
    else if (engOf(f.key)) {
      // ходовые двигатели ценны ровно настолько, насколько много всего летает
      const e = engOf(f.key);
      if (e.mult <= speedOf(c.id)) return;               // эту скорость уже имеем
      const traffic = voyages.length + systems.reduce((a, s) => { return a + s.ships.length; }, 0);
      worth = 1.1 + Math.min(10, traffic) * 0.22;
    }
    else if (f.key === "fuel") worth = 2.8;                              // без него не взлетает ничего
    else if (f.key === "sfuel") {
      // межзвёздное топливо дорожает в цене ровно тогда, когда есть чему лететь:
      // без него готовый прыжковый корабль стоял у стапеля девяносто лет
      const waiting = systems.some((s) => { return s.yards.some((y) => { return y.fuelWait > 0; }); });
      worth = waiting ? 4.5 : (galaxyRange() > 0 || anyKnows("drive") ? 3.2 : 1.2);
    }
    else if (compOf(f.key)) worth = f.key === "drive" ? 3.0 : (f.key === "drill" || f.key === "hold" ? 2.2 : 1.8);
    else {
      let free = 0;
      systems.forEach((s) => {
        if (!s.unlocked) return;
        s.bodies.forEach((b) => { if (!b.world && b.type.tech === f.key) free++; });
      });
      worth = free ? 1.6 + free * 0.5 : 0.2;
    }
    if (patLive(f.key)) worth *= markOf(f.key) ? 0.75 : 0.45;   // чужая марка летать не даёт, своя нужна всё равно
    else if (anyKnows(f.key)) worth *= 0.7;
    let ev = worth * Math.pow(c.apt[f.key] || 0.5, 1.6) / (f.diff / 2200);
    ev *= 1 + c.spent[f.key] / f.diff * 0.9;
    if (ev > top) { top = ev; best = f.key; }
  });
  return best;
}

export function research(): void {
  corps.forEach((c) => {
    if (!c.target || knows(c, c.target)) c.target = pickTarget(c);
    if (!c.target) return;
    const f = techOf(c.target);
    c.spent[c.target] += sciOf(c) * (0.8 + (c.apt[c.target] || 0.5) * 1.1) * 6;
    if (c.target === L.subKey && L.subYear > 0 && S.treasury > L.subYear / 12) {
      c.spent[c.target] += L.subYear / 12; S.treasury -= L.subYear / 12;
    }
    if (c.spent[c.target] < f.diff * 0.55) return;
    const over = (c.spent[c.target] - f.diff * 0.55) / f.diff;
    if (Math.random() < Math.min(0.06, over * (c.apt[c.target] || 0.5) * 0.05)) {
      c.known[c.target] = true; flash[c.target] = 1;
      // освоение бесконечно: за взятой маркой сразу появляется следующая
      if (devOf(c.target)) ensureDev(devOf(c.target).cls, devOf(c.target).mark + 1);
      if (markOf(c.target) && !S.moveKnown) {
        S.moveKnown = true;
        say("Выяснилось, каким оказался межзвёздный переход: <b>" + S.move.name + "</b>. " + S.move.hint);
      }
      const p = patents[c.target];
      if (p.owner < 0) {
        p.owner = c.id; p.since = Y();
        say("<b>" + c.name + "</b> первой освоила «" + f.name.toLowerCase() + "», патент до " + (Y() + L.patTerm) + " года.");
      } else if (patLive(c.target)) {
        say("<b>" + c.name + "</b> тоже умеет «" + f.name.toLowerCase() + "», но патент " + corps[p.owner].name +
            " держится до " + (p.since + L.patTerm) + " года.");
      } else say("<b>" + c.name + "</b> тоже освоила «" + f.name.toLowerCase() + "».");
      c.target = null;
    }
  });
}

export function patentsExpire(): void {
  allTech().forEach((f) => {
    const p = patents[f.key];
    if (p.owner < 0 || p.told || Y() - p.since < L.patTerm) return;
    p.told = true; flash[f.key] = 1;
    const rivals = corps.filter((c) => { return c.id !== p.owner && knows(c, f.key); });
    say("Патент на «" + f.name.toLowerCase() + "» истёк." +
        (rivals.length ? " Выходят: " + rivals.map((c) => { return c.name; }).join(", ") + "." : ""));
  });
}

