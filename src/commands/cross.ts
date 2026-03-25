import { Command } from 'commander';
import type { StorageInterface } from '../storage/interface.js';
import { resolveNode, parseMeta } from './node.js';
import { outputJson, outputNodes, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

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
        const edge = storage.addCrossEdge(
          node1.id,
          rel,
          node2.id,
          opts.meta ? parseMeta(opts.meta) : undefined,
        );
        if (isJsonMode()) {
          outputJson(edge);
        } else {
          outputSuccess(`Cross-linked ${node1.label} —[${rel}]→ ${node2.label}`);
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
            outputNodes(results);
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
