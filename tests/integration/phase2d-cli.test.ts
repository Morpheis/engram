import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { unlinkSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, mkdtempSync } from 'fs';

const CLI = 'npx tsx src/index.ts';
let dbPath: string;
let repoDir: string;

function mm(args: string): string {
  const env = { ...process.env, ENGRAM_DB_PATH: dbPath };
  return execSync(`${CLI} ${args}`, {
    cwd: join(import.meta.dirname, '../..'),
    env,
    encoding: 'utf-8',
    timeout: 15000,
  }).trim();
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repoDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  }).trim();
}

beforeEach(() => {
  dbPath = join(tmpdir(), `mm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  repoDir = mkdtempSync(join(tmpdir(), 'mm-git-cli-'));
  git('init');
  git('commit --allow-empty -m "initial"');
});

afterEach(() => {
  if (existsSync(dbPath)) unlinkSync(dbPath);
  rmSync(repoDir, { recursive: true, force: true });
});

// ── mm check ────────────────────────────────────────

describe('mm check', () => {
  it('reports fresh model when anchor matches HEAD', () => {
    const head = git('rev-parse HEAD');
    mm(`create test-arch -t code -r "${repoDir}"`);
    // Set anchor to HEAD via refresh
    mm('refresh test-arch');
    const output = mm('check test-arch');
    expect(output).toContain('up to date');
  });

  it('reports stale model when anchor differs from HEAD', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    // Make a change in the repo
    mkdirSync(join(repoDir, 'src', 'hooks'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'hooks', 'useFleet.ts'), 'export function useFleet() {}');
    git('add .');
    git('commit -m "add useFleet"');

    // Add node with matching file metadata
    mm('add test-arch useFleet -t hook --meta file=src/hooks/useFleet.ts');

    const output = mm('check test-arch');
    expect(output).toContain('test-arch');
    expect(output).toContain('HEAD is now');
    expect(output).toContain('commit');
    expect(output).toContain('useFleet');
    expect(output).toContain('Affected nodes: 1');
    expect(output).toContain('mm refresh test-arch');
  });

  it('reports model with no anchor', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');

    const output = mm('check test-arch');
    expect(output).toContain('no anchor');
    expect(output).toContain('mm refresh test-arch');
  });

  it('outputs JSON with --json flag', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    // Make a change
    writeFileSync(join(repoDir, 'new.ts'), 'content');
    git('add .');
    git('commit -m "add file"');

    const output = mm('--json check test-arch');
    const data = JSON.parse(output);
    expect(data.status).toBe('stale');
    expect(data.model).toBe('test-arch');
    expect(data.head).toBeDefined();
    expect(data.commitCount).toBeGreaterThan(0);
  });

  it('outputs JSON for fresh model', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    const output = mm('--json check test-arch');
    const data = JSON.parse(output);
    expect(data.status).toBe('fresh');
  });

  it('shows affected edges', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    mm('add test-arch useFleet -t hook --meta file=src/hooks/useFleet.ts');
    mm('add test-arch FleetView -t component --meta file=src/routes/FleetView.tsx');
    mm('link test-arch FleetView calls useFleet');

    // Make changes to both files
    mkdirSync(join(repoDir, 'src', 'hooks'), { recursive: true });
    mkdirSync(join(repoDir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'hooks', 'useFleet.ts'), 'v2');
    writeFileSync(join(repoDir, 'src', 'routes', 'FleetView.tsx'), 'v2');
    git('add .');
    git('commit -m "modify both"');

    const output = mm('check test-arch');
    expect(output).toContain('Affected nodes: 2');
    expect(output).toContain('Potentially affected edges: 1');
    expect(output).toContain('FleetView');
    expect(output).toContain('useFleet');
  });

  it('fails for non-code model', () => {
    mm('create concepts -t concept');
    expect(() => mm('check concepts')).toThrow();
  });

  it('fails for model without repo_path', () => {
    mm('create no-repo -t code');
    expect(() => mm('check no-repo')).toThrow();
  });
});

// ── mm refresh ──────────────────────────────────────

describe('mm refresh', () => {
  it('sets anchor and marks all verified', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');
    mm('add test-arch database -t database');
    mm('link test-arch api-server calls database');

    const output = mm('refresh test-arch');
    expect(output).toContain('refreshed');
    expect(output).toContain('2 nodes');
    expect(output).toContain('1 edges');
  });

  it('updates anchor from old to new', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    // Make a new commit
    git('commit --allow-empty -m "new commit"');

    const output = mm('refresh test-arch');
    expect(output).toContain('Anchor updated');
  });

  it('outputs JSON with --json flag', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');

    const output = mm('--json refresh test-arch');
    const data = JSON.parse(output);
    expect(data.model).toBe('test-arch');
    expect(data.newAnchor).toBeDefined();
    expect(data.nodesRefreshed).toBe(1);
    expect(data.edgesRefreshed).toBe(0);
  });

  it('fails for non-code model', () => {
    mm('create concepts -t concept');
    expect(() => mm('refresh concepts')).toThrow();
  });
});

// ── mm diff ─────────────────────────────────────────

describe('mm diff', () => {
  it('reports no diff when fresh', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    const output = mm('diff test-arch');
    expect(output).toContain('up to date');
  });

  it('shows detailed diff with affected nodes', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    mm('add test-arch useFleet -t hook --meta file=src/hooks/useFleet.ts');
    mm('add test-arch FleetView -t component --meta file=src/routes/FleetView.tsx');
    mm('link test-arch FleetView calls useFleet');

    mkdirSync(join(repoDir, 'src', 'hooks'), { recursive: true });
    mkdirSync(join(repoDir, 'src', 'routes'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'hooks', 'useFleet.ts'), 'v2');
    writeFileSync(join(repoDir, 'src', 'routes', 'FleetView.tsx'), 'v2');
    writeFileSync(join(repoDir, 'src', 'routes', 'NewComponent.tsx'), 'new');
    git('add .');
    git('commit -m "changes"');

    const output = mm('diff test-arch');
    expect(output).toContain('useFleet');
    expect(output).toContain('FleetView');
    expect(output).toContain('no matching node');
    expect(output).toContain('Summary');
    expect(output).toContain('2 nodes affected');
    expect(output).toContain('1 new file');
  });

  it('categorizes changes by status (A/M/D)', () => {
    // Start with a file
    writeFileSync(join(repoDir, 'existing.ts'), 'v1');
    git('add .');
    git('commit -m "add existing"');

    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    // Modify existing, add new, delete another
    writeFileSync(join(repoDir, 'existing.ts'), 'v2');
    writeFileSync(join(repoDir, 'added.ts'), 'new');
    git('add .');
    git('commit -m "modify and add"');

    const output = mm('diff test-arch');
    expect(output).toContain('A added.ts');
    expect(output).toContain('M existing.ts');
  });

  it('outputs JSON with --json flag', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    writeFileSync(join(repoDir, 'file.ts'), 'content');
    git('add .');
    git('commit -m "add"');

    const output = mm('--json diff test-arch');
    const data = JSON.parse(output);
    expect(data.status).toBe('stale');
    expect(data.files).toBeDefined();
    expect(data.files.length).toBeGreaterThan(0);
    expect(data.summary).toBeDefined();
    expect(data.summary.totalFiles).toBeGreaterThan(0);
  });

  it('JSON output for fresh model', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    const output = mm('--json diff test-arch');
    const data = JSON.parse(output);
    expect(data.status).toBe('fresh');
    expect(data.files).toEqual([]);
  });

  it('shows subgraph context for affected nodes', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    mm('add test-arch useFleet -t hook --meta file=src/hooks/useFleet.ts');
    mm('add test-arch FleetView -t component');
    mm('add test-arch TabsView -t component');
    mm('link test-arch FleetView calls useFleet');
    mm('link test-arch FleetView uses TabsView');

    mkdirSync(join(repoDir, 'src', 'hooks'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'hooks', 'useFleet.ts'), 'changed');
    git('add .');
    git('commit -m "change useFleet"');

    const output = mm('diff test-arch');
    expect(output).toContain('useFleet');
    expect(output).toContain('called by');
    expect(output).toContain('FleetView');
  });

  it('fails for non-code model', () => {
    mm('create concepts -t concept');
    expect(() => mm('diff concepts')).toThrow();
  });
});

// ── mm stale ────────────────────────────────────────

describe('mm stale', () => {
  it('shows no stale items for fresh model', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');
    mm('refresh test-arch');

    const output = mm('stale test-arch');
    expect(output).toContain('No stale items');
  });

  it('defaults to 7 days for code models', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');

    const output = mm('stale test-arch');
    // Freshly created — shouldn't be stale at 7 days
    expect(output).toContain('No stale items');
  });

  it('defaults to 30 days for non-code models', () => {
    mm('create concepts -t concept');
    mm('add concepts idea -t concept');

    const output = mm('stale concepts');
    expect(output).toContain('No stale items');
  });

  it('accepts custom --days threshold', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');

    // With 0 days threshold, even freshly created nodes are "stale" (verified_at < cutoff which is now)
    const output = mm('stale test-arch --days 0');
    expect(output).toContain('Stale nodes');
    expect(output).toContain('api-server');

    // With a generous threshold, nothing should be stale
    const output2 = mm('stale test-arch --days 365');
    expect(output2).toContain('No stale items');
  });

  it('suggests mm check for code models', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');
    mm('refresh test-arch');

    const output = mm('stale test-arch');
    expect(output).toContain('mm check test-arch');
  });

  it('does not suggest mm check for non-code models', () => {
    mm('create concepts -t concept');
    mm('add concepts idea -t concept');

    const output = mm('stale concepts');
    expect(output).not.toContain('mm check');
  });

  it('outputs JSON with --json flag', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service');
    mm('refresh test-arch');

    const output = mm('--json stale test-arch');
    const data = JSON.parse(output);
    expect(data.model).toBe('test-arch');
    expect(data.type).toBe('code');
    expect(data.daysThreshold).toBe(7);
    expect(data.staleNodes).toBeDefined();
    expect(data.staleEdges).toBeDefined();
    expect(data.anchor).toBeDefined();
  });

  it('JSON output includes anchor info for code models', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    const output = mm('--json stale test-arch');
    const data = JSON.parse(output);
    expect(data.anchor).toBeDefined();
    expect(data.repoPath).toBe(repoDir);
  });
});

// ── Fuzzy file-to-node matching via CLI ─────────────

describe('file-to-node matching via check', () => {
  it('matches nodes by label when file has same basename', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    // Node with no file metadata — will be matched by label
    mm('add test-arch FleetView -t component');

    mkdirSync(join(repoDir, 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'FleetView.tsx'), 'content');
    git('add .');
    git('commit -m "add FleetView"');

    const output = mm('check test-arch');
    expect(output).toContain('FleetView');
    expect(output).toContain('Affected nodes: 1');
  });

  it('prioritizes exact file match over label match', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('refresh test-arch');

    mm('add test-arch useFleet -t hook --meta file=src/hooks/useFleet.ts');

    mkdirSync(join(repoDir, 'src', 'hooks'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'hooks', 'useFleet.ts'), 'content');
    git('add .');
    git('commit -m "add useFleet"');

    const output = mm('--json check test-arch');
    const data = JSON.parse(output);
    expect(data.fileMapping['src/hooks/useFleet.ts']).toHaveLength(1);
    expect(data.fileMapping['src/hooks/useFleet.ts'][0].label).toBe('useFleet');
  });
});

// ── End-to-end workflow ─────────────────────────────

describe('full workflow', () => {
  it('check → refresh → check shows fresh', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service --meta file=src/server.ts');

    // No anchor — check reports stale
    const check1 = mm('check test-arch');
    expect(check1).toContain('no anchor');

    // Refresh sets anchor
    const refresh = mm('refresh test-arch');
    expect(refresh).toContain('refreshed');

    // Now it's fresh
    const check2 = mm('check test-arch');
    expect(check2).toContain('up to date');
  });

  it('refresh → change → check → refresh → check', () => {
    mm(`create test-arch -t code -r "${repoDir}"`);
    mm('add test-arch api-server -t service --meta file=src/server.ts');
    mm('refresh test-arch');

    // Make a change
    mkdirSync(join(repoDir, 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'server.ts'), 'changed');
    git('add .');
    git('commit -m "change server"');

    // Check shows stale
    const check1 = mm('check test-arch');
    expect(check1).toContain('api-server');
    expect(check1).toContain('Affected nodes: 1');

    // Refresh again
    mm('refresh test-arch');

    // Now fresh
    const check2 = mm('check test-arch');
    expect(check2).toContain('up to date');
  });
});
