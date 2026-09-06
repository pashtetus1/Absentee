
import { L, S, UPKEEP, corps, say, systems, worlds } from "./state";
import { popOf } from "./world";

import type { Rock } from "./types";

export function ventureIncome(): void {
  systems.forEach(function (s) {
    for (var i = s.ventures.length - 1; i >= 0; i--) {
      var v = s.ventures[i];
      if (!v.live) continue;
      corps[v.lead].cash += v.yield;
      v.left--;
      if (v.left <= 0) {
        say("Платформа " + corps[v.lead].name + " на " + v.dest.label + " выработала ресурс.");
        (v.dest.ref as Rock).taken = false; s.mines--;
        s.stations = s.stations.filter(function (st) { return st.vent !== v; });
        s.ventures.splice(i, 1);
      }
    }
  });
}

export function economy(): void {
  corps.forEach(function (c) {
    if (c.cool > 0) c.cool--;
    var earn = 0, wages = 0;
    c.branches.forEach(function (b) {
      earn += b.emp.prod * 6.5;
      wages += b.emp.prod * b.world.wage.prod + b.emp.sci * b.world.wage.sci;
      b.world.gov.cash += b.emp.prod * (b.world.rough > 0 ? 0.3 : 0.8);   // местный налог; в разруху собирать почти нечего
    });
    S.treasury += earn * L.tax;
    c.cash += earn * (1 - L.tax) - wages;
    if (c.cash < -40) c.cash = -40;
  });
  worlds.forEach(function (w) {
    S.treasury -= w.pop.free * L.dole;
    w.gov.cash += w.rough > 0 ? 0.35 : 1.2;             // подушная подать
    // Содержание: люди стоят денег просто тем, что они есть. Раньше касса мира
    // была почти закрытым накопителем — приход капал полтора века, а тратить
    // его было почти не на что: родина приходила к тринадцати тысячам при
    // корабле за 66, и никакая цена ничего не значила. Приход идёт от ЗАНЯТЫХ
    // (emp.prod * 0.8), расход — от ВСЕХ, поэтому мир, где людям нечего
    // делать, начинает течь. По населению, а не по пределу: предел у родины
    // 360 и не меняется, а население отвечает на то, как идут дела.
    // Пол на нуле обязателен: до сих пор w.gov.cash не мог стать
    // отрицательным (все списания идут через проверки "хватает ли"), и весь
    // код покупок на это опирается.
    w.gov.cash = Math.max(0, w.gov.cash - popOf(w) * UPKEEP);
  });
  if (S.treasury < 0) S.treasury = 0;
}

