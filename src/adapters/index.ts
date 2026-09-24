import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMEWORKS, type FrameworkId } from '../schemas/enums.js';
import { resolveInside } from '../utils/paths.js';
import { discoverCypress } from './cypress.js';
import { discoverJest } from './jest.js';
import { discoverJunit } from './junit.js';
import { discoverPlaywright } from './playwright.js';
import { discoverPytest } from './pytest.js';
import type { AdapterContext, AdapterResult } from './types.js';
import { discoverVitest } from './vitest.js';

const MAX_BYTES = 256_000;

function readText(workspace: string, relativePath: string): string | null {
  try {
    const full = resolveInside(workspace, relativePath);
    if (!existsSync(full)) return null;
    if (statSync(full).size > MAX_BYTES) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function listNames(workspace: string, relativeDir: string): string[] {
  try {
    const full = resolveInside(workspace, relativeDir);
    if (!existsSync(full) || !statSync(full).isDirectory()) return [];
    return readdirSync(full).slice(0, 200);
  } catch {
    return [];
  }
}

function loadPackageJson(workspace: string): Record<string, unknown> | null {
  const raw = readText(workspace, 'package.json');
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseFrameworksInput(raw: string | undefined): FrameworkId[] {
  if (raw == null || raw.trim() === '') return [...FRAMEWORKS];
  const parts = raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
  const out: FrameworkId[] = [];
  for (const part of parts) {
    if (!(FRAMEWORKS as readonly string[]).includes(part)) {
      throw new Error(`Unsupported framework: ${part}`);
    }
    out.push(part as FrameworkId);
  }
  return out.length > 0 ? out : [...FRAMEWORKS];
}

export function discoverFrameworks(
  workspace: string,
  enabled: FrameworkId[],
): { results: AdapterResult[]; detected: FrameworkId[]; parseErrors: string[] } {
  const ctx: AdapterContext = {
    workspace,
    readText: relative => readText(workspace, relative),
    listNames: relative => listNames(workspace, relative),
    packageJson: loadPackageJson(workspace),
  };
  const runners: Record<FrameworkId, (context: AdapterContext) => AdapterResult> = {
    jest: discoverJest,
    vitest: discoverVitest,
    pytest: discoverPytest,
    junit: discoverJunit,
    playwright: discoverPlaywright,
    cypress: discoverCypress,
  };
  const results: AdapterResult[] = [];
  const detected: FrameworkId[] = [];
  const parseErrors: string[] = [];
  for (const id of enabled) {
    const result = runners[id](ctx);
    results.push(result);
    if (result.discovered) detected.push(id);
    if (result.parseError) parseErrors.push(`${id}: ${result.parseError}`);
  }
  return { results, detected, parseErrors };
}

export function sanitizeAdapterInventory(results: AdapterResult[]): Array<{
  framework: FrameworkId;
  discovered: boolean;
  group_hints: string[];
  test_file_globs: string[];
}> {
  return results
    .filter(result => result.discovered)
    .map(result => ({
      framework: result.framework,
      discovered: true,
      group_hints: result.groupHints.slice(0, 8),
      test_file_globs: result.testFileGlobs.slice(0, 10),
    }));
}

export function workspaceRootHint(workspace: string): string {
  return join(workspace);
}
