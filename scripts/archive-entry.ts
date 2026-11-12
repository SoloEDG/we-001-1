/* 在任何业务模块导入前安装内存版 localStorage 垫片。 */
class MemoryStorage {
  private m = new Map<string, string>();
  failOnSet = false;
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failOnSet) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const mem = new MemoryStorage();
// @ts-expect-error 注入测试用全局垫片
globalThis.localStorage = mem;

import { newStore } from "../src/features/branch/model/factory";
import {
  forkBranch,
  removeBranch,
  assertStore,
} from "../src/features/branch/model/tree";
import { loadStore, saveStore } from "../src/features/branch/lib/archive";
import { record } from "../src/features/replay/model/recording";
import { clone } from "../src/shared/document";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
};

// 1. 新存档保存后可原样加载，且 currentId 被恢复
const store = newStore();
const s0 = store.sessions.root;
for (let i = 0; i < 2; i++) {
  const b = clone(s0.live);
  s0.live.round = i + 5;
  record(s0, b, "wait", "e" + i);
}
const forked = forkBranch(store, { parentId: "root", point: 1 });
saveStore(forked);
const reloaded = loadStore();
ok("reload not null", reloaded !== null);
ok(
  "reload restores current branch",
  reloaded!.currentId === forked.currentId,
);
ok("reload keeps branch count", reloaded!.order.length === 2);
assertStore(reloaded!);
ok("reloaded events identical", reloaded!.sessions.root.events.length === 2);

// 2. 刷新恢复：删除某分支后保存，再加载仍定位正确
const trimmed = removeBranch(forked, forked.currentId);
saveStore(trimmed);
const reloaded2 = loadStore();
ok(
  "after delete reload falls back to root",
  reloaded2!.currentId === "root",
);
ok("after delete reload has one branch", reloaded2!.order.length === 1);

// 3. 存储失败：抛错且原内存存档不被破坏
const before = JSON.stringify(trimmed);
mem.failOnSet = true;
let threw = false;
try {
  saveStore(trimmed);
} catch {
  threw = true;
}
mem.failOnSet = false;
ok("saveStore throws on quota error", threw);
ok(
  "in-memory store untouched after failed save",
  JSON.stringify(trimmed) === before,
);

// 4. 损坏数据返回 null，不抛出
mem.setItem("we001-branch-store", "{not-json");
ok("corrupt store yields null", loadStore() === null);

// 5. 旧版单局数据自动迁移为 root 分支
mem.removeItem("we001-branch-store");
const legacy = newStore().sessions.root;
for (let i = 0; i < 2; i++) {
  const b = clone(legacy.live);
  legacy.live.round = i + 9;
  record(legacy, b, "wait", "legacy" + i);
}
mem.setItem("we001-session", JSON.stringify(legacy));
const migrated = loadStore();
ok(
  "legacy migrated to root branch",
  migrated !== null && migrated.order[0] === "root",
);
ok("migrated events preserved", migrated!.sessions.root.events.length === 2);
ok("migration marks current root", migrated!.currentId === "root");
assertStore(migrated!);
ok(
  "migration persisted under new key",
  !!mem.getItem("we001-branch-store"),
);

// 6. 结构非法（空 order）返回 null
mem.setItem(
  "we001-branch-store",
  JSON.stringify({ version: 1, currentId: "root", meta: {}, order: [] }),
);
ok("malformed store yields null", loadStore() === null);

console.log(`archive tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
