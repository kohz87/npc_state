# Changelog

## v0.3.0

- Rebuilt NPC State around a clean v0.3 runtime instead of extending the v0.2 compatibility stack.
- Replaced automatic cast-wide backfill queues and detached per-NPC refresh chains with one current-cast scan transaction.
- Separated current-exchange participation, strict final-scene physical presence, and off-screen world activity.
- Defined full reconciliation targets as exactly `exchangeActive + finalPresent`.
- Restricted relationship-score changes to current-exchange evidence while allowing older context for profile and memory recovery.
- Added serialized per-chat operations, stale-result invalidation, atomic state commits, branch-safe v0.3 checkpoints, and stable-ID deletion tombstones.
- Added independent revisioned v0.3 sidecars with cross-tab write protection and fail-closed missing-file handling.
- Added a one-way v0.2 importer that preserves durable dossier data while leaving the original v0.2 sidecar untouched.
- Added one searchable canonical Dossier Library for present, off-screen, and archived NPCs.
- Bound editor saves to an exact NPC ID and optimistic dossier version so cross-NPC and stale same-NPC overwrites are rejected.
- Added a UI-only Megumin master-block adapter that mounts the existing present-NPC roster as an `NPC State` tab when Megumin's tab/panel hosts are present, with standalone inline fallback when they are not.
- Kept Megumin outside the state architecture: the adapter owns no scanning, persistence, dossier import, or World State parsing.
- Added focused v0.3 behavioral tests as the supported release gate.
- Moved the complete v0.2.23 repository snapshot, including its source, tests, reports, changelog, and documentation, under `legacy/v0.2.x/`.
- Made the repository root and default `main` branch the supported v0.3 install surface for SillyTavern.

Historical v0.2 release notes are preserved inside [`legacy/v0.2.x/CHANGELOG.md`](legacy/v0.2.x/CHANGELOG.md).
