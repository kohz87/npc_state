import test from 'node:test';
import assert from 'node:assert/strict';
import {
    decodeStateFilePayload,
    encodeStateFilePayload,
    makeNpcStateDataFileName,
    readNpcStateDataFile,
    writeNpcStateDataFile,
    deleteNpcStateDataFile,
} from '../storage.js';
import { createNpcRecord } from '../core.js';

test('extension data filename is deterministic and filesystem-safe', () => {
    const a = makeNpcStateDataFileName('chat:My Adventure/01');
    const b = makeNpcStateDataFileName('chat:My Adventure/01');
    assert.equal(a, b);
    assert.match(a, /^npc-state-[a-z0-9]+\.json$/);
});

test('extension-owned JSON payload round-trips full chat state', () => {
    const npc = createNpcRecord('Yunyun');
    npc.relationship.desire = 27;
    npc.present = true;
    npc.mannerisms = ['boasts when embarrassed'];
    npc.species = 'Crimson Demon';
    const text = encodeStateFilePayload('chat:test', { npcs: [npc], checkpoints: [{ messageId: 9 }] }, '0.1.7');
    const decoded = decodeStateFilePayload(text);
    assert.equal(decoded.chatKey, 'chat:test');
    assert.equal(decoded.state.npcs[0].relationship.desire, 27);
    assert.equal(decoded.state.npcs[0].present, true);
    assert.equal(decoded.state.npcs[0].species, 'Crimson Demon');
    assert.equal(decoded.state.checkpoints[0].messageId, 9);
});

test('data-file API writes JSON bytes, reads them back, and deletes the sidecar', async () => {
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body);
            const path = `/user/files/${body.name}`;
            files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ path }), text: async () => '' };
        }
        if (url === '/api/files/delete') {
            const body = JSON.parse(options.body);
            const existed = files.delete(body.path);
            return { ok: existed, status: existed ? 200 : 404, text: async () => '' };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };

    const npc = createNpcRecord('Wiz');
    const pointer = await writeNpcStateDataFile({ chatKey: 'chat:test', state: { npcs: [npc] }, appVersion: '0.1.8', fetchFn, headers: { 'Content-Type': 'application/json' } });
    assert.match(pointer.path, /npc-state-.*\.json$/);
    const loaded = await readNpcStateDataFile(pointer, { fetchFn });
    assert.equal(loaded.state.npcs[0].name, 'Wiz');
    assert.equal(await deleteNpcStateDataFile(pointer, { fetchFn, headers: { 'Content-Type': 'application/json' } }), true);
    assert.equal(await readNpcStateDataFile(pointer, { fetchFn }), null);
});

test('sidecar read rejects a valid NPC State payload belonging to another chat', async () => {
    const text = encodeStateFilePayload('chat:other', { npcs: [createNpcRecord('Wiz')] }, '0.2.7');
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => text });
    await assert.rejects(
        () => readNpcStateDataFile({ path: '/user/files/npc-state-collision.json' }, { fetchFn, expectedChatKey: 'chat:expected' }),
        /different chat/i,
    );
});


test('v0.2.7 sidecar persists high-resolution portrait binary only once', () => {
    const npc = createNpcRecord('Falia');
    const dataUrl = `data:image/webp;base64,${Buffer.from('high-resolution-portrait-binary').toString('base64')}`;
    npc.portrait = { dataUrl, mime: 'image/webp', width: 1200, height: 1536, updatedAt: 123 };
    const text = encodeStateFilePayload('chat:portrait', { npcs: [npc], portraitAssets: {} }, '0.2.7');
    const occurrences = text.split(dataUrl).length - 1;
    assert.equal(occurrences, 1, 'base64 portrait must not be duplicated in npc and portraitAssets');
    const decoded = decodeStateFilePayload(text);
    assert.equal(decoded.state.npcs[0].portrait, null);
    assert.equal(decoded.state.portraitAssets[npc.id].dataUrl, dataUrl);
    assert.equal(decoded.state.portraitAssets[npc.id].width, 1200);
});


test('v0.2.7 sidecar portrait compaction prefers the live NPC portrait over a stale asset copy', () => {
    const npc = createNpcRecord('Falia');
    const live = `data:image/webp;base64,${Buffer.from('new-live-portrait').toString('base64')}`;
    const stale = `data:image/webp;base64,${Buffer.from('old-stale-portrait').toString('base64')}`;
    npc.portrait = { dataUrl: live, mime: 'image/webp', updatedAt: 200 };
    const decoded = decodeStateFilePayload(encodeStateFilePayload('chat:portrait-race', {
        npcs: [npc],
        portraitAssets: { [npc.id]: { dataUrl: stale, mime: 'image/webp', updatedAt: 100 } },
    }, '0.2.7'));
    assert.equal(decoded.state.npcs[0].portrait, null);
    assert.equal(decoded.state.portraitAssets[npc.id].dataUrl, live);
    assert.equal(decoded.state.portraitAssets[npc.id].updatedAt, 200);
});
