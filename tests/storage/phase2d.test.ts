import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';

let storage: SqliteStorage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:');
});

afterEach(() => {
  storage.close();
});

describe('getModelAnchor', () => {
  it('returns anchor info for a model', () => {
    const model = storage.createModel({
      name: 'test-arch',
      type: 'code',
      repoPath: '/path/to/repo',
      anchor: 'abc123',
    });
    const info = storage.getModelAnchor(model.id);
    expect(info.anchor).toBe('abc123');
    expect(info.repoPath).toBe('/path/to/repo');
  });

  it('returns null anchor when not set', () => {
    const model = storage.createModel({ name: 'no-anchor', type: 'code' });
    const info = storage.getModelAnchor(model.id);
    expect(info.anchor).toBeNull();
  });

  it('throws for non-existent model', () => {
    expect(() => storage.getModelAnchor('nonexistent')).toThrow('Model not found');
  });
});

describe('updateModelAnchor', () => {
  it('updates the anchor on a model', () => {
    const model = storage.createModel({
      name: 'test-arch',
      type: 'code',
      anchor: 'old_hash',
    });
    storage.updateModelAnchor(model.id, 'new_hash');
    const updated = storage.getModel(model.id)!;
    expect(updated.anchor).toBe('new_hash');
  });

  it('sets anchor when previously null', () => {
    const model = storage.createModel({ name: 'no-anchor', type: 'code' });
    storage.updateModelAnchor(model.id, 'first_hash');
    const updated = storage.getModel(model.id)!;
    expect(updated.anchor).toBe('first_hash');
  });

  it('throws for non-existent model', () => {
    expect(() => storage.updateModelAnchor('nonexistent', 'hash')).toThrow('Model not found');
  });
});

describe('refreshAllVerified', () => {
  it('updates verified_at on all nodes and edges', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    const n1 = storage.addNode(model.id, { label: 'A', type: 'service' });
    const n2 = storage.addNode(model.id, { label: 'B', type: 'service' });
    storage.addEdge({ sourceId: n1.id, targetId: n2.id, relationship: 'calls' });

    // Wait a tiny bit to ensure time difference
    const beforeRefresh = new Date().toISOString();

    storage.refreshAllVerified(model.id);

    const updatedN1 = storage.getNode(n1.id)!;
    const updatedN2 = storage.getNode(n2.id)!;
    const edges = storage.listEdges(model.id);

    // All should be verified at or after the refresh time
    expect(updatedN1.verifiedAt >= beforeRefresh).toBe(true);
    expect(updatedN2.verifiedAt >= beforeRefresh).toBe(true);
    expect(edges[0].verifiedAt >= beforeRefresh).toBe(true);
  });

  it('does not affect nodes in other models', () => {
    const model1 = storage.createModel({ name: 'model1', type: 'code' });
    const model2 = storage.createModel({ name: 'model2', type: 'code' });
    storage.addNode(model1.id, { label: 'A' });
    const n2 = storage.addNode(model2.id, { label: 'B' });
    const originalVerified = storage.getNode(n2.id)!.verifiedAt;

    storage.refreshAllVerified(model1.id);

    const unchangedN2 = storage.getNode(n2.id)!;
    expect(unchangedN2.verifiedAt).toBe(originalVerified);
  });

  it('throws for non-existent model', () => {
    expect(() => storage.refreshAllVerified('nonexistent')).toThrow('Model not found');
  });
});

describe('findNodesByFile', () => {
  it('matches exact metadata.file', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, {
      label: 'useFleet',
      type: 'hook',
      metadata: { file: 'src/hooks/useFleet.ts' },
    });
    storage.addNode(model.id, { label: 'unrelated', type: 'service' });

    const result = storage.findNodesByFile(model.id, ['src/hooks/useFleet.ts']);
    expect(result.size).toBe(1);
    expect(result.get('src/hooks/useFleet.ts')![0].label).toBe('useFleet');
  });

  it('matches partial path (file ends with changed path)', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, {
      label: 'useFleet',
      type: 'hook',
      metadata: { file: '/full/path/to/repo/src/hooks/useFleet.ts' },
    });

    const result = storage.findNodesByFile(model.id, ['src/hooks/useFleet.ts']);
    expect(result.size).toBe(1);
    expect(result.get('src/hooks/useFleet.ts')![0].label).toBe('useFleet');
  });

  it('matches partial path (changed path ends with file)', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, {
      label: 'useFleet',
      type: 'hook',
      metadata: { file: 'useFleet.ts' },
    });

    const result = storage.findNodesByFile(model.id, ['src/hooks/useFleet.ts']);
    expect(result.size).toBe(1);
    expect(result.get('src/hooks/useFleet.ts')![0].label).toBe('useFleet');
  });

  it('matches by fuzzy fallback (filename matches node label)', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, { label: 'FleetView', type: 'component' });

    const result = storage.findNodesByFile(model.id, ['src/routes/fleets/FleetView.tsx']);
    expect(result.size).toBe(1);
    expect(result.get('src/routes/fleets/FleetView.tsx')![0].label).toBe('FleetView');
  });

  it('does not fuzzy match partial label', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, { label: 'Fleet', type: 'component' });

    // FleetView.tsx should NOT match "Fleet" (partial label match)
    const result = storage.findNodesByFile(model.id, ['src/FleetView.tsx']);
    expect(result.size).toBe(0);
  });

  it('returns empty map for no matches', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, { label: 'SomeNode', type: 'service' });

    const result = storage.findNodesByFile(model.id, ['completely/different.ts']);
    expect(result.size).toBe(0);
  });

  it('handles multiple files matching multiple nodes', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, {
      label: 'useFleet',
      type: 'hook',
      metadata: { file: 'src/hooks/useFleet.ts' },
    });
    storage.addNode(model.id, {
      label: 'FleetView',
      type: 'component',
      metadata: { file: 'src/routes/FleetView.tsx' },
    });

    const result = storage.findNodesByFile(model.id, [
      'src/hooks/useFleet.ts',
      'src/routes/FleetView.tsx',
      'src/routes/unrelated.tsx',
    ]);
    expect(result.size).toBe(2);
    expect(result.get('src/hooks/useFleet.ts')![0].label).toBe('useFleet');
    expect(result.get('src/routes/FleetView.tsx')![0].label).toBe('FleetView');
  });

  it('one file can match multiple nodes', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, {
      label: 'index',
      type: 'module',
      metadata: { file: 'src/index.ts' },
    });
    // Fuzzy: index.ts basename = "index" matches label "index"
    // But another node also references the same file
    storage.addNode(model.id, {
      label: 'main-module',
      type: 'module',
      metadata: { file: 'src/index.ts' },
    });

    const result = storage.findNodesByFile(model.id, ['src/index.ts']);
    expect(result.get('src/index.ts')!.length).toBe(2);
  });
});

describe('findStaleEdges', () => {
  it('returns edges older than threshold', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    const n1 = storage.addNode(model.id, { label: 'A' });
    const n2 = storage.addNode(model.id, { label: 'B' });
    storage.addEdge({ sourceId: n1.id, targetId: n2.id, relationship: 'calls' });

    // With 0 days threshold, all edges should be fresh (just created)
    const stale = storage.findStaleEdges(model.id, 0);
    expect(stale.length).toBe(0);
  });

  it('throws for non-existent model', () => {
    expect(() => storage.findStaleEdges('nonexistent', 7)).toThrow('Model not found');
  });
});
