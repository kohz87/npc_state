# Changelog

## v0.2.23 — Cast reconciliation and portrait-settings persistence

- When automatic scanning creates or promotes an NPC, every active dossier is considered for a deep recent-history reconciliation sweep; evidence-free dossiers become cheap no-ops while relevant dossiers receive the existing targeted five-memory/profile backfill.
- Current-exchange relationship targeting no longer depends on the broad scanner returning that NPC. An existing NPC who acts early in a response is still evaluated even when the response later moves to another location/cast.
- Existing relationship targets are processed in bounded batches of four until every relevant target is covered instead of truncating at four total.
- Existing NPCs explicitly mentioned in the current exchange but omitted by the broad scanner receive a silent targeted continuity repair so memories and durable dossier changes are not lost.
- One failed queued backfill no longer starves the rest of a cast sweep; each queued dossier gets one bounded attempt per processing cycle.
- Portrait generation settings now use an explicit Save Portrait Settings transaction. Draft edits and Reset remain unsaved until Save succeeds, and Save uses SillyTavern's immediate host settings persistence rather than a debounce-only write.
- Added regression coverage for scene-transition relationship targeting, cast-wide new-NPC reconciliation, important-memory recovery, and portrait-settings host persistence.

## 0.2.22

- Automatically queues the existing targeted history backfill whenever automatic scanning creates or promotes a dossier, so first-pass memories/profile data no longer depend on a manual Refresh.
- Lets the isolated same-ID backfill/Refresh workflow seed blank Appearance, Personality, and Speech summaries from its target-only history while preserving broad-scan grounding and every manual profile lock.
- Scrubs numeric relationship fields from every rolling full-window result, including brand-new NPCs, then evaluates newly admitted NPCs from the current exchange only.
- Restores low-band mundane relationship progression: fresh directional interactions can move one axis by +/-1 below 25, while the existing 25 milestone still requires meaningful evidence.
- Removes magic-word requirements for Trust/Affection/Tension evidence while keeping Desire's strict attraction/intimacy firewall.
- Preserves valid relationship axes when a different proposed axis fails validation instead of zeroing the entire event.
- Advances settings schema to 28 and migrates only untouched v0.2.21 stock relationship rubrics; user customizations remain authoritative.
- Adds executable runtime coverage for automatic new-NPC enrichment, five retained memories, current-only relationship scoring, low-band progression, and mixed-axis validation.

## 0.2.21

- Makes explicit SillyTavern chat owners authoritative during rename/delete resolution; an untracked same-named chat can no longer move or retire another owner's dossier.
- Requires host ownership proof even when NPC State sees only one same-filename candidate, and uses the cheap `simple: true` chat listing.
- Bounds lifecycle event waits so storage outages cannot stall SillyTavern's sequential event emitter; failed transactions remain fail-closed and retry in the background.
- Makes recovery filenames cross-tab unique, repairs hydrated pointer timestamps numerically, and bounds lifecycle-only sidecar writes.
- Isolates character-wide rename/delete failures per chat so one corrupt sidecar cannot abort cleanup for every other chat.
- Treats branch roots, social graph state, inline cards and portraits as meaningful rename destinations instead of ephemeral empty state.
- Bounds historical rename indexing, refuses to cache partial HTTP failures, tracks failed temporary recovery cleanup, and advances settings schema to 27.
- Adds executable v0.2.21 lifecycle ownership/storage regression tests.

## v0.2.20

- Reunifies chat rename/delete lifecycle with the retained engine cache instead of suppressing cache-aware handlers from an external wrapper.
- Makes destructive lifecycle transactions revision-checked before tombstone/ownership publication and retries from the newest durable sidecar on a concurrent-writer race.
- Advances branch lineage to v4 using rename-stable message-instance identity (send date / generation id) so identical text from different group speakers or swipes cannot share a sibling checkpoint.
- Migrates v3 lineage safely, preserves explicit early/root branches via SillyTavern main_chat provenance, and rebases historical solo as well as group chats after character renames.
- Repairs stale sidecar revision pointers during hydration, preventing crash windows from permanently wedging later saves.
- Fails closed on filename-only delete events instead of borrowing the active character as ownership proof; CHARACTER_DELETED performs exact owner-wide cleanup.
- Caches historical rename integrity discovery, bounds recovery-history metadata, and physically garbage-collects evicted recovery files.
- Repairs the v0.2.19 release gate and smoke fixtures so wrapper dependencies and branch-lineage v4 are actually exercised.
- Resolves same-filename single-chat deletion from authoritative host ownership without reintroducing active-owner guessing, physically cleans owner-wide retired predecessors after durable metadata commits, and guarantees monotonic recovery filenames.

# Changelog

## v0.2.19 - lifecycle and durability hardening

- Added transactional `CHARACTER_RENAMED` owner-wide migration with verified destination sidecars, recovery staging, predecessor retirement, cache/branch ownership retargeting, and safe `A -> B -> A` rename-back behavior.
- Added `CHARACTER_RENAMED_IN_PAST_CHAT` rebase support and rename-stable v3 branch fingerprints; inactive group chats are resolved through host chat integrity metadata.
- Removed numeric `characterId` as a durable owner fallback.
- Added revision-aware sidecar writes, browser writer locking, stale-writer conflict detection, stale-retirement conflict detection, bounded retry backoff, and active dirty-write retention.
- Added `CHARACTER_DELETED` owner-wide recovery/tombstone retirement and safer chat/group deletion ownership resolution.
- Strengthened legacy ownership claims to require the complete stored lineage, with at least six matching messages and two user turns.
- Added explicit `main_chat` branch provenance; fresh v0.2.19 canonical chats no longer cross-inherit from prose similarity alone.
- Added hard UTF-8 checkpoint byte limits, per-snapshot ceilings, live portrait GC, and four-way ancestor read concurrency limiting.
- Added v0.2.19 lifecycle/durability regression coverage and expanded CI syntax/package checks.

Previous release history is retained at [`docs/CHANGELOG-v0.2.18.md`](docs/CHANGELOG-v0.2.18.md).
