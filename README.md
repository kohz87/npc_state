# NPC State v0.2.22

NPC State is a standalone SillyTavern extension for persistent, branch-aware NPC dossiers in long-form roleplay. It tracks durable characterization, live state, player relationships, social ties, memories, portraits, presence, and branch-specific continuity without depending on Megumin Suite's NPC Bank.

## Install

Install the repository as one `npc_state/` extension folder under either:

```text
data/<user-handle>/extensions/npc_state/
```

or a global/development extension directory supported by your SillyTavern installation. Restart SillyTavern after updating.

The runtime entrypoint is `bootstrap.js`. It installs v0.2.19 lifecycle/durability guards first, then loads the retained v0.2.18 engine through `index.js`. The retained engine implementations live in `core-v0218.js` and `branch-v0218.js`; the public `core.js` and `branch.js` modules layer the v0.2.19 compatibility hardening on top.

## What NPC State tracks

- canonical NPC names and aliases
- Species/Race, chronological Age, Apparent Age, Appearance, Personality, Behavioral Profile, Speech, Background, and Mannerisms
- Mood, Goal, Status, Location, presence, and off-screen activity
- player relationship summary plus Trust, Affection, Desire, and Tension
- important memories and non-player Key Relationships
- hidden ID-backed social graph state
- portraits and per-NPC portrait prompt overrides
- archive, stale-retention, Minor NPC, importance, and manual-profile protection
- exact swipe/branch snapshots and branch-specific dossier state

## v0.2.19 lifecycle and durability hardening

v0.2.19 keeps the dossier/scanner model intact and hardens host identity, persistence, and branch ownership around it.

- Character rename migrates every owner-qualified chat sidecar from the old avatar namespace to the new avatar namespace transactionally, with verified destination writes, recovery copies, predecessor retirement, and rename-back tombstone supersession.
- Historical character-name rewrites use rename-stable v3 lineage fingerprints. Inactive group-chat histories are identified by SillyTavern chat integrity metadata and rebased before the host saves the rewritten chat.
- Numeric `characterId` is never accepted as durable ownership. NPC State stays on `chat-pending:*` until the character avatar is available.
- Sidecar writes use revision tokens plus same-origin writer locking. Stale writers and stale retirement attempts fail closed instead of overwriting newer state.
- Transient write failures retry at `1s -> 2s -> 5s -> 15s -> 30s`, then remain actively dirty and retry at a 30-second ceiling until durable or explicitly cancelled. The existing active-write cache guard therefore prevents dirty LRU eviction.
- Character deletion retires the entire owner namespace into tombstoned recovery state. Group/chat deletion resolves ownership from host data first and fails closed when ambiguous.
- Legacy unqualified ownership migration now requires at least six matching messages and two user turns.
- Fresh v0.2.19 owner-qualified chats cross-inherit only from SillyTavern's explicit `chat_metadata.main_chat` provenance. Text similarity remains only as a conservative migration fallback for older/legacy state.
- Branch checkpoint pressure is enforced in UTF-8 bytes with a hard per-snapshot ceiling and live portrait-asset garbage collection.
- Ancestor sidecar reads are concurrency-limited to four.

## Normal workflow

1. Enable **Auto scan**.
2. Roleplay normally.
3. NPC State scans the latest exchange and updates grounded dossier state.
4. Present non-minor NPCs appear as portrait cards.
5. Open a portrait to inspect or edit its dossier.

Use **Full scan every turn** only when the extra history window is worth the additional model cost. Manual **Scan dossier now** and per-NPC **Refresh from Chat** remain available for backfill/reconciliation.

## Compatibility

- Minimum SillyTavern client version: `1.18.0`
- Standalone NPC State storage and scanner behavior remain independent of Megumin NPC Bank internals.
- Optional Megumin-rendered dossier blocks can still be consumed through the existing DOM integration.

## Historical documentation

The full v0.2.18 feature/reference README is retained at [`docs/README-v0.2.18.md`](docs/README-v0.2.18.md). The v0.2.19 release is deliberately focused on lifecycle, branch, and persistence correctness rather than dossier-schema changes.
