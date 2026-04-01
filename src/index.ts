#!/usr/bin/env node

import { Command } from 'commander';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { SqliteStorage } from './storage/sqlite.js';
import { setJsonMode } from './utils/output.js';
import { registerModelCommands } from './commands/model.js';
import { registerNodeCommands } from './commands/node.js';
import { registerEdgeCommands } from './commands/edge.js';
import { registerQueryCommands } from './commands/query.js';
import { registerBatchCommand } from './commands/batch.js';
import { registerCrossCommands } from './commands/cross.js';
import { registerTypeCommands } from './commands/type.js';
import { registerRelCommands } from './commands/rel.js';
import { registerBranchCommands } from './commands/branch.js';
import { registerGitCommands } from './commands/git.js';
import { registerPathCommands } from './commands/path.js';
import { registerSearchCommand } from './commands/search.js';

const DB_DIR = join(homedir(), '.config', 'engram');
const DB_PATH = join(DB_DIR, 'models.db');

let storage: SqliteStorage | null = null;

function getStorage(): SqliteStorage {
  if (!storage) {
    mkdirSync(DB_DIR, { recursive: true });
    const dbPath = process.env.ENGRAM_DB_PATH ?? DB_PATH;
    storage = new SqliteStorage(dbPath);
  }
  return storage;
}

// Read version from package.json dynamically so it stays in sync with npm
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const pkgPath = join(__dirname2, '..', 'package.json');
const pkgVersion = existsSync(pkgPath)
  ? JSON.parse(readFileSync(pkgPath, 'utf-8')).version
  : '0.0.0';

const program = new Command();

program
  .name('engram')
  .description('Engram — a structured knowledge graph for AI agents')
  .version(pkgVersion)
  .option('--json', 'Output in JSON format')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.json) setJsonMode(true);
  });

// Register all command groups
registerModelCommands(program, getStorage);
registerNodeCommands(program, getStorage);
registerEdgeCommands(program, getStorage);
registerQueryCommands(program, getStorage);
registerBatchCommand(program, getStorage);
registerCrossCommands(program, getStorage);
registerTypeCommands(program, getStorage);
registerRelCommands(program, getStorage);
registerBranchCommands(program, getStorage);
registerGitCommands(program, getStorage);
registerPathCommands(program, getStorage);
registerSearchCommand(program, getStorage);

// === skill command (no storage needed) ===
program
  .command('skill')
  .description('Display the SKILL.md — teaches agents how to use engram')
  .option('--path', 'Print the file path instead of the content')
  .action((opts) => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const skillPath = join(packageRoot, 'skill', 'SKILL.md');

    if (!existsSync(skillPath)) {
      console.error(`SKILL.md not found at ${skillPath}`);
      process.exit(1);
    }

    if (opts.path) {
      console.log(skillPath);
    } else {
      let content = readFileSync(skillPath, 'utf-8');
      // Inject current package version into frontmatter
      content = content.replace(/^(---\n[\s\S]*?)version:\s*["']?[\d.]+["']?/m, `$1version: "${pkgVersion}"`);
      console.log(content);
    }
  });

program.parse();

// Cleanup on exit
process.on('exit', () => {
  if (storage) storage.close();
});
