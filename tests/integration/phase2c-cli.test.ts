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

// ── JSON-LD Export ───────────────────────────────────

describe('JSON-LD Export', () => {
  it('default export produces JSON-LD with @context', () => {
    mm('create my-arch --type code --description "Test arch"');
    mm('add my-arch ServiceA --type service');
    mm('add my-arch DB --type database');
    mm('link my-arch ServiceA calls DB');

    const output = mm('export my-arch');
    const data = JSON.parse(output);

    // Must have @context
    expect(data['@context']).toBeDefined();
    expect(data['@context'].mm).toBe('https://github.com/Morpheis/engram/schema#');

    // Must have @type
    expect(data['@type']).toBe('mm:Model');

    // Must have model info
    expect(data.name).toBe('my-arch');
    expect(data.modelType).toBe('code');
    expect(data.description).toBe('Test arch');
  });

  it('JSON-LD export includes relationship types in @context', () => {
    mm('create test');
    mm('add test A');
    mm('add test B');
    mm('link test A calls B');

    const output = mm('export test');
    const data = JSON.parse(output);

    expect(data['@context'].calls).toBe('mm:calls');
    expect(data['@context'].called_by).toBe('mm:called_by');
  });

  it('JSON-LD export includes type definitions', () => {
    mm('create test --type code');
    mm('add test Svc --type service');

    const output = mm('export test');
    const data = JSON.parse(output);

    expect(data.types).toBeDefined();
    expect(Array.isArray(data.types)).toBe(true);
    const typeLabels = data.types.map((t: { label: string }) => t.label);
    expect(typeLabels).toContain('service');
  });

  it('JSON-LD export includes relationship definitions', () => {
    mm('create test');
    mm('add test A');
    mm('add test B');
    mm('link test A calls B');

    const output = mm('export test');
    const data = JSON.parse(output);

    expect(data.relationships).toBeDefined();
    expect(Array.isArray(data.relationships)).toBe(true);
    const relLabels = data.relationships.map((r: { label: string }) => r.label);
    expect(relLabels).toContain('calls');
  });

  it('JSON-LD export includes nodes with namespaced @id', () => {
    mm('create my-model');
    mm('add my-model MyNode --type service');

    const output = mm('export my-model');
    const data = JSON.parse(output);

    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]['@id']).toBe('my-model:MyNode');
    expect(data.nodes[0].label).toBe('MyNode');
  });

  it('JSON-LD export includes edges with namespaced refs', () => {
    mm('create test');
    mm('add test NodeA');
    mm('add test NodeB');
    mm('link test NodeA calls NodeB');

    const output = mm('export test');
    const data = JSON.parse(output);

    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].sourceRef).toBe('test:NodeA');
    expect(data.edges[0].targetRef).toBe('test:NodeB');
    expect(data.edges[0].relationship).toBe('calls');
  });

  it('JSON-LD export includes full node metadata', () => {
    mm('create test');
    mm('add test MyNode --type service --meta path=/api/foo version=2');

    const output = mm('export test');
    const data = JSON.parse(output);

    expect(data.nodes[0].metadata).toBeDefined();
    expect(data.nodes[0].metadata.path).toBe('/api/foo');
    expect(data.nodes[0].metadata.version).toBe(2);
  });

  it('JSON-LD output is valid JSON', () => {
    mm('create test');
    mm('add test A --type service');

    const output = mm('export test');
    expect(() => JSON.parse(output)).not.toThrow();
  });
});

// ── Plain JSON Export (backward compat) ──────────────

describe('Plain JSON Export', () => {
  it('--format json produces old-style export', () => {
    mm('create test --type code');
    mm('add test A --type service');

    const output = mm('export test --format json');
    const data = JSON.parse(output);

    // Old format has model key, no @context
    expect(data.model).toBeDefined();
    expect(data.model.name).toBe('test');
    expect(data['@context']).toBeUndefined();
    expect(data.nodes).toBeDefined();
    expect(data.edges).toBeDefined();
  });

  it('plain JSON export also includes types and relationships', () => {
    mm('create test');
    mm('add test A --type service');
    mm('add test B --type database');
    mm('link test A calls B');

    const output = mm('export test --format json');
    const data = JSON.parse(output);

    expect(data.types).toBeDefined();
    expect(data.relationships).toBeDefined();
    const typeLabels = data.types.map((t: { label: string }) => t.label);
    expect(typeLabels).toContain('service');
    expect(typeLabels).toContain('database');
  });
});

// ── JSON-LD Import ───────────────────────────────────

describe('JSON-LD Import', () => {
  it('detects JSON-LD format by @context and imports correctly', () => {
    // Create and export as JSON-LD
    mm('create original --type code');
    mm('add original ServiceA --type service');
    mm('add original ServiceB --type database');
    mm('link original ServiceA calls ServiceB');

    const exportFile = join(tmpdir(), `mm-jsonld-export-${Date.now()}.json`);
    mm(`export original --output ${exportFile}`);

    // Modify the name for import
    const raw = readFileSync(exportFile, 'utf-8');
    const data = JSON.parse(raw);
    data.name = 'imported-jsonld';

    const importFile = join(tmpdir(), `mm-jsonld-import-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(data));
    const importOutput = mm(`import ${importFile}`);

    expect(importOutput).toContain('imported-jsonld');
    expect(importOutput).toContain('JSON-LD');

    // Verify imported model has the nodes
    const nodes = mm('nodes imported-jsonld');
    expect(nodes).toContain('ServiceA');
    expect(nodes).toContain('ServiceB');

    unlinkSync(exportFile);
    unlinkSync(importFile);
  });

  it('strips @context and @type during import', () => {
    const jsonld = {
      '@context': { mm: 'https://github.com/Morpheis/engram/schema#' },
      '@type': 'mm:Model',
      name: 'context-test',
      modelType: 'concept',
      nodes: [{ label: 'TestNode', type: 'service' }],
      edges: [],
    };

    const importFile = join(tmpdir(), `mm-jsonld-strip-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(jsonld));
    mm(`import ${importFile}`);

    const list = mm('list');
    expect(list).toContain('context-test');

    const nodes = mm('nodes context-test');
    expect(nodes).toContain('TestNode');

    unlinkSync(importFile);
  });

  it('falls back to plain JSON import if no @context', () => {
    const plainJson = {
      model: { name: 'plain-import', type: 'concept' },
      nodes: [{ label: 'PlainNode' }],
      edges: [],
    };

    const importFile = join(tmpdir(), `mm-plain-import-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(plainJson));
    mm(`import ${importFile}`);

    const list = mm('list');
    expect(list).toContain('plain-import');

    const nodes = mm('nodes plain-import');
    expect(nodes).toContain('PlainNode');

    unlinkSync(importFile);
  });
});

// ── Round-trip: JSON-LD export → import ──────────────

describe('JSON-LD Round-trip', () => {
  it('export as JSON-LD → import → data matches', () => {
    mm('create roundtrip --type code --description "round trip test"');
    mm('add roundtrip Alpha --type service --meta path=/alpha');
    mm('add roundtrip Beta --type database --meta engine=postgres');
    mm('link roundtrip Alpha depends-on Beta');

    // Export as JSON-LD
    const exportFile = join(tmpdir(), `mm-rt-export-${Date.now()}.json`);
    mm(`export roundtrip --output ${exportFile}`);

    // Read and verify format
    const raw = readFileSync(exportFile, 'utf-8');
    const exported = JSON.parse(raw);
    expect(exported['@context']).toBeDefined();

    // Import with a new name
    exported.name = 'roundtrip-imported';
    const importFile = join(tmpdir(), `mm-rt-import-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(exported));
    mm(`import ${importFile}`);

    // Verify imported data matches
    const nodesJson = mm('--json nodes roundtrip-imported');
    const nodes = JSON.parse(nodesJson);
    expect(nodes).toHaveLength(2);
    const labels = nodes.map((n: { label: string }) => n.label).sort();
    expect(labels).toEqual(['Alpha', 'Beta']);

    // Verify metadata round-tripped
    const alpha = nodes.find((n: { label: string }) => n.label === 'Alpha');
    expect(alpha.metadata.path).toBe('/alpha');
    const beta = nodes.find((n: { label: string }) => n.label === 'Beta');
    expect(beta.metadata.engine).toBe('postgres');

    // Verify edges round-tripped
    const edgesOutput = mm('edges roundtrip-imported');
    expect(edgesOutput).toContain('depends-on');

    unlinkSync(exportFile);
    unlinkSync(importFile);
  });

  it('plain JSON round-trip still works', () => {
    mm('create plain-rt --type infra');
    mm('add plain-rt Server1 --type server');
    mm('add plain-rt Server2 --type server');
    mm('link plain-rt Server1 uses Server2');

    const exportFile = join(tmpdir(), `mm-plain-rt-${Date.now()}.json`);
    mm(`export plain-rt --format json --output ${exportFile}`);

    const raw = readFileSync(exportFile, 'utf-8');
    const data = JSON.parse(raw);
    data.model.name = 'plain-rt-imported';

    const importFile = join(tmpdir(), `mm-plain-rt-import-${Date.now()}.json`);
    writeFileSync(importFile, JSON.stringify(data));
    mm(`import ${importFile}`);

    const nodes = mm('nodes plain-rt-imported');
    expect(nodes).toContain('Server1');
    expect(nodes).toContain('Server2');

    unlinkSync(exportFile);
    unlinkSync(importFile);
  });
});

// ── Namespaced cross-model display ───────────────────

describe('Namespaced Cross-Model Display', () => {
  it('xq shows model name in brackets', () => {
    mm('create arch-model');
    mm('create team-model');
    mm('add arch-model FleetService --type service');
    mm('add team-model BackendTeam --type team');

    const output = mm('xq Fleet');
    expect(output).toContain('FleetService');
    expect(output).toContain('[arch-model]');
  });

  it('xq shows multiple models with their namespaces', () => {
    mm('create model-a');
    mm('create model-b');
    mm('add model-a AuthService --type service');
    mm('add model-b AuthMiddleware --type middleware');

    const output = mm('xq Auth');
    expect(output).toContain('AuthService');
    expect(output).toContain('[model-a]');
    expect(output).toContain('AuthMiddleware');
    expect(output).toContain('[model-b]');
  });

  it('xlink shows namespaced refs in success message', () => {
    mm('create model-a');
    mm('create model-b');
    mm('add model-a ServiceX --type service');
    mm('add model-b TeamY --type team');

    const output = mm('xlink model-a ServiceX owns model-b TeamY');
    expect(output).toContain('model-a:ServiceX');
    expect(output).toContain('model-b:TeamY');
    expect(output).toContain('owns');
  });
});

// ── Branch overlay export via CLI ────────────────────

describe('Branch Overlay Export CLI', () => {
  it('exports branch overlay as merged view', () => {
    mm('create base-model --type code');
    mm('add base-model ParentNode --type service');
    mm('branch base-model feature-x');
    mm('add base-model/feature-x BranchNode --type service');

    const output = mm('export base-model/feature-x');
    const data = JSON.parse(output);

    // Should have both parent and overlay nodes
    const nodeLabels = data.nodes.map((n: { label: string }) => n.label).sort();
    expect(nodeLabels).toContain('ParentNode');
    expect(nodeLabels).toContain('BranchNode');

    // Should have branch info
    expect(data.branch).toBe('feature-x');
    expect(data.parent).toBeDefined();
  });

  it('branch overlay export has @context', () => {
    mm('create base --type code');
    mm('branch base dev');

    const output = mm('export base/dev');
    const data = JSON.parse(output);

    expect(data['@context']).toBeDefined();
    expect(data['@type']).toBe('mm:Model');
  });
});
