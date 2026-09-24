import type { FrameworkId } from '../schemas/enums.js';

export interface AdapterResult {
  framework: FrameworkId;
  discovered: boolean;
  groupHints: string[];
  testFileGlobs: string[];
  commands: string[];
  notes: string[];
  parseError?: string;
}

export interface AdapterContext {
  workspace: string;
  readText: (relativePath: string) => string | null;
  listNames: (relativeDir: string) => string[];
  packageJson: Record<string, unknown> | null;
}
