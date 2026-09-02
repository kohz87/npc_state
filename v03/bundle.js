import {
    NPC_STATE_SCHEMA_VERSION,
    NPC_STATE_VERSION,
    normalizeName,
    normalizeNpc,
    normalizeState,
} from './schema.js';

export const NPC_STATE_BUNDLE_FORMAT = 'npc_state_v3_bundle';
export const NPC_STATE_BUNDLE_VERSION = 1;
export const BUNDLE_TYPES = Object.freeze(['full-chat', 'npc']);
export const BUNDLE_IMPORT_MODES = Object.freeze(['merge', 'replace']);
export const BUNDLE_MATCH_POLICIES = Object.freeze(['keep', 'replace']);
export const BUNDLE_CONFLICT_POLICIES = Object.freeze(['abort', 'skip']);

const REQUIRED_DATA_ARRAYS = Object.freeze(['npcs', 'socialGraph', 'suppressedNames', 'deletedNpcIds']);

function text(value, max = 500) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueStrings(value, max = 500) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
        const clean = text(raw, 160);
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out;
}

function normalizeBundleType(value) {
    const type = String(value || '');
    if (!BUNDLE_TYPES.includes(type)) throw new Error(`Unsupported NPC State bundle type: ${type || 'missing'}.`);
    return type;
}

function normalizeImportOptions(options = {}) {
    const mode = BUNDLE_IMPORT_MODES.includes(String(options.mode)) ? String(options.mode) : 'merge';
    const matchPolicy = BUNDLE_MATCH_POLICIES.includes(String(options.matchPolicy)) ? String(options.matchPolicy) : 'keep';
    const conflictPolicy = BUNDLE_CONFLICT_POLICIES.includes(String(options.conflictPolicy)) ? String(options.conflictPolicy) : 'abort';
    return {
        mode,
        matchPolicy,
        conflictPolicy,
        currentNarrativeTurn: Math.max(0, Math.trunc(Number(options.currentNarrativeTurn) || 0)),
    };
}

function normalizeBundleNpc(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Bundle contains an invalid NPC dossier entry.');
    const id = text(raw.id, 160);
    const name = text(raw.name, 120);
    if (!id) throw new Error('Every imported v0.3 dossier must contain its stable NPC id.');
    if (!name) throw new Error(`Imported dossier ${id} is missing its canonical name.`);
    return normalizeNpc({ ...structuredClone(raw), id, name });
}

function validateIdentitySet(npcs = []) {
    const byId = new Map();
    const byName = new Map();
    for (const npc of npcs) {
        if (byId.has(npc.id)) throw new Error(`Bundle contains duplicate stable NPC id ${npc.id}.`);
        byId.set(npc.id, npc);
        const key = normalizeName(npc.name);
        if (key && byName.has(key)) throw new Error(`Bundle contains two dossiers with the canonical name ${npc.name}.`);
        if (key) byName.set(key, npc);
    }
}

function requireDataArrays(raw) {
    for (const key of REQUIRED_DATA_ARRAYS) {
        if (!Array.isArray(raw?.[key])) throw new Error(`NPC State bundle data.${key} must be an array.`);
    }
}

function normalizeBundleData(raw = {}, type = 'full-chat') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('NPC State bundle data must be an object.');
    requireDataArrays(raw);
    const npcs = raw.npcs.map(normalizeBundleNpc);
    if (type === 'npc' && npcs.length !== 1) throw new Error('A selected-NPC bundle must contain exactly one dossier.');
    validateIdentitySet(npcs);

    const normalized = normalizeState({
        npcs,
        socialGraph: raw.socialGraph,
        suppressedNames: raw.suppressedNames,
        deletedNpcIds: raw.deletedNpcIds,
    }, 'bundle');
    const deletedNpcIds = uniqueStrings(normalized.deletedNpcIds, 500);
    const npcIds = new Set(npcs.map(npc => npc.id));
    for (const id of deletedNpcIds) {
        if (npcIds.has(id)) throw new Error(`Bundle marks stable NPC id ${id} as both live and deleted.`);
    }
    return {
        npcs,
        socialGraph: normalized.socialGraph,
        suppressedNames: type === 'full-chat' ? normalized.suppressedNames : [],
        deletedNpcIds: type === 'full-chat' ? deletedNpcIds : [],
    };
}

function sourceMetadata(state, options = {}) {
    const narrativeTurn = Math.max(0, Math.trunc(Number(options.sourceNarrativeTurn) || 0));
    return {
        chatKey: text(state?.chatKey, 500),
        narrativeTurn,
        exportedAt: Date.now(),
    };
}

function exportedSocialGraph(state, ids, selectedOnly = false) {
    const idSet = new Set(ids);
    return (state.socialGraph || []).filter(edge => {
        if (selectedOnly) return idSet.has(edge.fromId) || idSet.has(edge.toId);
        return idSet.has(edge.fromId) && idSet.has(edge.toId);
    }).map(edge => structuredClone(edge));
}

export function createNpcStateBundle(stateInput = {}, options = {}) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const selectedId = text(options.npcId, 160);
    const type = selectedId ? 'npc' : 'full-chat';
    const selected = selectedId ? state.npcs.find(npc => npc.id === selectedId) : null;
    if (selectedId && !selected) throw new Error(`Cannot export unknown NPC id ${selectedId}.`);
    const npcs = selected ? [structuredClone(selected)] : state.npcs.map(npc => structuredClone(npc));
    const ids = npcs.map(npc => npc.id);
    return {
        format: NPC_STATE_BUNDLE_FORMAT,
        formatVersion: NPC_STATE_BUNDLE_VERSION,
        appVersion: NPC_STATE_VERSION,
        schemaVersion: NPC_STATE_SCHEMA_VERSION,
        bundleType: type,
        source: sourceMetadata(state, options),
        data: {
            npcs,
            socialGraph: exportedSocialGraph(state, ids, type === 'npc'),
            suppressedNames: type === 'full-chat' ? structuredClone(state.suppressedNames || []) : [],
            deletedNpcIds: type === 'full-chat' ? structuredClone(state.deletedNpcIds || []) : [],
        },
    };
}

export function parseNpcStateBundle(input) {
    let raw = input;
    if (typeof input === 'string') {
        const source = input.trim();
        if (!source) throw new Error('NPC State bundle file is empty.');
        try { raw = JSON.parse(source); }
        catch (error) { throw new Error(`NPC State bundle is not valid JSON: ${error.message}`); }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('NPC State bundle root must be a JSON object.');
    if (raw.format !== NPC_STATE_BUNDLE_FORMAT) throw new Error(`Unsupported bundle format ${text(raw.format, 120) || 'missing'}.`);
    if (Number(raw.formatVersion) !== NPC_STATE_BUNDLE_VERSION) throw new Error(`Unsupported NPC State bundle format version ${raw.formatVersion}.`);
    if (Number(raw.schemaVersion) !== NPC_STATE_SCHEMA_VERSION) throw new Error(`Bundle schema ${raw.schemaVersion} is not compatible with v0.3 schema ${NPC_STATE_SCHEMA_VERSION}.`);
    if (!/^0\.3(?:\.|$)/.test(String(raw.appVersion || ''))) throw new Error(`Bundle app version ${text(raw.appVersion, 80) || 'missing'} is not a v0.3 bundle.`);
    const bundleType = normalizeBundleType(raw.bundleType);
    const source = raw.source && typeof raw.source === 'object' && !Array.isArray(raw.source) ? raw.source : {};
    return {
        format: NPC_STATE_BUNDLE_FORMAT,
        formatVersion: NPC_STATE_BUNDLE_VERSION,
        appVersion: String(raw.appVersion),
        schemaVersion: NPC_STATE_SCHEMA_VERSION,
        bundleType,
        source: {
            chatKey: text(source.chatKey, 500),
            narrativeTurn: Math.max(0, Math.trunc(Number(source.narrativeTurn) || 0)),
            exportedAt: Math.max(0, Number(source.exportedAt) || 0),
        },
        data: normalizeBundleData(raw.data, bundleType),
    };
}

function conflict(type, npcId, importedName, existingName = '', detail = '') {
    return { type, npcId, importedName, existingName, detail };
}

export function previewNpcStateBundleImport(stateInput = {}, bundleInput, options = {}) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const bundle = parseNpcStateBundle(bundleInput);
    const normalizedOptions = normalizeImportOptions(options);
    if (normalizedOptions.mode === 'replace' && bundle.bundleType !== 'full-chat') {
        return { ok: false, reason: 'replace-requires-full-chat', bundle, options: normalizedOptions, conflicts: [], matches: [], newNpcIds: [] };
    }
    const existingById = new Map(state.npcs.map(npc => [npc.id, npc]));
    const existingByName = new Map(state.npcs.map(npc => [normalizeName(npc.name), npc]).filter(([key]) => key));
    const localTombstones = new Set(state.deletedNpcIds || []);
    const importedTombstones = new Set(bundle.data.deletedNpcIds || []);
    const conflicts = [];
    const matches = [];
    const newNpcIds = [];

    if (normalizedOptions.mode === 'merge') {
        for (const incoming of bundle.data.npcs) {
            const sameId = existingById.get(incoming.id) || null;
            const sameName = existingByName.get(normalizeName(incoming.name)) || null;
            if (localTombstones.has(incoming.id)) {
                conflicts.push(conflict('local-tombstone', incoming.id, incoming.name, '', 'Local manual deletion tombstone blocks resurrection during merge.'));
                continue;
            }
            if (sameId) {
                if (normalizeName(sameId.name) !== normalizeName(incoming.name)) conflicts.push(conflict('stable-id-identity', incoming.id, incoming.name, sameId.name, 'The same stable id points at different canonical identities.'));
                else matches.push(incoming.id);
                continue;
            }
            if (sameName && sameName.id !== incoming.id) {
                conflicts.push(conflict('canonical-name-id', incoming.id, incoming.name, sameName.name, `Canonical name already belongs to stable id ${sameName.id}.`));
                continue;
            }
            newNpcIds.push(incoming.id);
        }
        for (const id of importedTombstones) {
            const existing = existingById.get(id);
            if (existing) conflicts.push(conflict('imported-tombstone-live', id, '', existing.name, 'Imported tombstone would delete a live local dossier during merge.'));
        }
    }

    const shouldAbort = normalizedOptions.mode === 'merge' && normalizedOptions.conflictPolicy === 'abort' && conflicts.length > 0;
    return {
        ok: !shouldAbort,
        reason: shouldAbort ? 'identity-conflict' : '',
        bundle,
        options: normalizedOptions,
        conflicts,
        matches,
        newNpcIds,
        incomingNpcCount: bundle.data.npcs.length,
        incomingSocialEdgeCount: bundle.data.socialGraph.length,
        incomingTombstoneCount: bundle.data.deletedNpcIds.length,
    };
}

function clearCrossChatReferences(npc) {
    const next = structuredClone(npc);
    next.firstSeenMessageId = null;
    next.lastSeenMessageId = null;
    next.lastInteractionMessageId = null;
    next.lastActivityMessageId = null;
    if (next.lastRelationshipChange) {
        next.lastRelationshipChange.sourceMessageId = null;
        next.lastRelationshipChange.turn = null;
    }
    next.relationshipHistory = (next.relationshipHistory || []).map(event => ({ ...event, sourceMessageId: null, turn: null }));
    return next;
}

function rebaseActivityForCrossChat(npc, sourceTurn, currentTurn) {
    const next = structuredClone(npc);
    if (Number.isInteger(next.lastActivityTurn)) {
        const inactiveAge = Math.max(0, sourceTurn - next.lastActivityTurn);
        next.lastActivityTurn = Math.max(0, currentTurn - inactiveAge);
    } else {
        next.lastActivityTurn = currentTurn;
    }
    next.lastActivityMessageId = null;
    next.lastActivityReason = next.lastActivityReason || 'bundle-import';
    return next;
}

function prepareImportedNpc(npc, bundle, targetState, currentTurn) {
    const sameChat = Boolean(bundle.source.chatKey && targetState.chatKey && bundle.source.chatKey === targetState.chatKey);
    let next = normalizeNpc(npc);
    if (!sameChat) {
        next = rebaseActivityForCrossChat(next, bundle.source.narrativeTurn, currentTurn);
        next = clearCrossChatReferences(next);
    }
    next.present = false;
    next.worldActive = false;
    next.updatedAt = Math.max(Date.now(), Number(next.updatedAt || 0));
    return normalizeNpc(next);
}

function prepareEdge(edge, sameChat) {
    const next = structuredClone(edge);
    if (!sameChat) next.sourceMessageId = null;
    return next;
}

function edgeKey(edge) {
    return `${String(edge.fromId || '')}\0${String(edge.toId || '')}\0${normalizeName(edge.relation)}`;
}

function importedEdgeAllowed(edge, validIds, tombstones, blockedImportedIds) {
    return validIds.has(edge.fromId)
        && validIds.has(edge.toId)
        && !tombstones.has(edge.fromId)
        && !tombstones.has(edge.toId)
        && !blockedImportedIds.has(edge.fromId)
        && !blockedImportedIds.has(edge.toId);
}

function mergedEdges(baseEdges, importedEdges, validIds, tombstones, sameChat, blockedImportedIds = new Set()) {
    const map = new Map();
    for (const raw of baseEdges) {
        const edge = prepareEdge(raw, true);
        if (!validIds.has(edge.fromId) || !validIds.has(edge.toId)) continue;
        if (tombstones.has(edge.fromId) || tombstones.has(edge.toId)) continue;
        map.set(edgeKey(edge), edge);
    }
    for (const raw of importedEdges) {
        const edge = prepareEdge(raw, sameChat);
        if (!importedEdgeAllowed(edge, validIds, tombstones, blockedImportedIds)) continue;
        map.set(edgeKey(edge), edge);
    }
    return [...map.values()].slice(-200);
}

function countDroppedImportedEdges(importedEdges, validIds, tombstones, blockedImportedIds) {
    return importedEdges.reduce((count, edge) => count + (importedEdgeAllowed(edge, validIds, tombstones, blockedImportedIds) ? 0 : 1), 0);
}

function emptyObservation() {
    return { messageId: null, exchangeActiveNpcIds: [], finalPresentNpcIds: [], worldActiveNpcIds: [], targetNpcIds: [] };
}

export function applyNpcStateBundleImport(stateInput = {}, bundleInput, options = {}) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const preview = previewNpcStateBundleImport(state, bundleInput, options);
    if (preview.options.mode === 'replace' && preview.bundle.bundleType !== 'full-chat') return { ok: false, reason: 'replace-requires-full-chat', preview, state };
    if (!preview.ok) return { ok: false, reason: preview.reason, preview, state };
    const bundle = preview.bundle;
    const currentTurn = preview.options.currentNarrativeTurn;
    const sameChat = Boolean(bundle.source.chatKey && state.chatKey && bundle.source.chatKey === state.chatKey);

    if (preview.options.mode === 'replace') {
        const tombstones = new Set(bundle.data.deletedNpcIds);
        const npcs = bundle.data.npcs
            .filter(npc => !tombstones.has(npc.id))
            .map(npc => prepareImportedNpc(npc, bundle, state, currentTurn));
        const validIds = new Set(npcs.map(npc => npc.id));
        const socialGraph = mergedEdges([], bundle.data.socialGraph, validIds, tombstones, sameChat);
        const next = normalizeState({
            ...state,
            npcs,
            socialGraph,
            suppressedNames: bundle.data.suppressedNames,
            deletedNpcIds: [...tombstones],
            lastObservation: emptyObservation(),
            lastScannedMessageId: null,
        }, state.chatKey);
        return {
            ok: true,
            mode: 'replace',
            preview,
            state: next,
            result: {
                importedNpcIds: npcs.map(npc => npc.id),
                replacedNpcIds: [],
                skippedNpcIds: [],
                importedTombstones: [...tombstones],
                droppedSocialEdges: countDroppedImportedEdges(bundle.data.socialGraph, validIds, tombstones, new Set()),
            },
        };
    }

    const conflictIds = new Set(preview.conflicts.map(item => item.npcId).filter(Boolean));
    const skippedNpcIds = preview.options.conflictPolicy === 'skip' ? new Set(conflictIds) : new Set();
    const currentById = new Map(state.npcs.map(npc => [npc.id, npc]));
    const importedById = new Map(bundle.data.npcs.map(npc => [npc.id, npc]));
    const localTombstones = new Set(state.deletedNpcIds || []);
    const importedTombstones = new Set(bundle.data.deletedNpcIds || []);
    const ignoredImportedTombstones = new Set();
    if (preview.options.conflictPolicy === 'skip') {
        for (const item of preview.conflicts) {
            if (item.type === 'imported-tombstone-live') ignoredImportedTombstones.add(item.npcId);
        }
    }

    const nextNpcs = [];
    const importedNpcIds = [];
    const replacedNpcIds = [];
    for (const existing of state.npcs) {
        const incoming = importedById.get(existing.id);
        if (!incoming || skippedNpcIds.has(existing.id) || preview.options.matchPolicy === 'keep') {
            nextNpcs.push(existing);
            continue;
        }
        let prepared = prepareImportedNpc(incoming, bundle, state, currentTurn);
        prepared.present = existing.present;
        prepared.worldActive = existing.worldActive;
        prepared.lastActivityTurn = existing.lastActivityTurn;
        prepared.lastActivityMessageId = existing.lastActivityMessageId;
        prepared.lastActivityReason = existing.lastActivityReason;
        nextNpcs.push(normalizeNpc(prepared));
        importedNpcIds.push(existing.id);
        replacedNpcIds.push(existing.id);
    }
    for (const incoming of bundle.data.npcs) {
        if (currentById.has(incoming.id) || skippedNpcIds.has(incoming.id) || localTombstones.has(incoming.id)) continue;
        nextNpcs.push(prepareImportedNpc(incoming, bundle, state, currentTurn));
        importedNpcIds.push(incoming.id);
    }

    const tombstones = new Set(localTombstones);
    for (const id of importedTombstones) {
        if (!ignoredImportedTombstones.has(id) && !currentById.has(id)) tombstones.add(id);
    }
    const validIds = new Set(nextNpcs.map(npc => npc.id));
    const socialGraph = mergedEdges(state.socialGraph || [], bundle.data.socialGraph, validIds, tombstones, sameChat, skippedNpcIds);
    const suppressedNames = [...new Set([...(state.suppressedNames || []), ...bundle.data.suppressedNames])].slice(0, 300);
    const next = normalizeState({
        ...state,
        npcs: nextNpcs,
        socialGraph,
        suppressedNames,
        deletedNpcIds: [...tombstones],
    }, state.chatKey);
    return {
        ok: true,
        mode: 'merge',
        preview,
        state: next,
        result: {
            importedNpcIds,
            replacedNpcIds,
            skippedNpcIds: [...skippedNpcIds],
            importedTombstones: [...importedTombstones].filter(id => !ignoredImportedTombstones.has(id) && !currentById.has(id)),
            droppedSocialEdges: countDroppedImportedEdges(bundle.data.socialGraph, validIds, tombstones, skippedNpcIds),
        },
    };
}

export function bundleSuggestedFilename(bundleInput) {
    const bundle = parseNpcStateBundle(bundleInput);
    const stamp = new Date(bundle.source.exportedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
    if (bundle.bundleType === 'npc') {
        const npc = bundle.data.npcs[0];
        const slug = String(npc?.name || 'npc').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || 'npc';
        return `npc-state-v3-${slug}-${stamp}.json`;
    }
    return `npc-state-v3-chat-backup-${stamp}.json`;
}
