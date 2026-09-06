// ===================== панели =====================


// Панели написаны на innerHTML, и один и тот же el() достаёт то ползунок
// (value), то блок текста (textContent). Уточнять тип приведением на каждой
// строке — шум ради шума, поэтому здесь один расширенный тип на весь модуль.
// value нарочно any: в разметку кладут и числа, браузер сам приводит их к
// строке, и String() вокруг каждого присваивания ничего бы не поймал.

import { COLTECH, COMPS, MARKS, colOf, compOf, markName, moveName, vtype } from "../data";
import { dockValue } from "../docks";
import { galaxyRange, within } from "../galaxy";
import { prodOf, sciOf } from "../science";
import { L, S, U, UPKEEP, canBuild, corps, dateStr, feed, makersOf, market, patLive, patents, projects, systems, voyages, worlds } from "../state";
import { DEVS, ENGINES, techOf } from "../tech";
import { fmt } from "../util";
import { popOf } from "../world";
import { seenSys } from "./scene";
import type { Part, World } from "../types";

import { seedOf } from "../rng";

export type Ctl = HTMLElement & { value: any; textContent: any; disabled: boolean; checked: boolean };
export function el(id: string): Ctl { return document.getElementById(id) as Ctl; }

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

export function worldCard(w: World): string {
  const p = w.pop, total = popOf(w);
  return '<div class="card"><h3>' + w.body.name + ' · ' + w.type.name + '</h3>' +
    '<div class="sub">' + fmt(total) + ' из ' + w.cap + ' человечков · ' +
    (w.founder >= 0 ? "основана " + corps[w.founder].name + ", " + w.born : "родина") + '</div>' +
    '<div class="part"><span class="pn">в поле</span><span class="pw">' + fmt(p.farm) + ' · ' + w.wage.farm.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">в цехах</span><span class="pw">' + fmt(p.prod) + ' · ' + w.wage.prod.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">в лабораториях</span><span class="pw">' + fmt(p.sci) + ' · ' + w.wage.sci.toFixed(2) + '</span></div>' +
    '<div class="part"><span class="pn">без работы</span><span class="pw">' + fmt(p.free) + '</span></div>' +
    '<div class="sub" style="margin:7px 0 3px">Еда: своя ' + (p.farm * w.type.farm).toFixed(1) +
    ', надо ' + total.toFixed(1) + ', склад ' + w.food.stock.toFixed(1) +
    (w.food.short > 2 ? ' · <span style="color:var(--bad)">голод</span>' : '') + '</div>' +
    (w.rough > 0 ? '<div class="sub" style="margin:0 0 3px;color:var(--bad)">Разруха: ещё ' + Math.ceil(w.rough / 12) + ' лет</div>' : '') +
    (w.blight > 0 ? '<div class="sub" style="margin:0 0 3px;color:var(--bad)">Неурожай: ещё ' + w.blight + ' мес.</div>' : '') +
    '<div class="sub" style="margin:0 0 3px">Казна мира ' + Math.round(w.gov.cash) +
    ' · содержание ' + (popOf(w) * UPKEEP).toFixed(1) + '/мес' +
    ' · уехать хотят ' + w.wantOut.toFixed(1) + ' · ' + w.flow + '</div>' +
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
      '<div class="sub" style="margin:7px 0 2px">Из чего собран:</div>' + partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "cargo" && d.kind === "parts") {
    const fc = compOf(d.k), buyer = corps[d.forCorp], sellerC = corps[d.corp];
    box.innerHTML = '<div class="card"><h3>Грузовик с деталями</h3>' +
      '<div class="sub">везёт ' + fc.name.toLowerCase() + ' из ' + systems[d.sysFrom].name + ' в ' +
      systems[d.to].name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      '<div class="part"><i class="dot" style="background:' + sellerC.color + '"></i><span class="pn">продал</span><span class="pw">' + sellerC.name + '</span></div>' +
      '<div class="part"><i class="dot" style="background:' + buyer.color + '"></i><span class="pn">купил и везёт</span><span class="pw">' + buyer.name + '</span></div>' +
      '<div class="sub" style="margin:6px 0 0">Рейс сжёг единицу межзвёздного топлива.</div></div>';
    return;
  }
  if (U.pick.kind === "cargo") {
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "food" ? "Грузовик" : "Переселенческий") + '</h3>' +
      '<div class="sub">везёт ' + (d.kind === "food" ? d.qty + " еды" : d.qty.toFixed(1) + " человечков") +
      ' с ' + d.from.body.name + ' на ' + d.to.body.name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      '<div class="sub" style="margin:0 0 4px">Куплен правительством ' + d.to.body.name + ', собран из:</div>' +
      partsList(d.parts, -1) + '</div>';
    return;
  }
  if (U.pick.kind === "jumpship") {
    box.innerHTML = '<div class="card"><h3>Прыжковый корабль</h3>' +
      '<div class="sub">' + corps[d.corp].name + ' · в пути ' + Math.round(d.t * 100) + '%</div>' +
      partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "ship") {
    box.innerHTML = '<div class="card"><h3>' + (d.kind === "colony" ? "Колониальный модуль" : "Добывающая платформа") + '</h3>' +
      '<div class="sub">' + corps[d.corp].name + ' · курс на ' +
      (d.kind === "colony" ? d.body.name : d.dest.label) + ' · ' + Math.round(d.t * 100) + '%</div>' +
      partsList(d.parts, d.corp) + '</div>';
    return;
  }
  if (U.pick.kind === "vent") {
    box.innerHTML = '<div class="card"><h3>Добывающая платформа</h3>' +
      '<div class="sub">' + corps[d.lead].name + ' · ' + d.yield + '/мес · ' + d.dest.label +
      ' · осталось ' + Math.round(d.left / 12) + ' лет</div>' + partsList(d.parts, d.lead) + '</div>';
    return;
  }
  if (U.pick.kind === "yard") {
    box.innerHTML = '<div class="card"><h3>' + d.vt.name + ' на стапеле</h3>' +
      '<div class="sub">' + corps[d.lead].name + ' · готовность ' + Math.round((1 - d.left / d.total) * 100) +
      '% · до спуска ' + d.left + ' мес.</div>' + partsList(d.parts, d.lead) + '</div>';
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
          "дальность " + m.range + " · достаёт звёзд " + opens
        : "лучший продвинулся на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[m.key]; }))) +
          " из " + m.diff + " · дальность " + m.range;
      return '<div class="row"><div class="rhead"><span class="rname">' + (S.moveKnown ? m.short : markName(m)) +
             (m.range <= range ? "" : " · недоступна") + '</span>' + dots + '</div>' +
             '<div class="rmeta">' + meta + '</div></div>';
    }).join("");

  el("engines").innerHTML = ENGINES.map((e) => {
    const p = patents[e.key], holders = makersOf(e.key);
    const dots = holders.map((c) => { return '<i class="dot" style="background:' + c.color + '"></i>'; }).join("");
    const meta = holders.length
      ? (patLive(e.key) ? "патент " + corps[p.owner].name + " до " + (p.since + L.patTerm) + " · " : "") +
        "рейсы в " + e.mult.toFixed(1) + " раза быстрее"
      : "лучший на " + Math.round(Math.max.apply(null, corps.map((c) => { return c.spent[e.key]; }))) +
        " из " + e.diff + " · даст ×" + e.mult.toFixed(1);
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
             : (w.pop.farm * w.type.farm >= total ? "кормится сама" : "живёт на привозном");
    return '<div class="row clickrow" data-world="' + i + '"><div class="srow">' +
           '<span class="rname">' + w.body.name + '</span>' + dots +
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
    s.yards.forEach((yd) => {
      rows.push('<div class="row"><div class="rhead"><i class="dot" style="background:' + yd.color + '"></i>' +
        '<span class="rname">' + corps[yd.lead].name + ' · ' + yd.vt.name + '</span>' +
        '<span class="rmeta">верфь ' + Math.round((1 - yd.left / yd.total) * 100) + '%</span></div></div>');
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
  el("date").textContent = dateStr();
  el("stats").textContent = "Миров " + worlds.length + " · людей " + fmt(totPop) + " · сделок " + S.trades +
    " · еды перевезено " + Math.round(S.shipped) + " · деталей грузовиком " + S.hauled +
    " · топлива сожжено " + S.burned + " · отказов " + S.refusals + ", свёрнуто сборок " + S.dropped +
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
      '<div class="rmeta">' + c.craft + ' · филиалов ' + c.branches.length +
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

  el("feed").innerHTML = feed.slice(0, 10).map((f) => {
    return '<p><span class="y">' + f.d + '</span> ' + f.t + '</p>';
  }).join("");

  inspector();
}

