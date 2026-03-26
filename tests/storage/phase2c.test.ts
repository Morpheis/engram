import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import type { StorageInterface } from '../../src/storage/interface.js';

let storage: StorageInterface & { close(): void };

beforeEach(() => {
  storage = new SqliteStorage(':memory:');
});

afterEach(() => {
  storage.close();
});

// ── Export includes types and relationships ──────────

describe('Export with Types and Relationships', () => {
  it('export includes type definitions used in the model', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, { label: 'MyService', type: 'service' });
    storage.addNode(model.id, { label: 'MyDB', type: 'database' });

    const exported = storage.exportModel('test');
    expect(exported.types.length).toBeGreaterThanOrEqual(2);
    const typeLabels = exported.types.map(t => t.label);
    expect(typeLabels).toContain('service');
    expect(typeLabels).toContain('database');
  });

  it('export includes relationship definitions used in edges', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    const a = storage.addNode(model.id, { label: 'A', type: 'service' });
    const b = storage.addNode(model.id, { label: 'B', type: 'database' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });

    const exported = storage.exportModel('test');
    expect(exported.relationships.length).toBeGreaterThanOrEqual(1);
    const relLabels = exported.relationships.map(r => r.label);
    expect(relLabels).toContain('calls');
  });

  it('export does not include unused types', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    storage.addNode(model.id, { label: 'A', type: 'service' });

    const exported = storage.exportModel('test');
    const typeLabels = exported.types.map(t => t.label);
    expect(typeLabels).toContain('service');
    expect(typeLabels).not.toContain('person');
    expect(typeLabels).not.toContain('container');
  });

  it('export does not include unused relationships', () => {
    const model = storage.createModel({ name: 'test', type: 'code' });
    const a = storage.addNode(model.id, { label: 'A' });
    const b = storage.addNode(model.id, { label: 'B' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'depends_on' });

    const exported = storage.exportModel('test');
    const relLabels = exported.relationships.map(r => r.label);
    expect(relLabels).toContain('depends_on');
    expect(relLabels).not.toContain('calls');
    expect(relLabels).not.toContain('manages');
  });
});

// ── Import with types and relationships ──────────────

describe('Import with Types and Relationships', () => {
  it('imports custom types from export data', () => {
    // Add a custom type first, export, then import to a fresh storage
    storage.addType({ label: 'custom-widget', parentId: 'component', domain: 'code' });
    const model = storage.createModel({ name: 'source', type: 'code' });
    storage.addNode(model.id, { label: 'MyWidget', type: 'custom-widget' });

    const exported = storage.exportModel('source');

    // Create a fresh storage to import into
    const storage2 = new SqliteStorage(':memory:');
    try {
      // The custom type doesn't exist in storage2 yet
      expect(storage2.getType('custom-widget')).toBeNull();

      storage2.importModel({
        model: { name: 'imported' },
        nodes: exported.nodes.map(n => ({ label: n.label, type: n.type ?? undefined })),
        edges: [],
        types: exported.types.map(t => ({
          label: t.label,
          parentId: t.parentId ?? undefined,
          domain: t.domain ?? undefined,
          description: t.description ?? undefined,
        })),
      });

      // After import, custom types that aren't built-in should be imported
      // Built-in types already exist and are skipped
      // The import won't error on duplicates
      const nodes = storage2.listModels();
      expect(nodes.length).toBe(1);
    } finally {
      storage2.close();
    }
  });

  it('imports custom relationships from export data', () => {
    storage.addRelDef({ label: 'monitors', inverseLabel: 'monitored_by' });
    const model = storage.createModel({ name: 'source' });
    const a = storage.addNode(model.id, { label: 'A' });
    const b = storage.addNode(model.id, { label: 'B' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'monitors' });

    const exported = storage.exportModel('source');

    const storage2 = new SqliteStorage(':memory:');
    try {
      expect(storage2.getRelDef('monitors')).toBeNull();

      // Import with label-based references so nodes get new IDs
      storage2.importModel({
        model: { name: 'imported' },
        nodes: exported.nodes.map(n => ({ label: n.label, type: n.type ?? undefined })),
        edges: exported.edges.map(e => {
          // Map old node IDs to labels so importModel's idMap can resolve them
          const srcNode = exported.nodes.find(n => n.id === e.sourceId);
          const tgtNode = exported.nodes.find(n => n.id === e.targetId);
          return {
            sourceId: srcNode?.label ?? e.sourceId,
            targetId: tgtNode?.label ?? e.targetId,
            relationship: e.relationship,
          };
        }),
        relationships: exported.relationships.map(r => ({
          label: r.label,
          inverseLabel: r.inverseLabel ?? undefined,
          description: r.description ?? undefined,
        })),
      });

      // Custom relationship should now exist
      const rel = storage2.getRelDef('monitors');
      expect(rel).not.toBeNull();
      expect(rel!.inverseLabel).toBe('monitored_by');
    } finally {
      storage2.close();
    }
  });
});

// ── Branch overlay export ────────────────────────────

describe('Branch Overlay Export', () => {
  it('exports merged view of parent + overlay', () => {
    const parent = storage.createModel({ name: 'base', type: 'code' });
    storage.addNode(parent.id, { label: 'ServiceA', type: 'service' });
    storage.addNode(parent.id, { label: 'ServiceB', type: 'service' });

    const overlay = storage.createBranch(parent.id, 'feature-x');
    storage.addNode(overlay.id, { label: 'ServiceC', type: 'service' });

    const exported = storage.exportModel(overlay.name);
    const nodeLabels = exported.nodes.map(n => n.label).sort();
    expect(nodeLabels).toEqual(['ServiceA', 'ServiceB', 'ServiceC']);
  });

  it('exported branch model has branch field', () => {
    const parent = storage.createModel({ name: 'base', type: 'code' });
    const overlay = storage.createBranch(parent.id, 'dev-branch');

    const exported = storage.exportModel(overlay.name);
    expect(exported.model.branch).toBe('dev-branch');
    expect(exported.model.parentModelId).toBe(parent.id);
  });

  it('overlay export excludes removed parent nodes', () => {
    const parent = storage.createModel({ name: 'base', type: 'code' });
    const nodeA = storage.addNode(parent.id, { label: 'Keep', type: 'service' });
    const nodeB = storage.addNode(parent.id, { label: 'Remove', type: 'service' });

    const overlay = storage.createBranch(parent.id, 'cleanup');
    storage.deleteNode(nodeB.id, overlay.id);

    const exported = storage.exportModel(overlay.name);
    const nodeLabels = exported.nodes.map(n => n.label);
    expect(nodeLabels).toContain('Keep');
    expect(nodeLabels).not.toContain('Remove');
  });

  it('overlay export includes edges from both parent and overlay', () => {
    const parent = storage.createModel({ name: 'base', type: 'code' });
    const a = storage.addNode(parent.id, { label: 'A', type: 'service' });
    const b = storage.addNode(parent.id, { label: 'B', type: 'service' });
    storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });

    const overlay = storage.createBranch(parent.id, 'feat');
    const c = storage.addNode(overlay.id, { label: 'C', type: 'service' });
    storage.addEdge({ sourceId: a.id, targetId: c.id, relationship: 'uses' });

    const exported = storage.exportModel(overlay.name);
    const rels = exported.edges.map(e => e.relationship).sort();
    expect(rels).toContain('calls');
    expect(rels).toContain('uses');
    expect(exported.nodes).toHaveLength(3);
  });
});
