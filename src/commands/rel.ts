import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface } from '../storage/interface.js';
import { outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

export function registerRelCommands(program: Command, getStorage: () => StorageInterface): void {
  const relCmd = program
    .command('rel')
    .description('Manage relationship definitions');

  relCmd
    .command('list')
    .description('List all relationship types')
    .action(() => {
      try {
        const storage = getStorage();
        const rels = storage.listRelDefs();
        if (isJsonMode()) {
          outputJson(rels);
        } else {
          if (rels.length === 0) {
            console.log(chalk.dim('No relationship types defined.'));
          } else {
            // Table header
            const labelWidth = Math.max(15, ...rels.map(r => r.label.length)) + 2;
            const invWidth = Math.max(15, ...rels.map(r => (r.inverseLabel ?? '—').length)) + 2;
            console.log(
              chalk.bold('Label'.padEnd(labelWidth)) +
              chalk.bold('Inverse'.padEnd(invWidth)) +
              chalk.bold('Description')
            );
            console.log('─'.repeat(labelWidth + invWidth + 30));
            for (const r of rels) {
              const builtInTag = r.builtIn ? '' : chalk.yellow(' (custom)');
              console.log(
                r.label.padEnd(labelWidth) +
                (r.inverseLabel ?? '—').padEnd(invWidth) +
                (r.description ?? '') +
                builtInTag
              );
            }
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  relCmd
    .command('add <label>')
    .description('Add a custom relationship type')
    .option('-i, --inverse <inverse>', 'Inverse label')
    .option('-d, --description <desc>', 'Description')
    .action((label: string, opts: { inverse?: string; description?: string }) => {
      try {
        const storage = getStorage();
        const relDef = storage.addRelDef({
          label,
          inverseLabel: opts.inverse,
          description: opts.description,
        });
        if (isJsonMode()) {
          outputJson(relDef);
        } else {
          const inv = relDef.inverseLabel ? ` (inverse: ${relDef.inverseLabel})` : '';
          outputSuccess(`Added relationship type ${relDef.label}${inv}`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  relCmd
    .command('rm <label>')
    .description('Remove a custom relationship type (built-in types cannot be removed)')
    .action((label: string) => {
      try {
        const storage = getStorage();
        storage.deleteRelDef(label);
        outputSuccess(`Removed relationship type ${label}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
