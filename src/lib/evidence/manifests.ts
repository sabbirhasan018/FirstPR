import type { Manifest } from '@/lib/github/types';

/** Manifest files worth fetching, in priority order. */
export const MANIFEST_PATHS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
] as const;

export type ParsedDependency = {
  name: string;
  manifestPath: string;
};

const PYTHON_REQUIREMENT = /^\s*([A-Za-z0-9._-]+)\s*(?:[<>=!~[;].*)?$/;

/**
 * Extract dependency names from a manifest. Unparseable manifests yield no
 * dependencies rather than throwing — a malformed package.json in someone
 * else's repo must not break the whole import.
 */
export function parseManifest(manifest: Manifest): ParsedDependency[] {
  const names = extractNames(manifest);
  const unique = Array.from(new Set(names.map((n) => n.toLowerCase()).filter(Boolean)));
  return unique.map((name) => ({ name, manifestPath: manifest.path }));
}

function extractNames({ path, content }: Manifest): string[] {
  const file = path.split('/').pop() ?? path;

  if (file === 'package.json') {
    try {
      const json = JSON.parse(content) as Record<string, unknown>;
      return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => {
        const section = json[key];
        return section && typeof section === 'object' ? Object.keys(section) : [];
      });
    } catch {
      return [];
    }
  }

  if (file === 'requirements.txt') {
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('-'))
      .map((line) => PYTHON_REQUIREMENT.exec(line)?.[1] ?? '')
      .filter(Boolean);
  }

  if (file === 'pyproject.toml' || file === 'Cargo.toml') {
    // Dependency tables list one requirement per line as `name = ...` or `"name>=x"`.
    return content
      .split(/\r?\n/)
      .map((line) => /^\s*"?([A-Za-z0-9._-]+)"?\s*(=|,|$)/.exec(line.trim())?.[1] ?? '')
      .filter(Boolean);
  }

  if (file === 'go.mod') {
    return content
      .split(/\r?\n/)
      .map((line) => /^\s*([a-z0-9._~-]+(?:\.[a-z]{2,})?\/[^\s]+)\s+v/.exec(line)?.[1] ?? '')
      .filter(Boolean);
  }

  return [];
}
