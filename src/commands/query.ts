import { Command } from 'commander';
import type { StorageInterface } from '../storage/interface.js';
import { resolveNode } from './node.js';
import { outputTraversal, outputNodes, outputJson, outputError, isJsonMode } from '../utils/output.js';

export function registerQueryCommands(program: Command, getStorage: () => StorageInterface): void {
  const q = program
    .command('q <model> [node-id]')
    .description('Query a model — show node connections, traversals, or filtered views')
    .option('--depth <n>', 'Neighborhood depth', parseInt)
    .option('--affects <node>', 'Reverse dependency traversal')
    .option('--depends-on <node>', 'Forward dependency traversal')
    .option('-t, --type <type>', 'Filter nodes by type')
    .option('--stale', 'Find stale nodes')
    .option('--days <n>', 'Days threshold for stale (default: 30)', parseInt)
    .option('--orphans', 'Find orphan nodes (no edges)')
    .action((modelName: string, nodeId: string | undefined, opts: {
      depth?: number;
      affects?: string;
      dependsOn?: string;
      type?: string;
      stale?: boolean;
      days?: number;
      orphans?: boolean;
    }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);

        // --affects
        if (opts.affects) {
          const node = resolveNode(storage, modelName, opts.affects);
          const result = storage.getAffects(node.id, opts.depth ?? 10);
          outputTraversal(result);
          return;
        }

        // --depends-on
        if (opts.dependsOn) {
          const node = resolveNode(storage, modelName, opts.dependsOn);
          const result = storage.getDependsOn(node.id, opts.depth ?? 10);
          outputTraversal(result);
          return;
        }

        // --type
        if (opts.type) {
          const nodes = storage.listNodes(model.id, { type: opts.type });
          outputNodes(nodes);
          return;
        }

        // --stale
        if (opts.stale) {
          const days = opts.days ?? 30;
          const nodes = storage.findStaleNodes(model.id, days);
          if (isJsonMode()) {
            outputJson(nodes);
          } else {
            if (nodes.length === 0) {
              console.log(`No stale nodes (threshold: ${days} days)`);
            } else {
              console.log(`Stale nodes (not verified in ${days}+ days):`);
              outputNodes(nodes);
            }
          }
          return;
        }

        // --orphans
        if (opts.orphans) {
          const nodes = storage.findOrphanNodes(model.id);
          if (isJsonMode()) {
            outputJson(nodes);
          } else {
            if (nodes.length === 0) {
              console.log('No orphan nodes');
            } else {
              console.log('Orphan nodes (no edges):');
              outputNodes(nodes);
            }
          }
          return;
        }

        // Node query (with optional --depth)
        if (nodeId) {
          const node = resolveNode(storage, modelName, nodeId);
          const depth = opts.depth ?? 1;
          const result = storage.getNeighbors(node.id, depth);
          outputTraversal(result);
          return;
        }

        // No node specified and no flags — show model summary
        const nodes = storage.listNodes(model.id);
        const edges = storage.listEdges(model.id);
        if (isJsonMode()) {
          outputJson({ model, nodeCount: nodes.length, edgeCount: edges.length });
        } else {
          console.log(`Model: ${model.name} (${model.type})`);
          if (model.description) console.log(`  ${model.description}`);
          console.log(`  ${nodes.length} nodes, ${edges.length} edges`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
