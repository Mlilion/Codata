import type { TraceSpan } from '@/types/execution-trace';

/** Default only newly seen call groups to closed; never undo a user's choice. */
export function defaultCollapsedCalls(
  spans: TraceSpan[], collapsed: string[], known: Set<string>, restoring = false,
): string[] {
  const parents = new Set(spans.map(s => s.parentId));
  const next = new Set(collapsed);
  for (const span of spans) {
    if ((span.kind !== 'model' && span.kind !== 'tool') || !parents.has(span.id)) continue;
    if (!known.has(span.id) && !restoring) next.add(span.id);
    known.add(span.id);
  }
  return [...next];
}

/** Cross-view navigation opens only the path to the selected span. */
export function expandSpanAncestors(spans: TraceSpan[], collapsed: string[], selected: string | null): string[] {
  const byId = new Map(spans.map(s => [s.id, s]));
  const ancestors = new Set<string>();
  let parent = selected ? byId.get(selected)?.parentId : null;
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = byId.get(parent)?.parentId;
  }
  return collapsed.filter(id => !ancestors.has(id));
}
