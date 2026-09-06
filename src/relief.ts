import { S, U, corps, docks, say, systems, voyages, worlds } from "./state";
import { addStock, popOf } from "./world";
import { devMult } from "./tech";
import { dispatch, surplusWorld } from "./food";
import { canTravel, needWith, travelExtra } from "./travel";
import { corpBuyShip, takeDock } from "./docks";
import { compOf, vtype } from "./data";
import { takeFuel } from "./market";
import { PIRATES } from "./colony";
import { clamp } from "./util";

export function corpRelief() {
  worlds.forEach(function (w) {
    if (w.founder < 0) return;
    var total = popOf(w);
    if (w.food.short < 2 && w.food.stock > total * 4) return;         // не голодает
    if (w.reliefAt && S.tick - w.reliefAt < 24) return;
    if (voyages.some(function (v) { return v.kind === "food" && v.to === w; })) return;
    // кто тут стоит и при деньгах: тот и платит
    var payer = null;
    w.branches.forEach(function (b) { var c = corps[b.corp]; if (c.cash > 260 && (!payer || c.cash > payer.cash)) payer = c; });
    if (!payer) return;
    var want = Math.ceil(Math.max(1, total - w.pop.farm * w.type.farm * devMult(w)) * 24);
    var pickSrc = surplusWorld(want, w);
    if (!pickSrc) return;
    var src = pickSrc.w, qty = Math.max(1, Math.min(want, Math.floor(pickSrc.extra)));
    if (!canTravel(src.sys, w.sys)) return;
    var price = qty * src.food.price, fk = src.sys === w.sys ? "fuel" : "sfuel";
    if (payer.cash < price + 60) return;
    var dk = takeDock(payer, null, src.sys, "cargo", needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
    var parts = dk ? dk.parts : corpBuyShip(payer, src, needWith(vtype("cargo"), travelExtra(src.sys, w.sys)));
    if (!parts) return;
    if (!takeFuel(payer, src.sys, fk, true)) {           // нет горючего у отправителя — вернуть детали
      if (dk) docks.push(dk); else parts.forEach(function (p) { addStock(corps[p.from], src.sys, p.k, 1); });
      return;
    }
    payer.cash -= price; src.gov.cash += price; src.food.stock -= qty;
    src.food.price = Math.min(6, src.food.price * 1.04);
    var v = dispatch(src, w, "food", qty, parts);
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
export function turnPirate(c, lair, why) {
  c.pirate = true; c.craft = "разбой"; c.nerve = 1.6; c.home = lair;
  c.name = "Вольница " + lair.body.name;
  c.color = PIRATES[S.pirateCount++ % PIRATES.length];
  say("<b>" + lair.body.name + "</b>: " + why + " — теперь это «" + c.name + "», и всё, что летит мимо " +
      systems[lair.sys].name + ", в опасности.");
}
export function events() {
  worlds.forEach(function (w) {
    if (w.blight <= 0 && Math.random() < 0.06) {
      w.blight = 24 + Math.floor(Math.random() * 24);
      say("Неурожай на " + w.body.name + ": урожай упадёт вдвое на " + Math.ceil(w.blight / 12) + " года.");
    }
    if (Math.random() < 0.03 && popOf(w) > 1) {
      ["farm","prod","sci","free"].forEach(function (k) { w.pop[k] *= 0.85; });
      say("Эпидемия на " + w.body.name + ": потеряно 15% населения.");
    }
  });
  var anyPirate = corps.some(function (c) { return c.pirate; });
  var chance = S.moveKnown && !anyPirate ? 0.25 : 0.003;
  corps.forEach(function (c) {
    if (c.pirate || !c.branches.length || Math.random() > chance) return;
    var lair = c.branches[c.branches.length - 1].world;      // самый дальний филиал
    turnPirate(c, lair, "мятеж в " + c.name);
  });
}

// ---- вольница ---------------------------------------------------------
// Второй заход. Жребий на краю (despair) уже решил первый исход, но голод на
// этом не кончается: артель или свободный мир, который голодает ещё три года,
// тоже берётся за оружие. Вольница сидит у своей звезды и перехватывает всё,
// что летит мимо — еду везёт домой, детали на склад, переселенцев забирает.
// Это единственная сила в игре, которая ОТНИМАЕТ, а не покупает.
// Прыжковые и открыватели не трогает: с них нечего взять.
export function piracy() {
  corps.forEach(function (p) {
    if (!p.home || p.pirate) return;
    // три года голода после первого жребия и монетка: не всякий голодный мир
    // берётся за оружие, но чем дольше голод, тем вернее
    if (p.home.food.short < 36 || popOf(p.home) < 0.5 || Math.random() > 0.03) return;
    p.pirate = true; p.craft = "разбой"; p.nerve = 1.6;
    p.name = "Вольница " + p.home.body.name;
    p.color = PIRATES[S.pirateCount++ % PIRATES.length];
    p.home.food.short = 0;
    say("<b>" + p.home.body.name + "</b> голодает и дальше — и уходит в разбой: теперь это «" +
        p.name + "», и всё, что летит мимо " + systems[p.home.sys].name + ", в опасности.");
  });
  corps.forEach(function (p) {
    if (!p.pirate || !p.home) return;
    var ps = systems[p.home.sys];
    for (var i = voyages.length - 1; i >= 0; i--) {
      var v = voyages[i];
      if (v.kind === "jump" || v.kind === "opener") continue;
      var owner = v.kind === "parts" ? v.forCorp
                : v.kind === "ferry" ? v.corp
                : (v.relief !== undefined ? v.relief : -1);
      if (owner === p.id) continue;
      var a = v.sysFrom !== undefined ? systems[v.sysFrom] : systems[v.from.sys];
      var b = v.sysFrom !== undefined ? systems[v.to] : systems[v.to.sys];
      if (a === b) continue;
      var t = clamp(v.t, 0, 1), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (v.to === p.home) continue;                                   // свой же хлебовоз
      if (Math.hypot(x - ps.x, y - ps.y) > 45) continue;               // не в зоне охоты
      // рейс идёт двести месяцев и десятки из них — в зоне; чтобы перехватывали
      // примерно каждый четвёртый, шанс в месяц должен быть крошечным
      if (Math.random() > 0.0025) continue;
      var loot;
      if (v.kind === "food") { p.home.food.stock += v.qty; loot = v.qty + " еды"; }
      else if (v.kind === "pops") { p.home.pop.free += v.qty; loot = v.qty.toFixed(1) + " человечков"; }
      else if (v.kind === "ferry") {
        // захвачен целый корабль: он разбирается на детали, а предприятие
        // или колония, ради которых он шёл, срываются — место освобождается
        v.parts.forEach(function (pt) { addStock(p, ps.id, pt.k, 1); });
        if (v.cargo === "colony") { v.body.claimed = false; loot = "колониальный модуль"; }
        else {
          if (v.dest && v.dest.ref) v.dest.ref.taken = false;
          var ds = systems[v.to];
          ds.ventures = ds.ventures.filter(function (x) { return x !== v.vent; });
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

