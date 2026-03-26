import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface, Path } from '../storage/interface.js';
import { resolveNode } from './node.js';
import { outputJson, outputError, isJsonMode } from '../utils/output.js';

export function registerPathCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('path <model> <from> <to>')
    .description('Find all paths between two nodes')
    .option('--max-depth <n>', 'Maximum path depth (default: 5)', parseInt)
    .action((modelName: string, fromRef: string, toRef: string, opts: { maxDepth?: number }) => {
      try {
        const storage = getStorage();
        const fromNode = resolveNode(storage, modelName, fromRef);
        const toNode = resolveNode(storage, modelName, toRef);
        const maxDepth = opts.maxDepth ?? 5;

        const paths = storage.findPaths(fromNode.id, toNode.id, maxDepth);

        // Sort by path length (shortest first — BFS-like ordering)
        paths.sort((a, b) => a.edges.length - b.edges.length);

        if (isJsonMode()) {
          // Build node map for label resolution
          const model = storage.getModel(modelName)!;
          const allNodes = storage.listNodes(model.id);
          const nodeMap = new Map(allNodes.map(n => [n.id, n]));

          const jsonPaths = paths.map((p, i) => ({
            index: i + 1,
            length: p.edges.length,
            edges: p.edges.map(e => ({
              source: nodeMap.get(e.sourceId)?.label ?? e.sourceId,
              relationship: e.relationship,
              target: nodeMap.get(e.targetId)?.label ?? e.targetId,
              metadata: e.metadata,
            })),
            nodes: p.nodes.map(n => ({
              label: n.label,
              type: n.type,
              id: n.id,
            })),
          }));

          outputJson({
            from: fromNode.label,
            to: toNode.label,
            pathCount: paths.length,
            paths: jsonPaths,
          });
          return;
        }

        // Human-readable output
        if (paths.length === 0) {
          console.log(`No paths from ${chalk.bold(fromNode.label)} to ${chalk.bold(toNode.label)} (max depth: ${maxDepth})`);
          return;
        }

        console.log(`Paths from ${chalk.bold(fromNode.label)} to ${chalk.bold(toNode.label)}:`);
        console.log('');

        // Build node map for label resolution
        const model = storage.getModel(modelName)!;
        const allNodes = storage.listNodes(model.id);
        const nodeMap = new Map(allNodes.map(n => [n.id, n]));

        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          console.log(`  Path ${i + 1} (length ${p.edges.length}):`);

          const parts: string[] = [];
          // Start with the source of the first edge
          const firstSrc = nodeMap.get(p.edges[0].sourceId);
          parts.push(chalk.bold(firstSrc?.label ?? p.edges[0].sourceId));

          for (const e of p.edges) {
            const tgtNode = nodeMap.get(e.targetId);
            parts.push(` ${chalk.cyan(`—[${e.relationship}]→`)} ${chalk.bold(tgtNode?.label ?? e.targetId)}`);
          }

          console.log(`    ${parts.join('')}`);
          console.log('');
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
