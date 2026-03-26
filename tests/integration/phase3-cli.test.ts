import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI = 'npx tsx src/index.ts';
let dbPath: string;

function mm(args: string): string {
  const env = { ...process.env, MM_DB_PATH: dbPath };
  return execSync(`${CLI} ${args}`, {
    cwd: join(import.meta.dirname, '../..'),
    env,
    encoding: 'utf-8',
    timeout: 15000,
  }).trim();
}

function mmJson(args: string): unknown {
  return JSON.parse(mm(`--json ${args}`));
}

beforeEach(() => {
  dbPath = join(tmpdir(), `mm-p3-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
});

afterEach(() => {
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

// ── Helper: seed a test graph ────────────────────────
function seedGraph() {
  mm('create arch -t code -d "Test architecture"');
  mm('add arch FleetView --type component');
  mm('add arch useFleet --type hook');
  mm('add arch fleet-rest --type service');
  mm('add arch fleet-db --type database');
  mm('add arch medusa-proxy --type service');
  mm('add arch config-file --type config');
  mm('add arch DevOps --type person');
  mm('link arch FleetView calls useFleet');
  mm('link arch useFleet calls fleet-rest');
  mm('link arch fleet-rest depends-on fleet-db');
  mm('link arch useFleet calls medusa-proxy');
  mm('link arch medusa-proxy calls fleet-rest');
  mm('link arch DevOps manages fleet-rest');
}

// ══════════════════════════════════════════════════════
// DOT Export
// ══════════════════════════════════════════════════════

describe('DOT Export', () => {
  it('generates valid DOT syntax', () => {
    seedGraph();
    const dot = mm('export arch -f dot');
    // Must start with digraph and end with closing brace
    expect(dot).toMatch(/^digraph "arch" \{/);
    expect(dot).toMatch(/\}$/);
    // Must have rankdir and node defaults
    expect(dot).toContain('rankdir=LR;');
    expect(dot).toContain('node [fontname="monospace", fontsize=10];');
  });

  it('maps node types to correct shapes', () => {
    seedGraph();
    const dot = mm('export arch -f dot');
    // component → ellipse
    expect(dot).toContain('"FleetView" [shape=ellipse');
    // hook → ellipse
    expect(dot).toContain('"useFleet" [shape=ellipse');
    // service → box
    expect(dot).toContain('"fleet-rest" [shape=box,');
    // database → cylinder
    expect(dot).toContain('"fleet-db" [shape=cylinder');
    // config → note
    expect(dot).toContain('"config-file" [shape=note');
    // person → house
    expect(dot).toContain('"DevOps" [shape=house');
  });

  it('color-codes nodes by domain category', () => {
    seedGraph();
    const dot = mm('export arch -f dot');
    // Code types (component, hook, service) → blue
    expect(dot).toContain('"FleetView" [shape=ellipse, style=filled, fillcolor="#dbeafe"');
    expect(dot).toContain('"fleet-rest" [shape=box, style=filled, fillcolor="#dbeafe"');
    // Infra types (database) → orange
    expect(dot).toContain('"fleet-db" [shape=cylinder, style=filled, fillcolor="#fed7aa"');
    // Org types (person) → green
    expect(dot).toContain('"DevOps" [shape=house, style=filled, fillcolor="#dcfce7"');
  });

  it('labels edges with relationship names', () => {
    seedGraph();
    const dot = mm('export arch -f dot');
    expect(dot).toContain('"FleetView" -> "useFleet" [label="calls"]');
    expect(dot).toContain('"fleet-rest" -> "fleet-db" [label="depends-on"]');
    expect(dot).toContain('"DevOps" -> "fleet-rest" [label="manages"]');
  });

  it('includes type in tooltip', () => {
    seedGraph();
    const dot = mm('export arch -f dot');
    expect(dot).toContain('tooltip="component"');
    expect(dot).toContain('tooltip="database"');
    expect(dot).toContain('tooltip="service"');
  });

  it('includes metadata in tooltip', () => {
    mm('create meta-test');
    mm('add meta-test API --type service -m port=5020 -m env=prod');
    const dot = mm('export meta-test -f dot');
    expect(dot).toContain('port: 5020');
    expect(dot).toContain('env: prod');
  });

  it('includes edge metadata in tooltip', () => {
    mm('create edge-meta');
    mm('add edge-meta A --type service');
    mm('add edge-meta B --type service');
    mm('link edge-meta A calls B -m via="proxy /admin"');
    const dot = mm('export edge-meta -f dot');
    expect(dot).toContain('tooltip="via: proxy /admin"');
  });

  it('handles empty model gracefully', () => {
    mm('create empty');
    const dot = mm('export empty -f dot');
    expect(dot).toMatch(/^digraph "empty" \{/);
    expect(dot).toMatch(/\}$/);
    expect(dot).not.toContain('// Nodes');
    expect(dot).not.toContain('// Edges');
  });

  it('handles nodes without types', () => {
    mm('create untyped');
    mm('add untyped Something');
    const dot = mm('export untyped -f dot');
    // Untyped nodes get default ellipse shape and gray color
    expect(dot).toContain('"Something" [shape=ellipse, style=filled, fillcolor="#e5e7eb"');
  });

  it('escapes special characters in labels', () => {
    mm('create esc-test');
    mm('add esc-test "Node With Spaces" --type service');
    const dot = mm('export esc-test -f dot');
    expect(dot).toContain('"Node With Spaces"');
  });

  it('writes DOT to file with -o flag', () => {
    const outPath = join(tmpdir(), `mm-dot-${Date.now()}.dot`);
    try {
      mm('create file-out');
      mm('add file-out A --type service');
      mm(`export file-out -f dot -o ${outPath}`);
      const { readFileSync } = require('fs');
      const content = readFileSync(outPath, 'utf-8');
      expect(content).toMatch(/^digraph "file-out" \{/);
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it('renders diverse type shapes correctly', () => {
    mm('create types-test');
    mm('add types-test MyPage --type page');
    mm('add types-test MyWidget --type widget');
    mm('add types-test MyProcess --type process');
    mm('add types-test MyEvent --type event');
    mm('add types-test MyRule --type rule');
    mm('add types-test MyServer --type server');
    mm('add types-test MyTeam --type team');
    const dot = mm('export types-test -f dot');
    // page/widget → ellipse (component subtypes)
    expect(dot).toContain('"MyPage" [shape=ellipse');
    expect(dot).toContain('"MyWidget" [shape=ellipse');
    // process → hexagon
    expect(dot).toContain('"MyProcess" [shape=hexagon');
    // event → parallelogram
    expect(dot).toContain('"MyEvent" [shape=parallelogram');
    // rule → octagon
    expect(dot).toContain('"MyRule" [shape=octagon');
    // server → box3d
    expect(dot).toContain('"MyServer" [shape=box3d');
    // team → tab
    expect(dot).toContain('"MyTeam" [shape=tab');
  });
});

// ══════════════════════════════════════════════════════
// Path Finding CLI
// ══════════════════════════════════════════════════════

describe('Path Finding CLI', () => {
  it('finds shortest path first', () => {
    seedGraph();
    const output = mm('path arch FleetView fleet-db');
    expect(output).toContain('Path 1 (length 3)');
    expect(output).toContain('Path 2 (length 4)');
    // Path 1 is shorter
    const idx1 = output.indexOf('Path 1');
    const idx2 = output.indexOf('Path 2');
    expect(idx1).toBeLessThan(idx2);
  });

  it('displays correct path labels', () => {
    seedGraph();
    const output = mm('path arch FleetView fleet-db');
    // Shortest path
    expect(output).toContain('FleetView');
    expect(output).toContain('useFleet');
    expect(output).toContain('fleet-rest');
    expect(output).toContain('fleet-db');
    expect(output).toContain('calls');
    expect(output).toContain('depends-on');
  });

  it('returns no paths when nodes are unreachable', () => {
    mm('create isolated');
    mm('add isolated A --type service');
    mm('add isolated B --type service');
    const output = mm('path isolated A B');
    expect(output).toContain('No paths');
  });

  it('respects --max-depth', () => {
    seedGraph();
    // With max-depth 2, the 3-edge path should be found but 4-edge should not
    const output = mm('path arch FleetView fleet-db --max-depth 3');
    expect(output).toContain('Path 1');
    // Only the direct 3-hop path (max-depth=3 means edges, so length 3 fits)
  });

  it('respects very small --max-depth (0)', () => {
    seedGraph();
    // Max depth 0 means we can only find the target if it IS the source
    const output = mm('path arch FleetView fleet-db --max-depth 1');
    expect(output).toContain('No paths');
  });

  it('outputs JSON with --json flag', () => {
    seedGraph();
    const result = mmJson('path arch FleetView fleet-db') as {
      from: string;
      to: string;
      pathCount: number;
      paths: Array<{
        index: number;
        length: number;
        edges: Array<{ source: string; relationship: string; target: string }>;
        nodes: Array<{ label: string; type: string | null; id: string }>;
      }>;
    };
    expect(result.from).toBe('FleetView');
    expect(result.to).toBe('fleet-db');
    expect(result.pathCount).toBe(2);
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].length).toBe(3);
    expect(result.paths[1].length).toBe(4);
    // First path edges
    expect(result.paths[0].edges[0].source).toBe('FleetView');
    expect(result.paths[0].edges[0].relationship).toBe('calls');
    expect(result.paths[0].edges[0].target).toBe('useFleet');
  });

  it('JSON output includes node types', () => {
    seedGraph();
    const result = mmJson('path arch FleetView fleet-db') as {
      paths: Array<{ nodes: Array<{ label: string; type: string | null }> }>;
    };
    const firstPathNodes = result.paths[0].nodes;
    const fleetView = firstPathNodes.find(n => n.label === 'FleetView');
    expect(fleetView?.type).toBe('component');
    const db = firstPathNodes.find(n => n.label === 'fleet-db');
    expect(db?.type).toBe('database');
  });

  it('handles single-hop path', () => {
    mm('create simple');
    mm('add simple A --type service');
    mm('add simple B --type database');
    mm('link simple A depends-on B');
    const output = mm('path simple A B');
    expect(output).toContain('Path 1 (length 1)');
    expect(output).toContain('depends-on');
  });

  it('errors on non-existent source node', () => {
    mm('create err-test');
    mm('add err-test A');
    try {
      mm('path err-test NonExistent A');
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      const error = e as { stderr: string };
      expect(error.stderr).toContain('not found');
    }
  });

  it('errors on non-existent target node', () => {
    mm('create err-test');
    mm('add err-test A');
    try {
      mm('path err-test A NonExistent');
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      const error = e as { stderr: string };
      expect(error.stderr).toContain('not found');
    }
  });

  it('finds path from node to itself (zero length)', () => {
    mm('create self-path');
    mm('add self-path A --type service');
    const result = mmJson('path self-path A A') as {
      pathCount: number;
      paths: Array<{ length: number }>;
    };
    // Finding a path from A to A: the node IS the target, so 1 path of length 0
    expect(result.pathCount).toBe(1);
    expect(result.paths[0].length).toBe(0);
  });
});
