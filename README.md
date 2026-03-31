# Engram
### Persistent knowledge traces for AI agents

*An [engram](https://en.wikipedia.org/wiki/Engram_(neuropsychology)) is the physical trace a memory leaves in the brain. This tool gives AI agents the same thing — persistent, structured, queryable knowledge that survives session restarts.*

Build, query, and maintain relationship graphs of codebases, organizations, infrastructure, and concepts.

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

## Install

```bash
# From npm (globally)
npm install -g @clawdactual/engram

# Then use directly
engram create myapp --type code --description "My application"
```

### From source

```bash
git clone https://github.com/Morpheis/engram.git
cd engram
npm install
npx tsx src/index.ts <command>
```

**Database location:** `~/.config/engram/models.db`  
**Override:** `ENGRAM_DB_PATH=/custom/path.db engram <command>`

## Command Reference

### Models

| Command | Description |
|---|---|
| `engram create <name> [-t type] [-d desc] [-r repo]` | Create a model (types: code, org, concept, infra) |
| `engram list` | List all models |
| `engram delete <name>` | Delete a model and all its data |
| `engram export <name> [-f format] [-o file]` | Export (formats: jsonld, json, dot) |
| `engram import <file>` | Import from JSON or JSON-LD file |

### Nodes

| Command | Description |
|---|---|
| `engram add <model> <label> [--type t] [-m k=v]` | Add a node with optional type and metadata |
| `engram rm <model> <node>` | Remove a node and its edges |
| `engram update <model> <node> [--label] [--type] [-m]` | Update node properties |
| `engram verify <model> <node>` | Mark a node as freshly verified |
| `engram nodes <model> [-t type]` | List nodes, optionally filtered by type |

### Edges

| Command | Description |
|---|---|
| `engram link <model> <src> <rel> <tgt> [-m k=v]` | Create a directed edge |
| `engram unlink <model> <src> <rel> <tgt>` | Remove an edge |
| `engram edges <model> [--from] [--to] [--rel]` | List edges with optional filters |

### Queries

| Command | Description |
|---|---|
| `engram q <model> <node> [--depth N]` | Node neighborhood (default depth: 1) |
| `engram q <model> --affects <node>` | Reverse traversal: what breaks if this changes? |
| `engram q <model> --depends-on <node>` | Forward traversal: what does this need? |
| `engram q <model> -t <type>` | All nodes of type (includes subtypes) |
| `engram q <model> --stale [--days N]` | Nodes not verified in N+ days |
| `engram q <model> --orphans` | Nodes with no edges |
| `engram path <model> <from> <to> [--max-depth N]` | Find all paths between two nodes |
| `engram search <query> [--model m] [--exclude m]` | Search across models (see Search section) |

### Types & Relationships

| Command | Description |
|---|---|
| `engram type list` | Show type hierarchy as tree |
| `engram type add <label> [--parent p] [--domain d]` | Add a custom type |
| `engram type rm <label>` | Remove a custom type |
| `engram rel list` | List relationship types with inverses |
| `engram rel add <label> [--inverse inv]` | Add a custom relationship |
| `engram rel rm <label>` | Remove a custom relationship |

### Branches

| Command | Description |
|---|---|
| `engram branch <model> <name>` | Create a branch overlay |
| `engram branch <model> --list` | List branch overlays |
| `engram merge <model> <name>` | Merge overlay into parent |
| `engram branch <model> <name> --delete` | Discard overlay |

### Git Integration

| Command | Description |
|---|---|
| `engram check <model>` | Compare anchor vs HEAD, show affected nodes |
| `engram refresh <model>` | Update anchor to HEAD, mark all verified |
| `engram diff <model>` | Detailed file-by-file diff with subgraph impact |
| `engram stale <model> [--days N]` | Show stale nodes and edges |

### Search

| Command | Description |
|---|---|
| `engram search <query>` | Search across ALL models (nodes, types, metadata) |
| `engram search <query> --model <name>` | Search within a specific model |
| `engram search <query> --limit <N>` | Max results (default: 5) |
| `engram search <query> --exclude <name>` | Skip a model (repeatable) |
| `engram search <query> --json` | JSON output for programmatic use |

Results include each matching node with its 1-hop edge neighborhood, grouped by model.

### Cross-Model & Batch

| Command | Description |
|---|---|
| `engram xlink <m1> <n1> <rel> <m2> <n2>` | Cross-model edge |
| `engram batch <model>` | Read commands from stdin |

## Example Workflows

### Map a codebase

```bash
engram create myapp -t code -d "My application" -r /path/to/repo
engram add myapp Frontend --type component -m file=src/App.tsx
engram add myapp API --type service -m file=src/api/server.ts -m port=3000
engram add myapp DB --type database -m engine=postgres
engram link myapp Frontend calls API -m via="REST /api"
engram link myapp API depends-on DB
engram refresh myapp
```

### Query blast radius

```bash
# What breaks if the database changes?
engram q myapp --affects DB

# How does the frontend reach the database?
engram path myapp Frontend DB

# What has changed since last review?
engram check myapp
```

### Visualize with Graphviz

```bash
# Generate a PNG
engram export myapp -f dot | dot -Tpng -o architecture.png

# Generate an SVG
engram export myapp -f dot | dot -Tsvg -o architecture.svg
```

DOT export maps node types to shapes and colors:

| Category | Color | Example Shapes |
|---|---|---|
| Code | Blue (#dbeafe) | component=ellipse, service=box, config=note |
| Org | Green (#dcfce7) | person=house, team=tab |
| Infra | Orange (#fed7aa) | database=cylinder, server=box3d |
| Concept | Purple (#e9d5ff) | process=hexagon, event=parallelogram |

### Model an org chart

```bash
engram create acme -t org -d "Acme Corp organizational structure"
engram batch acme <<EOF
add CEO --type person -m role="CEO & Founder"
add VP-Eng --type person -m role="VP Engineering"
add Dev-1 --type person -m role="Senior Engineer"
add Dev-2 --type person -m role="Engineer (Part-Time)"
link CEO leads acme
link VP-Eng reports_to CEO
link Dev-1 reports_to VP-Eng
link Dev-2 reports_to VP-Eng
link Dev-2 reports_to CEO
EOF

# Who reports to the CEO (direct + transitive)?
engram q acme --affects CEO

# What's the reporting chain from Dev-1 to CEO?
engram path acme Dev-1 CEO
```

Multiple `reports_to` edges model dual-reporting (e.g., matrix orgs) naturally. Use metadata for employment details like part-time status rather than separate node types.

### Share between agents (JSON-LD)

```bash
# Export with semantic context
engram export myapp -f jsonld -o myapp.jsonld

# Import on another machine / by another agent
engram import myapp.jsonld
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

Extend with `engram type add <label> --parent <existing>`.

## Agent Setup

If you're an AI agent using Engram, add this to your workspace bootstrap file (e.g., `AGENTS.md`) so future sessions know the system exists:

```markdown
- **Engram:** `/path/to/engram` — your persistent knowledge graph (relationships between
  code, people, systems). If `## 🔗 Knowledge Graph` appears in recalled context, that's
  engram. When you discover non-obvious relationships during work, add them:
  `cd /path/to/engram && npx tsx src/index.ts add <model> <node> ...`
  (read the skill for full usage).
```

This ensures new sessions know to both **use** and **maintain** the knowledge graph.

### Pre-work query habit

Query your knowledge graph **before** starting work on any repo or project:

```bash
# Hashbranch repos
engram q hashbranch <repo-name>

# Personal projects
engram q personal-projects <project-name>

# Don't know which model? Search across all
engram xq <keyword>
```

This surfaces existing connections, dependencies, and context you've already mapped — so you don't rediscover things or miss relationships. After finishing work, update with any new nodes or edges you discovered.

**Add this to your workflow instructions** (e.g., in a development skill or runbook):

```markdown
## Research Phase
1. **Query engram first:** `engram q <model> <repo-name>` — see connections and dependencies
2. Identify which repositories need changes
3. Understand the current code structure
4. Create a high-level plan
5. **Update engram after:** add new nodes/edges for anything discovered during research
```

The goal: engram becomes your **first stop** when starting work, not an afterthought.

### First-time setup: seed your models

After installing, do a one-time scan of your environment to seed useful models:

1. **Code models** — scan your repos. For each project, create a model with major modules and their dependencies.
2. **Org model** — if you work at a company, model the people, teams, repos, and service relationships. Include trust levels for people you interact with.
3. **Infrastructure model** — map your local tools and how they connect: email chains (ProtonMail → Bridge → wrapper), SSH configs, credential locations, channel setups.
4. **People model** — who do you interact with? What are their roles, communication channels, trust levels?

The goal: a fresh session should be able to query the graph and immediately understand your operational context without reading 10 config files.

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
