import { normalizeName, normalizeNpcRecord } from './core.js';
import { normalizeSocialGraph, remapSocialGraphNpcId } from './social.js';

const MAGIC = new Uint8Array([0x4e, 0x50, 0x43, 0x53, 0x54, 0x42, 0x30, 0x31]); // NPCSTB01
const HEADER_SIZE = 12;
const FORMAT_VERSION = 1;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('NPC State bundle must be binary data.');
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
}

function decodeBase64(text) {
    const clean = String(text || '').replace(/\s+/g, '');
    const binary = globalThis.atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
}

function encodeBase64(bytes) {
    const input = toUint8Array(bytes);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < input.length; i += chunk) {
        const slice = input.subarray(i, Math.min(i + chunk, input.length));
        let part = '';
        for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
        binary += part;
    }
    return globalThis.btoa(binary);
}

export function dataUrlToBinary(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
    if (!match) throw new Error('Portrait data is not a valid data URL.');
    const mime = match[1] || 'application/octet-stream';
    const bytes = match[2]
        ? decodeBase64(match[3])
        : new TextEncoder().encode(decodeURIComponent(match[3]));
    return { mime, bytes };
}

export function binaryToDataUrl(bytes, mime = 'application/octet-stream') {
    return `data:${mime};base64,${encodeBase64(bytes)}`;
}

function cloneRecordForManifest(npc, binaryOffsetRef, imageParts) {
    const record = structuredClone(npc);
    const portrait = record.portrait;
    if (!portrait?.dataUrl) {
        if (portrait) delete portrait.dataUrl;
        return record;
    }

    const parsed = dataUrlToBinary(portrait.dataUrl);
    delete portrait.dataUrl;
    portrait.mime = portrait.mime || parsed.mime;
    portrait.binary = {
        offset: binaryOffsetRef.value,
        length: parsed.bytes.length,
    };
    binaryOffsetRef.value += parsed.bytes.length;
    imageParts.push(parsed.bytes);
    return record;
}

export function encodeNpcStateBundle(state, { appVersion = 'unknown', chatKey = '' } = {}) {
    const source = state && typeof state === 'object' ? state : {};
    const imageParts = [];
    const binaryOffsetRef = { value: 0 };
    const npcs = Array.isArray(source.npcs)
        ? source.npcs.map(npc => cloneRecordForManifest(npc, binaryOffsetRef, imageParts))
        : [];

    const manifest = {
        format: 'npc_state_bundle',
        formatVersion: FORMAT_VERSION,
        appVersion: String(appVersion || 'unknown'),
        exportedAt: new Date().toISOString(),
        sourceChatKey: String(chatKey || ''),
        state: {
            npcs,
            socialGraph: normalizeSocialGraph(source.socialGraph),
            dismissed: Array.isArray(source.dismissed) ? [...source.dismissed] : [],
        },
    };

    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error('NPC State bundle manifest is too large.');

    const totalBytes = HEADER_SIZE + manifestBytes.length + binaryOffsetRef.value;
    if (totalBytes > MAX_BUNDLE_BYTES) throw new Error('NPC State bundle exceeds the 32 MB safety limit.');

    const output = new Uint8Array(totalBytes);
    output.set(MAGIC, 0);
    new DataView(output.buffer).setUint32(MAGIC.length, manifestBytes.length, true);
    output.set(manifestBytes, HEADER_SIZE);
    let cursor = HEADER_SIZE + manifestBytes.length;
    for (const part of imageParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    return output;
}

function validateManifest(manifest) {
    if (!manifest || manifest.format !== 'npc_state_bundle') throw new Error('Not an NPC State bundle.');
    if (manifest.formatVersion !== FORMAT_VERSION) throw new Error(`Unsupported NPC State bundle version: ${manifest.formatVersion}.`);
    if (!manifest.state || !Array.isArray(manifest.state.npcs)) throw new Error('NPC State bundle is missing its dossier registry.');
}

export function decodeNpcStateBundle(input) {
    const bytes = toUint8Array(input);
    if (bytes.length < HEADER_SIZE) throw new Error('NPC State bundle is truncated.');
    if (bytes.length > MAX_BUNDLE_BYTES) throw new Error('NPC State bundle exceeds the 32 MB safety limit.');
    if (!bytesEqual(bytes.subarray(0, MAGIC.length), MAGIC)) throw new Error('Invalid NPC State bundle signature.');

    const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
    if (!manifestLength || manifestLength > MAX_MANIFEST_BYTES) throw new Error('NPC State bundle has an invalid manifest length.');
    const manifestStart = HEADER_SIZE;
    const binaryStart = manifestStart + manifestLength;
    if (binaryStart > bytes.length) throw new Error('NPC State bundle manifest is truncated.');

    let manifest;
    try {
        manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(manifestStart, binaryStart)));
    } catch {
        throw new Error('NPC State bundle manifest is invalid JSON.');
    }
    validateManifest(manifest);

    const npcs = manifest.state.npcs.map(npc => {
        const record = structuredClone(npc);
        const bin = record.portrait?.binary;
        if (!bin) return record;
        const offset = Number(bin.offset);
        const length = Number(bin.length);
        if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) {
            throw new Error(`NPC State bundle has invalid portrait metadata for ${record.name || 'an NPC'}.`);
        }
        const start = binaryStart + offset;
        const end = start + length;
        if (end > bytes.length) throw new Error(`NPC State bundle portrait is truncated for ${record.name || 'an NPC'}.`);
        const mime = record.portrait.mime || 'application/octet-stream';
        record.portrait.dataUrl = binaryToDataUrl(bytes.subarray(start, end), mime);
        delete record.portrait.binary;
        return record;
    });

    return {
        metadata: {
            appVersion: manifest.appVersion || '',
            exportedAt: manifest.exportedAt || '',
            sourceChatKey: manifest.sourceChatKey || '',
            formatVersion: manifest.formatVersion,
        },
        state: {
            npcs,
            socialGraph: normalizeSocialGraph(manifest.state.socialGraph),
            dismissed: Array.isArray(manifest.state.dismissed) ? [...manifest.state.dismissed] : [],
        },
    };
}

function npcKeys(npc) {
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]
        .map(normalizeName)
        .filter(Boolean);
}

function sameNpc(a, b) {
    if (a?.id && b?.id && a.id === b.id) return true;
    const aKeys = new Set(npcKeys(a));
    return npcKeys(b).some(key => aKeys.has(key));
}

export function mergeImportedDossierState(currentState, importedState, { maxNpcs = 40, excludeNames = [] } = {}) {
    const current = currentState && typeof currentState === 'object' ? currentState : {};
    const incoming = importedState && typeof importedState === 'object' ? importedState : {};
    const existing = Array.isArray(current.npcs) ? current.npcs.map(normalizeNpcRecord) : [];
    const excluded = new Set((Array.isArray(excludeNames) ? excludeNames : []).map(normalizeName).filter(Boolean));
    const imported = (Array.isArray(incoming.npcs) ? incoming.npcs : []).map(normalizeNpcRecord)
        .filter(npc => !npcKeys(npc).some(key => excluded.has(key)));
    const usedExisting = new Set();
    const importedIdMap = new Map();
    const merged = [];

    for (const npc of imported) {
        const index = existing.findIndex((candidate, i) => !usedExisting.has(i) && sameNpc(candidate, npc));
        if (index >= 0) {
            usedExisting.add(index);
            const old = existing[index];
            importedIdMap.set(npc.id, old.id);
            merged.push({
                ...old,
                ...structuredClone(npc),
                id: old.id,
                aliases: [...new Set([...(old.aliases || []), ...(npc.aliases || []), ...(old.name !== npc.name ? [old.name] : [])])].filter(alias => normalizeName(alias) !== normalizeName(npc.name)).slice(0, 8),
                portrait: npc.portrait?.dataUrl ? structuredClone(npc.portrait) : old.portrait || npc.portrait || null,
            });
        } else {
            merged.push(structuredClone(npc));
        }
    }
    for (let i = 0; i < existing.length; i += 1) {
        if (!usedExisting.has(i)) merged.push(existing[i]);
    }

    const cap = Math.max(1, Math.min(100, Number(maxNpcs) || 40));
    const npcs = [];
    let activeCount = 0;
    for (const npc of merged) {
        if (npc?.archived) {
            npcs.push(npc);
            continue;
        }
        if (activeCount >= cap) continue;
        npcs.push(npc);
        activeCount += 1;
    }
    const activeNames = new Set(npcs.flatMap(npcKeys));
    const dismissed = [...new Set([
        ...(Array.isArray(current.dismissed) ? current.dismissed : []),
        ...(Array.isArray(incoming.dismissed) ? incoming.dismissed : []),
    ].map(normalizeName).filter(Boolean))].filter(name => !activeNames.has(name));

    let importedGraph = normalizeSocialGraph(incoming.socialGraph);
    for (const [fromId, toId] of importedIdMap.entries()) importedGraph = remapSocialGraphNpcId(importedGraph, fromId, toId);
    const currentGraph = normalizeSocialGraph(current.socialGraph);
    const socialGraph = normalizeSocialGraph({
        edges: [...currentGraph.edges, ...importedGraph.edges],
        unresolved: [...currentGraph.unresolved, ...importedGraph.unresolved],
    });

    return {
        ...current,
        npcs,
        socialGraph,
        dismissed,
        processedOocMessageId: null,
        lastScannedMessageId: null,
        assistantSinceScan: 0,
    };
}
