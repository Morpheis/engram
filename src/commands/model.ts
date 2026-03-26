import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import type { StorageInterface, TypeDef, RelDef, GraphNode, Edge, Model } from '../storage/interface.js';
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
    .description('Export a model to JSON or JSON-LD')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('-f, --format <format>', 'Export format (jsonld|json|dot)', 'jsonld')
    .action((name: string, opts: { output?: string; format?: string }) => {
      try {
        const storage = getStorage();
        const data = storage.exportModel(name);
        const format = opts.format ?? 'jsonld';

        if (format === 'dot') {
          const dot = buildDot(data.model, data.nodes, data.edges);
          if (opts.output) {
            writeFileSync(opts.output, dot);
            outputSuccess(`Exported to ${opts.output}`);
          } else {
            console.log(dot);
          }
          return;
        }

        let output: Record<string, unknown>;

        if (format === 'jsonld') {
          output = buildJsonLd(data.model, data.nodes, data.edges, data.types, data.relationships);
        } else {
          // Plain JSON — backward compat
          output = {
            model: data.model,
            nodes: data.nodes,
            edges: data.edges,
            types: data.types,
            relationships: data.relationships,
          };
        }

        const json = JSON.stringify(output, null, 2);
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
    .description('Import a model from JSON or JSON-LD file')
    .action((file: string) => {
      try {
        const storage = getStorage();
        const raw = readFileSync(file, 'utf-8');
        const data = JSON.parse(raw);

        // Detect JSON-LD format by presence of @context
        if (data['@context']) {
          // JSON-LD import — extract model info from top-level fields
          const modelInput = {
            name: data.name,
            type: data.modelType,
            description: data.description,
            anchor: data.anchor,
            sourceType: data.sourceType,
            repoPath: data.repoPath,
          };

          // Import types (if present)
          const types = data.types?.map((t: Record<string, unknown>) => ({
            label: t.label as string,
            parentId: (t.parentLabel as string) ?? undefined,
            description: (t.description as string) ?? undefined,
            domain: (t.domain as string) ?? undefined,
          }));

          // Import relationships (if present)
          const relationships = data.relationships?.map((r: Record<string, unknown>) => ({
            label: r.label as string,
            inverseLabel: (r.inverseLabel as string) ?? undefined,
            description: (r.description as string) ?? undefined,
          }));

          const model = storage.importModel({
            model: modelInput,
            nodes: data.nodes ?? [],
            edges: data.edges ?? [],
            types,
            relationships,
          });

          if (isJsonMode()) {
            outputJson(model);
          } else {
            outputSuccess(`Imported model ${model.name} (from JSON-LD)`);
            outputModel(model);
          }
        } else {
          // Plain JSON import — backward compat
          const model = storage.importModel({
            model: data.model,
            nodes: data.nodes,
            edges: data.edges,
            types: data.types,
            relationships: data.relationships,
          });
          if (isJsonMode()) {
            outputJson(model);
          } else {
            outputSuccess(`Imported model ${model.name}`);
            outputModel(model);
          }
        }
      } catch (e: unknown) {
        outputError((e as Error).message);
        process.exit(1);
      }
    });
}

// ── JSON-LD Builder ──────────────────────────────────

function buildJsonLd(
  model: Model,
  nodes: GraphNode[],
  edges: Edge[],
  types: TypeDef[],
  relationships: RelDef[],
): Record<string, unknown> {
  // Build @context from core properties + all relationship types in the model
  const context: Record<string, string> = {
    engram: 'https://github.com/Morpheis/engram/schema#',
    nodes: 'engram:nodes',
    edges: 'engram:edges',
    label: 'engram:label',
    type: 'engram:type',
    relationship: 'engram:relationship',
    metadata: 'engram:metadata',
    verified_at: 'engram:verified_at',
  };

  // Add all relationship labels used in the model
  for (const rel of relationships) {
    context[rel.label] = `engram:${rel.label}`;
    if (rel.inverseLabel) {
      context[rel.inverseLabel] = `engram:${rel.inverseLabel}`;
    }
  }

  const result: Record<string, unknown> = {
    '@context': context,
    '@type': 'engram:Model',
    name: model.name,
    modelType: model.type,
  };

  // Include branch info if present
  if (model.branch) {
    result.branch = model.branch;
  }
  if (model.parentModelId) {
    result.parent = model.parentModelId;
  }
  if (model.anchor) {
    result.anchor = model.anchor;
  }
  if (model.description) {
    result.description = model.description;
  }
  if (model.sourceType) {
    result.sourceType = model.sourceType;
  }
  if (model.repoPath) {
    result.repoPath = model.repoPath;
  }

  // Type definitions
  result.types = types.map(t => ({
    label: t.label,
    parentLabel: t.parentId ?? undefined,
    description: t.description ?? undefined,
    domain: t.domain ?? undefined,
    builtIn: t.builtIn,
  }));

  // Relationship definitions
  result.relationships = relationships.map(r => ({
    label: r.label,
    inverseLabel: r.inverseLabel ?? undefined,
    description: r.description ?? undefined,
    builtIn: r.builtIn,
  }));

  // Nodes with namespaced IDs for portability
  result.nodes = nodes.map(n => ({
    '@id': `${model.name}:${n.label}`,
    id: n.id,
    label: n.label,
    type: n.type,
    metadata: n.metadata,
    verifiedAt: n.verifiedAt,
  }));

  // Edges
  result.edges = edges.map(e => {
    // Try to resolve source/target labels for readability
    const sourceNode = nodes.find(n => n.id === e.sourceId);
    const targetNode = nodes.find(n => n.id === e.targetId);
    return {
      sourceId: e.sourceId,
      targetId: e.targetId,
      sourceRef: sourceNode ? `${model.name}:${sourceNode.label}` : e.sourceId,
      targetRef: targetNode ? `${model.name}:${targetNode.label}` : e.targetId,
      relationship: e.relationship,
      metadata: e.metadata,
      weight: e.weight,
    };
  });

  return result;
}

// ── DOT (Graphviz) Builder ───────────────────────────

/** Map node type labels to Graphviz shapes */
function dotShape(typeLabel: string | null): string {
  if (!typeLabel) return 'ellipse';
  const t = typeLabel.toLowerCase();
  // Services / infrastructure
  if (t === 'service' || t === 'microservice') return 'box';
  if (t === 'database') return 'cylinder';
  if (t === 'server' || t === 'container') return 'box3d';
  if (t === 'network' || t === 'endpoint') return 'diamond';
  // People / org
  if (t === 'person') return 'house';
  if (t === 'team' || t === 'company') return 'tab';
  if (t === 'role') return 'invhouse';
  // Concepts
  if (t === 'process') return 'hexagon';
  if (t === 'event') return 'parallelogram';
  if (t === 'rule') return 'octagon';
  // Code artifacts
  if (t === 'config' || t === 'script') return 'note';
  if (t === 'test-runner') return 'cds';
  if (t === 'middleware') return 'trapezium';
  if (t === 'library' || t === 'module') return 'component';
  // Default for component, hook, function, page, widget, etc.
  return 'ellipse';
}

/** Map node type to a fill color based on domain category */
function dotColor(typeLabel: string | null): string {
  if (!typeLabel) return '#e5e7eb'; // gray for untyped

  const t = typeLabel.toLowerCase();

  // Code domain (blue palette)
  const codeTypes = [
    'component', 'page', 'widget', 'hook', 'function', 'service',
    'microservice', 'middleware', 'library', 'config', 'script',
    'test-runner', 'module',
  ];
  if (codeTypes.includes(t)) return '#dbeafe';

  // Org domain (green palette)
  const orgTypes = ['person', 'team', 'role', 'company'];
  if (orgTypes.includes(t)) return '#dcfce7';

  // Infra domain (orange palette)
  const infraTypes = ['server', 'container', 'network', 'endpoint', 'database'];
  if (infraTypes.includes(t)) return '#fed7aa';

  // Concept domain (purple palette)
  const conceptTypes = ['process', 'event', 'rule'];
  if (conceptTypes.includes(t)) return '#e9d5ff';

  return '#e5e7eb'; // fallback gray
}

/** Escape a string for use inside DOT quoted attribute values */
function dotEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildDot(
  model: Model,
  nodes: GraphNode[],
  edges: Edge[],
): string {
  const lines: string[] = [];
  const modelName = dotEscape(model.name);
  lines.push(`digraph "${modelName}" {`);
  lines.push('  rankdir=LR;');
  lines.push('  node [fontname="monospace", fontsize=10];');
  lines.push('');

  // Build node ID → label map
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Nodes
  if (nodes.length > 0) {
    lines.push('  // Nodes');
    for (const n of nodes) {
      const shape = dotShape(n.type);
      const color = dotColor(n.type);
      const label = dotEscape(n.label);

      // Build tooltip from type + metadata
      const tooltipParts: string[] = [];
      if (n.type) tooltipParts.push(n.type);
      for (const [k, v] of Object.entries(n.metadata)) {
        tooltipParts.push(`${k}: ${v}`);
      }
      const tooltip = dotEscape(tooltipParts.join('\\n'));

      lines.push(`  "${label}" [shape=${shape}, style=filled, fillcolor="${color}"${tooltip ? `, tooltip="${tooltip}"` : ''}];`);
    }
    lines.push('');
  }

  // Edges
  if (edges.length > 0) {
    lines.push('  // Edges');
    for (const e of edges) {
      const srcNode = nodeMap.get(e.sourceId);
      const tgtNode = nodeMap.get(e.targetId);
      if (!srcNode || !tgtNode) continue;
      const src = dotEscape(srcNode.label);
      const tgt = dotEscape(tgtNode.label);
      const rel = dotEscape(e.relationship);

      // Edge metadata as tooltip
      const metaEntries = Object.entries(e.metadata);
      const edgeTooltip = metaEntries.length > 0
        ? `, tooltip="${dotEscape(metaEntries.map(([k, v]) => `${k}: ${v}`).join('\\n'))}"`
        : '';

      lines.push(`  "${src}" -> "${tgt}" [label="${rel}"${edgeTooltip}];`);
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}
