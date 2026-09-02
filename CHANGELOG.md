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
- Added one searchable canonical Dossier Library for present, world-active, off-screen, and archived NPCs.
- Redesigned the canonical Dossier Library around a dominant portrait hero instead of a permanent cast sidebar.
- Added a searchable horizontal portrait cast rail fixed at the bottom of the dossier viewer, with selected-card centering, previous/next controls, touch scrolling, and lifecycle status on each card.
- Reorganized dossier content into distinct Current, Relationship, Personality, Appearance, Behavioral profile, Speech, Mannerisms, Key relationships, Important memories, Background, and relationship-history blocks.
- Restored the portrait-heavy split-view grammar on desktop and landscape tablet so the portrait remains visible while the dossier document scrolls independently.
- Added responsive portrait-tablet and phone layouts that stack the portrait hero over one readable document column while retaining the bottom cast rail.
- Preserved the selected dossier's reading position across background refreshes, and explicit opens from other NPC State surfaces clear stale cast-search filters so the requested stable ID remains visible.
- Bound editor saves to an exact NPC ID and optimistic dossier version so cross-NPC and stale same-NPC overwrites are rejected.
- Added a UI-only Megumin master-block adapter that mounts the existing present-NPC roster as an `NPC State` tab when Megumin's tab/panel hosts are present, with standalone inline fallback when they are not.
- Kept Megumin outside the state architecture: the adapter owns no scanning, persistence, dossier import, or World State parsing.
- Added narrative-turn stale NPC management with configurable 30-turn archive and 50-turn total-inactivity cleanup defaults. Re-scanning the same assistant message does not advance stale age.
- Stale retention activity is refreshed by current interaction, final physical presence, explicit off-screen world activity, and canonical-name/alias references in the current exchange.
- Added automatic restoration for stale-archived NPCs that become narratively active again while leaving manual/deceased archives outside the stale cleanup path.
- Added hard stale-pruning protection for retention-protected dossiers and manually locked stable profiles.
- Kept automatic stale cleanup softer than manual Delete: stale cleanup does not create a permanent tombstone, while explicit user deletion still does.
- Added a manual stale-review surface with Open dossier, Reset activity, Protect, Archive/Restore, and Delete controls.
- Added portable v0.3 bundle export for full-chat backups and selected-NPC dossiers, preserving normalized dossiers, memories, relationships/history, social graph, portraits, suppression names, tombstones, archive/retention/stale data, and stable IDs.
- Kept branch checkpoints/baselines/lineage, latest observation state, sidecar revisions, migration/runtime state, and engine operation locks out of the bundle format.
- Added schema/version validation and whitelist normalization for every imported bundle before it reaches persistence.
- Added explicit stable-ID conflict handling: safe merge can keep or replace matching IDs, abort or skip hard ID/name conflicts, and never silently resurrect local manual tombstones or apply imported tombstones over live local dossiers.
- Added full-chat Replace durable state as a separate restore mode that replaces portable durable domains while retaining destination branch/runtime machinery and clearing imported live presence.
- Cross-chat imports now clear chat-local message references, rebase stale inactivity age, and safely drop social edges whose counterpart stable ID does not exist in the destination.
- Bundle preview/export are read-only; a successful bundle import is serialized into one sidecar commit and destination branch checkpoint, while rejected conflicts commit nothing.
- Added lightweight portrait prompt support with named reusable presets containing paired positive and negative channels, separate shared positive/negative prompt templates, and Natural/Tags/Hybrid formatting for the auto-built dossier character block.
- Existing single positive/negative portrait preset settings migrate into the first named `Default` preset without losing user text.
- Added New, Duplicate, Delete, rename, and default-selection controls for a multi-preset portrait library while keeping prompt templates shared across presets.
- Added **Generate image prompt** to the canonical dossier `More` menu. It opens a focused per-NPC positive/negative prompt dialog where any saved preset can be selected and copied without changing the default preset.
- Realigned portrait settings into explicit control rows and cards so titles, explanatory text, selects, inputs, and positive/negative textareas remain visually aligned on desktop and mobile.
- Added local placeholder resolution and live selected-NPC positive/negative preview with Copy Positive, Copy Negative, and Copy Both controls without adding any image API, automatic portrait generation, regeneration queue, or portrait workflow state.
- Preserved first-pass single portrait-preset/generation-prompt settings by migrating them into the positive channel, while intentionally blank presets/templates remain blank.
- Added focused v0.3 behavioral tests as the supported release gate.
- Moved the complete v0.2.23 repository snapshot, including its source, tests, reports, changelog, and documentation, under `legacy/v0.2.x/`.
- Made the repository root and default `main` branch the supported v0.3 install surface for SillyTavern.

Historical v0.2 release notes are preserved inside [`legacy/v0.2.x/CHANGELOG.md`](legacy/v0.2.x/CHANGELOG.md).
