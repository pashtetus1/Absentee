// ===================== как рисуется война =====================
//
// Три вещи, и каждая отвечает на свой вопрос.
//
// ВОЕННЫЙ КОРАБЛЬ на орбите — «кто здесь есть». Он не летит и потому не
// таскается по экрану: висит у своей планеты клином, цветом хозяина.
//
// БОЙ В КОСМОСЕ — «за что сейчас дерутся». Рисуется там, где перехватили: два
// строя корабликов и трассы между ними. По нему можно ткнуть и увидеть, кто с
// кем и сколько у кого осталось.
//
// НАЗЕМНАЯ БИТВА — «чем всё это кончится для планеты», и она нарочно сделана
// НАКЛАДКОЙ на полэкрана, как ground combat в Master of Orion 2: планета внизу,
// над ней клетки того, за что дерутся (фермы, цеха, лаборатории, теплицы,
// город), и две цепочки бойцов, идущие навстречу. Схематично, без анимации
// боя: это не тактика, в неё нельзя вмешаться. Смотреть на неё — то же самое,
// что смотреть на медленный сим вообще: ты видишь, как решается судьба мира, и
// не можешь тронуть ни одной фигуры.
//
// ЗАКРЫТЬ её можно и нужно: крестик в углу, и на сцене снова обычная система.

import { force, sideColor } from "../ground";
import { HOME, realmOf } from "../realm";
import { U, corps, hits, systems } from "../state";
import { clamp, fmt } from "../util";
import { CH, CW, cx, glow } from "./canvas";
import { poly, ship, star } from "./models";
import type { Fight, Ground, Warship } from "../types";

/** Клетка планеты: что на ней стоит. Значки нарочно грубые — они читаются на
 *  двенадцати пикселях, а не разглядываются. */
function tile(x: number, y: number, s: number, k: string, col: string): void {
  cx.save();
  cx.translate(x, y);
  cx.fillStyle = col; cx.strokeStyle = col; cx.lineWidth = 1.2; cx.lineJoin = "round";
  if (k === "farm") {                        // борозды поля
    for (let i = -1; i <= 1; i++) {
      cx.beginPath(); cx.moveTo(-s * 0.7, i * s * 0.35); cx.lineTo(s * 0.7, i * s * 0.35); cx.stroke();
    }
  } else if (k === "shop") {                 // цех: коробка с трубой
    poly([-s * 0.7, s * 0.5, -s * 0.7, -s * 0.2, 0, -s * 0.2, 0, s * 0.5]);
    poly([s * 0.15, s * 0.5, s * 0.15, -s * 0.6, s * 0.55, -s * 0.6, s * 0.55, s * 0.5]);
  } else if (k === "lab") {                  // лаборатория: колба
    cx.beginPath(); cx.moveTo(-s * 0.25, -s * 0.6); cx.lineTo(s * 0.25, -s * 0.6);
    cx.lineTo(s * 0.55, s * 0.5); cx.lineTo(-s * 0.55, s * 0.5); cx.closePath(); cx.fill();
  } else if (k === "dome") {                 // теплица: купол
    cx.beginPath(); cx.arc(0, s * 0.35, s * 0.6, Math.PI, 0); cx.closePath(); cx.fill();
  } else {                                   // город
    poly([-s * 0.7, s * 0.5, -s * 0.7, -s * 0.1, -s * 0.2, -s * 0.1, -s * 0.2, s * 0.5]);
    poly([-s * 0.05, s * 0.5, -s * 0.05, -s * 0.65, s * 0.35, -s * 0.65, s * 0.35, s * 0.5]);
    poly([s * 0.5, s * 0.5, s * 0.5, -s * 0.25, s * 0.8, -s * 0.25, s * 0.8, s * 0.5]);
  }
  cx.restore();
}

/** Ополчение считается в тех же человечках, что и население, а их на колонии
 *  бывает меньше одного: «0.0 из 0.1» читается как «никого против никого».
 *  Поэтому мелкие числа показываются с сотыми — один человечек это примерно
 *  миллиард людей, и сотая доля в бою вовсе не ноль. */
function men(n: number): string { return n < 1 ? n.toFixed(2) : fmt(n); }

/** Человечек ополчения. Их рисуют рядами, и по длине ряда видно, кого больше, —
 *  это и есть главное число битвы. */
function man(x: number, y: number, s: number, col: string): void {
  cx.fillStyle = col;
  cx.beginPath(); cx.arc(x, y - s * 0.75, s * 0.32, 0, 6.2832); cx.fill();
  poly([x - s * 0.34, y + s * 0.6, x - s * 0.34, y - s * 0.35, x + s * 0.34, y - s * 0.35, x + s * 0.34, y + s * 0.6]);
}

/** Накладка с наземной битвой: нижняя половина экрана. */
export function drawGround(g: Ground): void {
  const w = g.world;
  const top = Math.round(CH * 0.5), h = CH - top;
  cx.save();
  // Подложка СПЛОШНАЯ, а не полупрозрачная: сквозь неё просвечивали подписи
  // планет, и схема боя читалась как ещё один слой карты, а не как другое
  // место, куда ты зашёл посмотреть.
  cx.fillStyle = "#090d1a"; cx.fillRect(0, top, CW, h);
  cx.strokeStyle = "#26314f"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(0, top + 0.5); cx.lineTo(CW, top + 0.5); cx.stroke();

  const rebCol = sideColor(g, 1), govCol = sideColor(g, 0);
  cx.font = "600 14px system-ui, sans-serif"; cx.textAlign = "left"; cx.textBaseline = "top";
  cx.fillStyle = "#e4e9f4";
  cx.fillText("Наземная битва · " + w.body.name, 18, top + 14);
  cx.font = "500 11.5px system-ui, sans-serif"; cx.fillStyle = "#8894ae";
  cx.fillText(systems[w.sys].name + " · " + w.type.name + " · осталось месяцев " + Math.max(0, g.left) +
              " из " + g.total, 18, top + 33);

  // Крестик. Ровно там, где его ищут, и с запасом на палец: накладку
  // открывают на телефоне, и мимо неё промахиваться нельзя.
  const cxх = CW - 26, cyх = top + 22;
  cx.strokeStyle = "#8894ae"; cx.lineWidth = 1.6; cx.lineCap = "round";
  cx.beginPath();
  cx.moveTo(cxх - 6, cyх - 6); cx.lineTo(cxх + 6, cyх + 6);
  cx.moveTo(cxх + 6, cyх - 6); cx.lineTo(cxх - 6, cyх + 6);
  cx.stroke();
  hits.push({ x:cxх, y:cyх, r:18, kind:"warclose", data:g });

  // ---- стороны: числа и ряды ополчения --------------------------------
  const rowY = top + 66;
  const side = (x: number, name: string, col: string, s: { men: number; men0: number; arms: number }, right: boolean): void => {
    cx.textAlign = right ? "right" : "left";
    cx.font = "600 12.5px system-ui, sans-serif"; cx.fillStyle = col;
    cx.fillText(name, x, rowY);
    cx.font = "500 11.5px system-ui, sans-serif"; cx.fillStyle = "#8894ae";
    cx.fillText("ополчение " + men(s.men) + " из " + men(s.men0) +
                " · оружие " + (s.arms ? "Mk" + s.arms : "нет") +
                " · сила " + force(s).toFixed(1), x, rowY + 16);
    // Ряд человечков: доля от начального — сколько ещё держится.
    const n = 12, live = Math.round(clamp(s.men / Math.max(1e-6, s.men0), 0, 1) * n);
    for (let i = 0; i < n; i++) {
      const px = right ? x - i * 13 - 6 : x + i * 13 + 6;
      cx.globalAlpha = i < live ? 1 : 0.18;
      man(px, rowY + 48, 9, col);
    }
    cx.globalAlpha = 1;
  };
  side(18, "Восставшие · " + corps[g.corp].name, rebCol, g.reb, false);
  side(CW - 18, (realmOf(w) === HOME ? "Государство и корпорации" : "Корпорации"), govCol, g.gov, true);

  // ---- планета и клетки ------------------------------------------------
  // Планета — дугой по низу, как в наземных боях старых игр: видно, что дерутся
  // НА ней, а не в пустоте. Над дугой — то, за что дерутся.
  const py = CH + 90, pr = 200;
  const grad = cx.createRadialGradient(CW / 2, py, pr * 0.2, CW / 2, py, pr);
  grad.addColorStop(0, w.type.col); grad.addColorStop(1, "#131b2d");
  cx.beginPath(); cx.arc(CW / 2, py, pr, 0, 6.2832); cx.fillStyle = grad; cx.fill();
  cx.beginPath(); cx.arc(CW / 2, py, pr, 0, 6.2832);
  cx.strokeStyle = "#2a3550"; cx.lineWidth = 1; cx.stroke();

  const cols = Math.min(8, g.tiles.length), rows = Math.ceil(g.tiles.length / cols);
  const cellW = 74, cellH = 40, tileTop = top + h - 24 - rows * cellH;
  g.tiles.forEach((t, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, g.tiles.length - r * cols);
    const x = CW / 2 + (c - (inRow - 1) / 2) * cellW, y = tileTop + r * cellH + cellH / 2;
    const col = t.side ? rebCol : govCol;
    // Занятая клетка горит цветом стороны, а её рамка — та же линия фронта:
    // ровно по ней видно, как далеко зашли восставшие.
    cx.globalAlpha = 0.16;
    cx.fillStyle = col; cx.fillRect(x - cellW / 2 + 3, y - cellH / 2 + 2, cellW - 6, cellH - 4);
    cx.globalAlpha = 1;
    cx.strokeStyle = col; cx.lineWidth = 1; cx.globalAlpha = 0.5;
    cx.strokeRect(x - cellW / 2 + 3.5, y - cellH / 2 + 2.5, cellW - 7, cellH - 5);
    cx.globalAlpha = 1;
    tile(x, y - 3, 13, t.k, col);
    cx.font = "500 9px system-ui, sans-serif"; cx.fillStyle = "#6a7590";
    cx.textAlign = "center"; cx.textBaseline = "top";
    cx.fillText(({ farm:"поле", shop:"цех", lab:"лаборатория", dome:"теплица", town:"город" })[t.k] || t.k,
                x, y + cellH / 2 - 13);
  });

  // ---- чаша весов -------------------------------------------------------
  // Одна полоса на весь экран: какая доля СИЛЫ за кем. Сила — это люди на
  // оружие (force), и по полосе видно то, чего не видно по числам порознь:
  // вооружённое меньшинство может держать перевес, и тогда восстание
  // проиграет, даже будучи вдвое многочисленнее.
  const rs = force(g.reb), gs = force(g.gov), sum = rs + gs || 1;
  const barY = top + 124, barW = CW - 36;
  cx.fillStyle = govCol; cx.globalAlpha = 0.75;
  cx.fillRect(18, barY, barW, 9);
  cx.fillStyle = rebCol; cx.globalAlpha = 1;
  cx.fillRect(18, barY, barW * (rs / sum), 9);
  cx.globalAlpha = 1;
  cx.font = "500 10.5px system-ui, sans-serif"; cx.textBaseline = "top";
  cx.textAlign = "left"; cx.fillStyle = rebCol;
  cx.fillText("перевес " + Math.round(rs / sum * 100) + "%", 18, barY + 13);
  cx.textAlign = "right"; cx.fillStyle = govCol;
  cx.fillText(Math.round(gs / sum * 100) + "%", CW - 18, barY + 13);

  // ---- хроника ----------------------------------------------------------
  cx.textAlign = "left"; cx.textBaseline = "top";
  cx.font = "500 10.5px system-ui, sans-serif";
  g.log.slice(0, 3).forEach((line, i) => {
    cx.fillStyle = i ? "#5d6881" : "#8894ae";
    cx.fillText(line, 18, top + 156 + i * 14);
  });
  cx.restore();
}

/** Бой в космосе на карте или в системе: два строя и трассы между ними. */
export function drawFight(f: Fight, x: number, y: number, k: number): void {
  const attCol = corps[f.raider] ? corps[f.raider].color : "#ff5c5c";
  const defCol = f.def[0] ? f.def[0].color : "#8894ae";
  const gap = 15 * k;
  // Вспышки: бой виден издалека именно ими, а не корабликами в пиксель.
  const flick = 0.45 + 0.55 * Math.abs(Math.sin(glow * 4 + f.id));
  cx.save();
  cx.globalAlpha = 0.5 * flick;
  cx.strokeStyle = attCol; cx.lineWidth = 1.2 * k;
  cx.beginPath(); cx.moveTo(x - gap, y - gap * 0.4); cx.lineTo(x + gap, y + gap * 0.4); cx.stroke();
  cx.strokeStyle = defCol;
  cx.beginPath(); cx.moveTo(x + gap, y - gap * 0.4); cx.lineTo(x - gap, y + gap * 0.4); cx.stroke();
  cx.globalAlpha = 1;
  f.att.forEach((a, i) => {
    if (a.hp <= 0) return;
    ship("war", x - gap - i * 7 * k, y - gap * 0.4 - i * 3 * k, 6 * k, 1.5708, attCol);
  });
  f.def.forEach((d, i) => {
    if (d.hp <= 0) return;
    ship(d.prey ? "cargo" : "war", x + gap + i * 7 * k, y + gap * 0.4 + i * 3 * k, 6 * k, -1.5708, d.color);
  });
  // Кольцо вокруг всего этого: показывает, что тут не просто корабли, а бой.
  cx.beginPath(); cx.arc(x, y, gap * 1.9, 0, 6.2832);
  cx.strokeStyle = "#ff8b5e"; cx.globalAlpha = 0.35 * flick; cx.lineWidth = 1.3 * k;
  cx.setLineDash([3 * k, 4 * k]); cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
  cx.restore();
}

/** Военный корабль на орбите своей планеты. */
export function drawWarship(s: Warship, x: number, y: number, a: number, col: string): void {
  ship("war", x, y, 6.5, a + 1.5708, col);
  // Казённый носит звезду: полиция обязана отличаться от частной охраны, иначе
  // непонятно, чьи корабли стоят у планеты и на чьи деньги.
  if (s.owner < 0) { cx.globalAlpha = 0.8; star(x, y - 10, 3.2, "#ffe6a8"); cx.globalAlpha = 1; }
}

/** Значок боя на планете, у которой идёт наземная битва: по нему открывают
 *  накладку. Два скрещённых клинка — единственное место в игре, где рисуется
 *  оружие, и потому спутать его не с чем. */
export function drawWarMark(x: number, y: number, r: number, g: Ground): void {
  const flick = 0.55 + 0.45 * Math.abs(Math.sin(glow * 3));
  cx.save();
  cx.globalAlpha = flick;
  cx.strokeStyle = "#ff8b5e"; cx.lineWidth = 2; cx.lineCap = "round";
  cx.beginPath();
  cx.moveTo(x - r, y + r); cx.lineTo(x + r, y - r);
  cx.moveTo(x + r, y + r); cx.lineTo(x - r, y - r);
  cx.stroke();
  cx.globalAlpha = 1;
  cx.font = "600 9px system-ui, sans-serif"; cx.fillStyle = "#ff8b5e";
  cx.textAlign = "center"; cx.textBaseline = "top";
  cx.fillText("битва", x, y + r + 3);
  cx.restore();
  hits.push({ x:x, y:y, r:r + 8, kind:"war", data:g });
}

/** Открыть или закрыть накладку. Одна дверь: её дёргают и сцена, и панель. */
export function showBattle(g: Ground | null): void { U.battle = g; }

/** Строки окошка военного корабля на сцене: кто, чей, чем вооружён. Живут
 *  здесь, а не в panels.ts, чтобы сцена не тянула за собой панели (а панели —
 *  сцену: они и так друг друга знают через seenSys). */
export function warLines(s: Warship, name: string): string[] {
  return [(s.role === "police" ? "Полиция" : s.role === "raid" ? "Рейдер" : "Охрана") + " · " + name,
          "командир " + s.captain + " · с " + s.born,
          "урон " + s.dmg.toFixed(1) + " · прочность " + s.hp.toFixed(1) + " из " + s.hpMax.toFixed(1),
          s.fight !== undefined ? "в бою" : "ждёт"];
}

/** Строки окошка боя: кто с кем и сколько осталось. */
export function fightLines(f: Fight, raider: string): string[] {
  const live = (a: { hp: number }[]): number => a.filter((x) => { return x.hp > 0; }).length;
  return ["Бой у " + systems[f.sys].name + " · " + raider,
          "нападают " + live(f.att) + " из " + f.att.length + ", отбиваются " + live(f.def) + " из " + f.def.length,
          "идёт ещё " + Math.max(0, f.left) + " мес." + (f.prey ? " · держат рейс " + (f.prey.captain || "?") : "")];
}
