
import { PIRATES, pirateName } from "./colony";
import { compOf, vtype } from "./data";
import { corpBuyShip, takeDock } from "./docks";
import { dispatch, surplusWorld } from "./food";
import { takeFuel } from "./market";
import { rnd } from "./rng";
import { onOrder, orderTransport } from "./shipyard";
import { S, U, corps, docks, say, systems, voyages, worlds } from "./state";
import { devMult } from "./tech";
import { canTravel, fuelCost, needWith, travelExtra } from "./travel";
import { clamp } from "./util";
import { addStock, popOf } from "./world";
import type { Corp, Pop, Rock, World } from "./types";

export function corpRelief(): void {
  worlds.forEach((w) => {
    if (w.founder < 0) return;
    const total = popOf(w);
    if (w.food.short < 2 && w.food.stock > total * 4) return;         // не голодает
    if (w.reliefAt && S.tick - w.reliefAt < 24) return;
    if (voyages.some((v) => { return v.kind === "food" && v.to === w; })) return;
    // кто тут стоит и при деньгах: тот и платит
    let payer: Corp = null;
    w.branches.forEach((b) => { const c = corps[b.corp]; if (c.cash > 260 && (!payer || c.cash > payer.cash)) payer = c; });
    if (!payer) return;
    const want = Math.ceil(Math.max(1, total - w.pop.farm * w.type.farm * devMult(w)) * 24);
    const pickSrc = surplusWorld(want, w);
    if (!pickSrc) return;
    const src = pickSrc.w, qty = Math.max(1, Math.min(want, Math.floor(pickSrc.extra)));
    if (!canTravel(src.sys, w.sys)) return;
    const price = qty * src.food.price, fk = src.sys === w.sys ? "fuel" : "sfuel";
    if (payer.cash < price + 60) return;
    const dk = takeDock(payer, null, src.sys, "cargo", needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
    if (!dk) {
      if (!onOrder("cargo", null, payer)) {
        const bought = corpBuyShip(payer, src, needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
        if (bought) orderTransport("cargo", bought, src.sys, null, payer);
      }
      return;
    }
    const parts = dk.parts;
    if (!takeFuel(payer, src.sys, fk, true, fuelCost(src.sys, w.sys))) {   // нет горючего — вернуть детали
      if (dk) docks.push(dk); else parts.forEach((p) => { addStock(corps[p.from], src.sys, p.k, 1); });
      return;
    }
    payer.cash -= price; src.gov.cash += price; src.food.stock -= qty;
    src.food.price = Math.min(6, src.food.price * 1.04);
    const v = dispatch(src, w, "food", qty, parts);
    if (dk) v.captain = dk.captain;
    v.relief = payer.id; w.reliefAt = S.tick; S.shipped += qty;
    say("<b>" + payer.name + "</b> шлёт " + qty + " еды на голодающий " + w.body.name + " — там её филиал.");
  });
}

// ---- случайные события ---------------------------------------------------
// Раз в год мир может получить неурожай (урожай вдвое на два-четыре года) или
// эпидемию (минус 15% людей), а компания — мятеж: уходит в разбой целиком,
// логово — один из её миров. Пока межзвёздный переход не открыт, мятеж редок;
// как только открыт, а пиратов нет, он почти неизбежен — к началу перелётов
// хоть кто-то должен быть вне закона.
export function turnPirate(c: Corp, lair: World, why: string): void {
  c.pirate = true; c.craft = "разбой"; c.nerve = 1.6; c.home = lair;
  c.name = pirateName(lair);
  c.color = PIRATES[S.pirateCount++ % PIRATES.length];
  say("<b>" + lair.body.name + "</b>: " + why + " — теперь это «" + c.name + "», и всё, что летит мимо " +
      systems[lair.sys].name + ", в опасности.");
}
// Куда уходит бунтующая контора. НЕ на столицу: логово под окнами государства
// выглядело нелепее всего — а именно оно и выпадало чаще прочих, потому что
// «самый дальний филиал» на деле означал последний открытый, и у конторы,
// которая дальше родины ещё не шагнула, им была родина. И не туда, где уже
// сидит чужая ватага: два логова у одной звезды — это две одинаковые строки
// в списке контор, а не две силы на карте.
function lairFor(c: Corp): World {
  let best: World = null, far = -1;
  c.branches.forEach((b) => {
    const w = b.world;
    if (w === S.home || corps.some((p) => { return p.pirate && p.home === w; })) return;
    const d = systems[w.sys].depth;
    if (d > far) { far = d; best = w; }
  });
  return best;
}

export function events(): void {
  worlds.forEach((w) => {
    if (w.blight <= 0 && rnd() < 0.06) {
      w.blight = 24 + Math.floor(rnd() * 24);
      say("Неурожай на " + w.body.name + ": урожай упадёт вдвое на " + Math.ceil(w.blight / 12) + " года.");
    }
    if (rnd() < 0.03 && popOf(w) > 1) {
      (["farm","prod","sci","free"] as (keyof Pop)[]).forEach((k) => { w.pop[k] *= 0.85; });
      say("Эпидемия на " + w.body.name + ": потеряно 15% населения.");
    }
  });
  // Первый разбойник по-прежнему гарантирован: к началу перелётов кто-то
  // должен быть вне закона. Дальше — только с ПОВОДОМ. Монетка без повода
  // (0.003 в месяц, то есть 3.5% в год) за триста лет делала пиратом каждого:
  // к 168-му году в разбое было 55% контор, включая четыре стартовые из пяти.
  // Флаг считаем на ходу, а не один раз до цикла: иначе в один месяц уходили
  // в разбой сразу несколько контор, все с гарантированным шансом.
  let outlaw = corps.some((c) => { return c.pirate; });
  corps.forEach((c) => {
    if (c.pirate || !c.branches.length) return;
    const first = S.moveKnown && !outlaw;
    if (rnd() > (first ? 0.25 : 0.008)) return;
    const lair = lairFor(c);
    if (!lair) return;
    if (!first && lair.food.short < 36) return;    // повод: три года голода на том филиале
    turnPirate(c, lair, "мятеж в " + c.name);
    outlaw = true;
  });
}

// ---- вольница ---------------------------------------------------------
// Второй заход. Жребий на краю (despair) уже решил первый исход, но голод на
// этом не кончается: артель или свободный мир, который голодает ещё три года,
// тоже берётся за оружие. Вольница сидит у своей звезды и перехватывает всё,
// что летит мимо — еду везёт домой, детали на склад, переселенцев забирает.
// Это единственная сила в игре, которая ОТНИМАЕТ, а не покупает.
// Прыжковые и открыватели не трогает: с них нечего взять.
export function piracy(): void {
  corps.forEach((p) => {
    if (!p.home || p.pirate) return;
    // три года голода после первого жребия и монетка: не всякий голодный мир
    // берётся за оружие, но чем дольше голод, тем вернее
    if (p.home.food.short < 36 || popOf(p.home) < 0.5 || rnd() > 0.03) return;
    p.pirate = true; p.craft = "разбой"; p.nerve = 1.6;
    p.name = pirateName(p.home);
    p.color = PIRATES[S.pirateCount++ % PIRATES.length];
    p.home.food.short = 0;
    say("<b>" + p.home.body.name + "</b> голодает и дальше — и уходит в разбой: теперь это «" +
        p.name + "», и всё, что летит мимо " + systems[p.home.sys].name + ", в опасности.");
  });
  corps.forEach((p) => {
    if (!p.pirate || !p.home) return;
    const ps = systems[p.home.sys];
    for (let i = voyages.length - 1; i >= 0; i--) {
      const v = voyages[i];
      // прыжковый не перехватить — ни в прыжке, ни на перегоне к точке старта
      if (v.kind === "jump" || v.kind === "gate" || v.kind === "reloc") continue;
      const owner = v.kind === "parts" ? v.forCorp
                : v.kind === "ferry" ? v.corp
                : (v.relief !== undefined ? v.relief : -1);
      if (owner === p.id) continue;
      const a = v.sysFrom !== undefined ? systems[v.sysFrom] : systems[v.from.sys];
      const b = v.sysFrom !== undefined ? systems[v.to] : systems[v.to.sys];
      if (a === b) continue;
      const t = clamp(v.t, 0, 1), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (v.to === p.home) continue;                                   // свой же хлебовоз
      if (Math.hypot(x - ps.x, y - ps.y) > 45) continue;               // не в зоне охоты
      // рейс идёт двести месяцев и десятки из них — в зоне; чтобы перехватывали
      // примерно каждый четвёртый, шанс в месяц должен быть крошечным
      if (rnd() > 0.0025) continue;
      let loot;
      if (v.kind === "food") { p.home.food.stock += v.qty; loot = v.qty + " еды"; }
      else if (v.kind === "pops") { p.home.pop.free += v.qty; loot = v.qty.toFixed(1) + " человечков"; }
      else if (v.kind === "ferry") {
        // захвачен целый корабль: он разбирается на детали, а предприятие
        // или колония, ради которых он шёл, срываются — место освобождается
        v.parts.forEach((pt) => { addStock(p, ps.id, pt.k, 1); });
        if (v.cargo === "colony") { v.body.claimed = false; loot = "колониальный модуль"; }
        else {
          if (v.dest && v.dest.ref) (v.dest.ref as Rock).taken = false;
          const ds = systems[v.to];
          ds.ventures = ds.ventures.filter((x) => { return x !== v.vent; });
          loot = "готовая платформа";
        }
      }
      else { addStock(p, ps.id, v.k, v.qty); loot = compOf(v.k).short; }
      S.raids++;
      if (U.pick && U.pick.data === v) U.pick = null;
      say("<b>" + p.name + "</b> перехватила рейс командира " + v.captain + " у " + ps.name + ": взято " + loot + ".");
      voyages.splice(i, 1);
    }
  });
}

