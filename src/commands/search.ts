import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface, Model, GraphNode, Edge } from '../storage/interface.js';
import { outputJson, outputError, isJsonMode } from '../utils/output.js';

export interface SearchResult {
  model: Model;
  node: GraphNode;
  edges: Edge[];
}

export function registerSearchCommand(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('search <query>')
    .description('Search across all models for nodes, types, metadata, and relationships')
    .option('-m, --model <name>', 'Search within a specific model')
    .option('-l, --limit <n>', 'Maximum results (default: 5)', parseInt)
    .option('-x, --exclude <name...>', 'Exclude specific models by name')
    .action((query: string, opts: {
      model?: string;
      limit?: number;
      exclude?: string[];
    }) => {
      try {
        const storage = getStorage();
        const results = storage.searchAllModels(query, {
          modelId: opts.model,
          limit: opts.limit ?? 5,
          excludeModels: opts.exclude,
        });

        if (isJsonMode()) {
          outputJson({
            results: results.map(r => ({
              model: r.model.name,
              modelType: r.model.type,
              node: {
                label: r.node.label,
                type: r.node.type,
                metadata: r.node.metadata,
              },
              edges: formatEdgesForJson(r.edges, r.node, storage),
            })),
          });
          return;
        }

        if (results.length === 0) {
          console.log(chalk.dim('No results found.'));
          return;
        }

        // Group results by model for human-readable output
        const grouped = new Map<string, SearchResult[]>();
        for (const r of results) {
          const key = r.model.name;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(r);
        }

        for (const [modelName, modelResults] of grouped) {
          const model = modelResults[0].model;
          console.log(`\n${chalk.bold.underline(`${modelName}`)} ${chalk.dim(`(${model.type})`)}`);

          for (const r of modelResults) {
            const typeStr = r.node.type ? ` ${chalk.dim(`(${r.node.type})`)}` : '';
            console.log(`  ${chalk.bold(r.node.label)}${typeStr}`);

            // Show edges grouped by direction
            const outgoing = r.edges.filter(e => e.sourceId === r.node.id);
            const incoming = r.edges.filter(e => e.targetId === r.node.id);

            for (const e of outgoing) {
              const targetNode = storage.getNode(e.targetId);
              const targetLabel = targetNode?.label ?? e.targetId;
              console.log(`    ${chalk.green('→')} ${e.relationship}: ${chalk.bold(targetLabel)}`);
            }

            for (const e of incoming) {
              const sourceNode = storage.getNode(e.sourceId);
              const sourceLabel = sourceNode?.label ?? e.sourceId;
              console.log(`    ${chalk.yellow('←')} ${e.relationship}: ${chalk.bold(sourceLabel)}`);
            }
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}

function formatEdgesForJson(
  edges: Edge[],
  node: GraphNode,
  storage: StorageInterface,
): Array<{ direction: 'in' | 'out'; relationship: string; source?: string; target?: string }> {
  return edges.map(e => {
    if (e.sourceId === node.id) {
      const targetNode = storage.getNode(e.targetId);
      return {
        direction: 'out' as const,
        relationship: e.relationship,
        target: targetNode?.label ?? e.targetId,
      };
    } else {
      const sourceNode = storage.getNode(e.sourceId);
      return {
        direction: 'in' as const,
        relationship: e.relationship,
        source: sourceNode?.label ?? e.sourceId,
      };
    }
  });
}
