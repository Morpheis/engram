import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import type { StorageInterface } from '../../src/storage/interface.js';

let storage: StorageInterface;

beforeEach(() => {
  storage = new SqliteStorage(':memory:');
});

afterEach(() => {
  storage.close();
});

describe('Models', () => {
  it('creates a model with defaults', () => {
    const model = storage.createModel({ name: 'test-model' });
    expect(model.name).toBe('test-model');
    expect(model.type).toBe('concept');
    expect(model.sourceType).toBe('manual');
    expect(model.id).toMatch(/^mdl_/);
  });

  it('creates a model with all options', () => {
    const model = storage.createModel({
      name: 'my-code',
      description: 'A codebase model',
      type: 'code',
      sourceType: 'git',
      repoPath: '/home/user/project',
    });
    expect(model.name).toBe('my-code');
    expect(model.description).toBe('A codebase model');
    expect(model.type).toBe('code');
    expect(model.sourceType).toBe('git');
    expect(model.repoPath).toBe('/home/user/project');
  });

  it('rejects duplicate model names', () => {
    storage.createModel({ name: 'dupe' });
    expect(() => storage.createModel({ name: 'dupe' })).toThrow();
  });

  it('gets model by name or id', () => {
    const created = storage.createModel({ name: 'findme' });
    expect(storage.getModel('findme')).toEqual(created);
    expect(storage.getModel(created.id)).toEqual(created);
  });

  it('returns null for missing model', () => {
    expect(storage.getModel('nope')).toBeNull();
  });

  it('lists all models', () => {
    storage.createModel({ name: 'alpha' });
    storage.createModel({ name: 'beta' });
    const models = storage.listModels();
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('alpha');
    expect(models[1].name).toBe('beta');
  });

  it('deletes a model and cascades', () => {
    const model = storage.createModel({ name: 'doomed' });
    const node = storage.addNode(model.id, { label: 'orphan' });
    storage.deleteModel('doomed');
    expect(storage.getModel('doomed')).toBeNull();
    expect(storage.getNode(node.id)).toBeNull();
  });
});

describe('Nodes', () => {
  let modelId: string;

  beforeEach(() => {
    const model = storage.createModel({ name: 'test' });
    modelId = model.id;
  });

  it('adds a node with defaults', () => {
    const node = storage.addNode(modelId, { label: 'AuthService' });
    expect(node.label).toBe('AuthService');
    expect(node.modelId).toBe(modelId);
    expect(node.id).toMatch(/^nd_/);
    expect(node.metadata).toEqual({});
  });

  it('adds a node with all options', () => {
    const node = storage.addNode(modelId, {
      label: 'UserDB',
      type: 'database',
      metadata: { engine: 'postgres', version: '15' },
      id: 'custom-id',
    });
    expect(node.id).toBe('custom-id');
    expect(node.type).toBe('database');
    expect(node.metadata).toEqual({ engine: 'postgres', version: '15' });
  });

  it('rejects duplicate labels in same model', () => {
    storage.addNode(modelId, { label: 'dupe' });
    expect(() => storage.addNode(modelId, { label: 'dupe' })).toThrow();
  });

  it('allows same label in different models', () => {
    const model2 = storage.createModel({ name: 'other' });
    storage.addNode(modelId, { label: 'shared' });
    const node2 = storage.addNode(model2.id, { label: 'shared' });
    expect(node2.label).toBe('shared');
  });

  it('finds node by label', () => {
    const node = storage.addNode(modelId, { label: 'FindMe' });
    const found = storage.findNode(modelId, 'FindMe');
    expect(found).toEqual(node);
  });

  it('updates a node', () => {
    const node = storage.addNode(modelId, { label: 'old', type: 'service' });
    const updated = storage.updateNode(node.id, { label: 'new', metadata: { foo: 'bar' } });
    expect(updated.label).toBe('new');
    expect(updated.type).toBe('service'); // unchanged
    expect(updated.metadata).toEqual({ foo: 'bar' });
  });

  it('merges metadata on update', () => {
    const node = storage.addNode(modelId, { label: 'n', metadata: { a: 1, b: 2 } });
    const updated = storage.updateNode(node.id, { metadata: { b: 3, c: 4 } });
    expect(updated.metadata).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('deletes a node and its edges', () => {
    const a = storage.addNode(modelId, { label: 'A' });
    const b = storage.addNode(modelId, { label: 'B' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });
    storage.deleteNode(a.id);
    expect(storage.getNode(a.id)).toBeNull();
    expect(storage.listEdges(modelId)).toHaveLength(0);
  });

  it('lists nodes with optional type filter', () => {
    storage.addNode(modelId, { label: 'A', type: 'service' });
    storage.addNode(modelId, { label: 'B', type: 'database' });
    storage.addNode(modelId, { label: 'C', type: 'service' });

    expect(storage.listNodes(modelId)).toHaveLength(3);
    expect(storage.listNodes(modelId, { type: 'service' })).toHaveLength(2);
    expect(storage.listNodes(modelId, { type: 'database' })).toHaveLength(1);
  });

  it('verifies a node', () => {
    const node = storage.addNode(modelId, { label: 'verify-me' });
    const before = node.verifiedAt;
    // Small delay to ensure timestamp differs
    storage.verifyNode(node.id);
    const after = storage.getNode(node.id)!;
    expect(after.verifiedAt).toBeDefined();
    // They should both be valid ISO dates
    expect(new Date(after.verifiedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('throws on non-existent model', () => {
    expect(() => storage.addNode('fake', { label: 'x' })).toThrow('Model not found');
  });
});

describe('Edges', () => {
  let modelId: string;
  let nodeA: ReturnType<StorageInterface['addNode']>;
  let nodeB: ReturnType<StorageInterface['addNode']>;
  let nodeC: ReturnType<StorageInterface['addNode']>;

  beforeEach(() => {
    const model = storage.createModel({ name: 'test' });
    modelId = model.id;
    nodeA = storage.addNode(modelId, { label: 'A' });
    nodeB = storage.addNode(modelId, { label: 'B' });
    nodeC = storage.addNode(modelId, { label: 'C' });
  });

  it('creates an edge', () => {
    const edge = storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    expect(edge.sourceId).toBe(nodeA.id);
    expect(edge.targetId).toBe(nodeB.id);
    expect(edge.relationship).toBe('calls');
    expect(edge.id).toMatch(/^eg_/);
  });

  it('creates an edge with metadata and weight', () => {
    const edge = storage.addEdge({
      sourceId: nodeA.id,
      targetId: nodeB.id,
      relationship: 'depends-on',
      metadata: { context: 'auth flow' },
      weight: 5,
    });
    expect(edge.metadata).toEqual({ context: 'auth flow' });
    expect(edge.weight).toBe(5);
  });

  it('rejects duplicate edges (same source, target, relationship)', () => {
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    expect(() =>
      storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' })
    ).toThrow();
  });

  it('allows different relationships between same nodes', () => {
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    const e2 = storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'depends-on' });
    expect(e2.relationship).toBe('depends-on');
  });

  it('gets an edge by source, target, relationship', () => {
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    const found = storage.getEdge(nodeA.id, nodeB.id, 'calls');
    expect(found).not.toBeNull();
    expect(found!.relationship).toBe('calls');
  });

  it('deletes an edge', () => {
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    storage.deleteEdge(nodeA.id, nodeB.id, 'calls');
    expect(storage.getEdge(nodeA.id, nodeB.id, 'calls')).toBeNull();
  });

  it('lists edges with filters', () => {
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeB.id, relationship: 'calls' });
    storage.addEdge({ sourceId: nodeA.id, targetId: nodeC.id, relationship: 'depends-on' });
    storage.addEdge({ sourceId: nodeB.id, targetId: nodeC.id, relationship: 'calls' });

    expect(storage.listEdges(modelId)).toHaveLength(3);
    expect(storage.listEdges(modelId, { from: nodeA.id })).toHaveLength(2);
    expect(storage.listEdges(modelId, { to: nodeC.id })).toHaveLength(2);
    expect(storage.listEdges(modelId, { rel: 'calls' })).toHaveLength(2);
  });

  it('throws on non-existent source node', () => {
    expect(() =>
      storage.addEdge({ sourceId: 'fake', targetId: nodeB.id, relationship: 'x' })
    ).toThrow('Source node not found');
  });
});

describe('Traversals', () => {
  let modelId: string;
  let nodes: Record<string, ReturnType<StorageInterface['addNode']>>;

  beforeEach(() => {
    const model = storage.createModel({ name: 'graph' });
    modelId = model.id;

    // Build: A → B → C → D, A → C
    nodes = {};
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      nodes[label] = storage.addNode(modelId, { label });
    }
    storage.addEdge({ sourceId: nodes.A.id, targetId: nodes.B.id, relationship: 'calls' });
    storage.addEdge({ sourceId: nodes.B.id, targetId: nodes.C.id, relationship: 'calls' });
    storage.addEdge({ sourceId: nodes.C.id, targetId: nodes.D.id, relationship: 'calls' });
    storage.addEdge({ sourceId: nodes.A.id, targetId: nodes.C.id, relationship: 'depends-on' });
    // E is an orphan
  });

  it('gets neighbors at depth 1', () => {
    const result = storage.getNeighbors(nodes.B.id, 1);
    expect(result.root.label).toBe('B');
    expect(result.nodes).toHaveLength(2); // A (incoming) and C (outgoing)
    const labels = result.nodes.map(n => n.node.label).sort();
    expect(labels).toEqual(['A', 'C']);
  });

  it('gets neighbors at depth 2', () => {
    const result = storage.getNeighbors(nodes.B.id, 2);
    expect(result.root.label).toBe('B');
    // depth 1: A, C. depth 2: D (from C). A→C already visited
    const labels = result.nodes.map(n => n.node.label).sort();
    expect(labels).toEqual(['A', 'C', 'D']);
  });

  it('getAffects — reverse traversal (who depends on C)', () => {
    const result = storage.getAffects(nodes.C.id);
    // C ← B ← A, C ← A
    const labels = result.nodes.map(n => n.node.label).sort();
    expect(labels).toEqual(['A', 'B']);
  });

  it('getDependsOn — forward traversal (what does A depend on)', () => {
    const result = storage.getDependsOn(nodes.A.id);
    // A → B → C → D, A → C (already visited)
    const labels = result.nodes.map(n => n.node.label).sort();
    expect(labels).toEqual(['B', 'C', 'D']);
  });

  it('findPaths between two nodes', () => {
    const paths = storage.findPaths(nodes.A.id, nodes.D.id);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    // Should find A → B → C → D and A → C → D
    expect(paths.length).toBe(2);
  });
});

describe('Queries', () => {
  let modelId: string;

  beforeEach(() => {
    const model = storage.createModel({ name: 'query-test' });
    modelId = model.id;
  });

  it('finds orphan nodes', () => {
    const a = storage.addNode(modelId, { label: 'Connected' });
    const b = storage.addNode(modelId, { label: 'AlsoConnected' });
    storage.addNode(modelId, { label: 'Orphan1' });
    storage.addNode(modelId, { label: 'Orphan2' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });

    const orphans = storage.findOrphanNodes(modelId);
    expect(orphans).toHaveLength(2);
    const labels = orphans.map(o => o.label).sort();
    expect(labels).toEqual(['Orphan1', 'Orphan2']);
  });

  it('finds stale nodes', () => {
    // All newly created nodes have verified_at = now, so nothing is stale
    storage.addNode(modelId, { label: 'Fresh' });
    expect(storage.findStaleNodes(modelId, 30)).toHaveLength(0);
  });

  it('searches nodes across models', () => {
    const model2 = storage.createModel({ name: 'other' });
    storage.addNode(modelId, { label: 'AuthService' });
    storage.addNode(model2.id, { label: 'AuthMiddleware' });
    storage.addNode(modelId, { label: 'UserDB' });

    const results = storage.searchNodes('Auth');
    expect(results).toHaveLength(2);
  });
});

describe('Export/Import', () => {
  it('round-trips a model', () => {
    const model = storage.createModel({ name: 'export-test', type: 'code', description: 'test' });
    const a = storage.addNode(model.id, { label: 'A', type: 'service' });
    const b = storage.addNode(model.id, { label: 'B', type: 'database' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'depends-on' });

    const exported = storage.exportModel('export-test');
    expect(exported.nodes).toHaveLength(2);
    expect(exported.edges).toHaveLength(1);

    // Import into fresh storage
    const storage2 = new SqliteStorage(':memory:');
    const imported = storage2.importModel({
      model: { name: exported.model.name + '-copy', type: exported.model.type, description: exported.model.description ?? undefined },
      nodes: exported.nodes.map(n => ({ label: n.label, type: n.type ?? undefined, metadata: n.metadata, id: n.id })),
      edges: exported.edges.map(e => ({ sourceId: e.sourceId, targetId: e.targetId, relationship: e.relationship, metadata: e.metadata })),
    });
    expect(imported.name).toBe('export-test-copy');
    expect(storage2.listNodes(imported.id)).toHaveLength(2);
    expect(storage2.listEdges(imported.id)).toHaveLength(1);
    storage2.close();
  });
});

describe('Cross-model edges', () => {
  it('creates an edge between nodes in different models', () => {
    const m1 = storage.createModel({ name: 'model1' });
    const m2 = storage.createModel({ name: 'model2' });
    const n1 = storage.addNode(m1.id, { label: 'ServiceA' });
    const n2 = storage.addNode(m2.id, { label: 'ServiceB' });

    const edge = storage.addCrossEdge(n1.id, 'calls', n2.id);
    expect(edge.sourceId).toBe(n1.id);
    expect(edge.targetId).toBe(n2.id);
    expect(edge.relationship).toBe('calls');
  });
});
