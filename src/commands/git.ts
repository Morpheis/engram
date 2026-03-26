import { Command } from 'commander';
import chalk from 'chalk';
import type { StorageInterface, GraphNode, Edge } from '../storage/interface.js';
import {
  getHeadCommit,
  getDiffFiles,
  getDiffStat,
  getCommitAge,
  getCommitCount,
  abbreviateCommit,
  commitExists,
} from '../utils/git.js';
import { outputJson, outputError, outputSuccess, isJsonMode } from '../utils/output.js';

/**
 * Validate that a model is a code model with a repo_path configured.
 * Returns the model info or throws.
 */
function validateCodeModel(storage: StorageInterface, modelName: string) {
  const model = storage.getModel(modelName);
  if (!model) throw new Error(`Model not found: ${modelName}`);

  if (model.type !== 'code') {
    throw new Error(`Model "${model.name}" is not a code model (type: ${model.type}). Git integration requires type 'code'.`);
  }

  if (!model.repoPath) {
    throw new Error(`Model "${model.name}" has no repo_path configured. Use 'engram create <name> -t code -r /path/to/repo'.`);
  }

  return model;
}

/**
 * Collect edges connected to a set of affected node IDs.
 */
function getAffectedEdges(storage: StorageInterface, modelId: string, affectedNodeIds: Set<string>): Edge[] {
  const allEdges = storage.listEdges(modelId);
  return allEdges.filter(e =>
    affectedNodeIds.has(e.sourceId) || affectedNodeIds.has(e.targetId)
  );
}

/**
 * Build a node map (id → node) for quick label lookups.
 */
function buildNodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map(n => [n.id, n]));
}

export function registerGitCommands(program: Command, getStorage: () => StorageInterface): void {
  // ── engram check <model> ────────────────────────────
  program
    .command('check <model>')
    .description('Check model freshness against git HEAD')
    .action((modelName: string) => {
      try {
        const storage = getStorage();
        const model = validateCodeModel(storage, modelName);
        const { anchor, repoPath } = model;

        const head = getHeadCommit(repoPath!);

        // Model is fresh
        if (anchor && anchor === head) {
          if (isJsonMode()) {
            outputJson({
              status: 'fresh',
              model: model.name,
              anchor,
              head,
            });
          } else {
            console.log(`${chalk.green('✓')} Model "${model.name}" is up to date (anchored at ${abbreviateCommit(anchor)})`);
          }
          return;
        }

        // Model is stale — compute diff
        const anchorAge = anchor ? getCommitAge(repoPath!, anchor) : null;
        const commitCount = anchor ? getCommitCount(repoPath!, anchor, head) : 0;
        const validAnchor = anchor && commitExists(repoPath!, anchor) ? anchor : null;
        const diffFiles = getDiffFiles(repoPath!, validAnchor);
        const filePaths = diffFiles.map(f => f.path);
        const nodeFileMap = storage.findNodesByFile(model.id, filePaths);

        // Collect all affected node IDs
        const affectedNodeIds = new Set<string>();
        for (const nodes of nodeFileMap.values()) {
          for (const node of nodes) {
            affectedNodeIds.add(node.id);
          }
        }

        const affectedEdges = getAffectedEdges(storage, model.id, affectedNodeIds);
        const allNodes = storage.listNodes(model.id);
        const nodeMap = buildNodeMap(allNodes);

        if (isJsonMode()) {
          const fileMapping: Record<string, Array<{ id: string; label: string; type: string | null }>> = {};
          for (const [file, nodes] of nodeFileMap) {
            fileMapping[file] = nodes.map(n => ({ id: n.id, label: n.label, type: n.type }));
          }
          outputJson({
            status: 'stale',
            model: model.name,
            anchor: anchor ?? null,
            anchorAge: anchorAge ?? null,
            head,
            commitCount,
            affectedNodes: affectedNodeIds.size,
            affectedEdges: affectedEdges.length,
            fileMapping,
            edges: affectedEdges.map(e => ({
              source: nodeMap.get(e.sourceId)?.label ?? e.sourceId,
              relationship: e.relationship,
              target: nodeMap.get(e.targetId)?.label ?? e.targetId,
            })),
          });
          return;
        }

        // Human-readable output
        if (anchor) {
          console.log(`Model "${chalk.bold(model.name)}" anchored at ${chalk.yellow(abbreviateCommit(anchor))} (${anchorAge})`);
          console.log(`HEAD is now ${chalk.green(abbreviateCommit(head))} (${commitCount} commit${commitCount !== 1 ? 's' : ''} ahead)`);
        } else {
          console.log(`Model "${chalk.bold(model.name)}" has no anchor set`);
          console.log(`HEAD is ${chalk.green(abbreviateCommit(head))}`);
        }

        if (nodeFileMap.size > 0) {
          console.log('');
          console.log('Changed files affecting model nodes:');
          for (const [file, nodes] of nodeFileMap) {
            const nodeList = nodes.map(n => `${n.label}${n.type ? ` (${n.type})` : ''}`).join(', ');
            console.log(`  ${file} → ${nodeList}`);
          }
        }

        console.log('');
        console.log(`Affected nodes: ${affectedNodeIds.size}`);
        console.log(`Potentially affected edges: ${affectedEdges.length}`);

        if (affectedEdges.length > 0) {
          for (const edge of affectedEdges) {
            const srcLabel = nodeMap.get(edge.sourceId)?.label ?? edge.sourceId;
            const tgtLabel = nodeMap.get(edge.targetId)?.label ?? edge.targetId;
            console.log(`  ${srcLabel} ${chalk.cyan(`—[${edge.relationship}]→`)} ${tgtLabel}`);
          }
        }

        console.log('');
        console.log(`Run '${chalk.cyan(`engram refresh ${model.name}`)}' to update anchor to current HEAD.`);
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  // ── engram refresh <model> ──────────────────────────
  program
    .command('refresh <model>')
    .description('Update model anchor to current HEAD and mark all nodes/edges as verified')
    .action((modelName: string) => {
      try {
        const storage = getStorage();
        const model = validateCodeModel(storage, modelName);
        const oldAnchor = model.anchor;

        const head = getHeadCommit(model.repoPath!);
        storage.updateModelAnchor(model.id, head);
        storage.refreshAllVerified(model.id);

        const nodes = storage.listNodes(model.id);
        const edges = storage.listEdges(model.id);

        if (isJsonMode()) {
          outputJson({
            model: model.name,
            oldAnchor: oldAnchor ?? null,
            newAnchor: head,
            nodesRefreshed: nodes.length,
            edgesRefreshed: edges.length,
          });
        } else {
          outputSuccess(`Model "${model.name}" refreshed`);
          if (oldAnchor) {
            console.log(`  Anchor updated: ${abbreviateCommit(oldAnchor)} → ${abbreviateCommit(head)}`);
          } else {
            console.log(`  Anchor set: ${abbreviateCommit(head)}`);
          }
          console.log(`  All ${nodes.length} nodes and ${edges.length} edges marked as verified`);
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  // ── engram diff <model> ─────────────────────────────
  program
    .command('diff <model>')
    .description('Detailed diff summary with affected subgraph')
    .action((modelName: string) => {
      try {
        const storage = getStorage();
        const model = validateCodeModel(storage, modelName);
        const { anchor, repoPath } = model;

        const head = getHeadCommit(repoPath!);

        if (anchor && anchor === head) {
          if (isJsonMode()) {
            outputJson({ status: 'fresh', model: model.name, anchor, head, files: [] });
          } else {
            console.log(`${chalk.green('✓')} Model "${model.name}" is up to date — no diff`);
          }
          return;
        }

        const validAnchor = anchor && commitExists(repoPath!, anchor) ? anchor : null;
        const diffFiles = getDiffFiles(repoPath!, validAnchor);
        const filePaths = diffFiles.map(f => f.path);
        const nodeFileMap = storage.findNodesByFile(model.id, filePaths);
        const allNodes = storage.listNodes(model.id);
        const allEdges = storage.listEdges(model.id);
        const nodeMap = buildNodeMap(allNodes);

        // Collect all affected node IDs
        const affectedNodeIds = new Set<string>();
        for (const nodes of nodeFileMap.values()) {
          for (const node of nodes) {
            affectedNodeIds.add(node.id);
          }
        }

        // Compute summary counters
        let untrackedFiles = 0;
        let deletedFiles = 0;

        if (isJsonMode()) {
          const files = diffFiles.map(df => {
            const matchingNodes = nodeFileMap.get(df.path) ?? [];
            if (df.status === 'A' && matchingNodes.length === 0) untrackedFiles++;
            if (df.status === 'D') deletedFiles++;

            // Get connected nodes for each affected node
            const affectedSubgraph = matchingNodes.map(n => {
              const outgoing = allEdges.filter(e => e.sourceId === n.id).map(e => ({
                relationship: e.relationship,
                target: nodeMap.get(e.targetId)?.label ?? e.targetId,
              }));
              const incoming = allEdges.filter(e => e.targetId === n.id).map(e => ({
                relationship: e.relationship,
                source: nodeMap.get(e.sourceId)?.label ?? e.sourceId,
              }));
              return {
                id: n.id,
                label: n.label,
                type: n.type,
                outgoing,
                incoming,
              };
            });

            return {
              status: df.status,
              path: df.path,
              oldPath: df.oldPath,
              affectedNodes: affectedSubgraph,
            };
          });

          outputJson({
            status: 'stale',
            model: model.name,
            anchor: anchor ?? null,
            head,
            files,
            summary: {
              totalFiles: diffFiles.length,
              affectedNodes: affectedNodeIds.size,
              untrackedFiles,
              deletedFiles,
            },
          });
          return;
        }

        // Human-readable output
        if (anchor) {
          console.log(`Model "${chalk.bold(model.name)}" — diff from ${chalk.yellow(abbreviateCommit(anchor))} to ${chalk.green(abbreviateCommit(head))}`);
        } else {
          console.log(`Model "${chalk.bold(model.name)}" — diff (no anchor) to ${chalk.green(abbreviateCommit(head))}`);
        }
        console.log('');

        for (const df of diffFiles) {
          const matchingNodes = nodeFileMap.get(df.path) ?? [];
          const statusColor = df.status === 'A' ? chalk.green : df.status === 'D' ? chalk.red : chalk.yellow;
          const line = `  ${statusColor(df.status)} ${df.path}${df.oldPath ? ` (was: ${df.oldPath})` : ''}`;
          console.log(line);

          if (matchingNodes.length === 0) {
            if (df.status === 'A') {
              console.log(`    → ${chalk.dim('no matching node (consider adding one)')}`);
              untrackedFiles++;
            } else if (df.status === 'D') {
              console.log(`    → ${chalk.dim('no matching node')}`);
              deletedFiles++;
            } else {
              console.log(`    → ${chalk.dim('no matching node')}`);
            }
          } else {
            for (const node of matchingNodes) {
              console.log(`    → affects: ${chalk.bold(node.label)}${node.type ? ` (${node.type})` : ''}`);

              // Show connected edges
              const outgoing = allEdges.filter(e => e.sourceId === node.id);
              const incoming = allEdges.filter(e => e.targetId === node.id);

              if (incoming.length > 0) {
                const inLabels = incoming.map(e => nodeMap.get(e.sourceId)?.label ?? e.sourceId).join(', ');
                console.log(`      ← ${chalk.dim(`called by: ${inLabels}`)}`);
              }
              if (outgoing.length > 0) {
                const outLabels = outgoing.map(e => `${e.relationship}: ${nodeMap.get(e.targetId)?.label ?? e.targetId}`).join(', ');
                console.log(`      → ${chalk.dim(outLabels)}`);
              }
            }
          }
          console.log('');
        }

        // Summary
        const parts: string[] = [];
        if (affectedNodeIds.size > 0) parts.push(`${affectedNodeIds.size} node${affectedNodeIds.size !== 1 ? 's' : ''} affected`);
        if (untrackedFiles > 0) parts.push(`${untrackedFiles} new file${untrackedFiles !== 1 ? 's' : ''} untracked`);
        if (deletedFiles > 0) parts.push(`${deletedFiles} deleted file${deletedFiles !== 1 ? 's' : ''}`);
        if (parts.length > 0) {
          console.log(`Summary: ${parts.join(', ')}`);
        } else {
          console.log('Summary: no model nodes affected by changes');
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });

  // ── engram stale <model> [--days N] ─────────────────
  program
    .command('stale <model>')
    .description('Show stale nodes and edges in a model')
    .option('--days <n>', 'Days threshold for staleness', parseInt)
    .action((modelName: string, opts: { days?: number }) => {
      try {
        const storage = getStorage();
        const model = storage.getModel(modelName);
        if (!model) throw new Error(`Model not found: ${modelName}`);

        // Default days: 7 for code models, 30 for non-code
        const days = opts.days ?? (model.type === 'code' ? 7 : 30);

        const staleNodes = storage.findStaleNodes(model.id, days);
        const staleEdges = storage.findStaleEdges(model.id, days);

        if (isJsonMode()) {
          const result: Record<string, unknown> = {
            model: model.name,
            type: model.type,
            daysThreshold: days,
            staleNodes: staleNodes.map(n => ({
              id: n.id,
              label: n.label,
              type: n.type,
              verifiedAt: n.verifiedAt,
            })),
            staleEdges: staleEdges.map(e => ({
              id: e.id,
              sourceId: e.sourceId,
              targetId: e.targetId,
              relationship: e.relationship,
              verifiedAt: e.verifiedAt,
            })),
          };
          if (model.type === 'code' && model.repoPath) {
            result.anchor = model.anchor;
            result.repoPath = model.repoPath;
          }
          outputJson(result);
          return;
        }

        // Code model: show anchor info and suggest engram check
        if (model.type === 'code' && model.repoPath) {
          if (model.anchor) {
            const anchorAge = getCommitAge(model.repoPath, model.anchor);
            console.log(`Model "${chalk.bold(model.name)}" anchored at ${chalk.yellow(abbreviateCommit(model.anchor))} (${anchorAge})`);
          } else {
            console.log(`Model "${chalk.bold(model.name)}" has no anchor set`);
          }
          console.log(`  ${chalk.dim(`Run 'engram check ${model.name}' for git-aware freshness check`)}`);
          console.log('');
        }

        if (staleNodes.length === 0 && staleEdges.length === 0) {
          console.log(`No stale items (threshold: ${days} days)`);
          return;
        }

        if (staleNodes.length > 0) {
          console.log(`Stale nodes (not verified in ${days}+ days):`);
          for (const node of staleNodes) {
            console.log(`  ${chalk.bold(node.label)}${node.type ? ` ${chalk.dim(`(${node.type})`)}` : ''}  ${chalk.dim(`verified: ${node.verifiedAt}`)}`);
          }
        }

        if (staleEdges.length > 0) {
          if (staleNodes.length > 0) console.log('');
          const allNodes = storage.listNodes(model.id);
          const nodeMap = buildNodeMap(allNodes);
          console.log(`Stale edges (not verified in ${days}+ days):`);
          for (const edge of staleEdges) {
            const srcLabel = nodeMap.get(edge.sourceId)?.label ?? edge.sourceId;
            const tgtLabel = nodeMap.get(edge.targetId)?.label ?? edge.targetId;
            console.log(`  ${srcLabel} ${chalk.cyan(`—[${edge.relationship}]→`)} ${tgtLabel}  ${chalk.dim(`verified: ${edge.verifiedAt}`)}`);
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}
