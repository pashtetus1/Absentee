// ===================== данные =====================

import { S, fill } from "./state";
import type { ColTech, Comp, Mark, Move, PType, Tech, VType } from "./types";

import { rnd } from "./rng";

export const MONTHS = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

export const COMPS: Comp[] = [
  { key:"goods", name:"Товары для колоний",  short:"товары",    diff:560,  work:2, base:14,  glyph:"cir" },
  { key:"hold",  name:"Грузовой трюм",       short:"трюм",      diff:640,  work:2, base:16,  glyph:"sqr" },
  { key:"drill", name:"Буровая установка",   short:"бур",       diff:880,  work:3, base:24,  glyph:"dia" },
  { key:"hull",  name:"Корпус",              short:"корпус",    diff:1750, work:5, base:40,  glyph:"tri" },
  { key:"life",  name:"Жизнеобеспечение",    short:"жизнь",     diff:2200, work:6, base:58,  glyph:"cir" },
  { key:"drive", name:"Прыжковый двигатель", short:"двигатель", diff:4600, work:9, base:110, glyph:"tri" },
  // Портальный набор — сами ворота, сложенные в трюм: корабль довозит их до
  // соседней звезды и там оставляет. Это самая дорогая вещь в игре, и так и
  // задумано. Под воротами межзвёздный двигатель не нужен ВООБЩЕ — ни одному
  // кораблю, включая портальный: он идёт на ходовом, как все. Поэтому цена
  // способа собрана здесь целиком, в одной детали: платишь один раз за
  // маршрут, зато потом по нему летает кто угодно и даром.
  { key:"gkit",  name:"Портальный набор",     short:"набор",     diff:6400, work:14, base:260, glyph:"dia" },
  // Топливо — первый РАСХОДНИК в этой экономике: всё остальное покупается раз
  // и стоит вечно, а его жгут каждым рейсом. Отсюда постоянный спрос, а не
  // разовые всплески. Местное и межзвёздное — разные вещества: на местном
  // внутри системы не уйдёшь за звезду, и наоборот.
  { key:"fuel",  name:"Местное топливо",     short:"топливо",   diff:380,  work:1, base:9,   glyph:"cir" },
  { key:"sfuel", name:"Межзвёздное топливо", short:"м-топливо", diff:1400, work:4, base:48,  glyph:"cir" },
  // Ходовой двигатель: то, чем корабль летит ВНУТРИ системы. Четыре модели,
  // и это обычные детали — их исследуют, делают, продают и возят, как корпус.
  // Раньше ходовые двигатели были бестелесной технологией: множитель скорости
  // висел на компании и брался из воздуха, а на корабле его не было видно.
  // Теперь корабль несёт КОНКРЕТНУЮ модель и идёт со скоростью того двигателя,
  // который на нём стоит, а не по лучшей технологии хозяина.
  //
  // Mk1 — это и есть прежняя базовая скорость (mult 1.0): без двигателя не
  // летает вообще ничего, поэтому первая модель обязана быть дешёвой и ранней,
  // рядом с топливом. Дальше лестница повторяет прежние ходовые: 1.4, 1.9, 2.5.
  // Каждая следующая модель вдвое с лишком дороже предыдущей (×2.2): марки —
  // лестница, и перескочить ступень нельзя (см. markStep в tech.ts)
  { key:"eng1",  name:"Ходовой двигатель Mk1", short:"ход Mk1", diff:420,  work:3, base:22, glyph:"tri", mult:1.0 },
  { key:"eng2",  name:"Ходовой двигатель Mk2", short:"ход Mk2", diff:1300, work:4, base:34, glyph:"tri", mult:1.4 },
  { key:"eng3",  name:"Ходовой двигатель Mk3", short:"ход Mk3", diff:2900, work:6, base:52, glyph:"tri", mult:1.9 },
  { key:"eng4",  name:"Ходовой двигатель Mk4", short:"ход Mk4", diff:6400, work:8, base:78, glyph:"tri", mult:2.5 }
];
/** Модели ходового двигателя, от слабой к сильной. */
export const ENGKEYS = ["eng1", "eng2", "eng3", "eng4"];
export function isEngine(k: string): boolean{ return ENGKEYS.indexOf(k) >= 0; }
/** Множитель скорости той модели, что стоит на корабле. Двигателя нет —
 *  единица: корабль всё равно должен куда-то долететь, а не встать намертво. */
export function engMult(parts: { k: string }[]): number {
  let best = 1;
  (parts || []).forEach((p) => { const c = compOf(p.k); if (c && c.mult) best = Math.max(best, c.mult); });
  return best;
}
export function compOf(k: string): Comp{ for (let i=0;i<COMPS.length;i++) if (COMPS[i].key===k) return COMPS[i]; }

// Классы миров и технологии на них. Умеренные дешевле всех, газовый гигант
// дороже двигателя: жить в облаках сложнее, чем летать между звёздами.
export const COLTECH: ColTech[] = [
  { key:"temperate", name:"Умеренные миры",  short:"умеренные", diff:1500 },
  { key:"cold",      name:"Холодные миры",   short:"холодные",  diff:2300 },
  { key:"dry",       name:"Сухие миры",      short:"сухие",     diff:2500 },
  { key:"hot",       name:"Мёртвые миры",    short:"мёртвые",   diff:3400 },
  { key:"gas",       name:"Газовые гиганты", short:"гиганты",   diff:4600 }
];
export function colOf(k: string): ColTech{ for (let i=0;i<COLTECH.length;i++) if (COLTECH[i].key===k) return COLTECH[i]; }

// cap — предел населения, farm — урожай с фермера. Гигант не кормит вообще:
// всё, что там живёт, живёт на привозном.
export const PTYPES: PType[] = [
  { key:"terran", name:"терран",         cap:11, farm:2.4,  tech:"temperate", col:"#5b8f6a", w:10 },
  { key:"ocean",  name:"океан",          cap:9,  farm:2.2,  tech:"temperate", col:"#3f6f96", w:9 },
  { key:"jungle", name:"джунгли",        cap:10, farm:2.6,  tech:"temperate", col:"#4f7a3f", w:8 },
  { key:"tundra", name:"тундра",         cap:7,  farm:1.3,  tech:"cold",      col:"#6f7f8f", w:11 },
  { key:"arctic", name:"ледяная",        cap:5,  farm:0.6,  tech:"cold",      col:"#8fa6bd", w:12 },
  { key:"arid",   name:"сухая",          cap:7,  farm:1.1,  tech:"dry",       col:"#a08050", w:11 },
  { key:"desert", name:"пустыня",        cap:6,  farm:0.7,  tech:"dry",       col:"#c09a5a", w:12 },
  { key:"lava",   name:"вулканическая",  cap:4,  farm:0.15, tech:"hot",       col:"#8a4a3a", w:11 },
  { key:"barren", name:"голая",          cap:4,  farm:0.1,  tech:"hot",       col:"#7a7266", w:13 },
  { key:"gas",    name:"газовый гигант", cap:6,  farm:0,    tech:"gas",       col:"#9a7fb0", w:10 },
  // вторая волна типов: те же пять классов, но разные лица у планет
  { key:"savanna",name:"саванна",        cap:9,  farm:2.0,  tech:"temperate", col:"#8a9a4a", w:8 },
  { key:"mangrove",name:"мангровая",     cap:8,  farm:2.3,  tech:"temperate", col:"#3f7a6a", w:6 },
  { key:"snow",   name:"снежная",        cap:6,  farm:0.9,  tech:"cold",      col:"#b9c6d6", w:8 },
  { key:"glacier",name:"ледник",         cap:4,  farm:0.3,  tech:"cold",      col:"#9fb8cf", w:7 },
  { key:"steppe", name:"степь",          cap:8,  farm:1.5,  tech:"dry",       col:"#b39a5a", w:8 },
  { key:"salt",   name:"солончак",       cap:5,  farm:0.4,  tech:"dry",       col:"#d8cfa8", w:7 },
  { key:"ash",    name:"пепельная",      cap:4,  farm:0.2,  tech:"hot",       col:"#6b6270", w:8 },
  { key:"radio",  name:"радиоактивная",  cap:3,  farm:0.05, tech:"hot",       col:"#7fa04a", w:6 },
  { key:"icegiant",name:"ледяной гигант",cap:5,  farm:0,    tech:"gas",       col:"#6f8fb8", w:7 }
];
export function ptypeOf(k: string): PType{ for (let i=0;i<PTYPES.length;i++) if (PTYPES[i].key===k) return PTYPES[i]; }
export function rollType(): PType {
  let tot = PTYPES.reduce((a, p) => { return a + p.w; }, 0), r = rnd() * tot;
  for (let i = 0; i < PTYPES.length; i++) { r -= PTYPES[i].w; if (r <= 0) return PTYPES[i]; }
  return PTYPES[0];
}

// Рецепт: по одной детали каждого вида, и корпус ровно один. Корпус — это и
// есть сам корабль, второго у него быть не может; удвоений нет и у остальных
// деталей. Отличаются корабли теперь НАБОРОМ деталей, а не их числом: бур
// делает платформу платформой, двигатель — прыжковым, товары — колонией.
//
// Ходового двигателя в таблице НЕТ, хотя несёт его каждый корабль без
// исключения. Причина в том, что моделей четыре, и какая из них встанет —
// решается при закладке, а не записано в типе: берут лучшую, какую удалось
// достать. Рецепт собирается из таблицы плюс модель через shipNeed().
export const VTYPES: VType[] = [
  { key:"mine",   name:"разработка астероидов", need:{ drill:1, hold:1, hull:1 }, build:14, yield:3.1, term:1800, glyph:"mine" },
  { key:"colony", name:"колония",               need:{ hull:1, life:1, goods:1 }, build:22, glyph:"colony" },
  { key:"jump",   name:"межзвёздный прыжок",    need:{ drive:1, hull:1, life:1 }, build:30, glyph:"jump" },
  { key:"gate",   name:"портальный корабль",   need:{ hull:1, gkit:1, life:1 }, build:38, glyph:"jump" },
  { key:"cargo",  name:"грузовик",              need:{ hull:1, hold:1 },          build:8,  glyph:"cargo" },
  { key:"liner",  name:"переселенческий",       need:{ hull:1, life:1 },          build:10, glyph:"cargo" }
];
export function vtype(k: string): VType{ for (let i=0;i<VTYPES.length;i++) if (VTYPES[i].key===k) return VTYPES[i]; }
/** Полный набор деталей корабля: таблица + выбранная модель двигателя + то,
 *  что требует дорога (под движками межзвёздный рейс везёт ещё и прыжковый).
 *
 *  eng — ключ модели; null означает, что двигателя достать негде, и тогда
 *  корабля не будет вовсе: собирать безногий корпус незачем. */
export function shipNeed(vt: VType, eng: string | null,
                         extra?: Record<string, number>): Record<string, number> | null {
  if (!eng) return null;
  const n: Record<string, number> = { ...vt.need };
  n[eng] = (n[eng] || 0) + 1;
  if (extra) Object.keys(extra).forEach((k) => { n[k] = (n[k] || 0) + extra[k]; });
  return n;
}

// Способ межзвёздного перемещения выпадает партии ОДИН и случайно. Это не
// ветка развития, а условие задачи: два способа дают две разные логистики,
// и то, что в одном государстве открывается только один, делает партии
// непохожими сильнее, чем любая настройка ползунков.
//   drives — двигатель стоит на каждом корабле. Дёшево начать, платишь вечно:
//            каждый межзвёздный рейс, включая хлебовоз, везёт двигатель.
//   gates  — портальный корабль долетает до соседней звезды и ставит ворота
//            НА ЭТОТ МАРШРУТ. Дорого за каждый маршрут, зато потом по нему
//            летает кто угодно без двигателя — но топливо створ всё равно
//            жжёт, и по одному баку на каждые ворота в пути.
//
// Третьего способа — порталооткрывателей, прожигавших постоянный проход, —
// больше нет: ворота на маршруте делают ровно то же самое, только их видно.
export const MOVES: Move[] = [
  { key:"drives", name:"портальные движки", vt:"jump", comp:"drive",
    hint:"Двигатель на каждом корабле: экспансия по одному кораблю, перевозки между звёздами дороги навсегда." },
  { key:"gates",  name:"звёздные ворота", vt:"gate", comp:"gkit",
    hint:"Портальный корабль везёт ворота и оставляет их на маршруте: очень дорого за каждый, зато потом по нему летают даром." }
];
export function moveOf(k: string): Move{ for (let i=0;i<MOVES.length;i++) if (MOVES[i].key===k) return MOVES[i]; }

// Марки. Портал любой природы бьёт на ограниченное расстояние, и это главный
// ограничитель карты: Mk1 дотягивается только до первого кольца, дальние
// звёзды физически недоступны, пока кто-то не осилит следующую марку.
// Дальности подобраны под кольца: 46 — до первого и вдоль него, 66 — до
// второго, 90 — до третьего, 130 — до четвёртого и пятого.
export const MARKRANGE = [46, 66, 90, 130];
// Каждая следующая марка в 2.2 раза дороже предыдущей, и берутся они только
// по порядку: Mk3 не исследуют, пока не освоили Mk2. Патентов на марки нет —
// зато марка становится общим достоянием, лишь когда кто-то освоил две
// следующие (см. openSteps в science.ts).
export const MARKDIFF  = [1300, 2900, 6400, 14000];
// Марка отвечает и за СКОРОСТЬ межзвёздного рейса: старшая марка не только
// бьёт дальше, но и доводит корабль быстрее. Внутри системы марка не значит
// ничего — там считает ходовой двигатель.
export const MARKSPEED = [1, 1.25, 1.5, 1.8];
export const MARKS: Mark[] = [];
export function makeMarks(): void {
  fill(MARKS, MARKRANGE.map((r, i) => {
    return { key: S.move.key + (i + 1), short: "Mk" + (i + 1), range: r, mark: i + 1,
             name: S.move.name + " Mk" + (i + 1), diff: MARKDIFF[i], speed: MARKSPEED[i] };
  }));
}
export function markOf(k: string): Mark{ for (let i=0;i<MARKS.length;i++) if (MARKS[i].key===k) return MARKS[i]; }
// пока способ не выяснен, марки называются обезличенно
export function markName(m: Tech): string{ return S.moveKnown ? m.name : "Межзвёздный переход " + m.short; }
export function moveName(): string{ return S.moveKnown ? S.move.name : "способ пока неизвестен"; }

// apt.eng — склонность ко ВСЕЙ линейке ходовых двигателей разом, а не к
// каждой модели по ключу: моделей четыре, и расписывать eng1..eng4 пятью
// строками значило бы повторять одно число четыре раза. Разбирается это в
// aptOf() (science.ts).
export const TEMPLATE = [
  { name:"Тайко Дриллинг",   color:"#6fd39b", craft:"буры",      nerve:0.9,
    apt:{ drill:1.9, hull:0.7, hold:0.6, drive:0.4, gkit:0.4, life:0.4, goods:0.35, eng:0.5,
          temperate:0.7, cold:1.2, dry:0.8, hot:1.4, gas:0.5 } },
  { name:"Ново-Кеплер Авиа", color:"#ff8b5e", craft:"самолёты",  nerve:1.25,
    apt:{ hull:1.9, drive:0.85, gkit:0.9, hold:0.7, life:0.5, drill:0.4, goods:0.35, eng:1.6,
          temperate:0.9, cold:0.7, dry:0.8, hot:0.6, gas:1.5 } },
  { name:"Дом чая Ланьхуа",  color:"#dd7ec6", craft:"чай",       nerve:0.6,
    apt:{ goods:2.0, hold:0.9, life:0.7, hull:0.35, drill:0.3, drive:0.3, gkit:0.3, eng:0.35,
          temperate:1.7, cold:0.5, dry:0.9, hot:0.3, gas:0.4 } },
  { name:"Гелиос-Прайм",     color:"#4ec4e6", craft:"механика",  nerve:1.05,
    apt:{ drive:1.55, gkit:1.6, life:1.25, hull:0.8, hold:0.5, drill:0.5, goods:0.35, eng:1.7,
          temperate:0.8, cold:1.0, dry:0.7, hot:1.2, gas:1.1 } },
  { name:"Синдикат Веги",    color:"#f2b33d", craft:"перевозки", nerve:0.85,
    apt:{ hold:1.85, life:0.85, goods:0.8, hull:0.6, drill:0.55, drive:0.45, gkit:0.5, eng:1.2,
          temperate:1.0, cold:0.9, dry:1.5, hot:0.6, gas:0.7 } }
];

export const SYSNAMES = ["Тира","Скальд","Эреб","Полынь","Ирис","Корвус","Синдри","Лето","Танат","Ольха","Вега","Морок"];
export const BODYNAMES = ["Кадм","Валун","Мора","Сель","Хорь","Гарь","Тишь","Плёс","Овод","Стынь","Зной","Кром","Луда","Смоль","Вьюга","Наволок","Осока","Кипень","Тропа","Веха","Порог","Клин","Ржа","Соль","Тень","Уголь","Ярь","Бель","Гуж","Дым","Ель","Жар","Зов","Ил","Кол","Мох"];
export const ROCKNAMES = ["Гвоздь","Слюда","Пест","Кремень","Обух","Жернов","Скол","Дресва"];
// У каждого корабля есть командир. Без клика над кораблём видно только его
// имя, мелко: этого хватает, чтобы узнать "тот самый" корабль через годы.
export const CAPTAINS = ["Орлов","Вязов","Рахимова","Ли","Штерн","Данко","Мирра","Косой","Ясень","Тагир","Велес",
                "Ниязи","Круг","Селин","Хольм","Арно","Петля","Сойка","Грач","Тихон","Бекет","Ланге","Уза",
                "Кайя","Чибис","Строк","Драга","Инга","Марей","Стужа","Роник","Валь","Есаул","Йорк","Лада"];
export function pickCaptain(): string{ return CAPTAINS[Math.floor(rnd() * CAPTAINS.length)] + " " + (++S.capSeq); }

