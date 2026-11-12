import type {
  Battle,
  BattleEvent,
  BranchMeta,
  BranchStore,
  Session,
} from "../../../shared/types";
import { assertBattle, clone } from "../../../shared/document";

/**
 * 分支推演的纯逻辑层：所有函数不修改入参，返回新的存档。
 *
 * 存储模型（共享不可变前缀）：
 * - root 分支保存完整事件链；每个子分支的 Session 只持有
 *   `initial`(= 分叉时快照) 与从分叉点之后产生的自有事件，
 *   前缀历史通过 parentId / point 引用父分支，不复制整段战斗记录。
 * - 时间线按祖先链逐级拼出，祖先分支只截取到下一级分叉点。
 * - 删除带后代的分支时，把它的自有事件吸收进直接子分支，
 *   子分支改挂到被删分支的父节点，因此任何后代引用的历史都不会悬空。
 */

export function genBranchId(existing: Record<string, unknown>): string {
  let id = "";
  do {
    const rand =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    id = `b-${Date.now().toString(36)}-${rand}`;
  } while (existing[id]);
  return id;
}

export function getMeta(store: BranchStore, id: string): BranchMeta {
  const m = store.meta[id];
  if (!m) throw new Error("分支不存在");
  return m;
}

/** 从 root 到目标分支的祖先链（含目标自身）。 */
export function branchChain(store: BranchStore, id: string): BranchMeta[] {
  const chain: BranchMeta[] = [];
  let current: string | null = id;
  const guard = new Set<string>();
  while (current) {
    const m = getMeta(store, current);
    if (guard.has(m.id)) throw new Error("分支谱系存在环");
    guard.add(m.id);
    chain.unshift(m);
    current = m.parentId;
  }
  return chain;
}

/** 目标分支在完整时间线上的总步数（事件条数）。 */
export function lengthOf(store: BranchStore, id: string): number {
  return eventsOf(store, id).length;
}

/** 拼出某条分支完整时间线上的事件（共享前缀 + 自有后缀）。 */
export function eventsOf(store: BranchStore, id: string): BattleEvent[] {
  const chain = branchChain(store, id);
  const events: BattleEvent[] = [];
  let offset = 0; // 已贡献事件在完整时间线上的全局起点
  chain.forEach((m, i) => {
    const own = store.sessions[m.id].events;
    const next = chain[i + 1];
    // point 是相对父时间线的全局步数，换算成本节点自有数组里的本地下标。
    const localLimit = next ? next.point - offset : own.length;
    for (let j = 0; j < localLimit; j++) events.push(own[j]);
    offset += localLimit;
  });
  return events;
}

/** 取某条分支时间线上第 cursor 步对应的战斗快照。
 * cursor: 0 = 开战初始；n>0 = 第 n 个事件之后；-1 = 分支当前最新局面。 */
export function frameAt(
  store: BranchStore,
  id: string,
  cursor: number,
): Battle {
  if (cursor < 0) return store.sessions[id].live;
  if (cursor === 0) return store.sessions[store.order[0]].initial;
  const events = eventsOf(store, id);
  const n = Math.min(cursor, events.length);
  if (n === 0) return store.sessions[store.order[0]].initial;
  return events[n - 1].after;
}

/** 分支在谱系中的深度（root = 0）。 */
export function depthOf(store: BranchStore, id: string): number {
  return branchChain(store, id).length - 1;
}

export interface ForkInput {
  parentId: string;
  /** 分叉点：父分支时间线上的全局步数。 */
  point: number;
  name?: string;
}

/** 在指定历史步骤建立独立推演分支。返回新存档，原存档不被修改。 */
export function forkBranch(store: BranchStore, input: ForkInput): BranchStore {
  const parentEvents = eventsOf(store, input.parentId);
  const point = Math.max(0, Math.min(input.point, parentEvents.length));
  const base: Battle =
    point === 0
      ? clone(store.sessions[store.order[0]].initial)
      : clone(parentEvents[point - 1].after);
  const id = genBranchId(store.meta);
  const meta: BranchMeta = {
    id,
    name:
      input.name?.trim() ||
      `分支 ${store.order.length + 1} · 第 ${point} 步`,
    parentId: input.parentId,
    point,
    createdAt: Date.now(),
  };
  const session: Session = {
    initial: clone(base),
    live: clone(base),
    events: [],
  };
  const next: BranchStore = clone(store);
  next.meta[id] = meta;
  next.sessions[id] = session;
  next.order.push(id);
  next.currentId = id;
  return next;
}

/**
 * 删除分支。
 * - root 不可删除。
 * - 若存在后代：直接子分支吸收被删分支的自有事件并上挂到其父节点，
 *   更深的后代随之保留，历史引用不悬空。
 * - 若当前分支被删，切换到 root。
 */
export function removeBranch(store: BranchStore, id: string): BranchStore {
  const target = getMeta(store, id);
  if (target.parentId === null) throw new Error("主分支不可删除");
  const next: BranchStore = clone(store);
  const children = next.order.filter(
    (bid) => next.meta[bid].parentId === id,
  );
  const absorbed = next.sessions[id].events;
  for (const childId of children) {
    const child = next.meta[childId];
    const childSession = next.sessions[childId];
    // 子分支只继承到它自己分叉点为止的前缀。
    // target.point 是被删节点自有段在其完整时间线上的起点，
    // 因此需要吸收的本地下标上限 = child.point - target.point。
    const take = Math.max(0, child.point - target.point);
    const prefix = absorbed.slice(0, take);
    // 重新编号，避免与子分支已有事件 id 冲突。
    const offset = childSession.events.length;
    const shifted = prefix.map((e, i) => ({
      ...clone(e),
      id: offset + i + 1,
    }));
    childSession.events = [...shifted, ...childSession.events];
    // 上挂祖父：祖父对该谱系只贡献到 target.point，
    // 故新分叉点收敛为 target.point，其余历史已并入子分支自有事件。
    child.parentId = target.parentId;
    child.point = target.point;
  }
  delete next.meta[id];
  delete next.sessions[id];
  next.order = next.order.filter((bid) => bid !== id);
  if (next.currentId === id) next.currentId = next.order[0];
  return next;
}

/** 校验存档结构完整性（含谱系与引用一致性）。 */
export function assertStore(store: unknown): asserts store is BranchStore {
  if (!store || typeof store !== "object") throw new Error("存档为空");
  const s = store as BranchStore;
  if (s.version !== 1 || !Array.isArray(s.order) || !s.order.length)
    throw new Error("存档版本或分支序列无效");
  if (!s.meta || !s.sessions || typeof s.currentId !== "string")
    throw new Error("存档字段缺失");
  const ids = new Set(s.order);
  if (ids.size !== s.order.length) throw new Error("分支 id 重复");
  for (const id of s.order) {
    const m = s.meta[id];
    const sess = s.sessions[id];
    if (!m || !sess) throw new Error("分支数据不完整");
    if (m.id !== id) throw new Error("分支元数据不匹配");
    assertBattle(sess.live);
    assertBattle(sess.initial);
    if (!Array.isArray(sess.events)) throw new Error("事件序列无效");
    if (m.parentId === null) {
      if (id !== s.order[0]) throw new Error("主分支必须位于序列首位");
    } else {
      if (!ids.has(m.parentId)) throw new Error("父分支引用悬空");
      if (!Number.isInteger(m.point) || m.point < 0)
        throw new Error("分叉点无效");
    }
  }
  if (!ids.has(s.currentId)) throw new Error("当前分支引用无效");
  // 谱系无环检查。
  for (const id of s.order) branchChain(s, id);
}
