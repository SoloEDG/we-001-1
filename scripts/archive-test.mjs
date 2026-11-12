/* 持久化层集成测试：内存版 localStorage 垫片验证保存/加载、刷新恢复、
   旧版单局迁移、存储失败保留原内存存档。 */
import { build } from "vite";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const entry = resolve(here, "archive-entry.ts");
const outDir = resolve(here, ".__archive_logic_dist");

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

await import(new URL("./.__archive_logic_dist/test.js", import.meta.url).href);

rmSync(outDir, { recursive: true, force: true });
