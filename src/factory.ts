// ===================== производство =====================
// Цех стоит на конкретной планете и складывает сделанное там же. Поэтому у
// филиала на окраине появляется смысл: он снабжает окраину, не гоняя корпуса
// через полгалактики.
//
// И ДЕЛАЕТ ОН ВСЁ ИЗ МЕТАЛЛА. Работа рук — половина дела, вторая половина
// лежит на складе: на трюм уходит единица металла, на корпус Mk5 — пять
// (metalFor в data.ts). Металла в системе нет — цех стоит с недоделанной
// деталью, сколько бы людей в нём ни работало, и заказывает подвоз с той
// стороны, где есть рудный камень. Отсюда у планеты без своего металла
// появляется зависимость, которой раньше не было ни у кого: руки есть, а
// делать не из чего.
import { COMPS, metalFor } from "./data";
import { orderRes, priceAt, takeRes } from "./market";
import { canBuild, corps, market, say } from "./state";
import { addStock, stockAt, totalStock } from "./world";

export function produce(): void {
  corps.forEach((c) => {
    const mine = COMPS.filter((f) => { return canBuild(c, f.key); });
    if (!mine.length) return;
    c.branches.forEach((b) => {
      const cap = b.emp.prod, sys = b.world.sys;
      if (cap <= 0) return;
      if (!b.wip) b.wip = {};
      // Металла в системе нет вовсе — ни своего, ни у соседей по цеху: месяц
      // не начинаем, просим подвоз и стоим. Без этой проверки цех молотил бы
      // работу в недоделки, которые всё равно не станут деталями.
      if (!corps.some((s) => { return stockAt(s, sys, "metal") > 0; })) {
        orderRes(c, sys, "metal");
        if (!b.short) {
          b.short = true;
          say("<b>" + c.name + "</b>: цех на " + b.world.body.name + " встал без металла.");
        }
        return;
      }
      b.short = false;
      const weights = mine.map((f) => {
        let w = priceAt(f.key, sys) / f.work, own = 0;
        if (c.order && c.order.sys === sys)
          own = (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0) - stockAt(c, sys, f.key);
        if (own > 0) return w * 3.5;
        // Расходников в этом списке больше нет: вар и просинь не делают руками,
        // их добывают. Осталось одно правило — на склад без спроса не работают:
        // первая версия набивала его впустую.
        if (stockAt(c, sys, f.key) >= 4 && market[f.key].want <= totalStock(c, f.key)) return 0;
        return w;
      });
      const sum = weights.reduce((a, x) => { return a + x; }, 0);
      if (sum <= 0) return;
      mine.forEach((f, i) => {
        b.wip[f.key] = (b.wip[f.key] || 0) + cap * weights[i] / sum;
        while (b.wip[f.key] >= f.work) {
          // Металл списывается на ГОТОВУЮ деталь, а не на работу: не хватило —
          // деталь остаётся недоделанной ровно на пороге и дождётся подвоза.
          if (!takeRes(c, sys, "metal", false, metalFor(f))) { b.wip[f.key] = f.work; break; }
          b.wip[f.key] -= f.work; addStock(c, sys, f.key, 1);
        }
      });
    });
  });
}

