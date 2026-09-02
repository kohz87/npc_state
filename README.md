# NPC State v0.3.0

NPC State v0.3 is the current SillyTavern narrated-NPC dossier tracker. The repository root is now v0.3-only. The complete v0.2.x line is frozen under [`legacy/v0.2.x/`](legacy/v0.2.x/) for reference and recovery, and no legacy runtime file is loaded by the root extension manifest or bootstrap.

## Install / update in SillyTavern

Use the repository URL in SillyTavern's **Extensions -> Install Extension** flow:

```text
https://github.com/kohz87/npc_state
```

SillyTavern installs the repository's default branch. `main` is the supported v0.3 line, so a normal install or Extension Manager update uses the root `manifest.json` (`0.3.0`) and `bootstrap.js`, which load only `v03/index.js` and `v03/style.css`.

## What changed

v0.3 replaces the layered scan/backfill system with one explicit current-cast transaction. The scanner keeps three concepts separate:

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
- When the latest assistant message contains a Megumin master block, the same present-NPC roster mounts as an **NPC State** tab inside that block. If Megumin is absent or its tab hosts are unavailable, NPC State keeps its normal standalone inline roster.
- The Megumin bridge is UI-only. NPC State does not depend on Megumin-owned state, persistence, scanning, or dossier logic; generated World State text remains ordinary chat context for the normal v0.3 scanner.
- Stale NPC lifecycle is based on **narrative assistant turns**, not scan count. Re-running a scan on the same assistant message cannot age a dossier.
- Default stale thresholds are 30 inactive narrative turns to archive and 50 total inactive narrative turns to remove a stale archive. These values are configurable in NPC State settings.
- Being off-screen is not itself a stale event. Current interaction, final physical presence, explicit off-screen world activity, or a canonical-name/alias reference in the current exchange resets the inactivity timer.
- A stale-archived NPC that becomes narratively active again is restored automatically. Manual archives and deceased archives are never auto-deleted by stale management.
- `Retention protected` dossiers and dossiers with manual stable-profile locks are hard-shielded from automatic stale archive/delete.
- Automatic stale cleanup is intentionally softer than explicit manual Delete: it removes the dossier and its structured social edges but does not create a permanent deletion tombstone, allowing genuine later re-admission or branch recovery.
- A dedicated **Review stale NPCs** surface keeps manual Open dossier, Reset activity, Protect, Archive/Restore, and explicit Delete controls available.
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

## Repository layout

```text
manifest.json        supported extension manifest (v0.3.x)
bootstrap.js         loads only the v0.3 runtime
v03/                 supported runtime
  index.js
  engine.js
  scanner.js
  schema.js
  branches.js
  storage.js
  migrate-v02.js
  injection.js
  ui.js
  megumin.js          UI-only Megumin master-block tab adapter
  stale.js            narrative-turn stale lifecycle and reporting
  stale-ui.js         settings and manual stale-review surface
  identity.js
  style.css
tests/               v0.3 behavioral release gate
docs/                v0.3 architecture documentation
legacy/
  README.md
  v0.2.x/            exact frozen v0.2.23 repository snapshot
```

Nothing under `legacy/` is imported by the supported extension runtime.

## Current rewrite scope

The v0.3.0 rewrite focuses on the durable core: persistence, migration, current-cast scanning, relationship/memory reconciliation, strict presence, branch checkpoints, prompt injection, searchable dossier library, manual editing, archive/restore/delete, inline present cards, a UI-only Megumin master-block/tab mount, and narrative-turn stale NPC lifecycle management with manual review controls.

Feature areas intentionally staged for later v0.3 work rather than copied wholesale are bundle import/export and portrait prompt/preset support. Existing portrait data still migrates and displays.

## Development

Run the supported behavioral suite:

```bash
npm test
```

The release gate runs only `tests/v03-*.test.js`. Historical v0.2 source, tests, reports, and documentation live only under `legacy/v0.2.x/` and do not define the v0.3 architecture.
