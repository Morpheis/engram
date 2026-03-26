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
  OverlayChange,
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
  parent_model_id: string | null;
  branch: string | null;
  created_at: string;
  updated_at: string;
}

interface OverlayChangeRow {
  id: string;
  model_id: string;
  change_type: string;
  target_id: string;
  old_data: string | null;
  new_data: string | null;
  created_at: string;
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
    parentModelId: row.parent_model_id ?? null,
    branch: row.branch ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOverlayChange(row: OverlayChangeRow): OverlayChange {
  return {
    id: row.id,
    modelId: row.model_id,
    changeType: row.change_type as OverlayChange['changeType'],
    targetId: row.target_id,
    oldData: row.old_data ? JSON.parse(row.old_data) : null,
    newData: row.new_data ? JSON.parse(row.new_data) : null,
    createdAt: row.created_at,
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

  exportModel(nameOrId: string): {
    model: Model;
    nodes: GraphNode[];
    edges: Edge[];
    types: TypeDef[];
    relationships: RelDef[];
  } {
    const model = this.getModel(nameOrId);
    if (!model) throw new Error(`Model not found: ${nameOrId}`);

    // Use overlay-aware resolution (listNodes/listEdges handle overlays)
    const nodes = this.listNodes(model.id);
    const nodeIds = new Set(nodes.map(n => n.id));
    const allEdges = this.listEdges(model.id);
    const edges = allEdges.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));

    // Collect types used in this model's nodes
    const usedTypeLabels = new Set(nodes.map(n => n.type).filter(Boolean) as string[]);
    const types = this.listTypes().filter(t => usedTypeLabels.has(t.label));

    // Collect relationships used in this model's edges
    const usedRelLabels = new Set(edges.map(e => e.relationship));
    const relationships = this.listRelDefs().filter(r => usedRelLabels.has(r.label));

    return { model, nodes, edges, types, relationships };
  }

  importModel(data: {
    model: ModelInput;
    nodes: NodeInput[];
    edges: EdgeInput[];
    types?: TypeInput[];
    relationships?: RelDefInput[];
  }): Model {
    // Import custom types (skip existing / built-in)
    if (data.types) {
      for (const typeInput of data.types) {
        const existing = this.getType(typeInput.label);
        if (!existing) {
          try {
            this.addType(typeInput);
          } catch {
            // Ignore duplicates
          }
        }
      }
    }

    // Import custom relationships (skip existing / built-in)
    if (data.relationships) {
      for (const relInput of data.relationships) {
        const existing = this.getRelDef(relInput.label);
        if (!existing) {
          try {
            this.addRelDef(relInput);
          } catch {
            // Ignore duplicates
          }
        }
      }
    }

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

    const node = this.getNode(id)!;

    // Record overlay change if this is a branch overlay
    if (this.isOverlay(model.id)) {
      this.recordOverlayChange(model.id, 'add_node', id, null, {
        label: node.label,
        type: node.type,
        typeId: node.typeId,
        metadata: node.metadata,
      });
    }

    return node;
  }

  getNode(nodeId: string): GraphNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
    return row ? toNode(row) : null;
  }

  findNode(modelId: string, label: string): GraphNode | null {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    // Check overlay's own nodes first
    const row = this.db.prepare(
      'SELECT * FROM nodes WHERE model_id = ? AND label = ?'
    ).get(model.id, label) as NodeRow | undefined;
    if (row) return toNode(row);

    // If this is an overlay, also check parent model
    const parentId = this.getParentModelId(model.id);
    if (parentId) {
      // Check if node was removed in this overlay
      const changes = this.getOverlayChanges(model.id);
      const removedIds = new Set(
        changes.filter(c => c.changeType === 'remove_node').map(c => c.targetId)
      );

      const parentRow = this.db.prepare(
        'SELECT * FROM nodes WHERE model_id = ? AND label = ?'
      ).get(parentId, label) as NodeRow | undefined;

      if (parentRow && !removedIds.has(parentRow.id)) {
        return toNode(parentRow);
      }
    }

    return null;
  }

  updateNode(nodeId: string, updates: Partial<NodeInput>, contextModelId?: string): GraphNode {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const now = new Date().toISOString();
    const newLabel = updates.label ?? node.label;
    const newType = updates.type !== undefined ? updates.type : node.type;
    const newMetaObj = updates.metadata
      ? { ...node.metadata, ...updates.metadata }
      : node.metadata;
    const newMeta = JSON.stringify(newMetaObj);

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

    // If operating in overlay context and node belongs to the parent, record a modify_node change
    if (contextModelId) {
      const parentId = this.getParentModelId(contextModelId);
      if (parentId && node.modelId === parentId) {
        // Record the modification in overlay_changes
        this.recordOverlayChange(contextModelId, 'modify_node', nodeId, {
          label: node.label,
          type: node.type,
          typeId: node.typeId,
          metadata: node.metadata,
        }, {
          label: newLabel,
          type: newType,
          typeId: typeId,
          metadata: newMetaObj,
        });

        // Don't actually modify the parent node — the overlay_changes record handles it
        // Return a virtual updated node
        return {
          ...node,
          label: newLabel,
          type: newType ?? null,
          typeId: typeId,
          metadata: newMetaObj,
          updatedAt: now,
        };
      }
    }

    this.db.prepare(`
      UPDATE nodes SET label = ?, type = ?, type_id = ?, metadata = ?, updated_at = ? WHERE id = ?
    `).run(newLabel, newType ?? null, typeId, newMeta, now, nodeId);

    return this.getNode(nodeId)!;
  }

  deleteNode(nodeId: string, contextModelId?: string): void {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    // If a context model is provided and it's an overlay, handle overlay-aware deletion
    if (contextModelId) {
      const parentId = this.getParentModelId(contextModelId);
      if (parentId && node.modelId === parentId) {
        // Node belongs to parent — record removal in overlay, don't actually delete
        this.recordOverlayChange(contextModelId, 'remove_node', nodeId, {
          label: node.label,
          type: node.type,
          typeId: node.typeId,
          metadata: node.metadata,
        }, null);

        // Also record removal for any parent edges connected to this node
        const parentEdges = this._listEdgesRaw(parentId);
        for (const edge of parentEdges) {
          if (edge.sourceId === nodeId || edge.targetId === nodeId) {
            this.recordOverlayChange(contextModelId, 'remove_edge', edge.id, {
              sourceId: edge.sourceId,
              targetId: edge.targetId,
              relationship: edge.relationship,
              relId: edge.relId,
              metadata: edge.metadata,
              weight: edge.weight,
            }, null);
          }
        }
        return;
      }
      if (parentId && node.modelId === contextModelId) {
        // Node belongs to this overlay — delete normally and clean up overlay_change records
        this.db.prepare(
          'DELETE FROM overlay_changes WHERE model_id = ? AND target_id = ?'
        ).run(contextModelId, nodeId);
      }
    }

    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
  }

  listNodes(modelId: string, filter?: { type?: string }): GraphNode[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    // Use overlay-aware resolution
    return this.resolveNodes(model.id, filter);
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

    const edge = this.getEdgeById(id)!;

    // Record overlay change if source node belongs to an overlay model
    // Determine the overlay model — check if source or target is in an overlay
    const sourceModel = this.getModel(source.modelId);
    if (sourceModel && this.isOverlay(sourceModel.id)) {
      this.recordOverlayChange(sourceModel.id, 'add_edge', id, null, {
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relationship: edge.relationship,
        relId: edge.relId,
        metadata: edge.metadata,
        weight: edge.weight,
      });
    }

    return edge;
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

  deleteEdge(sourceId: string, targetId: string, relationship: string, contextModelId?: string): void {
    const edge = this.getEdge(sourceId, targetId, relationship);
    if (!edge) throw new Error(`Edge not found: ${sourceId} —[${relationship}]→ ${targetId}`);

    // If a context model is provided and it's an overlay, handle overlay-aware deletion
    if (contextModelId) {
      const parentId = this.getParentModelId(contextModelId);
      if (parentId) {
        // Check if the edge's source belongs to the parent model
        const source = this.getNode(sourceId);
        if (source && source.modelId === parentId) {
          // Edge belongs to parent — record removal in overlay, don't actually delete
          this.recordOverlayChange(contextModelId, 'remove_edge', edge.id, {
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            relationship: edge.relationship,
            relId: edge.relId,
            metadata: edge.metadata,
            weight: edge.weight,
          }, null);
          return;
        }
        // Edge belongs to overlay — delete normally and clean up overlay_change records
        this.db.prepare(
          'DELETE FROM overlay_changes WHERE model_id = ? AND target_id = ?'
        ).run(contextModelId, edge.id);
      }
    }

    this.db.prepare('DELETE FROM edges WHERE id = ?').run(edge.id);
  }

  listEdges(modelId: string, filter?: { from?: string; to?: string; rel?: string }): Edge[] {
    const model = this.getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    // Use overlay-aware resolution
    return this.resolveEdges(model.id, filter);
  }

  // --- Traversals ---

  getNeighbors(nodeId: string, depth: number = 1): TraversalResult {
    const root = this.getNode(nodeId);
    if (!root) throw new Error(`Node not found: ${nodeId}`);

    // Determine overlay context for edge resolution
    const overlayContext = this.getOverlayContextForNode(root);

    const visited = new Set<string>([root.id]);
    const result: TraversalNode[] = [];
    let frontier = [root.id];

    for (let d = 1; d <= depth; d++) {
      const nextFrontier: string[] = [];

      for (const nid of frontier) {
        const { outgoing, incoming } = this.getResolvedEdgesForNode(nid, overlayContext);

        for (const edge of outgoing) {
          if (!visited.has(edge.targetId)) {
            visited.add(edge.targetId);
            nextFrontier.push(edge.targetId);
            const node = this.getNode(edge.targetId)!;
            result.push({
              node,
              depth: d,
              path: [...this.buildPath(root.id, edge.targetId, visited), edge.targetId],
              edge,
            });
          }
        }

        for (const edge of incoming) {
          if (!visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            nextFrontier.push(edge.sourceId);
            const node = this.getNode(edge.sourceId)!;
            result.push({
              node,
              depth: d,
              path: [...this.buildPath(root.id, edge.sourceId, visited), edge.sourceId],
              edge,
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

    const overlayContext = this.getOverlayContextForNode(root);

    const visited = new Set<string>([root.id]);
    const result: TraversalNode[] = [];
    let frontier: Array<{ id: string; path: string[] }> = [{ id: root.id, path: [root.id] }];

    for (let d = 1; d <= maxDepth; d++) {
      const nextFrontier: Array<{ id: string; path: string[] }> = [];

      for (const { id: nid, path } of frontier) {
        const resolved = this.getResolvedEdgesForNode(nid, overlayContext);
        const edges = direction === 'incoming' ? resolved.incoming : resolved.outgoing;

        for (const edge of edges) {
          const nextId = direction === 'incoming' ? edge.sourceId : edge.targetId;
          if (!visited.has(nextId)) {
            visited.add(nextId);
            const newPath = [...path, nextId];
            nextFrontier.push({ id: nextId, path: newPath });
            const node = this.getNode(nextId)!;
            result.push({
              node,
              depth: d,
              path: newPath,
              edge,
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

  // --- Branch Overlays ---

  createBranch(modelId: string, branchName: string): Model {
    const parent = this.getModel(modelId);
    if (!parent) throw new Error(`Model not found: ${modelId}`);

    // Check if branch already exists
    const existing = this.db.prepare(
      'SELECT id FROM models WHERE parent_model_id = ? AND branch = ?'
    ).get(parent.id, branchName);
    if (existing) throw new Error(`Branch already exists: ${branchName}`);

    const id = generateId('mdl');
    const now = new Date().toISOString();
    const name = `${parent.name}/${branchName}`;

    this.db.prepare(`
      INSERT INTO models (id, name, description, type, source_type, anchor, repo_path, parent_model_id, branch, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      parent.description,
      parent.type,
      parent.sourceType,
      parent.anchor,
      parent.repoPath,
      parent.id,
      branchName,
      now, now
    );

    return this.getModel(id)!;
  }

  listBranches(modelId: string): Model[] {
    const parent = this.getModel(modelId);
    if (!parent) throw new Error(`Model not found: ${modelId}`);

    const rows = this.db.prepare(
      'SELECT * FROM models WHERE parent_model_id = ? ORDER BY branch'
    ).all(parent.id) as ModelRow[];
    return rows.map(toModel);
  }

  mergeBranch(modelId: string, branchName: string): void {
    const parent = this.getModel(modelId);
    if (!parent) throw new Error(`Model not found: ${modelId}`);

    const overlay = this.db.prepare(
      'SELECT * FROM models WHERE parent_model_id = ? AND branch = ?'
    ).get(parent.id, branchName) as ModelRow | undefined;
    if (!overlay) throw new Error(`Branch not found: ${branchName}`);

    const overlayModel = toModel(overlay);

    // Get overlay changes
    const changes = this.db.prepare(
      'SELECT * FROM overlay_changes WHERE model_id = ? ORDER BY created_at'
    ).all(overlayModel.id) as OverlayChangeRow[];

    const mergeTransaction = this.db.transaction(() => {
      for (const change of changes) {
        const oc = toOverlayChange(change);
        switch (oc.changeType) {
          case 'add_node': {
            // The node already exists in overlay — re-parent it to parent model
            const node = this.getNode(oc.targetId);
            if (node) {
              this.db.prepare('UPDATE nodes SET model_id = ? WHERE id = ?').run(parent.id, oc.targetId);
            }
            break;
          }
          case 'remove_node': {
            // Delete the node from parent
            const node = this.getNode(oc.targetId);
            if (node && node.modelId === parent.id) {
              this.db.prepare('DELETE FROM nodes WHERE id = ?').run(oc.targetId);
            }
            break;
          }
          case 'modify_node': {
            // Apply modifications to parent node
            if (oc.newData) {
              const data = oc.newData as Record<string, unknown>;
              this.db.prepare(`
                UPDATE nodes SET label = ?, type = ?, type_id = ?, metadata = ?, updated_at = ? WHERE id = ?
              `).run(
                data.label as string,
                (data.type as string) ?? null,
                (data.typeId as string) ?? null,
                JSON.stringify(data.metadata ?? {}),
                new Date().toISOString(),
                oc.targetId
              );
            }
            break;
          }
          case 'add_edge': {
            // The edge already exists in overlay — just keep it (nodes were re-parented above)
            // No action needed since edges reference node IDs, not model IDs
            break;
          }
          case 'remove_edge': {
            // Delete the edge from parent
            this.db.prepare('DELETE FROM edges WHERE id = ?').run(oc.targetId);
            break;
          }
          case 'modify_edge': {
            // Apply modifications to parent edge
            if (oc.newData) {
              const data = oc.newData as Record<string, unknown>;
              this.db.prepare(`
                UPDATE edges SET relationship = ?, rel_id = ?, metadata = ?, weight = ?, updated_at = ? WHERE id = ?
              `).run(
                data.relationship as string,
                (data.relId as string) ?? null,
                JSON.stringify(data.metadata ?? {}),
                (data.weight as number) ?? null,
                new Date().toISOString(),
                oc.targetId
              );
            }
            break;
          }
        }
      }

      // Move any remaining overlay-only nodes to parent (in case they weren't tracked as add_node changes)
      this.db.prepare('UPDATE nodes SET model_id = ? WHERE model_id = ?').run(parent.id, overlayModel.id);

      // Clean up overlay changes
      this.db.prepare('DELETE FROM overlay_changes WHERE model_id = ?').run(overlayModel.id);

      // Delete overlay model
      this.db.prepare('DELETE FROM models WHERE id = ?').run(overlayModel.id);
    });

    mergeTransaction();
  }

  deleteBranch(modelId: string, branchName: string): void {
    const parent = this.getModel(modelId);
    if (!parent) throw new Error(`Model not found: ${modelId}`);

    const overlay = this.db.prepare(
      'SELECT * FROM models WHERE parent_model_id = ? AND branch = ?'
    ).get(parent.id, branchName) as ModelRow | undefined;
    if (!overlay) throw new Error(`Branch not found: ${branchName}`);

    // Delete overlay changes, nodes, edges, and the model itself
    // Foreign key cascades handle nodes/edges
    this.db.prepare('DELETE FROM overlay_changes WHERE model_id = ?').run(overlay.id);
    this.db.prepare('DELETE FROM models WHERE id = ?').run(overlay.id);
  }

  // --- Overlay Resolution Helpers ---

  /** Check if a model is a branch overlay */
  private isOverlay(modelId: string): boolean {
    const row = this.db.prepare(
      'SELECT parent_model_id FROM models WHERE id = ?'
    ).get(modelId) as { parent_model_id: string | null } | undefined;
    return !!row?.parent_model_id;
  }

  /** Get the parent model ID for an overlay, or null */
  private getParentModelId(modelId: string): string | null {
    const row = this.db.prepare(
      'SELECT parent_model_id FROM models WHERE id = ?'
    ).get(modelId) as { parent_model_id: string | null } | undefined;
    return row?.parent_model_id ?? null;
  }

  /** Get overlay changes for a model */
  private getOverlayChanges(modelId: string): OverlayChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM overlay_changes WHERE model_id = ? ORDER BY created_at'
    ).all(modelId) as OverlayChangeRow[];
    return rows.map(toOverlayChange);
  }

  /**
   * Determine the overlay context for a node.
   * If the node belongs to an overlay model, return that model's ID.
   * If the node belongs to a parent that has overlays, return null (no overlay context).
   */
  private getOverlayContextForNode(node: GraphNode): string | null {
    // Check if the node's model is an overlay
    if (this.isOverlay(node.modelId)) {
      return node.modelId;
    }
    // Check if the node's model is a parent, and the node was accessed through an overlay
    // This requires more context — for now, return null
    return null;
  }

  /**
   * Get resolved edges for a node, considering overlay context.
   * Returns both outgoing and incoming edges, with overlay changes applied.
   */
  private getResolvedEdgesForNode(nodeId: string, overlayModelId: string | null): { outgoing: Edge[]; incoming: Edge[] } {
    // Get direct edges from the database
    const outgoingRows = this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(nodeId) as EdgeRow[];
    const incomingRows = this.db.prepare('SELECT * FROM edges WHERE target_id = ?').all(nodeId) as EdgeRow[];

    let outgoing = outgoingRows.map(toEdge);
    let incoming = incomingRows.map(toEdge);

    if (overlayModelId) {
      const changes = this.getOverlayChanges(overlayModelId);
      const removedEdgeIds = new Set(
        changes.filter(c => c.changeType === 'remove_edge').map(c => c.targetId)
      );
      const removedNodeIds = new Set(
        changes.filter(c => c.changeType === 'remove_node').map(c => c.targetId)
      );

      // Filter out removed edges and edges connected to removed nodes
      outgoing = outgoing.filter(e =>
        !removedEdgeIds.has(e.id) && !removedNodeIds.has(e.targetId)
      );
      incoming = incoming.filter(e =>
        !removedEdgeIds.has(e.id) && !removedNodeIds.has(e.sourceId)
      );

      // Also get edges from the parent model if this node belongs to the parent
      const parentId = this.getParentModelId(overlayModelId);
      if (parentId) {
        // Edges from overlay nodes connecting to parent nodes are already in the DB
        // We just need to make sure we're not double-counting
        // The node itself might be in the parent, and we need edges from both parent and overlay
      }
    }

    return { outgoing, incoming };
  }

  /** Record an overlay change */
  private recordOverlayChange(
    modelId: string,
    changeType: OverlayChange['changeType'],
    targetId: string,
    oldData?: Record<string, unknown> | null,
    newData?: Record<string, unknown> | null,
  ): void {
    const id = generateId('oc');
    this.db.prepare(`
      INSERT INTO overlay_changes (id, model_id, change_type, target_id, old_data, new_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      modelId,
      changeType,
      targetId,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null,
    );
  }

  /**
   * Resolve nodes for a model, merging parent + overlay if applicable.
   * Returns the fully merged node list.
   */
  private resolveNodes(modelId: string, filter?: { type?: string }): GraphNode[] {
    const parentId = this.getParentModelId(modelId);
    if (!parentId) {
      // Not an overlay — direct query (existing behavior)
      return this._listNodesRaw(modelId, filter);
    }

    // Get parent nodes
    const parentNodes = this._listNodesRaw(parentId, filter);

    // Get overlay's own nodes
    const overlayNodes = this._listNodesRaw(modelId, filter);

    // Get overlay changes
    const changes = this.getOverlayChanges(modelId);

    // Build sets of removed and modified node IDs
    const removedNodeIds = new Set<string>();
    const modifiedNodes = new Map<string, Record<string, unknown>>();

    for (const change of changes) {
      if (change.changeType === 'remove_node') {
        removedNodeIds.add(change.targetId);
      } else if (change.changeType === 'modify_node' && change.newData) {
        modifiedNodes.set(change.targetId, change.newData);
      }
    }

    // Merge: parent nodes (minus removed, plus modifications) + overlay nodes
    const result: GraphNode[] = [];
    const seenIds = new Set<string>();

    for (const node of parentNodes) {
      if (removedNodeIds.has(node.id)) continue;

      const mod = modifiedNodes.get(node.id);
      if (mod) {
        result.push({
          ...node,
          label: (mod.label as string) ?? node.label,
          type: (mod.type as string) ?? node.type,
          typeId: (mod.typeId as string) ?? node.typeId,
          metadata: (mod.metadata as Record<string, unknown>) ?? node.metadata,
        });
      } else {
        result.push(node);
      }
      seenIds.add(node.id);
    }

    for (const node of overlayNodes) {
      if (!seenIds.has(node.id)) {
        result.push(node);
        seenIds.add(node.id);
      }
    }

    // Sort by label for consistency
    result.sort((a, b) => a.label.localeCompare(b.label));
    return result;
  }

  /**
   * Resolve edges for a model, merging parent + overlay if applicable.
   */
  private resolveEdges(modelId: string, filter?: { from?: string; to?: string; rel?: string }): Edge[] {
    const parentId = this.getParentModelId(modelId);
    if (!parentId) {
      return this._listEdgesRaw(modelId, filter);
    }

    // Get parent edges
    const parentEdges = this._listEdgesRaw(parentId, filter);

    // Get overlay's own edges
    const overlayEdges = this._listEdgesRaw(modelId, filter);

    // Get overlay changes
    const changes = this.getOverlayChanges(modelId);

    const removedEdgeIds = new Set<string>();
    const modifiedEdges = new Map<string, Record<string, unknown>>();

    for (const change of changes) {
      if (change.changeType === 'remove_edge') {
        removedEdgeIds.add(change.targetId);
      } else if (change.changeType === 'modify_edge' && change.newData) {
        modifiedEdges.set(change.targetId, change.newData);
      }
    }

    // Also exclude edges that reference removed nodes
    const removedNodeIds = new Set<string>();
    for (const change of changes) {
      if (change.changeType === 'remove_node') {
        removedNodeIds.add(change.targetId);
      }
    }

    const result: Edge[] = [];
    const seenIds = new Set<string>();

    for (const edge of parentEdges) {
      if (removedEdgeIds.has(edge.id)) continue;
      if (removedNodeIds.has(edge.sourceId) || removedNodeIds.has(edge.targetId)) continue;

      const mod = modifiedEdges.get(edge.id);
      if (mod) {
        result.push({
          ...edge,
          relationship: (mod.relationship as string) ?? edge.relationship,
          relId: (mod.relId as string) ?? edge.relId,
          metadata: (mod.metadata as Record<string, unknown>) ?? edge.metadata,
          weight: mod.weight !== undefined ? (mod.weight as number | null) : edge.weight,
        });
      } else {
        result.push(edge);
      }
      seenIds.add(edge.id);
    }

    for (const edge of overlayEdges) {
      if (!seenIds.has(edge.id)) {
        result.push(edge);
        seenIds.add(edge.id);
      }
    }

    result.sort((a, b) => a.relationship.localeCompare(b.relationship));
    return result;
  }

  /** Raw node listing without overlay resolution */
  private _listNodesRaw(modelId: string, filter?: { type?: string }): GraphNode[] {
    if (filter?.type) {
      const subtypeIds = this.getTypeWithSubtypes(filter.type);
      if (subtypeIds.length > 0) {
        const placeholders = subtypeIds.map(() => '?').join(',');
        const typeLabels = (this.db.prepare(
          `SELECT label FROM type_defs WHERE id IN (${placeholders})`
        ).all(...subtypeIds) as Array<{ label: string }>).map(r => r.label);
        const allLabels = [...new Set([filter.type, ...typeLabels])];
        const labelPlaceholders = allLabels.map(() => '?').join(',');
        const sql = `SELECT * FROM nodes WHERE model_id = ? AND type IN (${labelPlaceholders}) ORDER BY label`;
        return (this.db.prepare(sql).all(modelId, ...allLabels) as NodeRow[]).map(toNode);
      } else {
        const sql = 'SELECT * FROM nodes WHERE model_id = ? AND type = ? ORDER BY label';
        return (this.db.prepare(sql).all(modelId, filter.type) as NodeRow[]).map(toNode);
      }
    }
    const sql = 'SELECT * FROM nodes WHERE model_id = ? ORDER BY label';
    return (this.db.prepare(sql).all(modelId) as NodeRow[]).map(toNode);
  }

  /** Raw edge listing without overlay resolution */
  private _listEdgesRaw(modelId: string, filter?: { from?: string; to?: string; rel?: string }): Edge[] {
    let sql = `
      SELECT e.* FROM edges e
      JOIN nodes n ON e.source_id = n.id
      WHERE n.model_id = ?
    `;
    const params: unknown[] = [modelId];

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

  // --- Helpers ---

  private buildPath(_rootId: string, _targetId: string, _visited: Set<string>): string[] {
    return [_rootId];
  }

  close(): void {
    this.db.close();
  }
}
