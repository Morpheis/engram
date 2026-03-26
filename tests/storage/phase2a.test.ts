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

// ── Type System ────────────────────────────────────

describe('Type Definitions', () => {
  it('seeds built-in types on init', () => {
    const types = storage.listTypes();
    expect(types.length).toBeGreaterThan(0);

    // Check core types exist
    const labels = types.map(t => t.label);
    expect(labels).toContain('thing');
    expect(labels).toContain('code');
    expect(labels).toContain('service');
    expect(labels).toContain('microservice');
    expect(labels).toContain('person');
    expect(labels).toContain('server');
    expect(labels).toContain('process');
  });

  it('built-in types have correct hierarchy', () => {
    const code = storage.getType('code');
    expect(code).not.toBeNull();
    expect(code!.builtIn).toBe(true);

    const thing = storage.getType('thing');
    expect(thing).not.toBeNull();
    expect(code!.parentId).toBe(thing!.id);

    const service = storage.getType('service');
    expect(service!.parentId).toBe(code!.id);

    const micro = storage.getType('microservice');
    expect(micro!.parentId).toBe(service!.id);
  });

  it('built-in types have correct domains', () => {
    const service = storage.getType('service');
    expect(service!.domain).toBe('code');

    const person = storage.getType('person');
    expect(person!.domain).toBe('org');

    const server = storage.getType('server');
    expect(server!.domain).toBe('infra');

    const process = storage.getType('process');
    expect(process!.domain).toBe('concept');

    const thing = storage.getType('thing');
    expect(thing!.domain).toBeNull(); // universal
  });

  it('gets type by label or ID', () => {
    const byLabel = storage.getType('service');
    expect(byLabel).not.toBeNull();

    const byId = storage.getType(byLabel!.id);
    expect(byId).not.toBeNull();
    expect(byId!.label).toBe('service');
  });

  it('returns null for missing type', () => {
    expect(storage.getType('nonexistent')).toBeNull();
  });

  it('adds a custom type', () => {
    const typeDef = storage.addType({
      label: 'api-gateway',
      parentId: 'service',
      domain: 'code',
      description: 'API gateway service',
    });
    expect(typeDef.label).toBe('api-gateway');
    expect(typeDef.builtIn).toBe(false);
    expect(typeDef.description).toBe('API gateway service');

    const service = storage.getType('service');
    expect(typeDef.parentId).toBe(service!.id);
  });

  it('adds a custom type without parent', () => {
    const typeDef = storage.addType({ label: 'custom-thing' });
    expect(typeDef.label).toBe('custom-thing');
    expect(typeDef.parentId).toBeNull();
  });

  it('rejects duplicate type labels', () => {
    expect(() => storage.addType({ label: 'service' })).toThrow('already exists');
  });

  it('rejects adding type with nonexistent parent', () => {
    expect(() => storage.addType({ label: 'orphan-type', parentId: 'nonexistent' }))
      .toThrow('Parent type not found');
  });

  it('deletes a custom type', () => {
    storage.addType({ label: 'temp-type' });
    storage.deleteType('temp-type');
    expect(storage.getType('temp-type')).toBeNull();
  });

  it('prevents deleting built-in types', () => {
    expect(() => storage.deleteType('service')).toThrow('Cannot delete built-in type');
    expect(() => storage.deleteType('thing')).toThrow('Cannot delete built-in type');
  });

  it('prevents deleting type with children', () => {
    storage.addType({ label: 'parent-custom', parentId: 'code' });
    storage.addType({ label: 'child-custom', parentId: 'parent-custom' });
    expect(() => storage.deleteType('parent-custom')).toThrow('Cannot delete type with children');
  });

  it('prevents deleting nonexistent type', () => {
    expect(() => storage.deleteType('nope')).toThrow('Type not found');
  });
});

describe('Type Hierarchy Resolution', () => {
  it('getTypeWithSubtypes returns self and all descendants', () => {
    const subtypes = storage.getTypeWithSubtypes('service');
    const service = storage.getType('service')!;
    const micro = storage.getType('microservice')!;

    expect(subtypes).toContain(service.id);
    expect(subtypes).toContain(micro.id);
    expect(subtypes).toHaveLength(2); // service + microservice
  });

  it('getTypeWithSubtypes handles deep hierarchy', () => {
    const subtypes = storage.getTypeWithSubtypes('code');
    // code → component (page, widget), hook, function, service (microservice),
    // middleware, database, library, config, script, test-runner, module
    expect(subtypes.length).toBeGreaterThanOrEqual(13); // code + 12 children + microservice
  });

  it('getTypeWithSubtypes for leaf type returns just itself', () => {
    const subtypes = storage.getTypeWithSubtypes('microservice');
    expect(subtypes).toHaveLength(1);
  });

  it('getTypeWithSubtypes for root returns everything', () => {
    const subtypes = storage.getTypeWithSubtypes('thing');
    const allTypes = storage.listTypes();
    expect(subtypes).toHaveLength(allTypes.length);
  });

  it('getTypeWithSubtypes returns empty for nonexistent type', () => {
    const subtypes = storage.getTypeWithSubtypes('fake');
    expect(subtypes).toHaveLength(0);
  });

  it('custom subtypes included in resolution', () => {
    storage.addType({ label: 'api-gateway', parentId: 'service' });
    const subtypes = storage.getTypeWithSubtypes('service');
    expect(subtypes).toHaveLength(3); // service + microservice + api-gateway
  });
});

// ── Relationship Ontology ──────────────────────────

describe('Relationship Definitions', () => {
  it('seeds built-in relationships on init', () => {
    const rels = storage.listRelDefs();
    expect(rels.length).toBe(15);

    const labels = rels.map(r => r.label);
    expect(labels).toContain('calls');
    expect(labels).toContain('depends_on');
    expect(labels).toContain('contains');
    expect(labels).toContain('owns');
    expect(labels).toContain('renders');
  });

  it('built-in rels have correct inverses', () => {
    const calls = storage.getRelDef('calls');
    expect(calls).not.toBeNull();
    expect(calls!.inverseLabel).toBe('called_by');
    expect(calls!.builtIn).toBe(true);

    const dependsOn = storage.getRelDef('depends_on');
    expect(dependsOn!.inverseLabel).toBe('depended_on_by');
  });

  it('gets relDef by label or ID', () => {
    const byLabel = storage.getRelDef('calls');
    expect(byLabel).not.toBeNull();

    const byId = storage.getRelDef(byLabel!.id);
    expect(byId).not.toBeNull();
    expect(byId!.label).toBe('calls');
  });

  it('gets relDef by inverse label', () => {
    const byInverse = storage.getRelDef('called_by');
    expect(byInverse).not.toBeNull();
    expect(byInverse!.label).toBe('calls');
  });

  it('returns null for missing relDef', () => {
    expect(storage.getRelDef('nonexistent')).toBeNull();
  });

  it('adds a custom relationship type', () => {
    const rel = storage.addRelDef({
      label: 'monitors',
      inverseLabel: 'monitored_by',
      description: 'Monitoring relationship',
    });
    expect(rel.label).toBe('monitors');
    expect(rel.inverseLabel).toBe('monitored_by');
    expect(rel.builtIn).toBe(false);
  });

  it('adds a custom rel without inverse', () => {
    const rel = storage.addRelDef({ label: 'triggers' });
    expect(rel.label).toBe('triggers');
    expect(rel.inverseLabel).toBeNull();
  });

  it('rejects duplicate relationship labels', () => {
    expect(() => storage.addRelDef({ label: 'calls' })).toThrow('already exists');
  });

  it('deletes a custom relationship type', () => {
    storage.addRelDef({ label: 'temp-rel' });
    storage.deleteRelDef('temp-rel');
    expect(storage.getRelDef('temp-rel')).toBeNull();
  });

  it('prevents deleting built-in relationship types', () => {
    expect(() => storage.deleteRelDef('calls')).toThrow('Cannot delete built-in');
    expect(() => storage.deleteRelDef('depends_on')).toThrow('Cannot delete built-in');
  });

  it('prevents deleting nonexistent relationship type', () => {
    expect(() => storage.deleteRelDef('nope')).toThrow('not found');
  });
});

// ── Node Creation with Type Resolution ─────────────

describe('Node Creation with Types', () => {
  let modelId: string;

  beforeEach(() => {
    const model = storage.createModel({ name: 'test' });
    modelId = model.id;
  });

  it('resolves type_id when type matches a type_def', () => {
    const node = storage.addNode(modelId, { label: 'MyService', type: 'service' });
    expect(node.type).toBe('service');
    expect(node.typeId).not.toBeNull();

    const typeDef = storage.getType('service');
    expect(node.typeId).toBe(typeDef!.id);
  });

  it('stores null type_id for ad-hoc types', () => {
    const node = storage.addNode(modelId, { label: 'MyThing', type: 'custom-thing' });
    expect(node.type).toBe('custom-thing');
    expect(node.typeId).toBeNull();
  });

  it('stores null type_id when no type specified', () => {
    const node = storage.addNode(modelId, { label: 'NoType' });
    expect(node.type).toBeNull();
    expect(node.typeId).toBeNull();
  });

  it('update resolves type_id', () => {
    const node = storage.addNode(modelId, { label: 'X', type: 'service' });
    const updated = storage.updateNode(node.id, { type: 'database' });
    expect(updated.type).toBe('database');
    const dbType = storage.getType('database');
    expect(updated.typeId).toBe(dbType!.id);
  });

  it('update clears type_id for ad-hoc type', () => {
    const node = storage.addNode(modelId, { label: 'X', type: 'service' });
    const updated = storage.updateNode(node.id, { type: 'custom-adhoc' });
    expect(updated.type).toBe('custom-adhoc');
    expect(updated.typeId).toBeNull();
  });
});

// ── Edge Creation with Relationship Resolution ─────

describe('Edge Creation with Relationships', () => {
  let modelId: string;
  let nodeAId: string;
  let nodeBId: string;

  beforeEach(() => {
    const model = storage.createModel({ name: 'test' });
    modelId = model.id;
    const a = storage.addNode(modelId, { label: 'A' });
    const b = storage.addNode(modelId, { label: 'B' });
    nodeAId = a.id;
    nodeBId = b.id;
  });

  it('resolves rel_id when relationship matches a rel_def', () => {
    const edge = storage.addEdge({ sourceId: nodeAId, targetId: nodeBId, relationship: 'calls' });
    expect(edge.relationship).toBe('calls');
    expect(edge.relId).not.toBeNull();

    const relDef = storage.getRelDef('calls');
    expect(edge.relId).toBe(relDef!.id);
  });

  it('stores null rel_id for ad-hoc relationships', () => {
    const edge = storage.addEdge({ sourceId: nodeAId, targetId: nodeBId, relationship: 'my-custom-rel' });
    expect(edge.relationship).toBe('my-custom-rel');
    expect(edge.relId).toBeNull();
  });
});

// ── Query with Type Hierarchy ──────────────────────

describe('Query with Type Hierarchy', () => {
  let modelId: string;

  beforeEach(() => {
    const model = storage.createModel({ name: 'test' });
    modelId = model.id;
  });

  it('--type service includes microservice nodes', () => {
    storage.addNode(modelId, { label: 'AuthService', type: 'service' });
    storage.addNode(modelId, { label: 'UserMicro', type: 'microservice' });
    storage.addNode(modelId, { label: 'MyDB', type: 'database' });

    const results = storage.listNodes(modelId, { type: 'service' });
    expect(results).toHaveLength(2);
    const labels = results.map(n => n.label).sort();
    expect(labels).toEqual(['AuthService', 'UserMicro']);
  });

  it('--type component includes page and widget nodes', () => {
    storage.addNode(modelId, { label: 'Dashboard', type: 'component' });
    storage.addNode(modelId, { label: 'HomePage', type: 'page' });
    storage.addNode(modelId, { label: 'Calendar', type: 'widget' });
    storage.addNode(modelId, { label: 'SomeHook', type: 'hook' });

    const results = storage.listNodes(modelId, { type: 'component' });
    expect(results).toHaveLength(3);
  });

  it('--type code includes all code subtypes', () => {
    storage.addNode(modelId, { label: 'S', type: 'service' });
    storage.addNode(modelId, { label: 'M', type: 'microservice' });
    storage.addNode(modelId, { label: 'D', type: 'database' });
    storage.addNode(modelId, { label: 'P', type: 'person' });

    const results = storage.listNodes(modelId, { type: 'code' });
    expect(results).toHaveLength(3); // service, microservice, database — not person
  });

  it('exact match for leaf types', () => {
    storage.addNode(modelId, { label: 'X', type: 'microservice' });
    storage.addNode(modelId, { label: 'Y', type: 'service' });

    const results = storage.listNodes(modelId, { type: 'microservice' });
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('X');
  });

  it('ad-hoc types use exact match only', () => {
    storage.addNode(modelId, { label: 'A', type: 'custom-thing' });
    storage.addNode(modelId, { label: 'B', type: 'custom-thing' });
    storage.addNode(modelId, { label: 'C', type: 'service' });

    const results = storage.listNodes(modelId, { type: 'custom-thing' });
    expect(results).toHaveLength(2);
  });

  it('custom subtypes are included in hierarchy queries', () => {
    storage.addType({ label: 'api-gateway', parentId: 'service', domain: 'code' });
    storage.addNode(modelId, { label: 'GW', type: 'api-gateway' });
    storage.addNode(modelId, { label: 'Auth', type: 'service' });
    storage.addNode(modelId, { label: 'Micro', type: 'microservice' });

    const results = storage.listNodes(modelId, { type: 'service' });
    expect(results).toHaveLength(3);
  });
});

// ── Backward Compatibility ─────────────────────────

describe('Backward Compatibility', () => {
  it('Phase 1 nodes still have correct fields', () => {
    const model = storage.createModel({ name: 'old-model' });
    const node = storage.addNode(model.id, { label: 'Legacy', type: 'service' });

    // typeId should be set for known types
    expect(node.typeId).not.toBeNull();
    // But all Phase 1 fields still work
    expect(node.label).toBe('Legacy');
    expect(node.type).toBe('service');
    expect(node.metadata).toEqual({});
  });

  it('Phase 1 edges still have correct fields', () => {
    const model = storage.createModel({ name: 'old-model' });
    const a = storage.addNode(model.id, { label: 'A' });
    const b = storage.addNode(model.id, { label: 'B' });
    const edge = storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'calls' });

    // relId should be set for known relationships
    expect(edge.relId).not.toBeNull();
    // But all Phase 1 fields still work
    expect(edge.relationship).toBe('calls');
    expect(edge.sourceId).toBe(a.id);
    expect(edge.targetId).toBe(b.id);
  });

  it('ad-hoc types work exactly like Phase 1', () => {
    const model = storage.createModel({ name: 'model' });
    const node = storage.addNode(model.id, { label: 'X', type: 'my-custom-type' });
    expect(node.type).toBe('my-custom-type');
    expect(node.typeId).toBeNull();

    // Still queryable with exact match
    const results = storage.listNodes(model.id, { type: 'my-custom-type' });
    expect(results).toHaveLength(1);
  });

  it('ad-hoc relationships work exactly like Phase 1', () => {
    const model = storage.createModel({ name: 'model' });
    const a = storage.addNode(model.id, { label: 'A' });
    const b = storage.addNode(model.id, { label: 'B' });
    const edge = storage.addEdge({ sourceId: a.id, targetId: b.id, relationship: 'my-custom-rel' });
    expect(edge.relationship).toBe('my-custom-rel');
    expect(edge.relId).toBeNull();
  });
});
