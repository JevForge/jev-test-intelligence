import type { AdapterContext, AdapterResult } from './types.js';

export function discoverPlaywright(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = [];
  const testFileGlobs = ['**/*.spec.ts', '**/e2e/**/*.ts', '**/tests/**/*.spec.ts'];
  const groupHints = ['e2e', 'playwright'];
  let discovered = false;
  try {
    for (const name of [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
    ]) {
      if (ctx.readText(name) != null) {
        discovered = true;
        notes.push(`found ${name}`);
        commands.push('npx playwright test');
        break;
      }
    }
    const deps = {
      ...(typeof ctx.packageJson?.dependencies === 'object' ? ctx.packageJson.dependencies : {}),
      ...(typeof ctx.packageJson?.devDependencies === 'object' ? ctx.packageJson.devDependencies : {}),
    } as Record<string, unknown>;
    if (typeof deps['@playwright/test'] === 'string') {
      discovered = true;
      notes.push('@playwright/test');
    }
  } catch (error) {
    return {
      framework: 'playwright',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'playwright adapter failed',
    };
  }
  return { framework: 'playwright', discovered, groupHints, testFileGlobs, commands, notes };
}
