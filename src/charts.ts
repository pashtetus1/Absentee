// ===================== карты систем =====================
//
// ЗНАНИЕ О ЗВЕЗДЕ ЧАСТНОЕ. Спутник с телескопом открывает соседние системы не
// всем, а СВОЕЙ конторе: она видит, что там лежит, летает туда, ставит
// платформы и основывает колонии — а остальные не знают даже, что звезда есть.
// Государство не знает тоже: для игрока такой звезды на карте нет вовсе.
//
// Государство видит систему, когда её знают ТРИ конторы, как бы они это знание
// ни получили — своим спутником или купленной картой. До тех пор системы для
// него не существует: ни на карте, ни в сводках, ни в налоговой ведомости.
// Отсюда и весь смысл: контора, нашедшая звезду, разрабатывает её БЕЗ
// государства, и налога с неё государство не берёт, потому что не видит.
//
// Поэтому карту продают неохотно. Продать её — не «упустить сделку», как с
// деталью, а позвать соседа в свою систему и привести туда государство с его
// налогом. Третья продажа особенно дорого стоит продавцу: она и делает систему
// видимой. Игрок на это влияет косвенно — налогом и сбором: чем меньше он
// берёт, тем меньше причин прятать.

import { MARKRANGE, ownSight } from "./data";
import { rnd } from "./rng";
import { S, canBuild, corps, say, systems } from "./state";
import { dist } from "./util";
import type { Corp, Sys } from "./types";

/** Сколько контор должны знать систему, чтобы её увидело государство. */
export const STATE_EYES = 3;

export function knowsSys(c: Corp, id: number): boolean { return !!(c && c.maps && c.maps[id]); }
/** Сколько контор знает эту систему. */
export function knownCount(id: number): number {
  let n = 0;
  corps.forEach((c) => { if (knowsSys(c, id)) n++; });
  return n;
}
/** Видит ли систему государство — то есть игрок. Родная система видна всегда:
 *  там все и живут. */
export function seenByState(id: number): boolean { return id === 0 || knownCount(id) >= STATE_EYES; }
/** Видит ли государство этот мир: по системе, в которой он лежит. */
export function seenWorld(w: { sys: number }): boolean { return seenByState(w.sys); }

/** Сказать о том, что случилось В СИСТЕМЕ. Лента — глаза государства, а
 *  систему оно видит, только когда её знают три конторы. Пока их меньше,
 *  происходящее там для игрока не существует: иначе лента выдавала бы звёзды,
 *  которых на его карте нет.
 *
 *  Живёт здесь, а не в state.ts, ровно потому, что порог считается здесь, и
 *  state.ts про карты знать не должен — он под всеми, а карты над ним. */
export function sayAt(sys: number, t: string): void { if (seenByState(sys)) say(t); }

/** Контора узнала систему: своим спутником или купленной картой.
 *
 *  Здесь же случается единственное, что видит игрок во всей этой механике, —
 *  переход через порог: третья контора узнала систему, и звезда появляется на
 *  карте государства. */
export function learnSys(c: Corp, id: number, how: string): void {
  if (!c || knowsSys(c, id)) return;
  const was = seenByState(id);
  c.maps[id] = true;
  const s = systems[id];
  s.unlocked = true;                       // кто-то её знает: в игре она есть
  if (!was && seenByState(id)) {
    s.pulse = 1;
    say("Систему " + s.name + " знают уже три конторы — с этого дня её видит и государство: " +
        s.bodies.map((b) => { return b.type.name; }).join(", ") + ". " + how);
  }
}

// ---- что видит спутник -------------------------------------------------
// Спутник НЕ открывает всё в своём круге разом. Он находит звёзды ПО ОДНОЙ и
// годами: четыре года на каждую (SCAN_MONTHS). Небо большое, телескоп один, и
// разглядеть в нём звезду — работа, а не щелчок.
//
// Отсюда и конкуренция, ради которой это и сделано. Два спутника разных контор
// в одной системе смотрят на одну и ту же ближайшую незнакомую звезду, и
// достаётся она тому, чей телескоп встал раньше. Опоздавший потратит те же
// четыре года и придёт вторым — знание у него будет, а первенства нет: карту
// на этой звезде продаёт уже не он.
//
// Ищется всегда БЛИЖАЙШАЯ незнакомая: карта раскрывается кольцами от обжитого,
// а не пятнами. Если ближнюю успели купить, спутник просто переводит взгляд на
// следующую, не теряя наблюдения, — месяцы считаются самому спутнику, а не
// звезде.
export const SCAN_MONTHS = 48;

export function scanSats(): void {
  systems.forEach((s) => {
    s.sats.forEach((sat) => {
      if (!sat.live) return;
      const c = corps[sat.owner];
      if (!c) return;
      let aim = -1, bd = 1e9;
      for (let j = 0; j < systems.length; j++) {
        if (j === s.id || knowsSys(c, j)) continue;
        const d = dist(s, systems[j]);
        if (d <= sat.range && d < bd) { bd = d; aim = j; }
      }
      if (aim < 0) return;                       // всё, что достаёт телескоп, уже знаем
      if (++sat.scan < SCAN_MONTHS) return;
      sat.scan = 0; sat.found++;
      const first = knownCount(aim) === 0;
      learnSys(c, aim, "Нашла её " + c.name + " телескопом с орбиты " + s.name + ".");
      sayAt(s.id, "<b>" + c.name + "</b>: телескоп с орбиты " + s.name + " разглядел " +
            (seenByState(aim) ? "систему " + systems[aim].name : "ещё одну звезду") +
            (first ? "." : " — её уже знают другие."));
    });
  });
}

/** Сколько стоит карта этой системы. Цена — за то, что в системе ЛЕЖИТ:
 *  свободные планеты и камни, — и растёт с удалённостью: чем дальше звезда,
 *  тем дороже обошлось её найти. */
export function mapPrice(s: Sys): number {
  let worth = 0;
  s.bodies.forEach((b) => { worth += b.world ? 1 : b.type.cap * 0.6 + b.type.farm; });
  worth += s.rocks.filter((r) => { return !r.taken; }).length * 1.4;
  return Math.round((46 + worth * 5) * (1 + s.depth * 0.22));
}

/** Стоит ли конторе карта этой системы: свободные миры, которые она УМЕЕТ
 *  колонизировать, и свободные камни. Ноль — покупать незачем: пустую звезду
 *  никто не берёт даже задёшево. */
export function valueTo(c: Corp, s: Sys): number {
  let cols = 0;
  s.bodies.forEach((b) => { if (!b.world && canBuild(c, b.type.tech)) cols++; });
  return cols * 3 + s.rocks.filter((r) => { return !r.taken; }).length * 0.6;
}

/** Продаст ли контора карту. Отказ здесь НАМНОГО чаще, чем в детали: там
 *  теряешь сделку, тут — систему. Особенно упирается тот, чья продажа станет
 *  третьей: она приводит государство. */
export function willSellMap(seller: Corp, buyer: Corp, s: Sys): boolean {
  let refuse = 0.6;
  if (knownCount(s.id) === STATE_EYES - 1) refuse += 0.34;         // эта продажа приведёт государство
  if (s.bodies.some((b) => { return b.world && b.world.branches.some((br) => { return br.corp === seller.id; }); }))
    refuse += 0.22;                                                // я тут уже сижу
  if (s.ventures.some((v) => { return v.lead === seller.id; })) refuse += 0.12;
  refuse *= seller.nerve;                                          // смелый душит охотнее
  if (seller.cash < 220) refuse *= 0.4;                            // бедному не до принципов
  return rnd() >= Math.min(0.95, refuse);
}

/** Годовой торг картами. Покупают то, что лежит ПОД БОКОМ: систему, до которой
 *  от уже известной не дальше телескопа, — иначе контора скупала бы карты
 *  другого конца галактики, куда ей всё равно не долететь. */
export function mapTrade(): void {
  corps.forEach((buyer) => {
    if (buyer.cash < 260) return;
    // где контора уже бывала: от этих звёзд и меряется «под боком»
    const mine = systems.filter((s) => { return knowsSys(buyer, s.id); });
    if (!mine.length) return;
    // «Под боком» — на дальность СВОЕГО телескопа: покупают то, что могли бы и
    // сами разглядеть, только годами. Телескопа нет вовсе — считаем по первой
    // ступени: без неё контора и мечтать о дальнем не может.
    const near = Math.max(ownSight(buyer), MARKRANGE[0]);
    let want: Sys = null, top = 0;
    systems.forEach((s) => {
      if (!s.unlocked || knowsSys(buyer, s.id)) return;
      if (!mine.some((o) => { return dist(o, s) <= near; })) return;
      const worth = valueTo(buyer, s);
      if (worth <= 0) return;
      const score = worth / mapPrice(s);
      if (score > top) { top = score; want = s; }
    });
    if (!want) return;
    const price = Math.round(mapPrice(want) * (1 + (buyer.nerve - 0.9) * 0.1));
    if (buyer.cash < price) return;
    // Продавцов может быть несколько; спрашиваем по очереди, пока кто-нибудь
    // не согласится. Первым — того, кто беднее: ему нужнее.
    const sellers = corps.filter((o) => { return o !== buyer && knowsSys(o, want.id); })
                         .sort((a, b) => { return a.cash - b.cash; });
    for (let i = 0; i < sellers.length; i++) {
      const seller = sellers[i];
      if (!willSellMap(seller, buyer, want)) { S.mapNo++; continue; }
      buyer.cash -= price; seller.cash += price; S.maps++;
      // Сделку видно ТОЛЬКО если государство и так видит систему: торг картой
      // невидимой звезды — частное дело двух контор. Зато порог, если он
      // перейдён этой покупкой, объявит сам learnSys.
      learnSys(buyer, want.id, "Карту продала " + seller.name + ".");
      if (seenByState(want.id))
        say("<b>" + seller.name + "</b> продала карту системы " + want.name + " конторе " +
            buyer.name + " за " + price + ".");
      return;
    }
  });
}
