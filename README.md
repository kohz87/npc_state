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
- Bundle export uses an explicit portable v0.3 format instead of copying the raw sidecar. Full-chat backup preserves normalized dossiers, memories, relationships/history, social graph, portraits, suppression names, tombstones, archive/retention/stale fields, and stable IDs.
- Selected-NPC export contains one normalized dossier plus social edges touching that stable ID. Edges whose counterpart does not exist in the destination are dropped safely during import.
- Bundles never carry branch checkpoints/baselines/lineage, latest observation state, sidecar revision bookkeeping, migration state, or in-process operation locks.
- Bundle imports are parsed, schema-checked, identity-validated, and normalized before commit. Unknown dossier fields are dropped by the v0.3 whitelist schema rather than written through raw.
- Safe merge defaults to keeping current data for matching stable IDs and aborting on hard stable-ID/name or tombstone conflicts. The UI can instead use imported data for matching IDs or skip conflicting imported identities.
- Full-chat **Replace durable state** is a separate explicit restore mode. It replaces portable dossier/social/tombstone domains but keeps the destination chat's branch/runtime machinery local and clears imported live presence.
- Cross-chat bundle imports clear source-chat message IDs, preserve relative stale age by rebasing `lastActivityTurn`, and never import source live presence.
- Portrait prompt support is settings-only and local. It stores a named library of reusable positive/negative preset pairs, one default preset selection, shared positive/negative prompt templates, and Natural/Tags/Hybrid formatting for the dossier-derived `{{character}}` placeholder.
- Existing single portrait-preset settings become the first named `Default` preset automatically. Saving the portrait settings materializes the named preset library without losing the prior positive or negative text.
- The canonical dossier **More** menu exposes **Generate image prompt**, which opens a per-NPC positive/negative prompt composer. Any saved preset can be chosen there without changing the configured default preset.
- Portrait prompt preview/copy does not call an image API, generate images, create queues, or add portrait lifecycle state.
- The canonical Dossier Library is portrait-first: the selected NPC receives the dominant portrait hero while the full cast remains accessible through a searchable horizontal portrait rail at the bottom of the viewer.
- The Dossier Library has no permanent cast sidebar. Present, world-active, ordinary off-screen, and archived dossiers remain in the same library and are visually distinguished in the cast rail.
- Desktop and landscape tablet keep the portrait pane visible while the dossier document scrolls independently. Portrait tablet and phone layouts stack the portrait hero over a single readable document column while retaining the bottom cast rail.
- Current state, player relationship, personality, appearance, behavior, speech, mannerisms, memories, key relationships, background, and relationship history are rendered as distinct visual blocks rather than one continuous text document.
- One canonical dossier detail surface is used by the library, settings roster, stale review, and inline present cards.
- Background/model operations never save editor DOM state. Editor saves are identity-bound and use an optimistic `updatedAt` guard so a stale form cannot overwrite newer scan data.
- Manual deletion creates a stable-ID tombstone. Branch rollback cannot resurrect that deleted identity.
- Scanner output cannot recreate a tombstoned stable ID or retarget an existing same-name dossier with an invented ID.
- Per-chat model operations are serialized. A new user message invalidates an in-flight scan, and a late result is discarded before state commit.
- Automatic scanning honors the global Enable setting. Manual dossier tools remain available while disabled.
- v0.3 sidecars use revision checks, a cross-tab writer lock, and a local pointer hint so a stale tab cannot overwrite the first v0.3 write.

## Dossier Library UI

The canonical Dossier Library is built around the selected character rather than a permanent navigation column.

On desktop, the viewer uses a portrait-heavy split layout:

```text
┌─────────────────────────────┬──────────────────────────────────────┐
│                             │ CURRENT                              │
│                             │                                      │
│                             │ RELATIONSHIP WITH PLAYER             │
│        LARGE PORTRAIT       │                                      │
│                             │ PROFILE BLOCKS                       │
│                             │ Personality     Appearance           │
│                             │ Behavior        Speech               │
│                             │ Memories        Relationships        │
│ Name / identity / state     │ Background      History              │
│ Edit / Refresh / More       │                                      │
├─────────────────────────────┴──────────────────────────────────────┤
│ DOSSIER LIBRARY  [Search]                                           │
│ ◀ [portrait] [portrait] [SELECTED] [portrait] [portrait] [portrait] ▶│
└─────────────────────────────────────────────────────────────────────┘
```

The bottom cast rail:

- contains every stored dossier, including off-screen and archived NPCs;
- prioritizes present NPCs, then world-active NPCs, then ordinary active dossiers, with archived dossiers after them;
- supports name, alias, role, species, and lifecycle-state search;
- supports touch swiping, native horizontal scrolling, and previous/next controls;
- automatically centers the selected stable ID when switching dossiers;
- uses portrait cards with lifecycle status instead of a permanent text sidebar.

An explicit open from Present NPCs, stale review, or another NPC State surface clears a stale library search so the requested dossier cannot be hidden by an old filter. Background refreshes of the same selected NPC preserve the dossier document's scroll position.

Tablet and mobile use the same canonical markup. Landscape tablets retain the split portrait/document view. Portrait tablets and phones turn the dossier into one vertical reading surface with a large portrait hero at the top, while the cast rail remains available at the bottom of the modal.

## Bundle import / export

The **Bundle import / export** section in NPC State settings supports:

- **Export full chat** for a portable durable backup.
- **Export selected NPC** for one dossier plus directly touching social edges.
- **Safe merge** into the current chat.
- **Replace durable state** from a full-chat bundle.
- Matching-ID policy: keep the current dossier or use the imported dossier.
- Hard-conflict policy: abort the entire import or skip conflicting imported identities.

Imports are previewed before confirmation. A rejected preview or conflict performs no sidecar write. Successful import is committed through the normal serialized engine as one sidecar revision and receives a v0.3 branch checkpoint in the destination chat.

Safe merge treats local manual-deletion tombstones as authoritative and will not silently resurrect those IDs. Likewise an imported tombstone cannot silently delete a live local dossier; that is surfaced as an identity conflict. Full-chat Replace is the deliberate escape hatch when the user genuinely intends to restore the bundle's durable state wholesale.

## Portrait prompt

The **Portrait prompt** section in NPC State settings manages the reusable prompt library. It stores:

- **Character formatting**: `Natural`, `Tags`, or `Hybrid`.
- Up to 32 named **portrait presets**, each with a reusable **positive** channel and **negative** channel.
- One **default preset** used by the prompt APIs and initially selected in the dossier prompt dialog.
- One shared **positive prompt template**.
- One shared **negative prompt template**.

Conceptually the saved settings are:

```text
portraitPresets[]
├─ id
├─ name
├─ positive
└─ negative

portraitActivePresetId
portraitPositivePrompt
portraitNegativePrompt
```

The preset library provides **New**, **Duplicate**, **Delete**, rename, and default-selection controls. Positive/negative templates are deliberately shared across presets: presets supply reusable style/exclusion text, while the templates define the common recipe that combines those presets with dossier facts.

The default templates are:

```text
POSITIVE
{{positivePreset}}
{{character}}

NEGATIVE
{{negativePreset}}
```

`{{character}}` is built from the selected dossier according to the formatting mode. The rest of either template remains under user control. Available placeholders include:

```text
{{positivePreset}} {{negativePreset}} {{character}} {{name}} {{aliases}}
{{role}} {{species}} {{age}} {{apparentAge}} {{appearance}} {{personality}}
{{behaviorProfile}} {{speech}} {{mannerisms}} {{background}} {{mood}}
{{location}} {{goal}} {{status}}
```

The legacy `{{portraitPreset}}` placeholder remains accepted as an alias for the positive preset so prompts saved during the first lightweight portrait-prompt pass continue to resolve safely.

Unknown placeholders remain visible instead of silently disappearing, making template typos easy to spot. Missing dossier fields resolve empty; NPC State does not invent portrait facts. An intentionally blank preset or template remains blank rather than being repopulated with a default.

Existing users with only the original single positive/negative pair are migrated non-destructively: that pair is exposed as the first named **Default** preset. No manual conversion is required.

Edits are kept as a local draft until **Save portrait prompt settings** is pressed. The settings panel provides a dossier selector, live positive and negative previews, and controls to copy the positive prompt, negative prompt, or both.

The canonical dossier also exposes **More -> Generate image prompt**. That opens a focused prompt dialog for the selected NPC. The dialog can switch among any saved presets locally, shows the resolved positive and negative channels, and can copy either channel or both. Choosing a preset in this dialog does not change the saved default preset.

There is deliberately no automatic portrait generation, provider/API integration, regeneration workflow, request queue, image polling, or portrait-generation state machine in v0.3.

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
  ui.js              canonical UI orchestration and dossier actions
  dossier-view.js     portrait-first dossier, cast rail, search/sort rendering
  megumin.js          UI-only Megumin master-block tab adapter
  stale.js            narrative-turn stale lifecycle and reporting
  stale-ui.js         settings and manual stale-review surface
  bundle.js           portable v0.3 bundle validation/export/import logic
  bundle-ui.js        full-chat/selected-NPC bundle management surface
  portrait-prompt.js  positive/negative prompt composition + named preset library
  portrait-ui.js      preset manager, preview/copy, and dossier prompt dialog
  portrait-workflow.css portrait settings/dialog layout loaded by portrait-ui.js
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

The v0.3.0 rewrite now covers the durable core and planned management surfaces: persistence, migration, current-cast scanning, relationship/memory reconciliation, strict presence, branch checkpoints, prompt injection, the portrait-first responsive canonical dossier library and bottom cast rail, manual editing, archive/restore/delete, inline present cards, a UI-only Megumin master-block/tab mount, narrative-turn stale NPC lifecycle management with manual review controls, validated portable bundle import/export for full-chat and selected-NPC workflows, and lightweight named positive/negative portrait-preset composition with local preview/copy and a per-dossier prompt dialog.

Automatic portrait generation and image-provider integration remain intentionally outside the v0.3 scope.

## Development

Run the supported behavioral suite:

```bash
npm test
```

The release gate runs only `tests/v03-*.test.js`. Historical v0.2 source, tests, reports, and documentation live only under `legacy/v0.2.x/` and do not define the v0.3 architecture.
