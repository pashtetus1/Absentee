// ===================== еда и переселение =====================
// ---- отделение голодного мира ---------------------------------------------
// Мир, который голодает пять лет подряд, перестаёт ждать хлебовоз и берёт
// дело в свои руки: правительство становится НОВОЙ компанией. Она забирает
// все филиалы на планете (их владельцы теряют место), наследует знания
// основателя — не патенты, только знания, — и с этого дня живёт наукой об
// освоении именно своего класса миров. Это старая идея из star-empire-sprawl
// (колония отделяется и становится игроком), только теперь её рождает голод.

import { COMPS, TEMPLATE } from "./data";
import { rnd } from "./rng";
import { seizeYard } from "./shipyard";
import { S, corps, say, systems, worlds } from "./state";
import { allTech } from "./tech";
import { openBranch, popOf } from "./world";
import type { Corp, World } from "./types";

export const EXTRA = ["#c9a0ff","#8ef0d0","#ffd27a","#ff9ecf","#9ad4ff","#d4ff7a","#ffb4a0","#a0ffe0"];
export const PIRATES = ["#ff5c5c","#ff8c42","#e04f8f","#ff3b6b"];
// Имя зависит от того, какой жребий выпал миру (см. despair), поэтому
// приходит снаружи, а не собирается здесь: "Свободный" годится только для
// того исхода, где мир и правда ушёл из государства.
// Ватага зовётся по своему логову — так игрок сразу знает, у какой звезды её
// ждать. Но имя обязано быть РАЗНЫМ: в списке контор три «Вольницы Вьюга»
// неразличимы, и непонятно, кого из них ты только что обидел.
const ORD = ["", "Вторая ", "Третья ", "Четвёртая ", "Пятая "];
export function pirateName(w: World): string {
  const tail = "ольница " + w.body.name;
  for (let i = 0; i < ORD.length; i++) {
    const n = i ? ORD[i] + "в" + tail : "В" + tail;
    if (!corps.some((c) => c.name === n)) return n;
  }
  return "Вольница " + w.body.name + " " + corps.length;
}

export function freeName(w: World): string {
  return "Свободн" + (/[аяь]$/.test(w.body.name.replace(/ [IVX]+$/, "")) ? "ая " : "ый ") + w.body.name;
}
// origin — какой жребий выпал миру, bornAt — где это случилось. По имени
// происхождение НЕ определить: piracy() переименовывает контору в "Вольницу",
// и артель с независимостью становятся неотличимы. А home не годится как
// запись о родине: turnPirate при мятеже переносит логово на другой мир.
export function spawnCorp(w: World, name: string, origin: string): Corp {
  const founder = corps[w.founder >= 0 ? w.founder : 0];
  const c = { id:corps.length, name:name || freeName(w),
            color:EXTRA[(corps.length - TEMPLATE.length) % EXTRA.length], craft:"выживание",
            nerve:1.3, apt:{}, cash:Math.max(60, w.gov.cash * 0.8), known:{}, spent:{}, stock:{},
            target:null, order:null, branches:[], sold:0, bought:0, cool:0, embargo:{}, ask:{},
            native:w.type.tech, home:w, origin:origin || "государство", bornAt:w } as Corp;
  Object.keys(founder.apt).forEach((k) => { c.apt[k] = founder.apt[k] * 0.8; });
  c.apt[w.type.tech] = 1.6;                        // свой мир они понимают лучше всех
  allTech().forEach((f) => { c.spent[f.key] = 0; });
  COMPS.forEach((f) => { c.ask[f.key] = 1.05; });
  Object.keys(founder.known).forEach((k) => { c.known[k] = true; });
  corps.push(c);
  return c;
}
// ---- край -------------------------------------------------------------
// Четыре года голода подряд — и мир доходит до края. Что из этого выйдет,
// РЕШАЕТ ЖРЕБИЙ из трёх равных долей, а не лестница из ступеней. Раньше исход
// был один и предсказуемый (независимость, потом разбой), и игроку оставалось
// считать месяцы до известного события. Теперь кризис один, а лицо у него
// каждый раз другое, и страховаться приходится заранее:
//   артель      — люди скидываются в свою контору, мир остаётся в государстве
//                 и чужие цеха на месте. Дешевле всех, но конкурент появился.
//   вольница    — та же контора, но сразу в разбой. Мир формально ваш, только
//                 закона на нём больше нет, и всё, что летит мимо, в опасности.
//   государство — мир уходит целиком и забирает чужие филиалы. Самый дорогой
//                 исход: вы теряете и мир, и цеха на нём.
// Общее у всех трёх: касса мира скидывается в общее дело (остаётся пятая
// часть), счётчик голода обнуляется, второй раз жребий не тянут.
export function despair(): void {
  worlds.forEach((w) => {
    if (w.founder < 0 || w.edge || w.food.short < 48 || popOf(w) < 0.5) return;   // четыре года голода
    w.edge = true;
    let roll = rnd(), c;
    if (roll < 0.3333) {
      c = spawnCorp(w, "Артель " + w.body.name, "артель");
      openBranch(c, w, true);
      say("<b>" + w.body.name + "</b> четыре года голодает — и люди скинулись в свою контору: " +
          "теперь это «" + c.name + "». Мир остался в государстве, чужие цеха на месте.");
    } else if (roll < 0.6667) {
      c = spawnCorp(w, pirateName(w), "вольница");
      openBranch(c, w, true);
      c.pirate = true; c.craft = "разбой"; c.nerve = 1.6;
      c.color = PIRATES[S.pirateCount++ % PIRATES.length];
      seizeYard(w, c.id);      // верфь под вольницей: строить она не станет, но и никто другой
      say("<b>" + w.body.name + "</b> четыре года голодает — и берётся за оружие, не дожидаясь никого: " +
          "теперь это «" + c.name + "», и всё, что летит мимо " + systems[w.sys].name + ", в опасности. " +
          "Мир при этом из государства не вышел.");
    } else {
      c = spawnCorp(w, null, "государство");
      const lost = w.branches.map((b) => { return corps[b.corp].name; });
      // прежние филиалы отбираются: их хозяева не кормили этот мир
      w.branches.forEach((b) => {
        const o = corps[b.corp];
        o.branches = o.branches.filter((x) => { return x !== b; });
      });
      w.branches = [];
      openBranch(c, w, true);
      w.founder = c.id; w.free = true;
      seizeYard(w, c.id);        // верфь уходит вместе с планетой
      say("<b>" + w.body.name + "</b> объявил независимость после четырёх лет голода: " +
          "теперь это компания «" + c.name + "». Филиалы " + (lost.length ? lost.join(", ") : "никого") + " отобраны.");
    }
    w.gov.cash *= 0.2; w.food.short = 0;
  });
}

// Поставщик — мир с наибольшим излишком СВЕРХ ПОЛУГОДОВОГО ЗАПАСА на себя.
