import { newStore } from "../src/features/branch/model/factory";
import {
  assertStore,
  eventsOf,
  forkBranch,
  frameAt,
  lengthOf,
  removeBranch,
} from "../src/features/branch/model/tree";
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
const addEvent = (
  s: ReturnType<typeof newStore>["sessions"][string],
  label: string,
) => {
  const before = clone(s.live);
  s.live.round += 1;
  record(s, before, "wait", label);
};

// 构造 root：追加 3 个事件
const store0 = newStore();
const root = store0.sessions.root;
for (let i = 0; i < 3; i++) addEvent(root, "root-e" + (i + 1));
ok("root 3 events", root.events.length === 3);
ok("root timeline len", lengthOf(store0, "root") === 3);

// 在第 2 步分叉
const store1 = forkBranch(store0, { parentId: "root", point: 2 });
const b1 = store1.order[1];
ok("fork current switches", store1.currentId === b1);
ok("child holds no copied prefix", store1.sessions[b1].events.length === 0);
ok("child timeline shares 2 prefix", lengthOf(store1, b1) === 2);
ok(
  "prefix labels shared",
  eventsOf(store1, b1).map((e) => e.label).join(",") === "root-e1,root-e2",
);
const forked = frameAt(store1, b1, -1);
ok(
  "snapshot equals step2 after",
  forked.round === frameAt(store1, "root", 2).round,
);
ok("snapshot independent object", forked !== root.events[1].after);

// 子分支追加 2 个自有事件
const s1 = store1.sessions[b1];
addEvent(s1, "b1-e1");
addEvent(s1, "b1-e2");
ok("child timeline 4", lengthOf(store1, b1) === 4);
ok(
  "child labels",
  eventsOf(store1, b1).map((e) => e.label).join(",") ===
    "root-e1,root-e2,b1-e1,b1-e2",
);
ok("root still 3 (prefix immutable)", lengthOf(store1, "root") === 3);

// 从 b1 第 3 步（b1-e1 之后）再分叉 b2
const store2 = forkBranch(store1, { parentId: b1, point: 3 });
const b2 = store2.order[2];
ok("nested timeline 3", lengthOf(store2, b2) === 3);
ok(
  "nested labels",
  eventsOf(store2, b2).map((e) => e.label).join(",") ===
    "root-e1,root-e2,b1-e1",
);
const s2 = store2.sessions[b2];
addEvent(s2, "b2-e1");
ok("nested own event", lengthOf(store2, b2) === 4);

// 再深一层：b3 从 b2 第 4 步分叉
const storeDeep = forkBranch(store2, { parentId: b2, point: 4 });
const b3 = storeDeep.order[3];
ok(
  "deep nested labels",
  eventsOf(storeDeep, b3).map((e) => e.label).join(",") ===
    "root-e1,root-e2,b1-e1,b2-e1",
);
addEvent(storeDeep.sessions[b3], "b3-e1");

// 删除中间分支 b1：b2 必须保留完整历史并改挂 root
const store3 = removeBranch(store2, b1);
ok("b1 removed", !store3.meta[b1]);
ok("b2 reparented to root", store3.meta[b2].parentId === "root");
ok("b2 point converged to 2", store3.meta[b2].point === 2);
ok(
  "b2 history intact after parent delete",
  eventsOf(store3, b2).map((e) => e.label).join(",") ===
    "root-e1,root-e2,b1-e1,b2-e1",
);
ok("b2 length preserved", lengthOf(store3, b2) === 4);
ok(
  "current falls back when active deleted",
  (() => {
    const active = clone(store2);
    active.currentId = b1;
    return removeBranch(active, b1).currentId === "root";
  })(),
);

// 深层连续删除：先删 b1，再删已上挂 root 的 b2，b3 历史仍完整
const afterFirst = removeBranch(storeDeep, b1);
ok("b2 now child of root", afterFirst.meta[b2].parentId === "root");
const afterSecond = removeBranch(afterFirst, b2);
ok("b2 removed", !afterSecond.meta[b2]);
ok("b3 survives and reattaches", afterSecond.meta[b3].parentId === "root");
ok(
  "b3 full history preserved across two ancestor deletions",
  eventsOf(afterSecond, b3).map((e) => e.label).join(",") ===
    "root-e1,root-e2,b1-e1,b2-e1,b3-e1",
);
assertStore(afterSecond);

// 边界：分叉点恰好在被删节点自有段起点（take = 0），不吸收任何事件
const edge = forkBranch(store1, { parentId: b1, point: 2 });
const be = edge.order[edge.order.length - 1];
const edgeAfter = removeBranch(edge, b1);
ok(
  "zero-take fork keeps only root prefix",
  eventsOf(edgeAfter, be).map((e) => e.label).join(",") ===
    "root-e1,root-e2",
);
assertStore(edgeAfter);

// 多子分支：删除共同父分支后兄弟各自存活
const sb = forkBranch(store1, { parentId: "root", point: 1 });
const b3sib = sb.order[sb.order.length - 1];
const merged = removeBranch(sb, b1);
ok("sibling survives", !!merged.meta[b3sib]);
ok(
  "root undeletable guard",
  (() => {
    try {
      removeBranch(merged, "root");
      return false;
    } catch {
      return true;
    }
  })(),
);

// 帧定位边界
ok(
  "frame 0 is initial",
  frameAt(store3, b2, 0) === store3.sessions.root.initial,
);
ok("frame -1 is live", frameAt(store3, b2, -1) === store3.sessions[b2].live);
ok(
  "frame clamps beyond end",
  frameAt(store3, b2, 99).round === store3.sessions[b2].live.round,
);

assertStore(store3);
assertStore(sb);
assertStore(store1);

console.log(`branch logic tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
