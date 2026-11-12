import { computed, reactive, ref } from "vue";
import type { BattleEvent, BranchStore, Point, Terrain } from "../shared/types";
import { clone, findUnit, key } from "../shared/document";
import { reachable, terrainRules, paintTile } from "../features/terrain";
import { moveBudget, armorValue, tickStatuses } from "../features/roster";
import {
  getSkill,
  legalTargets,
  moveUnit,
  castSkill,
} from "../features/tactics";
import { finishTurn } from "../features/initiative";
import { record, usePlayback } from "../features/replay";
import {
  BranchPanel,
  depthOf,
  eventsOf,
  exportSession,
  forkBranch,
  frameAt,
  lengthOf,
  loadStore,
  newStore,
  removeBranch,
  saveStore,
} from "../features/branch";
import type { BranchRow } from "../features/branch";

export function useWorkspace() {
  // 刷新恢复：loadStore 内部会把旧版单局记录迁移为 root 分支。
  const store = reactive<BranchStore>(loadStore() ?? newStore());
  const cursor = ref(-1),
    selected = ref(store.sessions[store.currentId].live.active),
    skill = ref(""),
    brush = ref<Terrain | null>(null),
    notice = ref("选择蓝色格移动，或选择技能指定目标。"),
    // 独立的失败提示，避免被普通操作提示覆盖。
    storeError = ref("");

  const playback = usePlayback(
    () => eventsOf(store, store.currentId).length,
    (n) => {
      cursor.value = n;
    },
  );

  const session = computed(() => store.sessions[store.currentId]);
  const timeline = computed<BattleEvent[]>(() =>
    eventsOf(store, store.currentId),
  );
  const battle = computed(() => frameAt(store, store.currentId, cursor.value));
  const actor = computed(() => findUnit(battle.value, battle.value.active));
  const locked = computed(() => cursor.value >= 0 || !!session.value.live.ended);

  const routes = computed(() =>
    locked.value || actor.value.moved || actor.value.acted
      ? new Map()
      : reachable(session.value.live, actor.value, moveBudget(actor.value)),
  );
  const targets = computed(() => {
    const s = getSkill(actor.value.job, skill.value);
    return s ? legalTargets(battle.value, actor.value, s) : [];
  });

  /** 持久化；失败时保留内存中的原实战并显式标记“未保存成功”。 */
  function persist(failureHint: string) {
    try {
      saveStore(store);
      storeError.value = "";
    } catch (e) {
      storeError.value = `${failureHint}（${(e as Error).message}）`;
      notice.value = storeError.value;
    }
  }

  /** 整库替换（用于分叉/删除等纯函数式结构变更）。 */
  function replace(next: BranchStore) {
    store.version = next.version;
    store.currentId = next.currentId;
    store.meta = next.meta;
    store.order = next.order;
    store.sessions = next.sessions;
  }

  function cell(p: Point) {
    try {
      if (locked.value) throw new Error("回放只读，请返回实战或建立分支");
      const before = clone(session.value.live),
        u = actor.value;
      if (brush.value) {
        paintTile(session.value.live, p, brush.value);
        record(
          session.value,
          before,
          "terrain",
          `地形调整为${terrainRules[brush.value].name}`,
        );
      } else if (skill.value) {
        const s = getSkill(u.job, skill.value)!;
        const t = session.value.live.units.find(
          (t) => t.hp > 0 && key(t) === key(p),
        );
        if (!t) throw new Error("请点击合法角色");
        const ground = session.value.live.tiles.find(
          (v) => key(v) === key(t),
        )!;
        const high =
          session.value.live.tiles.find((v) => key(v) === key(u))!.terrain ===
          "ridge";
        const value = castSkill(
          session.value.live,
          u.id,
          t.id,
          s,
          armorValue(t),
          terrainRules[ground.terrain].cover,
          high,
        );
        record(
          session.value,
          before,
          "skill",
          `${u.name} → ${t.name} · ${s.name} ${value}`,
        );
        skill.value = "";
      } else {
        const route = routes.value.get(key(p));
        if (!route?.path.length)
          throw new Error("此格不可达，请检查地形与占位");
        moveUnit(session.value.live, u.id, route.path);
        record(
          session.value,
          before,
          "move",
          `${u.name}移动 · 消耗${route.cost}`,
          route.path,
        );
      }
      persist("本步行动未能保存");
      notice.value = session.value.events.at(-1)!.label;
    } catch (e) {
      notice.value = (e as Error).message;
    }
  }

  function wait() {
    if (locked.value) return;
    const before = clone(session.value.live);
    finishTurn(session.value.live, tickStatuses);
    record(
      session.value,
      before,
      "wait",
      `${findUnit(before, before.active).name}结束行动`,
    );
    selected.value = session.value.live.active;
    skill.value = "";
    persist("结束行动未能保存");
  }

  function seek(n: number) {
    playback.stop();
    cursor.value = n;
    skill.value = "";
    brush.value = null;
  }

  /** 切换分支：地图、编队、回放指针整体切到目标分支。 */
  function switchBranch(id: string) {
    if (id === store.currentId) return;
    playback.stop();
    store.currentId = id;
    cursor.value = -1;
    selected.value = store.sessions[id].live.active;
    skill.value = "";
    brush.value = null;
    storeError.value = "";
    notice.value = `已切换到「${store.meta[id].name}」`;
    persist("分支切换状态未能保存");
  }

  /**
   * 从当前回放步骤建立独立分支。
   * 先在纯数据上构建并尝试落盘，落盘成功才提交到响应式状态，
   * 因此存储失败时原实战完整保留，并明确提示未创建成功。
   */
  function createBranch() {
    const at = cursor.value;
    if (at < 0) {
      notice.value = "请先在回放中停在明确步骤，再建立分支";
      return;
    }
    try {
      playback.stop(); // 播放途中先停在当前明确步骤，绝不混入下一步
      const next = forkBranch(store, {
        parentId: store.currentId,
        point: at,
      });
      saveStore(next); // 先落盘：失败会抛出，下面的状态提交不会执行
      replace(next);
      playback.stop();
      cursor.value = -1;
      selected.value = store.sessions[next.currentId].live.active;
      skill.value = "";
      brush.value = null;
      storeError.value = "";
      notice.value = `已在第 ${at} 步建立「${store.meta[next.currentId].name}」`;
    } catch (e) {
      storeError.value = `分支创建失败，原实战未改动（${(e as Error).message}）`;
      notice.value = storeError.value;
    }
  }

  /** 删除分支；后代会被保留并重新挂接，历史不悬空。 */
  function deleteBranch(id: string) {
    try {
      const next = removeBranch(store, id);
      replace(next);
      if (cursor.value >= 0) cursor.value = -1;
      selected.value = store.sessions[store.currentId].live.active;
      skill.value = "";
      brush.value = null;
      persist("分支删除结果未能保存");
      notice.value = "分支已删除，其后代历史已保留";
    } catch (e) {
      notice.value = (e as Error).message;
    }
  }

  function reset() {
    playback.stop();
    const next = newStore();
    try {
      saveStore(next);
      storeError.value = "";
    } catch (e) {
      storeError.value = `重新部署未能保存（${(e as Error).message}）`;
    }
    replace(next);
    cursor.value = -1;
    selected.value = store.sessions[store.currentId].live.active;
    skill.value = "";
    brush.value = null;
    notice.value = storeError.value || "新战斗已就绪";
  }

  function download() {
    // 导出当前分支拼出的完整时间线（含共享前缀）。
    const s = session.value;
    exportSession({
      initial: clone(store.sessions[store.order[0]].initial),
      live: clone(s.live),
      events: timeline.value.map((e) => clone(e)),
    });
  }

  const path = computed(() =>
    cursor.value > 0 ? (timeline.value[cursor.value - 1]?.path ?? []) : [],
  );

  const branchRows = computed<BranchRow[]>(() =>
    store.order.map((id) => ({
      meta: store.meta[id],
      steps: lengthOf(store, id),
      depth: depthOf(store, id),
      current: id === store.currentId,
    })),
  );

  return {
    store,
    session,
    timeline,
    branchRows,
    cursor,
    selected,
    skill,
    brush,
    notice,
    storeError,
    battle,
    actor,
    locked,
    routes,
    targets,
    path,
    playback,
    BranchPanel,
    cell,
    wait,
    seek,
    switchBranch,
    createBranch,
    deleteBranch,
    reset,
    download,
  };
}
