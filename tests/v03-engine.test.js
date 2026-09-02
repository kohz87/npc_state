import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcStateEngine } from '../v03/engine.js';
import { encodeV3Payload } from '../v03/storage.js';

function baseChat() {
    return [
        { is_user: true, mes: 'I greet Astra and reach for Neri.' },
        { is_user: false, mes: 'Astra answers. Neri steps through the doorway.' },
    ];
}

function createFakeFetch() {
    const files = new Map();
    const writes = [];
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body || '{}');
            const json = Buffer.from(body.data, 'base64').toString('utf8');
            const path = `/user/files/${body.name}`;
            files.set(path, json);
            writes.push({ path, json });
            return { ok: true, status: 200, json: async () => ({ path }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    return { files, writes, fetchFn };
}

function harness({ settings = {}, generator, legacyPointer = null, legacyText = '' } = {}) {
    const chatKey = 'chat:owner:test';
    const ctx = { chat: baseChat() };
    const config = {
        enabled: true, autoScan: true, scanDepth: 8, branchRescan: true,
        relationshipCaps: { ordinary: 1, meaningful: 2, major: 5, extreme: 10 },
        relationshipCriteria: '', memoryCriteria: '', ...settings,
    };
    const storage = createFakeFetch();
    if (legacyPointer?.path && legacyText) storage.files.set(legacyPointer.path, legacyText);
    let pointer = null;
    let generateCalls = 0;
    const engine = createNpcStateEngine({
        getContext: () => ctx,
        getChatKey: () => chatKey,
        getSettings: () => config,
        getPointer: () => pointer,
        setPointer: (_key, value) => { pointer = structuredClone(value); },
        getLegacyPointer: () => legacyPointer,
        persistSettings: () => {},
        getHeaders: () => ({}),
        fetchFn: storage.fetchFn,
        generate: async args => { generateCalls += 1; return generator(args); },
        notify: () => {}, onStateChanged: () => {},
    });
    return { engine, ctx, config, storage, chatKey, pointer: () => pointer, generateCalls: () => generateCalls };
}

test('automatic current-cast scan uses one batch generation for multiple NPCs', async () => {
    const h = harness({ generator: async () => JSON.stringify({
        exchangeActiveNpcIds: ['Astra', 'Neri'],
        finalPresentNpcIds: ['Astra', 'Neri'], worldActiveNpcIds: [],
        npcs: [
            { name: 'Astra', role: 'Companion', relationshipChange: { impact: 'ordinary', delta: { trust: 1 }, evidence: 'She directly speaks with the player.', reason: 'Direct interaction.' } },
            { name: 'Neri', role: 'Messenger', relationshipChange: { impact: 'none', delta: {}, evidence: '', reason: '' } },
        ], socialEdges: [],
    }) });
    const result = await h.engine.scan(1, { manual: false });
    assert.equal(result.ok, true);
    assert.equal(h.generateCalls(), 1);
    assert.equal(result.targetNpcIds.length, 2);
    assert.equal(result.state.npcs.filter(n => n.present).length, 2);
    assert.equal(h.storage.writes.length, 1, 'one state commit for the whole cast');
    assert.equal(h.pointer().revision, 1);
});

test('global disabled stops automatic scan before model generation', async () => {
    const h = harness({ settings: { enabled: false }, generator: async () => { throw new Error('must not run'); } });
    const result = await h.engine.scan(1, { manual: false });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(h.generateCalls(), 0);
    assert.equal(h.storage.writes.length, 0);
});

test('new user activity invalidates an in-flight scan so its late result cannot commit', async () => {
    let resolveGeneration;
    const gate = new Promise(resolve => { resolveGeneration = resolve; });
    const h = harness({ generator: async () => gate });
    const pending = h.engine.scan(1, { manual: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    h.engine.invalidate(h.chatKey);
    resolveGeneration(JSON.stringify({ exchangeActiveNpcIds: ['Astra'], finalPresentNpcIds: ['Astra'], worldActiveNpcIds: [], npcs: [{ name: 'Astra' }], socialEdges: [] }));
    const result = await pending;
    assert.equal(result.discarded, true);
    assert.equal(result.reason, 'stale-operation');
    assert.equal(h.storage.writes.length, 0);
    assert.equal(h.engine.getState(h.chatKey).lastScannedMessageId, null);
});

test('targeted dossier refresh never replays relationship deltas or changes live presence', async () => {
    const h = harness({ generator: async () => JSON.stringify({
        exchangeActiveNpcIds: [], finalPresentNpcIds: [], worldActiveNpcIds: [],
        npcs: [{ name: 'Astra', personality: 'Recovered from chat', relationshipChange: { impact: 'extreme', delta: { trust: -10 }, evidence: 'older scene', reason: 'old evidence' } }], socialEdges: [],
    }) });
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;
    await h.engine.updateNpc(id, { present: true, relationship: { trust: 10, affection: 0, desire: 0, tension: 0 } });
    const before = h.engine.getState(h.chatKey);
    const result = await h.engine.refreshDossier(id);
    assert.equal(result.ok, true);
    const npc = h.engine.getState(h.chatKey).npcs.find(item => item.id === id);
    assert.equal(npc.present, true);
    assert.equal(npc.relationship.trust, 10);
    assert.equal(npc.personality, 'Recovered from chat');
    assert.equal(h.engine.getState(h.chatKey).lastScannedMessageId, before.lastScannedMessageId);
});

test('legacy v0.2 sidecar is read once and imported into a separate v0.3 sidecar without rewriting the old file', async () => {
    const legacyPointer = { name: 'npc-state-old.json', path: '/legacy/npc-state-old.json', revision: 4 };
    const legacyText = JSON.stringify({
        format: 'npc_state_chat_data', formatVersion: 1, appVersion: '0.2.23', chatKey: 'chat:owner:test', revision: 4,
        state: { schemaVersion: 29, pendingBackfills: [{ npcId: 'a' }], npcs: [{ id: 'a', name: 'Astra', personality: 'legacy dossier' }] },
    });
    const h = harness({ legacyPointer, legacyText, generator: async () => '{}' });
    const state = await h.engine.loadChat(h.chatKey);
    assert.equal(state.npcs[0].personality, 'legacy dossier');
    assert.equal('pendingBackfills' in state, false);
    assert.equal(h.storage.files.get(legacyPointer.path), legacyText, 'legacy file is untouched');
    assert.ok(h.pointer()?.path);
    assert.notEqual(h.pointer().path, legacyPointer.path);
    assert.match(h.pointer().name, /^npc-state-v3-/);
    assert.equal(h.storage.writes.length, 1);
});

test('stale same-NPC editor save is rejected without overwriting a newer dossier revision', async () => {
    const h = harness({ generator: async () => '{}' });
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;
    const openedAt = h.engine.getState(h.chatKey).npcs.find(npc => npc.id === id).updatedAt;
    const newer = await h.engine.updateNpc(id, { personality: 'new scan-era value' });
    assert.equal(newer.ok, true);
    const writesBeforeStaleSave = h.storage.writes.length;
    const stale = await h.engine.updateNpc(id, { personality: 'stale editor value' }, { expectedUpdatedAt: openedAt });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'stale-editor');
    assert.equal(h.storage.writes.length, writesBeforeStaleSave, 'rejected editor save must not persist');
    assert.equal(h.engine.getState(h.chatKey).npcs.find(npc => npc.id === id).personality, 'new scan-era value');
});

test('manual relationship edits append a manual audit event without scanner caps', async () => {
    const h = harness({ generator: async () => '{}' });
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;
    const result = await h.engine.updateNpc(id, { relationship: { trust: 40, affection: -3, desire: 0, tension: 7 } });
    assert.equal(result.ok, true);
    const npc = h.engine.getState(h.chatKey).npcs.find(item => item.id === id);
    assert.equal(npc.relationship.trust, 40);
    assert.equal(npc.lastRelationshipChange.impact, 'manual');
    assert.deepEqual(npc.lastRelationshipChange.delta, { trust: 40, affection: -3, desire: 0, tension: 7 });
    assert.equal(npc.relationshipHistory.at(-1).impact, 'manual');
});

test('a local v0.3 pointer hint recovers a sidecar when debounced extension settings lost the pointer', async () => {
    const previousStorage = globalThis.localStorage;
    const memory = new Map();
    globalThis.localStorage = {
        getItem: key => memory.has(key) ? memory.get(key) : null,
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: key => memory.delete(key),
    };
    const storage = createFakeFetch();
    const chatKey = 'chat:owner:hint-recovery';
    const ctx = { chat: baseChat() };
    const config = { enabled: true, autoScan: true, scanDepth: 8, branchRescan: true, relationshipCaps: { ordinary: 1, meaningful: 2, major: 5, extreme: 10 }, relationshipCriteria: '', memoryCriteria: '' };
    let firstPointer = null;
    const makeEngine = (getPointer, setPointer) => createNpcStateEngine({
        getContext: () => ctx,
        getChatKey: () => chatKey,
        getSettings: () => config,
        getPointer,
        setPointer,
        getLegacyPointer: () => null,
        persistSettings: () => {},
        getHeaders: () => ({}),
        fetchFn: storage.fetchFn,
        generate: async () => '{}',
        notify: () => {}, onStateChanged: () => {},
    });
    try {
        const first = makeEngine(() => firstPointer, (_key, value) => { firstPointer = structuredClone(value); });
        const added = await first.addNpc('Astra');
        assert.equal(added.ok, true);
        assert.ok(firstPointer?.path);

        let recoveredPointer = null;
        const second = makeEngine(() => null, (_key, value) => { recoveredPointer = structuredClone(value); });
        const loaded = await second.loadChat(chatKey);
        assert.equal(loaded.npcs.some(npc => npc.name === 'Astra'), true);
        assert.equal(recoveredPointer?.path, firstPointer.path);
        assert.equal(recoveredPointer?.revision, firstPointer.revision);
        assert.equal(storage.writes.length, 1, 'pointer recovery reads the existing sidecar instead of creating another one');
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});
