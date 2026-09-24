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

interface GithubRun {
  id?: number;
  head_branch?: string | null;
  conclusion?: string | null;
}

interface GithubJob {
  name?: string;
  conclusion?: string | null;
}

export function parseHistoryGroupIdMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('history_group_id_map is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('history_group_id_map must be a JSON object of name→id');
  }
  const out: Record<string, string> = {};
  for (const [name, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) {
      throw new Error(`history_group_id_map has invalid group id for ${name}`);
    }
    if (!name || name.length > 128) throw new Error('history_group_id_map has an invalid job name key');
    out[name] = id;
  }
  return out;
}

export function resolveFailedGroupIds(
  jobs: GithubJob[],
  allowlist: Set<string>,
  nameToId: Record<string, string>,
): string[] {
  const failed: string[] = [];
  for (const job of jobs) {
    if (job.conclusion !== 'failure' && job.conclusion !== 'timed_out') continue;
    const candidates = [
      typeof job.name === 'string' ? job.name : null,
      typeof job.name === 'string' ? nameToId[job.name] : null,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    let chosen: string | null = null;
    for (const candidate of candidates) {
      if (allowlist.has(candidate) && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      const raw = typeof job.name === 'string' ? job.name : '';
      if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw) && allowlist.has(raw)) chosen = raw;
    }
    if (chosen) failed.push(chosen);
  }
  return [...new Set(failed)].slice(0, 64);
}

async function githubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'jev-test-intelligence',
        'x-github-api-version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, body: null };
    return { ok: true, status: response.status, body: (await response.json()) as unknown };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchActionHistory(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  lookback: number;
  timeoutMs: number;
  allowlist?: string[];
  nameToId?: Record<string, string>;
}): Promise<HistoryRun[]> {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  const lookback = Math.min(20, Math.max(1, input.lookback));
  const branch = safeBranch(input.branch);
  const allow = new Set(input.allowlist ?? []);
  const nameToId = input.nameToId ?? {};
  const query = new URLSearchParams({ per_page: String(lookback) });
  if (branch) query.set('branch', branch);
  const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?${query.toString()}`;
  const listed = await githubJson(input.fetchImpl, input.token, runsUrl, input.timeoutMs);
  if (!listed.ok) throw new Error(`GitHub Actions history request failed with HTTP ${listed.status}`);
  const runs = (listed.body as { workflow_runs?: GithubRun[] } | null)?.workflow_runs ?? [];
  const history: HistoryRun[] = [];
  for (const run of runs.slice(0, lookback)) {
    if (!run.id || (run.conclusion !== 'failure' && run.conclusion !== 'timed_out')) continue;
    const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`;
    const jobsResponse = await githubJson(input.fetchImpl, input.token, jobsUrl, input.timeoutMs);
    if (!jobsResponse.ok) continue;
    const jobs = (jobsResponse.body as { jobs?: GithubJob[] } | null)?.jobs ?? [];
    const failed =
      allow.size > 0
        ? resolveFailedGroupIds(jobs, allow, nameToId)
        : jobs
            .filter(job => (job.conclusion === 'failure' || job.conclusion === 'timed_out') && typeof job.name === 'string')
            .map(job => job.name as string)
            .filter(name => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name));
    history.push({
      head_branch: typeof run.head_branch === 'string' ? run.head_branch : undefined,
      conclusion: run.conclusion === 'timed_out' ? 'timed_out' : 'failure',
      failed_groups: [...new Set(failed)].slice(0, 64),
    });
  }
  return history;
}
