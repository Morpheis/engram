import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface, TypeDef } from '../storage/interface.js';
import { outputJson, outputSuccess, outputError, isJsonMode } from '../utils/output.js';

function buildTree(types: TypeDef[]): void {
  const byParent = new Map<string | null, TypeDef[]>();
  for (const t of types) {
    const key = t.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }

  function printNode(t: TypeDef, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    const domainTag = t.domain ? chalk.dim(` [${t.domain}]`) : '';
    const builtInTag = t.builtIn ? '' : chalk.yellow(' (custom)');
    console.log(`${prefix}${connector}${chalk.bold(t.label)}${domainTag}${builtInTag}`);

    const children = byParent.get(t.id) ?? [];
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    children.forEach((child, i) => {
      printNode(child, childPrefix, i === children.length - 1);
    });
  }

  // Find roots (no parent)
  const roots = byParent.get(null) ?? [];
  for (const root of roots) {
    const domainTag = root.domain ? chalk.dim(` [${root.domain}]`) : '';
    console.log(`${chalk.bold(root.label)}${domainTag}`);
    const children = byParent.get(root.id) ?? [];
    children.forEach((child, i) => {
      printNode(child, '', i === children.length - 1);
    });
  }
}

export function registerTypeCommands(program: Command, getStorage: () => StorageInterface): void {
  const typeCmd = program
    .command('type')
    .description('Manage type definitions');

  typeCmd
    .command('list')
    .description('List all types (tree view)')
    .action(() => {
      try {
        const storage = getStorage();
        const types = storage.listTypes();
        if (isJsonMode()) {
          outputJson(types);
        } else {
          if (types.length === 0) {
            console.log(chalk.dim('No types defined.'));
          } else {
            buildTree(types);
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  typeCmd
    .command('add <label>')
    .description('Add a custom type')
    .option('-p, --parent <parent>', 'Parent type (label or ID)')
    .option('-d, --domain <domain>', 'Domain (code|org|infra|concept)')
    .option('--description <desc>', 'Type description')
    .action((label: string, opts: { parent?: string; domain?: string; description?: string }) => {
      try {
        const storage = getStorage();
        const typeDef = storage.addType({
          label,
          parentId: opts.parent,
          domain: opts.domain,
          description: opts.description,
        });
        if (isJsonMode()) {
          outputJson(typeDef);
        } else {
          outputSuccess(`Added type ${typeDef.label}${opts.parent ? ` (parent: ${opts.parent})` : ''}`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  typeCmd
    .command('rm <label>')
    .description('Remove a custom type (built-in types cannot be removed)')
    .action((label: string) => {
      try {
        const storage = getStorage();
        storage.deleteType(label);
        outputSuccess(`Removed type ${label}`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
