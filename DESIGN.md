# Mental Model — Design Document

> A structured knowledge graph tool for AI agents. Build, query, and maintain relationship graphs for codebases, organizations, concepts, and any domain where understanding connections matters.

## Problem

AI agents lose structural knowledge between sessions. During a coding session, I discover that `FleetView` calls `useFleet` which proxies to `fleet-rest` which connects to a Postgres database — but that chain vanishes when the context window closes. Next session, I re-discover it from scratch.

**What exists today and why it's not enough:**

| Tool | What it does | Gap |
|------|-------------|-----|
| QMD / search | Finds documents by keyword | Can't answer "what depends on X?" |
| MEMORY.md | Free-text long-term notes | No structure, can't traverse relationships |
| Architecture docs | Static snapshots | Stale within days, manual upkeep |
| Chitin | Behavioral patterns | Not structural knowledge |
| Code grep | Find references | Cross-repo invisible, requires knowing what to grep, redo every session |

**The gap:** None of these model *relationships between things*. They're retrieval or key-value stores. There's no way to say "Service A calls Service B through Proxy C" and later ask "what's affected if I change Service B?"

## Solution

A lightweight CLI tool that lets agents build and query directed graphs of entities and relationships. Think of it as an externalized mental model — the structural knowledge that a human engineer keeps in their head but an agent loses every session.

## Core Concepts

### Models
A **model** is a named graph representing a domain. Examples:
- `hashbranch-medusa` — codebase architecture
- `hashbranch-team` — organizational structure
- `fleet-data-flow` — how fleet data moves through the system
- `ken-family` — family relationships

Models are independent but can reference each other via cross-model edges.

### Nodes
A **node** is an entity in the graph. It has:
- **id** — auto-generated or user-specified (e.g., `fleet-rest`, `FleetView`)
- **label** — human-readable name
- **type** — categorization (e.g., `service`, `component`, `hook`, `database`, `person`, `config`)
- **metadata** — arbitrary key-value pairs (e.g., `repo: hb-fleet-rest`, `file: src/routes/fleets/page.tsx`)
- **verified_at** — timestamp of last verification
- **anchor** — optional commit hash (for code models) tying this node to a point in time

### Edges
An **edge** is a directed relationship between two nodes:
- **source** → **target**
- **relationship** — labeled verb (e.g., `calls`, `depends_on`, `proxies_to`, `owns`, `manages`, `contains`)
- **metadata** — context (e.g., `via: "proxy /admin/fleets"`, `protocol: "REST"`)
- **verified_at** — timestamp of last verification
- **weight** — optional numeric weight for importance/confidence

### Anchoring & Freshness

**Code models** anchor to a git commit hash. Freshness check:
1. Compare `model.anchor` to current `HEAD`
2. If same → model is fresh
3. If different → `git diff anchor..HEAD --stat` shows changed files
4. Map changed files to nodes via metadata (node.file, node.repo)
5. Mark affected nodes/edges as `needs_verification`
6. An agent (or the tool itself) can re-verify and update the anchor

**Non-code models** use timestamps. Nodes/edges have `verified_at`. Query for stale entries:
```bash
mm stale --older-than 30d
```

## Data Model

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    models     │     │    nodes     │     │    edges     │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │────<│ model_id     │     │ id           │
│ name         │     │ id           │──┬──│ source_id    │
│ description  │     │ label        │  └──│ target_id    │
│ type         │     │ type         │     │ relationship │
│ source_type  │     │ metadata     │     │ metadata     │
│ anchor       │     │ verified_at  │     │ verified_at  │
│ repo_path    │     │ created_at   │     │ weight       │
│ created_at   │     │ updated_at   │     │ created_at   │
│ updated_at   │     └──────────────┘     │ updated_at   │
└──────────────┘                          └──────────────┘
```

**Cross-model edges:** `source_id` and `target_id` can reference nodes in different models. The edge itself belongs to one model (the "owner" model).

## CLI Design

### Speed-first principles
- Every command completes in <100ms for local operations
- Batch mode for multi-node/edge creation
- Short aliases for common operations
- Output defaults to compact/human-readable; `--json` for programmatic use

### Commands

```bash
# ── Model Management ──────────────────────────────────
mm create <name> [--type code|org|concept|infra] [--repo /path] [--description "..."]
mm list                                # list all models
mm delete <name>                       # delete a model and all its nodes/edges
mm export <name> [--format json|dot]   # export for sharing/visualization
mm import <file>                       # import a model from file

# ── Node Operations ───────────────────────────────────
mm add <model> <label> [--type <type>] [--meta key=value ...] [--id <custom-id>]
mm rm <model> <node-id>                # remove node and its edges
mm update <model> <node-id> [--label ...] [--type ...] [--meta key=value ...]
mm verify <model> <node-id>            # mark as verified now
mm nodes <model> [--type <type>]       # list nodes, optionally filtered

# ── Edge Operations ───────────────────────────────────
mm link <model> <source> <rel> <target> [--meta key=value ...] [--weight N]
mm unlink <model> <source> <rel> <target>  # remove specific edge
mm edges <model> [--from <node>] [--to <node>] [--rel <relationship>]

# ── Batch Operations ──────────────────────────────────
mm batch <model> <<EOF
add FleetView --type component --meta file=src/routes/fleets/[id]/components/FleetView.tsx
add useFleet --type hook --meta file=src/hooks/useFleet.ts
add fleet-rest --type service --meta repo=hb-fleet-rest
link FleetView calls useFleet
link useFleet calls fleet-rest --meta via="proxy /admin/fleets"
EOF

# ── Queries ───────────────────────────────────────────
mm q <model> <node-id>                 # show node with all connections
mm q <model> <node-id> --depth 2       # show 2-hop neighborhood
mm q <model> --from <A> --to <B>       # find paths between A and B
mm q <model> --affects <node-id>       # what's affected if this changes (reverse deps)
mm q <model> --depends-on <node-id>    # what does this depend on (forward deps)
mm q <model> --type <type>             # all nodes of a type
mm q <model> --stale [--days 30]       # nodes/edges not verified recently
mm q <model> --orphans                 # nodes with no edges

# ── Freshness (Code Models) ──────────────────────────
mm check <model>                       # compare anchor to HEAD, show affected nodes
mm refresh <model>                     # update anchor to HEAD, mark all as verified
mm diff <model>                        # detailed diff summary with affected subgraph

# ── Cross-Model ──────────────────────────────────────
mm xlink <model1> <node1> <rel> <model2> <node2>  # cross-model edge
mm xq <node-id>                        # find a node across all models
```

### Example Session

```bash
# After exploring the Hashbranch codebase:
$ mm create hashbranch-arch --type code --repo ~/Hashbranch/hashbranch-medusa-2

$ mm batch hashbranch-arch <<EOF
add FleetView --type component --meta file=src/admin/routes/fleets/[id]/components/FleetView.tsx
add useFleet --type hook --meta file=src/admin/hooks/useFleet.ts
add fleet-rest --type service --meta repo=hb-fleet-rest port=5020
add fleet-db --type database --meta name=hb_fleet_rest
add TabsView --type component --meta file=src/admin/components/common/TabsView.tsx
add isPubSubDisabled --type function --meta file=src/common/utils/env.utils.ts repo=hb-fleet-rest
link FleetView calls useFleet
link FleetView uses TabsView
link useFleet calls fleet-rest --meta via="proxy /admin/fleets" protocol=REST
link fleet-rest depends_on fleet-db
link fleet-rest calls isPubSubDisabled --meta context="startup auth check"
EOF
# → Added 6 nodes, 5 edges

# Later, need to modify fleet-rest:
$ mm q hashbranch-arch --affects fleet-rest
# fleet-rest
#   ← called by: useFleet (via proxy /admin/fleets)
#     ← called by: FleetView
#   → depends on: fleet-db
#   → calls: isPubSubDisabled

# Check freshness after a week:
$ mm check hashbranch-arch
# Model anchored at abc1234 (7 days ago)
# HEAD is now def5678
# Changed files:
#   src/admin/hooks/useFleet.ts → affects: useFleet
#   src/admin/routes/fleets/[id]/components/FleetView.tsx → affects: FleetView
# 2 nodes need verification, 3 edges potentially affected
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                   CLI Layer                  │
│  (argument parsing, output formatting)       │
├─────────────────────────────────────────────┤
│                 Query Engine                 │
│  (traversals, path finding, freshness)       │
├─────────────────────────────────────────────┤
│              Storage Interface               │
│  (abstract: add, remove, query, traverse)    │
├──────────────────┬──────────────────────────┤
│  SQLite Backend  │  Future: Graph Backend   │
│  (nodes/edges    │  (Kuzu, DuckDB+graph,    │
│   tables, CTEs)  │   or similar)            │
└──────────────────┴──────────────────────────┘
```

**Storage abstraction** is key — the CLI and query engine talk to an interface, not directly to SQLite. When we swap to a graph backend, only the storage layer changes.

## Technology

- **Language:** TypeScript (npm package, consistent with Chitin/Bookworm)
- **Storage:** SQLite via better-sqlite3 (synchronous, fast, zero-config)
- **CLI:** Commander.js or yargs
- **Output:** Chalk for color, columnify for tables
- **Export:** JSON (native), DOT (for Graphviz visualization)
- **Database location:** `~/.config/mental-model/models.db` (single file, all models)

## Implementation Phases

### Phase 1: Core (MVP)
- Model CRUD (create, list, delete)
- Node CRUD (add, remove, update, list)
- Edge CRUD (link, unlink, list)
- Basic queries (node info, direct neighbors, depth-N traversal)
- Batch mode
- JSON export/import

### Phase 2: Intelligence
- Path finding (A → B)
- Blast radius (`--affects`)
- Dependency chain (`--depends-on`)
- Freshness: git commit anchoring + diff-based staleness detection
- Stale/orphan queries
- Cross-model edges and queries

### Phase 3: Agent Integration
- OpenClaw skill with SKILL.md
- Heartbeat-driven freshness checks
- Sub-agent for model updates from git diffs
- DOT export for Graphviz visualization
- Integration with existing tools (QMD indexing of model data)

### Phase 4: Graph Backend Migration
- Abstract storage interface
- Kuzu or equivalent embedded graph DB
- Performance benchmarks comparing SQLite vs graph for traversals
- Migration tool for existing data

## Design Decisions

### Why not just use a JSON file?
JSON works for tiny graphs but doesn't support queries. "What depends on X?" requires traversing edges, which means loading the entire graph and walking it in memory. SQLite gives indexed lookups and recursive CTEs for traversals without loading everything.

### Why not a full graph database from day one?
Pragmatism. SQLite has zero dependencies, is proven, and handles the expected scale (hundreds to low thousands of nodes) easily. The storage abstraction means we can swap later without changing the CLI or query semantics.

### Why a CLI and not an API?
Agents interact with tools via shell commands. A CLI is the natural interface. It also makes the tool usable by any agent framework, not just OpenClaw. An API layer could be added later if needed (e.g., for a web UI).

### Why not extend QMD or Chitin?
Different concerns. QMD is document retrieval (BM25 + vector search). Chitin is behavioral patterns. Mental Model is structural relationships. Each has a distinct data model and query pattern. They can integrate (QMD could index model exports, Chitin could inform model-building patterns) but shouldn't be merged.

### Single DB file vs per-model files?
Single file. Cross-model queries need access to all models. Separate files would require opening multiple DB connections and can't do cross-model joins. A single `models.db` with model_id as a partition key gives both isolation (filter by model) and integration (cross-model queries).
