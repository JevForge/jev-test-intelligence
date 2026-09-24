import type { ComponentMap, GroupDefinition, HistoryRun } from '../schemas/intelligence.js';
import { anyPathMatch } from '../utils/globs.js';

export interface HistorySummary {
  enabled: boolean;
  available: boolean;
  failedGroupCounts: Record<string, number>;
  rerunIds: string[];
}

export function emptyHistory(): HistorySummary {
  return { enabled: false, available: false, failedGroupCounts: {}, rerunIds: [] };
}

export function summarizeHistory(
  runs: HistoryRun[],
  groups: GroupDefinition[],
  lookback: number,
  branch?: string,
): HistorySummary {
  const allow = new Set(groups.map(group => group.id));
  const rerunEligible = new Set(
    groups.filter(group => group.rerunOnRecentFailure).map(group => group.id),
  );
  const failedGroupCounts: Record<string, number> = {};
  const sliced = runs
    .filter(run => !branch || !run.head_branch || run.head_branch === branch)
    .slice(0, lookback);
  for (const run of sliced) {
    for (const id of run.failed_groups) {
      if (!allow.has(id)) continue;
      failedGroupCounts[id] = (failedGroupCounts[id] ?? 0) + 1;
    }
  }
  const rerunIds = Object.keys(failedGroupCounts)
    .filter(id => rerunEligible.has(id))
    .sort((a, b) => (failedGroupCounts[b] ?? 0) - (failedGroupCounts[a] ?? 0));
  return {
    enabled: true,
    available: true,
    failedGroupCounts,
    rerunIds,
  };
}

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,256}$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-fA-F]{7,40}$/;

export function safeBranch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const branch = value.trim();
  if (!branch || branch.startsWith('-') || branch.includes('..') || !BRANCH_PATTERN.test(branch)) {
    return undefined;
  }
  return branch;
}

export function assertGithubName(value: string, label: string): string {
  if (!SAFE_NAME.test(value)) throw new Error(`Invalid GitHub ${label}`);
  return value;
}

export function assertSha(value: string): string | null {
  if (/^0+$/.test(value)) return null;
  return SHA.test(value) ? value : null;
}

export interface ComponentEvidence {
  affectedComponents: string[];
  mappedGroupIds: string[];
}

export function buildComponentEvidence(
  changedPaths: string[],
  components: ComponentMap[],
): ComponentEvidence {
  const affected: string[] = [];
  const mapped = new Set<string>();
  for (const component of components) {
    if (!anyPathMatch(changedPaths, component.paths)) continue;
    affected.push(component.name);
    for (const groupId of component.groups) mapped.add(groupId);
  }
  return {
    affectedComponents: affected.slice(0, 100),
    mappedGroupIds: [...mapped],
  };
}

export function annotateComponentHits(
  groups: GroupDefinition[],
  mappedGroupIds: string[],
): GroupDefinition[] {
  const mapped = new Set(mappedGroupIds);
  return groups.map(group => ({
    ...group,
    componentHit: mapped.has(group.id),
  }));
}
