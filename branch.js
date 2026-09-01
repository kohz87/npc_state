import { normalizeName } from './core.js';

export const BRANCH_HISTORY_LIMIT = 160;

function fnv1a(text) {
    let hash = 0x811c9dc5;
    const input = String(text ?? '');
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

export function fingerprintMessage(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
        swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : null,
    });
    return fnv1a(payload);
}

export function chatLineage(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(fingerprintMessage);
}

export function firstLineageDivergence(previous = [], current = []) {
    const a = Array.isArray(previous) ? previous : [];
    const b = Array.isArray(current) ? current : [];
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i += 1) {
        if (a[i] !== b[i]) return i;
    }
    return a.length === b.length ? -1 : common;
}

export function commonPrefixLength(a = [], b = []) {
    const divergence = firstLineageDivergence(a, b);
    return divergence < 0 ? Math.min(a.length, b.length) : divergence;
}

function cloneNpcList(npcs) {
    return Array.isArray(npcs) ? structuredClone(npcs) : [];
}

function cloneNarrativeNpcs(npcs) {
    return cloneNpcList(npcs).map(npc => ({ ...npc, portrait: null }));
}

export function snapshotBranchState(state = {}) {
    return {
        npcs: cloneNarrativeNpcs(state.npcs),
        candidates: Array.isArray(state.candidates) ? structuredClone(state.candidates) : [],
        pendingBackfills: Array.isArray(state.pendingBackfills) ? structuredClone(state.pendingBackfills) : [],
        dismissed: Array.isArray(state.dismissed) ? [...state.dismissed] : [],
        turn: Number(state.turn || 0),
        assistantSinceScan: Number(state.assistantSinceScan || 0),
        lastScanAt: Number(state.lastScanAt || 0),
        lastScannedMessageId: Number.isInteger(state.lastScannedMessageId) ? state.lastScannedMessageId : null,
        scanCount: Number(state.scanCount || 0),
        processedOocMessageId: Number.isInteger(state.processedOocMessageId) ? state.processedOocMessageId : null,
    };
}

export function restoreSnapshotIntoState(current = {}, snapshot = null) {
    if (!snapshot) return { ...current };
    return {
        ...current,
        npcs: cloneNpcList(snapshot.npcs),
        candidates: Array.isArray(snapshot.candidates) ? structuredClone(snapshot.candidates) : [],
        pendingBackfills: Array.isArray(snapshot.pendingBackfills) ? structuredClone(snapshot.pendingBackfills) : [],
        dismissed: Array.isArray(snapshot.dismissed) ? [...snapshot.dismissed] : [],
        turn: Number(snapshot.turn || 0),
        assistantSinceScan: Number(snapshot.assistantSinceScan || 0),
        lastScanAt: Number(snapshot.lastScanAt || 0),
        lastScannedMessageId: Number.isInteger(snapshot.lastScannedMessageId) ? snapshot.lastScannedMessageId : null,
        scanCount: Number(snapshot.scanCount || 0),
        processedOocMessageId: Number.isInteger(snapshot.processedOocMessageId) ? snapshot.processedOocMessageId : null,
    };
}

export function recordBranchCheckpoint(state, chat, messageId, reason = 'state', limit = BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length) return state;
    if (!Array.isArray(state.checkpoints)) state.checkpoints = [];
    const checkpoint = {
        messageId,
        fingerprint: lineage[messageId],
        reason: String(reason || 'state'),
        createdAt: Date.now(),
        snapshot: snapshotBranchState(state),
    };
    const existingIndex = state.checkpoints.findIndex(item => item.messageId === messageId);
    if (existingIndex >= 0) state.checkpoints[existingIndex] = checkpoint;
    else state.checkpoints.push(checkpoint);
    state.checkpoints.sort((a, b) => a.messageId - b.messageId);
    const cap = Math.max(8, Number(limit) || BRANCH_HISTORY_LIMIT);
    if (state.checkpoints.length > cap) state.checkpoints.splice(0, state.checkpoints.length - cap);
    return state;
}

function npcLabels(npc) {
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]
        .map(normalizeName)
        .filter(Boolean);
}

function sameNpc(a, b) {
    if (a?.id && b?.id && a.id === b.id) return true;
    const labels = new Set(npcLabels(a));
    return npcLabels(b).some(label => labels.has(label));
}

export function preservePortraitAssets(restoredNpcs = [], currentNpcs = []) {
    const restored = cloneNpcList(restoredNpcs);
    for (const npc of restored) {
        const current = (currentNpcs || []).find(candidate => sameNpc(npc, candidate));
        if (current?.portrait?.dataUrl) npc.portrait = structuredClone(current.portrait);
    }
    return restored;
}

export function reconcileBranchState(state, chat, { explicitDivergence = null } = {}) {
    const currentLineage = chatLineage(chat);
    const previousLineage = Array.isArray(state?.lineage) ? state.lineage : [];
    let divergence = firstLineageDivergence(previousLineage, currentLineage);
    if (Number.isInteger(explicitDivergence) && explicitDivergence >= 0) {
        divergence = divergence < 0 ? explicitDivergence : Math.min(divergence, explicitDivergence);
    }

    if (divergence < 0) {
        return { state: { ...state, lineage: currentLineage }, divergence: -1, restoredFromMessageId: null, invalidated: false };
    }

    const currentNpcs = cloneNpcList(state?.npcs);
    const checkpoints = Array.isArray(state?.checkpoints) ? state.checkpoints : [];
    const validBeforeDivergence = checkpoints.filter(checkpoint => {
        if (!Number.isInteger(checkpoint?.messageId) || checkpoint.messageId >= divergence) return false;
        return currentLineage[checkpoint.messageId] && currentLineage[checkpoint.messageId] === checkpoint.fingerprint;
    });
    const checkpoint = validBeforeDivergence.at(-1) || null;

    // Old v0.1.4 state has no checkpoints. Preserve its live registry rather than destructively
    // zeroing it, then future checkpoints make rewinds exact from this version onward.
    let restored = checkpoint
        ? restoreSnapshotIntoState(state, checkpoint.snapshot)
        : { ...state, processedOocMessageId: null, lastScannedMessageId: null, assistantSinceScan: 0 };

    if (checkpoint) restored.npcs = preservePortraitAssets(restored.npcs, currentNpcs);
    restored.lineage = currentLineage;
    restored.checkpoints = validBeforeDivergence;
    restored.inlineCards = (Array.isArray(state?.inlineCards) ? state.inlineCards : [])
        .filter(entry => Number.isInteger(entry?.messageId) && entry.messageId < divergence && entry.messageId < currentLineage.length)
        .filter(entry => !entry.fingerprint || entry.fingerprint === currentLineage[entry.messageId]);

    if (Number.isInteger(restored.lastScannedMessageId) && restored.lastScannedMessageId >= divergence) restored.lastScannedMessageId = null;
    if (Number.isInteger(restored.processedOocMessageId) && restored.processedOocMessageId >= divergence) restored.processedOocMessageId = null;

    return {
        state: restored,
        divergence,
        restoredFromMessageId: checkpoint?.messageId ?? null,
        invalidated: true,
        legacyFallback: !checkpoint && checkpoints.length === 0,
    };
}

export function bestAncestorState(chats = {}, currentKey = '', currentChat = []) {
    const lineage = chatLineage(currentChat);
    let best = null;
    for (const [key, state] of Object.entries(chats || {})) {
        if (key === currentKey || !state || !Array.isArray(state.lineage) || !Array.isArray(state.checkpoints)) continue;
        const prefixLength = commonPrefixLength(state.lineage, lineage);
        if (prefixLength < 2) continue;
        const checkpoint = state.checkpoints.filter(item => item.messageId < prefixLength).at(-1);
        if (!checkpoint) continue;
        if (!best || checkpoint.messageId > best.checkpoint.messageId) best = { key, state, checkpoint, prefixLength };
    }
    if (!best) return null;
    const inherited = restoreSnapshotIntoState({}, best.checkpoint.snapshot);
    inherited.lineage = lineage;
    inherited.checkpoints = structuredClone(best.state.checkpoints.filter(item => item.messageId <= best.checkpoint.messageId));
    inherited.inlineCards = structuredClone((best.state.inlineCards || []).filter(item => item.messageId <= best.checkpoint.messageId));
    inherited.portraitAssets = structuredClone(best.state.portraitAssets || {});
    inherited.branchParent = best.key;
    inherited.branchForkMessageId = best.checkpoint.messageId;
    return inherited;
}
