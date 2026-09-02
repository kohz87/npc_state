import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcStateBundle } from '../v03/bundle.js';
import { createNpcStateEngine } from '../v03/engine.js';
import { normalizeNpc, normalizeState } from '../v03/schema.js';

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

function harness() {
    const chatKey = 'chat:bundle-target';
    const ctx = { chat: [
        { is_user: true, mes: 'I enter the guild.' },
        { is_user: false, mes: 'The guild hall is quiet.' },
    ] };
    const storage = createFakeFetch();
    let pointer = null;
    const settings = {
        enabled: true,
        autoScan: true,
        scanDepth: 8,
        branchRescan: true,
        staleManagementEnabled: true,
        staleArchiveAfter: 30,
        staleDeleteAfter: 50,
        relationshipCaps: { ordinary: 1, meaningful: 2, major: 5, extreme: 10 },
        relationshipCriteria: '',
        memoryCriteria: '',
    };
    const engine = createNpcStateEngine({
        getContext: () => ctx,
        getChatKey: () => chatKey,
        getSettings: () => settings,
        getPointer: () => pointer,
        setPointer: (_key, value) => { pointer = structuredClone(value); },
        getLegacyPointer: () => null,
        persistSettings: () => {},
        getHeaders: () => ({}),
        fetchFn: storage.fetchFn,
        generate: async () => '{}',
        notify: () => {},
        onStateChanged: () => {},
    });
    return { engine, storage, chatKey };
}

function sourceBundle(id = 'npc-astra', name = 'Astra') {
    const source = normalizeState({
        chatKey: 'chat:bundle-source',
        npcs: [normalizeNpc({
            id,
            name,
            personality: 'Imported personality',
            memories: ['A durable imported memory.'],
            portrait: { dataUrl: 'data:image/png;base64,AAAA' },
            lastActivityTurn: 7,
        })],
    }, 'chat:bundle-source');
    return createNpcStateBundle(source, { sourceNarrativeTurn: 10 });
}

test('engine bundle export and preview are read-only, while successful import commits exactly one sidecar revision and checkpoint', async () => {
    const h = harness();
    const added = await h.engine.addNpc('Neri');
    assert.equal(added.ok, true);
    const writesAfterSetup = h.storage.writes.length;

    const exported = await h.engine.exportBundle();
    assert.equal(exported.ok, true);
    assert.equal(exported.bundle.bundleType, 'full-chat');
    assert.equal(h.storage.writes.length, writesAfterSetup, 'export must not persist');

    const preview = await h.engine.previewBundleImport(sourceBundle(), { mode: 'merge' });
    assert.equal(preview.ok, true);
    assert.equal(preview.newNpcIds.length, 1);
    assert.equal(h.storage.writes.length, writesAfterSetup, 'preview must not persist');

    const imported = await h.engine.importBundle(sourceBundle(), { mode: 'merge' });
    assert.equal(imported.ok, true);
    assert.equal(h.storage.writes.length, writesAfterSetup + 1, 'import is one atomic sidecar write');
    const current = h.engine.getState(h.chatKey);
    assert.equal(current.npcs.some(npc => npc.id === 'npc-astra' && npc.memories.includes('A durable imported memory.')), true);
    assert.equal(current.checkpoints.at(-1)?.reason, 'bundle-merge');
});

test('engine rejected stable-id conflict does not write or partially mutate the cached state', async () => {
    const h = harness();
    const added = await h.engine.addNpc('Astra');
    const localId = added.result.npcId;
    const before = h.engine.getState(h.chatKey);
    const writesBefore = h.storage.writes.length;
    const conflictBundle = sourceBundle(localId, 'Different Person');

    const result = await h.engine.importBundle(conflictBundle, { mode: 'merge', conflictPolicy: 'abort' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'identity-conflict');
    assert.equal(h.storage.writes.length, writesBefore, 'rejected import must not persist');
    assert.deepEqual(h.engine.getState(h.chatKey), before, 'rejected import must not partially mutate cache');
});
