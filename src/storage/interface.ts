// Storage Interface — the critical abstraction layer.
// All database operations go through this interface.
// Swap SQLite for Neo4j/etc later without touching anything above.

// ── Type Definitions ─────────────────────────────────

export interface TypeDef {
  id: string;
  label: string;
  parentId: string | null;
  description: string | null;
  domain: string | null;  // code, org, infra, concept, or null (universal)
  builtIn: boolean;
  createdAt: string;
}

export interface TypeInput {
  label: string;
  parentId?: string;
  description?: string;
  domain?: string;
}

// ── Relationship Definitions ─────────────────────────

export interface RelDef {
  id: string;
  label: string;
  inverseLabel: string | null;
  description: string | null;
  sourceTypeConstraint: string | null;
  targetTypeConstraint: string | null;
  builtIn: boolean;
  createdAt: string;
}

export interface RelDefInput {
  label: string;
  inverseLabel?: string;
  description?: string;
  sourceTypeConstraint?: string;
  targetTypeConstraint?: string;
}

// ── Models ───────────────────────────────────────────

export interface ModelInput {
  name: string;
  description?: string;
  type?: 'code' | 'org' | 'concept' | 'infra';
  sourceType?: 'git' | 'manual';
  anchor?: string;
  repoPath?: string;
}

export interface Model {
  id: string;
  name: string;
  description: string | null;
  type: 'code' | 'org' | 'concept' | 'infra';
  sourceType: 'git' | 'manual';
  anchor: string | null;
  repoPath: string | null;
  parentModelId: string | null;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeInput {
  label: string;
  type?: string;
  metadata?: Record<string, unknown>;
  id?: string; // optional custom ID
}

export interface GraphNode {
  id: string;
  modelId: string;
  label: string;
  type: string | null;
  typeId: string | null;
  metadata: Record<string, unknown>;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeInput {
  sourceId: string;
  targetId: string;
  relationship: string;
  metadata?: Record<string, unknown>;
  weight?: number;
}

export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  relId: string | null;
  metadata: Record<string, unknown>;
  weight: number | null;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TraversalNode {
  node: GraphNode;
  depth: number;
  path: string[]; // node IDs from root to this node
  edge?: Edge;    // the edge that led here
}

export interface TraversalResult {
  root: GraphNode;
  nodes: TraversalNode[];
}

export interface Path {
  nodes: GraphNode[];
  edges: Edge[];
}

export interface OverlayChange {
  id: string;
  modelId: string;
  changeType: 'add_node' | 'remove_node' | 'modify_node' | 'add_edge' | 'remove_edge' | 'modify_edge';
  targetId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  createdAt: string;
}

export interface StorageInterface {
  // Models
  createModel(model: ModelInput): Model;
  getModel(nameOrId: string): Model | null;
  listModels(): Model[];
  deleteModel(nameOrId: string): void;
  exportModel(nameOrId: string): {
    model: Model;
    nodes: GraphNode[];
    edges: Edge[];
    types: TypeDef[];
    relationships: RelDef[];
  };
  importModel(data: {
    model: ModelInput;
    nodes: NodeInput[];
    edges: EdgeInput[];
    types?: TypeInput[];
    relationships?: RelDefInput[];
  }): Model;

  // Nodes
  addNode(modelId: string, node: NodeInput): GraphNode;
  getNode(nodeId: string): GraphNode | null;
  findNode(modelId: string, label: string): GraphNode | null;
  updateNode(nodeId: string, updates: Partial<NodeInput>, contextModelId?: string): GraphNode;
  deleteNode(nodeId: string, contextModelId?: string): void;
  listNodes(modelId: string, filter?: { type?: string }): GraphNode[];
  verifyNode(nodeId: string): void;

  // Edges
  addEdge(edge: EdgeInput): Edge;
  getEdge(sourceId: string, targetId: string, relationship: string): Edge | null;
  deleteEdge(sourceId: string, targetId: string, relationship: string, contextModelId?: string): void;
  listEdges(modelId: string, filter?: { from?: string; to?: string; rel?: string }): Edge[];

  // Traversals
  getNeighbors(nodeId: string, depth?: number): TraversalResult;
  getAffects(nodeId: string, depth?: number): TraversalResult;
  getDependsOn(nodeId: string, depth?: number): TraversalResult;
  findPaths(fromId: string, toId: string, maxDepth?: number): Path[];

  // Queries
  findStaleNodes(modelId: string, olderThanDays: number): GraphNode[];
  findOrphanNodes(modelId: string): GraphNode[];
  searchNodes(query: string): GraphNode[];

  // Cross-model edges
  addCrossEdge(sourceNodeId: string, relationship: string, targetNodeId: string, metadata?: Record<string, unknown>): Edge;

  // Type Definitions
  listTypes(): TypeDef[];
  getType(labelOrId: string): TypeDef | null;
  addType(input: TypeInput): TypeDef;
  deleteType(labelOrId: string): void;
  getTypeWithSubtypes(labelOrId: string): string[];  // returns all type IDs including subtypes

  // Relationship Definitions
  listRelDefs(): RelDef[];
  getRelDef(labelOrId: string): RelDef | null;
  addRelDef(input: RelDefInput): RelDef;
  deleteRelDef(labelOrId: string): void;

  // Branch Overlays
  createBranch(modelId: string, branchName: string): Model;
  listBranches(modelId: string): Model[];
  mergeBranch(modelId: string, branchName: string): void;
  deleteBranch(modelId: string, branchName: string): void;

  // Git Integration
  getModelAnchor(modelId: string): { anchor: string | null; repoPath: string | null; branch: string | null };
  updateModelAnchor(modelId: string, anchor: string): void;
  refreshAllVerified(modelId: string): void;  // update verified_at on all nodes and edges
  findNodesByFile(modelId: string, filePaths: string[]): Map<string, GraphNode[]>;  // file path → matching nodes
  findStaleEdges(modelId: string, olderThanDays: number): Edge[];

  // Search
  searchAllModels(query: string, options?: {
    modelId?: string;
    limit?: number;
    excludeModels?: string[];
  }): Array<{ model: Model; node: GraphNode; edges: Edge[] }>;

  // Lifecycle
  close(): void;
}
