import { NPC_STATE_VERSION, normalizeState } from './schema.js';

export const V3_FILE_FORMAT = 'npc_state_v3_chat_data';
export const V3_FILE_FORMAT_VERSION = 1;
const writerLocks = new Map();
const LOCK_LEASE_MS = 15000;
const LOCK_ACQUIRE_MS = 5000;

function fnv1a(value) {
    let hash = 2166136261;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function makeV3FileName(chatKey) {
    const key = String(chatKey || 'chat');
    return `npc-state-v3-${fnv1a(key)}${fnv1a([...key].reverse().join(''))}.json`;
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    if (typeof globalThis.btoa === 'function') {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return globalThis.btoa(binary);
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    throw new Error('No base64 encoder is available.');
}

export function encodeV3Payload(chatKey, state, revision = 0) {
    const normalized = normalizeState(state, chatKey);
    normalized.revision = Math.max(0, Math.trunc(Number(revision) || 0));
    return JSON.stringify({
        format: V3_FILE_FORMAT,
        formatVersion: V3_FILE_FORMAT_VERSION,
        appVersion: NPC_STATE_VERSION,
        chatKey: String(chatKey || ''),
        revision: normalized.revision,
        updatedAt: new Date().toISOString(),
        state: normalized,
    }, null, 2);
}

export function decodeV3Payload(text, expectedChatKey = '') {
    let payload;
    try { payload = JSON.parse(String(text ?? '')); }
    catch { throw new Error('NPC State v0.3 sidecar contains invalid JSON.'); }
    if (payload?.format !== V3_FILE_FORMAT || payload?.formatVersion !== V3_FILE_FORMAT_VERSION) throw new Error('Not an NPC State v0.3 sidecar.');
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw new Error('NPC State v0.3 sidecar is missing state.');
    if (expectedChatKey && String(payload.chatKey || '') !== String(expectedChatKey)) throw new Error('NPC State v0.3 sidecar belongs to a different chat.');
    const state = normalizeState(payload.state, payload.chatKey || expectedChatKey);
    state.revision = Math.max(0, Math.trunc(Number(payload.revision) || state.revision || 0));
    return { ...payload, revision: state.revision, state };
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }

async function withInProcessWriterLock(chatKey, task) {
    const key = String(chatKey || '');
    const previous = writerLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const queued = previous.catch(() => {}).then(() => gate);
    writerLocks.set(key, queued);
    await previous.catch(() => {});
    try { return await task(); }
    finally {
        release();
        if (writerLocks.get(key) === queued) writerLocks.delete(key);
    }
}

function lockRecord(storage, key) {
    try {
        const value = JSON.parse(String(storage.getItem(key) || 'null'));
        if (!value || typeof value !== 'object') return null;
        return { token: String(value.token || ''), expiresAt: Number(value.expiresAt || 0) };
    } catch { return null; }
}

async function withLocalStorageWriterLock(chatKey, task) {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
        return withInProcessWriterLock(chatKey, task);
    }
    const key = `npc-state-v3-writer-lock:${fnv1a(chatKey)}`;
    const token = `v3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + LOCK_ACQUIRE_MS;
    while (Date.now() <= deadline) {
        const now = Date.now();
        const current = lockRecord(storage, key);
        if (!current?.token || current.expiresAt <= now) {
            try { storage.setItem(key, JSON.stringify({ token, expiresAt: now + LOCK_LEASE_MS })); }
            catch { return withInProcessWriterLock(chatKey, task); }
            await wait(12);
            if (lockRecord(storage, key)?.token === token) {
                const renew = globalThis.setInterval?.(() => {
                    try {
                        if (lockRecord(storage, key)?.token === token) storage.setItem(key, JSON.stringify({ token, expiresAt: Date.now() + LOCK_LEASE_MS }));
                    } catch { /* lease expiry is the fallback */ }
                }, Math.floor(LOCK_LEASE_MS / 3));
                try { return await withInProcessWriterLock(chatKey, task); }
                finally {
                    if (renew) globalThis.clearInterval?.(renew);
                    try { if (lockRecord(storage, key)?.token === token) storage.removeItem(key); } catch { /* lease expires */ }
                }
            }
        }
        await wait(20);
    }
    const error = new Error(`NPC State v0.3 could not acquire the cross-tab sidecar lock for ${chatKey}.`);
    error.code = 'NPC_STATE_V3_LOCK_TIMEOUT';
    throw error;
}

async function withWriterLock(chatKey, task) {
    const locks = globalThis.navigator?.locks;
    if (locks && typeof locks.request === 'function') {
        return locks.request(`npc-state-v3-sidecar:${fnv1a(chatKey)}`, { mode: 'exclusive' }, () => withInProcessWriterLock(chatKey, task));
    }
    return withLocalStorageWriterLock(chatKey, task);
}

function pointerHintKey(chatKey) { return `npc-state-v3-pointer:${fnv1a(chatKey)}`; }

export function readV3PointerHint(chatKey, storage = globalThis.localStorage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
        const value = JSON.parse(String(storage.getItem(pointerHintKey(chatKey)) || 'null'));
        if (!value?.path || !value?.name) return null;
        return { name: String(value.name), path: String(value.path), revision: Math.max(0, Math.trunc(Number(value.revision) || 0)), updatedAt: Number(value.updatedAt) || 0 };
    } catch { return null; }
}

function writeV3PointerHint(chatKey, pointer, storage = globalThis.localStorage) {
    if (!storage || typeof storage.setItem !== 'function' || !pointer?.path) return;
    try { storage.setItem(pointerHintKey(chatKey), JSON.stringify(pointer)); } catch { /* settings pointer remains authoritative */ }
}

function conflict(message, expectedRevision = null, actualRevision = null) {
    const error = new Error(message);
    error.code = 'NPC_STATE_V3_WRITE_CONFLICT';
    error.expectedRevision = expectedRevision;
    error.actualRevision = actualRevision;
    return error;
}

export async function readV3Sidecar({ chatKey, pointer, fetchFn = globalThis.fetch }) {
    if (!pointer?.path) return null;
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State v0.3 persistence.');
    const response = await fetchFn(pointer.path, { method: 'GET', cache: 'no-store' });
    if (response?.status === 404) return null;
    if (!response?.ok) throw new Error(`NPC State v0.3 sidecar read failed with HTTP ${response?.status || 'error'}.`);
    return decodeV3Payload(await response.text(), chatKey);
}

export async function writeV3Sidecar({ chatKey, state, pointer = null, fetchFn = globalThis.fetch, headers = {} }) {
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State v0.3 persistence.');
    return withWriterLock(chatKey, async () => {
        const hint = readV3PointerHint(chatKey);
        const pointerRevision = pointer?.revision == null ? null : Math.max(0, Math.trunc(Number(pointer.revision) || 0));
        if (hint?.path && (!pointer?.path || hint.path !== pointer.path || hint.revision > (pointerRevision ?? -1))) {
            throw conflict('NPC State v0.3 sidecar was created or advanced in another tab. Reload this chat before saving.', pointerRevision, hint.revision);
        }

        const expected = pointerRevision;
        let remoteRevision = 0;
        if (pointer?.path) {
            const remote = await readV3Sidecar({ chatKey, pointer, fetchFn });
            if (!remote) {
                const error = new Error('NPC State v0.3 sidecar pointer exists but the file is missing. Refusing to recreate it over an unknown state.');
                error.code = 'NPC_STATE_V3_MISSING_SIDECAR';
                throw error;
            }
            remoteRevision = remote.revision || 0;
            if (expected === null) throw conflict('NPC State v0.3 has no revision token for an existing sidecar. Reload before saving.', null, remoteRevision);
            if (remoteRevision !== expected) throw conflict(`NPC State v0.3 sidecar changed in another writer (expected ${expected}, found ${remoteRevision}). Reload before saving.`, expected, remoteRevision);
        }

        const revision = Math.max(remoteRevision, expected || 0) + 1;
        const normalized = normalizeState(state, chatKey);
        normalized.revision = revision;
        normalized.updatedAt = Date.now();
        const name = pointer?.name || makeV3FileName(chatKey);
        const json = encodeV3Payload(chatKey, normalized, revision);
        const response = await fetchFn('/api/files/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, data: toBase64(json) }),
        });
        if (!response?.ok) throw new Error(`NPC State v0.3 sidecar write failed with HTTP ${response?.status || 'error'}.`);
        const result = await response.json();
        if (!result?.path) throw new Error('NPC State v0.3 sidecar upload returned no path.');
        const nextPointer = { name, path: result.path, revision, updatedAt: Date.now() };
        writeV3PointerHint(chatKey, nextPointer);
        return { state: normalized, pointer: nextPointer };
    });
}
