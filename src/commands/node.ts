import { Command } from 'commander';
import type { StorageInterface } from '../storage/interface.js';
import { outputNode, outputNodes, outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

function parseMeta(metaPairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const pair of metaPairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      result[pair] = true;
    } else {
      const key = pair.substring(0, eqIdx);
      const val = pair.substring(eqIdx + 1);
      // Try to parse as number or boolean
      if (val === 'true') result[key] = true;
      else if (val === 'false') result[key] = false;
      else if (!isNaN(Number(val)) && val !== '') result[key] = Number(val);
      else result[key] = val;
    }
  }
  return result;
}

/** Resolve a node reference: could be an ID or a label within the model */
function resolveNode(storage: StorageInterface, modelNameOrId: string, ref: string) {
  const model = storage.getModel(modelNameOrId);
  if (!model) throw new Error(`Model not found: ${modelNameOrId}`);
  // Try by ID first
  const byId = storage.getNode(ref);
  if (byId) return byId;
  // Try by label
  const byLabel = storage.findNode(model.id, ref);
  if (byLabel) return byLabel;
  throw new Error(`Node not found: ${ref}`);
}

export { resolveNode, parseMeta };

export function registerNodeCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('add <model> <label>')
    .description('Add a node to a model')
    .option('-t, --type <type>', 'Node type')
    .option('-m, --meta <pairs...>', 'Metadata key=value pairs')
    .option('-i, --id <id>', 'Custom node ID')
    .action((modelName: string, label: string, opts: { type?: string; meta?: string[]; id?: string }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);
        const node = storage.addNode(model.id, {
          label,
          type: opts.type,
          metadata: opts.meta ? parseMeta(opts.meta) : undefined,
          id: opts.id,
        });
        if (isJsonMode()) {
          outputJson(node);
        } else {
          outputSuccess(`Added node ${node.label} (${node.id})`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('rm <model> <node-id>')
    .description('Remove a node and its edges')
    .action((modelName: string, nodeRef: string) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);
        const node = resolveNode(storage, modelName, nodeRef);
        storage.deleteNode(node.id, model.id);
        outputSuccess(`Removed node ${node.label}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('update <model> <node-id>')
    .description('Update a node')
    .option('-l, --label <label>', 'New label')
    .option('-t, --type <type>', 'New type')
    .option('-m, --meta <pairs...>', 'Metadata key=value pairs to merge')
    .action((modelName: string, nodeRef: string, opts: { label?: string; type?: string; meta?: string[] }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);
        const node = resolveNode(storage, modelName, nodeRef);
        const updated = storage.updateNode(node.id, {
          label: opts.label,
          type: opts.type,
          metadata: opts.meta ? parseMeta(opts.meta) : undefined,
        }, model.id);
        if (isJsonMode()) {
          outputJson(updated);
        } else {
          outputSuccess(`Updated node ${updated.label}`);
          outputNode(updated);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('verify <model> <node-id>')
    .description('Mark a node as verified now')
    .action((modelName: string, nodeRef: string) => {
      try {
        const storage = getStorage();
        const node = resolveNode(storage, modelName, nodeRef);
        storage.verifyNode(node.id);
        outputSuccess(`Verified node ${node.label}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('nodes <model>')
    .description('List nodes in a model')
    .option('-t, --type <type>', 'Filter by type')
    .action((modelName: string, opts: { type?: string }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);
        const nodes = storage.listNodes(model.id, opts.type ? { type: opts.type } : undefined);
        outputNodes(nodes);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
