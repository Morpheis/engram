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

describe('Type CLI', () => {
  it('lists built-in types in tree format', () => {
    const output = mm('type list');
    expect(output).toContain('thing');
    expect(output).toContain('code');
    expect(output).toContain('service');
    expect(output).toContain('microservice');
    expect(output).toContain('person');
  });

  it('lists types in JSON format', () => {
    const output = mm('--json type list');
    const types = JSON.parse(output);
    expect(types).toBeInstanceOf(Array);
    expect(types.length).toBeGreaterThan(0);
    expect(types.find((t: any) => t.label === 'service')).toBeDefined();
  });

  it('adds a custom type', () => {
    const output = mm('type add api-gateway --parent service --domain code --description "API gateway"');
    expect(output).toContain('Added type api-gateway');
    expect(output).toContain('parent: service');

    const list = mm('type list');
    expect(list).toContain('api-gateway');
    expect(list).toContain('(custom)');
  });

  it('removes a custom type', () => {
    mm('type add temp-type');
    mm('type rm temp-type');
    const list = mm('--json type list');
    const types = JSON.parse(list);
    expect(types.find((t: any) => t.label === 'temp-type')).toBeUndefined();
  });

  it('refuses to remove built-in type', () => {
    try {
      mm('type rm service');
      expect.unreachable('Should have thrown');
    } catch (e: any) {
      expect(e.stderr?.toString() || e.message).toContain('Cannot delete built-in');
    }
  });
});

describe('Relationship CLI', () => {
  it('lists built-in relationships', () => {
    const output = mm('rel list');
    expect(output).toContain('calls');
    expect(output).toContain('called_by');
    expect(output).toContain('depends_on');
    expect(output).toContain('depended_on_by');
  });

  it('lists relationships in JSON format', () => {
    const output = mm('--json rel list');
    const rels = JSON.parse(output);
    expect(rels).toBeInstanceOf(Array);
    expect(rels.length).toBe(15);
    const calls = rels.find((r: any) => r.label === 'calls');
    expect(calls.inverseLabel).toBe('called_by');
  });

  it('adds a custom relationship', () => {
    const output = mm('rel add monitors --inverse monitored_by --description "Monitoring"');
    expect(output).toContain('Added relationship type monitors');
    expect(output).toContain('inverse: monitored_by');

    const list = mm('rel list');
    expect(list).toContain('monitors');
    expect(list).toContain('monitored_by');
    expect(list).toContain('(custom)');
  });

  it('removes a custom relationship', () => {
    mm('rel add temp-rel');
    mm('rel rm temp-rel');
    const list = mm('--json rel list');
    const rels = JSON.parse(list);
    expect(rels.find((r: any) => r.label === 'temp-rel')).toBeUndefined();
  });

  it('refuses to remove built-in relationship', () => {
    try {
      mm('rel rm calls');
      expect.unreachable('Should have thrown');
    } catch (e: any) {
      expect(e.stderr?.toString() || e.message).toContain('Cannot delete built-in');
    }
  });
});

describe('Edge Creation with Inverse Display', () => {
  it('shows inverse relationship when linking with known relationship', () => {
    mm('create test');
    mm('add test A --type service');
    mm('add test B --type database');
    const output = mm('link test A calls B');
    expect(output).toContain('Linked A —[calls]→ B');
    expect(output).toContain('inverse: B —[called_by]→ A');
  });

  it('does not show inverse for ad-hoc relationships', () => {
    mm('create test');
    mm('add test A');
    mm('add test B');
    const output = mm('link test A custom-rel B');
    expect(output).toContain('Linked A —[custom-rel]→ B');
    expect(output).not.toContain('inverse');
  });
});

describe('Query with Type Hierarchy', () => {
  it('--type service includes microservice nodes', () => {
    mm('create test');
    mm('add test AuthService --type service');
    mm('add test UserMicro --type microservice');
    mm('add test MyDB --type database');

    const output = mm('q test --type service');
    expect(output).toContain('AuthService');
    expect(output).toContain('UserMicro');
    expect(output).not.toContain('MyDB');
  });

  it('--type with JSON output includes subtypes', () => {
    mm('create test');
    mm('add test S1 --type service');
    mm('add test M1 --type microservice');
    mm('add test D1 --type database');

    const output = mm('--json q test --type service');
    const nodes = JSON.parse(output);
    expect(nodes).toHaveLength(2);
    const labels = nodes.map((n: any) => n.label).sort();
    expect(labels).toEqual(['M1', 'S1']);
  });
});

describe('Query Inverse Display', () => {
  it('shows inverse label for incoming edges', () => {
    mm('create test');
    mm('add test A --type service');
    mm('add test B --type service');
    mm('link test A calls B');

    const output = mm('q test B');
    // B should show "← called_by: A" for the incoming edge
    expect(output).toContain('called_by');
    expect(output).toContain('A');
  });
});

describe('Node Type Resolution via CLI', () => {
  it('node created with known type has typeId in JSON output', () => {
    mm('create test');
    mm('add test MyService --type service');
    const output = mm('--json nodes test');
    const nodes = JSON.parse(output);
    expect(nodes[0].typeId).not.toBeNull();
    expect(nodes[0].typeId).toMatch(/^type_/);
  });

  it('node created with ad-hoc type has null typeId', () => {
    mm('create test');
    mm('add test MyThing --type unknown-type');
    const output = mm('--json nodes test');
    const nodes = JSON.parse(output);
    expect(nodes[0].typeId).toBeNull();
  });
});
