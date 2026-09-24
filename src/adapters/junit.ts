import type { AdapterContext, AdapterResult } from './types.js';

export function discoverJunit(ctx: AdapterContext): AdapterResult {
  const notes: string[] = [];
  const commands: string[] = [];
  const testFileGlobs = ['**/src/test/java/**/*Test.java', '**/src/test/kotlin/**/*Test.kt'];
  const groupHints = ['unit', 'junit', 'java'];
  let discovered = false;
  try {
    const pom = ctx.readText('pom.xml');
    if (pom) {
      if (/maven-surefire-plugin|maven-failsafe-plugin|junit/i.test(pom)) {
        discovered = true;
        notes.push('pom.xml junit/surefire');
        commands.push('mvn test');
      }
    }
    const gradle =
      ctx.readText('build.gradle') ??
      ctx.readText('build.gradle.kts') ??
      ctx.readText('build.gradle.kts');
    if (gradle && (/junit|useJUnitPlatform|test\s*\{/.test(gradle))) {
      discovered = true;
      notes.push('gradle test');
      commands.push('gradle test');
    }
  } catch (error) {
    return {
      framework: 'junit',
      discovered: false,
      groupHints: [],
      testFileGlobs: [],
      commands: [],
      notes: [],
      parseError: error instanceof Error ? error.message : 'junit adapter failed',
    };
  }
  return { framework: 'junit', discovered, groupHints, testFileGlobs, commands, notes };
}
