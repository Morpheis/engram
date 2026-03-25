import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import type { StorageInterface } from '../storage/interface.js';
import { outputModel, outputModels, outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

export function registerModelCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('create <name>')
    .description('Create a new model')
    .option('-t, --type <type>', 'Model type (code|org|concept|infra)', 'concept')
    .option('-d, --description <desc>', 'Model description')
    .option('-r, --repo <path>', 'Repository path')
    .action((name: string, opts: { type?: string; description?: string; repo?: string }) => {
      try {
        const storage = getStorage();
        const model = storage.createModel({
          name,
          type: opts.type as 'code' | 'org' | 'concept' | 'infra',
          description: opts.description,
          repoPath: opts.repo,
          sourceType: opts.repo ? 'git' : 'manual',
        });
        if (isJsonMode()) {
          outputJson(model);
        } else {
          outputSuccess(`Created model ${model.name}`);
          outputModel(model);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('list')
    .description('List all models')
    .action(() => {
      const storage = getStorage();
      const models = storage.listModels();
      outputModels(models);
    });

  program
    .command('delete <name>')
    .description('Delete a model and all its nodes/edges')
    .action((name: string) => {
      try {
        const storage = getStorage();
        storage.deleteModel(name);
        outputSuccess(`Deleted model ${name}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('export <name>')
    .description('Export a model to JSON')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('-f, --format <format>', 'Export format', 'json')
    .action((name: string, opts: { output?: string; format?: string }) => {
      try {
        const storage = getStorage();
        const data = storage.exportModel(name);
        const json = JSON.stringify(data, null, 2);
        if (opts.output) {
          writeFileSync(opts.output, json);
          outputSuccess(`Exported to ${opts.output}`);
        } else {
          console.log(json);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('import <file>')
    .description('Import a model from JSON file')
    .action((file: string) => {
      try {
        const storage = getStorage();
        const raw = readFileSync(file, 'utf-8');
        const data = JSON.parse(raw);
        const model = storage.importModel({
          model: data.model,
          nodes: data.nodes,
          edges: data.edges,
        });
        if (isJsonMode()) {
          outputJson(model);
        } else {
          outputSuccess(`Imported model ${model.name}`);
          outputModel(model);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
