import type { GroupDefinition } from '../schemas/intelligence.js';

export function closeDependencies(
  selected: string[],
  groups: GroupDefinition[],
): { ids: string[]; added: string[] } {
  const needs = new Map(groups.map(group => [group.id, group.needs]));
  const allow = new Set(groups.map(group => group.id));
  const chosen = new Set(selected.filter(id => allow.has(id)));
  const initial = new Set(chosen);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...chosen]) {
      for (const need of needs.get(id) ?? []) {
        if (!chosen.has(need)) {
          chosen.add(need);
          changed = true;
        }
      }
    }
  }
  const ids = groups.map(group => group.id).filter(id => chosen.has(id));
  const added = ids.filter(id => !initial.has(id));
  return { ids, added };
}

export function annotatePathHits(
  groups: GroupDefinition[],
  changedPaths: string[],
  match: (path: string, glob: string) => boolean,
): GroupDefinition[] {
  return groups.map(group => ({
    ...group,
    pathHit:
      group.paths.length > 0 &&
      changedPaths.some(path => group.paths.some(glob => match(path, glob))),
  }));
}
