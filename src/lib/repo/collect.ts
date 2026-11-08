import type { GitHubClient } from '@/lib/github/client';
import { gitHubContentSchema, gitHubTreeSchema } from '@/lib/github/types';
import { repoDetailSchema } from '@/lib/github/discovery-schemas';
import { mapWithConcurrency } from '@/lib/concurrency';
import { isSourceFile } from './graph';
import type { RepoAnalysisSnapshot, RepoFile } from './types';

/**
 * Files worth reading in full. Everything else is judged from its path alone,
 * because reading a file costs a request and most paths are self-describing.
 */
const KEY_FILES = [
  'package.json',
  '.nvmrc',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'Makefile',
  // Contributor guidance is written in Markdown, reStructuredText or plain text
  // depending on ecosystem; Python projects overwhelmingly use .rst.
  'CONTRIBUTING.md',
  'CONTRIBUTING.rst',
  'CONTRIBUTING.txt',
  'CONTRIBUTING',
  '.github/CONTRIBUTING.md',
  '.github/CONTRIBUTING.rst',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

/** CI workflows read per repo. Most projects have one or two that matter. */
const MAX_WORKFLOWS = 3;

/** Files fetched in parallel, bounded for the same reason repo scans are. */
const FILE_FETCH_CONCURRENCY = 5;

/**
 * Source files sampled to build the import graph. Each costs a request, so this
 * is a deliberate trade: enough files to show the shape of the architecture,
 * few enough that analysing a repo stays affordable. The graph reports how much
 * of the tree it actually saw.
 */
const SOURCE_SAMPLE_SIZE = 30;

/**
 * Pick the source files most likely to reveal architecture: shallow files in
 * source-ish directories, since those are the ones that wire modules together.
 * Deeply nested leaves mostly import their own neighbours.
 */
export function pickSourceSample(sourcePaths: string[], limit = SOURCE_SAMPLE_SIZE): string[] {
  const score = (path: string) => {
    const depth = path.split('/').length;
    const inSourceDir = /^(src|lib|app|pkg|cmd|internal|server|client)\//.test(path) ? 0 : 1;
    const isTest = /(^|\/)(tests?|spec|__tests__)\/|\.(test|spec)\./.test(path) ? 1 : 0;
    return [isTest, inSourceDir, depth] as const;
  };

  return [...sourcePaths]
    .sort((a, b) => {
      const [aTest, aSrc, aDepth] = score(a);
      const [bTest, bSrc, bDepth] = score(b);
      return aTest - bTest || aSrc - bSrc || aDepth - bDepth || a.localeCompare(b);
    })
    .slice(0, limit);
}

/**
 * Workflow filenames that most often contain the build and test commands a
 * contributor has to satisfy. Reading whichever three sorted first alphabetically
 * tends to pick up `publish.yaml` and miss `tests.yaml`, which is exactly
 * backwards.
 */
const WORKFLOW_PRIORITY = /(test|ci|check|build|lint|main|pull|verify)/i;

export function pickWorkflows(filePaths: string[]): string[] {
  const all = filePaths.filter((path) => /^\.github\/workflows\/.+\.ya?ml$/.test(path));
  const ranked = [...all].sort((a, b) => {
    const aPriority = WORKFLOW_PRIORITY.test(a) ? 0 : 1;
    const bPriority = WORKFLOW_PRIORITY.test(b) ? 0 : 1;
    return aPriority - bPriority || a.localeCompare(b);
  });
  return ranked.slice(0, MAX_WORKFLOWS);
}

export async function collectRepoAnalysis(
  fullName: string,
  client: GitHubClient,
): Promise<RepoAnalysisSnapshot | null> {
  const detail = await client.get(`/repos/${fullName}`, repoDetailSchema);
  if (!detail) return null;

  const tree = await client.get(
    `/repos/${fullName}/git/trees/${encodeURIComponent(detail.default_branch)}?recursive=1`,
    gitHubTreeSchema,
  );

  const filePaths = (tree?.tree ?? [])
    .filter((node) => node.type === 'blob')
    .map((node) => node.path);

  const workflows = pickWorkflows(filePaths);
  const sourcePaths = filePaths.filter(isSourceFile);

  // Only ask for files the tree already proved exist — a 404 costs the same as a hit.
  const wanted = [
    ...KEY_FILES.filter((path) => filePaths.includes(path)),
    ...workflows,
    ...pickSourceSample(sourcePaths),
  ];

  const fetched = await mapWithConcurrency(wanted, FILE_FETCH_CONCURRENCY, async (path) => {
    const file = await client.get(`/repos/${fullName}/contents/${path}`, gitHubContentSchema);
    if (!file || file.encoding !== 'base64') return null;
    return { path, content: Buffer.from(file.content, 'base64').toString('utf8') } as RepoFile;
  });

  return {
    fullName: detail.full_name,
    htmlUrl: detail.html_url,
    defaultBranch: detail.default_branch,
    description: detail.description,
    primaryLanguage: detail.language,
    filePaths,
    treeTruncated: tree?.truncated ?? false,
    sourcePaths,
    files: fetched.filter((file): file is RepoFile => file !== null),
  };
}
