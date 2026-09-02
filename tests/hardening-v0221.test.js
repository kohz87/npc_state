import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    applyCanonicalOwnershipMove,
    lifecycleRenameStateIsEmpty,
    liveLifecycleCandidateKeys,
    resolveDeletedLifecycleKeyFromPresence,
    resolveOwnedLifecycleKey,
} from '../hardening-core.js';
import { buildQualifiedChatKey } from '../identity.js';
import {
    encodeStateFilePayload,
    pendingNpcStateDurabilityKeys,
    readNpcStateDataFile,
    writeNpcStateDataFile,
} from '../storage.js';

const keyA = buildQualifiedChatKey('chat', 'A.png', 'Adventure');
const keyB = buildQualifiedChatKey('chat', 'B.png', 'Adventure');

test('explicit lifecycle owner is authoritative and never falls through to another owner', () => {
    assert.equal(resolveOwnedLifecycleKey([keyA], 'chat', 'Adventure', 'B.png', true), '');
    assert.equal(resolveOwnedLifecycleKey([keyA, keyB], 'chat', 'Adventure', 'B.png', true), keyB);
});

test('ownerless deletion requires host absence proof even with one NPC-State candidate', () => {
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: true }]), '');
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: null }]), '');
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: false }]), keyA);
});

test('ambiguous deletion requires exactly one absent owner and every other candidate still present', () => {
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA, keyB], [
        { key: keyA, value: false },
        { key: keyB, value: true },
    ]), keyA);
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA, keyB], [
        { key: keyA, value: false },
        { key: keyB, value: null },
    ]), '');
});

test('live lifecycle candidates ignore branch index, recovery and tombstone history', () => {
    const ghost = buildQualifiedChatKey('chat', 'Ghost.png', 'Adventure');
    const tombstoned = buildQualifiedChatKey('chat', 'Dead.png', 'Adventure');
    const settings = {
        dataFiles: { [keyA]: { path: '/a' }, [tombstoned]: { path: '/dead' } },
        chats: {},
        branchIndex: { [ghost]: { head: ['x'] } },
        recoveryFiles: { [ghost]: { path: '/recovery' } },
        sidecarTombstones: { [tombstoned]: { reason: 'deleted' } },
    };
    assert.deepEqual(liveLifecycleCandidateKeys(settings, [], 'chat', 'Adventure'), [keyA]);
});

test('rename destination emptiness protects branch/social/inline/portrait state', () => {
    assert.equal(lifecycleRenameStateIsEmpty({ npcs: [], candidates: [], checkpoints: [] }), true);
    assert.equal(lifecycleRenameStateIsEmpty({ branchRootSnapshot: { npcs: [{ id: 'x' }] } }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ socialGraph: { edges: [{ aId: 'a', bId: 'b' }] } }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ inlineCards: [{ messageId: 1 }] }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ portraitAssets: { x: { dataUrl: 'data:image/png;base64,AA==' } } }), false);
});

function fileHarness() {
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body);
            const path = '/files/' + body.name;
            files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ path }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    return { files, fetchFn };
}

test('hydration converts sidecar ISO updatedAt into finite pointer milliseconds', async () => {
    const { fetchFn } = fileHarness();
    const pointer = await writeNpcStateDataFile({ chatKey: keyA, state: { value: 1 }, fetchFn });
    pointer.updatedAt = 0;
    const payload = await readNpcStateDataFile(pointer, { fetchFn, expectedChatKey: keyA });
    assert.ok(payload.updatedAt);
    assert.ok(Number.isFinite(pointer.updatedAt));
    assert.ok(pointer.updatedAt > 0);
});

test('lifecycle bounded write mode never enters the endless durability queue', async () => {
    const fetchFn = async () => { throw new Error('network unavailable'); };
    const sleepFn = resolve => resolve();
    await assert.rejects(writeNpcStateDataFile({
        chatKey: keyA,
        state: { value: 1 },
        fetchFn,
        sleepFn,
        continuousRetry: false,
    }), /network unavailable|bounded sidecar write failed/);
    assert.deepEqual(pendingNpcStateDurabilityKeys(), []);
});

test('recovery filenames are distinct across separate module instances at the same millisecond', async () => {
    const originalNow = Date.now;
    try {
        Date.now = () => 1700000000000;
        const a = await import(`../storage.js?tab-a-${Math.random()}`);
        const b = await import(`../storage.js?tab-b-${Math.random()}`);
        assert.notEqual(a.makeNpcStateRecoveryFileName(keyA), b.makeNpcStateRecoveryFileName(keyA));
    } finally {
        Date.now = originalNow;
    }
});

test('runtime wiring uses pure owner-safe helpers and cheap host chat listing', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /resolveOwnedLifecycleKey\(candidates, kind, id, resolvedOwner, ownerWasProvided\)/);
    assert.match(source, /resolveDeletedLifecycleKeyFromPresence\(candidates, presence\)/);
    assert.match(source, /avatar_url: owner, simple: true/);
    assert.match(source, /runBoundedLifecycleEvent/);
});

test('hardening owner-wide work is per-key isolated and historical index is bounded', () => {
    const source = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(source, /HISTORICAL_RENAME_CANDIDATE_LIMIT = 1024/);
    assert.match(source, /character rename preserved .* continued with other chats/);
    assert.match(source, /character deletion preserved .* continued with other chats/);
    assert.match(source, /runBoundedHardeningEvent/);
});

test('historical tombstone replay cannot poison an already-live renamed destination', () => {
    const oldKey = buildQualifiedChatKey('chat', 'old.png', 'Adventure');
    const newKey = buildQualifiedChatKey('chat', 'new.png', 'Adventure');
    const config = {
        dataFiles: { [newKey]: { path: '/live', revision: 3 } },
        sidecarTombstones: { [oldKey]: { reason: 'old-delete', at: 1 } },
        recoveryFiles: {}, branchIndex: {},
    };
    applyCanonicalOwnershipMove(config, { oldKey, newKey, reason: 'character-renamed' });
    assert.equal(config.sidecarTombstones[newKey], undefined);
    assert.equal(config.dataFiles[newKey].path, '/live');
});

test('lifecycle wrappers schedule retries for late background rejection and owner flush fails closed', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(index, /void operation\.catch\(error =>[\s\S]*scheduleLifecycleRetry/);
    assert.match(hardening, /void operation\.catch\(error =>[\s\S]*scheduleHardeningRetry/);
    assert.match(index, /NPC_STATE_OWNER_FLUSH_INCOMPLETE/);
    assert.match(hardening, /if \(cachesSettled\)/);
});

test('historical rename batching processes every tracked candidate instead of truncating after one batch', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(hardening, /for \(let offset = 0; offset < allCandidates\.length; offset \+= HISTORICAL_RENAME_CANDIDATE_LIMIT\)/);
    assert.doesNotMatch(hardening, /allCandidates\.slice\(0, HISTORICAL_RENAME_CANDIDATE_LIMIT\)/);
});

test('owner-wide partial failures are surfaced to the retry scheduler after successful keys are persisted', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(hardening, /NPC_STATE_OWNER_RENAME_PARTIAL/);
    assert.match(hardening, /NPC_STATE_OWNER_DELETE_PARTIAL/);
    assert.match(hardening, /failedKeys\.push\(\{ key: oldKey, error \}\)/);
    assert.match(hardening, /failedKeys\.push\(\{ key, error \}\)/);
});
