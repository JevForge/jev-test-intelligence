import { readBounded } from './config.js';
import { normalizeRepoPath } from '../utils/paths.js';

export interface CoverageGap {
  path: string;
  pct: number | null;
}

export interface CoverageSummary {
  available: boolean;
  gaps: CoverageGap[];
  threshold: number;
  filesConsidered: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pctFromFile(entry: unknown): number | null {
  const record = asRecord(entry);
  if (!record) return null;
  if (typeof record.pct === 'number') return record.pct > 1 ? record.pct / 100 : record.pct;
  const lines = asRecord(record.lines);
  if (lines && typeof lines.pct === 'number') {
    return lines.pct > 1 ? lines.pct / 100 : lines.pct;
  }
  if (typeof record.covered === 'number' && typeof record.total === 'number' && record.total > 0) {
    return record.covered / record.total;
  }
  return null;
}

function parseLcov(raw: string): Record<string, { covered: number; total: number }> {
  const files: Record<string, { covered: number; total: number }> = {};
  let file: string | undefined;
  let total = 0;
  let covered = 0;
  const commit = () => {
    if (file) files[file] = { covered, total };
    file = undefined;
    total = 0;
    covered = 0;
  };
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      commit();
      const sourceFile = line.slice(3).trim();
      file = normalizeRepoPath(sourceFile) ?? sourceFile.replaceAll('\\', '/');
    } else if (line.startsWith('LF:')) {
      const value = Number(line.slice(3));
      if (Number.isInteger(value) && value >= 0) total = value;
    } else if (line.startsWith('LH:')) {
      const value = Number(line.slice(3));
      if (Number.isInteger(value) && value >= 0) covered = value;
    } else if (line === 'end_of_record') {
      commit();
    }
  }
  commit();
  return files;
}

export function parseCoverageThreshold(value: string | undefined, fallback = 0.8): number {
  if (value == null || value.trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error('coverage_threshold must be between 0 and 1');
  }
  return number;
}

export function loadCoverageSummary(
  workspace: string,
  relativePath: string | undefined,
  changedPaths: string[],
  threshold: number,
): CoverageSummary {
  if (!relativePath?.trim()) {
    return { available: false, gaps: [], threshold, filesConsidered: 0 };
  }
  const raw = readBounded(workspace, relativePath.trim());
  if (raw == null) {
    return { available: false, gaps: [], threshold, filesConsidered: 0 };
  }
  const looksLikeLcov = /(^|\r?\n)SF:/.test(raw) || /\.(?:info|lcov)$/i.test(relativePath);
  let fileMap: Record<string, unknown> | null;
  if (looksLikeLcov) {
    fileMap = parseLcov(raw);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Invalid JSON in ${relativePath}`);
    }
    const root = asRecord(parsed);
    if (!root) {
      return { available: false, gaps: [], threshold, filesConsidered: 0 };
    }
    fileMap =
      asRecord(root.files) ??
      asRecord(root.coverage) ??
      (Array.isArray(root) ? null : root);
  }

  const gaps: CoverageGap[] = [];
  let filesConsidered = 0;
  for (const path of changedPaths.slice(0, 200)) {
    const normalized = normalizeRepoPath(path) ?? path;
    let entry: unknown;
    if (fileMap && normalized in fileMap) entry = fileMap[normalized];
    else if (fileMap) {
      const key = Object.keys(fileMap).find(
        candidate =>
          candidate === normalized ||
          candidate.endsWith(`/${normalized}`) ||
          normalized.endsWith(`/${candidate}`),
      );
      if (key) entry = fileMap[key];
    }
    filesConsidered += 1;
    if (entry == null) {
      gaps.push({ path: normalized, pct: null });
      continue;
    }
    const pct = pctFromFile(entry);
    if (pct == null || pct < threshold) {
      gaps.push({ path: normalized, pct });
    }
  }

  return {
    available: true,
    gaps: gaps.slice(0, 100),
    threshold,
    filesConsidered,
  };
}
