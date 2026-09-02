import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BRANCH_SNAPSHOT_BUDGET_CHARS, chatLineage, pruneBranchCheckpoints } from '../branch.js';
import { prunePortraitAssetsForState } from '../storage.js';
import { buildQualifiedChatKey } from '../identity.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function msg(text, isUser = false) { return { mes: text, is_user: isUser, is_system: false, name: isUser ? 'User' : 'Character' }; }

test('branch snapshots obey a bounded character budget while retaining useful anchors', () => {
    const chat = Array.from({ length: 30 }, (_, i) => msg(`turn-${i}`, i % 2 === 1));
    const lineage = chatLineage(chat);
    const checkpoints = lineage.map((fingerprint, i) => ({
        messageId: i, fingerprint, lineageKey: '', parentLineageKey: '', createdAt: i + 1,
        snapshot: { npcs: [{ id: `npc-${i}`, personality: 'x'.repeat(180000) }] },
    }));
    const pruned = pruneBranchCheckpoints(checkpoints, lineage, 160);
    const size = pruned.reduce((sum, item) => sum + JSON.stringify(item.snapshot || {}).length + 256, 0);
    assert.ok(size <= BRANCH_SNAPSHOT_BUDGET_CHARS || pruned.length === 1);
    assert.ok(pruned.length < checkpoints.length);
    assert.ok(pruned.some(item => item.messageId === 29), 'newest checkpoint must survive budget compaction');
});

test('portrait GC removes unreachable and manually deleted assets but keeps branch-restorable assets', () => {
    const state = {
        npcs: [{ id: 'live' }],
        checkpoints: [{ snapshot: { npcs: [{ id: 'branch-old' }, { id: 'deleted' }] } }],
        branchRootSnapshot: null,
        userDismissedGroups: [{ ids: ['deleted'] }],
        portraitAssets: {
            live: { dataUrl: 'data:image/webp;base64,AA==' },
            'branch-old': { dataUrl: 'data:image/webp;base64,AQ==' },
            deleted: { dataUrl: 'data:image/webp;base64,Ag==' },
            orphan: { dataUrl: 'data:image/webp;base64,Aw==' },
        },
    };
    assert.deepEqual(Object.keys(prunePortraitAssetsForState(state)).sort(), ['branch-old', 'live']);
});

test('branch discovery and inheritance are owner scoped', () => {
    assert.match(index, /sameChatOwnerScope\(key, currentKey\)/);
    assert.match(index, /chatStateCache\.entries\(\)\]\.filter\(\(\[candidate\]\) => sameChatOwnerScope\(candidate, key\)\)/);
});

test('tombstones override stale live pointers before hydration', () => {
    assert.match(index, /ignored live sidecar pointer for tombstoned/);
    assert.match(index, /delete settings\.dataFiles\[key\];\n\s*pointer = null/);
});

test('successful hydration starts clean instead of forcing an unload rewrite', () => {
    assert.match(index, /if \(loaded && !needsDurableCompactionWrite\) persistedVersions\.set/);
});

test('chat cache has bounded eviction and refuses to evict active work', () => {
    assert.match(index, /const CHAT_CACHE_LIMIT = 6/);
    assert.match(index, /function evictDormantChatStates/);
    assert.match(index, /if \(chatStateCache\.size <= cap\) break/);
    assert.doesNotMatch(index, /chatStateCache\.size - removed <= cap/);
    assert.match(index, /stateWriteTimers\.has\(key\) \|\| stateWritePromises\.has\(key\) \|\| loadingChatStates\.has\(key\) \|\| isScanBusy\(key\)/);
});

test('lifecycle lookup prefers known owner state and fails closed on ambiguous suffixes', () => {
    assert.match(index, /resolveOwnedLifecycleKey\(candidates, kind, id, resolvedOwner, ownerWasProvided\)/);
    const ownershipCore = fs.readFileSync(new URL('../hardening-core.js', import.meta.url), 'utf8');
    assert.match(ownershipCore, /if \(ownerWasProvided\) return direct && unique\.includes\(direct\) \? direct : ''/);
    assert.match(index, /refused ambiguous/);
});

test('legacy ownership proof accepts both content lineage and pre-v0.2.11 lineage', () => {
    assert.match(index, /legacyChatLineageV0210\(messages\)/);
});

test('high-value manual mutations use immediate persistence', () => {
    assert.match(index, /function persistCritical/);
    assert.match(index, /persistCritical\(originChatKey\)/);
    assert.match(index, /persistCritical\(\);\n\s*closeNpcEditor/);
});

test('legacy ownership migration is lineage-gated and owner-qualified', () => {
    assert.match(index, /legacyMigrationMatchesActiveChat/);
    assert.match(index, /legacyOwnershipClaims/);
    assert.match(index, /qualified-namespace-migrated/);
});

test('same chat filename for two owners produces distinct canonical keys', () => {
    assert.notEqual(buildQualifiedChatKey('chat', 'a.png', 'save'), buildQualifiedChatKey('chat', 'b.png', 'save'));
});

test('production CI is read-only and version-neutral', () => {
    assert.match(ci, /contents: read/);
    assert.doesNotMatch(ci, /v0\.2\.15-release-hardening-10x|apply_v0215_release|Commit verified v0\.2\.16/);
});
