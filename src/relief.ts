
import { PIRATES, pirateName } from "./colony";
import { raidHunt } from "./battle";
import { startUprising } from "./ground";
import { holdOf, holdOfType, shipNeed, vtype } from "./data";
import { corpBuyShip } from "./docks";
import { bestOffer, buildCost, cargoTo, launch, takeOffer } from "./fleet";
import { GIVE_OVER, dispatch, surplusWorld } from "./food";
import { fuelBill, takeRes } from "./market";
import { rnd } from "./rng";
import { edgeShipyard, onOrder, orderTransport } from "./shipyard";
import { S, corps, docks, say, systems, worlds } from "./state";
import { bestEngineAt } from "./tech";
import { canTravel, fuelCost, needWith, travelExtra } from "./travel";
import { popOf, reserveOf, stockAt } from "./world";
import { realmOfCorp } from "./realm";
import type { Corp, Pop, World } from "./types";

export function corpRelief(): void {
  worlds.forEach((w) => {
    if (w.founder < 0) return;
    const total = popOf(w);
    if (w.food.short < 2 && w.food.stock > total * 4) return;         // не голодает
    if (w.reliefAt && S.tick - w.reliefAt < 24) return;
    if (cargoTo("food", w).length) return;                               // еда уже в пути или корабль идёт за ней
    // кто тут стоит и при деньгах: тот и платит
    let payer: Corp = null;
    w.branches.forEach((b) => { const c = corps[b.corp]; if (c.cash > 260 && (!payer || c.cash > payer.cash)) payer = c; });
    if (!payer) return;
    // Везут полный трюм и только его (FOOD_PER_HOLD, data.ts): и частный
    // хлебовоз полупустым не уходит. Раньше партия считалась от дефицита урожая
    // на два года вперёд — теперь её размер задаёт корабль, а не просьба.
    const qty = holdOfType(vtype("cargo"));
    const pickSrc = surplusWorld(qty, w);
    if (!pickSrc) return;
    const src = pickSrc.w;
    if (!canTravel(src.sys, w.sys)) return;
    const price = qty * src.food.price, fk = src.sys === w.sys ? "fuel" : "sfuel", tanks = fuelCost(src.sys, w.sys);
    if (payer.cash < price + 60) return;
    // Корабль выбирается так же, как у правительства (fleet.ts): биржа — здесь
    // или за звёздами с порожним перегоном — или верфь. Частный хлебовоз — тоже
    // хлебовоз, за место в очереди не платит.
    const pay = { world: null as World, corp: payer };
    const offer = bestOffer(pay, "cargo", needWith(vtype("cargo"), travelExtra(src.sys, w.sys)), src);
    const recipe = shipNeed(vtype("cargo"), bestEngineAt(src.sys), travelExtra(src.sys, w.sys));
    const build = recipe ? buildCost(pay, "cargo", recipe, src.sys, src, realmOfCorp(payer), false) : null;
    if (!offer || (build !== null && build < offer.cost)) {
      if (!onOrder("cargo", null, payer)) {
        const buy = shipNeed(vtype("cargo"), bestEngineAt(src.sys), travelExtra(src.sys, w.sys));
        const bought = buy && corpBuyShip(payer, src, buy);
        if (bought) orderTransport("cargo", bought, src.sys, null, payer);
      }
      return;
    }
    const dk = offer.dock;
    // Всё проверяется ДО того, как корабль взят: трюмы самого корабля, излишек у
    // поставщика, горючее на рейс с грузом и касса на всё сразу. Иначе корабль
    // был бы уже куплен, а рейс не вышел бы.
    const load = holdOf(dk.parts), cost = load * src.food.price;
    if (load <= 0 || src.food.stock - reserveOf(src) * GIVE_OVER < load) return;
    if (!corps.some((s) => stockAt(s, src.sys, fk) > 0)) return;          // нет горючего на рейс
    if (payer.cash < cost + offer.price + offer.fuel + fuelBill(fk, tanks, src.sys) + 60) return;
    if (!takeOffer(pay, offer, src)) return;
    // корабль уже куплен — не вышел рейс, он остаётся на стоянке, но уже её
    if (!takeRes(payer, src.sys, fk, true, tanks)) { dk.corp = payer.id; dk.gov = null; docks.push(dk); return; }
    payer.cash -= cost; src.gov.cash += cost; src.food.stock -= load;
    src.food.price = Math.min(6, src.food.price * 1.04);
    launch(dk, "food", src, w, load, payer.id);
    w.reliefAt = S.tick; S.shipped += load;
    say("<b>" + payer.name + "</b> шлёт " + load + " еды на голодающий " + w.body.name + " — там её филиал.");
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
  // Мятеж — не восстание населения, а уход конторы за черту, и наземной битвы
  // за этим не следует: мир остаётся чей был. Но промысел требует КОРАБЛЕЙ, а
  // их негде строить: общая верфь заказа от вольницы не примет (army.ts). Так
  // что ватага первым делом закладывает свой стапель — ровно как та, что
  // поднялась из голода.
  edgeShipyard(lair, c.id);
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
// тоже берётся за оружие — и это тоже ВОССТАНИЕ с наземной битвой, а не смена
// вывески. Кто победит, тот и хозяин планеты (ground.ts).
//
// Сам промысел живёт теперь не здесь, а в battle.ts: вольница не забирает груз
// монеткой, она выводит на рейс военный корабль, и дальше месяцами идёт бой.
// Здесь остался только повод — кто и когда берётся за оружие.
export function piracy(): void {
  corps.forEach((p) => {
    if (!p.home || p.pirate || p.home.war) return;
    // три года голода после первого жребия и монетка: не всякий голодный мир
    // берётся за оружие, но чем дольше голод, тем вернее
    if (p.home.food.short < 36 || popOf(p.home) < 0.5 || rnd() > 0.03) return;
    p.nerve = 1.6;
    p.home.food.short = 0;
    say("<b>" + p.home.body.name + "</b> голодает и дальше — и берётся за оружие.");
    startUprising(p.home, p, "вольница");
  });
  corps.forEach((p) => { if (p.pirate && p.home) raidHunt(p); });
}

