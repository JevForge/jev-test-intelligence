import type { AdapterContext, AdapterResult } from './types.js';

export function discoverPytest(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = ['pytest'];
  const testFileGlobs = ['**/test_*.py', '**/*_test.py', '**/tests/**/*.py'];
  const groupHints = ['unit', 'pytest', 'python'];
  let discovered = false;
  try {
    if (ctx.readText('pytest.ini') != null) {
      discovered = true;
      notes.push('pytest.ini');
    }
    if (ctx.readText('setup.cfg')?.includes('[tool:pytest]') || ctx.readText('setup.cfg')?.includes('[pytest]')) {
      discovered = true;
      notes.push('setup.cfg pytest');
    }
    const pyproject = ctx.readText('pyproject.toml');
    if (pyproject && (/\[tool\.pytest/.test(pyproject) || /pytest/.test(pyproject))) {
      discovered = true;
      notes.push('pyproject.toml');
    }
    if (ctx.listNames('tests').length > 0 || ctx.listNames('test').length > 0) {
      discovered = true;
      notes.push('tests directory');
    }
  } catch (error) {
    return {
      framework: 'pytest',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'pytest adapter failed',
    };
  }
  return { framework: 'pytest', discovered, groupHints, testFileGlobs, commands, notes };
}
