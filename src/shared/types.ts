export type Terrain = "plain" | "forest" | "water" | "ridge" | "wall";
export type Profession = "guard" | "ranger" | "mage" | "medic";
export interface Point {
  x: number;
  y: number;
}
export interface Tile extends Point {
  terrain: Terrain;
}
export interface Status {
  kind: "slow" | "burn" | "guard";
  turns: number;
}
export interface Unit extends Point {
  id: string;
  name: string;
  job: Profession;
  team: "azure" | "ember";
  hp: number;
  maxHp: number;
  power: number;
  armor: number;
  speed: number;
  move: number;
  statuses: Status[];
  moved: boolean;
  acted: boolean;
}
export interface Battle {
  tiles: Tile[];
  units: Unit[];
  round: number;
  queue: string[];
  active: string;
  ended: string | null;
}
export type EventKind = "move" | "skill" | "wait" | "terrain";
export interface BattleEvent {
  id: number;
  kind: EventKind;
  actor: string;
  label: string;
  path: Point[];
  before: Battle;
  after: Battle;
}
export interface Session {
  initial: Battle;
  live: Battle;
  events: BattleEvent[];
}
/**
 * 一条推演分支的元数据。
 * - root 分支保存完整事件链；其余分支只保存从分叉点之后的自有事件，
 *   前缀通过 parentId / point 共享父分支的不可变历史。
 * - point: 分叉时在父分支时间线上的全局步数（事件条数）。
 */
export interface BranchMeta {
  id: string;
  name: string;
  parentId: string | null;
  point: number;
  createdAt: number;
}
/**
 * 分支存档：会话数据与元数据分离。
 * meta 顺序保持为插入顺序，root 始终是第一项。
 */
export interface BranchStore {
  version: 1;
  currentId: string;
  meta: Record<string, BranchMeta>;
  order: string[];
  sessions: Record<string, Session>;
}
export interface Skill {
  id: string;
  name: string;
  range: number;
  power: number;
  target: "enemy" | "ally" | "self";
  status?: Status["kind"];
  description: string;
}
