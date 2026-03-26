# Mental Model (`mm`)

A structured knowledge graph tool for AI agents. Build, query, and maintain persistent relationship graphs of codebases, organizations, infrastructure, and concepts.

## Features

- **Persistent storage** — SQLite-backed, survives session restarts
- **Type hierarchy** — Built-in ontology (component, service, database, person, etc.) with inheritance and extensibility
- **Relationship ontology** — 15 built-in relationship types with inverses; custom types supported
- **Branch overlays** — Track feature branch changes as overlays on a base model, then merge
- **Git integration** — Anchor models to git commits, detect drift, map file changes to affected nodes
- **Path finding** — Find all paths between two nodes with configurable depth
- **Cross-model linking** — Reference nodes across models using namespaced IDs
- **Export formats** — JSON, JSON-LD (semantic), and DOT (Graphviz visualization)
- **Batch operations** — Pipe commands via stdin for bulk model building

## Quick Start

```bash
# Clone and install
git clone git@github.com:Morpheis/mental-model.git
cd mental-model
npm install

# Run (not yet globally installed)
npx tsx src/index.ts <command>

# Or with alias
alias mm='cd ~/Personal/mental-model && npx tsx src/index.ts'
```

**Database location:** `~/.config/mental-model/models.db`  
**Override:** `MM_DB_PATH=/custom/path.db npx tsx src/index.ts <command>`

## Command Reference

### Models

| Command | Description |
|---|---|
| `mm create <name> [-t type] [-d desc] [-r repo]` | Create a model (types: code, org, concept, infra) |
| `mm list` | List all models |
| `mm delete <name>` | Delete a model and all its data |
| `mm export <name> [-f format] [-o file]` | Export (formats: jsonld, json, dot) |
| `mm import <file>` | Import from JSON or JSON-LD file |

### Nodes

| Command | Description |
|---|---|
| `mm add <model> <label> [--type t] [-m k=v]` | Add a node with optional type and metadata |
| `mm rm <model> <node>` | Remove a node and its edges |
| `mm update <model> <node> [--label] [--type] [-m]` | Update node properties |
| `mm verify <model> <node>` | Mark a node as freshly verified |
| `mm nodes <model> [-t type]` | List nodes, optionally filtered by type |

### Edges

| Command | Description |
|---|---|
| `mm link <model> <src> <rel> <tgt> [-m k=v]` | Create a directed edge |
| `mm unlink <model> <src> <rel> <tgt>` | Remove an edge |
| `mm edges <model> [--from] [--to] [--rel]` | List edges with optional filters |

### Queries

| Command | Description |
|---|---|
| `mm q <model> <node> [--depth N]` | Node neighborhood (default depth: 1) |
| `mm q <model> --affects <node>` | Reverse traversal: what breaks if this changes? |
| `mm q <model> --depends-on <node>` | Forward traversal: what does this need? |
| `mm q <model> -t <type>` | All nodes of type (includes subtypes) |
| `mm q <model> --stale [--days N]` | Nodes not verified in N+ days |
| `mm q <model> --orphans` | Nodes with no edges |
| `mm path <model> <from> <to> [--max-depth N]` | Find all paths between two nodes |
| `mm xq <query>` | Search across all models |

### Types & Relationships

| Command | Description |
|---|---|
| `mm type list` | Show type hierarchy as tree |
| `mm type add <label> [--parent p] [--domain d]` | Add a custom type |
| `mm type rm <label>` | Remove a custom type |
| `mm rel list` | List relationship types with inverses |
| `mm rel add <label> [--inverse inv]` | Add a custom relationship |
| `mm rel rm <label>` | Remove a custom relationship |

### Branches

| Command | Description |
|---|---|
| `mm branch <model> <name>` | Create a branch overlay |
| `mm branch <model> --list` | List branch overlays |
| `mm merge <model> <name>` | Merge overlay into parent |
| `mm branch <model> <name> --delete` | Discard overlay |

### Git Integration

| Command | Description |
|---|---|
| `mm check <model>` | Compare anchor vs HEAD, show affected nodes |
| `mm refresh <model>` | Update anchor to HEAD, mark all verified |
| `mm diff <model>` | Detailed file-by-file diff with subgraph impact |
| `mm stale <model> [--days N]` | Show stale nodes and edges |

### Cross-Model & Batch

| Command | Description |
|---|---|
| `mm xlink <m1> <n1> <rel> <m2> <n2>` | Cross-model edge |
| `mm batch <model>` | Read commands from stdin |

## Example Workflows

### Map a codebase

```bash
mm create myapp -t code -d "My application" -r /path/to/repo
mm add myapp Frontend --type component -m file=src/App.tsx
mm add myapp API --type service -m file=src/api/server.ts -m port=3000
mm add myapp DB --type database -m engine=postgres
mm link myapp Frontend calls API -m via="REST /api"
mm link myapp API depends-on DB
mm refresh myapp
```

### Query blast radius

```bash
# What breaks if the database changes?
mm q myapp --affects DB

# How does the frontend reach the database?
mm path myapp Frontend DB

# What has changed since last review?
mm check myapp
```

### Visualize with Graphviz

```bash
# Generate a PNG
mm export myapp -f dot | dot -Tpng -o architecture.png

# Generate an SVG
mm export myapp -f dot | dot -Tsvg -o architecture.svg
```

DOT export maps node types to shapes and colors:

| Category | Color | Example Shapes |
|---|---|---|
| Code | Blue (#dbeafe) | component=ellipse, service=box, config=note |
| Org | Green (#dcfce7) | person=house, team=tab |
| Infra | Orange (#fed7aa) | database=cylinder, server=box3d |
| Concept | Purple (#e9d5ff) | process=hexagon, event=parallelogram |

### Share between agents (JSON-LD)

```bash
# Export with semantic context
mm export myapp -f jsonld -o myapp.jsonld

# Import on another machine / by another agent
mm import myapp.jsonld
```

JSON-LD exports include a `@context` object with schema URIs, making the data self-describing for any JSON-LD-aware consumer.

## Export Formats

| Format | Flag | Description |
|---|---|---|
| JSON-LD | `-f jsonld` (default) | Self-describing with `@context`. Best for sharing between agents. |
| JSON | `-f json` | Raw data dump. Backward-compatible. |
| DOT | `-f dot` | Graphviz DOT language. Pipe to `dot` for rendering. |

## Built-in Type Hierarchy

```
thing
├── code
│   ├── component (page, widget)
│   ├── hook
│   ├── function
│   ├── service (microservice)
│   ├── middleware
│   ├── database
│   ├── library
│   ├── config
│   ├── script
│   ├── test-runner
│   └── module
├── org
│   ├── person
│   ├── team
│   ├── role
│   └── company
├── infra
│   ├── server
│   ├── container
│   ├── network
│   └── endpoint
└── concept
    ├── process
    ├── event
    └── rule
```

Extend with `mm type add <label> --parent <existing>`.

## Architecture

See [DESIGN-v2.md](DESIGN-v2.md) for the full design specification including data model, ontology decisions, and implementation phases.

## Development

```bash
npm install
npm test              # run all tests
npm run test:watch    # watch mode
npm run build         # compile TypeScript
```

## License

MIT
