// Стенд: запускает ядро прототипа без браузера.
//
// Прототип живёт одним HTML-файлом и это осознанно (журнал, п. 8): правка числа
// и F5 занимают секунды. Но проверять баланс глазами по одной партии — способ
// пропустить именно то, что ломается тихо. Поэтому стенд вырезает содержимое
// тега script, подсовывает заглушки document/canvas/localStorage и получает
// ядро, которому можно сказать step() хоть десять тысяч раз.
//
// Заглушки нарочно тупые: если код тронет что-то, чего в них нет, тест упадёт,
// и это правильно — значит, ядро полезло в отрисовку там, где не должно.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function stubElement() {
  const el = {
    style: {}, value: "", textContent: "", innerHTML: "", disabled: false, className: "",
    addEventListener() {}, getBoundingClientRect() { return { left:0, top:0, width:840, height:680 }; },
    closest() { return null; }
  };
  return el;
}

function stubContext() {
  const noop = () => {};
  return {
    save: noop, restore: noop, translate: noop, rotate: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, rect: noop, arc: noop, closePath: noop, fill: noop, stroke: noop, fillRect: noop,
    fillText: noop, setLineDash: noop, setTransform: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    bezierCurveTo: noop, quadraticCurveTo: noop, arcTo: noop, scale: noop,
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, font: "", textAlign: "", textBaseline: ""
  };
}

// headless: ядро само видит отсутствие document и не трогает панели.
// Второй режим (withDom) существует, чтобы проверить, что отрисовка вообще
// не падает — она тоже часть файла и тоже ломается.
function load(file, { withDom = false, seed = null } = {}) {
  const html = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error("в " + file + " не нашёлся тег script");
  const code = m[1];

  const sandbox = { module: { exports: {} }, Math: Object.create(Math), console };
  if (seed !== null) {
    // свой генератор с сеймом: одна и та же партия воспроизводится
    let s = seed >>> 0;
    sandbox.Math.random = function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  if (withDom) {
    const nodes = {};
    sandbox.document = {
      getElementById(id) { return nodes[id] || (nodes[id] = stubElement()); },
      // значки в легенде рисуются теми же модельками, что и сцена, поэтому
      // отдаём настоящие заглушки канвасов: пусть код отрисовки исполнится
      querySelectorAll(sel) {
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
    sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sandbox.requestAnimationFrame = () => 0;
    sandbox.setInterval = () => 0;
    sandbox.clearInterval = () => {};
  }
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return sandbox.module.exports;
}

module.exports = { load };
