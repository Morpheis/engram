import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI = 'npx tsx src/index.ts';
let dbPath: string;

function mm(args: string, opts?: { input?: string }): string {
  const env = { ...process.env, ENGRAM_DB_PATH: dbPath };
  return execSync(`${CLI} ${args}`, {
    cwd: join(import.meta.dirname, '../..'),
    env,
    encoding: 'utf-8',
    input: opts?.input,
    timeout: 15000,
  }).trim();
}

beforeEach(() => {
  dbPath = join(tmpdir(), `mm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
});

afterEach(() => {
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('Branch CLI', () => {
  it('creates a branch overlay', () => {
    mm('create test-app -t code');
    mm('add test-app api-server -t service');
    mm('add test-app database -t database');
    mm('link test-app api-server depends_on database');

    const output = mm('branch test-app feature/cache');
    expect(output).toContain('Created branch overlay feature/cache');
  });

  it('lists branch overlays', () => {
    mm('create test-app -t code');
    mm('branch test-app feature/a');
    mm('branch test-app feature/b');

    const output = mm('branch test-app --list');
    expect(output).toContain('feature/a');
    expect(output).toContain('feature/b');
  });

  it('lists branches with no branches shows empty message', () => {
    mm('create test-app -t code');
    const output = mm('branch test-app --list');
    expect(output).toContain('No branch overlays');
  });

  it('deletes a branch overlay', () => {
    mm('create test-app -t code');
    mm('branch test-app feature/x');

    const output = mm('branch test-app feature/x --delete');
    expect(output).toContain('Deleted branch overlay feature/x');

    // Verify it's gone
    const listOutput = mm('branch test-app --list');
    expect(listOutput).toContain('No branch overlays');
  });

  it('creates branch in JSON mode', () => {
    mm('create test-app -t code');
    const output = mm('--json branch test-app feature/x');
    const data = JSON.parse(output);
    expect(data.name).toBe('test-app/feature/x');
    expect(data.branch).toBe('feature/x');
    expect(data.parentModelId).toBeTruthy();
  });

  it('lists branches in JSON mode', () => {
    mm('create test-app -t code');
    mm('branch test-app feature/a');
    mm('branch test-app feature/b');

    const output = mm('--json branch test-app --list');
    const data = JSON.parse(output);
    expect(data).toHaveLength(2);
    expect(data.map((b: { branch: string }) => b.branch).sort()).toEqual(['feature/a', 'feature/b']);
  });
});

describe('Branch Merge CLI', () => {
  it('merges a branch overlay into parent', () => {
    mm('create test-app -t code');
    mm('add test-app api-server -t service');

    // Create branch and add a node
    mm('branch test-app feature/cache');
    mm('add test-app/feature/cache cache-layer -t service');

    // Merge
    const output = mm('merge test-app feature/cache');
    expect(output).toContain('Merged branch feature/cache into test-app');

    // Parent should now have the cache node
    const nodesOutput = mm('--json nodes test-app');
    const nodes = JSON.parse(nodesOutput);
    expect(nodes.map((n: { label: string }) => n.label).sort()).toEqual(['api-server', 'cache-layer']);
  });
});

describe('Branch Overlay Query via CLI', () => {
  it('overlay model query sees parent + overlay nodes', () => {
    mm('create test-app -t code');
    mm('add test-app api-server -t service');
    mm('add test-app database -t database');

    mm('branch test-app feature/cache');
    mm('add test-app/feature/cache cache-layer -t service');

    // Query overlay nodes
    const output = mm('--json nodes test-app/feature/cache');
    const nodes = JSON.parse(output);
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n: { label: string }) => n.label).sort()).toEqual(['api-server', 'cache-layer', 'database']);
  });

  it('overlay model query sees parent edges', () => {
    mm('create test-app -t code');
    mm('add test-app api-server -t service');
    mm('add test-app database -t database');
    mm('link test-app api-server depends_on database');

    mm('branch test-app feature/x');

    // Query overlay edges
    const output = mm('--json edges test-app/feature/x');
    const edges = JSON.parse(output);
    expect(edges).toHaveLength(1);
    expect(edges[0].relationship).toBe('depends_on');
  });

  it('rm on overlay branch removes parent node from overlay view only', () => {
    mm('create test-app -t code');
    mm('add test-app api-server -t service');
    mm('add test-app database -t database');
    mm('add test-app auth-service -t service');

    mm('branch test-app feature/simplify');
    mm('rm test-app/feature/simplify auth-service');

    // Overlay sees 2 nodes
    const overlayNodes = JSON.parse(mm('--json nodes test-app/feature/simplify'));
    expect(overlayNodes).toHaveLength(2);
    expect(overlayNodes.map((n: { label: string }) => n.label).sort()).toEqual(['api-server', 'database']);

    // Parent still has 3 nodes
    const parentNodes = JSON.parse(mm('--json nodes test-app'));
    expect(parentNodes).toHaveLength(3);
  });
});
