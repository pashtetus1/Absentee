// ===================== государства и гербы =====================
//
// До первого отделения государство в партии одно, и принадлежность никого не
// занимает: всё, что летает и стоит, — ваше. Как только голодный мир вытянул
// на краю жребий «государство» (colony.ts, despair), в галактике становится
// ДВА государства, и с этого дня вопрос «чьё это» перестаёт иметь один ответ.
//
// Отвечает на него герб. Правило то же, что у кораблей (журнал: форма — что
// это, цвет — чьё это), только на этаж выше: цвет щита говорит, какая контора
// стоит за государством, а ФИГУРА на щите — какое это государство. Родное
// носит звезду, тот же знак, что столица; отделившиеся получают следующую
// фигуру из списка по мере появления.
//
// Здесь только домен: кто к какому государству относится. Как щит нарисован —
// в render/models.ts (crest), где его вешать — в render/scene.ts.

import { corps } from "./state";
import type { Corp, Ship, Voyage, World } from "./types";

/** Родное государство игрока. Своей конторы у него нет, поэтому и номера нет. */
export const HOME = -1;

/** Государство ли эта контора. Герб выдаётся ровно при отделении мира и
 *  больше никому, поэтому его наличие и есть признак: origin для этого не
 *  годится — по нему пришлось бы сравнивать строки в каждом кадре. */
export function isRealm(c: Corp): boolean { return c.crest !== undefined; }

/** Под чьим флагом ходит контора: своим, если она сама государство. */
export function realmOfCorp(c: Corp): number { return isRealm(c) ? c.id : HOME; }

/** Чей это мир. free ставится там, где мир вышел из государства, и там же,
 *  где отделившееся государство основало новую колонию (world.ts). */
export function realmOf(w: World): number { return w.free ? w.founder : HOME; }

/** Под чьим флагом идёт рейс. Грузовик с деталью — под флагом ПОКУПАТЕЛЯ
 *  (forCorp), а не того, у кого деталь куплена: везут её ему. Хлебовоз и
 *  переселенческий идут от правительства мира-получателя, кроме частной
 *  помощи — та под флагом того, кто платит. */
export function realmOfVoyage(v: Voyage): number {
  if (v.kind === "food" || v.kind === "pops")
    return v.relief !== undefined ? realmOfCorp(corps[v.relief]) : realmOf(v.to as World);
  const id = v.forCorp !== undefined ? v.forCorp : v.corp;
  return id === undefined ? HOME : realmOfCorp(corps[id]);
}
export function realmOfShip(sh: Ship): number { return realmOfCorp(corps[sh.corp]); }

/** Есть ли кому предъявлять герб. Пока государство одно, щит над каждой
 *  планетой и каждым кораблём — чистый шум: он отвечает на вопрос, которого
 *  никто не задавал. Поэтому гербов не видно до первого отделения. */
export function manyRealms(): boolean { return corps.some(isRealm); }

/** Цвет щита: у отделившихся — цвет их конторы, у родного — золото столицы. */
export function realmColor(r: number): string { return r === HOME ? "#ffe6a8" : corps[r].color; }
/** Номер фигуры на щите; 0 — звезда родного государства. */
export function realmCharge(r: number): number { return r === HOME ? 0 : corps[r].crest; }
export function realmName(r: number): string { return r === HOME ? "государство" : corps[r].name; }
