import type { AdapterContext, AdapterResult } from './types.js';

export function discoverVitest(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = [];
  const testFileGlobs = ['**/*.{test,spec}.{js,ts,tsx}', '**/__tests__/**'];
  const groupHints = ['unit', 'vitest'];
  let discovered = false;
  try {
    for (const name of [
      'vitest.config.ts',
      'vitest.config.js',
      'vitest.config.mjs',
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mjs',
    ]) {
      const raw = ctx.readText(name);
      if (raw == null) continue;
      if (name.startsWith('vitest') || /\btest\s*:/.test(raw) || /\bvitest\b/.test(raw)) {
        discovered = true;
        notes.push(`found ${name}`);
        break;
      }
    }
    const scripts = ctx.packageJson?.scripts;
    if (scripts && typeof scripts === 'object') {
      for (const [key, value] of Object.entries(scripts as Record<string, unknown>)) {
        if (typeof value === 'string' && /\bvitest\b/.test(value)) {
          discovered = true;
          notes.push(`script ${key}`);
          commands.push(`npm run ${key}`);
        }
      }
    }
    const deps = {
      ...(typeof ctx.packageJson?.dependencies === 'object' ? ctx.packageJson.dependencies : {}),
      ...(typeof ctx.packageJson?.devDependencies === 'object' ? ctx.packageJson.devDependencies : {}),
    } as Record<string, unknown>;
    if (typeof deps.vitest === 'string') {
      discovered = true;
      notes.push('vitest dependency');
    }
  } catch (error) {
    return {
      framework: 'vitest',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'vitest adapter failed',
    };
  }
  return { framework: 'vitest', discovered, groupHints, testFileGlobs, commands, notes };
}
