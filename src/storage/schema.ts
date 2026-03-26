import Database from 'better-sqlite3';
import { generateId } from '../utils/ids.js';

export const SCHEMA_VERSION = 2;

const DDL_V1 = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  type TEXT CHECK(type IN ('code', 'org', 'concept', 'infra')) DEFAULT 'concept',
  source_type TEXT CHECK(source_type IN ('git', 'manual')) DEFAULT 'manual',
  anchor TEXT,
  repo_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT,
  metadata TEXT DEFAULT '{}',
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, label)
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  weight REAL,
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, target_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_nodes_model ON nodes(model_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges(relationship);
`;

const DDL_V2 = `
CREATE TABLE IF NOT EXISTS type_defs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES type_defs(id),
  description TEXT,
  domain TEXT,
  built_in INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rel_defs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  inverse_label TEXT,
  description TEXT,
  source_type_constraint TEXT,
  target_type_constraint TEXT,
  built_in INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_type_defs_label ON type_defs(label);
CREATE INDEX IF NOT EXISTS idx_type_defs_parent ON type_defs(parent_id);
CREATE INDEX IF NOT EXISTS idx_rel_defs_label ON rel_defs(label);
`;

// ── Built-in type hierarchy ──────────────────────────
interface BuiltInType {
  label: string;
  parent?: string;
  domain?: string;
  description?: string;
  children?: BuiltInType[];
}

const BUILT_IN_TYPES: BuiltInType[] = [
  {
    label: 'thing', description: 'Root type', children: [
      {
        label: 'code', domain: 'code', description: 'Code-related entity', children: [
          {
            label: 'component', domain: 'code', description: 'UI component', children: [
              { label: 'page', domain: 'code', description: 'Page-level component' },
              { label: 'widget', domain: 'code', description: 'Reusable UI widget' },
            ]
          },
          { label: 'hook', domain: 'code', description: 'React hook or lifecycle hook' },
          { label: 'function', domain: 'code', description: 'Standalone function' },
          {
            label: 'service', domain: 'code', description: 'Backend service', children: [
              { label: 'microservice', domain: 'code', description: 'Microservice' },
            ]
          },
          { label: 'middleware', domain: 'code', description: 'Middleware layer' },
          { label: 'database', domain: 'code', description: 'Database' },
          { label: 'library', domain: 'code', description: 'Library or package' },
          { label: 'config', domain: 'code', description: 'Configuration' },
          { label: 'script', domain: 'code', description: 'Script or task' },
          { label: 'test-runner', domain: 'code', description: 'Test runner or framework' },
          { label: 'module', domain: 'code', description: 'Module or namespace' },
        ]
      },
      {
        label: 'org', domain: 'org', description: 'Organizational entity', children: [
          { label: 'person', domain: 'org', description: 'Individual person' },
          { label: 'team', domain: 'org', description: 'Team' },
          { label: 'role', domain: 'org', description: 'Role or position' },
          { label: 'company', domain: 'org', description: 'Company or organization' },
        ]
      },
      {
        label: 'infra', domain: 'infra', description: 'Infrastructure entity', children: [
          { label: 'server', domain: 'infra', description: 'Server' },
          { label: 'container', domain: 'infra', description: 'Container or pod' },
          { label: 'network', domain: 'infra', description: 'Network' },
          { label: 'endpoint', domain: 'infra', description: 'API endpoint' },
        ]
      },
      {
        label: 'concept', domain: 'concept', description: 'Abstract concept', children: [
          { label: 'process', domain: 'concept', description: 'Process or workflow' },
          { label: 'event', domain: 'concept', description: 'Event' },
          { label: 'rule', domain: 'concept', description: 'Business rule or constraint' },
        ]
      },
    ]
  },
];

// ── Built-in relationship definitions ────────────────
interface BuiltInRel {
  label: string;
  inverseLabel: string;
  description: string;
}

const BUILT_IN_RELS: BuiltInRel[] = [
  { label: 'calls', inverseLabel: 'called_by', description: 'Invocation / function call' },
  { label: 'depends_on', inverseLabel: 'depended_on_by', description: 'Dependency' },
  { label: 'contains', inverseLabel: 'contained_in', description: 'Structural containment' },
  { label: 'owns', inverseLabel: 'owned_by', description: 'Ownership / responsibility' },
  { label: 'uses', inverseLabel: 'used_by', description: 'Usage without direct invocation' },
  { label: 'extends', inverseLabel: 'extended_by', description: 'Inheritance / extension' },
  { label: 'implements', inverseLabel: 'implemented_by', description: 'Interface implementation' },
  { label: 'configures', inverseLabel: 'configured_by', description: 'Configuration relationship' },
  { label: 'produces', inverseLabel: 'produced_by', description: 'Output generation' },
  { label: 'consumes', inverseLabel: 'consumed_by', description: 'Input consumption' },
  { label: 'proxies_to', inverseLabel: 'proxied_by', description: 'Proxy/forwarding' },
  { label: 'manages', inverseLabel: 'managed_by', description: 'Management / administration' },
  { label: 'tests', inverseLabel: 'tested_by', description: 'Testing relationship' },
  { label: 'belongs_to', inverseLabel: 'has_member', description: 'Group membership' },
  { label: 'renders', inverseLabel: 'rendered_by', description: 'UI rendering' },
];

function seedTypes(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO type_defs (id, label, parent_id, description, domain, built_in)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  // Map label → id for parent resolution
  const labelToId = new Map<string, string>();

  function walk(types: BuiltInType[], parentLabel?: string): void {
    for (const t of types) {
      const id = `type_${t.label}`;
      const parentId = parentLabel ? labelToId.get(parentLabel) ?? null : null;
      labelToId.set(t.label, id);
      insert.run(id, t.label, parentId, t.description ?? null, t.domain ?? null);
      if (t.children) {
        walk(t.children, t.label);
      }
    }
  }

  walk(BUILT_IN_TYPES);
}

function seedRelDefs(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO rel_defs (id, label, inverse_label, description, built_in)
    VALUES (?, ?, ?, ?, 1)
  `);

  for (const r of BUILT_IN_RELS) {
    insert.run(`rel_${r.label}`, r.label, r.inverseLabel, r.description);
  }
}

function migrateV1toV2(db: Database.Database): void {
  // Add new tables
  db.exec(DDL_V2);

  // Add type_id column to nodes (nullable for backward compat)
  const nodeColumns = db.pragma('table_info(nodes)') as Array<{ name: string }>;
  if (!nodeColumns.some(c => c.name === 'type_id')) {
    db.exec('ALTER TABLE nodes ADD COLUMN type_id TEXT REFERENCES type_defs(id)');
  }

  // Add rel_id column to edges (nullable for backward compat)
  const edgeColumns = db.pragma('table_info(edges)') as Array<{ name: string }>;
  if (!edgeColumns.some(c => c.name === 'rel_id')) {
    db.exec('ALTER TABLE edges ADD COLUMN rel_id TEXT REFERENCES rel_defs(id)');
  }

  // Seed built-in types and relationships
  seedTypes(db);
  seedRelDefs(db);

  // Backfill existing nodes: match type string → type_defs
  db.exec(`
    UPDATE nodes SET type_id = (
      SELECT td.id FROM type_defs td WHERE td.label = nodes.type
    ) WHERE type IS NOT NULL AND type_id IS NULL
  `);

  // Backfill existing edges: match relationship string → rel_defs
  db.exec(`
    UPDATE edges SET rel_id = (
      SELECT rd.id FROM rel_defs rd WHERE rd.label = edges.relationship
    ) WHERE rel_id IS NULL
  `);

  // Update schema version
  db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
}

export function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check current version
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (!hasVersionTable) {
    // Fresh database — create everything
    db.exec(DDL_V1);
    db.exec(DDL_V2);

    // Add type_id to nodes and rel_id to edges
    const nodeColumns = db.pragma('table_info(nodes)') as Array<{ name: string }>;
    if (!nodeColumns.some(c => c.name === 'type_id')) {
      db.exec('ALTER TABLE nodes ADD COLUMN type_id TEXT REFERENCES type_defs(id)');
    }
    const edgeColumns = db.pragma('table_info(edges)') as Array<{ name: string }>;
    if (!edgeColumns.some(c => c.name === 'rel_id')) {
      db.exec('ALTER TABLE edges ADD COLUMN rel_id TEXT REFERENCES rel_defs(id)');
    }

    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    seedTypes(db);
    seedRelDefs(db);
    return;
  }

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    // Shouldn't normally happen, but handle edge case
    db.exec(DDL_V1);
    if (!row) {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    } else {
      db.prepare('UPDATE schema_version SET version = ?').run(1);
    }
  }

  if (currentVersion < 2) {
    migrateV1toV2(db);
  }

  // Always re-seed built-ins (idempotent via INSERT OR IGNORE)
  seedTypes(db);
  seedRelDefs(db);
}
