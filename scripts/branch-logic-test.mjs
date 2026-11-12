/* 分支纯逻辑测试：用 vite 把 TS 测试入口打包为单文件 ESM 后执行。
   覆盖：共享前缀、时间线拼出、分叉快照、删除父分支保留后代历史、帧定位、存档校验。 */
import { build } from "vite";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const entry = resolve(here, "branch-logic-entry.ts");
const outDir = resolve(here, ".__branch_logic_dist");

await build({
  root,
  configFile: false,
  logLevel: "error",
  build: {
    outDir,
    lib: { entry, formats: ["es"], fileName: () => "test.js" },
    rollupOptions: { input: entry },
  },
});

await import(new URL("./.__branch_logic_dist/test.js", import.meta.url).href);

rmSync(outDir, { recursive: true, force: true });
