#!/usr/bin/env node

import { Command } from 'commander';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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

const DB_DIR = join(homedir(), '.config', 'mental-model');
const DB_PATH = join(DB_DIR, 'models.db');

let storage: SqliteStorage | null = null;

function getStorage(): SqliteStorage {
  if (!storage) {
    mkdirSync(DB_DIR, { recursive: true });
    const dbPath = process.env.MM_DB_PATH ?? DB_PATH;
    storage = new SqliteStorage(dbPath);
  }
  return storage;
}

const program = new Command();

program
  .name('mm')
  .description('Mental Model — a structured knowledge graph for AI agents')
  .version('0.1.0')
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

program.parse();

// Cleanup on exit
process.on('exit', () => {
  if (storage) storage.close();
});
