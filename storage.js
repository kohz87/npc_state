export const NPC_STATE_FILE_FORMAT = 'npc_state_chat_data';
export const NPC_STATE_FILE_FORMAT_VERSION = 1;

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
    // Two independent 32-bit fingerprints make accidental filename aliasing dramatically less
    // likely than the legacy single-hash name. Existing stored pointers remain valid.
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

function compactStateForFile(state) {
    const snapshot = structuredClone(state || {});
    snapshot.portraitAssets = snapshot.portraitAssets && typeof snapshot.portraitAssets === 'object'
        ? snapshot.portraitAssets
        : {};
    for (const npc of Array.isArray(snapshot.npcs) ? snapshot.npcs : []) {
        if (!npc?.id) continue;
        if (npc.portrait?.dataUrl) {
            // The live NPC record is authoritative if an old asset-table copy disagrees.
            snapshot.portraitAssets[npc.id] = structuredClone(npc.portrait);
        }
        // portraitAssets is the single persisted source of binary/base64 portrait data.
        // Runtime normalization hydrates npc.portrait again after loading.
        if (snapshot.portraitAssets[npc.id]?.dataUrl) npc.portrait = null;
    }
    return snapshot;
}

export function encodeStateFilePayload(chatKey, state, appVersion = '') {
    const payload = {
        format: NPC_STATE_FILE_FORMAT,
        formatVersion: NPC_STATE_FILE_FORMAT_VERSION,
        appVersion: String(appVersion || ''),
        chatKey: String(chatKey || ''),
        updatedAt: new Date().toISOString(),
        state: compactStateForFile(state),
    };
    return JSON.stringify(payload, null, 2);
}

export function encodeRetiredStateFilePayload(chatKey, reason = 'retired', appVersion = '') {
    return JSON.stringify({
        format: NPC_STATE_FILE_FORMAT,
        formatVersion: NPC_STATE_FILE_FORMAT_VERSION,
        appVersion: String(appVersion || ''),
        chatKey: String(chatKey || ''),
        updatedAt: new Date().toISOString(),
        retired: true,
        retiredAt: new Date().toISOString(),
        retireReason: String(reason || 'retired').slice(0, 120),
        state: {},
    }, null, 2);
}

export function decodeStateFilePayload(text) {
    let payload;
    try {
        payload = JSON.parse(String(text ?? ''));
    } catch {
        throw new Error('NPC State data file contains invalid JSON.');
    }
    if (!payload || payload.format !== NPC_STATE_FILE_FORMAT) throw new Error('Not an NPC State chat data file.');
    if (payload.formatVersion !== NPC_STATE_FILE_FORMAT_VERSION) {
        throw new Error(`Unsupported NPC State data file version: ${payload.formatVersion}.`);
    }
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
        throw new Error('NPC State data file is missing its state object.');
    }
    payload.retired = payload.retired === true;
    return payload;
}

export async function writeNpcStateDataFile({ chatKey, state, appVersion = '', pointer = null, fetchFn = globalThis.fetch, headers = {} }) {
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const name = pointer?.name || makeNpcStateDataFileName(chatKey);
    const json = encodeStateFilePayload(chatKey, state, appVersion);
    const data = bytesToBase64(new TextEncoder().encode(json));
    const response = await fetchFn('/api/files/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, data }),
    });
    if (!response?.ok) {
        const detail = typeof response?.text === 'function' ? await response.text() : '';
        throw new Error(`NPC State data file write failed${detail ? `: ${detail}` : ''}.`);
    }
    const result = typeof response.json === 'function' ? await response.json() : {};
    if (!result?.path) throw new Error('NPC State data-file endpoint returned no path.');
    return { name, path: result.path, updatedAt: Date.now() };
}

export async function retireNpcStateDataFile({ chatKey, pointer = null, reason = 'retired', appVersion = '', fetchFn = globalThis.fetch, headers = {} }) {
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const name = pointer?.name || makeNpcStateDataFileName(chatKey);
    const json = encodeRetiredStateFilePayload(chatKey, reason, appVersion);
    const data = bytesToBase64(new TextEncoder().encode(json));
    const response = await fetchFn('/api/files/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, data }),
    });
    if (!response?.ok) {
        const detail = typeof response?.text === 'function' ? await response.text() : '';
        throw new Error(`NPC State data file retirement failed${detail ? `: ${detail}` : ''}.`);
    }
    const result = typeof response.json === 'function' ? await response.json() : {};
    if (!result?.path) throw new Error('NPC State data-file endpoint returned no path while retiring a sidecar.');
    return { name, path: result.path, updatedAt: Date.now(), retired: true };
}

export async function readNpcStateDataFile(pointer, { fetchFn = globalThis.fetch, expectedChatKey = '' } = {}) {
    if (!pointer?.path) return null;
    if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for NPC State data-file persistence.');
    const response = await fetchFn(pointer.path, { method: 'GET', cache: 'no-store' });
    if (response?.status === 404) return null;
    if (!response?.ok) throw new Error(`NPC State data file read failed with HTTP ${response?.status || 'error'}.`);
    const text = typeof response.text === 'function' ? await response.text() : '';
    const payload = decodeStateFilePayload(text);
    if (expectedChatKey && String(payload.chatKey || '') !== String(expectedChatKey)) {
        throw new Error('NPC State data file belongs to a different chat.');
    }
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
