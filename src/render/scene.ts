
import { vis } from "../clock";
import { seenByState } from "../charts";
import { MARKRANGE, hullScale } from "../data";
import { galaxyRange, starOf, within } from "../galaxy";
import { HOME, manyRealms, realmOf, realmOfCorp, realmOfShip, realmOfVoyage } from "../realm";
import { yardAt } from "../shipyard";
import { S, U, cam, corps, docks, fights, gates, hits, shipyards, systems, voyages, warships } from "../state";
import { gatesAt, inNet, otherEnd, portalAng, portalFor, spread } from "../travel";
import { clamp, dist, fmt } from "../util";
import { popOf } from "../world";
import { CH, CW, advanceFrame, cx, glow, last, setSysK, setUiz, uiz } from "./canvas";
import { advance, caption, crest, dockLines, flame, grow, posOf, rift, rock, satPos, scrapYard, ship, star, tiny, warped, windowLines, yardLines, yardPos } from "./models";
import { drawFight, drawGround, drawWarMark, drawWarship, fightLines, warLines } from "./war";
import type { Rock, Sys, Voyage } from "../types";

// Куда смотрит створ: в сторону звёзд, к которым ведёт. Готовый створ стоит
// там, где встал; строящийся маршрут показывается на отведённом месте.
function gateAng(from: number, to: number): number{ return portalAng(from, to); }

// Межзвёздный рейс виден внутри системы первые и последние 15% пути: уход от
// планеты к створу и выход из створа к цели.
const LEG = 0.15;
function endsOf(v: Voyage): { from: number; to: number } {
  return v.sysFrom !== undefined ? { from: v.sysFrom, to: v.to as number } : { from: v.from.sys, to: v.to.sys };
}
/** Какую долю своего отрезка межзвёздный рейс прошёл В ЭТОЙ системе; null —
 *  здесь его сейчас не видно. Внутрисистемные сюда не относятся. */
function legIn(v: Voyage, sid: number): number | null {
  const e = endsOf(v);
  if (e.from === e.to) return null;
  const t = clamp(vis(v), 0, 1);
  if (sid === e.from && t < LEG) return t / LEG;
  if (sid === e.to && t > 1 - LEG) return (t - (1 - LEG)) / LEG;
  return null;
}

/** Есть ли в системе чужое государство: хоть одна вещь, над которой висел бы
 *  щит не родной звезды. Смотрится ровно то, что сцена рисует со щитом, — мир,
 *  станция, корабль, рейс в пределах системы, — иначе золотые звёзды то
 *  всплывали бы без видимой причины, то пропадали при чужаке на экране. */
function strangersIn(s: Sys): boolean {
  return s.bodies.some((b) => b.world && realmOf(b.world) !== HOME) ||
    s.stations.some((st) => realmOfCorp(corps[st.vent.lead]) !== HOME) ||
    s.sats.some((st) => st.live && realmOfCorp(corps[st.owner]) !== HOME) ||
    s.ships.some((sh) => realmOfShip(sh) !== HOME) ||
    voyages.some((v) => realmOfVoyage(v) !== HOME &&
      (v.sysFrom === undefined && v.from.sys === s.id && v.to.sys === s.id || legIn(v, s.id) !== null));
}

export function drawSystem(s: Sys): void {
  const mx = CW / 2, my = CH / 2;
  // Гербы появляются на сцене только после первого отделения: пока государство
  // одно, щит над каждой планетой и каждым корабликом отвечает на вопрос,
  // которого никто не задавал. И даже после — только там, где чужое государство
  // ЕСТЬ: в своей системе, куда никто чужой не заходит, золотая звезда над
  // каждым кружком отвечает на тот же незаданный вопрос. Считается ОДИН раз на
  // кадр — иначе перебор контор пришёлся бы на каждый нарисованный кружок.
  const flags = manyRealms() && strangersIn(s);
  hits.length = 0;
  cx.fillStyle = "#080d19"; cx.fillRect(0, 0, CW, CH);

  // Подгоняем систему под холст: берём самое дальнее, что в ней есть, и ужимаем
  // так, чтобы оно поместилось с полем. Раньше масштаба не было вовсе, и всё
  // дальше 340 рисовалось за краем экрана. Подписи и значки при этом НЕ
  // ужимаются: uiz гасит масштаб, тот же приём, что на карте. Створы стоят
  // на последней орбите и масштаб не двигают: место под них отведено при
  // расстановке планет (см. makeSystem).
  let far = 0;
  s.bodies.forEach((o) => { far = Math.max(far, o.r + o.rad); });
  s.rocks.forEach((o) => { far = Math.max(far, o.r + o.s); });
  const k = Math.min(1, (Math.min(CW, CH) / 2 - 28) / Math.max(1, far));
  setSysK(k); setUiz(1 / k);
  cx.save(); cx.translate(mx, my); cx.scale(k, k); cx.translate(-mx, -my);

  s.bodies.forEach((o) => {
    cx.beginPath(); cx.arc(mx, my, o.r, 0, 6.2832);
    cx.strokeStyle = "#131c2f"; cx.lineWidth = 1; cx.stroke();
  });

  // Светило своего цвета (starOf, galaxy.ts): голубое крупнее и ярче жёлтого,
  // коричневое — тусклый маленький уголёк.
  const sc = starOf(s), pulse = (1 + Math.sin(glow * 0.7) * 0.04) * sc.size;
  const sg = cx.createRadialGradient(mx, my, 2, mx, my, 26 * pulse);
  sg.addColorStop(0, sc.core); sg.addColorStop(0.5, "rgb(" + sc.rgb + ")"); sg.addColorStop(1, "rgba(" + sc.rgb + ",0)");
  cx.beginPath(); cx.arc(mx, my, 26 * pulse, 0, 6.2832); cx.fillStyle = sg; cx.fill();
  cx.beginPath(); cx.arc(mx, my, 10 * sc.size, 0, 6.2832); cx.fillStyle = sc.core; cx.fill();

  s.rocks.forEach((r) => {
    const p = posOf(r, mx, my);
    rock(p.x, p.y, r.s, r.seed, r.taken ? "#7e8aa4" : "#46526e");
    cx.font = "500 9.5px system-ui, sans-serif"; cx.fillStyle = r.taken ? "#6d7793" : "#49536c";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(r.name, p.x, p.y + r.s + 6);
  });

  s.bodies.forEach((b) => {
    const p = posOf(b, mx, my), w = b.world;
    const g2 = cx.createRadialGradient(p.x - b.rad*0.35, p.y - b.rad*0.35, b.rad*0.15, p.x, p.y, b.rad);
    g2.addColorStop(0, b.type.col); g2.addColorStop(1, "#131b2d");
    cx.beginPath(); cx.arc(p.x, p.y, b.rad, 0, 6.2832); cx.fillStyle = g2; cx.fill();
    if (w) {
      const fill = clamp(popOf(w) / w.cap, 0, 1);
      cx.beginPath(); cx.arc(p.x, p.y, b.rad + 4, -1.5708, -1.5708 + 6.2832 * fill);
      cx.strokeStyle = w.food.short > 2 ? "#ff8b5e" : "#6fd39b"; cx.lineWidth = 2; cx.stroke();
      w.branches.forEach((br, i) => {
        const a = -1.5708 + i * 0.7;
        cx.fillStyle = corps[br.corp].color;
        cx.fillRect(p.x + Math.cos(a) * (b.rad + 11) - 2.5, p.y + Math.sin(a) * (b.rad + 11) - 2.5, 5, 5);
      });
    }
    // Столица помечена звёздочкой прямо на диске — тем же знаком, что и её
    // система на карте. Без него родина отличалась от колонии только тем, что
    // на неё смотрят с первого кадра, а к сотому году это уже не помнится.
    if (w && w === S.home) {
      cx.globalAlpha = 0.35;
      star(p.x, p.y, Math.min(9, b.rad * 0.62), "#fff3d0");
      cx.globalAlpha = 1;
      star(p.x, p.y, Math.min(6.5, b.rad * 0.45), "#ffe6a8");
    }
    // Герб — НАД планетой, выше пипок филиалов (те стоят на b.rad + 11 и первая
    // из них смотрит ровно вверх). Снизу два ряда подписи, поэтому места нет
    // больше нигде.
    if (w && flags) crest(p.x, p.y - b.rad - 24, 6, realmOf(w));
    // Наземная битва: скрещённые клинки сбоку от планеты. Ткнуть — и на
    // полэкрана развернётся схема боя (render/war.ts).
    if (w && w.war) drawWarMark(p.x + b.rad + 16, p.y - b.rad - 6, 7, w.war);
    hits.push({ x:p.x, y:p.y, r:b.rad + 12, kind:"body", data:b });
    cx.font = "500 10.5px system-ui, sans-serif"; cx.fillStyle = w ? "#c9d2e4" : "#6a7590";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(b.name, p.x, p.y + b.rad + 8);
    cx.font = "500 9.5px system-ui, sans-serif"; cx.fillStyle = "#556080";
    cx.fillText(b.type.name + (w ? " · " + fmt(popOf(w)) : ""), p.x, p.y + b.rad + 21);
  });

  // Створ — сооружение: смотрит в свою сторону и ведёт ко всем звёздам в
  // конусе ±40°. Подпись перечисляет, куда через него ходят. Строящийся
  // маршрут, для которого створа ещё нет, показан пунктирным кольцом на
  // отведённом месте. Прежние «одни ворота на систему» висели в случайном
  // месте края и не отвечали на главный вопрос — КУДА отсюда можно.
  const routes = gatesAt(s.id);
  const rings: { ang: number; built: boolean; label: string; g: any }[] = [];
  s.portals.forEach((p) => {
    const served = routes.filter((g) => { return g.built && portalFor(s.id, otherEnd(g, s.id)) === p; });
    rings.push({ ang:p.ang, built:true, g:served[0] || null,
                 label:(served.length ? served.map((g) => { return systems[otherEnd(g, s.id)].name; }).join(", ") : "створ") + " · Mk" + p.mark });
  });
  routes.forEach((g) => {
    if (g.built) return;
    const to = otherEnd(g, s.id);
    if (portalFor(s.id, to)) return;         // с этого конца створ уже стоит
    rings.push({ ang:gateAng(s.id, to), built:false, g:g, label:"строятся " + systems[to].name });
  });
  rings.forEach((ring) => {
    const g = ring.g;
    const jp = posOf({ r:s.gateR, ang:ring.ang }, mx, my), jr = 11 + Math.sin(glow * 1.6) * 1.8;
    const col = ring.built ? "#9aa8ff" : "#3a4460";
    // Кольцо с четырьмя засечками, развёрнутое от звезды: это створ, в который
    // уходят, а не ещё одна планета на орбите.
    const face = Math.atan2(jp.y - my, jp.x - mx);
    cx.beginPath(); cx.arc(jp.x, jp.y, jr, 0, 6.2832);
    cx.strokeStyle = col; cx.lineWidth = 1.6; cx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = face + 0.7854 + k * 1.5708;
      cx.beginPath();
      cx.moveTo(jp.x + Math.cos(a) * jr, jp.y + Math.sin(a) * jr);
      cx.lineTo(jp.x + Math.cos(a) * (jr + 5), jp.y + Math.sin(a) * (jr + 5));
      cx.strokeStyle = col; cx.lineWidth = 1.6; cx.stroke();
    }
    // вспышка при открытии: та же s.pulse, что на карте, только здесь у створа
    if (s.pulse > 0) {
      cx.beginPath(); cx.arc(jp.x, jp.y, jr + (6 + (1 - s.pulse) * 30), 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.globalAlpha = s.pulse * 0.7; cx.lineWidth = 2;
      cx.stroke(); cx.globalAlpha = 1;
    }
    if (ring.built) {
      const gr = cx.createRadialGradient(jp.x, jp.y, 0, jp.x, jp.y, jr);
      gr.addColorStop(0, "rgba(154,168,255,0.55)"); gr.addColorStop(1, "rgba(154,168,255,0)");
      cx.beginPath(); cx.arc(jp.x, jp.y, jr, 0, 6.2832); cx.fillStyle = gr; cx.fill();
    }
    cx.font = "500 10px system-ui, sans-serif"; cx.fillStyle = ring.built ? "#8f9bc4" : "#4e5872";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(ring.label, jp.x, jp.y + jr + 5);
    if (g) hits.push({ x:jp.x, y:jp.y, r:jr + 4, kind:"gate", data:g });
  });

  // Вставшая платформа перестаёт быть корабликом. Она села, а не зависла над
  // камнем, и отмечается тем же значком, что филиал на планете: квадратик
  // цвета компании на ободе. Одна ось опознания на всю сцену — цвет отвечает
  // на "чьё это", а форма кораблика означала бы, что он всё ещё летит.
  s.stations.forEach((st) => {
    const t = st.dest.ref as Rock, base = posOf(t, mx, my), off = t.s + 5;
    const x = base.x + Math.cos(st.ang) * off, y = base.y + Math.sin(st.ang) * off;
    cx.fillStyle = st.color; cx.fillRect(x - 2.5, y - 2.5, 5, 5);
    // Камень сам по себе ничей; герб над ним — того государства, чья контора
    // на нём сидит. Подпись у астероида снизу, поэтому щит сверху.
    if (flags) crest(base.x, base.y - t.s - 10, 5, realmOfCorp(corps[st.vent.lead]));
    hits.push({ x:x, y:y, r:9, kind:"vent", data:st.vent });
  });

  // Вставший спутник — не кораблик: он никуда не летит и не полетит больше
  // никогда. Он ОБХОДИТ свою планету (satPos), цветом хозяина, с подписью
  // «телескоп» или «телескоп, лазер». Тот, что ещё в пути, рисуется корабликом
  // ниже.
  s.sats.forEach((sat) => {
    if (!sat.live) return;
    const p = satPos(sat, mx, my);
    ship(sat.armed ? "satgun" : "sat", p.x, p.y, 7, p.a + 1.5708, sat.color);
    if (flags) crest(p.x, p.y - 14, 4.6, realmOfCorp(corps[sat.owner]));
    tiny(p.x, p.y + 12, "телескоп Mk" + sat.mark + (sat.armed ? ", лучемёт" : ""), "#7f8cb4");
    hits.push({ x:p.x, y:p.y, r:11, kind:"sat", data:sat });
  });

  // Верфь вращается вокруг СВОЕЙ планеты, выше дорожек стоянки. Рисуется
  // голова очереди с дугой готовности; сколько ждёт следом — числом рядом.
  shipyards.filter((y) => y.world.sys === s.id).forEach((yard) => {
    const yp = yardPos(yard, mx, my), x = yp.x, y = yp.y;
    const head = yard.queue.find((b) => b.left > 0) || yard.queue[0];
    const done = head ? 1 - Math.max(0, head.left) / head.total : 0;
    // Три крана-захвата: видно, что корабль ДЕРЖАТ, а не что он летит — среди
    // сплошных кружков (планеты, стоянки, предприятия) форма читается сразу.
    // Захваты загораются по одному: готовность видна и без дуги.
    const idle = yard.owner >= 0 ? corps[yard.owner].color : "#2b3557";
    if (yard.scrap) scrapYard(x, y, yard.ang, idle, head, done, yard.crew > 0);
    else for (let k = 0; k < 3; k++) {
      const a = yard.ang * 2 + glow * 0.2 + k * 2.0944;
      const cxo = Math.cos(a), cyo = Math.sin(a);
      const lit = head && k / 3 < done;
      cx.beginPath();
      cx.moveTo(x + cxo * 3.5, y + cyo * 3.5);
      cx.lineTo(x + cxo * 11, y + cyo * 11);
      cx.strokeStyle = lit ? head.color : idle; cx.lineWidth = 2; cx.lineCap = "round"; cx.stroke();
      cx.beginPath(); cx.arc(x + cxo * 11, y + cyo * 11, 2.1, 0, 6.2832);
      cx.fillStyle = lit ? head.color : idle; cx.fill();
    }
    if (head) {
      cx.globalAlpha = 0.4 + done * 0.6;
      // Размер — по ступени корпуса, как у всех кораблей: у стапеля видно, что
      // собирают не хлебовоз Mk1, а что-то просторнее.
      ship(head.glyph, x, y, 5.4 * hullScale(head.parts), 0, head.color);
      cx.globalAlpha = 1;
    }
    if (yard.queue.length > 1) tiny(x + 15, y - 9, "+" + (yard.queue.length - 1), "#6f7c9e");
    if (U.pick && U.pick.data === yard) caption(x, y, yardLines(yard), "#8f9bc4");
    else tiny(x, y + 15, yard.scrap ? "стапель" : "верфь", yard.crew > 0 ? "#7f8cb4" : "#4e5872");
    hits.push({ x:x, y:y, r:14, kind:"yard", data:yard });
  });

  // Военные корабли этой системы. Они НЕ летят и потому не таскаются по
  // экрану: стоят на дальней орбите своей планеты — или у звезды, если планеты
  // у них тут нет, — и медленно обходят её. Цвет говорит, чьи; звезда над
  // казённым — что это полиция, а не частная охрана.
  warships.filter((ws) => { return ws.sys === s.id; }).forEach((ws, i) => {
    const own = ws.owner >= 0 ? corps[ws.owner] : null;
    const base = own && own.home && own.home.sys === s.id ? own.home.body
               : s.bodies.find((b) => { return b.world; });
    const bp = base ? posOf(base, mx, my) : { x:mx, y:my };
    const off = (base ? base.rad : 20) + 26 + (i % 3) * 7;
    const a = ws.ang + glow * 0.09;
    const x = bp.x + Math.cos(a) * off, y = bp.y + Math.sin(a) * off;
    const col = own ? own.color : "#8894ae";
    drawWarship(ws, x, y, a, col);
    if (U.pick && U.pick.data === ws) caption(x, y, warLines(ws, own ? own.name : "государство"), col);
    else tiny(x, y, ws.captain, col);
    hits.push({ x:x, y:y, r:11, kind:"warship", data:ws });
  });

  s.ships.forEach((sh) => {
    cx.beginPath();
    sh.trail.forEach((p, j) => { j ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); });
    cx.strokeStyle = sh.color; cx.globalAlpha = 0.22; cx.lineWidth = 1.3; cx.stroke(); cx.globalAlpha = 1;
    // вылет и прилёт: корабль вырастает из точки у родной планеты и сжимается
    // в точку у цели; так видно, что он ОТТУДА и что он ТУДА сел
    const g = grow(clamp(vis(sh), 0, 1));
    // Корабль тем крупнее, чем просторнее его корпус (hullScale, data.ts):
    // ступень видно на глаз, не открывая карточку.
    const hs = sh.size * hullScale(sh.parts);
    if (g > 0.02) {
      flame(sh.x, sh.y, hs * g, sh.ang);
      ship(sh.glyph, sh.x, sh.y, hs * g, sh.ang, sh.color);
      // Флаг растёт и тает вместе с кораблём: щит, висящий над точкой, из
      // которой корабль ещё не вышел, читался бы как отдельная вещь. Отступ
      // отсчитывается от РАЗМЕРА корпуса — иначе щит ложится кораблю на нос.
      if (flags) crest(sh.x, sh.y - (hs + 9) * g, 4.2 * g, realmOfShip(sh));
    }
    if (U.pick && U.pick.data === sh) caption(sh.x, sh.y, windowLines(sh, false), sh.color);
    else tiny(sh.x, sh.y, sh.captain, sh.color);
    hits.push({ x:sh.x, y:sh.y, r:11 + hs * 0.25, kind:"ship", data:sh });
  });

  // стоянка: отработанные транспортники висят на орбите своего мира, тускло
  docks.forEach((d, i) => {
    if (d.sys !== s.id) return;
    const b = d.world.body, p = posOf(b, mx, my);
    // Корабли на стоянке ЛЕТАЮТ вокруг своего мира, а не висят приклеенными.
    // Планеты в игре стоят на местах (см. журнал), движутся только корабли —
    // и это как раз корабли. Прежние 0.03 рад/с давали оборот за три с
    // половиной минуты, то есть неподвижность; теперь круг за 24-39 секунд.
    // Ближняя дорожка быстрее дальней, как и положено на орбите.
    const lane = d.lane || 0;
    const a = d.ang + glow * (0.26 - lane * 0.05), off = b.rad + 13 + lane * 4;
    const x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
    cx.globalAlpha = 0.55;
    const ds = 3.4 * hullScale(d.parts);
    ship("cargo", x, y, ds, a + 1.5708, d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    cx.globalAlpha = 1;
    if (U.pick && U.pick.data === d) caption(x, y, dockLines(d), d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    else tiny(x, y, d.captain, "#5d6881");
    hits.push({ x:x, y:y, r:6 + ds, kind:"dock", data:d });
  });

  voyages.forEach((v) => {
    if (v.sysFrom !== undefined || v.from.sys !== s.id || v.to.sys !== s.id) return;
    const a = posOf(v.from.body, mx, my), b = posOf(v.to.body, mx, my), k = clamp(vis(v), 0, 1);
    const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    const rotc = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;   // носом к цели, как все
    const gc = 6 * hullScale(v.parts) * grow(k);
    if (gc > 0.12) {
      flame(x, y, gc, rotc); ship("cargo", x, y, gc, rotc, v.color);
      if (flags) crest(x, y - 2.9 * gc, 0.7 * gc, realmOfVoyage(v));
    }
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12, kind:"cargo", data:v });
    // Бой за рейс между мирами идёт ЗДЕСЬ, у самого рейса: вольница бьёт
    // хлебовозы у себя дома (battle.ts, raidHunt). На карте галактики такой
    // бой жмётся к узлу звезды, а смотреть на него — в системе.
    if (v.fight !== undefined) {
      const f = fights.find((o) => { return o.id === v.fight; });
      if (f) {
        drawFight(f, x, y, 1);
        if (U.pick && U.pick.data === f)
          caption(x, y, fightLines(f, corps[f.raider] ? corps[f.raider].name : "неизвестные"), "#ff8b5e");
        hits.push({ x:x, y:y, r:22, kind:"fight", data:f });
      }
    }
  });

  // Межзвёздные рейсы, пока они ещё ВНУТРИ этой системы (legIn). Первые 15% пути —
  // уход от планеты к своему створу, последние 15% — выход из створа к цели.
  // Раньше корабль правил в пустой край в сторону нужной звезды: ворота стояли
  // отдельно, корабль летел мимо них, и переход выглядел так, будто портал
  // здесь ни при чём. Теперь курс ведёт РОВНО в те ворота, что открывают
  // дорогу к цели, — а под движками, где ворот нет, всё как было.
  const net = spread(s.id);
  const edge = (to: number): { x: number; y: number } => {
    const via = net.via[to];
    const a = gateAng(s.id, via === undefined ? to : via);
    return { x:mx + Math.cos(a) * s.gateR, y:my + Math.sin(a) * s.gateR };
  };
  voyages.forEach((v) => {
    const leg = legIn(v, s.id);                           // внутрисистемные уже нарисованы
    if (leg === null) return;
    const ends = endsOf(v), out = s.id === ends.from;
    let a, b;
    if (out) {
      a = posOf(v.sysFrom !== undefined ? s.bodies[0] : v.from.body, mx, my);
      b = edge(ends.to);
    } else {
      a = edge(ends.from);
      b = posOf(v.sysFrom !== undefined ? s.bodies[0] : v.to.body, mx, my);
    }
    const x = a.x + (b.x - a.x) * leg, y = a.y + (b.y - a.y) * leg;
    const rot = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;
    // Клик по такому рейсу открывает окно межзвёздного корабля (kind
    // "jumpship"), а РИСУЕТСЯ он тем, чем является: стреловидный корпус —
    // только у портального, спутник — спутником, остальное — грузовиком.
    const isJump = v.kind === "gate" || v.kind === "reloc";
    const glyph = v.kind === "gate" || (v.kind === "reloc" && v.cargo === "gate") ? "jump"
                : v.cargo === "sat" ? "sat" : "cargo";
    const hull = hullScale(v.parts);
    if (S.move.key === "drives") {
      // Под движками у края нет створа — корабль сам рвёт пространство. На
      // вылете перед ним раскрывается дыра, он вытягивается и уходит в неё;
      // на прилёте дыра ещё открыта, из неё выползает искажённый корабль, и
      // она затягивается за ним.
      const open = out ? clamp((leg - 0.5) / 0.3, 0, 1) : 1 - clamp((leg - 0.1) / 0.35, 0, 1);
      const pull = out ? clamp((leg - 0.62) / 0.38, 0, 1) : 1 - clamp(leg / 0.3, 0, 1);
      rift(out ? b.x : a.x, out ? b.y : a.y, 15, open);
      const sz = 6.5 * hull * (out ? grow(leg, 0.45, 0.12) : grow(leg, 0.1, 0.45));
      if (sz > 0.12) {
        warped(glyph, x, y, sz, rot, v.color, pull);
        if (flags) crest(x, y - 2.9 * sz, 0.7 * sz * (1 - pull), realmOfVoyage(v));
      }
    } else {
      // вылет — растёт из точки у планеты, прилёт — сжимается в точку у цели;
      // со стороны створа корабль не анимируется: он там просто уходит
      const sz = 6.5 * hull * (out ? grow(leg, 0.45, 0) : grow(leg, 0, 0.45));
      if (sz > 0.12) {
        flame(x, y, sz, rot);
        ship(glyph, x, y, sz, rot, v.color);
        if (flags) crest(x, y - 2.9 * sz, 0.7 * sz, realmOfVoyage(v));
      }
    }
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12, kind:isJump ? "jumpship" : "cargo", data:v });
  });
  cx.restore();
}

export function nodeR(s: Sys): number { return 5 + Math.min(5, (s.mines + s.bodies.filter((b) => { return b.world; }).length) * 1.2); }
/** Видно ли звезду ИГРОКУ. Ровно одно правило и никаких поблажек: государство
 *  видит систему, когда её карта есть у трёх контор (charts.ts). Никаких
 *  «далёких точек на краю» больше нет — карта государства обрывается там, где
 *  кончается его знание, и за этим краем пустой фон. Раньше тут светилась
 *  россыпь недостижимых звёзд, и она отвечала на вопрос, которого государство
 *  задать не может: оно не знает, что они есть. */
export function seenSys(s: Sys): boolean { return seenByState(s.id); }

// ---- камера карты -------------------------------------------------------
// Карта держит в кадре ТО, ЧТО ГОСУДАРСТВО ЗНАЕТ, а не всю галактику. Пока
// известны две звезды, они и занимают экран: раньше вид по умолчанию был
// рассчитан на все пятьдесят, и две известные звезды слипались в точку посреди
// пустого холста. Отдалить дальше рамки известного нельзя — за ней для
// государства ничего нет (seenSys); приблизить можно в ZOOM_IN раз. Открылась
// новая звезда — рамка раздвигается сама, если игрок карту не трогал; тронул —
// его вид остаётся, только не шире рамки и центром не за её краем.

/** Во сколько раз карту можно приблизить сверх рамки известного. */
export const ZOOM_IN = 4;
/** Поля кадра под подписи, пипки и гербы крайних звёзд, в точках экрана. */
const FIT_PADX = 64, FIT_PADY = 60;
/** Самая узкая рамка в единицах карты. Одна-две близкие звезды иначе
 *  растянулись бы на весь экран, и пропала бы мера расстояний: круг телескопа
 *  и зона охоты вольницы — настоящие расстояния, и они должны влезать. */
const FIT_SPAN = 140;

/** Кадр, в который помещается всё известное: масштаб, сдвиг и рамка (в
 *  единицах карты), за край которой центр вида не уводится. */
export function camFit(): { k: number; x: number; y: number; x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  systems.forEach((s) => {
    if (!seenSys(s)) return;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
  });
  if (x0 > x1) { x0 = x1 = CW / 2; y0 = y1 = CH / 2; }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const w = Math.max(FIT_SPAN, x1 - x0), h = Math.max(FIT_SPAN, y1 - y0);
  const k = Math.min((CW - 2 * FIT_PADX) / w, (CH - 2 * FIT_PADY) / h);
  return { k:k, x:CW / 2 - mx * k, y:CH / 2 - my * k,
           x0:mx - w / 2, y0:my - h / 2, x1:mx + w / 2, y1:my + h / 2 };
}

/** Навести камеру перед кадром: не тронутую игроком — ровно на рамку
 *  известного, тронутую — не шире рамки и центром не за её краем. */
export function aimCam(): void {
  const fit = camFit();
  if (!cam.free) { cam.k = fit.k; cam.x = fit.x; cam.y = fit.y; return; }
  cam.k = clamp(cam.k, fit.k, fit.k * ZOOM_IN);
  const vx = clamp((CW / 2 - cam.x) / cam.k, fit.x0, fit.x1);
  const vy = clamp((CH / 2 - cam.y) / cam.k, fit.y0, fit.y1);
  cam.x = CW / 2 - vx * cam.k; cam.y = CH / 2 - vy * cam.k;
}

export function drawMap(): void {
  // Как и в системе: щиты только после первого отделения и только там, где
  // чужое государство есть. Звезда считается чужой, если на ней лежит хоть один
  // мир не родного государства; рейс несёт щит, если он сам чужой или летит
  // от такой звезды или к ней — рядом с чужим гербом видно, чей свой.
  const flags = manyRealms();
  const alien: Record<number, boolean> = {};
  if (flags) systems.forEach((s) => {
    alien[s.id] = s.bodies.some((b) => b.world && realmOf(b.world) !== HOME);
  });
  hits.length = 0;
  cx.fillStyle = "#080d19"; cx.fillRect(0, 0, CW, CH);
  // Пятьдесят звёзд в один экран не влезают читаемо, поэтому карта таскается
  // мышью и приближается колесом. Всё, что ниже, рисуется в координатах
  // КАРТЫ; попадания по клику пересчитываются обратно в них же.
  aimCam();
  cx.save(); cx.translate(cam.x, cam.y); cx.scale(cam.k, cam.k);
  setUiz(1 / cam.k);             // дальше всё, что не расстояние, ужимается на зум
  // Пунктир — докуда дотягивается нынешняя марка. Он и показывает край:
  // дальние звёзды видны, но линий к ним нет, пока не осилят следующую.
  const range = galaxyRange();
  if (range > 0) {
    systems.forEach((s) => {
      if (!seenSys(s)) return;
      within(s.id, range).forEach((n) => {
        if (!seenSys(systems[n]) || n < s.id) return;      // за край карты линий не проводят
        cx.beginPath(); cx.moveTo(s.x, s.y); cx.lineTo(systems[n].x, systems[n].y);
        cx.strokeStyle = "#212b45";
        cx.setLineDash([2 * uiz, 5 * uiz]); cx.lineWidth = uiz; cx.stroke(); cx.setLineDash([]);
      });
    });
  }
  // Маршруты с воротами: сеть видна ребром, а не догадкой. Строящийся —
  // пунктиром: портальный корабль ещё в пути.
  Object.keys(gates).forEach((k) => {
    const g = gates[k], a = systems[g.a], b = systems[g.b];
    if (!a || !b || !seenSys(a) || !seenSys(b)) return;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
    if (g.built) { cx.strokeStyle = "#5b6bb0"; cx.lineWidth = 2 * uiz; cx.stroke(); }
    else {
      cx.strokeStyle = "#3f4a78"; cx.lineWidth = 1.4 * uiz;
      cx.setLineDash([3 * uiz, 5 * uiz]); cx.stroke(); cx.setLineDash([]);
    }
  });
  voyages.forEach((v) => {
    let a, b;
    // прыжковые, открыватели и грузовики с деталями летят между СИСТЕМАМИ и
    // несут sysFrom/to; хлебовозы и переселенцы — между мирами
    if (v.sysFrom !== undefined) { a = systems[v.sysFrom]; b = systems[v.to]; }
    else { a = systems[v.from.sys]; b = systems[v.to.sys]; if (a === b) return; }
    // Рейс за край карты не рисуется: он ушёл туда, где для государства нет
    // ничего. Корабль пропадает из виду — и это правда, а не пропуск.
    if (!seenSys(a) || !seenSys(b)) return;
    const k = clamp(vis(v), 0, 1);
    // Клик по такому рейсу открывает окно межзвёздного корабля (kind
    // "jumpship"), а РИСУЕТСЯ он тем, чем является: стреловидный корпус —
    // только у портального, спутник — спутником, остальное — грузовиком.
    const isJump = v.kind === "gate" || v.kind === "reloc";
    const glyph = v.kind === "gate" || (v.kind === "reloc" && v.cargo === "gate") ? "jump"
                : v.cargo === "sat" ? "sat" : "cargo";
    // Прыжок идёт ДУГОЙ, а не по линейке: прямая между звёздами читается как
    // чертёж, дуга — как полёт. Изгиб тем сильнее, чем длиннее перегон, а
    // сторона постоянна для пары звёзд, чтобы встречные не сливались в нить.
    const dxm = b.x - a.x, dym = b.y - a.y, lenm = Math.hypot(dxm, dym) || 1;
    // Дуга у ВСЕХ межзвёздных рейсов, не только у прыжковых: под воротами
    // прыжковых кораблей не бывает вовсе, а лететь между звёздами всё равно
    // летают — хлебовозы, детали, перегоны. У них изгиб мягче.
    const bend = Math.min(34, lenm * (isJump ? 0.16 : 0.09)) * (((a.id + b.id) % 2) ? 1 : -1);
    const cpx = (a.x + b.x) / 2 - dym / lenm * bend, cpy = (a.y + b.y) / 2 + dxm / lenm * bend;
    const at = (u: number) => ({ x: (1-u)*(1-u)*a.x + 2*(1-u)*u*cpx + u*u*b.x,
                                 y: (1-u)*(1-u)*a.y + 2*(1-u)*u*cpy + u*u*b.y });
    const pt = at(k), x = pt.x, y = pt.y;
    cx.beginPath(); cx.moveTo(a.x, a.y);
    // управляющая точка ПОДкривой от 0 до k, иначе пройденный след не ляжет на дугу
    if (bend) cx.quadraticCurveTo(a.x + (cpx - a.x) * k, a.y + (cpy - a.y) * k, x, y);
    else cx.lineTo(x, y);
    cx.strokeStyle = v.color; cx.globalAlpha = 0.3; cx.lineWidth = 1.2 * uiz; cx.stroke(); cx.globalAlpha = 1;
    // тающий след за прыжковым: несколько точек позади вдоль той же дуги
    for (let q = 1; q <= (isJump ? 6 : 4); q++) {
      const u = k - q * 0.012;
      if (u <= 0) break;
      const sp = at(u);
      cx.beginPath(); cx.arc(sp.x, sp.y, (2.4 - q * 0.3) * uiz, 0, 6.2832);
      cx.fillStyle = v.color; cx.globalAlpha = 0.3 * (1 - q / 7); cx.fill(); cx.globalAlpha = 1;
    }
    const nx = at(Math.min(1, k + 0.01));
    const rot = Math.atan2(nx.y - y, nx.x - x) + 1.5708;
    // те же взлёт и посадка, что в системе: из точки у звезды-отправителя и в
    // точку у звезды-получателя — иначе одно и то же движение выглядит
    // по-разному на двух видах
    const szm = 6.5 * uiz * hullScale(v.parts) * grow(k, 0.08, 0.08);
    if (szm > 0.12) {
      flame(x, y, szm, rot); ship(glyph, x, y, szm, rot, v.color);
      const rv = flags ? realmOfVoyage(v) : HOME;
      if (flags && (rv !== HOME || alien[a.id] || alien[b.id])) crest(x, y - 2.9 * szm, 0.7 * szm, rv);
    }
    // на карте рейсов десятки — подпись только у выбранного и у того, над
    // которым мышь, иначе карта превращается в кашу из окошек
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12 * uiz, kind:isJump ? "jumpship" : "cargo", data:v });
  });
  // Бои. Рисуются ПОСЛЕ рейсов и ДО звёзд: бой идёт между звёзд, он важнее
  // одного рейса и не должен теряться под узлом системы.
  fights.forEach((f) => {
    const at = systems[f.sys];
    // Карта показывает только известное: бой у звезды, которой государство не
    // знает, выдал бы саму звезду.
    if (!at || !seenSys(at)) return;
    // Бой за рейс ВНУТРИ системы стоит ровно в узле звезды и накрыл бы её
    // собой. Он отодвигается вбок, за пипки филиалов: видно и то, что дерутся
    // у этой звезды, и саму звезду.
    //
    // Отодвигается не только тот, что ровно в узле. Логово вольницы стоит В
    // СИСТЕМЕ, и на рейс она выходит чаще всего сразу за вылетом: первые
    // проценты межзвёздного пути лежат ПОД самим значком звезды — под ядром,
    // ореолом и пипками филиалов. Раньше порог был «ближе единицы», то есть
    // вчетверо меньше того места, которое звезда занимает собой: замер по
    // шести партиям на триста лет — 138 межзвёздных боёв из 278 начинались
    // под значком, и половины перехватов игрок не видел вовсе. Корабль
    // пропадал у столицы, а боя на карте не было. Считается по
    // НАРИСОВАННОМУ размеру узла (nodeR плюс ореол и пипки): прячет корабль
    // именно он.
    const near = (nodeR(at) + 14) * uiz;
    const home = Math.hypot(f.x - at.x, f.y - at.y) < near;
    const x = home ? at.x + 30 * uiz : f.x, y = home ? at.y - 30 * uiz : f.y;
    drawFight(f, x, y, uiz);
    if (U.pick && U.pick.data === f)
      caption(x, y, fightLines(f, corps[f.raider] ? corps[f.raider].name : "неизвестные"), "#ff8b5e");
    hits.push({ x:x, y:y, r:22 * uiz, kind:"fight", data:f });
  });
  systems.forEach((s) => {
    // Звезда — ЗНАЧОК системы, а не тело с размером: ужимается на зум, чтобы
    // при приближении узлы расходились, а не разбухали в пятна. Зона охоты
    // вольницы (45) ужиматься НЕ должна — это настоящее расстояние в космосе.
    const r = nodeR(s) * uiz;
    // Звезды, которой государство не знает, на карте НЕТ ВОВСЕ — ни точки, ни
    // кольца, ни подписи «неизведанная». Это и есть главное правило карты: она
    // показывает не галактику, а то, что государству известно про галактику.
    if (!seenSys(s)) return;
    if (s.pulse > 0) {
      cx.beginPath(); cx.arc(s.x, s.y, r + (6 + (1 - s.pulse) * 22) * uiz, 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.globalAlpha = s.pulse * 0.7; cx.lineWidth = 1.6 * uiz; cx.stroke(); cx.globalAlpha = 1;
    }
    if (U.view.sys === s.id) {
      cx.beginPath(); cx.arc(s.x, s.y, r + 10 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3d4a70"; cx.lineWidth = uiz; cx.stroke();
    }
    // логово вольницы: красное кольцо — зона охоты, мимо лучше не летать
    if (corps.some((c) => { return c.pirate && c.home && c.home.sys === s.id; })) {
      cx.beginPath(); cx.arc(s.x, s.y, 45, 0, 6.2832);
      cx.strokeStyle = "#ff5c5c"; cx.globalAlpha = 0.35; cx.setLineDash([4 * uiz, 6 * uiz]); cx.lineWidth = 1.2 * uiz;
      cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
    }
    // Звезда со спутником: квадратик цвета хозяина сбоку от узла — та же ось
    // опознания, что у филиалов на планете и у платформ на камнях. Отсюда на
    // карте видно, ЧЕМ открыта галактика и кто смотрел. Вокруг такой звезды —
    // бледный круг дальности телескопа: он и объясняет, почему карта кончается
    // именно здесь, и почему следующий спутник ставят туда, а не сюда.
    const live = s.sats.filter((sat) => { return sat.live; });
    if (live.length) {
      // Круг — по ДАЛЬНОЗОРКОСТИ лучшего телескопа в системе: у Mk1 он мал, у
      // Mk4 накрывает пол-экрана, и разницу между ступенями видно сразу.
      const sight = live.reduce((a, sat) => { return Math.max(a, sat.range); }, 0);
      cx.beginPath(); cx.arc(s.x, s.y, sight, 0, 6.2832);
      cx.strokeStyle = "#2a3c66"; cx.globalAlpha = 0.5; cx.lineWidth = uiz;
      cx.setLineDash([1.5 * uiz, 6 * uiz]); cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
    }
    live.forEach((sat, i) => {
      cx.fillStyle = sat.color;
      cx.fillRect(s.x + (r + 4 + i * 4) * uiz - 1.5 * uiz, s.y - r - 4 * uiz, 3 * uiz, 3 * uiz);
    });
    const gs = gatesAt(s.id);
    if (gs.some((g) => { return g.built; })) {   // в сети: до неё долетит хлебовоз
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.lineWidth = 1.6 * uiz; cx.stroke();
    } else if (gs.length) {
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3f4a78"; cx.setLineDash([2 * uiz, 4 * uiz]); cx.lineWidth = 1.4 * uiz; cx.stroke(); cx.setLineDash([]);
    }
    // Звёзды шести цветов, как в Master of Orion 2 (starOf, galaxy.ts): корона и
    // ядро — цветом класса. Размер узла от класса НЕ зависит: на карте звезда —
    // значок системы, а не тело (см. nodeR).
    const sc = starOf(s);
    const g = cx.createRadialGradient(s.x, s.y, uiz, s.x, s.y, r + 9 * uiz);
    g.addColorStop(0, sc.core); g.addColorStop(0.45, "rgba(" + sc.rgb + ",0.6)"); g.addColorStop(1, "rgba(" + sc.rgb + ",0)");
    cx.beginPath(); cx.arc(s.x, s.y, r + 9 * uiz, 0, 6.2832); cx.fillStyle = g; cx.fill();
    // Ядро звезды: у столичной системы — звёздочка, у прочих кружок. Знак тот
    // же, что на диске самой столицы в виде системы, и место у него то же —
    // центр узла, куда не заезжают ни пипки филиалов (r+13), ни подписи.
    if (S.home && S.home.sys === s.id) star(s.x, s.y, r * 1.15, sc.core);
    else { cx.beginPath(); cx.arc(s.x, s.y, r * 0.5, 0, 6.2832); cx.fillStyle = sc.core; cx.fill(); }
    const ws = s.bodies.filter((b) => { return b.world; }), here: Record<number, number> = {};
    ws.forEach((b) => { b.world.branches.forEach((br) => { here[br.corp] = 1; }); });
    const ids = Object.keys(here);
    ids.forEach((id, i) => {
      const a = -1.5708 + i * (6.2832 / Math.max(1, ids.length));
      cx.beginPath(); cx.arc(s.x + Math.cos(a) * (r + 13 * uiz), s.y + Math.sin(a) * (r + 13 * uiz), 3.2 * uiz, 0, 6.2832);
      cx.fillStyle = corps[+id].color; cx.fill();
    });
    // Гербы государств, у которых в этой системе есть мир. Их может быть
    // несколько на одну звезду: отделившаяся планета не уводит из государства
    // соседнюю по системе, и на карте это самое важное, что о звезде можно
    // знать. Ряд идёт ВЫШЕ пипок филиалов (r + 13), иначе первая из них —
    // она смотрит ровно вверх — накрыла бы щит. У звезды, где все миры свои,
    // ряда нет: одна золотая звезда над ней ничего не различает.
    if (alien[s.id]) {
      const mine: number[] = [];
      ws.forEach((b) => { const r2 = realmOf(b.world); if (mine.indexOf(r2) < 0) mine.push(r2); });
      mine.forEach((r2, i) => {
        crest(s.x + (i - (mine.length - 1) / 2) * 13 * uiz, s.y - (r + 25) * uiz, 5.5 * uiz, r2);
      });
    }
    hits.push({ x:s.x, y:s.y, r:26 * uiz, kind:"sys", data:s });
    const capital = S.home && S.home.sys === s.id;
    cx.font = (capital ? "600 " : "500 ") + (10 * uiz) + "px system-ui, sans-serif";
    cx.fillStyle = capital ? "#e4e9f4" : "#9aa5bd";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(s.name, s.x, s.y + r + 13 * uiz);
    const popHere = ws.reduce((a2, b) => { return a2 + popOf(b.world); }, 0);
    if (ws.length) {
      cx.font = "500 " + (9 * uiz) + "px system-ui, sans-serif"; cx.fillStyle = "#5d6881";
      cx.fillText(ws.length + " мир. · " + fmt(popHere) + " чел.", s.x, s.y + r + 24 * uiz);
    }
  });
  cx.restore(); setUiz(1);       // подсказки внизу рисуются уже без масштаба
  cx.font = "500 11px system-ui, sans-serif"; cx.fillStyle = "#4e5872";
  cx.textAlign = "left"; cx.textBaseline = "top";
  cx.fillText("клик по системе — внутрь, по кораблю — что везёт · тащить мышью, Ctrl+колесо — приблизить", 16, 16);
  if (cam.free) cx.fillText("×" + (cam.k / camFit().k).toFixed(1) + " · двойной клик вернёт вид", 16, 32);
}

export function frame(ts: number): void {
  // На паузе НИЧЕГО не шевелится. Фаза glow, по которой кружат стоянки, верфи
  // и военные корабли, дрожат огни и дышит звезда, идёт только пока идёт время
  // партии. Раньше она шла по настенным часам всегда, и империя, поставленная
  // на паузу, продолжала вращаться — пауза выглядела неработающей.
  const dt = !U.running ? 0 : last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
  advanceFrame(ts, dt);
  systems.forEach((s) => { advance(s, dt); });
  if (U.view.mode === "map") drawMap(); else drawSystem(systems[U.view.sys]);
  // Наземная битва — НАКЛАДКА поверх всего, и рисуется она последней, уже без
  // масштаба сцены: это не объект на карте, а окно в другое место. Битва,
  // которая кончилась, закрывается сама — смотреть больше не на что.
  if (U.battle) {
    if (U.battle.world.war !== U.battle) U.battle = null;
    else { setUiz(1); drawGround(U.battle); }
  }
  requestAnimationFrame(frame);
}

