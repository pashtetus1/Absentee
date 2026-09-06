// Сборка: из src/*.ts и src/shell.html получается ОДИН dist/index.html.
//
// Почему один файл на выходе, если исходники разложены по модулям: игрок
// открывает результат двойным щелчком, без сервера, а нативные ES-модули по
// протоколу file:// браузер не грузит вообще. Плюс Pages кладёт на ветку ровно
// один файл. Внутри — тот же тег script и та же обёртка THRESHOLD, что и
// раньше, поэтому test/harness.js работает без изменений.
//
//     node build.mjs            собрать один раз
//     node build.mjs --watch    пересобирать на каждое сохранение
//
// В git результат НЕ кладётся: dist/ в .gitignore, ветку на Pages собирает CI.

import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const MARK = "<!--СКРИПТ-->";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  globalName: "THRESHOLD",
  // Стенд вырезает тег script и исполняет его в vm, где нет window, но есть
  // module. Эта строка — единственный мост к нему, она была и в рукописном
  // файле; без неё тесты не видят ядро.
  footer: { js: 'if (typeof module !== "undefined" && module.exports) module.exports = THRESHOLD;' },
  target: ["es2018"],
  charset: "utf8",
  // не сжимаем: выложенный файл читают глазами, и это осознанно
  minify: false,
  write: false,
  logLevel: "silent"
};

async function build() {
  const started = Date.now();
  const out = await esbuild.build(options);
  const code = out.outputFiles[0].text.trim();
  const shell = await readFile("src/shell.html", "utf8");
  if (!shell.includes(MARK)) throw new Error("в src/shell.html нет метки " + MARK);
  const html = shell.replace(MARK, "<script>\n" + code + "\n</script>");
  await mkdir("dist", { recursive: true });
  await writeFile("dist/index.html", html);
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log("dist/index.html — " + kb + " КБ, " + (Date.now() - started) + " мс");
}

if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [{
    name: "собрать-html",
    setup(b) { b.onEnd(async (r) => {
      if (r.errors.length) return;
      const shell = await readFile("src/shell.html", "utf8");
      await mkdir("dist", { recursive: true });
      await writeFile("dist/index.html", shell.replace(MARK, "<script>\n" + r.outputFiles[0].text.trim() + "\n</script>"));
      console.log("пересобрано " + new Date().toLocaleTimeString("ru-RU"));
    }); }
  }] });
  await ctx.watch();
  console.log("слежу за src/, правь и жми F5 на dist/index.html");
} else {
  try { await build(); }
  catch (e) {
    if (e.errors) e.errors.forEach((m) => console.error(m.location ?
      m.location.file + ":" + m.location.line + " — " + m.text : m.text));
    else console.error(e.message);
    process.exit(1);
  }
}
