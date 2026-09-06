// Мир — это населённая планета: люди, еда, кошелёк правительства и места под
// филиалы. До колонизации планета миром не является.
import { dateStr, say, worlds } from "./state";

export function makeWorld(body, seed, founder) {
  var w = { body:body, sys:body.sys, type:body.type, cap:body.type.cap, cap0:body.type.cap,
            pop:{ farm:seed * 0.6, prod:seed * 0.3, sci:seed * 0.05, free:seed * 0.05 },
            wage:{ farm:2.4, prod:3, sci:4.2 }, food:{ stock:seed * 2, price:1, short:0 },
            gov:{ cash:60 }, slots:2 + Math.round(body.type.cap / 4), rights:[], branches:[],
            wantOut:0, wantIn:0, founder:founder, born:dateStr(), parts:[], flow:"", blight:0,
            // Свежая колония — это разруха: полпустого склада, дорогая еда, пустая
            // казна, цеха не построены, урожай с необжитой земли вдвое меньше.
            // Десять лет (120 месяцев) она живёт на привозном и на терпении.
            rough: founder >= 0 ? 120 : 0 };
  // модуль везёт трёхлетний запас провизии — иначе колония умирала раньше,
  // чем первый хлебовоз успевал дойти (рейс идёт двенадцать-семнадцать лет)
  if (founder >= 0) { w.food.stock = seed * 24; w.food.price = 2.5; w.gov.cash = 80; }   // два года провизии: голод должен случаться
  body.world = w;
  worlds.push(w);
  return w;
}
export function popOf(w){ return w.pop.farm + w.pop.prod + w.pop.sci + w.pop.free; }

// ---- склад с адресом --------------------------------------------------
// Деталь лежит там, где её сделали. Раньше склад был у компании общий на всю
// галактику, и корпус мгновенно оказывался за пять звёзд от цеха — рынок был
// честным только на бумаге. Теперь у каждой единицы есть система, и если она
// не та, деталь придётся ВЕЗТИ.
export function stockAt(c, sys, k){ var s = c.stock[sys]; return (s && s[k]) || 0; }
// Сумма по системам держится в c.tot и правится вместе со складом: профиль
// показал, что пересчёт суммы через Object.keys на каждый запрос съедал
// пятнадцать процентов тика. Все записи в склад идут ТОЛЬКО через addStock.
export function addStock(c, sys, k, n) {
  if (!c.stock[sys]) c.stock[sys] = {};
  c.stock[sys][k] = (c.stock[sys][k] || 0) + n;
  if (!c.tot) c.tot = {};
  c.tot[k] = (c.tot[k] || 0) + n;
}
export function totalStock(c, k) { return (c.tot && c.tot[k]) || 0; }
export function whereStock(c, k) {                 // системы, где у компании есть эта деталь
  var out = [];
  for (var s in c.stock) if (c.stock[s][k] > 0) out.push(+s);
  return out;
}
export function firstStockSys(c, k) {              // первая такая система, без массива
  for (var s in c.stock) if (c.stock[s][k] > 0) return +s;
  return -1;
}
export function hasBranch(c, w){ return w.branches.some(function (b) { return b.corp === c.id; }); }

export function openBranch(c, w, quiet) {
  if (hasBranch(c, w)) return null;
  var b = { corp:c.id, world:w, emp:{ prod:0.4, sci:0.1 }, jobs:{ prod:1, sci:0.4 } };
  w.branches.push(b); c.branches.push(b);
  if (!quiet) say("<b>" + c.name + "</b> открыла филиал на " + w.body.name + ".");
  return b;
}

