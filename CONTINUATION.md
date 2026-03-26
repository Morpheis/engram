# Engram — Continuation Notes

## Status (2026-03-25)

### Phase 1: COMPLETE ✅
- 58 tests passing, all commands working
- CLI: `npx tsx src/index.ts <command>` (or `mm` when globally linked)
- DB: `~/.config/engram/models.db` (override with `ENGRAM_DB_PATH`)

### Phase 2: COMPLETE ✅
- Batch command, verify, check, cross-model links, JSON-LD export
- Path finding (`mm path`) exposed in CLI
- Git integration: `mm check`, `mm refresh`, `mm diff`, `mm stale`

### Phase 3: COMPLETE ✅
- DOT/Graphviz export with domain-colored nodes and cluster support
- OpenClaw skill (SKILL.md) with best practices, org chart guidance
- Cross-model search: `mm search <query>` with `--exclude`, `--model`, `--limit`, `--json`
- openclaw-recall integration (MentalModelSearchSource with auto-detection)

### Phase 4: TODO
- Graph DB migration (Kuzu) — only when scale demands it
- FTS5 for faster text search (currently LIKE-based, fine for current scale)

### Current Test Count: 305 tests across 14 files

## Active Models (10 models, 168 nodes, 211 edges)
- `chitin` (code) — 19 nodes, 27 edges. Personality persistence layer internals.
- `oathkeeper` (code) — 20 nodes, 22 edges. Smart contract + SDK architecture.
- `hashbranch` (org) — 20 nodes, 38 edges. Org chart + all repos + service relationships.
- `hashbranch-e2e` (code) — 20 nodes, 23 edges. E2E test debugging relationships.
- `mental-model` (code) — 24 nodes, 39 edges. Engram's own architecture (self-referential).
- `openclaw-recall` (code) — 13 nodes, 25 edges. Recall plugin architecture.
- `personal-projects` (code) — 21 nodes, 10 edges. All personal repos catalogued.
- `zink-family` (org) — 4 nodes, 4 edges. Family relationships.
- `infrastructure` (infra) — 19 nodes, 15 edges. Local tools, services, credentials, connections.
- `people` (org) — 8 nodes, 8 edges. Boss, coworkers, friends, trust levels.

## Saved Models

### hashbranch-e2e-model.json
**These are REAL relationships** discovered during the March 25 e2e debugging session.
All nodes and edges reflect actual code structure as of that date.

Key insights captured in node metadata:
- TabsView uses custom buttons, not Radix Tabs (role=button, not role=tab)
- useFleet/useFleetSearch return null on error → AG Grid stays in loading state
- isPubSubDisabled returns false in production regardless of DISABLE_AUTH
- All 3 microservices share the isAuthDisabledForTesting pattern
- NODE_ENV must be 'e2e' (not 'production') for auth bypass in docker compose
- OrderQuote and PurchaseOrdersList render unconditionally (not gated on status/type)
- AG Grid: rowData=null → loading state; rowData=[] → no-rows overlay

To import: `mm import hashbranch-e2e-model.json`

## Next Steps
1. Start building models for other repos as I work on them
2. Consider renaming from `mm` to something more distinctive
3. Enable engram source in Boss's openclaw-recall config
4. Explore FTS5 if LIKE-based search becomes a bottleneck
