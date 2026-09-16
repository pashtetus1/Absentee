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
import { compOf, engMult } from "./data";
import { bodyPos } from "./galaxy";
import { lotsOf } from "./freight";
import { unfly } from "./market";
import { HOME, realmOfCorp, realmOfVoyage } from "./realm";
import { rnd } from "./rng";
import { S, U, corps, dateStr, fights, say, systems, voyages, warships } from "./state";
import { clamp, popsWord } from "./util";
import { addStock } from "./world";
import type { Corp, Fight, Fighter, Planet, Rock, Sat, Voyage, Warship } from "./types";

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

/** Вооружённые спутники ЭТОЙ системы, которые вступятся, — по обе стороны.
 *
 *  Круга дальности больше нет, и это не упрощение, а следствие: бой теперь
 *  бывает только внутри системы (raidHunt ниже), а спутник в ней и висит.
 *  Раньше он доставал до соседней звезды по прямой на карте галактики — мера
 *  была придумана под перехваты в открытом космосе, которых не стало.
 *
 *  Спутник — боец НЕПОДВИЖНЫЙ. Он не гонится за рейдером и не выходит из боя,
 *  когда становится горячо: он там, где его поставили, и либо отобьётся, либо
 *  его разберут на детали. Оттого лучемёт на спутнике перестал быть заделом на
 *  будущее: он защищает не абстрактную систему, а собственные глаза конторы.
 *
 *  За ЖЕРТВУ встают спутники её государства: система — их, и разбой в ней их
 *  дело. За НАПАДАЮЩИХ — спутники самой вольницы: она ставит их у логова и
 *  смотрит ими, где что летит, а заодно прикрывает промысел орбитальной
 *  батареей. Чужое государство в чужую драку не лезет ни с той, ни с другой
 *  стороны. */
export function satsFor(sys: number, side: (owner: number) => boolean): Sat[] {
  const out: Sat[] = [];
  const s = systems[sys];
  if (!s) return out;
  s.sats.forEach((sat) => {
    if (!sat.live || !sat.armed || sat.hp <= 0) return;
    if (side(sat.owner)) out.push(sat);
  });
  return out;
}
function satFighter(sat: Sat): Fighter {
  return { owner:sat.owner, name:"спутник " + systems[sat.sys].name, color:sat.color,
           hp:sat.hp, hpMax:shipHp(sat.parts), dmg:shipDmg(sat.parts), parts:sat.parts, sat:sat };
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

/** ГДЕ это случилось — так, как игрок увидит на карте. Рейс внутри системы
 *  стоит у своей звезды, межзвёздный идёт по перегону между двумя, и «у Тира»
 *  про корабль, взятый на полпути к соседней звезде, — неправда: игрок ищет
 *  глазами столицу, а корабль пропал посреди карты. Добыча до сих пор
 *  называлась и вовсе по ЛОГОВУ вольницы, то есть место в сводке не совпадало
 *  с местом происшествия никогда. */
export function whereOf(v: Voyage): string {
  const a = v.sysFrom !== undefined ? systems[v.sysFrom] : v.from ? systems[v.from.sys] : null;
  const b = v.sysFrom !== undefined ? systems[v.to as number]
          : v.to && (v.to as { sys: number }).sys !== undefined ? systems[(v.to as { sys: number }).sys] : null;
  if (!a) return b ? "у " + b.name : "в пути";
  if (!b || a === b) return "у " + a.name;
  return "на перегоне " + a.name + " — " + b.name;
}

/** Где рейс сейчас, в единицах СИСТЕМЫ. Только для внутрисистемных: у
 *  межзвёздного своего места в системе нет — он между звёзд, и трогать его
 *  вольница больше не может вовсе. */
export function voyPos(v: Voyage): { x: number; y: number } {
  const a = bodyPos(v.from.body), b = bodyPos(v.to.body), t = clamp(v.t, 0, 1);
  return { x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t };
}
/** Сколько единиц системы рейс кроет за месяц: длина перегона на его же срок.
 *  Считается по кораблю, а не по правилу: срок задан ходовым двигателем
 *  (food.ts, dispatch), и грузовик с двигателем получше и правда уходит
 *  быстрее. Этим гонка и решается. */
export function voyPace(v: Voyage): number {
  const a = bodyPos(v.from.body), b = bodyPos(v.to.body);
  return Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, v.dur);
}
/** Сколько единиц системы за месяц кроет ватага. Мера взята от самих рейсов:
 *  перегон между мирами — 312 единиц по медиане, а идут его 54-72 месяца на
 *  ходовом Mk1, то есть пять единиц в месяц на единицу двигателя. Рейдер идёт
 *  быстрее того, кого грабит, — на то он и налегке, без трюма, — но идёт он на
 *  СВОЁМ двигателе: ватага, не поставившая найденный ход, отстанет от
 *  хлебовоза с ходовым Mk3, сколько бы лучемётов на ней ни висело.
 *
 *  RAID_FAST решает, сколько рейсов уходит. Замер, 6 партий по 200 лет
 *  (ушло от погони): 1.45 — 57%, 1.9 — 45%, 2.4 — 29%. Взято 1.9: погоня
 *  опасна, но проигрывается достаточно часто, чтобы за ней стоило следить, а
 *  двигатель получше был настоящей защитой, а не поблажкой. */
export const PACE = 5, RAID_FAST = 1.9;
export function raidPace(ships: Warship[]): number {
  let slow = 1e9;
  ships.forEach((w) => { slow = Math.min(slow, engMult(w.parts)); });
  return PACE * RAID_FAST * (slow === 1e9 ? 1 : slow);
}

/** Выйдет ли ватага за этим рейсом. Правило одно и оно из тех, что можно
 *  проверить глазом: гонятся за тем, кто медленнее. Хватит ли ДОРОГИ — вопрос
 *  открытый: жертва может успеть к своей планете раньше, чем её нагонят, и
 *  вольница заранее этого не считает. Иначе погоня была бы решена в тот же
 *  месяц, когда началась, и смотреть на неё было бы незачем. */
function worthChase(ships: Warship[], v: Voyage): boolean {
  return raidPace(ships) > voyPace(v) * 1.05;
}

/** Ватага снялась с орбиты логова и пошла на перехват. Боя ещё НЕТ: пока она
 *  идёт, рейс идёт тоже (motion.ts слеп к погоне), и весь спор в том, кто
 *  окажется у цели первым. */
export function startChase(raiders: Warship[], v: Voyage, home: Planet): Fight | null {
  if (!raiders.length || v.fight !== undefined || v.chase !== undefined) return null;
  const a = systems[v.from.sys];
  const at = bodyPos(home);
  const f: Fight = {
    id:++seq, sys:a.id, x:a.x, y:a.y,
    close:{ x:at.x, y:at.y, px:at.x, py:at.y, pace:raidPace(raiders) },
    att:raiders.map(fighterOf), def:[],
    raider:raiders[0].owner, prey:v, left:FIGHT_LEN, total:FIGHT_LEN, log:[]
  };
  raiders.forEach((s) => { s.fight = f.id; });
  v.chase = f.id;
  fights.push(f);
  const who = corps[f.raider] ? corps[f.raider].name : "неизвестные";
  say("<b>" + who + "</b> вышла на перехват: ватага снялась с орбиты " + home.name +
      " и идёт за рейсом командира " + (v.captain || "?") + " " + whereOf(v) + ".");
  note(f, "погоня началась.");
  return f;
}

/** Догнали: погоня кончилась, начинается бой. Стороны собираются ЗДЕСЬ, а не
 *  при выходе из логова, и это не мелочь: пока ватага шла, игрок мог успеть
 *  поставить в системе полицию, и она встанет за жертву. */
function engage(f: Fight): void {
  const v = f.prey;
  const raiders: Warship[] = [];
  f.att.forEach((x) => { if (x.ship) raiders.push(x.ship); });
  const guards = guardsFor(v);
  const raider = f.raider, realm = realmOfVoyage(v);
  const mine = satsFor(f.sys, (o) => { return o === raider; });
  const sats = satsFor(f.sys, (o) => {
    const c = corps[o];
    return !!c && o !== raider && !c.pirate && realmOfCorp(c) === realm;
  });
  f.close = undefined;
  f.att = raiders.map(fighterOf).concat(mine.map(satFighter));
  // ОХРАНА СТОИТ ПЕРВОЙ, жертва последней, и это не порядок в списке, а всё,
  // ради чего охрану держат: залп идёт по первому живому (volley), то есть
  // пробиться к трюму можно, только разобравшись с теми, кто его прикрывает.
  // Поставь жертву первой — и конвой стал бы украшением.
  // Спутники стоят МЕЖДУ охраной и жертвой: охрана нанята закрывать трюм
  // собой и умирает первой, а спутник — сооружение, он прикрывает уже тем,
  // что стоит здесь и стреляет.
  f.def = guards.map(fighterOf).concat(sats.map(satFighter)).concat([preyFighter(v)]);
  guards.forEach((s) => { s.fight = f.id; });
  v.chase = undefined;
  v.fight = f.id;
  S.battles++;
  const who = corps[f.raider] ? corps[f.raider].name : "неизвестные";
  say("<b>" + who + "</b> нагнала рейс командира " + (v.captain || "?") + " " + whereOf(v) + ": " +
      (guards.length ? "его прикрывают, завязался бой."
     : sats.length ? "охраны нет, но бьют спутники с орбиты."
     : "прикрыть его некому.") +
      (mine.length ? " С орбиты ей помогают свои спутники." : ""));
  note(f, "бой начался: " + f.att.length + " против " + f.def.length + ".");
}

/** Погоня сорвалась: ватага расходится, корабли снова свободны. */
function callOff(f: Fight, i: number, why: string): void {
  fights.splice(i, 1);
  if (U.pick && U.pick.data === f) U.pick = null;
  warships.forEach((s) => { if (s.fight === f.id) s.fight = undefined; });
  if (f.prey) f.prey.chase = undefined;
  f.done = "def";
  if (why) say(why);
}

/** Месяц погони. Ватага правит на то место, где жертва СЕЙЧАС, и кроет своё
 *  расстояние; жертва всё это время идёт своим ходом. */
function closeIn(f: Fight, i: number): void {
  const c = f.close;
  const v = f.prey;
  // Жертвы не стало без всякой погони: мир опустел, груз сняли.
  if (!v || voyages.indexOf(v) < 0) { callOff(f, i, ""); return; }
  // Гнаться стало некому: логово опустело вместе с ватагой (colony.ts).
  if (!f.att.some((x) => { return x.hp > 0; })) { callOff(f, i, ""); return; }
  const p = voyPos(v);
  c.px = c.x; c.py = c.y;
  const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
  if (d <= c.pace) { c.x = p.x; c.y = p.y; engage(f); return; }
  // Не догнали в этом месяце — а в следующем догонять будет уже некого: рейс
  // садится. Считается ЗДЕСЬ, потому что бои идут до движения (tick.ts), и
  // «его догнали» против «он долетел» решается ровно этим порядком.
  if (v.t + 1 / v.dur >= 1) {
    const who = corps[f.raider] ? corps[f.raider].name : "неизвестные";
    callOff(f, i, "Рейс командира " + (v.captain || "?") + " ушёл от погони <b>" + who +
                  "</b> " + whereOf(v) + ": ватага возвращается в логово.");
    S.gotAway++;
    return;
  }
  c.x += dx / d * c.pace; c.y += dy / d * c.pace;
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
    // Погоня — не бой: никто не стреляет, месяцы боя не тратятся. Она может
    // кончиться и тем, что жертва дошла до своей планеты (arriveVoyage снимет
    // рейс, и здесь останется погоня без цели).
    if (f.close) { closeIn(f, i); continue; }
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
    // Спутник сбит: конторе выбило глаз. Он не «чинится» и не остаётся мёртвой
    // точкой на орбите — его снимают с неба вовсе, и система, которую он
    // держал, снова свободна под чужой спутник.
    if (x.sat) {
      x.sat.hp = Math.max(0, x.hp);
      if (x.hp > 0) return;
      const s = systems[x.sat.sys];
      s.sats = s.sats.filter((o) => { return o !== x.sat; });
      if (U.pick && U.pick.data === x.sat) U.pick = null;
      S.downed++;
      say("Спутник <b>" + corps[x.sat.owner].name + "</b> у " + s.name + " сбит: телескоп потерян.");
      return;
    }
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
  say("<b>" + p.name + "</b> сбила рейс командира " + (v.captain || "?") + " " + whereOf(v) +
      ": взято " + loot + " и корпус на детали.");
  unfly(v);
  const at = voyages.indexOf(v);
  if (at >= 0) voyages.splice(at, 1);
}

// ---- промысел -----------------------------------------------------------
// Кого вольница считает добычей — и, главное, ГДЕ.
//
// МЕЖЗВЁЗДНЫЙ ПЕРЕГОН НЕПРИКОСНОВЕНЕН. Корабль между звёздами идёт гипером:
// под воротами он в створе, под движками — в прыжке, и в обоих случаях его там
// попросту нет — ни догнать, ни остановить. Раньше вольница брала его прямо на
// перегоне, и это было худшее место, какое можно придумать: логово стоит В
// СИСТЕМЕ, перегон выходит из неё же, кольцо охоты накрывало его целиком, а
// рейс идёт двести с лишним месяцев — из системы не выпускали почти никого, и
// со стороны это выглядело так, будто корабли просто исчезают по дороге.
//
// Промысел идёт ТАМ, ГДЕ КОРАБЛЬ ЕСТЬ: между мирами одной звезды, на подходе и
// на отходе. Это и есть вся зона охоты — своя система, а не круг на карте
// галактики, и никакого радиуса ей больше не нужно.
//
// Прочее как было: прыжковые и портальные не трогают, свой хлебовоз не
// трогают, порожний перегон незачем.

/** Насколько вольница напориста: с какой вероятностью в месяц она выходит за
 *  рейсом у себя дома.
 *
 *  Прежние 0.008 были ПОЛОВИНОЙ межзвёздной ставки и стояли так потому, что
 *  рейс внутри системы идёт у логова под боком все свои полсотни месяцев, а
 *  межзвёздный — лишь частью пути. Межзвёздного промысла не стало вовсе, и
 *  половинить теперь не от чего: на 0.008 ватага выходила пять раз за двести
 *  лет, то есть её в партии практически нет.
 *
 *  Замер, 6 партий по 200 лет (погонь / ушло / опустело миров):
 *      0.008 — 19 / 63% / 3
 *      0.02  — 31 / 45% / 2
 *      0.04  — 40 / 43% / 6
 *  Взято 0.02: промысел виден (пять погонь за партию), половина рейсов уходит,
 *  а голод от разбоя не растёт — колонии пустеют не чаще, чем при вдвое более
 *  редкой охоте. На 0.04 он уже начинает стоить миров. */
export const HUNT_CHANCE = 0.02;

export function raidHunt(p: Corp): void {
  if (!p.home) return;
  const ps = systems[p.home.sys];
  let ships = idleAt(p.home.sys, (s) => { return s.owner === p.id; });
  if (!ships.length) return;
  for (let i = voyages.length - 1; i >= 0; i--) {
    if (!ships.length) break;
    const v = voyages[i];
    if (!v || v.fight !== undefined || v.chase !== undefined) continue;
    if (v.kind === "jump" || v.kind === "gate" || v.kind === "reloc" || v.kind === "empty") continue;
    // Гипер: сюда не дотянуться. Межзвёздный рейс несёт sysFrom, рейс между
    // мирами — from и to; разные системы у концов значат то же самое.
    if (v.sysFrom !== undefined) continue;
    if (!v.from || !v.to || v.from.sys !== v.to.sys) continue;
    // В чужую систему за рейсом не ходят: там чужой дом и чужая полиция.
    if (v.from.sys !== ps.id) continue;
    const owner = v.relief !== undefined ? v.relief : -1;
    if (owner === p.id) continue;
    if (v.to === p.home) continue;                                   // свой же хлебовоз
    if (rnd() > HUNT_CHANCE) continue;
    const band = ships.slice(0, RAID_MAX);
    // За тем, кого не догнать, не выходят вовсе: разменивать годы промысла на
    // догонялки за хлебовозом с ходовым Mk4 ватаге незачем.
    if (!worthChase(band, v)) continue;
    if (startChase(band, v, p.home.body)) S.chases++;
    ships = idleAt(p.home.sys, (s) => { return s.owner === p.id; });
  }
}
