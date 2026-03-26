import { Command } from 'commander';
import type { StorageInterface } from '../storage/interface.js';
import { resolveNode, parseMeta } from './node.js';
import { outputEdges, outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

export function registerEdgeCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('link <model> <source> <rel> <target>')
    .description('Create an edge between two nodes')
    .option('-m, --meta <pairs...>', 'Metadata key=value pairs')
    .option('-w, --weight <n>', 'Edge weight', parseFloat)
    .action((modelName: string, sourceRef: string, rel: string, targetRef: string, opts: { meta?: string[]; weight?: number }) => {
      try {
        const storage = getStorage();
        const source = resolveNode(storage, modelName, sourceRef);
        const target = resolveNode(storage, modelName, targetRef);
        const edge = storage.addEdge({
          sourceId: source.id,
          targetId: target.id,
          relationship: rel,
          metadata: opts.meta ? parseMeta(opts.meta) : undefined,
          weight: opts.weight,
        });
        if (isJsonMode()) {
          outputJson(edge);
        } else {
          let msg = `Linked ${source.label} —[${rel}]→ ${target.label}`;
          // Show inverse if available
          const relDef = storage.getRelDef(rel);
          if (relDef?.inverseLabel) {
            msg += ` (inverse: ${target.label} —[${relDef.inverseLabel}]→ ${source.label})`;
          }
          outputSuccess(msg);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('unlink <model> <source> <rel> <target>')
    .description('Remove an edge between two nodes')
    .action((modelName: string, sourceRef: string, rel: string, targetRef: string) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);
        const source = resolveNode(storage, modelName, sourceRef);
        const target = resolveNode(storage, modelName, targetRef);
        storage.deleteEdge(source.id, target.id, rel, model.id);
        outputSuccess(`Unlinked ${source.label} —[${rel}]→ ${target.label}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('edges <model>')
    .description('List edges in a model')
    .option('-f, --from <node>', 'Filter by source node')
    .option('-t, --to <node>', 'Filter by target node')
    .option('-r, --rel <relationship>', 'Filter by relationship')
    .action((modelName: string, opts: { from?: string; to?: string; rel?: string }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);

        // Resolve node references if provided
        const filter: { from?: string; to?: string; rel?: string } = {};
        if (opts.from) {
          const fromNode = resolveNode(storage, modelName, opts.from);
          filter.from = fromNode.id;
        }
        if (opts.to) {
          const toNode = resolveNode(storage, modelName, opts.to);
          filter.to = toNode.id;
        }
        if (opts.rel) filter.rel = opts.rel;

        const edges = storage.listEdges(model.id, filter);

        // Build a node map for nice labels
        const nodes = storage.listNodes(model.id);
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        outputEdges(edges, nodeMap);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
