// ===================== данные =====================

import { S, fill } from "./state";
import type { ColTech, Comp, Mark, Move, PType, Tech, VType } from "./types";

export var MONTHS = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

export var COMPS: Comp[] = [
  { key:"goods", name:"Товары для колоний",  short:"товары",    diff:560,  work:2, base:14,  glyph:"cir" },
  { key:"hold",  name:"Грузовой трюм",       short:"трюм",      diff:640,  work:2, base:16,  glyph:"sqr" },
  { key:"drill", name:"Буровая установка",   short:"бур",       diff:880,  work:3, base:24,  glyph:"dia" },
  { key:"hull",  name:"Корпус",              short:"корпус",    diff:1750, work:5, base:40,  glyph:"tri" },
  { key:"life",  name:"Жизнеобеспечение",    short:"жизнь",     diff:2200, work:6, base:58,  glyph:"cir" },
  { key:"drive", name:"Прыжковый двигатель", short:"двигатель", diff:4600, work:9, base:110, glyph:"tri" },
  // Топливо — первый РАСХОДНИК в этой экономике: всё остальное покупается раз
  // и стоит вечно, а его жгут каждым рейсом. Отсюда постоянный спрос, а не
  // разовые всплески. Местное и межзвёздное — разные вещества: на местном
  // внутри системы не уйдёшь за звезду, и наоборот.
  { key:"fuel",  name:"Местное топливо",     short:"топливо",   diff:380,  work:1, base:9,   glyph:"cir" },
  { key:"sfuel", name:"Межзвёздное топливо", short:"м-топливо", diff:1400, work:4, base:48,  glyph:"cir" }
];
export function compOf(k: string){ for (var i=0;i<COMPS.length;i++) if (COMPS[i].key===k) return COMPS[i]; }

// Классы миров и технологии на них. Умеренные дешевле всех, газовый гигант
// дороже двигателя: жить в облаках сложнее, чем летать между звёздами.
export var COLTECH: ColTech[] = [
  { key:"temperate", name:"Умеренные миры",  short:"умеренные", diff:1500 },
  { key:"cold",      name:"Холодные миры",   short:"холодные",  diff:2300 },
  { key:"dry",       name:"Сухие миры",      short:"сухие",     diff:2500 },
  { key:"hot",       name:"Мёртвые миры",    short:"мёртвые",   diff:3400 },
  { key:"gas",       name:"Газовые гиганты", short:"гиганты",   diff:4600 }
];
export function colOf(k: string){ for (var i=0;i<COLTECH.length;i++) if (COLTECH[i].key===k) return COLTECH[i]; }

// cap — предел населения, farm — урожай с фермера. Гигант не кормит вообще:
// всё, что там живёт, живёт на привозном.
export var PTYPES: PType[] = [
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
export function ptypeOf(k: string){ for (var i=0;i<PTYPES.length;i++) if (PTYPES[i].key===k) return PTYPES[i]; }
export function rollType() {
  var tot = PTYPES.reduce(function (a, p) { return a + p.w; }, 0), r = Math.random() * tot;
  for (var i = 0; i < PTYPES.length; i++) { r -= PTYPES[i].w; if (r <= 0) return PTYPES[i]; }
  return PTYPES[0];
}

export var VTYPES: VType[] = [
  { key:"mine",   name:"разработка астероидов", need:{ drill:2, hold:1, hull:1 }, build:14, yield:3.1, term:1800, glyph:"mine" },
  { key:"colony", name:"колония",               need:{ hull:2, life:1, goods:1 }, build:22, glyph:"colony" },
  { key:"jump",   name:"межзвёздный прыжок",    need:{ drive:2, hull:1, life:1 }, build:30, glyph:"jump" },
  { key:"opener", name:"порталооткрыватель",    need:{ drive:3, hull:1, life:1 }, build:34, glyph:"jump" },
  { key:"gate",   name:"звёздные ворота",       need:{ hull:2, drive:1, life:1 }, build:38, glyph:"jump" },
  { key:"cargo",  name:"грузовик",              need:{ hull:1, hold:1 },          build:8,  glyph:"cargo" },
  { key:"liner",  name:"переселенческий",       need:{ hull:1, life:1 },          build:10, glyph:"cargo" }
];
export function vtype(k: string){ for (var i=0;i<VTYPES.length;i++) if (VTYPES[i].key===k) return VTYPES[i]; }

// Способ межзвёздного перемещения выпадает партии ОДИН и случайно. Это не
// ветка развития, а условие задачи: три способа дают три разные логистики,
// и то, что в одном государстве открывается только один, делает партии
// непохожими сильнее, чем любая настройка ползунков.
//   drives — двигатель стоит на каждом корабле. Дёшево начать, платишь вечно:
//            каждый межзвёздный рейс, включая хлебовоз, везёт двигатель.
//   opener — порталооткрыватель прожигает ПОСТОЯННЫЙ проход между парой
//            систем. Дорого за маршрут, дальше по нему летают даром.
//   gates  — ворота строятся В СИСТЕМЕ. Дорого за систему, зато система с
//            воротами сама дотягивается до соседей и до любых других ворот.
export var MOVES: Move[] = [
  { key:"drives", name:"портальные движки", vt:"jump",
    hint:"Двигатель на каждом корабле: экспансия по одному кораблю, перевозки между звёздами дороги навсегда." },
  { key:"opener", name:"порталооткрыватели", vt:"opener",
    hint:"Проход прожигается один раз и остаётся: дорого за маршрут, потом по нему летают даром." },
  { key:"gates",  name:"звёздные ворота", vt:"gate",
    hint:"Ворота строятся в системе: дорого за систему, зато она дотягивается до соседей и до других ворот." }
];
export function moveOf(k: string){ for (var i=0;i<MOVES.length;i++) if (MOVES[i].key===k) return MOVES[i]; }

// Марки. Портал любой природы бьёт на ограниченное расстояние, и это главный
// ограничитель карты: Mk1 дотягивается только до первого кольца, дальние
// звёзды физически недоступны, пока кто-то не осилит следующую марку.
// Дальности подобраны под кольца: 46 — до первого и вдоль него, 66 — до
// второго, 90 — до третьего, 130 — до четвёртого и пятого.
export var MARKRANGE = [46, 66, 90, 130];
export var MARKDIFF  = [1300, 2500, 4000, 5800];
export const MARKS: Mark[] = [];
export function makeMarks() {
  fill(MARKS, MARKRANGE.map(function (r, i) {
    return { key: S.move.key + (i + 1), short: "Mk" + (i + 1), range: r, mark: i + 1,
             name: S.move.name + " Mk" + (i + 1), diff: MARKDIFF[i] };
  }));
}
export function markOf(k: string){ for (var i=0;i<MARKS.length;i++) if (MARKS[i].key===k) return MARKS[i]; }
// пока способ не выяснен, марки называются обезличенно
export function markName(m: Tech){ return S.moveKnown ? m.name : "Межзвёздный переход " + m.short; }
export function moveName(){ return S.moveKnown ? S.move.name : "способ пока неизвестен"; }

export var TEMPLATE = [
  { name:"Тайко Дриллинг",   color:"#6fd39b", craft:"буры",      nerve:0.9,
    apt:{ drill:1.9, hull:0.7, hold:0.6, drive:0.4, life:0.4, goods:0.35,
          temperate:0.7, cold:1.2, dry:0.8, hot:1.4, gas:0.5 } },
  { name:"Ново-Кеплер Авиа", color:"#ff8b5e", craft:"самолёты",  nerve:1.25,
    apt:{ hull:1.9, drive:0.85, hold:0.7, life:0.5, drill:0.4, goods:0.35,
          temperate:0.9, cold:0.7, dry:0.8, hot:0.6, gas:1.5 } },
  { name:"Дом чая Ланьхуа",  color:"#dd7ec6", craft:"чай",       nerve:0.6,
    apt:{ goods:2.0, hold:0.9, life:0.7, hull:0.35, drill:0.3, drive:0.3,
          temperate:1.7, cold:0.5, dry:0.9, hot:0.3, gas:0.4 } },
  { name:"Гелиос-Прайм",     color:"#4ec4e6", craft:"механика",  nerve:1.05,
    apt:{ drive:1.55, life:1.25, hull:0.8, hold:0.5, drill:0.5, goods:0.35,
          temperate:0.8, cold:1.0, dry:0.7, hot:1.2, gas:1.1 } },
  { name:"Синдикат Веги",    color:"#f2b33d", craft:"перевозки", nerve:0.85,
    apt:{ hold:1.85, life:0.85, goods:0.8, hull:0.6, drill:0.55, drive:0.45,
          temperate:1.0, cold:0.9, dry:1.5, hot:0.6, gas:0.7 } }
];

export var SYSNAMES = ["Тира","Скальд","Эреб","Полынь","Ирис","Корвус","Синдри","Лето","Танат","Ольха","Вега","Морок"];
export var BODYNAMES = ["Кадм","Валун","Мора","Сель","Хорь","Гарь","Тишь","Плёс","Овод","Стынь","Зной","Кром","Луда","Смоль","Вьюга","Наволок","Осока","Кипень","Тропа","Веха","Порог","Клин","Ржа","Соль","Тень","Уголь","Ярь","Бель","Гуж","Дым","Ель","Жар","Зов","Ил","Кол","Мох"];
export var ROCKNAMES = ["Гвоздь","Слюда","Пест","Кремень","Обух","Жернов","Скол","Дресва"];
// У каждого корабля есть командир. Без клика над кораблём видно только его
// имя, мелко: этого хватает, чтобы узнать "тот самый" корабль через годы.
export var CAPTAINS = ["Орлов","Вязов","Рахимова","Ли","Штерн","Данко","Мирра","Косой","Ясень","Тагир","Велес",
                "Ниязи","Круг","Селин","Хольм","Арно","Петля","Сойка","Грач","Тихон","Бекет","Ланге","Уза",
                "Кайя","Чибис","Строк","Драга","Инга","Марей","Стужа","Роник","Валь","Есаул","Йорк","Лада"];
export function pickCaptain(){ return CAPTAINS[Math.floor(Math.random() * CAPTAINS.length)] + " " + (++S.capSeq); }

