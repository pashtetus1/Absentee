// ===================== производство =====================
// Цех стоит на конкретной планете и складывает сделанное там же. Поэтому у
// филиала на окраине появляется смысл: он снабжает окраину, не гоняя корпуса
// через полгалактики.
import { canBuild, corps, market } from "./state";
import { COMPS } from "./data";
import { addStock, stockAt, totalStock } from "./world";

export function produce() {
  corps.forEach(function (c) {
    var mine = COMPS.filter(function (f) { return canBuild(c, f.key); });
    if (!mine.length) return;
    c.branches.forEach(function (b) {
      var cap = b.emp.prod, sys = b.world.sys;
      if (cap <= 0) return;
      if (!b.wip) b.wip = {};
      var weights = mine.map(function (f) {
        var w = market[f.key].price / f.work, own = 0;
        if (c.order && c.order.sys === sys)
          own = (c.order.need[f.key] || 0) - (c.order.got[f.key] || 0) - stockAt(c, sys, f.key);
        if (own > 0) return w * 3.5;
        // расходник берут всегда, но и его не копят без края
        if (f.key === "fuel" || f.key === "sfuel") return stockAt(c, sys, f.key) >= 10 ? 0 : w * 1.6;
        // на склад без спроса не работают: первая версия набивала его впустую
        if (stockAt(c, sys, f.key) >= 4 && market[f.key].want <= totalStock(c, f.key)) return 0;
        return w;
      });
      var sum = weights.reduce(function (a, x) { return a + x; }, 0);
      if (sum <= 0) return;
      mine.forEach(function (f, i) {
        b.wip[f.key] = (b.wip[f.key] || 0) + cap * weights[i] / sum;
        while (b.wip[f.key] >= f.work) { b.wip[f.key] -= f.work; addStock(c, sys, f.key, 1); }
      });
    });
  });
}

