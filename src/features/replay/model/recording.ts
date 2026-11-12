import type { Battle, EventKind, Point, Session } from "../../../shared/types";
import { clone } from "../../../shared/document";
export function record(
  s: Session,
  before: Battle,
  kind: EventKind,
  label: string,
  path: Point[] = [],
) {
  s.events.push({
    id: s.events.length + 1,
    kind,
    actor: before.active,
    label,
    path: clone(path),
    before: clone(before),
    after: clone(s.live),
  });
}
