# Mental Model — Continuation Notes

## Status (2026-03-25)

### Phase 1: COMPLETE ✅
- 58 tests passing, all commands working
- CLI: `npx tsx src/index.ts <command>` (or `mm` when globally linked)
- DB: `~/.config/mental-model/models.db` (override with `MM_DB_PATH`)

### Phase 2: TODO
- Path finding (A → B) — `findPaths` is implemented in storage but not exposed in CLI yet
- Git commit anchoring + `mm check` / `mm refresh` / `mm diff`
- Stale query improvements for code models (tie to git diff)
- `--from` / `--to` path query in CLI

### Phase 3: TODO
- OpenClaw skill (SKILL.md)
- Heartbeat freshness checks
- DOT export for Graphviz
- QMD integration

### Phase 4: TODO
- Graph DB migration (Kuzu)

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
1. Build Phase 2 (git anchoring is the highest-value feature)
2. Create an OpenClaw skill so I can use `mm` commands easily
3. Start building models for other repos as I work on them
4. Consider renaming from `mm` to something more distinctive
