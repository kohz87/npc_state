export const NPC_STATE_FILE_FORMAT = 'npc_state_chat_data';
export const NPC_STATE_FILE_FORMAT_VERSION = 1;
export const NPC_STATE_WRITE_RETRY_DELAYS_MS = Object.freeze([0, 1000, 2000, 5000, 15000, 30000]);
export const NPC_STATE_DURABILITY_RETRY_CAP_MS = 30000;

const durabilityQueue = new Map();
const writerLocks = new Map();
const READ_CONCURRENCY_LIMIT = 4;
let activeReads = 0;
const readWaiters = [];

async function withReadSlot(task) {
    if (activeReads >= READ_CONCURRENCY_LIMIT) await new Promise(resolve => readWaiters.push(resolve));
    activeReads += 1;
    try { return await task(); }
    finally {
        activeReads = Math.max(0, activeReads - 1);
        readWaiters.shift()?.();
    }
}

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

async function withWriterLock(chatKey, task) {
    const name = `npc-state-sidecar:${fnv1a(String(chatKey || ''))}`;
    const locks = globalThis.navigator?.locks;
    if (locks && typeof locks.request === 'function') {
        return locks.request(name, { mode: 'exclusive' }, () => withInProcessWriterLock(chatKey, task));
    }
    return withInProcessWriterLock(chatKey, task);
}
const writerId = (() => {
    try { return globalThis.crypto?.randomUUID?.() || `npc-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
    catch { return `npc-state-${Date.now().toString(36)}`; }
})();

function fnv1a(text) {
    let hash = 0x811c9dc5;
    const input = String(text ?? '');
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

export function makeNpcStateDataFileName(chatKey) {
    const key = String(chatKey || 'chat');
    return `npc-state-${fnv1a(key)}${fnv1a(`npc-state\0${[...key].reverse().join('')}`)}.json`;
}

export function makeNpcStateRecoveryFileName(chatKey, generation = Date.now()) {
    const key = String(chatKey || 'chat');
    const stamp = Math.max(0, Number(generation) || Date.now()).toString(36);
    return `npc-state-recovery-${fnv1a(key)}${fnv1a(`npc-state-recovery\0${[...key].reverse().join('')}`)}-${stamp}.json`;
}

function bytesToBase64(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < input.length; i += chunkSize) {
        const chunk = input.subarray(i, Math.min(i + chunkSize, input.length));
        let part = '';
        for (let j = 0; j < chunk.length; j += 1) part += String.fromCharCode(chunk[j]);
        binary += part;
    }
    return globalThis.btoa(binary);
}

export function retainedPortraitAssetIds(state = {}) {
    const retained = new Set();
    const addNpcs = value => {
        for (const npc of Array.isArray(value) ? value : []) {
            const id = String(npc?.id || '').trim();
            if (id) retained.add(id);
        }
    };
    addNpcs(state.npcs);
    for (const checkpoint of Array.isArray(state.checkpoints) ? state.checkpoints : []) addNpcs(checkpoint?.snapshot?.npcs);
    addNpcs(state.branchRootSnapshot?.npcs);
    const blocked = new Set((Array.isArray(state.userDismissedGroups) ? state.userDismissedGroups : [])
        .flatMap(group => [...(Array.isArray(group?.ids) ? group.ids : []), group?.npcId])
        .map(value => String(value || '').trim()).filter(Boolean));
    for (const id of blocked) retained.delete(id);
    return retained;
}

export function prunePortraitAssetsForState(state = {}) {
    const assets = state?.portraitAssets && typeof state.portraitAssets === 'object' ? state.portraitAssets : {};
    const retained = retainedPortraitAssetIds(state);
    return Object.fromEntries(Object.entries(assets).filter(([id, portrait]) => retained.has(String(id)) && portrait?.dataUrl));
}

export function prunePortraitAssetsInPlace(state = {}) {
    if (!state || typeof state !== 'object') return state;
    state.portraitAssets = prunePortraitAssetsForState(state);
    return state;
}

function compactStateForFile(state) {
    const snapshot = structuredClone(state || {});
    snapshot.portraitAssets = prunePortraitAssetsForState(snapshot);
    for (const npc of Array.isArray(snapshot.npcs) ? snapshot.npcs : []) {
        if (!npc?.id) continue;
        if (npc.portrait?.dataUrl) snapshot.portraitAssets[npc.id] = structuredClone(npc.portrait);
        if (snapshot.portraitAssets[npc.id]?.dataUrl) npc.portrait = null;
    }
    return snapshot;
}

export function encodeStateFilePayload(chatKey, state, appVersion = '', metadata = {}) {
    const payload = {
        format: NPC_STATE_FILE_FORMAT,
        formatVersion: NPC_STATE_FILE_FORMAT_VERSION,
        appVersion: String(appVersion || ''),
        chatKey: String(chatKey || ''),
        updatedAt: new Date().toISOString(),
        revision: Math.max(0, Math.trunc(Number(metadata?.revision) || 0)),
        writerId: String(metadata?.writerId || writerId),
        state: compactStateForFile(state),
    };
    return JSON.stringify(payload, null, 2);
}

export function encodeRetiredStateFilePayload(chatKey, reason = 'retired', appVersion = '', metadata = {}) {
    return JSON.stringify({
        format: NPC_STATE_FILE_FORMAT,
        formatVersion: NPC_STATE_FILE_FORMAT_VERSION,
        appVersion: String(appVersion || ''),
        chatKey: String(chatKey || ''),
        updatedAt: new Date().toISOString(),
        revision: Math.max(0, Math.trunc(Number(metadata?.revision) || 0)),
        writerId: String(metadata?.writerId || writerId),
        retired: true,
        retiredAt: new Date().toISOString(),
        retireReason: String(reason || 'retired').slice(0, 120),
        state: {},
    }, null, 2);
}

export function decodeStateFilePayload(text) {
    let payload;
    try { payload = JSON.parse(String(text ?? '')); }
    catch { throw new Error('NPC State data file contains invalid JSON.'); }
    if (!payload || payload.format !== NPC_STATE_FILE_FORMAT) throw new Error('Not an NPC State chat data file.');
    if (payload.formatVersion !== NPC_STATE_FILE_FORMAT_VERSION) throw new Error(`Unsupported NPC State data file version: ${payload.formatVersion}.`);
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw new Error('NPC State data file is missing its state object.');
    payload.retired = payload.retired === true;
    payload.revision = Math.max(0, Math.trunc(Number(payload.revision) || 0));
    payload.writerId = String(payload.writerId || '');
    return payload;
}

function retryableWriteError(error) {
    if (error?.code === 'NPC_STATE_WRITE_CONFLICT') return false;
    const status = Number(error?.status || 0);
    if ([408, 425, 429].includes(status) || status >= 500) return true;
    return !status || /network|fetch|timeout|temporar|unavailable|failed/i.test(String(error?.message || error));
}

function wait(ms, sleepFn = globalThis.setTimeout) {
    return new Promise(resolve => sleepFn(resolve, Math.max(0, Number(ms) || 0)));
}

async function uploadPayload({ name, json, fetchFn, headers }) {
    const data = bytesToBase64(new TextEncoder().encode(json));
    const response = await fetchFn('/api/files/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, data }),
    });
    if (!response?.ok) {
        const detail = typeof response?.text === 'function' ? await response.text() : '';
        const error = new Error(`NPC State data file write failed${detail ? `: ${detail}` : ''}.`);
        error.status = Number(response?.status || 0);
        throw error;
    }
    const result = typeof response.json === 'function' ? await response.json() : {};
    if (!result?.path) throw new Error('NPC State data-file endpoint returned no path.');
    return result;
}

async function remoteRevision(pointer, chatKey, fetchFn) {
    if (!pointer?.path) return { revision: 0, writerId: '', exists: false };
    const response = await withReadSlot(() => fetchFn(pointer.path, { method: 'GET', cache: 'no-store' }));
    if (response?.status === 404) return { revision: 0, writerId: '', exists: false };
    if (!response?.ok) {
        const error = new Error(`NPC State data file revision check failed with HTTP ${response?.status || 'error'}.`);
        error.status = Number(response?.status || 0);
        throw error;
    }
    const payload = decodeStateFilePayload(typeof response.text === 'function' ? await response.text() : '');
    if (chatKey && String(payload.chatKey || '') !== String(chatKey)) throw new Error('NPC State data file belongs to a different chat.');
    return { revision: payload.revision, writerId: payload.writerId, exists: true, retired: payload.retired };
}

async function guardedWriteOnce({ chatKey, state, appVersion, pointer, fetchFn, headers }) {
    return withWriterLock(chatKey, async () => {
        const expectedRevision = Number.isFinite(Number(pointer?.revision)) ? Math.max(0, Math.trunc(Number(pointer.revision))) : null;
        let current = { revision: expectedRevision ?? 0, writerId: '', exists: false };
        if (pointer?.path) current = await remoteRevision(pointer, chatKey, fetchFn);
        if (expectedRevision === null && current.exists && current.revision > 0) {
            const error = new Error(`NPC State sidecar already has revision ${current.revision}, but this tab has no matching revision token. Reload the chat before saving again.`);
            error.code = 'NPC_STATE_WRITE_CONFLICT';
            error.expectedRevision = null;
            error.actualRevision = current.revision;
            throw error;
        }
        if (expectedRevision !== null && current.exists && current.revision !== expectedRevision) {
            const error = new Error(`NPC State sidecar changed in another tab or writer (expected revision ${expectedRevision}, found ${current.revision}). Reload the chat before saving again.`);
            error.code = 'NPC_STATE_WRITE_CONFLICT';
            error.expectedRevision = expectedRevision;
            error.actualRevision = current.revision;
            throw error;
        }
        const revision = Math.max(current.revision, expectedRevision ?? 0) + 1;
        const name = pointer?.name || makeNpcStateDataFileName(chatKey);
        const json = encodeStateFilePayload(chatKey, state, appVersion, { revision, writerId });
        const result = await uploadPayload({ name, json, fetchFn, headers });
        return { name, path: result.path, updatedAt: Date.now(), revision, writerId };
    });
}

export function cancelPendingNpcStateWrite(chatKey) {
    const key = String(chatKey || '');
    const job = durabilityQueue.get(key);
    if (!job) return false;
    job.cancelled = true;
    durabilityQueue.delete(key);
    return true;
}

export function pendingNpcStateDurabilityKeys() {
    return [...durabilityQueue.keys()];
}

export async function writeNpcStateDataFile({ chatKey, state, appVersion = '', pointer = null, operationKey = '', fetchFn = globalThis.fetch, headers = {}, sleepFn = globalThis.setTimeout }) {
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const key = String(chatKey || '');
    const durabilityKey = String(operationKey || key);
    if (durabilityQueue.has(durabilityKey)) {
        const error = new Error(`NPC State already has a durability retry in progress for ${durabilityKey}.`);
        error.code = 'NPC_STATE_WRITE_IN_PROGRESS';
        throw error;
    }
    let lastError = null;
    for (const delay of NPC_STATE_WRITE_RETRY_DELAYS_MS) {
        if (delay) await wait(delay, sleepFn);
        try {
            return await guardedWriteOnce({ chatKey: key, state, appVersion, pointer, fetchFn, headers });
        } catch (error) {
            lastError = error;
            if (!retryableWriteError(error)) throw error;
        }
    }
    const job = {
        chatKey: key,
        durabilityKey,
        state: structuredClone(state || {}),
        appVersion,
        pointer,
        fetchFn,
        headers,
        cancelled: false,
        attempt: 0,
        lastError,
    };
    durabilityQueue.set(durabilityKey, job);
    console.warn(`[NPC State] sidecar write for ${key} is still dirty after bounded retries; retaining the active write lock and retrying every ${NPC_STATE_DURABILITY_RETRY_CAP_MS / 1000}s until it is durable.`);
    try {
        while (!job.cancelled) {
            await wait(NPC_STATE_DURABILITY_RETRY_CAP_MS, sleepFn);
            if (job.cancelled) break;
            try {
                const written = await guardedWriteOnce(job);
                if (pointer && typeof pointer === 'object') Object.assign(pointer, written);
                console.info(`[NPC State] recovered a previously failed sidecar write for ${key} at revision ${written.revision}.`);
                return written;
            } catch (error) {
                job.lastError = error;
                job.attempt += 1;
                if (!retryableWriteError(error)) throw error;
            }
        }
        const error = new Error(`NPC State durability retry for ${key} was cancelled.`);
        error.code = 'NPC_STATE_WRITE_CANCELLED';
        throw error;
    } finally {
        if (durabilityQueue.get(durabilityKey) === job) durabilityQueue.delete(durabilityKey);
    }
}

export async function retireNpcStateDataFile({ chatKey, pointer = null, reason = 'retired', appVersion = '', fetchFn = globalThis.fetch, headers = {} }) {
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const key = String(chatKey || '');
    cancelPendingNpcStateWrite(key);
    return withWriterLock(key, async () => {
        const name = pointer?.name || makeNpcStateDataFileName(key);
        const expectedRevision = Number.isFinite(Number(pointer?.revision)) ? Math.max(0, Math.trunc(Number(pointer.revision))) : null;
        let current = { revision: expectedRevision ?? 0, exists: false };
        if (pointer?.path) current = await remoteRevision(pointer, key, fetchFn);
        if (expectedRevision === null && current.exists && current.revision > 0) {
            const error = new Error(`NPC State sidecar changed before retirement; this tab has no matching revision token (found revision ${current.revision}).`);
            error.code = 'NPC_STATE_WRITE_CONFLICT';
            error.expectedRevision = null;
            error.actualRevision = current.revision;
            throw error;
        }
        if (expectedRevision !== null && current.exists && current.revision !== expectedRevision) {
            const error = new Error(`NPC State sidecar changed before retirement (expected revision ${expectedRevision}, found ${current.revision}).`);
            error.code = 'NPC_STATE_WRITE_CONFLICT';
            error.expectedRevision = expectedRevision;
            error.actualRevision = current.revision;
            throw error;
        }
        const revision = Math.max(current.revision, expectedRevision ?? 0) + 1;
        const json = encodeRetiredStateFilePayload(key, reason, appVersion, { revision, writerId });
        const result = await uploadPayload({ name, json, fetchFn, headers });
        return { name, path: result.path, updatedAt: Date.now(), retired: true, revision, writerId };
    });
}

export async function readNpcStateDataFile(pointer, { fetchFn = globalThis.fetch, expectedChatKey = '' } = {}) {
    const pendingKey = String(expectedChatKey || '');
    const pending = pendingKey ? durabilityQueue.get(pendingKey) : null;
    if (pending && !pending.cancelled) {
        return {
            format: NPC_STATE_FILE_FORMAT,
            version: NPC_STATE_FILE_FORMAT_VERSION,
            appVersion: String(pending.appVersion || ''),
            chatKey: pendingKey,
            updatedAt: Date.now(),
            retired: false,
            reason: '',
            revision: Math.max(0, Math.trunc(Number(pointer?.revision) || 0)),
            writerId,
            state: structuredClone(pending.state || {}),
        };
    }
    if (!pointer?.path) return null;
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const response = await withReadSlot(() => fetchFn(pointer.path, { method: 'GET', cache: 'no-store' }));
    if (response?.status === 404) return null;
    if (!response?.ok) throw new Error(`NPC State data file read failed with HTTP ${response?.status || 'error'}.`);
    const text = typeof response.text === 'function' ? await response.text() : '';
    const payload = decodeStateFilePayload(text);
    if (expectedChatKey && String(payload.chatKey || '') !== String(expectedChatKey)) throw new Error('NPC State data file belongs to a different chat.');
    return payload;
}

export async function deleteNpcStateDataFile(pointer, { fetchFn = globalThis.fetch, headers = {} } = {}) {
    if (!pointer?.path) return false;
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const response = await fetchFn('/api/files/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: pointer.path }),
    });
    if (response?.status === 404) return false;
    if (!response?.ok) {
        const detail = typeof response?.text === 'function' ? await response.text() : '';
        throw new Error(`NPC State data file delete failed${detail ? `: ${detail}` : ''}.`);
    }
    return true;
}
