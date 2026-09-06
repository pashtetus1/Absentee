// ===================== движение =====================
// Готовый корабль своим ходом идёт в чужую систему: это межзвёздный перелёт,
// он жжёт межзвёздное топливо и виден на карте. По прилёте корабль встаёт на
// свой обычный внутрисистемный курс — к астероиду или к планете.

import { pickCaptain } from "./data";
import { dockShip } from "./docks";
import { takeFuel } from "./market";
import { S, U, corps, dateStr, routes, say, systems, voyages } from "./state";
import { speedOf } from "./tech";
import { routeKey } from "./travel";
import { makeWorld, openBranch } from "./world";
import type { Ship, Sys, Voyage, Yard } from "./types";

export function ferry(yd: Yard, s: Sys, kind: string) {
  var lead = corps[yd.lead];
  voyages.push({ kind:"ferry", cargo:kind, sysFrom:s.id, to:yd.dst, corp:yd.lead, color:yd.color,
                 parts:yd.parts, body:yd.body, backers:yd.backers, dest:yd.dest, vent:yd.vent,
                 t:0, dur:(200 + Math.random()*70) / speedOf(yd.lead), born:dateStr(), captain:pickCaptain() });
  say("<b>" + lead.name + "</b> отправила " + yd.vt.name + " из " + s.name + " в " + systems[yd.dst].name + ".");
}

export function moveShips() {
  systems.forEach(function (s) {
    for (var y = s.yards.length - 1; y >= 0; y--) {
      var yd = s.yards[y];
      if (--yd.left > 0) continue;
      var lead = corps[yd.lead];
      // Готовый корабль без топлива стоит у стапеля. Межзвёздному нужно
      // межзвёздное, внутрисистемному — местное; ворота никуда не летят.
      // межзвёздному рейсу — межзвёздное топливо: и прыжковому, и воротам
      // на сторону, и готовой платформе, которую ещё вести в чужую систему
      var far = yd.dst !== undefined && yd.dst !== s.id;
      var fuelKind = yd.vt.key === "gate" ? (yd.gateHere !== s.id ? "sfuel" : null)
                   : (yd.vt.key === "jump" || yd.vt.key === "opener" || far) ? "sfuel" : "fuel";
      if (fuelKind && !takeFuel(lead, s.id, fuelKind)) {
        yd.left = 1; yd.fuelWait = (yd.fuelWait || 0) + 1;
        if (yd.fuelWait === 1 || yd.fuelWait % 36 === 0)
          say("<b>" + lead.name + "</b>: " + yd.vt.name + " в " + s.name + " готов, но " +
              (fuelKind === "sfuel" ? "межзвёздного" : "местного") + " топлива в системе нет.");
        continue;
      }
      s.yards.splice(y, 1);
      if (yd.vt.key === "gate") {
        // Ворота никуда не летят: они простреливают коридор до соседей прямо
        // отсюда. Поэтому под воротами экспансия идёт кольцами, а не ниточкой.
        var g = systems[yd.gateHere];
        g.gate.built = true; g.gate.building = false; g.gate.owner = yd.lead; g.pulse = 1;
        var first = !g.unlocked;
        g.unlocked = true;
        say("<b>" + lead.name + "</b> открыла звёздные ворота в " + g.name +
            (first ? ": система вошла в сеть." : ". Теперь до неё возят даром."));
        if (!S.jumped && first) { S.jumped = true; say("Первый межзвёздный переход совершён."); }
      } else if (yd.vt.key === "jump" || yd.vt.key === "opener") {
        voyages.push({ kind:yd.vt.key, sysFrom:s.id, to:yd.to, corp:yd.lead, color:yd.color,
                       parts:yd.parts, t:0, dur:(220 + Math.random()*80) / speedOf(yd.lead), born:dateStr(), captain:pickCaptain() });
        say("<b>" + lead.name + "</b> вывела " + (yd.vt.key === "opener" ? "порталооткрыватель" : "прыжковый корабль") +
            " с верфи " + s.name + ".");
      } else if (yd.vt.key === "colony") {
        if (far) { ferry(yd, s, "colony"); continue; }
        s.ships.push({ kind:"colony", corp:yd.lead, color:yd.color, glyph:"cir", size:8, t:0,
                       dur:(120 + Math.random()*60) / speedOf(yd.lead), body:yd.body, backers:yd.backers, parts:yd.parts,
                       trail:[], x:0, y:0, ang:0, born:dateStr(), captain:pickCaptain() });
        say("<b>" + lead.name + "</b> спустила колониальный модуль: курс на " + yd.body.name + ".");
      } else {
        if (far) { ferry(yd, s, "mine"); continue; }
        yd.vent.building = false;
        s.ships.push({ kind:"mine", corp:yd.lead, color:yd.color, glyph:yd.glyph, size:8, t:0,
                       dur:(120 + Math.random()*60) / speedOf(yd.lead), dest:yd.dest, vent:yd.vent, parts:yd.parts,
                       trail:[], x:0, y:0, ang:0, born:dateStr(), captain:pickCaptain() });
        say("<b>" + lead.name + "</b> спустила платформу: курс на " + yd.dest.label + ".");
      }
    }
    for (var i = s.ships.length - 1; i >= 0; i--) {
      var sh = s.ships[i];
      sh.tp = sh.t; sh.t += 1 / sh.dur;
      if (sh.t >= 1) { arriveShip(sh, s); s.ships.splice(i, 1); }
    }
  });
  for (var j = voyages.length - 1; j >= 0; j--) {
    var v = voyages[j];
    v.tp = v.t; v.t += 1 / v.dur;
    if (v.t >= 1) { arriveVoyage(v); voyages.splice(j, 1); }
  }
}

export function arriveShip(sh: Ship, s: Sys) {
  if (U.pick && U.pick.data === sh) U.pick = null;
  if (sh.kind === "colony" && sh.body.world) {   // кто-то успел раньше
    sh.body.claimed = false;
    say("Колония " + corps[sh.corp].name + " опоздала: " + sh.body.name + " уже занята.");
    return;
  }
  if (sh.kind === "mine") {
    sh.vent.live = true; sh.vent.building = false; s.mines++;
    s.stations.push({ dest:sh.vent.dest, color:sh.color, glyph:sh.glyph, size:6.4, vent:sh.vent, ang:-1.9 });
    say("Платформа " + corps[sh.corp].name + " встала на " + sh.vent.dest.label + " (" + s.name + ").");
  } else if (sh.kind === "colony") {
    sh.body.claimed = false;
    var w = makeWorld(sh.body, 1.2, sh.corp);
    w.parts = sh.parts;
    say("На " + sh.body.name + " первые десять лет будут тяжёлыми: еда привозная, цехов нет, казна пуста.");
    sh.backers.forEach(function (b) { w.rights.push(b.corp); openBranch(corps[b.corp], w, true); });
    say("<b>" + corps[sh.corp].name + "</b> основала колонию на " + sh.body.name + " (" + sh.body.type.name +
        ", предел " + w.cap + "). Филиалы: " + w.branches.map(function (br) { return corps[br.corp].name; }).join(", ") + ".");
  }
}

export function arriveVoyage(v: Voyage) {
  if (U.pick && U.pick.data === v) U.pick = null;      // иначе в панели висит "в пути 102%"
  if (v.kind === "jump" || v.kind === "opener") {
    var t = systems[v.to];
    t.pulse = 1;
    if (v.kind === "opener") routes[routeKey(v.sysFrom, v.to)] = true;   // проход остаётся навсегда
    if (!t.unlocked) {
      t.unlocked = true;
      say("<b>" + corps[v.corp].name + "</b> открыла систему " + t.name + ": " +
          t.bodies.map(function (b) { return b.type.name; }).join(", ") + "." +
          (v.kind === "opener" ? " Проход прожжён и остаётся открытым." : ""));
      if (!S.jumped) { S.jumped = true; say("Первый межзвёздный переход совершён."); }
    }
    return;
  }
  if (v.kind === "ferry") {                       // корабль долетел до чужой системы
    var t = systems[v.to];
    if (v.cargo === "colony") {
      t.ships.push({ kind:"colony", corp:v.corp, color:v.color, glyph:"cir", size:8, t:0,
                     dur:(120 + Math.random()*60) / speedOf(v.corp), body:v.body, backers:v.backers,
                     parts:v.parts, trail:[], x:0, y:0, ang:0, born:dateStr(), captain:v.captain });
      say("<b>" + corps[v.corp].name + "</b>: колониальный модуль дошёл до " + t.name +
          ", курс на " + v.body.name + ".");
    } else {
      t.ships.push({ kind:"mine", corp:v.corp, color:v.color, glyph:"mine", size:8, t:0,
                     dur:(120 + Math.random()*60) / speedOf(v.corp), dest:v.dest, vent:v.vent,
                     parts:v.parts, trail:[], x:0, y:0, ang:0, born:dateStr(), captain:v.captain });
      say("<b>" + corps[v.corp].name + "</b>: платформа дошла до " + t.name + ", курс на " + v.dest.label + ".");
    }
    return;
  }
  if (v.kind === "parts") { v.take({ k:v.k, from:v.corp }); return; }
  if (v.kind === "food") { v.to.food.stock += v.qty; dockShip(v); return; }
  if (v.kind === "pops") {
    dockShip(v);
    v.to.pop.free += v.qty;
    say(v.qty.toFixed(1) + " человечков прибыли на " + v.to.body.name + ".");
  }
}

