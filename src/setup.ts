
import { COLTECH, COMPS, MOVES, TEMPLATE, makeMarks, moveOf } from "./data";
import { makeGalaxy } from "./galaxy";
import { S, U, clear, corps, docks, feed, fill, flash, gates, market, patents, projects, proposals, say, shipyards, staged, systems, voyages, worlds } from "./state";
import { DEVS, allTech, ensureDev } from "./tech";
import { makeWorld, openBranch } from "./world";
import type { Corp } from "./types";

import { rnd } from "./rng";

import { freshSeed, setSeed } from "./rng";

export function build(forcedMove?: string, seed?: number): void {
  // Сид ставится ПЕРВЫМ делом: всё, что ниже, тянет случайность, и партия
  // обязана разворачиваться одинаково от одного и того же числа.
  setSeed(seed === undefined ? freshSeed() : seed);
  // Способ и его марки выбираются ПЕРВЫМИ: от них зависит список технологий,
  // а значит и то, во что компаниям вообще можно вкладываться.
  S.move = forcedMove ? moveOf(forcedMove) : MOVES[Math.floor(rnd() * MOVES.length)];
  makeMarks();
  fill(corps, TEMPLATE.map((t, i) => {
    const c = { id:i, name:t.name, color:t.color, craft:t.craft, nerve:t.nerve, apt:t.apt,
              cash:900, known:{}, spent:{}, stock:{}, target:null, order:null,
              branches:[], sold:0, bought:0, cool:0, embargo:{}, ask:{} } as Corp;
    allTech().forEach((f) => { c.spent[f.key] = 0; });
    // ask — во сколько раз компания просит выше ходовой цены. Характер здесь
    // виден сразу: смелые запрашивают больше и чаще остаются без сделки.
    COMPS.forEach((f) => { c.ask[f.key] = 0.95 + (t.nerve - 0.9) * 0.25 + rnd() * 0.1; });
    return c;
  }));
  clear(market); clear(patents);
  COMPS.forEach((f) => { market[f.key] = { price:f.base, last:f.base, want:0, stock:0 }; });
  allTech().forEach((f) => { patents[f.key] = { owner:-1, since:0, told:false }; });
  DEVS.length = 0;
  COLTECH.forEach((col) => { ensureDev(col.key, 1); });     // Mk1 каждого класса с самого начала

  [worlds, projects, voyages, feed, docks, shipyards, proposals, staged].forEach((a) => { a.length = 0; });
  clear(flash); clear(gates); U.pick = null;
  makeGalaxy();
  S.home = makeWorld(systems[0].bodies[0], 18, -1);
  // Родина огромна и почти пуста: 18 человечков на предел 360 — пять процентов.
  // К открытию межзвёздных перелётов дома должно быть тесно не от людей, а
  // от бедности: расти есть куда, а кормить и платить нечем.
  S.home.cap = S.home.cap0 = 360;
  S.home.gov.cash = 200; S.home.food.stock = 40;
  corps.forEach((c) => { openBranch(c, S.home, true); });

  S.tick = 0; S.yearNow = 0; S.treasury = 320; S.jumped = false; S.trades = 0; S.turnover = 0; S.shipped = 0; S.movedPops = 0;
  S.refusals = 0; S.dropped = 0; S.moveKnown = false; S.hauled = 0; S.burned = 0; S.raids = 0; S.pirateCount = 0;
  U.view = { mode:"system", sys:0 };
  say("Тира: восемнадцать человечков, пять компаний и ни одной освоенной детали.");
  say("Межзвёздный переход возможен, но какой именно — неизвестно: выяснится, когда кто-нибудь доведёт первую марку.");
}

