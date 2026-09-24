import type { AdapterContext, AdapterResult } from './types.js';

function hasScript(pkg: Record<string, unknown> | null, needle: RegExp): boolean {
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object') return false;
  return Object.values(scripts as Record<string, unknown>).some(
    value => typeof value === 'string' && needle.test(value),
  );
}

export function discoverJest(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = [];
  const testFileGlobs = ['**/*.{test,spec}.{js,jsx,ts,tsx}', '**/__tests__/**'];
  const groupHints = ['unit', 'jest'];
  let discovered = false;
  try {
    const configNames = [
      'jest.config.js',
      'jest.config.cjs',
      'jest.config.mjs',
      'jest.config.ts',
      'jest.config.json',
    ];
    for (const name of configNames) {
      const raw = ctx.readText(name);
      if (raw != null) {
        discovered = true;
        notes.push(`found ${name}`);
        break;
      }
    }
    if (ctx.packageJson?.jest && typeof ctx.packageJson.jest === 'object') {
      discovered = true;
      notes.push('package.json jest field');
    }
    if (hasScript(ctx.packageJson, /\bjest\b/)) {
      discovered = true;
      notes.push('jest script');
      commands.push('npm test');
    }
    const deps = {
      ...(typeof ctx.packageJson?.dependencies === 'object' ? ctx.packageJson.dependencies : {}),
      ...(typeof ctx.packageJson?.devDependencies === 'object' ? ctx.packageJson.devDependencies : {}),
    } as Record<string, unknown>;
    if (typeof deps.jest === 'string') {
      discovered = true;
      notes.push('jest dependency');
    }
  } catch (error) {
    return {
      framework: 'jest',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'jest adapter failed',
    };
  }
  return { framework: 'jest', discovered, groupHints, testFileGlobs, commands, notes };
}
