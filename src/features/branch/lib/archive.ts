import type { BranchStore, Session } from "../../../shared/types";
import { assertBattle, clone } from "../../../shared/document";
import { assertStore } from "../model/tree";

const STORE_KEY = "we001-branch-store";
const LEGACY_KEY = "we001-session";

/**
 * 写入分支存档。localStorage 失败（配额/隐私模式/被禁用）时抛出，
 * 由调用方决定如何提示；内存中的原实战不会被本函数改动。
 */
export function saveStore(store: BranchStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (err) {
    throw new Error(
      `分支存档写入失败：${(err as Error).message || "本地存储不可用"}`,
    );
  }
}

/** 把旧版单局 Session 迁移为只含 root 分支的新存档。 */
function migrateLegacy(raw: string): BranchStore | null {
  try {
    const s = JSON.parse(raw) as Session;
    assertBattle(s.live);
    assertBattle(s.initial);
    if (!Array.isArray(s.events)) return null;
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
      sessions: { root: clone(s) },
    };
  } catch {
    return null;
  }
}

/**
 * 读取分支存档；任何结构异常都返回 null，避免污染当前实战。
 * 首次升级时自动迁移旧的单局记录。
 */
export function loadStore(): BranchStore | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      assertStore(parsed);
      return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      if (migrated) {
        // 迁移成功后落盘；落盘失败不阻断本次使用（仍在内存中可用）。
        try {
          saveStore(migrated);
        } catch {
          /* 忽略：下次加载会再次尝试迁移 */
        }
        return migrated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 导出当前分支的完整时间线（拼出共享前缀），结构沿用旧版 Session。 */
export function exportSession(session: Session): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "灰烬渡口-推演分支.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
