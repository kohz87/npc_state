from pathlib import Path

# README package layout and storage semantics.
path = Path('README.md')
text = path.read_text()
text = text.replace("  core.js\n  branch.js\n  bundle.js\n  storage.js\n", "  core.js\n  branch.js\n  bundle.js\n  social.js\n  storage.js\n  identity.js\n", 1)
old = """The sidecar stores dossiers, candidates, portraits, inline snapshots, branch checkpoints, and lifecycle state. Writes are versioned and serialized so edits made while an upload is in flight receive a follow-up snapshot rather than being falsely marked saved.

Branch behavior:"""
new = """The sidecar stores dossiers, candidates, portraits, inline snapshots, branch checkpoints, and lifecycle state. Writes are versioned and serialized so edits made while an upload is in flight receive a follow-up snapshot rather than being falsely marked saved.

From v0.2.17 onward, durable chat identity includes both the SillyTavern owner and the chat filename. Character chats are scoped by character avatar identity and group chats by group id, so two different cards/groups may safely use the same chat filename. Older unqualified sidecars are claimed lazily only when their stored narrative lineage proves they belong to the active owner; ambiguous legacy data is preserved rather than guessed.

Long-session storage is bounded in two additional ways: dormant hydrated chats are evicted from the in-memory cache after active work settles, and branch checkpoint snapshots are adaptively compacted under a serialized-size budget while retaining safe rollback anchors and recent sibling state. Unreachable portrait assets are garbage-collected during sidecar compaction.

Branch behavior:"""
if old not in text:
    raise SystemExit('README storage anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

# CODE-REVIEW gets a real v0.2.17 section instead of only a relabeled heading.
path = Path('CODE-REVIEW.md')
text = path.read_text()
marker = '# NPC State v0.2.17 Code Review\n\n'
if marker not in text:
    raise SystemExit('CODE-REVIEW v0.2.17 heading missing')
section = '''## v0.2.17 identity and storage hardening\n\n**Critical: ordinary character chat keys were not owner-qualified.** Two different character cards could use the same SillyTavern chat filename and collide in cache, sidecar, tombstone, and branch-index ownership. Canonical keys now include character avatar identity plus chat id; group keys include group id plus active group-chat id. Rename/delete lifecycle resolution prefers event-provided ownership and fails closed when an owner-less lookup is ambiguous.\n\n**High: cross-chat branch ancestry was not owner-scoped.** Candidate ancestor loading and inheritance now require the same qualified owner scope before narrative-prefix matching is considered.\n\n**High: legacy namespace migration could guess ownership or lose old branch semantics.** Unqualified v0.2.16-and-earlier sidecars migrate lazily only after stored lineage proves the active conversation owns them. Both current content lineage and pre-v0.2.11 swipe-index lineage are recognized. The destination sidecar is written and verified before the old namespace is retired, and migrated branch state is canonicalized before its first durable write.\n\n**High: branch history and portraits could inflate long-session sidecars.** Checkpoint snapshots retain the existing count cap but now also obey a serialized-character budget, preserving a safe active anchor plus newest useful states. Portrait assets are rebuilt against live or branch-restorable NPC ids and permanent deletion tombstones so unreachable binary data cannot accumulate forever.\n\n**Medium: hydrated chats accumulated indefinitely in browser memory.** A bounded dormant-chat cache evicts settled non-active states while refusing to evict chats with pending load/write/scan work.\n\n**Medium: unchanged hydration looked dirty and destructive tombstones could lose a crash race.** Successful unchanged sidecar hydration initializes the persisted revision, avoiding needless page-hide rewrites. A persisted destructive tombstone now outranks any stale live pointer left behind by an interrupted delete/retire sequence.\n\n**Medium: explicit user mutations still waited for the ordinary scan debounce.** Manual edits, imports, deletion, archive/restore, clear, OOC changes, and portrait changes now start persistence immediately; versioned writers still coalesce any newer mutation safely.\n\n**Verification:** release gating runs the complete Node, SillyTavern compatibility, runtime smoke, migration smoke, syntax, and diff checks ten consecutive times from a clean application of the hardening patch, followed by dedicated identity/storage adversarial tests. No release commit is created until the entire gate succeeds.\n\n'''
if '## v0.2.17 identity and storage hardening' not in text:
    text = text.replace(marker, marker + section, 1)
path.write_text(text)

# TEST-REPORT accurately describes schema v26 and this release's coverage.
path = Path('TEST-REPORT.md')
text = path.read_text()
text = text.replace('- Schema-v24 settings/sidecar migration smoke passed', '- Schema-v26 owner-qualified settings/sidecar migration smoke passed', 1)
anchor = '- One-level extension package-layout check passed\n'
extra = '- Owner-qualified same-filename character/group isolation passed\n- Legacy current-lineage and pre-v0.2.11 ownership migration safety passed\n- Portrait garbage collection, branch snapshot size budgeting, tombstone authority, and dormant-cache eviction checks passed\n- Ten consecutive full release-gate passes are required before commit\n'
if anchor not in text:
    raise SystemExit('TEST-REPORT result bullet anchor missing')
if 'Owner-qualified same-filename character/group isolation passed' not in text:
    text = text.replace(anchor, anchor + extra, 1)
section_anchor = '## v0.2.12 Social Graph / identity-resolution coverage\n'
section = '''## v0.2.17 identity / persistence coverage\n\n- Character chat storage keys include character avatar ownership; group chat keys include group ownership. Equal chat filenames under different owners remain independent.\n- Branch ancestor discovery and inheritance never cross owner scopes.\n- Legacy unqualified sidecars are migrated only with narrative-lineage proof, including compatibility with pre-v0.2.11 fingerprints. Ambiguous state is preserved instead of assigned optimistically.\n- Successful unchanged hydration is marked clean; destructive tombstones override stale live pointers after interrupted cleanup.\n- Manual high-value changes begin persistence immediately while versioned in-flight writes still drain to the newest state.\n- Branch checkpoints are bounded by both count and serialized snapshot budget; portrait assets are garbage-collected against live/branch-restorable ids.\n- Dormant hydrated chats are evicted only after pending loads, writes, timers, and scans are settled.\n- Package and compatibility checks include the new `identity.js` module and SillyTavern character/group identity context.\n\n'''
if section_anchor not in text:
    raise SystemExit('TEST-REPORT coverage section anchor missing')
if '## v0.2.17 identity / persistence coverage' not in text:
    text = text.replace(section_anchor, section + section_anchor, 1)
path.write_text(text)

# Package and compatibility contracts include the new runtime module and host identity fields.
path = Path('tests/package.test.js')
text = path.read_text()
text = text.replace("'social.js', 'storage.js', 'style.css'", "'social.js', 'storage.js', 'identity.js', 'style.css'", 1)
path.write_text(text)

path = Path('tests/compatibility-check.js')
text = path.read_text()
text = text.replace("context: ['chat', 'chatId', 'getCurrentChatId'", "context: ['chat', 'chatId', 'getCurrentChatId', 'characterId', 'characters', 'groupId'", 1)
event_loop = 'for (const event of st118Contract.events) {'
if event_loop not in text:
    raise SystemExit('compatibility event-loop anchor missing')
context_loop = """for (const symbol of st118Contract.context) {
    assert.match(index, new RegExp(`\\\\b${symbol}\\\\b`), `missing context contract symbol ${symbol}`);
}
"""
if 'for (const symbol of st118Contract.context)' not in text:
    text = text.replace(event_loop, context_loop + event_loop, 1)
text = text.replace("'social.js', 'storage.js', 'style.css'", "'social.js', 'storage.js', 'identity.js', 'style.css'", 1)
path.write_text(text)

path = Path('tests/migration-smoke.mjs')
text = path.read_text().replace('Migration smoke: schema24 ', 'Migration smoke: schema26 ', 1)
path.write_text(text)

Path(__file__).unlink()
print('v0.2.17 release docs and package compatibility contracts updated')
