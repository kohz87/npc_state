import { CHECKPOINT_LIMIT, normalizeState, snapshotForCheckpoint } from './schema.js';

function fnv1a(value) {
    let hash = 2166136261;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function fingerprintMessage(message = {}) {
    const role = message.is_system ? 's' : (message.is_user ? 'u' : 'a');
    const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : '';
    return `${role}:${swipe}:${fnv1a(String(message.mes ?? ''))}`;
}

export function chatLineage(chat = [], throughMessageId = null) {
    const last = Number.isInteger(throughMessageId) ? Math.min(throughMessageId, chat.length - 1) : chat.length - 1;
    const out = [];
    for (let i = 0; i <= last; i += 1) out.push(fingerprintMessage(chat[i] || {}));
    return out;
}

export function lineageIsPrefix(prefix = [], current = []) {
    if (prefix.length > current.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (prefix[i] !== current[i]) return false;
    return true;
}

export function branchDivergenceKind(state = {}, chat = []) {
    const currentLineage = chatLineage(chat);
    const previousLineage = Array.isArray(state?.branchHeadLineage) ? state.branchHeadLineage : [];
    return lineageIsPrefix(currentLineage, previousLineage) ? 'prebaseline-truncation' : 'prebaseline-rewrite';
}

function narrativeTurnFromLineage(lineage = []) {
    return (Array.isArray(lineage) ? lineage : []).reduce((count, value) => count + (String(value || '').startsWith('a:') ? 1 : 0), 0);
}

function latestKnownNarrativeTurn(state = {}) {
    const turns = [narrativeTurnFromLineage(state?.branchHeadLineage || []), narrativeTurnFromLineage(state?.branchBase?.lineage || [])];
    for (const checkpoint of state?.checkpoints || []) turns.push(narrativeTurnFromLineage(checkpoint?.lineage || []));
    return Math.max(0, ...turns);
}

export function rebaseToCurrentChat(state, chat = []) {
    const source = normalizeState(state, state?.chatKey || '');
    const currentLineage = chatLineage(chat);
    const currentTurn = narrativeTurnFromLineage(currentLineage);
    const sourceTurn = latestKnownNarrativeTurn(source);
    const next = normalizeState(source, source.chatKey);

    next.npcs = next.npcs.map(npc => {
        const rebased = structuredClone(npc);
        rebased.present = false;
        rebased.worldActive = false;
        rebased.firstSeenMessageId = null;
        rebased.lastSeenMessageId = null;
        rebased.lastInteractionMessageId = null;
        rebased.lastActivityMessageId = null;
        if (Number.isInteger(rebased.lastActivityTurn)) {
            const inactiveAge = Math.max(0, sourceTurn - rebased.lastActivityTurn);
            rebased.lastActivityTurn = Math.max(0, currentTurn - inactiveAge);
        } else {
            rebased.lastActivityTurn = currentTurn;
        }
        if (rebased.lastRelationshipChange) rebased.lastRelationshipChange = { ...rebased.lastRelationshipChange, sourceMessageId: null, turn: null };
        rebased.relationshipHistory = (rebased.relationshipHistory || []).map(event => ({ ...event, sourceMessageId: null, turn: null }));
        return rebased;
    });
    next.socialGraph = (next.socialGraph || []).map(edge => ({ ...edge, sourceMessageId: null }));
    next.lastObservation = {
        messageId: null,
        exchangeActiveNpcIds: [],
        finalPresentNpcIds: [],
        worldActiveNpcIds: [],
        targetNpcIds: [],
    };
    next.lastScannedMessageId = null;
    next.checkpoints = [];
    next.branchBase = null;
    next.branchHeadLineage = [];
    next.branchSafety = { status: 'safe', kind: '', reason: '' };
    next.updatedAt = Date.now();
    return ensureBranchBase(normalizeState(next, source.chatKey), chat);
}

function arraysEqual(a = [], b = []) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function latestAssistantMessageId(chat = []) {
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (message && !message.is_system && !message.is_user) return i;
    }
    return -1;
}

export function ensureBranchBase(state, chat = []) {
    const next = normalizeState(state, state?.chatKey || '');
    const currentLineage = chatLineage(chat);
    if (!next.branchBase?.snapshot) {
        const messageId = latestAssistantMessageId(chat);
        next.branchBase = {
            messageId: messageId >= 0 ? messageId : null,
            lineage: messageId >= 0 ? chatLineage(chat, messageId) : currentLineage,
            createdAt: Date.now(),
            snapshot: snapshotForCheckpoint(next),
        };
    }
    if (!next.branchHeadLineage.length) next.branchHeadLineage = currentLineage;
    return next;
}

export function markBranchHead(state, chat = []) {
    const next = normalizeState(state, state?.chatKey || '');
    next.branchHeadLineage = chatLineage(chat);
    return next;
}

export function recordCheckpoint(state, chat, messageId, reason = 'scan') {
    if (!Number.isInteger(messageId) || messageId < 0) return markBranchHead(state, chat);
    const next = ensureBranchBase(state, chat);
    const lineage = chatLineage(chat, messageId);
    const checkpoint = {
        messageId,
        lineage,
        reason: String(reason || 'scan').slice(0, 80),
        createdAt: Date.now(),
        snapshot: snapshotForCheckpoint(next),
    };
    const existing = next.checkpoints.findIndex(item => item.messageId === messageId && arraysEqual(item.lineage, lineage));
    if (existing >= 0) next.checkpoints[existing] = checkpoint;
    else next.checkpoints.push(checkpoint);
    next.checkpoints.sort((a, b) => a.lineage.length - b.lineage.length || a.createdAt - b.createdAt);
    if (next.checkpoints.length > CHECKPOINT_LIMIT) next.checkpoints.splice(0, next.checkpoints.length - CHECKPOINT_LIMIT);
    next.branchHeadLineage = chatLineage(chat);
    return next;
}

export function bestCheckpoint(state, chat) {
    const lineage = chatLineage(chat);
    let best = null;
    for (const checkpoint of state?.checkpoints || []) {
        if (!checkpoint?.snapshot || !lineageIsPrefix(checkpoint.lineage || [], lineage)) continue;
        if (!best || checkpoint.lineage.length > best.lineage.length || (checkpoint.lineage.length === best.lineage.length && checkpoint.createdAt > best.createdAt)) best = checkpoint;
    }
    const base = state?.branchBase;
    if (base?.snapshot && lineageIsPrefix(base.lineage || [], lineage)) {
        const candidate = { ...base, reason: 'v3-baseline', isBranchBase: true };
        if (!best || candidate.lineage.length > best.lineage.length || (candidate.lineage.length === best.lineage.length && candidate.createdAt > best.createdAt)) best = candidate;
    }
    return best;
}

function preserveTombstones(restored, current) {
    const tombstones = new Set(current.deletedNpcIds || []);
    for (const id of restored.deletedNpcIds || []) tombstones.add(id);
    restored.deletedNpcIds = [...tombstones];
    restored.npcs = restored.npcs.filter(npc => !tombstones.has(npc.id));
    return restored;
}

function failClosedPrebaselineDivergence(state, chat) {
    const next = normalizeState(state, state?.chatKey || '');
    const kind = next.branchSafety?.kind || branchDivergenceKind(next, chat);
    for (const npc of next.npcs) {
        npc.present = false;
        npc.worldActive = false;
    }
    next.lastObservation = {
        messageId: null,
        exchangeActiveNpcIds: [],
        finalPresentNpcIds: [],
        worldActiveNpcIds: [],
        targetNpcIds: [],
    };
    next.lastScannedMessageId = null;
    next.branchSafety = {
        status: 'rebase-required',
        kind,
        reason: kind === 'prebaseline-truncation'
            ? 'The chat was truncated before NPC State\'s oldest recoverable checkpoint. Durable dossiers remain intact, but the current timeline must be explicitly rebased before live scanning resumes.'
            : 'The chat was rewritten before NPC State\'s oldest recoverable checkpoint. Durable dossiers remain intact, but the current timeline must be explicitly rebased before live scanning resumes.',
    };
    next.updatedAt = Date.now();
    return next;
}

export function reconcileToCurrentBranch(state, chat) {
    const normalized = ensureBranchBase(state, chat);
    const currentLineage = chatLineage(chat);
    if (lineageIsPrefix(normalized.branchHeadLineage || [], currentLineage)) {
        if (normalized.branchSafety?.status === 'safe') return { changed: false, unsafeDivergence: false, state: normalized, checkpoint: bestCheckpoint(normalized, chat) };
    }

    const checkpoint = bestCheckpoint(normalized, chat);
    if (!checkpoint) {
        const failed = failClosedPrebaselineDivergence(normalized, chat);
        return { changed: true, unsafeDivergence: true, state: failed, checkpoint: null };
    }

    const restored = preserveTombstones(normalizeState(checkpoint.snapshot, normalized.chatKey), normalized);
    restored.checkpoints = structuredClone(normalized.checkpoints || []);
    restored.branchBase = structuredClone(normalized.branchBase || null);
    restored.branchHeadLineage = currentLineage;
    restored.branchSafety = { status: 'safe', kind: '', reason: '' };
    restored.updatedAt = Date.now();
    return { changed: true, unsafeDivergence: false, state: restored, checkpoint };
}
