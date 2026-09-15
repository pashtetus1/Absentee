// ===================== бой в космосе =====================
//
// Раньше вольница забирала рейс МГНОВЕННО: монетка раз в месяц, и груз просто
// менял владельца, а корабль исчезал из списка. Перехват был событием в сводке,
// а не происшествием на карте: смотреть было не на что, вмешаться нечем, и
// вопрос «а нельзя ли было отбиться» не имел смысла — отбиваться было некому.
//
// Теперь перехват — это БОЙ. У вольницы должен быть военный корабль, собранный
// по чертежу (arms.ts); он выходит на рейс, рейс встаёт (v.fight), и дальше
// месяцами решается, чей это груз. За жертву вступаются те, кто рядом: охрана
// компании-хозяина и казённая полиция, купленная на военный бюджет. Бой видно
// на карте, по нему можно ткнуть и смотреть, как тают корпуса.
//
// СЧИТАЕТСЯ ОН ТОЛЬКО ПО ДЕТАЛЯМ (arms.ts: shipDmg, shipHp). Лучемёты бьют,
// броня держит, просторный корпус живёт дольше тесного. Ни звания, ни удачи,
// ни скрытых множителей: заглянув в состав двух кораблей, исход можно
// посчитать на пальцах — и ровно поэтому имеет смысл строить корабли получше.

import { shipDmg, shipHp } from "./arms";
import { compOf } from "./data";
import { lotsOf } from "./freight";
import { unfly } from "./market";
import { HOME, realmOfCorp, realmOfVoyage } from "./realm";
import { rnd } from "./rng";
import { S, U, corps, dateStr, fights, say, systems, voyages, warships } from "./state";
import { clamp, popsWord } from "./util";
import { addStock } from "./world";
import type { Corp, Fight, Fighter, Rock, Voyage, Warship } from "./types";

/** Сколько месяцев бой идёт, пока кто-нибудь не выйдет из него сам. Девять, и
 *  это число про ЗАДЕРЖКУ: пока идёт бой, рейс стоит, а рейсы в этой игре везут
 *  хлеб голодным колониям. Длинный бой убивает планету не оружием, а тем, что
 *  хлебовоз опоздал на год. */
export const FIGHT_LEN = 9;
/** Ниже какой доли прочности нападающие выходят из боя. Вольница живёт
 *  промыслом, а не доблестью: разменивать рейдер, который строили пять лет, на
 *  чужой трюм с рудой ей незачем. */
export const BREAK_OFF = 0.35;
/** Какая доля урона доходит за месяц. Бой — это не залп, а погоня и стрельба
 *  вдогонку неделями. Единица означает, что месяц боя и есть та мера, в которой
 *  написан урон детали; числа подобраны так (arms.ts), чтобы голая самоделка
 *  дожимала безоружный грузовик к шестому месяцу — впритык к сроку, за который
 *  она обязана либо взять добычу, либо уйти, — а с одним лучемётом брала его за
 *  три. Оттого вооружённая ватага опаснее не на проценты, а вдвое. */
export const HIT = 1;
/** Сколько кораблей вольница выводит на один рейс и сколько защитников
 *  успевают подойти. Больше — и бой превращается в перечень из дюжины строк,
 *  которую в окне не прочитать. */
export const RAID_MAX = 2, GUARD_MAX = 3;

let seq = 0;
export function fightSeq(): number { return seq; }
export function setFightSeq(n: number): void { seq = n; }

/** Готовый военный корабль встаёт в строй. Одна дверь: и со стапеля (motion),
 *  и при разворачивании партии корабль появляется только здесь. */
export function newWarship(owner: number, des: string, parts: { k: string; from: number }[],
                           sys: number, role: string, captain: string): Warship {
  const w: Warship = {
    id:++seq, owner:owner, des:des, parts:parts.slice(), sys:sys,
    hp:shipHp(parts), hpMax:shipHp(parts), dmg:shipDmg(parts),
    role:role, ang:rnd() * 6.2832, captain:captain, born:dateStr()
  };
  warships.push(w);
  return w;
}

/** Военные корабли этой конторы (или казённые при owner = -1). */
export function fleetOf(owner: number): Warship[] {
  return warships.filter((s) => { return s.owner === owner; });
}
/** Свободные военные корабли в системе: те, кто не занят другим боем. */
export function idleAt(sys: number, pick: (s: Warship) => boolean): Warship[] {
  return warships.filter((s) => { return s.sys === sys && s.fight === undefined && pick(s); });
}

function fighterOf(s: Warship): Fighter {
  return { owner:s.owner, name:s.captain, color:s.owner >= 0 ? corps[s.owner].color : "#8894ae",
           hp:s.hp, hpMax:s.hpMax, dmg:s.dmg, parts:s.parts, ship:s };
}
/** Сам мирный корабль — тоже боец, только безоружный: он может лишь терпеть.
 *  Именно поэтому охрана и стоит денег. */
function preyFighter(v: Voyage): Fighter {
  const id = v.forCorp !== undefined ? v.forCorp : v.corp;
  return { owner:id === undefined ? -1 : id, name:v.captain || "без имени",
           color:v.color, hp:shipHp(v.parts || []), hpMax:shipHp(v.parts || []), dmg:0,
           parts:v.parts || [], prey:true };
}

/** Кто вступится за этот рейс: охрана его хозяина и полиция его государства,
 *  стоящие на одном из концов пути. Дальше конца пути никто не успевает —
 *  потому охрана и имеет смысл ровно там, где её поставили. */
export function guardsFor(v: Voyage): Warship[] {
  const realm = realmOfVoyage(v);
  const owner = v.forCorp !== undefined ? v.forCorp : v.corp;
  const ends: number[] = [];
  const a = v.sysFrom !== undefined ? v.sysFrom : v.from ? v.from.sys : undefined;
  const b = v.sysFrom !== undefined ? (v.to as number) : v.to ? (v.to as { sys: number }).sys : undefined;
  if (a !== undefined) ends.push(a);
  if (b !== undefined && b !== a) ends.push(b);
  const out: Warship[] = [];
  ends.forEach((sys) => {
    idleAt(sys, (s) => {
      if (s.owner >= 0 && corps[s.owner].pirate) return false;
      return s.owner === owner || realmOfCorp2(s.owner) === realm;
    }).forEach((s) => { if (out.indexOf(s) < 0) out.push(s); });
  });
  return out.slice(0, GUARD_MAX);
}
/** Под чьим флагом ходит военный корабль. Казённый — под родным. */
function realmOfCorp2(owner: number): number { return owner < 0 ? HOME : realmOfCorp(corps[owner]); }

/** Начать бой за рейс. Возвращает null, если нападать некому или не на кого. */
export function startFight(raiders: Warship[], v: Voyage): Fight | null {
  if (!raiders.length || v.fight !== undefined) return null;
  const a = v.sysFrom !== undefined ? systems[v.sysFrom] : systems[v.from.sys];
  const b = v.sysFrom !== undefined ? systems[v.to as number] : systems[(v.to as { sys: number }).sys];
  const t = clamp(v.t, 0, 1);
  const guards = guardsFor(v);
  const f: Fight = {
    id:++seq, sys:a.id, x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t,
    att:raiders.map(fighterOf),
    // ОХРАНА СТОИТ ПЕРВОЙ, жертва последней, и это не порядок в списке, а всё,
    // ради чего охрану держат: залп идёт по первому живому (volley), то есть
    // пробиться к трюму можно, только разобравшись с теми, кто его прикрывает.
    // Поставь жертву первой — и конвой стал бы украшением.
    def:guards.map(fighterOf).concat([preyFighter(v)]),
    raider:raiders[0].owner, prey:v, left:FIGHT_LEN, total:FIGHT_LEN, log:[]
  };
  raiders.forEach((s) => { s.fight = f.id; });
  guards.forEach((s) => { s.fight = f.id; });
  v.fight = f.id;
  fights.push(f);
  S.battles++;
  const who = corps[f.raider] ? corps[f.raider].name : "неизвестные";
  say("<b>" + who + "</b> вышла на рейс командира " + (v.captain || "?") + " у " + a.name + ": " +
      (guards.length ? "его прикрывают, завязался бой." : "прикрыть его некому."));
  note(f, "бой начался: " + f.att.length + " против " + f.def.length + ".");
  return f;
}

function note(f: Fight, t: string): void {
  f.log.unshift(dateStr() + " · " + t);
  if (f.log.length > 8) f.log.pop();
}

/** Залп одной стороны по другой: весь урон идёт по первому живому. Бить по
 *  всем понемногу значило бы, что никто никогда не выходит из боя, и бой
 *  тянулся бы до потолка месяцев всегда. */
function volley(from: Fighter[], to: Fighter[], f: Fight): void {
  let dmg = 0;
  from.forEach((x) => { if (x.hp > 0) dmg += x.dmg; });
  dmg *= HIT;
  for (let i = 0; i < to.length && dmg > 0; i++) {
    const t = to[i];
    if (t.hp <= 0) continue;
    const bite = Math.min(t.hp, dmg);
    t.hp -= bite; dmg -= bite;
    if (t.hp > 0) break;
    note(f, (t.prey ? "сбит " : "разбит ") + t.name + ".");
  }
}

function alive(side: Fighter[]): Fighter[] { return side.filter((x) => { return x.hp > 0; }); }

export function battleRun(): void {
  for (let i = fights.length - 1; i >= 0; i--) {
    const f = fights[i];
    // Жертва могла исчезнуть и без боя: мир опустел, груз сняли.
    if (f.prey && voyages.indexOf(f.prey) < 0) { f.prey = undefined; }
    volley(f.att, f.def, f);
    volley(f.def, f.att, f);
    // Потери — настоящие: разбитый корабль уходит из списка, а не «чинится».
    sync(f);
    f.left--;
    const att = alive(f.att), def = alive(f.def);
    const target = f.def.filter((x) => { return x.prey; })[0];
    const preyDown = !!(f.prey && target && target.hp <= 0);
    // Потрёпанные нападающие уходят сами, не дожидаясь, пока их добьют.
    let hp = 0, hpMax = 0;
    att.forEach((x) => { hp += x.hp; hpMax += x.hpMax; });
    const broke = hpMax > 0 && hp < hpMax * BREAK_OFF && !preyDown;
    if (att.length && def.length && f.left > 0 && !broke) continue;
    fights.splice(i, 1);
    if (U.pick && U.pick.data === f) U.pick = null;
    // Бой кончился: корабли, что уцелели, снова свободны.
    warships.forEach((s) => { if (s.fight === f.id) s.fight = undefined; });
    if (f.prey) f.prey.fight = undefined;
    if (!att.length) {
      f.done = "def";
      say("Бой у " + systems[f.sys].name + ": нападавших отбили" +
          (f.prey ? ", рейс командира " + (f.prey.captain || "?") + " идёт дальше." : "."));
      continue;
    }
    if (preyDown && f.prey && corps[f.raider]) { f.done = "att"; plunder(corps[f.raider], f.prey, f); continue; }
    f.done = "def";
    say("Бой у " + systems[f.sys].name + ": " + (corps[f.raider] ? corps[f.raider].name : "нападавшие") +
        " отступила" + (f.prey ? ", рейс командира " + (f.prey.captain || "?") + " уцелел." : "."));
  }
}

/** Свести урон боя с настоящими кораблями: у живых поправить запас, разбитых
 *  вычеркнуть из флота. Пока это не сделано, корабль в бою и корабль в списке —
 *  две разные вещи, и одна из них врёт. */
function sync(f: Fight): void {
  f.att.concat(f.def).forEach((x) => {
    if (!x.ship) return;
    x.ship.hp = Math.max(0, x.hp);
    if (x.hp > 0) return;
    const at = warships.indexOf(x.ship);
    if (at >= 0) { warships.splice(at, 1); S.downed++; }
    if (U.pick && U.pick.data === x.ship) U.pick = null;
  });
}

/** Сбитый рейс: груз достаётся победителю, а сам рейс кончается здесь.
 *
 *  Это та самая добыча, ради которой всё и затевалось, и она ЛОЖИТСЯ НА СКЛАД
 *  в системе логова — то есть из неё потом строят следующий корабль. Через
 *  unfly, а не через voyages.splice напрямую: иначе покупатель будет вечно
 *  ждать груз, который уже не летит (market.ts). */
export function plunder(p: Corp, v: Voyage, f?: Fight): void {
  const home = p && p.home ? p.home : null;
  const ps = systems[home ? home.sys : (f ? f.sys : 0)];
  let loot = "пустой трюм";
  if (v.kind === "food") { if (home) home.food.stock += v.qty; loot = v.qty + " еды"; }
  else if (v.kind === "pops") { if (home) home.pop.free += v.qty; loot = popsWord(v.qty); }
  else if (v.kind === "ferry") {
    v.parts.forEach((pt) => { addStock(p, ps.id, pt.k, 1); });
    if (v.cargo === "colony") { v.body.claimed = false; loot = "колониальный модуль"; }
    else if (v.cargo === "sat") {
      // Спутник числился в системе с закладки, чтобы туда не полетел второй
      // (orders.ts); сбитый — не встанет, и место снова свободно.
      const ss = systems[v.to as number];
      ss.sats = ss.sats.filter((x) => { return x !== v.sat; });
      loot = "готовый спутник";
    }
    else {
      if (v.dest && v.dest.ref) (v.dest.ref as Rock).taken = false;
      const ds = systems[v.to as number];
      ds.ventures = ds.ventures.filter((x) => { return x !== v.vent; });
      loot = "готовая платформа";
    }
  } else {
    const lots = lotsOf(v);
    lots.forEach((l) => { addStock(p, ps.id, l.k, 1); });
    if (lots.length) loot = lots.map((l) => { return compOf(l.k).short; }).join(", ");
  }
  // Сам корпус тоже добыча: сбитый корабль разбирают на детали. Раньше он
  // просто исчезал, и вольница от промысла не богатела ничем, кроме груза.
  (v.parts || []).forEach((pt) => { addStock(p, ps.id, pt.k, 1); });
  S.raids++;
  if (U.pick && U.pick.data === v) U.pick = null;
  say("<b>" + p.name + "</b> сбила рейс командира " + (v.captain || "?") + " у " + ps.name +
      ": взято " + loot + " и корпус на детали.");
  unfly(v);
  const at = voyages.indexOf(v);
  if (at >= 0) voyages.splice(at, 1);
}

// ---- промысел -----------------------------------------------------------
// Кого вольница считает добычей. Правила те же, что были у мгновенного
// перехвата: прыжковые и открыватели не трогают (с них нечего взять и не
// догнать), свой хлебовоз не трогают, порожний перегон незачем. Разница одна —
// теперь для этого нужен КОРАБЛЬ, и оттого разбой стал делом, в которое
// вкладываются, а не свойством конторы.

/** Зона охоты вокруг логова. Та же, что рисуется красным кольцом на карте. */
export const HUNT = 45;
/** Насколько вольница напориста: с какой вероятностью в месяц она выходит на
 *  рейс, который оказался в зоне. Впятеро выше прежнего мгновенного перехвата
 *  (0.0025) — потому что теперь выход на рейс ещё не значит добычу: можно
 *  нарваться на охрану и потерять корабль, который строили пять лет. */
export const HUNT_CHANCE = 0.016;

export function raidHunt(p: Corp): void {
  if (!p.home) return;
  const ps = systems[p.home.sys];
  let ships = idleAt(p.home.sys, (s) => { return s.owner === p.id; });
  if (!ships.length) return;
  for (let i = voyages.length - 1; i >= 0; i--) {
    if (!ships.length) break;
    const v = voyages[i];
    if (!v || v.fight !== undefined) continue;
    if (v.kind === "jump" || v.kind === "gate" || v.kind === "reloc" || v.kind === "empty") continue;
    const owner = v.kind === "parts" ? v.forCorp
                : v.kind === "ferry" ? v.corp
                : (v.relief !== undefined ? v.relief : -1);
    if (owner === p.id) continue;
    if (v.to === p.home) continue;                                   // свой же хлебовоз
    const a = v.sysFrom !== undefined ? systems[v.sysFrom] : systems[v.from.sys];
    const b = v.sysFrom !== undefined ? systems[v.to as number] : systems[(v.to as { sys: number }).sys];
    if (a === b) continue;
    const t = clamp(v.t, 0, 1), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (Math.hypot(x - ps.x, y - ps.y) > HUNT) continue;
    if (rnd() > HUNT_CHANCE) continue;
    startFight(ships.slice(0, RAID_MAX), v);
    ships = idleAt(p.home.sys, (s) => { return s.owner === p.id; });
  }
}
