import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { unlinkSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI = 'npx tsx src/index.ts';
let dbPath: string;

function mm(args: string, opts?: { input?: string }): string {
  const env = { ...process.env, MM_DB_PATH: dbPath };
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

describe('CLI Integration', () => {
  it('creates and lists models', () => {
    mm('create my-model --type code --description "Test model"');
    const output = mm('list');
    expect(output).toContain('my-model');
    expect(output).toContain('code');
  });

  it('creates nodes and edges', () => {
    mm('create test');
    mm('add test ServiceA --type service');
    mm('add test ServiceB --type service');
    mm('link test ServiceA calls ServiceB');

    const nodes = mm('nodes test');
    expect(nodes).toContain('ServiceA');
    expect(nodes).toContain('ServiceB');

    const edges = mm('edges test');
    expect(edges).toContain('ServiceA');
    expect(edges).toContain('calls');
    expect(edges).toContain('ServiceB');
  });

  it('queries node connections', () => {
    mm('create test');
    mm('add test A --type service');
    mm('add test B --type database');
    mm('link test A depends-on B');

    const result = mm('q test A');
    expect(result).toContain('A');
    expect(result).toContain('depends-on');
    expect(result).toContain('B');
  });

  it('outputs JSON when --json flag is used', () => {
    mm('create test --type infra');
    const output = mm('--json list');
    const parsed = JSON.parse(output);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed[0].name).toBe('test');
    expect(parsed[0].type).toBe('infra');
  });

  it('finds orphan nodes', () => {
    mm('create test');
    mm('add test Connected1');
    mm('add test Connected2');
    mm('add test Orphan');
    mm('link test Connected1 calls Connected2');

    const output = mm('q test --orphans');
    expect(output).toContain('Orphan');
    expect(output).not.toContain('Connected1');
  });

  it('batch operations from stdin', () => {
    mm('create test');
    const input = [
      'add Alpha --type service',
      'add Beta --type database',
      'link Alpha depends-on Beta',
      '# this is a comment',
      '',
    ].join('\n');

    mm('batch test', { input });
    const nodes = mm('nodes test');
    expect(nodes).toContain('Alpha');
    expect(nodes).toContain('Beta');
  });

  it('exports and imports a model', () => {
    mm('create exportable --type code --description "round trip"');
    mm('add exportable NodeA --type service');
    mm('add exportable NodeB --type db');
    mm('link exportable NodeA calls NodeB');

    const exportFile = join(tmpdir(), `mm-export-${Date.now()}.json`);
    mm(`export exportable --output ${exportFile}`);
    expect(existsSync(exportFile)).toBe(true);

    const raw = readFileSync(exportFile, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);

    // Import with different name
    data.model.name = 'imported-model';
    const importFile = join(tmpdir(), `mm-import-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(data));
    mm(`import ${importFile}`);

    const list = mm('list');
    expect(list).toContain('imported-model');

    unlinkSync(exportFile);
    unlinkSync(importFile);
  });

  it('cross-model search', () => {
    mm('create model-a');
    mm('create model-b');
    mm('add model-a AuthService --type service');
    mm('add model-b AuthMiddleware --type middleware');

    const output = mm('xq Auth');
    expect(output).toContain('AuthService');
    expect(output).toContain('AuthMiddleware');
  });

  it('deletes a model', () => {
    mm('create doomed');
    mm('add doomed Sacrifice');
    mm('delete doomed');
    const output = mm('list');
    expect(output).toContain('No models found');
  });

  it('updates a node', () => {
    mm('create test');
    mm('add test MyNode --type service');
    mm('update test MyNode --label RenamedNode --type api');

    const output = mm('--json nodes test');
    const nodes = JSON.parse(output);
    expect(nodes[0].label).toBe('RenamedNode');
    expect(nodes[0].type).toBe('api');
  });

  it('removes a node and its edges', () => {
    mm('create test');
    mm('add test A');
    mm('add test B');
    mm('link test A calls B');
    mm('rm test A');

    const nodes = mm('nodes test');
    expect(nodes).not.toContain('A');
    expect(nodes).toContain('B');

    const edges = mm('edges test');
    expect(edges).toContain('No edges');
  });

  it('unlinks an edge', () => {
    mm('create test');
    mm('add test A');
    mm('add test B');
    mm('link test A calls B');
    mm('unlink test A calls B');

    const edges = mm('edges test');
    expect(edges).toContain('No edges');
  });
});
