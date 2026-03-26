# Mental Model — Design v2 (Ontology-Informed)

> Updated after research into RDF, OWL, and formal ontology.
> Adopts useful concepts (type hierarchies, relationship ontology, namespacing, JSON-LD export).
> Skips overhead (full OWL reasoning, SPARQL, URI-everything).

## Changes from v1

1. **Type hierarchies** — Types are no longer flat strings. A `types` table supports inheritance (`microservice subClassOf service subClassOf component`). Queries by type automatically include subtypes.
2. **Relationship ontology** — Built-in relationship types with defined inverses. Custom types allowed.
3. **Branch-aware code models** — Models can track branches via overlay system. Base model on main/dev, overlays for feature branches.
4. **Namespaced IDs** — Cross-model references use `model:node-id` format.
5. **JSON-LD export** — Self-describing exports with `@context` for semantic interoperability.

## Data Model (Revised)

```sql
-- models table
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  type TEXT CHECK(type IN ('code', 'org', 'concept', 'infra')) DEFAULT 'concept',
  source_type TEXT CHECK(source_type IN ('git', 'manual')) DEFAULT 'manual',
  anchor TEXT,              -- commit hash (code) or timestamp (manual)
  branch TEXT,              -- git branch name (code models)
  repo_path TEXT,
  parent_model_id TEXT REFERENCES models(id),  -- for branch overlays
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- type hierarchy (ontology-inspired)
CREATE TABLE type_defs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  parent_id TEXT REFERENCES type_defs(id),
  description TEXT,
  domain TEXT,              -- which model type this applies to (code, org, concept, infra, or NULL for universal)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- relationship definitions with inverses
CREATE TABLE rel_defs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  inverse_label TEXT,       -- e.g., 'calls' inverse is 'called_by'
  description TEXT,
  source_type_constraint TEXT,  -- optional: source must be of this type
  target_type_constraint TEXT,  -- optional: target must be of this type
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- nodes table
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type_id TEXT REFERENCES type_defs(id),
  type_label TEXT,          -- denormalized for quick display (also allows ad-hoc types)
  metadata TEXT DEFAULT '{}',
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, label)
);

-- edges table
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel_id TEXT REFERENCES rel_defs(id),
  relationship TEXT NOT NULL,  -- denormalized label for quick access
  metadata TEXT DEFAULT '{}',
  weight REAL,
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, target_id, relationship)
);

-- branch overlay tracking (what changed vs parent model)
CREATE TABLE overlay_changes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  change_type TEXT CHECK(change_type IN ('add_node', 'remove_node', 'modify_node', 'add_edge', 'remove_edge', 'modify_edge')),
  target_id TEXT NOT NULL,  -- node or edge id
  old_data TEXT,            -- JSON snapshot of previous state
  new_data TEXT,            -- JSON snapshot of new state
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Built-in Type Hierarchy

```
thing
├── code
│   ├── component
│   │   ├── page
│   │   └── widget
│   ├── hook
│   ├── function
│   ├── service
│   │   └── microservice
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

Types are user-extensible. `mm type add my-model ui-component --parent component`.

## Built-in Relationship Ontology

| Relationship | Inverse | Description |
|---|---|---|
| calls | called_by | Invocation / function call |
| depends_on | depended_on_by | Dependency (build, runtime) |
| contains | contained_in | Structural containment |
| owns | owned_by | Ownership / responsibility |
| uses | used_by | Usage without direct invocation |
| extends | extended_by | Inheritance / extension |
| implements | implemented_by | Interface implementation |
| configures | configured_by | Configuration relationship |
| produces | produced_by | Output generation |
| consumes | consumed_by | Input consumption |
| proxies_to | proxied_by | Proxy/forwarding |
| manages | managed_by | Management / administration |
| tests | tested_by | Testing relationship |
| belongs_to | has_member | Group membership |
| renders | rendered_by | UI rendering |

Custom relationships: `mm rel add my-model "monitors" --inverse "monitored_by"`.

## Branch-Aware Code Models

### Concept
A code model anchors to a specific branch. When working on a feature branch:

1. **Create an overlay:** `mm branch hashbranch-arch feature/CLA-123`
   - Creates a child model linked to the parent via `parent_model_id`
   - Inherits all nodes/edges from parent
   - Tracks only differences (additions, removals, modifications)

2. **Work on the overlay:** Normal `mm add`, `mm link` commands apply to the overlay

3. **Query resolves through layers:** Querying the overlay returns parent + overlay changes

4. **Merge overlay:** `mm merge hashbranch-arch feature/CLA-123`
   - Applies overlay changes to the parent model
   - Deletes the overlay
   - Updates parent anchor to new commit

### Branch CLI

```bash
mm branch <model> <branch-name>           # create overlay from current model
mm branch <model> --list                   # list all branch overlays
mm merge <model> <branch-name>            # fold overlay into parent
mm branch <model> <branch-name> --delete   # discard overlay
mm switch <model> <branch-name>            # set active branch for queries
```

## JSON-LD Export

Exports include a `@context` for semantic interoperability:

```json
{
  "@context": {
    "mm": "https://github.com/Morpheis/mental-model/schema#",
    "nodes": "mm:nodes",
    "edges": "mm:edges",
    "label": "mm:label",
    "type": "mm:type",
    "relationship": "mm:relationship",
    "calls": "mm:calls",
    "depends_on": "mm:depends_on",
    "metadata": "mm:metadata",
    "verified_at": "mm:verified_at"
  },
  "@type": "mm:Model",
  "name": "hashbranch-arch",
  "modelType": "code",
  "branch": "dev",
  "anchor": "abc1234",
  "nodes": [...],
  "edges": [...]
}
```

Any agent that understands JSON can parse it. Agents that understand JSON-LD get semantic context for free.

## New CLI Commands

```bash
# ── Type Management ───────────────────────────────────
mm type list                               # list all types (tree view)
mm type add <label> [--parent <parent>] [--domain code|org|infra|concept]
mm type rm <label>

# ── Relationship Management ───────────────────────────
mm rel list                                # list all relationship types
mm rel add <label> [--inverse <inverse>] [--source-type <type>] [--target-type <type>]

# ── Branch Management (code models) ──────────────────
mm branch <model> <branch-name>            # create overlay
mm branch <model> --list                   # list overlays
mm merge <model> <branch-name>             # fold overlay into parent
mm switch <model> <branch-name>            # set active branch

# ── Enhanced Queries ──────────────────────────────────
mm q <model> <node> --inverse              # show inverse relationships
mm q <model> --type service                # includes subtypes (microservice, etc.)
```

## Implementation Plan

### Phase 2a: Type System + Relationship Ontology
- type_defs table + CRUD + seed built-in hierarchy
- rel_defs table + CRUD + seed built-in relationships
- Update node creation to resolve types against hierarchy
- Update queries to resolve type inheritance (include subtypes)
- Update edge creation to resolve relationship definitions

### Phase 2b: Branch Overlays
- overlay_changes table
- Branch create/list/switch/merge/delete commands
- Query resolution through parent + overlay layers

### Phase 2c: JSON-LD Export + Namespaced IDs
- JSON-LD export with @context
- Namespaced ID format (model:node-id) for cross-model refs
- Import that handles namespaced IDs
- Validate cross-model edges with namespaces

### Phase 2d: Git Integration
- `mm check` — diff anchor vs HEAD, map to affected nodes
- `mm refresh` — update anchor, mark verified
- `mm diff` — detailed change summary with affected subgraph
