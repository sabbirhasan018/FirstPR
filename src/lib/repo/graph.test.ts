import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  extractImports,
  findCycles,
  isSourceFile,
  moduleOf,
  resolveRelative,
} from './graph';

describe('moduleOf', () => {
  it('collapses a path to two directory levels', () => {
    expect(moduleOf('src/lib/github/client.ts')).toBe('src/lib');
    expect(moduleOf('src/app/page.tsx')).toBe('src/app');
    expect(moduleOf('index.ts')).toBe('.');
  });
});

describe('isSourceFile', () => {
  it.each(['src/a.ts', 'src/a.tsx', 'a.py', 'cmd/main.go', 'src/lib.rs'])('accepts %s', (path) => {
    expect(isSourceFile(path)).toBe(true);
  });

  it.each(['node_modules/x/index.js', 'dist/a.js', 'README.md', '.venv/lib/a.py'])(
    'rejects %s',
    (path) => {
      expect(isSourceFile(path)).toBe(false);
    },
  );
});

describe('extractImports', () => {
  it('reads the common JavaScript and TypeScript forms', () => {
    const source = [
      "import a from './a';",
      "import { b } from '../b/index';",
      "export * from './c';",
      "const d = require('d');",
      "const e = await import('./e');",
      "import './side-effect';",
    ].join('\n');

    const found = extractImports(source);
    for (const specifier of ['./a', '../b/index', './c', 'd', './e', './side-effect']) {
      expect(found).toContain(specifier);
    }
  });

  it('reads Python imports', () => {
    const found = extractImports('from .models import User\nimport os.path\n');
    expect(found).toContain('.models');
    expect(found).toContain('os.path');
  });

  it('handles multi-line import statements', () => {
    const found = extractImports("import {\n  a,\n  b,\n} from './wide';");
    expect(found).toContain('./wide');
  });
});

describe('resolveRelative', () => {
  const known = new Set([
    'src/lib/github/client.ts',
    'src/lib/evidence/index.ts',
    'src/app/page.tsx',
    'pkg/mod/__init__.py',
  ]);

  it('resolves a sibling without an extension', () => {
    expect(resolveRelative('src/lib/github/collect.ts', './client', known)).toBe(
      'src/lib/github/client.ts',
    );
  });

  it('resolves a parent traversal to a directory index', () => {
    expect(resolveRelative('src/lib/github/client.ts', '../evidence', known)).toBe(
      'src/lib/evidence/index.ts',
    );
  });

  it('resolves a Python package init', () => {
    expect(resolveRelative('pkg/other.py', './mod', known)).toBe('pkg/mod/__init__.py');
  });

  it('returns null when nothing matches, rather than inventing a file', () => {
    expect(resolveRelative('src/a.ts', './nope', known)).toBeNull();
  });
});

describe('findCycles', () => {
  it('finds a simple two-module cycle', () => {
    const cycles = findCycles([
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'a', weight: 1 },
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['a', 'b']);
  });

  it('reports a loop once regardless of where it is entered', () => {
    const cycles = findCycles([
      { from: 'b', to: 'c', weight: 1 },
      { from: 'c', to: 'a', weight: 1 },
      { from: 'a', to: 'b', weight: 1 },
    ]);
    expect(cycles).toHaveLength(1);
  });

  it('finds nothing in an acyclic graph', () => {
    expect(
      findCycles([
        { from: 'a', to: 'b', weight: 1 },
        { from: 'b', to: 'c', weight: 1 },
      ]),
    ).toEqual([]);
  });
});

describe('buildImportGraph', () => {
  const sourcePaths = [
    'src/app/page.tsx',
    'src/lib/github/client.ts',
    'src/lib/github/collect.ts',
    'src/lib/evidence/engine.ts',
  ];

  const files = [
    { path: 'src/app/page.tsx', content: "import { get } from '../lib/github/client';" },
    {
      path: 'src/lib/github/collect.ts',
      content: "import { get } from './client';\nimport React from 'react';",
    },
    {
      path: 'src/lib/evidence/engine.ts',
      content: "import x from '../github/client';\nimport { z } from 'zod';",
    },
  ];

  it('builds module-level edges and ignores intra-module imports', () => {
    const graph = buildImportGraph(files, sourcePaths);

    // collect.ts -> client.ts is within src/lib, so it is not an edge.
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'src/app', to: 'src/lib' });
  });

  it('counts external packages separately from internal edges', () => {
    const graph = buildImportGraph(files, sourcePaths);
    const names = graph.externalDependencies.map((dependency) => dependency.name);

    expect(names).toContain('react');
    expect(names).toContain('zod');
  });

  it('reports how much of the tree it actually parsed', () => {
    const graph = buildImportGraph(files, sourcePaths);

    expect(graph.coverage).toEqual({ parsed: 3, total: 4 });
    expect(graph.notes.join(' ')).toContain('3 of 4 source files');
  });

  it('says so when there is nothing to graph', () => {
    const graph = buildImportGraph([], []);
    expect(graph.nodes).toEqual([]);
    expect(graph.notes.join(' ')).toContain('No source files');
  });

  it('is deterministic', () => {
    expect(buildImportGraph(files, sourcePaths)).toEqual(buildImportGraph(files, sourcePaths));
  });
});
