
import { vis } from "../clock";
import { MARKRANGE } from "../data";
import { galaxyRange, within } from "../galaxy";
import { S, U, cam, corps, docks, hits, routes, systems, voyages } from "../state";
import { clamp, dist, fmt } from "../util";
import { popOf } from "../world";
import { CH, CW, advanceFrame, cx, glow, last, setUiz, uiz } from "./canvas";
import { advance, caption, dockLines, flame, grow, posOf, rock, ship, tiny, windowLines } from "./models";
import type { Sys } from "../types";

export function drawSystem(s: Sys) {
  var mx = CW / 2, my = CH / 2;
  setUiz(1);                     // в системе зума нет, экранные размеры как есть
  hits.length = 0;
  cx.fillStyle = "#080d19"; cx.fillRect(0, 0, CW, CH);

  s.bodies.forEach(function (o) {
    cx.beginPath(); cx.arc(mx, my, o.r, 0, 6.2832);
    cx.strokeStyle = "#131c2f"; cx.lineWidth = 1; cx.stroke();
  });

  var pulse = 1 + Math.sin(glow * 0.7) * 0.04;
  var sg = cx.createRadialGradient(mx, my, 2, mx, my, 26 * pulse);
  sg.addColorStop(0, "#fff3d0"); sg.addColorStop(0.5, "#f2b33d"); sg.addColorStop(1, "rgba(242,179,61,0)");
  cx.beginPath(); cx.arc(mx, my, 26 * pulse, 0, 6.2832); cx.fillStyle = sg; cx.fill();
  cx.beginPath(); cx.arc(mx, my, 10, 0, 6.2832); cx.fillStyle = "#fff6dd"; cx.fill();

  s.rocks.forEach(function (r) {
    var p = posOf(r, mx, my);
    rock(p.x, p.y, r.s, r.seed, r.taken ? "#7e8aa4" : "#46526e");
    cx.font = "500 9.5px system-ui, sans-serif"; cx.fillStyle = r.taken ? "#6d7793" : "#49536c";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(r.name, p.x, p.y + r.s + 6);
  });

  s.bodies.forEach(function (b) {
    var p = posOf(b, mx, my), w = b.world;
    var g2 = cx.createRadialGradient(p.x - b.rad*0.35, p.y - b.rad*0.35, b.rad*0.15, p.x, p.y, b.rad);
    g2.addColorStop(0, b.type.col); g2.addColorStop(1, "#131b2d");
    cx.beginPath(); cx.arc(p.x, p.y, b.rad, 0, 6.2832); cx.fillStyle = g2; cx.fill();
    if (w) {
      var fill = clamp(popOf(w) / w.cap, 0, 1);
      cx.beginPath(); cx.arc(p.x, p.y, b.rad + 4, -1.5708, -1.5708 + 6.2832 * fill);
      cx.strokeStyle = w.food.short > 2 ? "#ff8b5e" : "#6fd39b"; cx.lineWidth = 2; cx.stroke();
      w.branches.forEach(function (br, i) {
        var a = -1.5708 + i * 0.7;
        cx.fillStyle = corps[br.corp].color;
        cx.fillRect(p.x + Math.cos(a) * (b.rad + 11) - 2.5, p.y + Math.sin(a) * (b.rad + 11) - 2.5, 5, 5);
      });
    }
    hits.push({ x:p.x, y:p.y, r:b.rad + 12, kind:"body", data:b });
    cx.font = "500 10.5px system-ui, sans-serif"; cx.fillStyle = w ? "#c9d2e4" : "#6a7590";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(b.name, p.x, p.y + b.rad + 8);
    cx.font = "500 9.5px system-ui, sans-serif"; cx.fillStyle = "#556080";
    cx.fillText(b.type.name + (w ? " · " + fmt(popOf(w)) : ""), p.x, p.y + b.rad + 21);
  });

  // Ворота рисуются только там, где они есть на самом деле. Раньше в каждой
  // системе висел кружок "выход" — он ничего не означал ни при движках, ни
  // при открывателях и только сбивал.
  if (S.move.key === "gates" && (s.gate.built || s.gate.building)) {
    var jp = posOf(s.gate, mx, my), jr = 9 + Math.sin(glow * 1.6) * 1.6;
    cx.beginPath(); cx.arc(jp.x, jp.y, jr, 0, 6.2832);
    cx.strokeStyle = s.gate.built ? "#9aa8ff" : "#3a4460"; cx.lineWidth = 1.4; cx.stroke();
    if (s.gate.built) {
      cx.beginPath(); cx.arc(jp.x, jp.y, jr * 0.42, 0, 6.2832); cx.fillStyle = "#9aa8ff"; cx.fill();
    }
    cx.font = "500 10px system-ui, sans-serif"; cx.fillStyle = s.gate.built ? "#8f9bc4" : "#4e5872";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(s.gate.built ? "ворота" : "ворота строятся", jp.x, jp.y + jr + 5);
  }

  // Вставшая платформа перестаёт быть корабликом. Она села, а не зависла над
  // камнем, и отмечается тем же значком, что филиал на планете: квадратик
  // цвета компании на ободе. Одна ось опознания на всю сцену — цвет отвечает
  // на "чьё это", а форма кораблика означала бы, что он всё ещё летит.
  s.stations.forEach(function (st) {
    var t = st.dest.ref, base = posOf(t, mx, my), off = t.s + 5;
    var x = base.x + Math.cos(st.ang) * off, y = base.y + Math.sin(st.ang) * off;
    cx.fillStyle = st.color; cx.fillRect(x - 2.5, y - 2.5, 5, 5);
    hits.push({ x:x, y:y, r:9, kind:"vent", data:st.vent });
  });

  var op = posOf(s.bodies[0], mx, my);
  s.yards.forEach(function (yd, i) {
    var a = -1.5708 + i * 1.05, off = s.bodies[0].rad + 24;
    var x = op.x + Math.cos(a) * off, y = op.y + Math.sin(a) * off;
    var done = 1 - yd.left / yd.total;
    cx.beginPath(); cx.arc(x, y, 10, 0, 6.2832);
    cx.strokeStyle = "#1e2740"; cx.lineWidth = 2; cx.stroke();
    cx.beginPath(); cx.arc(x, y, 10, -1.5708, -1.5708 + 6.2832 * done);
    cx.strokeStyle = yd.color; cx.lineWidth = 2; cx.stroke();
    cx.globalAlpha = 0.35 + done * 0.65;
    ship(yd.glyph, x, y, 6.2, 0, yd.color);
    cx.globalAlpha = 1;
    hits.push({ x:x, y:y, r:13, kind:"yard", data:yd });
  });

  s.ships.forEach(function (sh) {
    cx.beginPath();
    sh.trail.forEach(function (p, j) { j ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); });
    cx.strokeStyle = sh.color; cx.globalAlpha = 0.22; cx.lineWidth = 1.3; cx.stroke(); cx.globalAlpha = 1;
    // вылет и прилёт: корабль вырастает из точки у родной планеты и сжимается
    // в точку у цели; так видно, что он ОТТУДА и что он ТУДА сел
    var g = grow(clamp(vis(sh), 0, 1));
    if (g > 0.02) {
      flame(sh.x, sh.y, sh.size * g, sh.ang);
      ship(sh.glyph, sh.x, sh.y, sh.size * g, sh.ang, sh.color);
    }
    if (U.pick && U.pick.data === sh) caption(sh.x, sh.y, windowLines(sh, false), sh.color);
    else tiny(sh.x, sh.y, sh.captain, sh.color);
    hits.push({ x:sh.x, y:sh.y, r:13, kind:"ship", data:sh });
  });

  // стоянка: отработанные транспортники висят на орбите своего мира, тускло
  docks.forEach(function (d, i) {
    if (d.sys !== s.id) return;
    var b = d.world.body, p = posOf(b, mx, my);
    // Корабли на стоянке ЛЕТАЮТ вокруг своего мира, а не висят приклеенными.
    // Планеты в игре стоят на местах (см. журнал), движутся только корабли —
    // и это как раз корабли. Прежние 0.03 рад/с давали оборот за три с
    // половиной минуты, то есть неподвижность; теперь круг за 24-39 секунд.
    // Ближняя дорожка быстрее дальней, как и положено на орбите.
    var lane = d.lane || 0;
    var a = d.ang + glow * (0.26 - lane * 0.05), off = b.rad + 16 + lane * 5;
    var x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
    cx.globalAlpha = 0.55;
    ship("cargo", x, y, 5, a + 1.5708, d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    cx.globalAlpha = 1;
    if (U.pick && U.pick.data === d) caption(x, y, dockLines(d), d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    else tiny(x, y, d.captain, "#5d6881");
    hits.push({ x:x, y:y, r:10, kind:"dock", data:d });
  });

  voyages.forEach(function (v) {
    if (v.sysFrom !== undefined || v.from.sys !== s.id || v.to.sys !== s.id) return;
    var a = posOf(v.from.body, mx, my), b = posOf(v.to.body, mx, my), k = clamp(vis(v), 0, 1);
    var x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    var rotc = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;   // носом к цели, как все
    var gc = 6 * grow(k);
    if (gc > 0.12) { flame(x, y, gc, rotc); ship("cargo", x, y, gc, rotc, v.color); }
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12, kind:"cargo", data:v });
  });

  // Межзвёздные рейсы, пока они ещё ВНУТРИ этой системы. Первые 15% пути —
  // уход от планеты к краю в сторону целевой звезды, последние 15% — приход
  // с края к цели. Раньше такой корабль жил только на карте, и из системы
  // было не видно ни вылета, ни прилёта.
  var LEG = 0.15;
  voyages.forEach(function (v) {
    var fromSys = v.sysFrom !== undefined ? v.sysFrom : v.from.sys;
    var toSys = v.sysFrom !== undefined ? v.to : v.to.sys;
    if (fromSys === toSys) return;                        // внутрисистемные уже нарисованы
    var t = clamp(vis(v), 0, 1), leg = null, a, b;
    if (s.id === fromSys && t < LEG) {
      var origin = v.sysFrom !== undefined ? s.bodies[0] : v.from.body;
      var ang = Math.atan2(systems[toSys].y - s.y, systems[toSys].x - s.x);
      a = posOf(origin, mx, my);
      b = { x:mx + Math.cos(ang) * 330, y:my + Math.sin(ang) * 330 };
      leg = t / LEG;
    } else if (s.id === toSys && t > 1 - LEG) {
      var target = v.sysFrom !== undefined ? s.bodies[0] : v.to.body;
      var ang2 = Math.atan2(systems[fromSys].y - s.y, systems[fromSys].x - s.x);
      a = { x:mx + Math.cos(ang2) * 330, y:my + Math.sin(ang2) * 330 };
      b = posOf(target, mx, my);
      leg = (t - (1 - LEG)) / LEG;
    }
    if (leg === null) return;
    var x = a.x + (b.x - a.x) * leg, y = a.y + (b.y - a.y) * leg;
    var rot = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;
    var isJump = v.kind === "jump" || v.kind === "opener";
    // вылет — растёт из точки у планеты, прилёт — сжимается в точку у цели;
    // со стороны края системы корабль не анимируется: он там просто уходит
    var sz = 6.5 * (s.id === fromSys ? grow(leg, 0.45, 0) : grow(leg, 0, 0.45));
    if (sz > 0.12) {
      flame(x, y, sz, rot);
      ship(isJump ? "jump" : "cargo", x, y, sz, rot, v.color);
    }
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12, kind:isJump ? "jumpship" : "cargo", data:v });
  });
}

export function nodeR(s: Sys) { return 5 + Math.min(5, (s.mines + s.bodies.filter(function (b) { return b.world; }).length) * 1.2); }
export function seenSys(s: Sys) { return s.unlocked || within(s.id, Math.max(galaxyRange(), MARKRANGE[0])).some(function (n) { return systems[n].unlocked; }); }

export function drawMap() {
  hits.length = 0;
  cx.fillStyle = "#080d19"; cx.fillRect(0, 0, CW, CH);
  // Пятьдесят звёзд в один экран не влезают читаемо, поэтому карта таскается
  // мышью и приближается колесом. Всё, что ниже, рисуется в координатах
  // КАРТЫ; попадания по клику пересчитываются обратно в них же.
  cx.save(); cx.translate(cam.x, cam.y); cx.scale(cam.k, cam.k);
  setUiz(1 / cam.k);             // дальше всё, что не расстояние, ужимается на зум
  // Пунктир — докуда дотягивается нынешняя марка. Он и показывает край:
  // дальние звёзды видны, но линий к ним нет, пока не осилят следующую.
  var range = galaxyRange();
  if (range > 0) {
    systems.forEach(function (s) {
      if (!s.unlocked) return;
      within(s.id, range).forEach(function (n) {
        if (systems[n].unlocked && n < s.id) return;
        cx.beginPath(); cx.moveTo(s.x, s.y); cx.lineTo(systems[n].x, systems[n].y);
        cx.strokeStyle = systems[n].unlocked ? "#212b45" : "#1a2340";
        cx.setLineDash([2 * uiz, 5 * uiz]); cx.lineWidth = uiz; cx.stroke(); cx.setLineDash([]);
      });
    });
  }
  Object.keys(routes).forEach(function (k) {          // прожжённые проходы
    var bits = k.split("-"), a = systems[+bits[0]], b = systems[+bits[1]];
    if (!a || !b) return;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
    cx.strokeStyle = "#5b6bb0"; cx.lineWidth = 2 * uiz; cx.stroke();
  });
  if (S.move.key === "gates") {                          // сеть ворот
    var g = systems.filter(function (s) { return s.gate.built; });
    g.forEach(function (s) {
      var near: Sys = null, nd = 1e9;
      g.forEach(function (o) {
        if (o === s) return;
        var d = dist(s, o);
        if (d < nd) { nd = d; near = o; }
      });
      if (!near) return;
      cx.beginPath(); cx.moveTo(s.x, s.y); cx.lineTo(near.x, near.y);
      cx.strokeStyle = "#40508c"; cx.lineWidth = 1.6 * uiz; cx.stroke();
    });
  }
  voyages.forEach(function (v) {
    var a, b;
    // прыжковые, открыватели и грузовики с деталями летят между СИСТЕМАМИ и
    // несут sysFrom/to; хлебовозы и переселенцы — между мирами
    if (v.sysFrom !== undefined) { a = systems[v.sysFrom]; b = systems[v.to]; }
    else { a = systems[v.from.sys]; b = systems[v.to.sys]; if (a === b) return; }
    var k = clamp(vis(v), 0, 1), x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(x, y);
    cx.strokeStyle = v.color; cx.globalAlpha = 0.3; cx.lineWidth = 1.2 * uiz; cx.stroke(); cx.globalAlpha = 1;
    var isJump = v.kind === "jump" || v.kind === "opener";
    var rot = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;
    // те же взлёт и посадка, что в системе: из точки у звезды-отправителя и в
    // точку у звезды-получателя — иначе одно и то же движение выглядит
    // по-разному на двух видах
    var szm = 6.5 * uiz * grow(k, 0.08, 0.08);
    if (szm > 0.12) { flame(x, y, szm, rot); ship(isJump ? "jump" : "cargo", x, y, szm, rot, v.color); }
    // на карте рейсов десятки — подпись только у выбранного и у того, над
    // которым мышь, иначе карта превращается в кашу из окошек
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12 * uiz, kind:isJump ? "jumpship" : "cargo", data:v });
  });
  systems.forEach(function (s) {
    // Звезда — ЗНАЧОК системы, а не тело с размером: ужимается на зум, чтобы
    // при приближении узлы расходились, а не разбухали в пятна. Зона охоты
    // вольницы (45) ужиматься НЕ должна — это настоящее расстояние в космосе.
    var r = nodeR(s) * uiz;
    if (!seenSys(s)) {
      // Далёкая звезда обязана быть ВИДНА: карта из пятидесяти точек, где
      // сорок три почти сливаются с фоном, читается как пустая, и тогда
      // непонятно даже, работает ли зум. Видно — но недостижимо.
      cx.beginPath(); cx.arc(s.x, s.y, 2.6 * uiz, 0, 6.2832); cx.fillStyle = "#46527a"; cx.fill();
      return;
    }
    if (!s.unlocked) {
      cx.beginPath(); cx.arc(s.x, s.y, 8 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3a4460"; cx.setLineDash([2 * uiz, 4 * uiz]); cx.lineWidth = 1.2 * uiz; cx.stroke(); cx.setLineDash([]);
      cx.font = "500 " + (10.5 * uiz) + "px system-ui, sans-serif"; cx.fillStyle = "#4e5872";
      cx.textAlign = "center"; cx.textBaseline = "top";
      cx.fillText("неизведанная", s.x, s.y + 13 * uiz);
      return;
    }
    if (s.pulse > 0) {
      cx.beginPath(); cx.arc(s.x, s.y, r + (6 + (1 - s.pulse) * 22) * uiz, 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.globalAlpha = s.pulse * 0.7; cx.lineWidth = 1.6 * uiz; cx.stroke(); cx.globalAlpha = 1;
    }
    if (U.view.sys === s.id) {
      cx.beginPath(); cx.arc(s.x, s.y, r + 10 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3d4a70"; cx.lineWidth = uiz; cx.stroke();
    }
    // логово вольницы: красное кольцо — зона охоты, мимо лучше не летать
    if (corps.some(function (c) { return c.pirate && c.home && c.home.sys === s.id; })) {
      cx.beginPath(); cx.arc(s.x, s.y, 45, 0, 6.2832);
      cx.strokeStyle = "#ff5c5c"; cx.globalAlpha = 0.35; cx.setLineDash([4 * uiz, 6 * uiz]); cx.lineWidth = 1.2 * uiz;
      cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
    }
    if (s.gate.built) {            // ворота: система в сети, до неё долетит хлебовоз
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.lineWidth = 1.6 * uiz; cx.stroke();
    } else if (s.gate.building) {
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3f4a78"; cx.setLineDash([2 * uiz, 4 * uiz]); cx.lineWidth = 1.4 * uiz; cx.stroke(); cx.setLineDash([]);
    }
    var g = cx.createRadialGradient(s.x, s.y, uiz, s.x, s.y, r + 9 * uiz);
    g.addColorStop(0, "#fff3d0"); g.addColorStop(0.45, "rgba(242,179,61,0.55)"); g.addColorStop(1, "rgba(242,179,61,0)");
    cx.beginPath(); cx.arc(s.x, s.y, r + 9 * uiz, 0, 6.2832); cx.fillStyle = g; cx.fill();
    cx.beginPath(); cx.arc(s.x, s.y, r * 0.5, 0, 6.2832); cx.fillStyle = "#fff6dd"; cx.fill();
    var ws = s.bodies.filter(function (b) { return b.world; }), here: Record<number, number> = {};
    ws.forEach(function (b) { b.world.branches.forEach(function (br) { here[br.corp] = 1; }); });
    var ids = Object.keys(here);
    ids.forEach(function (id, i) {
      var a = -1.5708 + i * (6.2832 / Math.max(1, ids.length));
      cx.beginPath(); cx.arc(s.x + Math.cos(a) * (r + 13 * uiz), s.y + Math.sin(a) * (r + 13 * uiz), 3.2 * uiz, 0, 6.2832);
      cx.fillStyle = corps[+id].color; cx.fill();
    });
    hits.push({ x:s.x, y:s.y, r:26 * uiz, kind:"sys", data:s });
    cx.font = (s.id === 0 ? "600 " : "500 ") + (10 * uiz) + "px system-ui, sans-serif";
    cx.fillStyle = s.id === 0 ? "#e4e9f4" : "#9aa5bd";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(s.name, s.x, s.y + r + 13 * uiz);
    var popHere = ws.reduce(function (a2, b) { return a2 + popOf(b.world); }, 0);
    if (ws.length) {
      cx.font = "500 " + (9 * uiz) + "px system-ui, sans-serif"; cx.fillStyle = "#5d6881";
      cx.fillText(ws.length + " мир. · " + fmt(popHere) + " чел.", s.x, s.y + r + 24 * uiz);
    }
  });
  cx.restore(); setUiz(1);       // подсказки внизу рисуются уже без масштаба
  cx.font = "500 11px system-ui, sans-serif"; cx.fillStyle = "#4e5872";
  cx.textAlign = "left"; cx.textBaseline = "top";
  cx.fillText("клик по системе — внутрь, по кораблю — что везёт · тащить мышью, Ctrl+колесо — приблизить", 16, 16);
  if (cam.k !== 1 || cam.x || cam.y) cx.fillText("×" + cam.k.toFixed(1) + " · двойной клик вернёт вид", 16, 32);
}

export function frame(ts: number) {
  var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
  advanceFrame(ts, dt);
  systems.forEach(function (s) { advance(s, dt); });
  if (U.view.mode === "map") drawMap(); else drawSystem(systems[U.view.sys]);
  requestAnimationFrame(frame);
}

