import { Command } from 'commander';
import type { StorageInterface } from '../storage/interface.js';
import { outputModel, outputModels, outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

export function registerBranchCommands(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('branch <model> [branch-name]')
    .description('Create, list, or delete branch overlays')
    .option('-l, --list', 'List all branch overlays')
    .option('-d, --delete', 'Delete the branch overlay')
    .action((modelName: string, branchName: string | undefined, opts: { list?: boolean; delete?: boolean }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);

        if (opts.list || !branchName) {
          // List branches
          const branches = storage.listBranches(model.id);
          if (isJsonMode()) {
            outputJson(branches);
          } else {
            if (branches.length === 0) {
              console.log('No branch overlays.');
            } else {
              console.log(`Branch overlays for ${model.name}:`);
              for (const b of branches) {
                console.log(`  ${b.branch} → ${b.name} (${b.id})`);
              }
            }
          }
          return;
        }

        if (opts.delete) {
          // Delete branch
          storage.deleteBranch(model.id, branchName);
          outputSuccess(`Deleted branch overlay ${branchName}`);
          return;
        }

        // Create branch
        const branch = storage.createBranch(model.id, branchName);
        if (isJsonMode()) {
          outputJson(branch);
        } else {
          outputSuccess(`Created branch overlay ${branchName}`);
          outputModel(branch);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  program
    .command('merge <model> <branch-name>')
    .description('Merge a branch overlay into its parent model')
    .action((modelName: string, branchName: string) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);

        storage.mergeBranch(model.id, branchName);
        outputSuccess(`Merged branch ${branchName} into ${model.name}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
