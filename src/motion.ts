// ===================== движение =====================
// Готовый корабль своим ходом идёт в чужую систему: это межзвёздный перелёт,
// он жжёт межзвёздное топливо и виден на карте. По прилёте корабль встаёт на
// свой обычный внутрисистемный курс — к астероиду или к планете.
//
// СКОРОСТЬ СЧИТАЕТСЯ ПО-РАЗНОМУ НА ДВУХ УЧАСТКАХ, и это не мелочь, а разные
// вещи. Внутри системы корабль идёт на ходовом двигателе — той модели, что
// на нём стоит (engMult по его же деталям): два одинаковых грузовика с разными
// двигателями идут с разной скоростью, и по клику видно, почему. Между звёздами
// ходовой не работает вовсе, там правит марка межзвёздного перехода
// (markSpeedOf), и она же решает, добьёт ли корабль до цели.

import { engMult, pickCaptain } from "./data";
import { dockShip } from "./docks";
import { markLevelOf, markSpeedOf } from "./galaxy";
import { partMark } from "./data";
import { landPart, takeFuel } from "./market";
import { rnd } from "./rng";
import { yardAt } from "./shipyard";
import { S, U, corps, dateStr, docks, gates, say, shipyards, staged, systems, voyages } from "./state";
import { ensurePortal, fuelCost, newGate, routeKey, syncRoutes, useRoute } from "./travel";
import { rnd6 } from "./util";
import { makeWorld, openBranch } from "./world";
import type { Gate, Ship, Sys, Voyage, Yard } from "./types";

/** Скорость межзвёздного корабля: по марке детали на борту; нет детали (под
 *  воротами у портального корабля набор, а не двигатель) — по марке хозяина. */
function shipMark(parts: { k: string }[], corp: number): number {
  const m = partMark(parts);
  return m && S.move.key === "drives" ? m.speed : markSpeedOf(corp);
}

export function ferry(yd: Yard, s: Sys, kind: string): void {
  const lead = corps[yd.lead];
  voyages.push({ kind:"ferry", cargo:kind, sysFrom:s.id, to:yd.dst, corp:yd.lead, color:yd.color,
                 parts:yd.parts, body:yd.body, backers:yd.backers, dest:yd.dest, vent:yd.vent,
                 t:0, dur:(200 + rnd()*70) / markSpeedOf(yd.lead), born:dateStr(), captain:pickCaptain() });
  say("<b>" + lead.name + "</b> отправила " + yd.vt.name + " из " + s.name + " в " + systems[yd.dst].name + ".");
}

export function moveShips(): void {
  // Корабли у точки старта: берут межзвёздное топливо на планете и прыгают.
  // Нет топлива — стоят и ждут, как готовый корабль у стапеля.
  for (let i = staged.length - 1; i >= 0; i--) {
    const st = staged[i], c = corps[st.corp];
    const what = st.kind === "gate" ? "портальный корабль" : "прыжковый";
    if (!takeFuel(c, st.at, "sfuel", false, fuelCost(st.at, st.to))) {
      st.fuelWait++;
      if (st.fuelWait === 1 || st.fuelWait % 36 === 0)
        say("<b>" + c.name + "</b>: " + what + " стоит в " + systems[st.at].name + " без межзвёздного топлива.");
      continue;
    }
    staged.splice(i, 1);
    voyages.push({ kind:st.kind, sysFrom:st.at, to:st.to, corp:st.corp, color:st.color, parts:st.parts, upgrade:st.upgrade,
                   t:0, dur:(220 + rnd()*80) / shipMark(st.parts, st.corp), born:dateStr(), captain:st.captain });
    say("<b>" + c.name + "</b>: " + what + " заправился в " + systems[st.at].name + " и вышел к " + systems[st.to].name + ".");
  }

  systems.forEach((s) => {
    // Каждая верфь системы: руки идут первой недостроенной сборке, а готовые
    // уходят, как только есть топливо. Готовая без топлива НЕ держит очередь —
    // иначе одна сборка, ждущая межзвёздного, стопорила полсотни за собой.
    const yardsHere = shipyards.filter((y) => y.world.sys === s.id);
    for (let y = 0; y < yardsHere.length; y++) {
      const yard = yardsHere[y];
      const work = yard.queue.find((b) => b.left > 0);
      if (work) work.left -= yard.crew;      // сколько рук — столько и сделано
      for (let q = yard.queue.length - 1; q >= 0; q--) {
      const yd = yard.queue[q];
      if (yd.left > 0) continue;
      const lead = corps[yd.lead];
      // Готовый корабль без топлива стоит у стапеля. Межзвёздному нужно
      // межзвёздное, внутрисистемному — местное; ворота никуда не летят.
      // межзвёздному рейсу — межзвёздное топливо: и прыжковому, и воротам
      // на сторону, и готовой платформе, которую ещё вести в чужую систему
      // транспорт: топлива при спуске не жжёт, просто встаёт на стоянку
      if (yd.vt.key === "cargo" || yd.vt.key === "liner") {
        yard.queue.splice(q, 1);
        const home = yd.forWorld || yard.world;
        docks.push({ kind: yd.vt.key, parts: yd.parts, captain: pickCaptain(),
                     sys: yard.world.sys, world: yard.world, ang: rnd6(), since: S.tick,
                     corp: yd.forCorp !== undefined ? yd.forCorp : -1,
                     gov: yd.forCorp !== undefined ? null : home,
                     lane: docks.filter((x) => x.world === yard.world).length % 3 });
        // на орбите одной планеты больше шести не держат: старейший списывают,
        // тот же потолок, что у пришедших рейсом (dockShip)
        const here = docks.filter((x) => x.world === yard.world);
        if (here.length > 6) docks.splice(docks.indexOf(here[0]), 1);
        say("<b>" + (yd.forCorp !== undefined ? corps[yd.forCorp].name : "Правительство " + home.body.name) +
            "</b>: " + yd.vt.name + " сошёл со стапеля у " + yard.world.body.name + ".");
        continue;
      }
      const far = yd.dst !== undefined && yd.dst !== s.id;
      const jumper = yd.vt.key === "jump" || yd.vt.key === "gate";
      const fuelKind = (jumper || far) ? "sfuel" : "fuel";
      const tanks = far ? fuelCost(s.id, yd.dst) : 1;
      if (!takeFuel(lead, s.id, fuelKind, false, tanks)) {
        yd.left = 0; yd.fuelWait = (yd.fuelWait || 0) + 1;   // готов, ждёт топлива
        if (yd.fuelWait === 1 || yd.fuelWait % 36 === 0)
          say("<b>" + lead.name + "</b>: " + yd.vt.name + " в " + s.name + " готов, но " +
              (fuelKind === "sfuel" ? "межзвёздного" : "местного") + " топлива в системе нет" +
              (tanks > 1 ? " (нужно " + tanks + ")" : "") + ".");
        continue;
      }
      yard.queue.splice(q, 1);
      if (jumper) {
        // Старт не здесь — корабль идёт к точке старта своим ходом и заправится
        // там сам: паромом его не возят, он сам корабль.
        if (yd.from !== undefined && yd.from !== s.id) {
          voyages.push({ kind:"reloc", cargo:yd.vt.key, sysFrom:s.id, to:yd.from, jumpTo:yd.to, corp:yd.lead, upgrade:yd.upgrade,
                         color:yd.color, parts:yd.parts, t:0, dur:(200 + rnd()*70) / markSpeedOf(yd.lead),
                         born:dateStr(), captain:pickCaptain() });
          say("<b>" + lead.name + "</b> вывела " + yd.vt.name + " с верфи " + s.name +
              ": идёт к точке старта в " + systems[yd.from].name + ".");
          continue;
        }
        voyages.push({ kind:yd.vt.key, sysFrom:s.id, to:yd.to, corp:yd.lead, color:yd.color, upgrade:yd.upgrade,
                       parts:yd.parts, t:0, dur:(220 + rnd()*80) / shipMark(yd.parts, yd.lead), born:dateStr(), captain:pickCaptain() });
        say("<b>" + lead.name + "</b> вывела " + yd.vt.name + " с верфи " + s.name + ".");
      } else if (yd.vt.key === "colony") {
        if (far) { ferry(yd, s, "colony"); continue; }
        s.ships.push({ kind:"colony", corp:yd.lead, color:yd.color, glyph:"cir", size:8, t:0,
                       dur:(120 + rnd()*60) / engMult(yd.parts), body:yd.body, backers:yd.backers, parts:yd.parts,
                       trail:[], x:0, y:0, ang:0, born:dateStr(), captain:pickCaptain(), yard:yard });
        say("<b>" + lead.name + "</b> спустила колониальный модуль: курс на " + yd.body.name + ".");
      } else {
        if (far) { ferry(yd, s, "mine"); continue; }
        yd.vent.building = false;
        s.ships.push({ kind:"mine", corp:yd.lead, color:yd.color, glyph:yd.glyph, size:8, t:0,
                       dur:(120 + rnd()*60) / engMult(yd.parts), dest:yd.dest, vent:yd.vent, parts:yd.parts,
                       trail:[], x:0, y:0, ang:0, born:dateStr(), captain:pickCaptain(), yard:yard });
        say("<b>" + lead.name + "</b> спустила платформу: курс на " + yd.dest.label + ".");
      }
      }
    }
    for (let i = s.ships.length - 1; i >= 0; i--) {
      const sh = s.ships[i];
      sh.tp = sh.t; sh.t += 1 / sh.dur;
      if (sh.t >= 1) { arriveShip(sh, s); s.ships.splice(i, 1); }
    }
  });
  for (let j = voyages.length - 1; j >= 0; j--) {
    const v = voyages[j];
    v.tp = v.t; v.t += 1 / v.dur;
    if (v.t >= 1) { arriveVoyage(v); voyages.splice(j, 1); }
  }
}

export function arriveShip(sh: Ship, s: Sys): void {
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
    const w = makeWorld(sh.body, 1.2, sh.corp);
    w.parts = sh.parts;
    say("На " + sh.body.name + " первые десять лет будут тяжёлыми: еда привозная, цехов нет, казна пуста.");
    sh.backers.forEach((b) => { w.rights.push(b.corp); openBranch(corps[b.corp], w, true); });
    say("<b>" + corps[sh.corp].name + "</b> основала колонию на " + sh.body.name + " (" + sh.body.type.name +
        ", предел " + w.cap + "). Филиалы: " + w.branches.map((br) => { return corps[br.corp].name; }).join(", ") + ".");
  }
}

export function arriveVoyage(v: Voyage): void {
  if (U.pick && U.pick.data === v) U.pick = null;      // иначе в панели висит "в пути 102%"
  // Проход по сети засчитывается маршрутам на пути: по этому счёту решают,
  // стоит ли переделывать створы. Сам портальный корабль сеть не считает —
  // он её строит.
  if (v.kind !== "jump" && v.kind !== "gate") {
    const fa = v.sysFrom !== undefined ? v.sysFrom : v.from ? v.from.sys : undefined;
    const ta = v.sysFrom !== undefined ? v.to : v.to && v.to.sys !== undefined ? v.to.sys : undefined;
    if (fa !== undefined && ta !== undefined && fa !== ta) useRoute(fa, ta);
  }
  if (v.kind === "jump" || v.kind === "gate") {
    const t = systems[v.to];
    t.pulse = 1;
    if (v.kind === "gate") {
      // Ворота встают НА МАРШРУТ, по которому корабль только что прошёл: с
      // этого дня по нему летает кто угодно без двигателя. Раньше ворота
      // возникали в системе сами, никуда не летя, и маршрута за ними не
      // стояло вовсе — сеть без рёбер.
      const key = routeKey(v.sysFrom, v.to);
      // марка створов — марка ПРИВЕЗЁННОГО набора, а не знаний хозяина
      const kit = partMark(v.parts);
      const lvl = kit ? kit.mark : Math.max(1, markLevelOf(corps[v.corp]));
      const g: Gate = gates[key] || (gates[key] = newGate(v.sysFrom, v.to, v.corp, lvl));
      // Комплект встаёт створами на ОБОИХ концах: в сторону друга друга. Створ,
      // который уже смотрит туда, получает марку не ниже привезённой.
      const was = g.built ? g.mark || 1 : 0;
      ensurePortal(v.sysFrom, v.to, v.corp, lvl);
      ensurePortal(v.to, v.sysFrom, v.corp, lvl);
      if (!g.built) { g.built = true; g.building = false; g.owner = v.corp; g.born = dateStr(); g.mark = lvl; }
      g.upgrading = false;
      syncRoutes();                 // соседи в конусах створов тоже могли соединиться
      systems[v.sysFrom].pulse = 1;
      if (was) {
        say("<b>" + corps[v.corp].name + "</b> переделала створы " + systems[v.sysFrom].name + " — " +
            t.name + (g.mark > was ? " с Mk" + was + " на Mk" + g.mark : "") + ".");
        return;
      }
    }
    if (!t.unlocked) {
      t.unlocked = true;
      say("<b>" + corps[v.corp].name + "</b> открыла систему " + t.name + ": " +
          t.bodies.map((b) => { return b.type.name; }).join(", ") + "." +
          (v.kind === "gate" ? " Ворота на маршруте " + systems[v.sysFrom].name + " — " + t.name + " открыты." : ""));
      if (!S.jumped) { S.jumped = true; say("Первый межзвёздный переход совершён."); }
    }
    return;
  }
  if (v.kind === "reloc") {                       // дошёл до точки старта: заправка и прыжок оттуда
    staged.push({ kind:v.cargo, corp:v.corp, color:v.color, parts:v.parts, at:v.to, to:v.jumpTo,
                  fuelWait:0, captain:v.captain, born:dateStr(), upgrade:v.upgrade });
    say("<b>" + corps[v.corp].name + "</b>: " + (v.cargo === "gate" ? "портальный корабль" : "прыжковый") +
        " дошёл до " + systems[v.to].name + " и заправляется.");
    return;
  }
  if (v.kind === "ferry") {                       // корабль долетел до чужой системы
    const t = systems[v.to];
    if (v.cargo === "colony") {
      t.ships.push({ kind:"colony", corp:v.corp, color:v.color, glyph:"cir", size:8, t:0,
                     dur:(120 + rnd()*60) / engMult(v.parts), body:v.body, backers:v.backers,
                     parts:v.parts, trail:[], x:0, y:0, ang:0, born:dateStr(), captain:v.captain });
      say("<b>" + corps[v.corp].name + "</b>: колониальный модуль дошёл до " + t.name +
          ", курс на " + v.body.name + ".");
    } else {
      t.ships.push({ kind:"mine", corp:v.corp, color:v.color, glyph:"mine", size:8, t:0,
                     dur:(120 + rnd()*60) / engMult(v.parts), dest:v.dest, vent:v.vent,
                     parts:v.parts, trail:[], x:0, y:0, ang:0, born:dateStr(), captain:v.captain });
      say("<b>" + corps[v.corp].name + "</b>: платформа дошла до " + t.name + ", курс на " + v.dest.label + ".");
    }
    return;
  }
  if (v.kind === "parts") { landPart(v); dockShip(v); return; }
  if (v.kind === "food") { v.to.food.stock += v.qty; dockShip(v); return; }
  if (v.kind === "pops") {
    dockShip(v);
    v.to.pop.free += v.qty;
    say(v.qty.toFixed(1) + " человечков прибыли на " + v.to.body.name + ".");
  }
}

