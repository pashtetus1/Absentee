// Холст и экранные величины. Отдельным модулем, потому что их пишет один
// модуль, а читают три: cx стоит в двухстах строках отрисовки, и таскать его
// параметром через каждую функцию было бы хуже, чем держать здесь.
//
// Присваивание идёт только через сеттеры: в ES-модулях чужую переменную
// присвоить нельзя, а читающие места от этого не меняются — связка живая,
// import { cx } видит текущее значение.

export const CW = 840, CH = 680;

export let cv: HTMLCanvasElement = null;
export let cx: CanvasRenderingContext2D = null;

// Во сколько раз ужимать ЭКРАННЫЕ размеры, чтобы они не росли вместе с зумом
// карты. Приближение должно раздвигать звёзды, а не раздувать подписи: при
// cam.k = 4 имена, значки и волосяные линии становились вчетверо толще и
// слипались в кашу. Позиции по-прежнему масштабируются, всё остальное — нет.
// В виде системы зума нет, поэтому там uiz всегда 1.
export let uiz = 1;

// Во сколько ужат ВИД СИСТЕМЫ, чтобы всё в неё влезло. Холст 840x680, то есть
// половина высоты — 340, а внешняя планета уходит на 374 и ворота на 420: без
// подгонки они честно рисуются ЗА КРАЕМ и выглядят как отсутствующие.
export let sysK = 1;
export function setSysK(v: number): void { sysK = v; }

// Настенное время прошлого кадра и накопленная фаза мерцания: по ней дрожат
// огоньки за кормой и пульсирует звезда.
export let last = 0;
export let glow = 0;

export function setCanvas(el: HTMLCanvasElement): void { cv = el; cx = el.getContext("2d"); }
export function setCx(ctx: CanvasRenderingContext2D): void { cx = ctx; }
export function getCx(): CanvasRenderingContext2D { return cx; }
export function setUiz(v: number): void { uiz = v; }
export function advanceFrame(ts: number, dt: number): void { last = ts; glow += dt; }
