import { normalizeRepoPath } from '../utils/paths.js';
import { assertGithubName } from './history.js';

export async function listPullRequestFiles(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
  timeoutMs: number;
}): Promise<string[]> {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  if (!Number.isInteger(input.pullNumber) || input.pullNumber <= 0) return [];
  const out: string[] = [];
  for (let page = 1; page <= 4; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetchImpl(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${input.pullNumber}/files?per_page=100&page=${page}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${input.token}`,
            'user-agent': 'jev-test-intelligence',
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`list PR files failed with HTTP ${response.status}`);
      const body = (await response.json()) as Array<{ filename?: string }>;
      if (!Array.isArray(body) || body.length === 0) break;
      for (const file of body) {
        if (typeof file.filename === 'string') out.push(file.filename);
      }
      if (body.length < 100) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return out.slice(0, 400);
}

export async function listCompareFiles(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  base: string;
  head: string;
  timeoutMs: number;
}): Promise<string[]> {
  if (!input.base || !input.head || /^0+$/.test(input.base)) return [];
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${input.token}`,
          'user-agent': 'jev-test-intelligence',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`compare failed with HTTP ${response.status}`);
    const body = (await response.json()) as { files?: Array<{ filename?: string }> };
    return (body.files ?? [])
      .map(file => file.filename)
      .filter((name): name is string => typeof name === 'string')
      .slice(0, 400);
  } finally {
    clearTimeout(timer);
  }
}

export function pathsFromPushPayload(payload: Record<string, unknown>): {
  paths: string[];
  possiblyTruncated: boolean;
} {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const paths = new Set<string>();
  for (const commit of commits) {
    if (!commit || typeof commit !== 'object') continue;
    const record = commit as { added?: unknown; modified?: unknown; removed?: unknown };
    for (const key of ['added', 'modified', 'removed'] as const) {
      const list = record[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === 'string') {
          const normalized = normalizeRepoPath(item);
          if (normalized) paths.add(normalized);
        }
      }
    }
  }
  return {
    paths: [...paths].slice(0, 400),
    possiblyTruncated: commits.length >= 20 || paths.size >= 400,
  };
}
