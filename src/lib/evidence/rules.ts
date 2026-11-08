import type { SkillCategory } from './types';

/**
 * Detection rules map observed artefacts (file paths, manifest dependencies,
 * repo topics) onto skills. Rules are intentionally conservative: a rule only
 * fires on an artefact a reviewer would accept as proof.
 */
export type DetectionRule = {
  id: string;
  label: string;
  category: SkillCategory;
  /** File paths, relative to repo root, that prove the skill is in use. */
  paths?: RegExp[];
  /** Dependency names, matched case-insensitively against parsed manifests. */
  dependencies?: string[];
  /** Repo topics. Weakest signal — never sufficient on its own (see engine). */
  topics?: string[];
};

export const DETECTION_RULES: DetectionRule[] = [
  // --- Frameworks -------------------------------------------------------
  {
    id: 'react',
    label: 'React',
    category: 'framework',
    dependencies: ['react'],
    topics: ['react'],
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    category: 'framework',
    dependencies: ['next'],
    paths: [/^next\.config\.(js|mjs|ts)$/],
    topics: ['nextjs', 'next-js'],
  },
  {
    id: 'vue',
    label: 'Vue',
    category: 'framework',
    dependencies: ['vue'],
    paths: [/\.vue$/],
  },
  {
    id: 'svelte',
    label: 'Svelte',
    category: 'framework',
    dependencies: ['svelte'],
    paths: [/\.svelte$/],
  },
  {
    id: 'express',
    label: 'Express',
    category: 'framework',
    dependencies: ['express'],
  },
  {
    id: 'nestjs',
    label: 'NestJS',
    category: 'framework',
    dependencies: ['@nestjs/core'],
  },
  {
    id: 'django',
    label: 'Django',
    category: 'framework',
    dependencies: ['django'],
    paths: [/^manage\.py$/],
  },
  {
    id: 'flask',
    label: 'Flask',
    category: 'framework',
    dependencies: ['flask'],
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    category: 'framework',
    dependencies: ['fastapi'],
  },
  {
    id: 'tailwind',
    label: 'Tailwind CSS',
    category: 'framework',
    dependencies: ['tailwindcss'],
    paths: [/^tailwind\.config\.(js|cjs|mjs|ts)$/],
  },

  // --- Practices --------------------------------------------------------
  {
    id: 'automated-testing',
    label: 'Automated testing',
    category: 'practice',
    paths: [
      /(^|\/)(tests?|__tests__|spec)\//,
      /\.(test|spec)\.[jt]sx?$/,
      /_test\.go$/,
      /(^|\/)test_[^/]+\.py$/,
    ],
    dependencies: ['jest', 'vitest', 'mocha', 'pytest', '@playwright/test', 'cypress', 'testing-library'],
  },
  {
    id: 'ci-cd',
    label: 'CI/CD pipelines',
    category: 'practice',
    paths: [/^\.github\/workflows\/[^/]+\.ya?ml$/, /^\.gitlab-ci\.yml$/, /^\.circleci\//],
  },
  {
    id: 'database-modelling',
    label: 'Database modelling & migrations',
    category: 'practice',
    paths: [/(^|\/)migrations?\//, /\.sql$/, /^prisma\/schema\.prisma$/],
    dependencies: ['prisma', 'sequelize', 'typeorm', 'drizzle-orm', 'sqlalchemy', 'alembic'],
  },
  {
    id: 'api-design',
    label: 'HTTP API design',
    category: 'practice',
    paths: [/(^|\/)(routes|controllers)\//, /(^|\/)api\//, /openapi\.(ya?ml|json)$/, /swagger\.(ya?ml|json)$/],
  },
  {
    id: 'linting-formatting',
    label: 'Linting & formatting discipline',
    category: 'practice',
    paths: [/^\.eslintrc(\.|$)/, /^eslint\.config\.(js|cjs|mjs|ts)$/, /^\.prettierrc/, /^ruff\.toml$/, /^\.flake8$/],
  },
  {
    id: 'contributor-docs',
    label: 'Writing contributor documentation',
    category: 'practice',
    paths: [/^CONTRIBUTING\.md$/i, /^docs\//, /^ARCHITECTURE\.md$/i],
  },

  // --- Infrastructure ---------------------------------------------------
  {
    id: 'containerization',
    label: 'Containerization (Docker)',
    category: 'infrastructure',
    paths: [/^Dockerfile$/i, /(^|\/)Dockerfile$/, /^docker-compose\.ya?ml$/, /^compose\.ya?ml$/],
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    category: 'infrastructure',
    paths: [/^(k8s|kubernetes|charts|helm)\//],
  },
  {
    id: 'terraform',
    label: 'Terraform',
    category: 'infrastructure',
    paths: [/\.tf$/],
  },
];
