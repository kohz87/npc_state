import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcStateEngine } from '../v03/engine.js';

function createFakeFetch() {
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body || '{}');
            const json = Buffer.from(body.data, 'base64').toString('utf8');
            const path = `/user/files/${body.name}`;
            files.set(path, json);
            return { ok: true, status: 200, json: async () => ({ path }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    return { files, fetchFn };
}

function appendExchange(chat, userText = 'The road continues.', assistantText = 'Another uneventful stretch passes.') {
    chat.push({ is_user: true, mes: userText });
    chat.push({ is_user: false, mes: assistantText });
    return chat.length - 1;
}

function harness(generator = async () => JSON.stringify({ exchangeActiveNpcIds: [], finalPresentNpcIds: [], worldActiveNpcIds: [], npcs: [], socialEdges: [] })) {
    const chatKey = 'chat:stale:test';
    const ctx = { chat: [{ is_user: true, mes: 'Start.' }, { is_user: false, mes: 'The story begins.' }] };
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
    const storage = createFakeFetch();
    let pointer = null;
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
        generate: generator,
        notify: () => {},
        onStateChanged: () => {},
    });
    return { engine, ctx, settings, chatKey };
}

test('repeated forced scans of the same assistant message do not advance stale age', async () => {
    const h = harness();
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;

    for (let i = 0; i < 30; i += 1) appendExchange(h.ctx.chat);
    const messageId = h.ctx.chat.length - 1;
    const first = await h.engine.scan(messageId, { manual: true, force: true });
    assert.equal(first.ok, true);
    assert.equal(first.state.npcs.find(npc => npc.id === id).archiveReason, 'stale');
    assert.equal(first.stale.currentTurn, 31);

    const second = await h.engine.scan(messageId, { manual: true, force: true });
    assert.equal(second.ok, true);
    assert.equal(second.stale.currentTurn, 31, 'manual rescan stays on the same narrative turn');
    assert.equal(second.state.npcs.some(npc => npc.id === id), true, 'rescan cannot accelerate stale deletion');
});

test('stale archive is automatically removed at 50 total inactive narrative turns', async () => {
    const h = harness();
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;

    for (let i = 0; i < 30; i += 1) appendExchange(h.ctx.chat);
    await h.engine.scan(h.ctx.chat.length - 1, { manual: true, force: true });
    assert.equal(h.engine.getState(h.chatKey).npcs.find(npc => npc.id === id).archiveReason, 'stale');

    for (let i = 0; i < 20; i += 1) appendExchange(h.ctx.chat);
    const result = await h.engine.scan(h.ctx.chat.length - 1, { manual: true, force: true });
    assert.deepEqual(result.stale.deletedIds, [id]);
    assert.equal(h.engine.getState(h.chatKey).npcs.some(npc => npc.id === id), false);
    assert.equal(h.engine.getState(h.chatKey).deletedNpcIds.includes(id), false, 'automatic cleanup is not a permanent tombstone');
});

test('a canonical-name reference resets inactivity even when the scanner does not target that NPC', async () => {
    const h = harness();
    const added = await h.engine.addNpc('Astra');
    const id = added.result.npcId;

    for (let i = 0; i < 29; i += 1) appendExchange(h.ctx.chat);
    const referencedMessage = appendExchange(h.ctx.chat, 'I wonder how Astra is doing.', 'No answer comes from the distant road.');
    const result = await h.engine.scan(referencedMessage, { manual: true, force: true });
    const npc = result.state.npcs.find(item => item.id === id);
    assert.equal(npc.archived, false);
    assert.equal(npc.lastActivityReason, 'referenced');
    assert.equal(npc.lastActivityTurn, 31);
    assert.deepEqual(result.targetNpcIds, [], 'retention reference does not become a full reconciliation target');
});

test('world-active scanner signal resets stale age without making the NPC physically present', async () => {
    let npcId = '';
    const h = harness(async () => JSON.stringify({
        exchangeActiveNpcIds: [],
        finalPresentNpcIds: [],
        worldActiveNpcIds: [npcId],
        npcs: [{ id: npcId, name: 'Astra', location: 'Auvoth' }],
        socialEdges: [],
    }));
    const added = await h.engine.addNpc('Astra');
    npcId = added.result.npcId;
    for (let i = 0; i < 40; i += 1) appendExchange(h.ctx.chat);
    const result = await h.engine.scan(h.ctx.chat.length - 1, { manual: true, force: true });
    const npc = result.state.npcs.find(item => item.id === npcId);
    assert.equal(npc.archived, false);
    assert.equal(npc.worldActive, true);
    assert.equal(npc.present, false);
    assert.equal(npc.lastActivityReason, 'world-active');
    assert.equal(npc.lastActivityTurn, 41);
});
