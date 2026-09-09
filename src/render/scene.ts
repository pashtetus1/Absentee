
import { vis } from "../clock";
import { MARKRANGE } from "../data";
import { galaxyRange, within } from "../galaxy";
import { manyRealms, realmOf, realmOfCorp, realmOfShip, realmOfVoyage } from "../realm";
import { yardAt } from "../shipyard";
import { S, U, cam, corps, docks, gates, hits, shipyards, systems, voyages } from "../state";
import { gatesAt, inNet, otherEnd, portalAng, portalFor, spread } from "../travel";
import { clamp, dist, fmt } from "../util";
import { popOf } from "../world";
import { CH, CW, advanceFrame, cx, glow, last, setSysK, setUiz, uiz } from "./canvas";
import { advance, caption, crest, dockLines, flame, grow, posOf, rift, rock, ship, star, tiny, warped, windowLines, yardLines, yardPos } from "./models";
import type { Rock, Sys } from "../types";

// Куда смотрит створ: в сторону звёзд, к которым ведёт. Готовый створ стоит
// там, где встал; строящийся маршрут показывается на отведённом месте.
function gateAng(from: number, to: number): number{ return portalAng(from, to); }

export function drawSystem(s: Sys): void {
  const mx = CW / 2, my = CH / 2;
  // Гербы появляются на сцене только после первого отделения: пока государство
  // одно, щит над каждой планетой и каждым корабликом отвечает на вопрос,
  // которого никто не задавал. Считается ОДИН раз на кадр — иначе перебор
  // контор пришёлся бы на каждый нарисованный кружок.
  const flags = manyRealms();
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

  const pulse = 1 + Math.sin(glow * 0.7) * 0.04;
  const sg = cx.createRadialGradient(mx, my, 2, mx, my, 26 * pulse);
  sg.addColorStop(0, "#fff3d0"); sg.addColorStop(0.5, "#f2b33d"); sg.addColorStop(1, "rgba(242,179,61,0)");
  cx.beginPath(); cx.arc(mx, my, 26 * pulse, 0, 6.2832); cx.fillStyle = sg; cx.fill();
  cx.beginPath(); cx.arc(mx, my, 10, 0, 6.2832); cx.fillStyle = "#fff6dd"; cx.fill();

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
    for (let k = 0; k < 3; k++) {
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
      ship(head.glyph, x, y, 5.4, 0, head.color);
      cx.globalAlpha = 1;
    }
    if (yard.queue.length > 1) tiny(x + 15, y - 9, "+" + (yard.queue.length - 1), "#6f7c9e");
    if (U.pick && U.pick.data === yard) caption(x, y, yardLines(yard), "#8f9bc4");
    else tiny(x, y + 15, "верфь", yard.crew > 0 ? "#7f8cb4" : "#4e5872");
    hits.push({ x:x, y:y, r:14, kind:"yard", data:yard });
  });

  s.ships.forEach((sh) => {
    cx.beginPath();
    sh.trail.forEach((p, j) => { j ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); });
    cx.strokeStyle = sh.color; cx.globalAlpha = 0.22; cx.lineWidth = 1.3; cx.stroke(); cx.globalAlpha = 1;
    // вылет и прилёт: корабль вырастает из точки у родной планеты и сжимается
    // в точку у цели; так видно, что он ОТТУДА и что он ТУДА сел
    const g = grow(clamp(vis(sh), 0, 1));
    if (g > 0.02) {
      flame(sh.x, sh.y, sh.size * g, sh.ang);
      ship(sh.glyph, sh.x, sh.y, sh.size * g, sh.ang, sh.color);
      // Флаг растёт и тает вместе с кораблём: щит, висящий над точкой, из
      // которой корабль ещё не вышел, читался бы как отдельная вещь. Отступ
      // отсчитывается от РАЗМЕРА корпуса — иначе щит ложится кораблю на нос.
      if (flags) crest(sh.x, sh.y - (sh.size + 9) * g, 4.2 * g, realmOfShip(sh));
    }
    if (U.pick && U.pick.data === sh) caption(sh.x, sh.y, windowLines(sh, false), sh.color);
    else tiny(sh.x, sh.y, sh.captain, sh.color);
    hits.push({ x:sh.x, y:sh.y, r:13, kind:"ship", data:sh });
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
    ship("cargo", x, y, 3.4, a + 1.5708, d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    cx.globalAlpha = 1;
    if (U.pick && U.pick.data === d) caption(x, y, dockLines(d), d.corp >= 0 ? corps[d.corp].color : "#8894ae");
    else tiny(x, y, d.captain, "#5d6881");
    hits.push({ x:x, y:y, r:8, kind:"dock", data:d });
  });

  voyages.forEach((v) => {
    if (v.sysFrom !== undefined || v.from.sys !== s.id || v.to.sys !== s.id) return;
    const a = posOf(v.from.body, mx, my), b = posOf(v.to.body, mx, my), k = clamp(vis(v), 0, 1);
    const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    const rotc = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;   // носом к цели, как все
    const gc = 6 * grow(k);
    if (gc > 0.12) {
      flame(x, y, gc, rotc); ship("cargo", x, y, gc, rotc, v.color);
      if (flags) crest(x, y - 2.9 * gc, 0.7 * gc, realmOfVoyage(v));
    }
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12, kind:"cargo", data:v });
  });

  // Межзвёздные рейсы, пока они ещё ВНУТРИ этой системы. Первые 15% пути —
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
  const LEG = 0.15;
  voyages.forEach((v) => {
    const fromSys = v.sysFrom !== undefined ? v.sysFrom : v.from.sys;
    const toSys = v.sysFrom !== undefined ? v.to : v.to.sys;
    if (fromSys === toSys) return;                        // внутрисистемные уже нарисованы
    let t = clamp(vis(v), 0, 1), leg = null, a, b;
    if (s.id === fromSys && t < LEG) {
      const origin = v.sysFrom !== undefined ? s.bodies[0] : v.from.body;
      a = posOf(origin, mx, my);
      b = edge(toSys);
      leg = t / LEG;
    } else if (s.id === toSys && t > 1 - LEG) {
      const target = v.sysFrom !== undefined ? s.bodies[0] : v.to.body;
      a = edge(fromSys);
      b = posOf(target, mx, my);
      leg = (t - (1 - LEG)) / LEG;
    }
    if (leg === null) return;
    const x = a.x + (b.x - a.x) * leg, y = a.y + (b.y - a.y) * leg;
    const rot = Math.atan2(b.y - a.y, b.x - a.x) + 1.5708;
    const isJump = v.kind === "jump" || v.kind === "gate" || v.kind === "reloc";
    const out = s.id === fromSys;
    if (S.move.key === "drives") {
      // Под движками у края нет створа — корабль сам рвёт пространство. На
      // вылете перед ним раскрывается дыра, он вытягивается и уходит в неё;
      // на прилёте дыра ещё открыта, из неё выползает искажённый корабль, и
      // она затягивается за ним.
      const open = out ? clamp((leg - 0.5) / 0.3, 0, 1) : 1 - clamp((leg - 0.1) / 0.35, 0, 1);
      const pull = out ? clamp((leg - 0.62) / 0.38, 0, 1) : 1 - clamp(leg / 0.3, 0, 1);
      rift(out ? b.x : a.x, out ? b.y : a.y, 15, open);
      const sz = 6.5 * (out ? grow(leg, 0.45, 0.12) : grow(leg, 0.1, 0.45));
      if (sz > 0.12) {
        warped(isJump ? "jump" : "cargo", x, y, sz, rot, v.color, pull);
        if (flags) crest(x, y - 2.9 * sz, 0.7 * sz * (1 - pull), realmOfVoyage(v));
      }
    } else {
      // вылет — растёт из точки у планеты, прилёт — сжимается в точку у цели;
      // со стороны створа корабль не анимируется: он там просто уходит
      const sz = 6.5 * (out ? grow(leg, 0.45, 0) : grow(leg, 0, 0.45));
      if (sz > 0.12) {
        flame(x, y, sz, rot);
        ship(isJump ? "jump" : "cargo", x, y, sz, rot, v.color);
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
export function seenSys(s: Sys): boolean { return s.unlocked || within(s.id, Math.max(galaxyRange(), MARKRANGE[0])).some((n) => { return systems[n].unlocked; }); }

export function drawMap(): void {
  const flags = manyRealms();          // как и в системе: щиты только после первого отделения
  hits.length = 0;
  cx.fillStyle = "#080d19"; cx.fillRect(0, 0, CW, CH);
  // Пятьдесят звёзд в один экран не влезают читаемо, поэтому карта таскается
  // мышью и приближается колесом. Всё, что ниже, рисуется в координатах
  // КАРТЫ; попадания по клику пересчитываются обратно в них же.
  cx.save(); cx.translate(cam.x, cam.y); cx.scale(cam.k, cam.k);
  setUiz(1 / cam.k);             // дальше всё, что не расстояние, ужимается на зум
  // Пунктир — докуда дотягивается нынешняя марка. Он и показывает край:
  // дальние звёзды видны, но линий к ним нет, пока не осилят следующую.
  const range = galaxyRange();
  if (range > 0) {
    systems.forEach((s) => {
      if (!s.unlocked) return;
      within(s.id, range).forEach((n) => {
        if (systems[n].unlocked && n < s.id) return;
        cx.beginPath(); cx.moveTo(s.x, s.y); cx.lineTo(systems[n].x, systems[n].y);
        cx.strokeStyle = systems[n].unlocked ? "#212b45" : "#1a2340";
        cx.setLineDash([2 * uiz, 5 * uiz]); cx.lineWidth = uiz; cx.stroke(); cx.setLineDash([]);
      });
    });
  }
  // Маршруты с воротами: сеть видна ребром, а не догадкой. Строящийся —
  // пунктиром: портальный корабль ещё в пути.
  Object.keys(gates).forEach((k) => {
    const g = gates[k], a = systems[g.a], b = systems[g.b];
    if (!a || !b) return;
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
    const k = clamp(vis(v), 0, 1);
    const isJump = v.kind === "jump" || v.kind === "gate" || v.kind === "reloc";
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
    const szm = 6.5 * uiz * grow(k, 0.08, 0.08);
    if (szm > 0.12) {
      flame(x, y, szm, rot); ship(isJump ? "jump" : "cargo", x, y, szm, rot, v.color);
      if (flags) crest(x, y - 2.9 * szm, 0.7 * szm, realmOfVoyage(v));
    }
    // на карте рейсов десятки — подпись только у выбранного и у того, над
    // которым мышь, иначе карта превращается в кашу из окошек
    if (U.pick && U.pick.data === v) caption(x, y, windowLines(v, true), v.color);
    else tiny(x, y, v.captain, v.color);
    hits.push({ x:x, y:y, r:12 * uiz, kind:isJump ? "jumpship" : "cargo", data:v });
  });
  systems.forEach((s) => {
    // Звезда — ЗНАЧОК системы, а не тело с размером: ужимается на зум, чтобы
    // при приближении узлы расходились, а не разбухали в пятна. Зона охоты
    // вольницы (45) ужиматься НЕ должна — это настоящее расстояние в космосе.
    const r = nodeR(s) * uiz;
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
    if (corps.some((c) => { return c.pirate && c.home && c.home.sys === s.id; })) {
      cx.beginPath(); cx.arc(s.x, s.y, 45, 0, 6.2832);
      cx.strokeStyle = "#ff5c5c"; cx.globalAlpha = 0.35; cx.setLineDash([4 * uiz, 6 * uiz]); cx.lineWidth = 1.2 * uiz;
      cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
    }
    const gs = gatesAt(s.id);
    if (gs.some((g) => { return g.built; })) {   // в сети: до неё долетит хлебовоз
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#9aa8ff"; cx.lineWidth = 1.6 * uiz; cx.stroke();
    } else if (gs.length) {
      cx.beginPath(); cx.arc(s.x, s.y, r + 6 * uiz, 0, 6.2832);
      cx.strokeStyle = "#3f4a78"; cx.setLineDash([2 * uiz, 4 * uiz]); cx.lineWidth = 1.4 * uiz; cx.stroke(); cx.setLineDash([]);
    }
    const g = cx.createRadialGradient(s.x, s.y, uiz, s.x, s.y, r + 9 * uiz);
    g.addColorStop(0, "#fff3d0"); g.addColorStop(0.45, "rgba(242,179,61,0.55)"); g.addColorStop(1, "rgba(242,179,61,0)");
    cx.beginPath(); cx.arc(s.x, s.y, r + 9 * uiz, 0, 6.2832); cx.fillStyle = g; cx.fill();
    // Ядро звезды: у столичной системы — звёздочка, у прочих кружок. Знак тот
    // же, что на диске самой столицы в виде системы, и место у него то же —
    // центр узла, куда не заезжают ни пипки филиалов (r+13), ни подписи.
    if (S.home && S.home.sys === s.id) star(s.x, s.y, r * 1.15, "#fff6dd");
    else { cx.beginPath(); cx.arc(s.x, s.y, r * 0.5, 0, 6.2832); cx.fillStyle = "#fff6dd"; cx.fill(); }
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
    // она смотрит ровно вверх — накрыла бы щит.
    if (flags && ws.length) {
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
  if (cam.k !== 1 || cam.x || cam.y) cx.fillText("×" + cam.k.toFixed(1) + " · двойной клик вернёт вид", 16, 32);
}

export function frame(ts: number): void {
  const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
  advanceFrame(ts, dt);
  systems.forEach((s) => { advance(s, dt); });
  if (U.view.mode === "map") drawMap(); else drawSystem(systems[U.view.sys]);
  requestAnimationFrame(frame);
}

