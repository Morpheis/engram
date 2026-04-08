import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getHeadCommit,
  getDiffFiles,
  getDiffStat,
  getCommitAge,
  getCommitCount,
  commitExists,
  abbreviateCommit,
} from '../../src/utils/git.js';

let tmpDir: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: tmpDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' },
  }).trim();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mm-git-test-'));
  git('init');
  git('commit --allow-empty -m "initial"');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getHeadCommit', () => {
  it('returns the current HEAD commit hash', () => {
    const head = getHeadCommit(tmpDir);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns the correct commit after a new commit', () => {
    const first = getHeadCommit(tmpDir);
    writeFileSync(join(tmpDir, 'file.txt'), 'hello');
    git('add .');
    git('commit -m "add file"');
    const second = getHeadCommit(tmpDir);
    expect(second).toMatch(/^[0-9a-f]{40}$/);
    expect(second).not.toBe(first);
  });

  it('throws for a non-git directory', () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'mm-nongit-'));
    try {
      expect(() => getHeadCommit(nonGit)).toThrow();
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe('getDiffFiles', () => {
  it('returns empty for no changes', () => {
    const head = getHeadCommit(tmpDir);
    const files = getDiffFiles(tmpDir, head);
    expect(files).toEqual([]);
  });

  it('detects added files', () => {
    const anchor = getHeadCommit(tmpDir);
    writeFileSync(join(tmpDir, 'new.ts'), 'content');
    git('add .');
    git('commit -m "add new.ts"');
    const files = getDiffFiles(tmpDir, anchor);
    expect(files).toEqual([{ status: 'A', path: 'new.ts' }]);
  });

  it('detects modified files', () => {
    writeFileSync(join(tmpDir, 'file.ts'), 'v1');
    git('add .');
    git('commit -m "add file"');
    const anchor = getHeadCommit(tmpDir);
    writeFileSync(join(tmpDir, 'file.ts'), 'v2');
    git('add .');
    git('commit -m "modify file"');
    const files = getDiffFiles(tmpDir, anchor);
    expect(files).toEqual([{ status: 'M', path: 'file.ts' }]);
  });

  it('detects deleted files', () => {
    writeFileSync(join(tmpDir, 'file.ts'), 'content');
    git('add .');
    git('commit -m "add"');
    const anchor = getHeadCommit(tmpDir);
    git('rm file.ts');
    git('commit -m "delete"');
    const files = getDiffFiles(tmpDir, anchor);
    expect(files).toEqual([{ status: 'D', path: 'file.ts' }]);
  });

  it('detects renamed files', () => {
    writeFileSync(join(tmpDir, 'old.ts'), 'content for rename detection');
    git('add .');
    git('commit -m "add"');
    const anchor = getHeadCommit(tmpDir);
    git('mv old.ts new.ts');
    git('commit -m "rename"');
    const files = getDiffFiles(tmpDir, anchor);
    expect(files.length).toBe(1);
    expect(files[0].status).toBe('R');
    expect(files[0].path).toBe('new.ts');
    expect(files[0].oldPath).toBe('old.ts');
  });

  it('handles null anchor (lists all files as added)', () => {
    writeFileSync(join(tmpDir, 'a.ts'), 'a');
    writeFileSync(join(tmpDir, 'b.ts'), 'b');
    git('add .');
    git('commit -m "add files"');
    const files = getDiffFiles(tmpDir, null);
    expect(files.length).toBe(2);
    expect(files.every(f => f.status === 'A')).toBe(true);
    expect(files.map(f => f.path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('handles multiple changes', () => {
    writeFileSync(join(tmpDir, 'keep.ts'), 'keep');
    writeFileSync(join(tmpDir, 'change.ts'), 'v1');
    writeFileSync(join(tmpDir, 'remove.ts'), 'gone');
    git('add .');
    git('commit -m "initial files"');
    const anchor = getHeadCommit(tmpDir);

    writeFileSync(join(tmpDir, 'change.ts'), 'v2');
    writeFileSync(join(tmpDir, 'added.ts'), 'new');
    git('rm remove.ts');
    git('add .');
    git('commit -m "various changes"');

    const files = getDiffFiles(tmpDir, anchor);
    const statuses = new Map(files.map(f => [f.path, f.status]));
    expect(statuses.get('added.ts')).toBe('A');
    expect(statuses.get('change.ts')).toBe('M');
    expect(statuses.get('remove.ts')).toBe('D');
    expect(statuses.has('keep.ts')).toBe(false);
  });

  it('handles subdirectories', () => {
    const anchor = getHeadCommit(tmpDir);
    mkdirSync(join(tmpDir, 'src', 'hooks'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'hooks', 'useFleet.ts'), 'export function useFleet() {}');
    git('add .');
    git('commit -m "add nested file"');
    const files = getDiffFiles(tmpDir, anchor);
    expect(files).toEqual([{ status: 'A', path: 'src/hooks/useFleet.ts' }]);
  });
});

describe('getDiffStat', () => {
  it('returns empty string for no changes', () => {
    const head = getHeadCommit(tmpDir);
    const stat = getDiffStat(tmpDir, head);
    expect(stat).toBe('');
  });

  it('returns stat summary for changes', () => {
    const anchor = getHeadCommit(tmpDir);
    writeFileSync(join(tmpDir, 'file.ts'), 'hello world');
    git('add .');
    git('commit -m "add"');
    const stat = getDiffStat(tmpDir, anchor);
    expect(stat).toContain('file.ts');
    expect(stat).toContain('1 file changed');
  });
});

describe('getCommitAge', () => {
  it('returns a human-readable age string', () => {
    const head = getHeadCommit(tmpDir);
    const age = getCommitAge(tmpDir, head);
    // Should be something like "X seconds ago"
    expect(age).toMatch(/ago/);
  });

  it('returns "unknown" for invalid commit', () => {
    const age = getCommitAge(tmpDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(age).toBe('unknown');
  });
});

describe('getCommitCount', () => {
  it('returns 0 for same commit', () => {
    const head = getHeadCommit(tmpDir);
    expect(getCommitCount(tmpDir, head, head)).toBe(0);
  });

  it('returns correct count', () => {
    const start = getHeadCommit(tmpDir);
    git('commit --allow-empty -m "c1"');
    git('commit --allow-empty -m "c2"');
    git('commit --allow-empty -m "c3"');
    const end = getHeadCommit(tmpDir);
    expect(getCommitCount(tmpDir, start, end)).toBe(3);
  });
});

describe('commitExists', () => {
  it('returns true for existing commit', () => {
    const head = getHeadCommit(tmpDir);
    expect(commitExists(tmpDir, head)).toBe(true);
  });

  it('returns false for non-existent commit', () => {
    expect(commitExists(tmpDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false);
  });

  it('treats commit refs as literal git arguments, not shell snippets', () => {
    const injectedFile = join(tmpDir, 'should-not-exist');
    const maliciousRef = 'HEAD; touch should-not-exist';

    expect(commitExists(tmpDir, maliciousRef)).toBe(false);
    expect(existsSync(injectedFile)).toBe(false);
  });
});

describe('abbreviateCommit', () => {
  it('returns first 7 chars', () => {
    expect(abbreviateCommit('abc1234567890')).toBe('abc1234');
  });
});
