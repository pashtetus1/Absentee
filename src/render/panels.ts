// ===================== панели =====================


// Панели написаны на innerHTML, и один и тот же el() достаёт то ползунок
// (value), то блок текста (textContent). Уточнять тип приведением на каждой
// строке — шум ради шума, поэтому здесь один расширенный тип на весь модуль.
// value нарочно any: в разметку кладут и числа, браузер сам приводит их к
// строке, и String() вокруг каждого присваивания ничего бы не поймал.

import { COLTECH, COMPS, MARKS, colOf, compOf, markName, moveName, vtype, btype } from "../data";
import { dockValue } from "../docks";
import { galaxyRange, within } from "../galaxy";
import { cutOf, buyPrice, harvestOf } from "../labour";
import { HOME, isRealm, manyRealms, realmName, realmOf, treasuryOf } from "../realm";
import { seedOf } from "../rng";
import { prodOf, sciOf } from "../science";
import { yardAt } from "../shipyard";
import { L, S, U, UPKEEP, canBuild, corps, dateStr, feed, makersOf, market, patLive, patents, projects, proposals, shipyards, systems, voyages, worlds } from "../state";
import { DEVS, ENGINES, techOf } from "../tech";
import { fuelCost } from "../travel";
import { fmt } from "../util";
import { popOf } from "../world";
import { buildAim, buildDone, buildState, cargoName, queueEta } from "./models";
import { seenSys } from "./scene";
import type { Build, Part, World } from "../types";

export type Ctl = HTMLElement & { value: any; textContent: any; disabled: boolean; checked: boolean };
export function el(id: string): Ctl { return document.getElementById(id) as Ctl; }

/** Ходовой двигатель корабля и его скорость внутри системы: у каждого
 *  корабля он есть, и по нему видно, быстрый это корабль или нет. */
export function engLine(parts: Part[]): string {
  const e = (parts || []).map((p) => { return compOf(p.k); }).filter((c) => { return c && c.mult; })
    .sort((x, y) => { return y.mult - x.mult; })[0];
  return '<div class="part"><span class="pn">ходовой двигатель</span><span class="pw">' +
         (e ? e.short + ' · скорость ×' + e.mult.toFixed(1) : 'нет') + '</span></div>';
}
export function partsList(parts: Part[], ownerId: number): string {
  if (!parts || !parts.length) return '<div class="empty">Состав неизвестен.</div>';
  const by: Record<string, number> = {};
  parts.forEach((p) => { const k = p.k + "|" + p.from; by[k] = (by[k] || 0) + 1; });
  return Object.keys(by).map((k) => {
    const bits = k.split("|"), f = compOf(bits[0]), from = corps[+bits[1]];
    return '<div class="part"><i class="dot" style="background:' + from.color + '"></i>' +
           '<span class="pn">' + f.name.toLowerCase() + (by[k] > 1 ? " ×" + by[k] : "") + '</span>' +
           '<span class="pw">' + (+bits[1] === ownerId ? "своё" : from.name) + '</span></div>';
  }).join("");
}

// Очередь верфи целиком: позиция за позицией, по порядку, в котором к ним
// пойдут руки. Раньше посмотреть очередь было нельзя нигде — панель писала
// голову и сухое «ждут следом: Артель · грузовик», а верфь при этом главное
// узкое место партии: пока она занята, не летит НИЧЕГО. Здесь у каждой
// позиции видно, кто заказал, зачем, насколько готово, когда дойдёт очередь и
// из чего собирают то, что уже на стапеле.
export function yardQueue(y: { queue: Build[]; crew: number }): string {
  if (!y.queue.length) return '<div class="empty">Очередь пуста.</div>';
  const eta = queueEta(y as Parameters<typeof queueEta>[0]);
  const first = y.queue.findIndex((b) => b.left > 0);
  return y.queue.map((b, i) => {
    const done = buildDone(b), aim = buildAim(b);
    const when = eta[i] === null ? "рук нет"
               : eta[i] === 0 ? "сходит" : "через " + eta[i] + " мес.";
    return '<div class="row"><div class="rhead">' +
      '<i class="dot" style="background:' + b.color + '"></i>' +
      '<span class="rname">' + (i + 1) + '. ' + corps[b.lead].name + ' · ' + b.vt.name + '</span>' +
      '<span class="rmeta">' + Math.round(done * 100) + '%</span></div>' +
      '<div class="bar"><i style="width:' + (done * 100) + '%;background:' + b.color + '"></i></div>' +
      '<div class="rmeta">' + buildState(b, i === first) +
      (aim ? ' · ' + aim : '') + ' · ' + when + '</div>' +
      // Состав показываем только у того, что на стапеле: у пяти позиций пять
      // списков деталей превращают панель в простыню, а интересно это ровно
      // про тот корабль, который вот-вот сойдёт.
      (i === first ? partsList(b.parts, b.lead) : '') + '</div>';
  }).join("");
}

export function worldCard(w: World): string {
  const p = w.pop, total = popOf(w);
  // Урожай спрашиваем у harvestOf — у той же функции, по которой мир кормится
  // на самом деле. Здесь стояла своя оценка (p.farm * w.type.farm), четвёртая
  // по счёту: она завышала урожай в разруху и в неурожай, занижала на
  // освоенных мирах, и панель писала «кормится сама» голодающему.
  // Итог по хлебу берём готовым (w.food.gain): он считается по складу ДО еды,
  // а панель видит склад уже после — восстановить это число она может только
  // неверно, и это была бы та же ошибка, что и с урожаем.
  const grown = harvestOf(w), buy = buyPrice(w);
  // Звёздочка у имени — тот же знак столицы, что на карте и на диске планеты.
  return '<div class="card"><h3>' + (w === S.home ? '★ ' : '') + w.body.name + ' · ' + w.type.name + '</h3>' +
    '<div class="sub">' + fmt(total) + ' из ' + w.cap + ' человечков · ' +
    (w.founder >= 0 ? "основана " + corps[w.founder].name + ", " + w.born : "столица") + '</div>' +
    // Под чьим гербом планета. Пока государство одно, писать это незачем — как
    // и рисовать щиты на сцене.
    (realmOf(w) !== HOME ? '<div class="sub" style="color:var(--gold)">Не в государстве: «' +
       realmName(realmOf(w)) + '»</div>' : '') +
    '<div class="part"><span class="pn">в поле</span><span class="pw">' + fmt(p.farm) + ' · ' + w.wage.farm.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">в цехах</span><span class="pw">' + fmt(p.prod) + ' · ' + w.wage.prod.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">в лабораториях</span><span class="pw">' + fmt(p.sci) + ' · ' + w.wage.sci.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">без работы</span><span class="pw">' + fmt(p.free) + '</span></div>' +
    '<div class="sub" style="margin:7px 0 3px">Еда: своя ' + grown.toFixed(1) +
    ', надо ' + total.toFixed(1) + ', склад ' + w.food.stock.toFixed(1) +
    (w.food.short > 2 ? ' · <span style="color:var(--bad)">голод</span>' : '') + '</div>' +
    (w.rough > 0 ? '<div class="sub" style="margin:0 0 3px;color:var(--bad)">Разруха: ещё ' + Math.ceil(w.rough / 12) + ' лет</div>' : '') +
    (w.blight > 0 ? '<div class="sub" style="margin:0 0 3px;color:var(--bad)">Неурожай: ещё ' + w.blight + ' мес.</div>' : '') +
    // Три года между закладкой стапеля и первым кораблём — это долго, и без
    // строки тут ничего не происходит вовсе: игрок видит голодный мир и никакого
    // следа решения, которое уже принято.
    (w.edgeYard ? '<div class="sub" style="margin:0 0 3px;color:var(--gold)">Стапель из мусора: соберут через ' +
       Math.max(0, w.edgeYard.at - S.tick) + ' мес.</div>' : '') +
    // Долю называем ЧИСЛОМ. Закуп и продажа у свободного мира почти совпадают, и
    // без этой подписи два близких числа читаются как опечатка, а не как
    // решение его правительства.
    '<div class="sub" style="margin:0 0 3px">Хлеб: закуп ' + buy.toFixed(2) + ', продажа ' + w.food.price.toFixed(2) +
    ' · доля казны ' + Math.round(cutOf(w) * 100) + '%' +
    ' · казне ' + w.food.gain.toFixed(1) + '/мес</div>' +
    '<div class="sub" style="margin:0 0 3px">Казна мира ' + Math.round(w.gov.cash) +
    ' · содержание ' + (popOf(w) * UPKEEP).toFixed(1) + '/мес' +
    ' · уехать хотят ' + w.wantOut.toFixed(1) + ' · ' + w.flow + '</div>' +
    (w.built.length ? '<div class="sub" style="margin:0 0 3px">Постройки: ' +
       w.built.map((k) => btype(k).name + ' (мест ' + btype(k).jobs.toFixed(1) + ')').join(", ") + '</div>' : '') +
    '<div class="sub" style="margin:0">Филиалы (' + w.branches.length + ' из ' + w.slots + '): ' +
    (w.branches.length ? w.branches.map((b) => { return corps[b.corp].name; }).join(", ") : "нет") + '</div>' +
    (w.parts.length ? '<div class="sub" style="margin:7px 0 2px">Модуль собран из:</div>' + partsList(w.parts, w.founder) : '') +
    '</div>';
}

export function inspector(): void {
  const box = el("inspect");
  if (!U.pick) { box.innerHTML = '<div class="empty">Ткни в планету, корабль, станцию или верфь.</div>'; return; }
  const d = U.pick.data;
  if (U.pick.kind === "body") {
    if (d.world) { box.innerHTML = worldCard(d.world); return; }
    const pr = projects.filter((p) => { return p.body === d; })[0];
    const who = corps.filter((c) => { return canBuild(c, d.type.tech); }).map((c) => { return c.name; });
    box.innerHTML = '<div class="card"><h3>' + d.name + ' · ' + d.type.name + '</h3>' +
      '<div class="sub">не заселена · предел ' + d.type.cap + ' · урожай с фермера ' + d.type.farm + '</div>' +
      '<div class="part"><span class="pn">нужна технология</span><span class="pw">' + colOf(d.type.tech).name + '</span></div>' +
      '<div class="part"><span class="pn">умеют колонизировать</span><span class="pw">' + (who.length ? who.join(", ") : "никто") + '</span></div>' +
      (pr ? '<div class="sub" style="margin-top:7px">Подписка ' + corps[pr.lead].name + ': ' + Math.round(pr.purse) +
            ' из ' + pr.cost + ', вкладчиков ' + pr.backers.length + '</div>' : '') + '</div>';
    return;
  }
  if (U.pick.kind === "dock") {
    const owner = d.corp >= 0 ? corps[d.corp].name : "правительство " + (d.gov ? d.gov.body.name : "?");
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "liner" ? "Переселенческий" : "Грузовик") + ' на стоянке</h3>' +
      '<div class="sub">на орбите ' + d.world.body.name + ' с ' + Math.floor(d.since / 12) + ' года · командир ' + d.captain + '</div>' +
      '<div class="part"><span class="pn">хозяин</span><span class="pw">' + owner + '</span></div>' +
      '<div class="part"><span class="pn">купить можно за</span><span class="pw">' + Math.round(dockValue(d)) + '</span></div>' +
      '<div class="sub" style="margin:7px 0 2px">Из чего собран:</div>' + engLine(d.parts) + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "cargo" && d.kind === "parts") {
    const fc = compOf(d.k), buyer = corps[d.forCorp], sellerC = corps[d.corp];
    box.innerHTML = '<div class="card"><h3>Грузовик с деталями</h3>' +
      '<div class="sub">везёт ' + fc.name.toLowerCase() + ' из ' + systems[d.sysFrom].name + ' в ' +
      systems[d.to].name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      '<div class="part"><i class="dot" style="background:' + sellerC.color + '"></i><span class="pn">продал</span><span class="pw">' + sellerC.name + '</span></div>' +
      '<div class="part"><i class="dot" style="background:' + buyer.color + '"></i><span class="pn">купил и везёт</span><span class="pw">' + buyer.name + '</span></div>' +
      '<div class="sub" style="margin:6px 0 0">Рейс сжёг межзвёздного топлива: ' +
      fuelCost(d.sysFrom, d.to) + '.</div>' +
      '<div class="sub" style="margin:7px 0 2px">Грузовик собран из:</div>' + engLine(d.parts) + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  // Перегон готового корабля в чужую систему и уход прыжкового к точке старта.
  // Ни того, ни другого панель не знала: оба падали в ветку хлебовоза, где
  // d.qty.toFixed рушил inspector. А его зовёт step() — и партия вставала
  // насмерть, не только окно.
  if ((U.pick.kind === "cargo" || U.pick.kind === "jumpship") && (d.kind === "ferry" || d.kind === "reloc")) {
    box.innerHTML = '<div class="card"><h3>' + cargoName(d) + '</h3>' +
      '<div class="sub">' + corps[d.corp].name + ' · ' + (d.kind === "reloc" ? 'идёт к точке старта в ' : 'перегон в ') +
      systems[d.to].name + ' из ' + systems[d.sysFrom].name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      '<div class="sub" style="margin:0 0 4px">' + (d.kind === "reloc"
        ? 'Там заправится и прыгнет к ' + systems[d.jumpTo].name + '.'
        : 'По прилёте встанет на свой курс в системе.') + '</div>' +
      engLine(d.parts) + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "cargo" && (d.kind === "food" || d.kind === "pops")) {
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "food" ? "Грузовик" : "Переселенческий") + '</h3>' +
      '<div class="sub">везёт ' + (d.kind === "food" ? d.qty + " еды" : d.qty.toFixed(1) + " человечков") +
      ' с ' + d.from.body.name + ' на ' + d.to.body.name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      '<div class="sub" style="margin:0 0 4px">Куплен правительством ' + d.to.body.name + ', собран из:</div>' +
      engLine(d.parts) + partsList(d.parts, -1) + '</div>';
    return;
  }
  if (U.pick.kind === "jumpship") {
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "gate" ? "Портальный корабль" : "Прыжковый корабль") + '</h3>' +
      '<div class="sub">' + corps[d.corp].name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      (d.kind === "gate" ? '<div class="sub" style="margin:0 0 4px">Дойдёт до ' + systems[d.to].name +
        (d.upgrade ? ' — и переделает створы на этом маршруте на старшую марку.' : ' — и станет воротами на этом маршруте.') + '</div>' : '') +
      engLine(d.parts) + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "gate") {
    const who = d.owner >= 0 ? corps[d.owner].name : "государство";
    box.innerHTML = '<div class="card"><h3>' + (d.built ? "Звёздные ворота" : "Ворота строятся") + '</h3>' +
      '<div class="sub">маршрут ' + systems[d.a].name + ' — ' + systems[d.b].name +
      (d.born ? ' · с ' + d.born : '') + '</div>' +
      '<div class="part"><span class="pn">поставила</span><span class="pw">' + who + '</span></div>' +
      '<div class="part"><span class="pn">марка створов</span><span class="pw">Mk' + (d.mark || 1) +
        (d.upgrading ? ' → переделывают' : '') + '</span></div>' +
      (d.built ? '<div class="part"><span class="pn">рейсов за последнее время</span><span class="pw">' + Math.round(d.trips || 0) + '</span></div>' : '') +
      '<div class="sub" style="margin:6px 0 0">' + (d.built
        ? 'По этому маршруту летают без двигателя со скоростью младшей марки створов. Проход через створ жжёт бак межзвёздного топлива.'
        : 'Портальный корабль ещё в пути.') + '</div></div>';
    return;
  }
  if (U.pick.kind === "ship") {
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "colony" ? "Колониальный модуль" : "Добывающая платформа") + '</h3>' +
      '<div class="sub">' + corps[d.corp].name + ' · курс на ' +
      (d.kind === "colony" ? d.body.name : d.dest.label) + ' · ' + Math.round(d.t * 100) + '%</div>' +
      engLine(d.parts) + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "vent") {
    box.innerHTML = '<div class="card"><h3>Добывающая платформа</h3>' +
      '<div class="sub">' + corps[d.lead].name + ' · ' + d.yield + '/мес · ' + d.dest.label +
      ' · осталось ' + Math.round(d.left / 12) + ' лет</div>' + partsList(d.parts, d.lead) + '</div>';
    return;
  }
  // Кликают по ВЕРФИ, а не по сборке: с тех пор как верфь стала постройкой, в
  // hits кладут её саму. Панель об этом не знала и читала у верфи поля сборки
  // (d.vt.name у Shipyard нет) — а inspector зовётся из step(), так что один
  // клик по кранам останавливал партию насмерть, а не только ломал окно.
  if (U.pick.kind === "yard") {
    box.innerHTML = '<div class="card"><h3>Верфь у ' + d.world.body.name + '</h3>' +
      '<div class="sub">' + (d.owner >= 0 ? "хозяин " + corps[d.owner].name : "общая") +
      ' · людей на стапеле ' + d.crew.toFixed(1) + ' · в очереди ' + d.queue.length + '</div>' +
      yardQueue(d) + '</div>';
    return;
  }
  box.innerHTML = '<div class="empty">—</div>';
}

export function panels(): void {
  el("market").innerHTML = COMPS.map((f) => {
    const m = market[f.key], makers = makersOf(f.key);
    const dots = makers.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
    const dir = m.price > m.last * 1.001 ? "up" : m.price < m.last * 0.999 ? "down" : "";
    const p = patents[f.key];
    const pat = patLive(f.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm)
            : p.owner >= 0 ? "патент истёк" : "";
    let seg = "", chasers: string[] = [];
    corps.forEach((c) => {
      if (canBuild(c, f.key) || c.spent[f.key] < 1) return;
      seg += '<i style="width:' + Math.min(100, c.spent[f.key] / f.diff * 100) + '%;background:' + c.color + '99"></i>';
      if (c.target === f.key) chasers.push(c.name);
    });
    const meta = makers.length
      ? (pat ? pat + " · " : "") + "склад " + m.stock + " · заказано " + m.want + " · просят " +
        (() => {
          const a = makers.map((c) => { return c.ask[f.key]; });
          const lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
          return "×" + lo.toFixed(2) + (hi - lo > 0.02 ? "–" + hi.toFixed(2) : "");
        })()
      : "никто не делает · лучший на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[f.key]; }))) +
        " из " + f.diff + (chasers.length ? " · ищут: " + chasers.join(", ") : "");
    return '<div class="row"><div class="rhead"><span class="rname">' + f.name + '</span>' + dots +
           '<span class="price ' + dir + '">' + m.price.toFixed(1) + '</span></div>' +
           (makers.length ? "" : '<div class="bar">' + seg + '<u style="left:55%"></u></div>') +
           '<div class="rmeta">' + meta + '</div></div>';
  }).join("");

  const range = galaxyRange();
  el("portal").innerHTML =
    '<div class="row"><div class="rhead"><span class="rname">' + moveName() + '</span>' +
    '<span class="price">дальность ' + Math.round(range) + '</span></div>' +
    '<div class="rmeta">' + (S.moveKnown ? S.move.hint : "Пока никто не довёл первую марку, неизвестно даже, что именно откроется.") + '</div></div>' +
    MARKS.map((m) => {
      const p = patents[m.key], holders = makersOf(m.key);
      const dots = holders.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
      // сколько закрытых звёзд эта марка достаёт из уже открытых систем
      let opens = 0;
      systems.forEach((s) => {
        if (!s.unlocked) return;
        opens += within(s.id, m.range).filter((n) => { return !systems[n].unlocked; }).length;
      });
      const meta = holders.length
        ? (patLive(m.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm) + " · " : "") +
          "дальность " + m.range + " · достаёт звёзд " + opens +
          (m.speed > 1 ? " · межзвёздные рейсы ×" + m.speed.toFixed(2) : "")
        : "лучший продвинулся на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[m.key]; }))) +
          " из " + m.diff + " · дальность " + m.range;
      return '<div class="row"><div class="rhead"><span class="rname">' + (S.moveKnown ? m.short : markName(m)) +
             (m.range <= range ? "" : " · недоступна") + '</span>' + dots + '</div>' +
             '<div class="rmeta">' + meta + '</div></div>';
    }).join("");

  el("engines").innerHTML = ENGINES.map((e) => {
    const p = patents[e.key], holders = makersOf(e.key);
    const dots = holders.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
    // Ходовой ускоряет ход ВНУТРИ системы и только его: между звёздами считает
    // марка перехода. Mk1 — не ускорение, а сама возможность лететь, и писать
    // про него "в 1.0 раза быстрее" было бы издевательством.
    const gain = e.mult > 1 ? "внутри системы ×" + e.mult.toFixed(1) : "базовый ход, без него корабль не летает";
    const meta = holders.length
      ? (patLive(e.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm) + " · " : "") + gain
      : "лучший на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[e.key]; }))) +
        " из " + e.diff + " · " + gain;
    return '<div class="row"><div class="rhead"><span class="rname">' + e.short + '</span>' + dots + '</div>' +
           '<div class="rmeta">' + meta + '</div></div>';
  }).join("");

  el("devs").innerHTML = DEVS.slice().sort((a, b) => { return a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : a.mark - b.mark; })
    .map((d) => {
      const p = patents[d.key], holders = makersOf(d.key);
      const dots = holders.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
      const meta = holders.length
        ? (patLive(d.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm) + " · " : "") +
          "+" + (12 * d.mark) + "% урожая, +" + d.mark + " к пределу на мирах с филиалом"
        : "лучший на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[d.key] || 0; }))) + " из " + d.diff;
      return '<div class="row"><div class="rhead"><span class="rname">' + d.short + '</span>' + dots + '</div>' +
             '<div class="rmeta">' + meta + '</div></div>';
    }).join("") || '<div class="empty">Ещё ничего не освоено.</div>';

  el("coltech").innerHTML = COLTECH.map((f) => {
    const p = patents[f.key], makers = makersOf(f.key);
    const dots = makers.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
    let free = 0;
    systems.forEach((s) => {
      if (!s.unlocked) return;
      s.bodies.forEach((b) => { if (!b.world && b.type.tech === f.key) free++; });
    });
    const meta = makers.length
      ? (patLive(f.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm) + " · " : "") +
        "свободных миров " + free
      : "лучший на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[f.key]; }))) +
        " из " + f.diff + " · миров рядом " + free;
    return '<div class="row"><div class="rhead"><span class="rname">' + f.name + '</span>' + dots + '</div>' +
           '<div class="rmeta">' + meta + '</div></div>';
  }).join("");

  el("worlds").innerHTML = worlds.map((w, i) => {
    const total = popOf(w), fill = Math.round(total / w.cap * 100);
    const dots = w.branches.map((b) => { return '<i class="pip" style="background:' + corps[b.corp].color + '"></i>'; }).join("");
    const food = w.food.short > 2 ? '<span style="color:var(--bad)">голод</span>'
             : (harvestOf(w) >= total ? "кормится сама" : "живёт на привозном");
    return '<div class="row clickrow" data-world="' + i + '"><div class="srow">' +
           '<span class="rname">' + (w === S.home ? '★ ' : '') + w.body.name + '</span>' + dots +
           '<span class="rmeta">' + systems[w.sys].name + ' · ' + w.type.name + '</span></div>' +
           '<div class="rmeta">' + fmt(total) + '/' + w.cap + ' (' + fill + '%) · ' + food +
           ' · уехать хотят ' + w.wantOut.toFixed(1) + '</div></div>';
  }).join("") || '<div class="empty">Освоена только Тира.</div>';

  const vbox = el("ventures");
  if (U.view.mode === "map") {
    vbox.innerHTML = systems.map((s) => {
      if (!seenSys(s)) return "";
      if (!s.unlocked) {
        const inb = voyages.filter((v) => { return v.kind === "jump" && v.to === s.id; })[0];
        return '<div class="row"><div class="srow"><span class="rname">неизведанная система</span>' +
               '<span class="rmeta">' + (inb ? "летит " + corps[inb.corp].name : "нет корабля") + '</span></div></div>';
      }
      const ws = s.bodies.filter((b) => { return b.world; });
      return '<div class="row clickrow" data-sys="' + s.id + '"><div class="srow">' +
             '<span class="rname">' + s.name + (s.id === 0 ? " · дом" : "") + '</span>' +
             '<span class="rmeta">платформ ' + s.mines + ' · миров ' + ws.length + '</span></div>' +
             '<div class="rmeta">' + s.bodies.map((b) => {
               return b.name + " (" + b.type.name + (b.world ? ", " + fmt(popOf(b.world)) : "") + ")"; }).join(", ") +
             '</div></div>';
    }).join("");
  } else {
    const s = systems[U.view.sys], rows: string[] = [];
    // Очередь верфи в списке дел системы: с номером, состоянием и сроком, тем
    // же, что в окошке у самой верфи. Прежняя строка давала одну готовность и
    // молчала о порядке — по ней нельзя было понять, кто ждёт кого.
    shipyards.filter((y) => y.world.sys === s.id).forEach((y) => {
      const eta = queueEta(y), first = y.queue.findIndex((b) => b.left > 0);
      y.queue.forEach((yd, i) => {
        rows.push('<div class="row"><div class="rhead"><i class="dot" style="background:' + yd.color + '"></i>' +
          '<span class="rname">' + (i + 1) + '. ' + corps[yd.lead].name + ' · ' + yd.vt.name + '</span>' +
          '<span class="rmeta">' + Math.round(buildDone(yd) * 100) + '%</span></div>' +
          '<div class="rmeta">верфь у ' + y.world.body.name + ' · ' + buildState(yd, i === first) +
          (eta[i] === null ? '' : ' · через ' + eta[i] + ' мес.') + '</div></div>');
      });
    });
    s.ventures.forEach((v) => {
      if (v.building) return;
      rows.push('<div class="row"><div class="rhead"><i class="dot" style="background:' + corps[v.lead].color + '"></i>' +
        '<span class="rname">' + corps[v.lead].name + ' · платформа</span>' +
        '<span class="rmeta">' + v.yield + '/мес</span></div>' +
        '<div class="rmeta">' + v.dest.label + ' · осталось ' + Math.round(v.left / 12) + ' лет</div></div>');
    });
    projects.forEach((pr) => {
      if (pr.sys !== s.id) return;
      rows.push('<div class="row"><div class="rhead"><i class="dot" style="background:' + corps[pr.lead].color + '"></i>' +
        '<span class="rname">консорциум · ' + pr.body.name + '</span>' +
        '<span class="rmeta">' + Math.round(pr.purse) + '/' + pr.cost + '</span></div>' +
        '<div class="rmeta">вкладчики: ' + pr.backers.map((b) => { return corps[b.corp].name; }).join(", ") + '</div></div>');
    });
    vbox.innerHTML = rows.length ? rows.join("") : '<div class="empty">Здесь пока ничего не происходит.</div>';
  }

  const totPop = worlds.reduce((a, w) => { return a + popOf(w); }, 0);
  el("treasury").textContent = Math.round(S.treasury).toLocaleString("ru-RU");
  // Казна на экране одна — родная. Как только государств стало больше одного,
  // одно число начинает вести себя по-новому (налог с ушедших в него не идёт),
  // и без соседних строк это читается как поломка, а не как отделение.
  const foreign = manyRealms()
    ? corps.filter(isRealm).map((c) => c.name + " " + Math.round(treasuryOf(c.id))).join(", ")
    : "";
  el("date").textContent = dateStr();
  el("stats").textContent = "Миров " + worlds.length + " · людей " + fmt(totPop) + " · сделок " + S.trades +
    " · еды перевезено " + Math.round(S.shipped) + " · деталей грузовиком " + S.hauled +
    " · топлива сожжено " + S.burned + " · отказов " + S.refusals + ", свёрнуто сборок " + S.dropped +
    (S.lost ? " · миров опустело " + S.lost : "") +
    (foreign ? " · казна отделившихся: " + foreign : "") +
    " · сид " + seedOf();

  el("corps").innerHTML = corps.slice().sort((a, b) => { return b.cash - a.cash; }).map((c) => {
    const can = COMPS.filter((f) => { return canBuild(c, f.key); }).map((f) => { return f.short; });
    const col = COLTECH.filter((f) => { return canBuild(c, f.key); }).map((f) => { return f.short; });
    const task = c.order
      ? "собирает " + vtype(c.order.type).name + ": " +
        Object.keys(c.order.need).map((k) => { return compOf(k).short + " " + (c.order.got[k] || 0) + "/" + c.order.need[k]; }).join(", ")
      : (c.target ? "исследует " + techOf(c.target).short : "ничего не начинает");
    return '<div class="row"><div class="rhead"><i class="dot" style="background:' + c.color + '"></i>' +
      '<span class="rname">' + c.name + '</span><span class="price">' + Math.round(c.cash) + '</span></div>' +
      '<div class="rmeta">' + c.craft + (isRealm(c) ? ' · государство' : '') + ' · филиалов ' + c.branches.length +
      ' · цех ' + prodOf(c).toFixed(1) + ', лаб ' + sciOf(c).toFixed(1) + '</div>' +
      '<div class="rmeta">' + task + '</div>' +
      (can.length ? '<div class="rmeta" style="color:var(--gold)">делает: ' + can.join(", ") + '</div>' : '') +
      (col.length ? '<div class="rmeta" style="color:var(--ok)">колонизует: ' + col.join(", ") + '</div>' : '') +
      (() => {
        const by: Record<string, string[]> = {};
        Object.keys(c.embargo).forEach((k) => {
          if (c.embargo[k] <= S.tick) return;
          const bits = k.split("|");
          (by[bits[0]] = by[bits[0]] || []).push(compOf(bits[1]).short);
        });
        const list = Object.keys(by).map((id) => { return corps[+id].name + " (" + by[id].join(", ") + ")"; });
        return list.length ? '<div class="rmeta" style="color:var(--bad)">не продаёт: ' + list.join("; ") + '</div>' : '';
      })() + '</div>';
  }).join("");

  // Предложения: первое место, где игрок решает. Блок прячется, когда пусто,
  // чтобы не висел заголовок над пустотой.
  el("propblock").hidden = proposals.length === 0;
  el("proposals").innerHTML = proposals.map((p) => {
    const lead = corps[p.lead], ask = Math.round(p.cost * (1 - p.share));
    const status = p.state === "pending" ? "ждёт вашего решения"
                 : p.state === "approved" ? "одобрено, собирают" : "строится, " + p.left + " мес";
    const head = '<div class="srow"><span class="rname">Верфь у ' + p.world.body.name + '</span>' +
                 '<span class="rval">' + status + '</span></div>';
    const meta = '<div class="rmeta">предлагает ' + lead.name + ' · компании дают ' + Math.round(p.share * 100) +
                 '% (внесли ' + Math.round(p.purse) + ' из ' + Math.round(p.cost * p.share) + ') · от казны ' + ask +
                 (p.stateSum ? ', доложено ' + Math.round(p.stateSum) : '') +
                 (p.attempt > 1 ? ' · попытка ' + p.attempt : '') + '</div>';
    const parts = '<div class="rmeta">детали: ' + Object.keys(p.need).map((k) =>
                  compOf(k).short + ' ' + (p.got[k] || 0) + '/' + p.need[k]).join(', ') + '</div>';
    const why = p.state !== "pending" ? '' :
      '<div class="rmeta" style="color:var(--dim);margin-top:4px">Без верфи компаниям негде строить: ' +
      'ни кораблей, ни платформ, ни колоний. Откажете — вернутся позже, попросив у казны меньше.</div>';
    const btns = p.state !== "pending" ? '' :
      '<div style="margin-top:6px"><button class="decide" data-prop="' + p.id + '" data-ok="1">Одобрить</button> ' +
      '<button class="decide" data-prop="' + p.id + '" data-ok="0">Отказать</button></div>';
    return '<div class="row">' + head + meta + parts + why + btns + '</div>';
  }).join("");

  el("feed").innerHTML = feed.slice(0, 10).map((f) => {
    return '<p><span class="y">' + f.d + '</span> ' + f.t + '</p>';
  }).join("");

  inspector();
}

