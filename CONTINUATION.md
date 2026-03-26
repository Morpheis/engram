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

## Active Models
- `chitin` (code) — 19 nodes, 27 edges. Personality persistence layer.
- `oathkeeper` (code) — 20 nodes, 22 edges. Accountability escrow smart contract + SDK.
- `hashbranch` (org) — 4 people. Current org chart.
- `hashbranch-e2e` (code) — E2E test debugging relationships.
- `zink-family` (org) — Family relationships.

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
