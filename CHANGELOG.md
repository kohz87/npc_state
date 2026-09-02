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
