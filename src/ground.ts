// ===================== наземная битва =====================
//
// Восстание больше не случается щелчком. Раньше голодный мир доходил до края —
// и в ту же секунду становился вольницей или чужим государством: филиалы
// отбирались, верфь меняла хозяина, и всё это укладывалось в одну строку
// сводки. Решалось главное событие партии быстрее, чем игрок успевал его
// прочитать.
//
// Теперь между «люди взялись за оружие» и «мир потерян» стоит БИТВА. Она идёт
// месяцами, в неё можно зайти и смотреть (render/war.ts: планета, фермы, цеха и
// лаборатории, и видно, чья сейчас каждая клетка), и кончиться она может
// по-разному.
//
// ЧТО РЕШАЕТ ИСХОД — ровно две вещи, и обе видны в окне битвы:
//   сколько людей встало с каждой стороны. Восставших ВСЕГДА больше: они и
//     есть население планеты, поле и незанятые. За корпорации дерутся их цеха
//     и лаборатории, то есть меньшинство, — плюс десант с кораблей на орбите;
//   чем они вооружены. Наземное оружие — лестница в пять ступеней (data.ts), и
//     разница между голыми руками и Mk3 больше, чем разница в числе людей.
//     Арсенал мира покупает генерал на военный бюджет (army.ts), восставшие
//     разбирают склады контор в своей системе. Вот здесь рычаг государства и
//     встречается с восстанием: бюджет, потраченный вовремя, — единственное,
//     чем корпорации перевешивают численность.
//
// Оттого чаще побеждают восставшие: людей у них больше всегда, а оружие
// одинаковое — пока государство не платит.

import { PIRATES, artelName, pirateName } from "./colony";
import { groundMult, gunAt, lootedGun, shipBomb, shipTroops } from "./arms";
import { HOME, realmOf, realmOfCorp } from "./realm";
import { rnd } from "./rng";
import { edgeShipyard } from "./shipyard";
import { S, U, corps, dateStr, grounds, say, systems, warships, worlds } from "./state";
import { clamp } from "./util";
import { hasBranch, openBranch, popOf } from "./world";
import type { Corp, Ground, Pop, World } from "./types";

/** Сколько месяцев битва идёт, если никто не сломался раньше. Восемь-двадцать:
 *  меньше — и её не успеешь заметить между заходами в игру, больше — и голод,
 *  который её породил, успеет уморить планету прямо посреди боя. */
export const WAR_MIN = 8, WAR_MAX = 20;
/** Какую долю сил стороны теряют за месяц. Подобрано так, чтобы за десяток
 *  месяцев слабейшая сторона доходила до края, а не таяла за два хода. */
export const BITE = 0.18;
/** Ниже этой доли от начального ополчения сторона считается разбитой. */
export const BROKEN = 0.15;

/** Сила стороны: люди, помноженные на оружие. Одно место, где эти две вещи
 *  встречаются, — и в окне битвы показывается ровно это число. */
export function force(s: { men: number; arms: number }): number {
  return Math.max(0, s.men) * groundMult(s.arms);
}

/** Корабли на орбите, которые вмешиваются в бой. Вольница и само восстание
 *  бьют за восставших, полиция и охрана компаний — за корпорации; чужие мимо
 *  проходящие не при чём. */
function orbit(w: World, rebCorp: number): { reb: number; gov: number; rebBomb: number; govBomb: number } {
  const out = { reb:0, gov:0, rebBomb:0, govBomb:0 };
  warships.forEach((s) => {
    if (s.sys !== w.sys) return;
    const c = s.owner >= 0 ? corps[s.owner] : null;
    const forReb = c && (c.id === rebCorp || (c.pirate && c.home && c.home.sys === w.sys));
    // За корпорации — казённые (полиция) и охрана тех, у кого здесь филиал.
    const forGov = !forReb && (!c || realmOfCorp(c) === realmOf(w) || hasBranch(c, w));
    if (forReb) { out.reb += shipTroops(s.parts); out.rebBomb += shipBomb(s.parts); }
    else if (forGov) { out.gov += shipTroops(s.parts); out.govBomb += shipBomb(s.parts); }
  });
  return out;
}

/** Схема планеты: из чего состоит то, за что дерутся. Ровно то, что на мире
 *  есть на самом деле, — поле, цеха филиалов, лаборатории, теплицы и город, —
 *  потому что захватывают именно это, а не абстрактные клетки. */
function tilesOf(w: World): { k: string; side: number }[] {
  const out: { k: string; side: number }[] = [{ k:"town", side:0 }];
  const farms = clamp(Math.round(w.pop.farm * 1.5), 1, 6);
  for (let i = 0; i < farms; i++) out.push({ k:"farm", side:0 });
  w.branches.forEach((b) => {
    out.push({ k:"shop", side:0 });
    if (b.jobs.sci > 0.3) out.push({ k:"lab", side:0 });
  });
  w.built.forEach(() => { out.push({ k:"dome", side:0 }); });
  return out.slice(0, 16);
}

/** Восстание начинается. Контора восставших уже создана (colony.ts): у неё
 *  есть имя, цвет и касса, но НЕТ ни филиала, ни логова — всё это она получит
 *  только победив. Проигравшая не получает ничего. */
export function startUprising(w: World, c: Corp, kind: string): Ground {
  const p = w.pop;
  // Восставшие — поле и незанятые: те, кому терять нечего. Их всегда больше.
  const reb = (p.farm + p.free) * (0.45 + rnd() * 0.25) + 0.05;
  // За корпорации — цеха и лаборатории, то есть те, кто на них работает, плюс
  // охрана филиалов и десант с кораблей. И плюс ГАРНИЗОН: купленное в арсенал
  // оружие не лежит в ящиках, под него становятся люди, и чем лучше арсенал,
  // тем больше их встало. Это и есть второй конец военного бюджета — первый в
  // том, что гарнизон вооружён лучше улицы (arms ниже).
  //
  // Потолок в 85% держит правило «восставших всегда больше» буквально: сколько
  // бы государство ни вложило, население планеты всё равно многочисленнее. Пол
  // в 15% не даёт битве кончиться, не начавшись, но и не спасает мир сам по
  // себе: без арсенала эта доля проигрывает вчистую, и так и задумано.
  const orb = orbit(w, c.id);
  const base = (p.prod + p.sci) * 0.5 + w.branches.length * 0.06 + orb.gov;
  const gov = clamp(base + w.arms * 0.22 * reb, reb * 0.15, reb * 0.85);
  const g: Ground = {
    world:w, corp:c.id, kind:kind,
    reb:{ men:reb + orb.reb, men0:reb + orb.reb, arms:lootedGun(w.sys) },
    gov:{ men:gov, men0:gov, arms:Math.max(w.arms, gunAt(w.sys, (o) => { return hasBranch(o, w); })) },
    left:WAR_MIN + Math.floor(rnd() * (WAR_MAX - WAR_MIN)), total:0,
    tiles:tilesOf(w), log:[]
  };
  g.total = g.left;
  w.war = g;
  grounds.push(g);
  S.risings++;
  note(g, "Восстание началось: " + g.reb.men.toFixed(1) + " против " + g.gov.men.toFixed(1) + ".");
  say("<b>" + w.body.name + "</b>: восстание. За «" + c.name + "» поднялось " + g.reb.men.toFixed(1) +
      " человечков" + (g.reb.arms ? " с наземным оружием Mk" + g.reb.arms : " с голыми руками") +
      ", корпорации выставили " + g.gov.men.toFixed(1) +
      (g.gov.arms ? " с Mk" + g.gov.arms : " без оружия") + ". Бой идёт на планете.");
  return g;
}

function note(g: Ground, t: string): void {
  g.log.unshift(dateStr() + " · " + t);
  if (g.log.length > 8) g.log.pop();
}

/** Какая доля потерь ополчения — это УБЫЛЬ НАСЕЛЕНИЯ. Не все, кто выбыл из
 *  боя, погибли: часть разбежалась, часть вернулась к своим делам, когда
 *  поняла, чем дело кончится. Полная доля стоила планете слишком дорого —
 *  замер: вымирало 11 колоний из 30 против 8 при нынешней, — а восстание
 *  должно менять хозяина планеты, а не стирать её с карты. */
export const DEATH = 0.6;

/** Убыль населения: ополчение — это люди мира, и потери берутся с тех каст, из
 *  которых оно встало. Без этого битва была бы игрой в числа, не стоящей миру
 *  ничего. */
function bleed(w: World, castes: (keyof Pop)[], n: number): void {
  let left = n;
  castes.forEach((k) => {
    if (left <= 0) return;
    const take = Math.min(w.pop[k], left);
    w.pop[k] -= take; left -= take;
  });
}

export function groundRun(): void {
  for (let i = grounds.length - 1; i >= 0; i--) {
    const g = grounds[i], w = g.world;
    // Мир опустел прямо посреди боя — драться больше некому и не за что.
    if (worlds.indexOf(w) < 0) { drop(g, i); continue; }
    const orb = orbit(w, g.corp);
    // Бомбы с орбиты не убивают сами: они множат силу той стороны, за которую
    // бьют. Оттого корабль с бомбами стоит наземного оружия на ступень выше.
    const rs = force(g.reb) * (1 + orb.rebBomb * 0.12);
    const gs = force(g.gov) * (1 + orb.govBomb * 0.12);
    const sum = rs + gs || 1;
    const lostR = g.reb.men * (gs / sum) * BITE * 2;
    const lostG = g.gov.men * (rs / sum) * BITE * 2;
    g.reb.men = Math.max(0, g.reb.men - lostR);
    g.gov.men = Math.max(0, g.gov.men - lostG);
    bleed(w, ["free", "farm"], lostR * DEATH);
    bleed(w, ["prod", "sci"], lostG * DEATH);
    // Линия фронта: сколько клеток уже за восставшими. Считается по тому, какую
    // долю ополчения корпораций они успели выбить, — то есть клетки идут за
    // ходом боя, а не рисуются отдельной случайностью.
    const prog = clamp(1 - g.gov.men / Math.max(1e-6, g.gov.men0), 0, 1);
    const want = Math.round(g.tiles.length * prog);
    g.tiles.forEach((t, k) => { t.side = k < want ? 1 : 0; });
    g.left--;
    const rebBroken = g.reb.men <= g.reb.men0 * BROKEN;
    const govBroken = g.gov.men <= g.gov.men0 * BROKEN;
    if (!rebBroken && !govBroken && g.left > 0) {
      if (g.left % 4 === 0)
        note(g, "держатся: " + g.reb.men.toFixed(1) + " против " + g.gov.men.toFixed(1) +
                 ", клеток за восставшими " + want + " из " + g.tiles.length + ".");
      continue;
    }
    // Кончилось. Разбитая сторона проиграла; вышло время — считаем, кто сильнее
    // стоит на ногах.
    const rebWon = govBroken && !rebBroken ? true : rebBroken && !govBroken ? false : rs >= gs;
    grounds.splice(i, 1);
    w.war = undefined;
    if (U.battle === g) U.battle = null;
    if (rebWon) rebelsWin(g); else revoltCrushed(g);
  }
}

/** Битва кончилась НИЧЕМ: планета, за которую дрались, опустела прямо посреди
 *  боя. Восстание при этом обязано перестать быть восстанием — иначе в списке
 *  контор навсегда остаётся «государство» без герба и без земли, то есть
 *  государство, которого нет. */
function drop(g: Ground, i: number): void {
  grounds.splice(i, 1);
  if (U.battle === g) U.battle = null;
  g.world.war = undefined;
  const c = corps[g.corp];
  c.pirate = false; c.home = undefined; c.origin = "рассеялась"; c.craft = "рассеялась";
  say("<b>" + g.world.body.name + "</b>: драться стало не за что — планета опустела, " +
      "и «" + c.name + "» рассеялась вместе с ней.");
}

/** Восставшие взяли планету.
 *
 *  ФИЛИАЛЫ ОТБИРАЮТСЯ ВСЕГДА, чем бы восстание себя ни называло: власть на
 *  планете сменилась, и чужие цеха на ней достаются победителю вместе со
 *  складами в этой системе. Именно из этих складов вольница потом и строит
 *  первые корабли — грабить, не имея ни верфи, ни денег, было бы не на чем. */
function rebelsWin(g: Ground): void {
  const w = g.world, c = corps[g.corp];
  const lost: string[] = [];
  let took = 0;
  w.branches.slice().forEach((b) => {
    const o = corps[b.corp];
    lost.push(o.name);
    o.branches = o.branches.filter((x) => { return x !== b; });
    const st = o.stock[w.sys];
    if (st) Object.keys(st).forEach((k) => {
      const n = Math.floor(st[k]);
      if (n <= 0) return;
      addLoot(c, w.sys, k, n); st[k] -= n;
      if (o.tot) o.tot[k] = (o.tot[k] || 0) - n;
      took += n;
    });
  });
  w.branches = []; w.rights = [];
  openBranch(c, w, true);
  c.home = w;
  if (g.kind === "вольница") {
    c.pirate = true; c.craft = "разбой"; c.nerve = 1.6;
    if (c.name.indexOf("ольница") < 0) c.name = pirateName(w);
    c.color = PIRATES[S.pirateCount++ % PIRATES.length];
  } else {
    w.founder = c.id; w.free = true;
    if (c.crest === undefined) c.crest = 1 + S.crestSeq++ % 6;
  }
  // Стапель: победившие первым делом принимаются строить корабли. Верфь, если
  // она тут была, просто меняет хозяина, а не было — заложат свою из мусора.
  edgeShipyard(w, c.id);
  w.arms = 0;                      // арсенал разошёлся по рукам
  say("<b>" + w.body.name + "</b>: восстание победило — планета за «" + c.name + "». Филиалы " +
      (lost.length ? lost.join(", ") : "никого") + " отобраны" +
      (took ? ", со складов взято деталей: " + took : "") +
      (g.kind === "вольница" ? ". Теперь всё, что летит мимо " + systems[w.sys].name + ", в опасности."
                             : ". Мир вышел из государства."));
}

/** Восстание подавлено.
 *
 *  Проигравшие не исчезают и не становятся призраком в списке контор: уцелевшие
 *  скидываются в АРТЕЛЬ — тот самый исход, который мог выпасть жребием с самого
 *  начала (colony.ts). Мир остаётся в государстве, чужие цеха при хозяевах, а
 *  на планете появляется своя маленькая контора и ничего больше. Пустая запись
 *  без филиала и без дела была бы хуже во всех смыслах: и как правило игры
 *  (контора-призрак — известная дыра, п. 7), и как рассказ — восстание,
 *  кончившееся ничем, не стоило бы того, чтобы его показывать.
 *
 *  Второй раз жребий на этом мире не тянут (w.edge), так что и нового восстания
 *  отсюда не будет: людям нужно новое отчаяние, а не новая монетка. */
function revoltCrushed(g: Ground): void {
  const w = g.world, c = corps[g.corp];
  c.pirate = false;
  w.arms = 0;                       // арсенал расстрелян
  w.food.short = 0;
  if (c.branches.length) {
    // Восстание поднял тот, у кого филиалы и так были: артель или свободный
    // мир, взявшийся за оружие во второй раз. Он остаётся при своём — но
    // разоружён, и вольницей ему больше не быть.
    c.craft = "выживание"; c.nerve = 1.3;
    say("<b>" + w.body.name + "</b>: восстание подавлено — ополчение удержало планету. " +
        "«" + c.name + "» разоружена.");
    return;
  }
  c.origin = "артель"; c.craft = "выживание"; c.nerve = 1.3; c.home = w;
  c.name = artelName(w);
  c.cash *= 0.35;
  openBranch(c, w, true);
  say("<b>" + w.body.name + "</b>: восстание подавлено — ополчение корпораций удержало планету. " +
      "Уцелевшие скинулись в «" + c.name + "»; мир остался в государстве, чужие цеха на месте.");
}

/** Деталь, взятая с чужого склада, ложится на склад победителя. Отдельной
 *  дверью, чтобы не тащить сюда весь world.ts ради одной строки. */
function addLoot(c: Corp, sys: number, k: string, n: number): void {
  if (!c.stock[sys]) c.stock[sys] = {};
  c.stock[sys][k] = (c.stock[sys][k] || 0) + n;
  if (!c.tot) c.tot = {};
  c.tot[k] = (c.tot[k] || 0) + n;
}

/** Кто за кого: цвет стороны. Восставшие — цветом своей конторы, корпорации —
 *  золотом государства, под которым мир числится. */
export function sideColor(g: Ground, side: number): string {
  return side ? corps[g.corp].color : (realmOf(g.world) === HOME ? "#ffe6a8" : corps[realmOf(g.world)].color);
}
