
import { COLTECH, COMPS, MOVES, TEMPLATE, makeMarks, moveOf } from "./data";
import { makeGalaxy } from "./galaxy";
import { S, U, clear, corps, docks, feed, fill, flash, market, patents, projects, routes, say, systems, voyages, worlds } from "./state";
import { DEVS, allTech, ensureDev } from "./tech";
import { makeWorld, openBranch } from "./world";
import type { Corp } from "./types";

export function build(forcedMove?: string): void {
  // Способ и его марки выбираются ПЕРВЫМИ: от них зависит список технологий,
  // а значит и то, во что компаниям вообще можно вкладываться.
  S.move = forcedMove ? moveOf(forcedMove) : MOVES[Math.floor(Math.random() * MOVES.length)];
  makeMarks();
  fill(corps, TEMPLATE.map(function (t, i) {
    var c = { id:i, name:t.name, color:t.color, craft:t.craft, nerve:t.nerve, apt:t.apt,
              cash:900, known:{}, spent:{}, stock:{}, target:null, order:null,
              branches:[], sold:0, bought:0, cool:0, embargo:{}, ask:{} } as Corp;
    allTech().forEach(function (f) { c.spent[f.key] = 0; });
    // ask — во сколько раз компания просит выше ходовой цены. Характер здесь
    // виден сразу: смелые запрашивают больше и чаще остаются без сделки.
    COMPS.forEach(function (f) { c.ask[f.key] = 0.95 + (t.nerve - 0.9) * 0.25 + Math.random() * 0.1; });
    return c;
  }));
  clear(market); clear(patents);
  COMPS.forEach(function (f) { market[f.key] = { price:f.base, last:f.base, want:0, stock:0 }; });
  allTech().forEach(function (f) { patents[f.key] = { owner:-1, since:0, told:false }; });
  DEVS.length = 0;
  COLTECH.forEach(function (col) { ensureDev(col.key, 1); });     // Mk1 каждого класса с самого начала

  [worlds, projects, voyages, feed, docks].forEach(function (a) { a.length = 0; });
  clear(flash); clear(routes); U.pick = null;
  makeGalaxy();
  S.home = makeWorld(systems[0].bodies[0], 18, -1);
  // Родина огромна и почти пуста: 18 человечков на предел 360 — пять процентов.
  // К открытию межзвёздных перелётов дома должно быть тесно не от людей, а
  // от бедности: расти есть куда, а кормить и платить нечем.
  S.home.cap = S.home.cap0 = 360;
  S.home.gov.cash = 200; S.home.food.stock = 40;
  corps.forEach(function (c) { openBranch(c, S.home, true); });

  S.tick = 0; S.yearNow = 0; S.treasury = 320; S.jumped = false; S.trades = 0; S.turnover = 0; S.shipped = 0; S.movedPops = 0;
  S.refusals = 0; S.dropped = 0; S.moveKnown = false; S.hauled = 0; S.burned = 0; S.raids = 0; S.pirateCount = 0;
  U.view = { mode:"system", sys:0 };
  say("Тира: восемнадцать человечков, пять компаний и ни одной освоенной детали.");
  say("Межзвёздный переход возможен, но какой именно — неизвестно: выяснится, когда кто-нибудь доведёт первую марку.");
}

