import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
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
  dbPath = join(tmpdir(), `mm-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
});

afterEach(() => {
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('search command', () => {
  it('searches by node label', () => {
    mm('create myapp --type code');
    mm('add myapp AuthService --type service');
    mm('add myapp UserService --type service');
    mm('add myapp Database --type database');

    const output = mm('search Auth');
    expect(output).toContain('AuthService');
    expect(output).not.toContain('Database');
  });

  it('searches by node type', () => {
    mm('create myapp --type code');
    mm('add myapp ApiGateway --type gateway');
    mm('add myapp WebServer --type server');

    const output = mm('search gateway');
    expect(output).toContain('ApiGateway');
  });

  it('searches by metadata value', () => {
    mm('create myapp --type code');
    mm('add myapp PaymentHandler --type service --meta file=src/payments/handler.ts');
    mm('add myapp UserHandler --type service --meta file=src/users/handler.ts');

    const output = mm('search payments');
    expect(output).toContain('PaymentHandler');
    expect(output).not.toContain('UserHandler');
  });

  it('filters by --model flag', () => {
    mm('create app-a --type code');
    mm('create app-b --type code');
    mm('add app-a AuthModule --type module');
    mm('add app-b AuthConfig --type config');

    const output = mm('search Auth --model app-a');
    expect(output).toContain('AuthModule');
    expect(output).not.toContain('AuthConfig');
  });

  it('limits results with --limit flag', () => {
    mm('create myapp --type code');
    mm('add myapp ServiceA --type service');
    mm('add myapp ServiceB --type service');
    mm('add myapp ServiceC --type service');

    const output = mm('--json search Service --limit 2');
    const parsed = JSON.parse(output);
    expect(parsed.results).toHaveLength(2);
  });

  it('excludes models with --exclude flag', () => {
    mm('create keep-model --type code');
    mm('create skip-model --type code');
    mm('add keep-model SearchNode --type service');
    mm('add skip-model SearchNode --type service');

    const output = mm('search SearchNode --exclude skip-model');
    expect(output).toContain('keep-model');
    expect(output).not.toContain('skip-model');
  });

  it('outputs correct JSON format', () => {
    mm('create chitin --type code');
    mm('add chitin RetrievalEngine --type module --meta file=src/engine/retrieve.ts');
    mm('add chitin EmbeddingStore --type module');
    mm('link chitin RetrievalEngine uses EmbeddingStore');

    const output = mm('--json search RetrievalEngine');
    const parsed = JSON.parse(output);

    expect(parsed.results).toBeInstanceOf(Array);
    expect(parsed.results.length).toBeGreaterThan(0);

    const result = parsed.results[0];
    expect(result.model).toBe('chitin');
    expect(result.modelType).toBe('code');
    expect(result.node.label).toBe('RetrievalEngine');
    expect(result.node.type).toBe('module');
    expect(result.node.metadata.file).toBe('src/engine/retrieve.ts');
    expect(result.edges).toBeInstanceOf(Array);
    expect(result.edges.length).toBeGreaterThan(0);

    const edge = result.edges.find((e: any) => e.direction === 'out');
    expect(edge).toBeDefined();
    expect(edge.relationship).toBe('uses');
    expect(edge.target).toBe('EmbeddingStore');
  });

  it('returns empty results gracefully (human)', () => {
    mm('create myapp --type code');
    mm('add myapp SomeNode --type service');

    const output = mm('search nonexistent-query-xyz');
    expect(output).toContain('No results');
  });

  it('returns empty results gracefully (JSON)', () => {
    mm('create myapp --type code');
    mm('add myapp SomeNode --type service');

    const output = mm('--json search nonexistent-query-xyz');
    const parsed = JSON.parse(output);
    expect(parsed.results).toEqual([]);
  });

  it('searches across multiple models', () => {
    mm('create frontend --type code');
    mm('create backend --type code');
    mm('add frontend AuthView --type component');
    mm('add backend AuthController --type controller');

    const output = mm('search Auth');
    expect(output).toContain('AuthView');
    expect(output).toContain('AuthController');
    expect(output).toContain('frontend');
    expect(output).toContain('backend');
  });

  it('shows 1-hop neighborhood edges', () => {
    mm('create myapp --type code');
    mm('add myapp ServiceA --type service');
    mm('add myapp ServiceB --type service');
    mm('add myapp ServiceC --type service');
    mm('link myapp ServiceA calls ServiceB');
    mm('link myapp ServiceC depends-on ServiceA');

    const output = mm('search ServiceA');
    expect(output).toContain('ServiceA');
    expect(output).toContain('calls');
    expect(output).toContain('ServiceB');
    expect(output).toContain('depends-on');
    expect(output).toContain('ServiceC');
  });

  it('finds nodes by matching edge relationship', () => {
    mm('create myapp --type code');
    mm('add myapp Alpha --type service');
    mm('add myapp Beta --type service');
    mm('link myapp Alpha orchestrates Beta');

    const output = mm('search orchestrates');
    // Should find at least one of the connected nodes
    const hasAlpha = output.includes('Alpha');
    const hasBeta = output.includes('Beta');
    expect(hasAlpha || hasBeta).toBe(true);
  });

  it('finds nodes by matching model name', () => {
    mm('create fleet-rest --type code --description "Fleet management REST API"');
    mm('add fleet-rest MinerController --type controller');

    const output = mm('search fleet-rest');
    expect(output).toContain('MinerController');
  });

  it('supports multiple --exclude flags', () => {
    mm('create model-a --type code');
    mm('create model-b --type code');
    mm('create model-c --type code');
    mm('add model-a Node1 --type service');
    mm('add model-b Node1 --type service');
    mm('add model-c Node1 --type service');

    const output = mm('search Node1 --exclude model-a --exclude model-b');
    expect(output).toContain('model-c');
    expect(output).not.toContain('model-a');
    expect(output).not.toContain('model-b');
  });
});
