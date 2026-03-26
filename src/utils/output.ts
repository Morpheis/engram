import chalk from 'chalk';
import type { Model, GraphNode, Edge, TraversalResult, TraversalNode, RelDef } from '../storage/interface.js';

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputModel(model: Model): void {
  if (jsonMode) return outputJson(model);
  console.log(`${chalk.bold(model.name)} ${chalk.dim(`(${model.type})`)}`);
  if (model.description) console.log(`  ${model.description}`);
  console.log(`  ${chalk.dim('id:')} ${model.id}`);
  if (model.repoPath) console.log(`  ${chalk.dim('repo:')} ${model.repoPath}`);
  console.log(`  ${chalk.dim('created:')} ${model.createdAt}`);
}

export function outputModels(models: Model[]): void {
  if (jsonMode) return outputJson(models);
  if (models.length === 0) {
    console.log(chalk.dim('No models found.'));
    return;
  }
  for (const m of models) {
    console.log(`  ${chalk.bold(m.name)} ${chalk.dim(`(${m.type})`)}${m.description ? ` — ${m.description}` : ''}`);
  }
}

export function outputNode(node: GraphNode): void {
  if (jsonMode) return outputJson(node);
  console.log(`${chalk.bold(node.label)}${node.type ? ` ${chalk.dim(`(${node.type})`)}` : ''}`);
  console.log(`  ${chalk.dim('id:')} ${node.id}`);
  if (Object.keys(node.metadata).length > 0) {
    console.log(`  ${chalk.dim('meta:')} ${JSON.stringify(node.metadata)}`);
  }
  console.log(`  ${chalk.dim('verified:')} ${node.verifiedAt}`);
}

export function outputNodes(nodes: GraphNode[]): void {
  if (jsonMode) return outputJson(nodes);
  if (nodes.length === 0) {
    console.log(chalk.dim('No nodes found.'));
    return;
  }
  for (const n of nodes) {
    const meta = Object.keys(n.metadata).length > 0 ? ` ${chalk.dim(JSON.stringify(n.metadata))}` : '';
    console.log(`  ${chalk.bold(n.label)}${n.type ? ` ${chalk.dim(`(${n.type})`)}` : ''}${meta}  ${chalk.dim(n.id)}`);
  }
}

export function outputEdge(edge: Edge): void {
  if (jsonMode) return outputJson(edge);
  console.log(`${edge.sourceId} ${chalk.cyan(`—[${edge.relationship}]→`)} ${edge.targetId}${edge.weight != null ? ` ${chalk.dim(`w:${edge.weight}`)}` : ''}`);
}

export function outputEdges(edges: Edge[], nodeMap?: Map<string, GraphNode>): void {
  if (jsonMode) return outputJson(edges);
  if (edges.length === 0) {
    console.log(chalk.dim('No edges found.'));
    return;
  }
  for (const e of edges) {
    const srcLabel = nodeMap?.get(e.sourceId)?.label ?? e.sourceId;
    const tgtLabel = nodeMap?.get(e.targetId)?.label ?? e.targetId;
    const meta = Object.keys(e.metadata).length > 0 ? ` ${chalk.dim(JSON.stringify(e.metadata))}` : '';
    console.log(`  ${srcLabel} ${chalk.cyan(`—[${e.relationship}]→`)} ${tgtLabel}${e.weight != null ? ` ${chalk.dim(`w:${e.weight}`)}` : ''}${meta}`);
  }
}

// Optional relDef map for showing inverse labels in traversal output
let relDefMap: Map<string, RelDef> | null = null;

export function setRelDefMap(map: Map<string, RelDef>): void {
  relDefMap = map;
}

export function outputTraversal(result: TraversalResult): void {
  if (jsonMode) return outputJson(result);
  const { root, nodes } = result;
  console.log(`${chalk.bold(root.label)}${root.type ? ` ${chalk.dim(`(${root.type})`)}` : ''}`);

  // Group by incoming and outgoing
  const incoming: TraversalNode[] = [];
  const outgoing: TraversalNode[] = [];

  for (const tn of nodes) {
    if (!tn.edge) continue;
    if (tn.edge.targetId === root.id) {
      incoming.push(tn);
    } else {
      outgoing.push(tn);
    }
  }

  for (const tn of incoming) {
    const indent = '  '.repeat(tn.depth);
    const metaStr = tn.edge && Object.keys(tn.edge.metadata).length > 0
      ? ` ${chalk.dim(`(${formatEdgeMeta(tn.edge.metadata)})`)}`
      : '';
    // Use inverse label if available
    const rel = tn.edge!.relationship;
    const relDef = relDefMap?.get(rel);
    const displayRel = relDef?.inverseLabel ?? rel;
    console.log(`${indent}${chalk.yellow('←')} ${displayRel}: ${chalk.bold(tn.node.label)}${metaStr}`);
  }

  for (const tn of outgoing) {
    const indent = '  '.repeat(tn.depth);
    const metaStr = tn.edge && Object.keys(tn.edge.metadata).length > 0
      ? ` ${chalk.dim(`(${formatEdgeMeta(tn.edge.metadata)})`)}`
      : '';
    console.log(`${indent}${chalk.green('→')} ${tn.edge!.relationship}: ${chalk.bold(tn.node.label)}${metaStr}`);
  }
}

function formatEdgeMeta(meta: Record<string, unknown>): string {
  return Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ');
}

export function outputSuccess(msg: string): void {
  if (!jsonMode) console.log(chalk.green('✓') + ' ' + msg);
}

export function outputError(msg: string): void {
  console.error(chalk.red('✗') + ' ' + msg);
}
