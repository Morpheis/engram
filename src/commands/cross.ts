import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface, GraphNode } from '../storage/interface.js';
import { resolveNode, parseMeta } from './node.js';
import { outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

export function registerCrossCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('xlink <model1> <node1> <rel> <model2> <node2>')
    .description('Create a cross-model edge')
    .option('-m, --meta <pairs...>', 'Metadata key=value pairs')
    .action((m1: string, n1Ref: string, rel: string, m2: string, n2Ref: string, opts: { meta?: string[] }) => {
      try {
        const storage = getStorage();
        const node1 = resolveNode(storage, m1, n1Ref);
        const node2 = resolveNode(storage, m2, n2Ref);
        const model1 = storage.getModel(m1);
        const model2 = storage.getModel(m2);
        const edge = storage.addCrossEdge(
          node1.id,
          rel,
          node2.id,
          opts.meta ? parseMeta(opts.meta) : undefined,
        );
        if (isJsonMode()) {
          outputJson(edge);
        } else {
          const srcRef = `${model1!.name}:${node1.label}`;
          const tgtRef = `${model2!.name}:${node2.label}`;
          outputSuccess(`Cross-linked ${srcRef} —[${rel}]→ ${tgtRef}`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('xq <query>')
    .description('Search for a node across all models')
    .action((query: string) => {
      try {
        const storage = getStorage();
        const results = storage.searchNodes(query);
        if (isJsonMode()) {
          outputJson(results);
        } else {
          if (results.length === 0) {
            console.log(`No nodes matching "${query}"`);
          } else {
            console.log(`Found ${results.length} node(s) matching "${query}":`);
            outputNodesNamespaced(storage, results);
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}

/**
 * Display nodes with model namespace prefix.
 */
function outputNodesNamespaced(storage: StorageInterface, nodes: GraphNode[]): void {
  // Build model ID → name map
  const modelNameMap = new Map<string, string>();
  for (const n of nodes) {
    if (!modelNameMap.has(n.modelId)) {
      const model = storage.getModel(n.modelId);
      modelNameMap.set(n.modelId, model?.name ?? n.modelId);
    }
  }

  for (const n of nodes) {
    const modelName = modelNameMap.get(n.modelId) ?? n.modelId;
    const meta = Object.keys(n.metadata).length > 0 ? ` ${chalk.dim(JSON.stringify(n.metadata))}` : '';
    console.log(`  ${chalk.bold(n.label)}${n.type ? ` ${chalk.dim(`(${n.type})`)}` : ''} ${chalk.cyan(`[${modelName}]`)}${meta}  ${chalk.dim(n.id)}`);
  }
}
