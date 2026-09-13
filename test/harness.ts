// Стенд: запускает ядро прототипа без браузера.
//
// Игра пишется исходниками в src/, а собирается в ОДИН dist/index.html — так
// её открывают двойным щелчком и так её кладёт на ветку Pages. Стенд работает
// именно по собранному файлу, а не по исходникам: проверять надо то, что
// реально поедет к игроку, вместе со сборкой.
//
// Проверять баланс глазами по одной партии — способ пропустить именно то, что
// ломается тихо. Поэтому стенд вырезает содержимое тега script, подсовывает
// заглушки document/canvas/localStorage и получает ядро, которому можно
// сказать step() хоть десять тысяч раз.
//
// Заглушки нарочно тупые: если код тронет что-то, чего в них нет, тест упадёт,
// и это правильно — значит, ядро полезло в отрисовку там, где не должно.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

import type { Core } from "../src/types.ts";

/** Ядро плюс то, что стенд к нему приделывает для проверки отрисовки. */
export interface Harnessed extends Core {
  /** Прокрутить один кадр руками: сам он в заглушках не крутится. */
  __frame(): void;
  /** Что панель написала в этот блок. Разметка панелей — тоже поведение: она
   *  уже врала числами (урожай, состав корабля), и поймать это можно только
   *  прочитав то, что она выдала. Пусто, если блока нет или он не заполнялся. */
  __html(id: string): string;
}

interface Options {
  /** Поднять заглушки DOM, чтобы исполнялся и код отрисовки. */
  withDom?: boolean;
  /** Сид генератора случайных чисел: одна и та же партия воспроизводится. */
  seed?: number | null;
  /** Память браузера между запусками: что один запуск отложил, второй найдёт.
   *  Ради этого она и передаётся снаружи — сохранение проверяется только так,
   *  вдвоём, а заглушка, которая всё забывает, показала бы зелёный на игре,
   *  теряющей партию. */
  store?: Record<string, string>;
}

function stubElement(): any {
  return {
    style: {}, value: "", textContent: "", innerHTML: "", disabled: false, className: "",
    addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 840, height: 680 }; },
    closest(): null { return null; }
  };
}

function stubContext(): any {
  const noop = () => {};
  return {
    save: noop, restore: noop, translate: noop, rotate: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, rect: noop, arc: noop, closePath: noop, fill: noop, stroke: noop, fillRect: noop,
    fillText: noop, setLineDash: noop, setTransform: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    bezierCurveTo: noop, quadraticCurveTo: noop, arcTo: noop, scale: noop, strokeRect: noop,
    measureText: (s: string) => ({ width: String(s).length * 5.5 }),
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, font: "", textAlign: "", textBaseline: ""
  };
}

// headless: ядро само видит отсутствие document и не трогает панели.
// Второй режим (withDom) существует, чтобы проверить, что отрисовка вообще
// не падает — она тоже часть файла и тоже ломается.
export function load(file: string, { withDom = false, seed = null, store = {} }: Options = {}): Harnessed {
  const html = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
  // \r?  — на Windows git выдаёт файл с CRLF, и без этого стенд не находит тег
  const m = html.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);
  if (!m) throw new Error("в " + file + " не нашёлся тег script");
  const code = m[1];

  const sandbox: any = { module: { exports: {} }, Math: Object.create(Math), console };
  if (seed !== null) {
    // Подмена Math.random нужна для СТАРЫХ файлов: до появления src/rng.ts ядро
    // брало случайность прямо у среды, и другого способа задать сид не было.
    // Сличитель гоняет такие файлы до сих пор, поэтому подмена остаётся.
    // Новое ядро сюда не заглядывает: у него сид ставится через build().
    let s = seed >>> 0;
    sandbox.Math.random = function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  let nodes: Record<string, any> = {};
  if (withDom) {
    sandbox.document = {
      getElementById(id: string) { return nodes[id] || (nodes[id] = stubElement()); },
      // значки в легенде рисуются теми же модельками, что и сцена, поэтому
      // отдаём настоящие заглушки канвасов: пусть код отрисовки исполнится
      querySelectorAll(sel: string) {
        if (!/ikon/.test(sel)) return [];
        return ["jump", "mine", "colony", "cargo"].map((kind) => {
          const el = stubElement();
          el.getContext = stubContext;
          el.getAttribute = () => kind;
          return el;
        });
      },
      addEventListener() {}
    };
    sandbox.document.getElementById("view").getContext = stubContext;
    sandbox.window = { devicePixelRatio: 1, addEventListener() {} };
    sandbox.localStorage = {
      getItem: (k: string): string => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; }
    };
    // кадр не крутится сам: тест дёргает __frame() руками, чтобы отрисовка
    // карты и системы реально исполнялась, а не только регистрировалась
    sandbox.requestAnimationFrame = (fn: (ts: number) => void): number => { sandbox.__frame = fn; return 0; };
    sandbox.setInterval = () => 0;
    sandbox.clearInterval = () => {};
  }
  createContext(sandbox);
  runInContext(code, sandbox, { filename: file });
  const raw: Harnessed = sandbox.module.exports;
  // Новое ядро само держит генератор: пересобираем партию с нужным сидом.
  // Алгоритм тот же, что в подмене выше, поэтому поток чисел совпадает и
  // сличитель по-прежнему сравнивает старый файл с новым честно.
  //
  // И подменяем build: без сида он берёт НОВЫЙ случайный, как и должен по кнопке
  // «Заново» в игре. Тесту это не годится — он зовёт build(mode), чтобы задать
  // способ перелёта, и партия при этом обязана остаться той же. Здесь сид
  // подставляется сам; тест по-прежнему может передать свой и получить другую.
  // Поля экспортов — геттеры, поверх них не присвоить, поэтому берём копию.
  let api = raw;
  if (seed !== null && typeof raw.seedOf === "function") {
    const copy: any = {};
    for (const k of Object.keys(raw)) copy[k] = (raw as any)[k];
    copy.build = (forcedMove?: string, s?: number) => raw.build(forcedMove, s === undefined ? seed : s);
    api = copy as Harnessed;
    api.build(undefined, seed);
    // Предложения без игрока повисли бы: стенд отвечает на них монеткой из
    // генератора партии, так что прогон остаётся воспроизводимым. Тест, которому
    // нужно иное, ставит политику сам.
    if (typeof api.setApproval === "function") api.setApproval("random");
  }
  if (withDom) {
    let ts = 0;
    api.__frame = () => { const fn = sandbox.__frame; sandbox.__frame = null; if (fn) fn(ts += 16); };
  }
  api.__html = (id: string): string => String((nodes[id] && nodes[id].innerHTML) || "");
  return api;
}
