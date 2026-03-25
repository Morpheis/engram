import { Command } from 'commander';
import { createInterface } from 'readline';
import type { StorageInterface } from '../storage/interface.js';
import { resolveNode, parseMeta } from './node.js';
import { outputSuccess, outputError } from '../utils/output.js';

function parseBatchLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of line) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function registerBatchCommand(program: Command, getStorage: () => StorageInterface): void {
  program
    .command('batch <model>')
    .description('Batch operations from stdin (one command per line)')
    .action(async (modelName: string) => {
      const storage = getStorage();
      const model = storage.getModel(modelName);
      if (!model) {
        outputError(`Model not found: ${modelName}`);
        process.exit(1);
      }

      const rl = createInterface({ input: process.stdin });
      let lineNum = 0;
      let success = 0;
      let errors = 0;

      for await (const line of rl) {
        lineNum++;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = parseBatchLine(trimmed);
        if (parts.length === 0) continue;

        const cmd = parts[0];

        try {
          switch (cmd) {
            case 'add': {
              // add <label> [--type <t>] [--meta k=v ...]
              const label = parts[1];
              if (!label) throw new Error('add requires a label');
              const opts: { type?: string; meta?: string[] } = {};
              for (let i = 2; i < parts.length; i++) {
                if (parts[i] === '--type' && parts[i + 1]) {
                  opts.type = parts[++i];
                } else if (parts[i] === '--meta') {
                  opts.meta = opts.meta || [];
                  // Collect remaining as meta
                  while (i + 1 < parts.length && !parts[i + 1].startsWith('--')) {
                    opts.meta.push(parts[++i]);
                  }
                }
              }
              storage.addNode(model.id, {
                label,
                type: opts.type,
                metadata: opts.meta ? parseMeta(opts.meta) : undefined,
              });
              success++;
              break;
            }

            case 'link': {
              // link <source> <rel> <target> [--meta k=v ...] [--weight N]
              const [, sourceRef, rel, targetRef] = parts;
              if (!sourceRef || !rel || !targetRef) throw new Error('link requires source, rel, target');
              const source = resolveNode(storage, modelName, sourceRef);
              const target = resolveNode(storage, modelName, targetRef);
              let weight: number | undefined;
              let meta: string[] | undefined;
              for (let i = 4; i < parts.length; i++) {
                if (parts[i] === '--weight' && parts[i + 1]) {
                  weight = parseFloat(parts[++i]);
                } else if (parts[i] === '--meta') {
                  meta = meta || [];
                  while (i + 1 < parts.length && !parts[i + 1].startsWith('--')) {
                    meta.push(parts[++i]);
                  }
                }
              }
              storage.addEdge({
                sourceId: source.id,
                targetId: target.id,
                relationship: rel,
                metadata: meta ? parseMeta(meta) : undefined,
                weight,
              });
              success++;
              break;
            }

            case 'rm': {
              // rm <node-ref>
              const nodeRef = parts[1];
              if (!nodeRef) throw new Error('rm requires a node reference');
              const node = resolveNode(storage, modelName, nodeRef);
              storage.deleteNode(node.id);
              success++;
              break;
            }

            case 'unlink': {
              // unlink <source> <rel> <target>
              const [, src, r, tgt] = parts;
              if (!src || !r || !tgt) throw new Error('unlink requires source, rel, target');
              const s = resolveNode(storage, modelName, src);
              const t = resolveNode(storage, modelName, tgt);
              storage.deleteEdge(s.id, t.id, r);
              success++;
              break;
            }

            default:
              throw new Error(`Unknown batch command: ${cmd}`);
          }
        } catch (e: unknown) {
          errors++;
          outputError(`Line ${lineNum}: ${(e as Error).message}`);
        }
      }

      outputSuccess(`Batch complete: ${success} succeeded, ${errors} failed`);
    });
}
