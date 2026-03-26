import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { generateId } from '../utils/ids.js';
import type {
  StorageInterface,
  ModelInput, Model,
  NodeInput, GraphNode,
  EdgeInput, Edge,
  TraversalResult, TraversalNode,
  Path,
  TypeDef, TypeInput,
  RelDef, RelDefInput,
} from './interface.js';

// Row types matching SQLite columns
interface ModelRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  source_type: string;
  anchor: string | null;
  repo_path: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  model_id: string;
  label: string;
  type: string | null;
  type_id: string | null;
  metadata: string;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relationship: string;
  rel_id: string | null;
  metadata: string;
  weight: number | null;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

interface TypeDefRow {
  id: string;
  label: string;
  parent_id: string | null;
  description: string | null;
  domain: string | null;
  built_in: number;
  created_at: string;
}

interface RelDefRow {
  id: string;
  label: string;
  inverse_label: string | null;
  description: string | null;
  source_type_constraint: string | null;
  target_type_constraint: string | null;
  built_in: number;
  created_at: string;
}

function toModel(row: ModelRow): Model {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as Model['type'],
    sourceType: row.source_type as Model['sourceType'],
    anchor: row.anchor,
    repoPath: row.repo_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    modelId: row.model_id,
    label: row.label,
    type: row.type,
    typeId: row.type_id ?? null,
    metadata: JSON.parse(row.metadata || '{}'),
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationship: row.relationship,
    relId: row.rel_id ?? null,
    metadata: JSON.parse(row.metadata || '{}'),
    weight: row.weight,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTypeDef(row: TypeDefRow): TypeDef {
  return {
    id: row.id,
    label: row.label,
    parentId: row.parent_id,
    description: row.description,
    domain: row.domain,
    builtIn: row.built_in === 1,
    createdAt: row.created_at,
  };
}

function toRelDef(row: RelDefRow): RelDef {
  return {
    id: row.id,
    label: row.label,
    inverseLabel: row.inverse_label,
    description: row.description,
    sourceTypeConstraint: row.source_type_constraint,
    targetTypeConstraint: row.target_type_constraint,
    builtIn: row.built_in === 1,
    createdAt: row.created_at,
  };
}

export class SqliteStorage implements StorageInterface {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    initSchema(this.db);
  }

  // --- Models ---

  createModel(input: ModelInput): Model {
    const id = generateId('mdl');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO models (id, name, description, type, source_type, anchor, repo_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? null,
      input.type ?? 'concept',
      input.sourceType ?? 'manual',
      input.anchor ?? null,
      input.repoPath ?? null,
      now, now
    );
    return this.getModel(id)!;
  }

  getModel(nameOrId: string): Model | null {
    const row = this.db.prepare(
      'SELECT * FROM models WHERE id = ? OR name = ?'
    ).get(nameOrId, nameOrId) as ModelRow | undefined;
    return row ? toModel(row) : null;
  }

  listModels(): Model[] {
    const rows = this.db.prepare('SELECT * FROM models ORDER BY name').all() as ModelRow[];
    return rows.map(toModel);
  }

  deleteModel(nameOrId: string): void {
    const model = this.getModel(nameOrId);
    if (!model) throw new Error(`Model not found: ${nameOrId}`);
    this.db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
  }

  exportModel(nameOrId: string): { model: Model; nodes: GraphNode[]; edges: Edge[] } {
    const model = this.getModel(nameOrId);
    if (!model) throw new Error(`Model not found: ${nameOrId}`);
    const nodes = this.listNodes(model.id);
    const nodeIds = new Set(nodes.map(n => n.id));
    const allEdges = this.db.prepare(
      'SELECT * FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE model_id = ?)'
    ).all(model.id) as EdgeRow[];
    const edges = allEdges.filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id)).map(toEdge);
    return { model, nodes, edges };
  }

  importModel(data: { model: ModelInput; nodes: NodeInput[]; edges: EdgeInput[] }): Model {
    const model = this.createModel(data.model);
    const idMap = new Map<string, string>();

    const insertNode = this.db.transaction(() => {
      for (const nodeInput of data.nodes) {
        const oldId = nodeInput.id;
        const node = this.addNode(model.id, {
          label: nodeInput.label,
          type: nodeInput.type,
          metadata: nodeInput.metadata,
        });
        if (oldId) {
          idMap.set(oldId, node.id);
        }
        idMap.set(nodeInput.label, node.id);
      }
    });
    insertNode();

    const insertEdges = this.db.transaction(() => {
      for (const edgeInput of data.edges) {
        const sourceId = idMap.get(edgeInput.sourceId) ?? edgeInput.sourceId;
        const targetId = idMap.get(edgeInput.targetId) ?? edgeInput.targetId;
        this.addEdge({
          ...edgeInput,
          sourceId,
          targetId,
        });
      }
    });
    insertEdges();

    return model;
  }

  // --- Nodes ---

  addNode(modelId: string, input: NodeInput): GraphNode {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const id = input.id ?? generateId('nd');
    const now = new Date().toISOString();

    // Resolve type against type_defs if provided
    let typeId: string | null = null;
    if (input.type) {
      const typeDef = this.getType(input.type);
      if (typeDef) {
        typeId = typeDef.id;
      }
    }

    this.db.prepare(`
      INSERT INTO nodes (id, model_id, label, type, type_id, metadata, verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      model.id,
      input.label,
      input.type ?? null,
      typeId,
      JSON.stringify(input.metadata ?? {}),
      now, now, now
    );
    return this.getNode(id)!;
  }

  getNode(nodeId: string): GraphNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
    return row ? toNode(row) : null;
  }

  findNode(modelId: string, label: string): GraphNode | null {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    const row = this.db.prepare(
      'SELECT * FROM nodes WHERE model_id = ? AND label = ?'
    ).get(model.id, label) as NodeRow | undefined;
    return row ? toNode(row) : null;
  }

  updateNode(nodeId: string, updates: Partial<NodeInput>): GraphNode {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const now = new Date().toISOString();
    const newLabel = updates.label ?? node.label;
    const newType = updates.type !== undefined ? updates.type : node.type;
    const newMeta = updates.metadata
      ? JSON.stringify({ ...node.metadata, ...updates.metadata })
      : JSON.stringify(node.metadata);

    // Resolve type_id if type changed
    let typeId = node.typeId;
    if (updates.type !== undefined) {
      if (updates.type) {
        const typeDef = this.getType(updates.type);
        typeId = typeDef?.id ?? null;
      } else {
        typeId = null;
      }
    }

    this.db.prepare(`
      UPDATE nodes SET label = ?, type = ?, type_id = ?, metadata = ?, updated_at = ? WHERE id = ?
    `).run(newLabel, newType ?? null, typeId, newMeta, now, nodeId);

    return this.getNode(nodeId)!;
  }

  deleteNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
  }

  listNodes(modelId: string, filter?: { type?: string }): GraphNode[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    if (filter?.type) {
      // Resolve type through hierarchy — include subtypes
      const subtypeIds = this.getTypeWithSubtypes(filter.type);
      if (subtypeIds.length > 0) {
        // Get all labels for these type IDs
        const placeholders = subtypeIds.map(() => '?').join(',');
        const typeLabels = (this.db.prepare(
          `SELECT label FROM type_defs WHERE id IN (${placeholders})`
        ).all(...subtypeIds) as Array<{ label: string }>).map(r => r.label);

        // Query nodes matching any of these type labels (or the original if no type_def match)
        const allLabels = [...new Set([filter.type, ...typeLabels])];
        const labelPlaceholders = allLabels.map(() => '?').join(',');
        const sql = `SELECT * FROM nodes WHERE model_id = ? AND type IN (${labelPlaceholders}) ORDER BY label`;
        return (this.db.prepare(sql).all(model.id, ...allLabels) as NodeRow[]).map(toNode);
      } else {
        // No type_def match — exact match only (ad-hoc types)
        const sql = 'SELECT * FROM nodes WHERE model_id = ? AND type = ? ORDER BY label';
        return (this.db.prepare(sql).all(model.id, filter.type) as NodeRow[]).map(toNode);
      }
    }

    const sql = 'SELECT * FROM nodes WHERE model_id = ? ORDER BY label';
    return (this.db.prepare(sql).all(model.id) as NodeRow[]).map(toNode);
  }

  verifyNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE nodes SET verified_at = ?, updated_at = ? WHERE id = ?').run(now, now, nodeId);
  }

  // --- Edges ---

  addEdge(input: EdgeInput): Edge {
    const source = this.getNode(input.sourceId);
    if (!source) throw new Error(`Source node not found: ${input.sourceId}`);
    const target = this.getNode(input.targetId);
    if (!target) throw new Error(`Target node not found: ${input.targetId}`);

    // Resolve relationship against rel_defs
    let relId: string | null = null;
    const relDef = this.getRelDef(input.relationship);
    if (relDef) {
      relId = relDef.id;
    }

    const id = generateId('eg');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO edges (id, source_id, target_id, relationship, rel_id, metadata, weight, verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.targetId,
      input.relationship,
      relId,
      JSON.stringify(input.metadata ?? {}),
      input.weight ?? null,
      now, now, now
    );
    return this.getEdgeById(id)!;
  }

  private getEdgeById(id: string): Edge | null {
    const row = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow | undefined;
    return row ? toEdge(row) : null;
  }

  getEdge(sourceId: string, targetId: string, relationship: string): Edge | null {
    const row = this.db.prepare(
      'SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relationship = ?'
    ).get(sourceId, targetId, relationship) as EdgeRow | undefined;
    return row ? toEdge(row) : null;
  }

  deleteEdge(sourceId: string, targetId: string, relationship: string): void {
    const edge = this.getEdge(sourceId, targetId, relationship);
    if (!edge) throw new Error(`Edge not found: ${sourceId} —[${relationship}]→ ${targetId}`);
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
  }

  listEdges(modelId: string, filter?: { from?: string; to?: string; rel?: string }): Edge[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    let sql = `
      SELECT e.* FROM edges e
      JOIN nodes n ON e.source_id = n.id
      WHERE n.model_id = ?
    `;
    const params: unknown[] = [model.id];

    if (filter?.from) {
      sql += ' AND e.source_id = ?';
      params.push(filter.from);
    }
    if (filter?.to) {
      sql += ' AND e.target_id = ?';
      params.push(filter.to);
    }
    if (filter?.rel) {
      sql += ' AND e.relationship = ?';
      params.push(filter.rel);
    }

    sql += ' ORDER BY e.relationship';
    return (this.db.prepare(sql).all(...params) as EdgeRow[]).map(toEdge);
  }

  // --- Traversals ---

  getNeighbors(nodeId: string, depth: number = 1): TraversalResult {
    const root = this.getNode(nodeId);
    if (!root) throw new Error(`Node not found: ${nodeId}`);

    const visited = new Set<string>([root.id]);
    const result: TraversalNode[] = [];
    let frontier = [root.id];

    for (let d = 1; d <= depth; d++) {
      const nextFrontier: string[] = [];

      for (const nid of frontier) {
        const outgoing = this.db.prepare(
          'SELECT * FROM edges WHERE source_id = ?'
        ).all(nid) as EdgeRow[];
        for (const row of outgoing) {
          if (!visited.has(row.target_id)) {
            visited.add(row.target_id);
            nextFrontier.push(row.target_id);
            const node = this.getNode(row.target_id)!;
            result.push({
              node,
              depth: d,
              path: [...this.buildPath(root.id, row.target_id, visited), row.target_id],
              edge: toEdge(row),
            });
          }
        }

        const incoming = this.db.prepare(
          'SELECT * FROM edges WHERE target_id = ?'
        ).all(nid) as EdgeRow[];
        for (const row of incoming) {
          if (!visited.has(row.source_id)) {
            visited.add(row.source_id);
            nextFrontier.push(row.source_id);
            const node = this.getNode(row.source_id)!;
            result.push({
              node,
              depth: d,
              path: [...this.buildPath(root.id, row.source_id, visited), row.source_id],
              edge: toEdge(row),
            });
          }
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return { root, nodes: result };
  }

  getAffects(nodeId: string, depth: number = 10): TraversalResult {
    return this.traverse(nodeId, 'incoming', depth);
  }

  getDependsOn(nodeId: string, depth: number = 10): TraversalResult {
    return this.traverse(nodeId, 'outgoing', depth);
  }

  private traverse(nodeId: string, direction: 'incoming' | 'outgoing', maxDepth: number): TraversalResult {
    const root = this.getNode(nodeId);
    if (!root) throw new Error(`Node not found: ${nodeId}`);

    const visited = new Set<string>([root.id]);
    const result: TraversalNode[] = [];
    let frontier: Array<{ id: string; path: string[] }> = [{ id: root.id, path: [root.id] }];

    for (let d = 1; d <= maxDepth; d++) {
      const nextFrontier: Array<{ id: string; path: string[] }> = [];

      for (const { id: nid, path } of frontier) {
        const sql = direction === 'incoming'
          ? 'SELECT * FROM edges WHERE target_id = ?'
          : 'SELECT * FROM edges WHERE source_id = ?';
        const rows = this.db.prepare(sql).all(nid) as EdgeRow[];

        for (const row of rows) {
          const nextId = direction === 'incoming' ? row.source_id : row.target_id;
          if (!visited.has(nextId)) {
            visited.add(nextId);
            const newPath = [...path, nextId];
            nextFrontier.push({ id: nextId, path: newPath });
            const node = this.getNode(nextId)!;
            result.push({
              node,
              depth: d,
              path: newPath,
              edge: toEdge(row),
            });
          }
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return { root, nodes: result };
  }

  findPaths(fromId: string, toId: string, maxDepth: number = 5): Path[] {
    const fromNode = this.getNode(fromId);
    if (!fromNode) throw new Error(`Node not found: ${fromId}`);
    const toNode = this.getNode(toId);
    if (!toNode) throw new Error(`Node not found: ${toId}`);

    const paths: Path[] = [];

    const dfs = (current: string, target: string, visited: Set<string>, nodePath: GraphNode[], edgePath: Edge[], depth: number) => {
      if (depth > maxDepth) return;
      if (current === target) {
        paths.push({ nodes: [...nodePath], edges: [...edgePath] });
        return;
      }

      const outgoing = this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(current) as EdgeRow[];
      for (const row of outgoing) {
        if (!visited.has(row.target_id)) {
          visited.add(row.target_id);
          const node = this.getNode(row.target_id)!;
          nodePath.push(node);
          edgePath.push(toEdge(row));
          dfs(row.target_id, target, visited, nodePath, edgePath, depth + 1);
          nodePath.pop();
          edgePath.pop();
          visited.delete(row.target_id);
        }
      }
    };

    const visited = new Set<string>([fromId]);
    dfs(fromId, toId, visited, [fromNode], [], 0);
    return paths;
  }

  // --- Queries ---

  findStaleNodes(modelId: string, olderThanDays: number): GraphNode[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffStr = cutoff.toISOString();

    const rows = this.db.prepare(
      'SELECT * FROM nodes WHERE model_id = ? AND verified_at < ? ORDER BY verified_at'
    ).all(model.id, cutoffStr) as NodeRow[];
    return rows.map(toNode);
  }

  findOrphanNodes(modelId: string): GraphNode[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.model_id = ?
        AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.target_id = n.id)
      ORDER BY n.label
    `).all(model.id) as NodeRow[];
    return rows.map(toNode);
  }

  searchNodes(query: string): GraphNode[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare(
      'SELECT * FROM nodes WHERE label LIKE ? OR type LIKE ? ORDER BY label'
    ).all(pattern, pattern) as NodeRow[];
    return rows.map(toNode);
  }

  // --- Cross-model edges ---

  addCrossEdge(sourceNodeId: string, relationship: string, targetNodeId: string, metadata?: Record<string, unknown>): Edge {
    return this.addEdge({
      sourceId: sourceNodeId,
      targetId: targetNodeId,
      relationship,
      metadata,
    });
  }

  // --- Type Definitions ---

  listTypes(): TypeDef[] {
    const rows = this.db.prepare('SELECT * FROM type_defs ORDER BY label').all() as TypeDefRow[];
    return rows.map(toTypeDef);
  }

  getType(labelOrId: string): TypeDef | null {
    const row = this.db.prepare(
      'SELECT * FROM type_defs WHERE id = ? OR label = ?'
    ).get(labelOrId, labelOrId) as TypeDefRow | undefined;
    return row ? toTypeDef(row) : null;
  }

  addType(input: TypeInput): TypeDef {
    // Resolve parent
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = this.getType(input.parentId);
      if (!parent) throw new Error(`Parent type not found: ${input.parentId}`);
      parentId = parent.id;
    }

    // Check for duplicate label
    const existing = this.getType(input.label);
    if (existing) throw new Error(`Type already exists: ${input.label}`);

    const id = generateId('type');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO type_defs (id, label, parent_id, description, domain, built_in, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(id, input.label, parentId, input.description ?? null, input.domain ?? null, now);

    return this.getType(id)!;
  }

  deleteType(labelOrId: string): void {
    const typeDef = this.getType(labelOrId);
    if (!typeDef) throw new Error(`Type not found: ${labelOrId}`);
    if (typeDef.builtIn) throw new Error(`Cannot delete built-in type: ${typeDef.label}`);

    // Check for children
    const children = this.db.prepare(
      'SELECT id FROM type_defs WHERE parent_id = ?'
    ).all(typeDef.id) as Array<{ id: string }>;
    if (children.length > 0) {
      throw new Error(`Cannot delete type with children: ${typeDef.label}`);
    }

    this.db.prepare('DELETE FROM type_defs WHERE id = ?').run(typeDef.id);
  }

  getTypeWithSubtypes(labelOrId: string): string[] {
    const typeDef = this.getType(labelOrId);
    if (!typeDef) return [];

    // Recursive CTE to get all subtypes
    const rows = this.db.prepare(`
      WITH RECURSIVE subtypes AS (
        SELECT id FROM type_defs WHERE id = ?
        UNION ALL
        SELECT td.id FROM type_defs td
        JOIN subtypes s ON td.parent_id = s.id
      )
      SELECT id FROM subtypes
    `).all(typeDef.id) as Array<{ id: string }>;

    return rows.map(r => r.id);
  }

  // --- Relationship Definitions ---

  listRelDefs(): RelDef[] {
    const rows = this.db.prepare('SELECT * FROM rel_defs ORDER BY label').all() as RelDefRow[];
    return rows.map(toRelDef);
  }

  getRelDef(labelOrId: string): RelDef | null {
    // Also check inverse labels for reverse lookups
    const row = this.db.prepare(
      'SELECT * FROM rel_defs WHERE id = ? OR label = ? OR inverse_label = ?'
    ).get(labelOrId, labelOrId, labelOrId) as RelDefRow | undefined;
    return row ? toRelDef(row) : null;
  }

  addRelDef(input: RelDefInput): RelDef {
    const existing = this.db.prepare(
      'SELECT * FROM rel_defs WHERE label = ?'
    ).get(input.label) as RelDefRow | undefined;
    if (existing) throw new Error(`Relationship type already exists: ${input.label}`);

    const id = generateId('rel');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO rel_defs (id, label, inverse_label, description, source_type_constraint, target_type_constraint, built_in, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      input.label,
      input.inverseLabel ?? null,
      input.description ?? null,
      input.sourceTypeConstraint ?? null,
      input.targetTypeConstraint ?? null,
      now
    );

    return this.getRelDef(id)!;
  }

  deleteRelDef(labelOrId: string): void {
    const relDef = this.getRelDef(labelOrId);
    if (!relDef) throw new Error(`Relationship type not found: ${labelOrId}`);
    if (relDef.builtIn) throw new Error(`Cannot delete built-in relationship type: ${relDef.label}`);
    this.db.prepare('DELETE FROM rel_defs WHERE id = ?').run(relDef.id);
  }

  // --- Helpers ---

  private buildPath(_rootId: string, _targetId: string, _visited: Set<string>): string[] {
    return [_rootId];
  }

  close(): void {
    this.db.close();
  }
}
