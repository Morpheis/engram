import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import type { StorageInterface, GraphNode } from '../../src/storage/interface.js';

let storage: StorageInterface;

beforeEach(() => {
  storage = new SqliteStorage(':memory:');
});

afterEach(() => {
  storage.close();
});

describe('Graph Traversals', () => {
  describe('getNeighbors', () => {
    it('returns empty for isolated node', () => {
      const model = storage.createModel({ name: 'test' });
      const node = storage.addNode(model.id, { label: 'Alone' });
      const result = storage.getNeighbors(node.id);
      expect(result.root.id).toBe(node.id);
      expect(result.nodes).toHaveLength(0);
    });

    it('finds direct neighbors only at depth 1', () => {
      const model = storage.createModel({ name: 'test' });
      const a = storage.addNode(model.id, { label: 'A' });
      const b = storage.addNode(model.id, { label: 'B' });
      const c = storage.addNode(model.id, { label: 'C' });
      storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });
      storage.addEdge({ sourceId: b.id, targetId: c.id, relationship: 'calls' });

      const result = storage.getNeighbors(b.id, 1);
      const labels = result.nodes.map(n => n.node.label).sort();
      expect(labels).toEqual(['A', 'C']);
    });

    it('respects max depth', () => {
      const model = storage.createModel({ name: 'chain' });
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 5; i++) {
        nodes.push(storage.addNode(model.id, { label: `N${i}` }));
      }
      // Chain: N0 → N1 → N2 → N3 → N4
      for (let i = 0; i < 4; i++) {
        storage.addEdge({ sourceId: nodes[i].id, targetId: nodes[i + 1].id, relationship: 'next' });
      }

      // From N2, depth 1 should see N1 and N3
      const d1 = storage.getNeighbors(nodes[2].id, 1);
      expect(d1.nodes).toHaveLength(2);

      // From N2, depth 2 should see N0, N1, N3, N4
      const d2 = storage.getNeighbors(nodes[2].id, 2);
      expect(d2.nodes).toHaveLength(4);
    });
  });

  describe('getAffects (reverse traversal)', () => {
    it('finds all nodes that depend on target', () => {
      const model = storage.createModel({ name: 'deps' });
      const db = storage.addNode(model.id, { label: 'DB' });
      const api = storage.addNode(model.id, { label: 'API' });
      const ui = storage.addNode(model.id, { label: 'UI' });
      const worker = storage.addNode(model.id, { label: 'Worker' });

      // UI → API → DB, Worker → DB
      storage.addEdge({ sourceId: ui.id, targetId: api.id, relationship: 'calls' });
      storage.addEdge({ sourceId: api.id, targetId: db.id, relationship: 'depends-on' });
      storage.addEdge({ sourceId: worker.id, targetId: db.id, relationship: 'depends-on' });

      const result = storage.getAffects(db.id);
      const labels = result.nodes.map(n => n.node.label).sort();
      expect(labels).toEqual(['API', 'UI', 'Worker']);
    });

    it('handles cycles gracefully', () => {
      const model = storage.createModel({ name: 'cycle' });
      const a = storage.addNode(model.id, { label: 'A' });
      const b = storage.addNode(model.id, { label: 'B' });
      const c = storage.addNode(model.id, { label: 'C' });
      storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });
      storage.addEdge({ sourceId: b.id, targetId: c.id, relationship: 'calls' });
      storage.addEdge({ sourceId: c.id, targetId: a.id, relationship: 'calls' });

      // Should not infinite loop
      const result = storage.getAffects(a.id);
      expect(result.nodes.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getDependsOn (forward traversal)', () => {
    it('finds all dependencies', () => {
      const model = storage.createModel({ name: 'deps' });
      const ui = storage.addNode(model.id, { label: 'UI' });
      const api = storage.addNode(model.id, { label: 'API' });
      const db = storage.addNode(model.id, { label: 'DB' });
      const cache = storage.addNode(model.id, { label: 'Cache' });

      storage.addEdge({ sourceId: ui.id, targetId: api.id, relationship: 'calls' });
      storage.addEdge({ sourceId: api.id, targetId: db.id, relationship: 'depends-on' });
      storage.addEdge({ sourceId: api.id, targetId: cache.id, relationship: 'uses' });

      const result = storage.getDependsOn(ui.id);
      const labels = result.nodes.map(n => n.node.label).sort();
      expect(labels).toEqual(['API', 'Cache', 'DB']);
    });
  });

  describe('findPaths', () => {
    it('finds multiple paths between nodes', () => {
      const model = storage.createModel({ name: 'paths' });
      const a = storage.addNode(model.id, { label: 'A' });
      const b = storage.addNode(model.id, { label: 'B' });
      const c = storage.addNode(model.id, { label: 'C' });
      const d = storage.addNode(model.id, { label: 'D' });

      // A → B → D and A → C → D
      storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'r' });
      storage.addEdge({ sourceId: a.id, targetId: c.id, relationship: 'r' });
      storage.addEdge({ sourceId: b.id, targetId: d.id, relationship: 'r' });
      storage.addEdge({ sourceId: c.id, targetId: d.id, relationship: 'r' });

      const paths = storage.findPaths(a.id, d.id);
      expect(paths).toHaveLength(2);
    });

    it('returns empty for unreachable nodes', () => {
      const model = storage.createModel({ name: 'island' });
      const a = storage.addNode(model.id, { label: 'A' });
      const b = storage.addNode(model.id, { label: 'B' });

      const paths = storage.findPaths(a.id, b.id);
      expect(paths).toHaveLength(0);
    });
  });
});

describe('Performance', () => {
  it('handles 1000-node graph with depth-2 traversal under 50ms', () => {
    const model = storage.createModel({ name: 'perf' });
    const nodes: GraphNode[] = [];

    // Create 1000 nodes
    for (let i = 0; i < 1000; i++) {
      nodes.push(storage.addNode(model.id, { label: `node-${i}`, type: 'entity' }));
    }

    // Create ~2000 edges (random but deterministic)
    for (let i = 0; i < 1000; i++) {
      const targets = [(i + 1) % 1000, (i + 7) % 1000];
      for (const t of targets) {
        if (t !== i) {
          try {
            storage.addEdge({
              sourceId: nodes[i].id,
              targetId: nodes[t].id,
              relationship: 'connects',
            });
          } catch {
            // Ignore duplicate edge errors
          }
        }
      }
    }

    // Depth-2 traversal from a node
    const start = performance.now();
    const result = storage.getNeighbors(nodes[500].id, 2);
    const elapsed = performance.now() - start;

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('batch inserts 100 nodes under 100ms', () => {
    const model = storage.createModel({ name: 'batch-perf' });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      storage.addNode(model.id, { label: `batch-${i}` });
    }
    const elapsed = performance.now() - start;

    expect(storage.listNodes(model.id)).toHaveLength(100);
    expect(elapsed).toBeLessThan(100);
  });
});
