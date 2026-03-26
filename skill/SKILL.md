---
name: mental-model
description: Build, query, and maintain structured knowledge graphs. Use when you need to remember relationships between code components, services, people, or any concepts across sessions. Provides persistent graph storage with type hierarchies, relationship ontology, branch overlays, git integration, and cross-model linking. Trigger on "mental model", "knowledge graph", "dependency graph", "build a model of", "map the architecture", "what depends on", "blast radius", or any request to track relationships between entities.
metadata:
  author: ClawdActual
  version: "2.0.0"
---

# Mental Model (mm)

A persistent knowledge graph for AI agents. Store nodes (components, services, people, concepts) and edges (calls, depends_on, owns) in a local SQLite database. Survives sessions. Query dependencies, find paths, check freshness against git, export for visualization.

## How to Run

```bash
cd ~/Personal/mental-model && npx tsx src/index.ts <command>
```

Alias shorthand used below: `mm <command>` (substitute the full path above).

**Database:** `~/.config/mental-model/models.db` (override: `MM_DB_PATH=/path/to/db`)

**Global flag:** `--json` on any command outputs structured JSON.

## Quick Reference

### Models (containers for graphs)

```bash
mm create <name> [-t code|org|concept|infra] [-d "description"] [-r /repo/path]
mm list
mm delete <name>
mm export <name> [-f jsonld|json|dot] [-o file]
mm import <file>
```

### Nodes

```bash
mm add <model> <label> [--type <type>] [-m key=value ...]
mm rm <model> <node>
mm update <model> <node> [--label new] [--type new] [-m key=value ...]
mm verify <model> <node>           # mark as recently verified
mm nodes <model> [-t type]
```

### Edges

```bash
mm link <model> <source> <rel> <target> [-m key=value ...]
mm unlink <model> <source> <rel> <target>
mm edges <model> [--from node] [--to node] [--rel type]
```

### Queries

```bash
mm q <model> <node>                # neighbors (depth 1)
mm q <model> <node> --depth 3     # expand neighborhood
mm q <model> --affects <node>     # what breaks if this changes? (reverse traversal)
mm q <model> --depends-on <node>  # what does this need? (forward traversal)
mm q <model> -t service           # all nodes of type (includes subtypes)
mm q <model> --stale --days 14    # nodes not verified in 14+ days
mm q <model> --orphans            # nodes with no edges
mm path <model> <from> <to> [--max-depth N]  # all paths between two nodes
mm xq <query>                     # search across all models
```

### Types & Relationships

```bash
mm type list                      # show type hierarchy tree
mm type add <label> [--parent p] [--domain code|org|infra|concept]
mm type rm <label>
mm rel list                       # show all relationship types with inverses
mm rel add <label> [--inverse inv]
mm rel rm <label>
```

### Branches (code model overlays)

```bash
mm branch <model> <branch-name>             # create overlay
mm branch <model> --list                    # list overlays
mm merge <model> <branch-name>              # fold into parent
mm branch <model> <branch-name> --delete    # discard
```

### Git Integration (code models only)

```bash
mm check <model>       # compare anchor vs HEAD, show affected nodes
mm refresh <model>     # update anchor to HEAD, mark all verified
mm diff <model>        # detailed file-by-file diff with affected subgraph
mm stale <model>       # show stale nodes and edges
```

### Cross-Model

```bash
mm xlink <model1> <node1> <rel> <model2> <node2>
```

### Batch

```bash
echo "add mymodel NodeA --type service
add mymodel NodeB --type database
link mymodel NodeA depends-on NodeB" | mm batch mymodel
```

## Built-in Types (extensible)

```
thing
├── code: component, page, widget, hook, function, service, microservice,
│         middleware, database, library, config, script, test-runner, module
├── org: person, team, role, company
├── infra: server, container, network, endpoint
└── concept: process, event, rule
```

Type queries include subtypes: `mm q model -t service` finds services AND microservices.

## Built-in Relationships (extensible)

| Relationship | Inverse |
|---|---|
| calls | called_by |
| depends_on | depended_on_by |
| contains | contained_in |
| owns | owned_by |
| uses | used_by |
| extends | extended_by |
| implements | implemented_by |
| configures | configured_by |
| produces | produced_by |
| consumes | consumed_by |
| proxies_to | proxied_by |
| manages | managed_by |
| tests | tested_by |
| belongs_to | has_member |
| renders | rendered_by |

## Common Workflows

### Map a codebase architecture

```bash
mm create myapp -t code -d "My application" -r /path/to/repo
mm add myapp Frontend --type component -m file=src/App.tsx
mm add myapp API --type service -m file=src/api/server.ts -m port=3000
mm add myapp DB --type database -m engine=postgres
mm link myapp Frontend calls API -m via="REST /api"
mm link myapp API depends-on DB
mm refresh myapp   # anchor to current git HEAD
```

### Check blast radius before a change

```bash
mm q myapp --affects API       # everything upstream of API
mm path myapp Frontend DB      # all paths from Frontend to DB
mm check myapp                 # what git changes affect which nodes
```

### Branch overlay for feature work

```bash
mm branch myapp feature/new-cache
mm add myapp Redis --type database
mm link myapp API uses Redis
# ... later ...
mm merge myapp feature/new-cache   # fold changes into base model
```

### Share models between agents (JSON-LD)

```bash
mm export myapp -f jsonld -o myapp.jsonld    # export with semantic context
mm import myapp.jsonld                        # another agent imports it
```

### Visualize with Graphviz

```bash
mm export myapp -f dot | dot -Tpng -o graph.png   # requires graphviz installed
mm export myapp -f dot -o myapp.dot                # save DOT file
```

### Track freshness over time

```bash
mm stale myapp --days 7        # what hasn't been verified this week?
mm verify myapp API            # mark a node as freshly verified
mm refresh myapp               # mark everything verified (after review)
```
