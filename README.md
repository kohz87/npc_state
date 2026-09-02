# NPC State v0.3.0

NPC State v0.3 is a clean runtime rewrite of the SillyTavern narrated-NPC dossier tracker. The v0.2 source remains in the repository for recovery and reference, but the extension bootstrap no longer loads the v0.2 engine, hardening wrapper, or enhancement layer.

## What changed

v0.3 replaces the layered scan/backfill system with one explicit current-cast transaction. The scanner now keeps three concepts separate:

- **Exchange active**: the NPC spoke, acted, was directly acted upon, or directly perceived/received a relevant event in the current user + assistant exchange.
- **Present**: the NPC is physically present at the end of the latest assistant scene.
- **World active**: the NPC is explicitly active off-screen.

The full reconciliation target is exactly:

```text
exchange active NPCs + final physically present NPCs
```

Off-screen world-active NPCs may receive grounded live-state updates such as location, status, or an explicit death/return, but they do not enter full profile/relationship reconciliation merely for being active elsewhere.

## Core v0.3 guarantees

- One batch model call for the normal current-cast scan, rather than an automatic per-NPC backfill forest.
- Relationship deltas use current-exchange evidence only. Older context can recover stable profile facts and durable memories, but cannot replay relationship changes.
- Strict final-scene physical presence controls inline cards and generation injection.
- Dossier Library searches every stored NPC, including off-screen and archived dossiers.
- One canonical dossier detail surface is used by the library, roster, and inline present cards.
- Background/model operations never save editor DOM state. Editor saves are identity-bound and use an optimistic `updatedAt` guard so a stale form cannot overwrite newer scan data.
- Manual deletion creates a stable-ID tombstone. Branch rollback cannot resurrect that deleted identity.
- Scanner output cannot recreate a tombstoned stable ID or retarget an existing same-name dossier with an invented ID.
- Per-chat model operations are serialized. A new user message invalidates an in-flight scan, and a late result is discarded before state commit.
- Automatic scanning honors the global Enable setting. Manual dossier tools remain available while disabled.
- v0.3 sidecars use revision checks, a cross-tab writer lock, and a local pointer hint so a stale tab cannot overwrite the first v0.3 write.

## v0.2 data migration

When a chat has no v0.3 sidecar but does have a v0.2 sidecar pointer, v0.3 reads the old file once and writes an independent v0.3 sidecar.

Imported durable data includes current NPC dossiers, portraits, relationship values/history that fit the new schema, memories, archive/life state, deletion tombstones, and representable social edges.

Intentionally **not** imported:

- pending backfill/runtime queues
- v0.2 scan locks or transient operation state
- v0.2 branch checkpoints

The original v0.2 sidecar is never rewritten by v0.3.

### Branch boundary after migration

The first v0.3 load establishes a v0.3 branch baseline. Branch edits after that point can restore from v0.3 checkpoints.

If a chat is changed to a branch that diverges **before** that first v0.3 baseline, v0.3 cannot truthfully reconstruct the missing v0.2 branch history because those old checkpoints are intentionally not imported. It therefore fails closed: strict live presence is cleared and model scanning/injection are paused instead of trusting potentially stale timeline data. Returning to the original baseline branch restores normal v0.3 tracking.

## Current rewrite scope

The v0.3.0 rewrite candidate focuses on the durable core: persistence, migration, current-cast scanning, relationship/memory reconciliation, strict presence, branch checkpoints, prompt injection, searchable dossier library, manual editing, archive/restore/delete, and inline present cards.

The old v0.2 files remain in the repository but are runtime-dead. Feature areas that are intentionally staged for later v0.3 work rather than copied wholesale include the legacy portrait-generation workflow, bundle import/export UI, stale auto-prune workflow, OOC command layer, and the older Megumin-specific tab integration. This avoids rebuilding the same architectural knot under a new version number.

## Development

Run the v0.3 behavioral suite:

```bash
npm test
```

The release gate runs only `tests/v03-*.test.js`. Historical v0.2 tests remain useful as reference material but do not define the v0.3 architecture.

## Runtime files

```text
bootstrap.js
v03/
  index.js          SillyTavern lifecycle adapter
  engine.js         serialized operations + atomic commits
  scanner.js        scanner contract + result application
  schema.js         v0.3 whitelist state schema
  branches.js       v0.3 branch baseline/checkpoints
  storage.js        independent revisioned sidecar
  migrate-v02.js    one-way v0.2 reader/importer
  injection.js      strict-present generation injection
  ui.js             settings, library, canonical dossier/editor
  identity.js       owner-qualified chat identity
  style.css         v0.3 UI styles
```
