import type { Battle, BranchStore, Session } from "../../../shared/types";
import { clone } from "../../../shared/document";
import { createMap } from "../../terrain/model/map";
import { createUnits } from "../../roster/model/units";
import { order } from "../../initiative/lib/order";

/** 生成一局全新战斗会话（与 app/session 的初始部署保持一致）。 */
export function newSession(): Session {
  const live: Battle = {
    tiles: createMap(),
    units: createUnits(),
    round: 1,
    queue: [],
    active: "",
    ended: null,
  };
  live.queue = order(live);
  live.active = live.queue[0];
  return { initial: clone(live), live, events: [] };
}

/** 建立只含 root 主分支的初始存档。 */
export function newStore(): BranchStore {
  const session = newSession();
  return {
    version: 1,
    currentId: "root",
    meta: {
      root: {
        id: "root",
        name: "主分支",
        parentId: null,
        point: 0,
        createdAt: Date.now(),
      },
    },
    order: ["root"],
    sessions: { root: session },
  };
}
