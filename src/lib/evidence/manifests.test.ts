import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifests';

const names = (path: string, content: string) =>
  parseManifest({ path, content }).map((dep) => dep.name);

describe('parseManifest', () => {
  it('reads all dependency sections of a package.json', () => {
    const content = JSON.stringify({
      dependencies: { react: '19' },
      devDependencies: { vitest: '2' },
      peerDependencies: { typescript: '5' },
      scripts: { build: 'next build' },
    });
    expect(names('package.json', content).sort()).toEqual(['react', 'typescript', 'vitest']);
  });

  it('returns nothing for malformed JSON instead of throwing', () => {
    expect(names('package.json', '{ not json')).toEqual([]);
  });

  it('strips version specifiers and comments from requirements.txt', () => {
    const content = ['# comment', 'Django>=4.2', 'fastapi==0.110.0', '', '-r other.txt', 'pytest'].join(
      '\n',
    );
    expect(names('requirements.txt', content)).toEqual(['django', 'fastapi', 'pytest']);
  });

  it('reads module paths from go.mod', () => {
    const content = ['module example.com/app', '', 'require (', '\tgithub.com/gin-gonic/gin v1.9.1', ')'].join(
      '\n',
    );
    expect(names('go.mod', content)).toEqual(['github.com/gin-gonic/gin']);
  });

  it('deduplicates and lowercases', () => {
    const content = JSON.stringify({ dependencies: { React: '19' }, devDependencies: { react: '19' } });
    expect(names('package.json', content)).toEqual(['react']);
  });

  it('ignores manifest kinds it does not understand', () => {
    expect(names('Gemfile', 'gem "rails"')).toEqual([]);
  });
});
