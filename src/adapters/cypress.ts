import type { AdapterContext, AdapterResult } from './types.js';

export function discoverCypress(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = [];
  const testFileGlobs = ['**/cypress/e2e/**/*.{js,ts}', '**/cypress/integration/**/*.{js,ts}'];
  const groupHints = ['e2e', 'cypress'];
  let discovered = false;
  try {
    for (const name of ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs', 'cypress.json']) {
      if (ctx.readText(name) != null) {
        discovered = true;
        notes.push(`found ${name}`);
        commands.push('npx cypress run');
        break;
      }
    }
    if (ctx.listNames('cypress').length > 0) {
      discovered = true;
      notes.push('cypress directory');
    }
    const deps = {
      ...(typeof ctx.packageJson?.dependencies === 'object' ? ctx.packageJson.dependencies : {}),
      ...(typeof ctx.packageJson?.devDependencies === 'object' ? ctx.packageJson.devDependencies : {}),
    } as Record<string, unknown>;
    if (typeof deps.cypress === 'string') {
      discovered = true;
      notes.push('cypress dependency');
    }
  } catch (error) {
    return {
      framework: 'cypress',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'cypress adapter failed',
    };
  }
  return { framework: 'cypress', discovered, groupHints, testFileGlobs, commands, notes };
}
