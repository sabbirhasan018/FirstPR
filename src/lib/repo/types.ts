import type { ImportGraph } from './graph';

/** A file read from the repository, used as evidence for the analysis. */
export type RepoFile = {
  path: string;
  content: string;
};

/**
 * Everything observed about a repository, before any interpretation.
 * As with the other engines, the analyzer is pure over this.
 */
export type RepoAnalysisSnapshot = {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  description: string | null;
  primaryLanguage: string | null;
  filePaths: string[];
  treeTruncated: boolean;
  /** Paths recognised as source code, used to scope the import graph. */
  sourcePaths: string[];
  files: RepoFile[];
};

export type Ecosystem = 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'java' | 'unknown';

/** Every derived claim points back at the file it came from. */
export type FileRef = {
  path: string;
  url: string;
  /** The exact line or fragment the claim rests on, when there is one. */
  excerpt?: string;
};

export type CommandKind = 'install' | 'build' | 'test' | 'lint' | 'dev' | 'typecheck';

export type RepoCommand = {
  kind: CommandKind;
  command: string;
  source: FileRef;
  /**
   * True when this came from CI configuration. CI is the ground truth for what
   * must pass before a pull request can merge, so it outranks a README.
   */
  fromCi: boolean;
};

export type DirectoryRole =
  | 'source'
  | 'tests'
  | 'docs'
  | 'config'
  | 'migrations'
  | 'ci'
  | 'examples'
  | 'other';

export type KeyDirectory = {
  path: string;
  fileCount: number;
  role: DirectoryRole;
};

export type SetupRequirement = {
  tool: string;
  /** Version constraint exactly as the repository states it. */
  version: string | null;
  source: FileRef;
};

export type ContributorRule = {
  id: string;
  label: string;
  detail: string;
  source: FileRef;
};

export type RepoAnalysis = {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  ecosystems: Ecosystem[];
  entryPoints: FileRef[];
  keyDirectories: KeyDirectory[];
  commands: RepoCommand[];
  setupRequirements: SetupRequirement[];
  contributorRules: ContributorRule[];
  importGraph: ImportGraph;
  /** Total files seen, so the reader can judge how complete this is. */
  fileCount: number;
  notes: string[];
};
