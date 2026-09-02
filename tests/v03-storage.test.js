import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../v03/schema.js';
import { decodeV3Payload, encodeV3Payload, makeV3FileName, writeV3Sidecar } from '../v03/storage.js';

function fakeStorage() {
    const data = new Map();
    return {
        getItem: key => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key),
    };
}

test('v0.3 sidecar has an independent format and deterministic v3 filename', () => {
    const key = 'chat:owner:storage';
    const payload = decodeV3Payload(encodeV3Payload(key, createEmptyState(key), 7), key);
    assert.equal(payload.format, 'npc_state_v3_chat_data');
    assert.equal(payload.revision, 7);
    assert.match(makeV3FileName(key), /^npc-state-v3-/);
});

test('write refuses to recreate a missing sidecar behind an existing pointer', async () => {
    const key = 'chat:owner:missing';
    const fetchFn = async url => url === '/missing.json'
        ? { ok: false, status: 404, text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ path: '/unexpected' }) };
    await assert.rejects(
        writeV3Sidecar({ chatKey: key, state: createEmptyState(key), pointer: { name: 'missing.json', path: '/missing.json', revision: 1 }, fetchFn }),
        error => error?.code === 'NPC_STATE_V3_MISSING_SIDECAR',
    );
});

test('cross-tab pointer hint prevents a stale tab with no pointer from overwriting the first v3 write', async () => {
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = fakeStorage();
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body || '{}');
            const path = `/files/${body.name}`;
            files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ path }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    const key = 'chat:owner:race';
    try {
        const first = await writeV3Sidecar({ chatKey: key, state: createEmptyState(key), pointer: null, fetchFn });
        assert.equal(first.pointer.revision, 1);
        await assert.rejects(
            writeV3Sidecar({ chatKey: key, state: createEmptyState(key), pointer: null, fetchFn }),
            error => error?.code === 'NPC_STATE_V3_WRITE_CONFLICT',
        );
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});
