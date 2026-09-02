import * as legacy from './branch-v0218.js';
import { normalizeName } from './core.js';
import { parseQualifiedChatKey } from './identity.js';
import { prunePortraitAssetsInPlace } from './storage.js';
import { normalizeSocialGraph, removeNpcFromSocialGraph, purgeNpcStructuredReferences } from './social.js';

export * from './branch-v0218.js';

export const BRANCH_LINEAGE_VERSION = 3;
export const BRANCH_SNAPSHOT_BUDGET_BYTES = 2_000_000;
export const BRANCH_SNAPSHOT_BUDGET_CHARS = BRANCH_SNAPSHOT_BUDGET_BYTES;
export const BRANCH_SNAPSHOT_MAX_BYTES = 750_000;

let provenanceHint = Object.freeze({ mainChat: '', ownerScope: '', currentKey: '' });

export function setBranchProvenanceHint({ mainChat = '', ownerScope = '', currentKey = '' } = {}) {
    provenanceHint = Object.freeze({
        mainChat: String(mainChat || '').replace(/\.jsonl$/i, '').trim(),
        ownerScope: String(ownerScope || '').trim(),
        currentKey: String(currentKey || '').trim(),
    });
}

function fnv1a32(text, seed = 0x811c9dc5) {
    let hash = seed >>> 0;
    const input = String(text ?? '');
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

function branchHash(text) {
    const input = String(text ?? '');
    return `${fnv1a32(input, 0x811c9dc5)}.${fnv1a32(input, 0x9e3779b9)}`;
}

export function fingerprintMessage(message = {}) {
    // v3 deliberately excludes mutable display names and swipe indexes. SillyTavern can
    // rewrite both during host-level rename/swipe maintenance without changing the story.
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        text: String(message.mes || ''),
    });
    return branchHash(payload);
}

export function chatLineage(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(fingerprintMessage);
}

export function lineageCheckpointKeys(lineage = []) {
    const source = Array.isArray(lineage) ? lineage : [];
    const keys = [];
    let parent = 'root';
    for (let i = 0; i < source.length; i += 1) {
        parent = branchHash(`${parent}|${i}|${source[i]}`);
        keys.push(parent);
    }
    return keys;
}

export function lineageCheckpointKey(lineage = [], messageId = -1) {
    if (!Number.isInteger(messageId) || messageId < 0) return '';
    return lineageCheckpointKeys(lineage)[messageId] || '';
}

function utf8Bytes(value) {
    try { return new TextEncoder().encode(JSON.stringify(value ?? {})).byteLength; }
    catch { return Number.POSITIVE_INFINITY; }
}

function checkpointBytes(item) {
    return utf8Bytes(item?.snapshot || {}) + 256;
}

function ensureBranchFamilyId(state, seed = '') {
    if (!state || typeof state !== 'object') return '';
    const existing = String(state.branchFamilyId || '').trim();
    if (existing) return existing;
    let id = '';
    try { id = globalThis.crypto?.randomUUID?.() || ''; } catch { /* noop */ }
    if (!id) id = `bf-${branchHash(`${seed}|${Date.now()}|${Math.random()}`)}`;
    state.branchFamilyId = id;
    return id;
}

function normalizeCheckpointV3(raw, activeLineage = []) {
    if (!raw || typeof raw !== 'object' || !raw.snapshot || typeof raw.snapshot !== 'object') return null;
    const messageId = Number(raw.messageId);
    if (!Number.isInteger(messageId) || messageId < 0) return null;
    const existingKey = String(raw.lineageKey || '').trim();
    const existingFingerprint = String(raw.fingerprint || '').trim();
    let checkpoint;
    if (existingKey && existingFingerprint) {
        // A v3 checkpoint already carries its own branch identity. Never relabel it merely
        // because another sibling is currently active; doing so would graft the wrong snapshot
        // onto the current swipe. Active/sibling classification happens later by lineageKey.
        checkpoint = {
            ...raw,
            messageId,
            lineageKey: existingKey,
            fingerprint: existingFingerprint,
            parentLineageKey: String(raw.parentLineageKey || (messageId === 0 ? 'root' : '')),
            reason: String(raw.reason || 'state'),
            createdAt: Number(raw.createdAt || 0) || Date.now(),
        };
    } else {
        if (messageId >= activeLineage.length) return null;
        const keys = lineageCheckpointKeys(activeLineage);
        checkpoint = {
            ...raw,
            messageId,
            fingerprint: activeLineage[messageId],
            lineageKey: keys[messageId],
            parentLineageKey: messageId > 0 ? keys[messageId - 1] : 'root',
            reason: String(raw.reason || 'state'),
            createdAt: Number(raw.createdAt || 0) || Date.now(),
        };
    }
    return checkpointBytes(checkpoint) <= BRANCH_SNAPSHOT_MAX_BYTES ? checkpoint : null;
}

function normalizeBranchCheckpointsV3(checkpoints = [], activeLineage = []) {
    const byKey = new Map();
    for (const raw of Array.isArray(checkpoints) ? checkpoints : []) {
        const checkpoint = normalizeCheckpointV3(raw, activeLineage);
        if (!checkpoint) continue;
        const existing = byKey.get(checkpoint.lineageKey);
        if (!existing || checkpoint.createdAt >= existing.createdAt) byKey.set(checkpoint.lineageKey, checkpoint);
    }
    return [...byKey.values()];
}

export function pruneBranchCheckpoints(checkpoints = [], activeLineage = [], limit = legacy.BRANCH_HISTORY_LIMIT) {
    const cap = Math.max(8, Number(limit) || legacy.BRANCH_HISTORY_LIMIT);
    const normalized = normalizeBranchCheckpointsV3(checkpoints, activeLineage);
    const activeKeys = new Set(lineageCheckpointKeys(activeLineage));
    const active = normalized.filter(item => activeKeys.has(item.lineageKey)).sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
    const siblings = normalized.filter(item => !activeKeys.has(item.lineageKey)).sort((a, b) => b.createdAt - a.createdAt || b.messageId - a.messageId);
    const keep = new Map();

    if (normalized.length <= cap) {
        for (const item of normalized) keep.set(item.lineageKey, item);
    } else {
        const siblingBudget = Math.min(siblings.length, Math.max(8, Math.floor(cap * 0.25)));
        const activeBudget = Math.max(1, cap - siblingBudget);
        if (active.length) {
            keep.set(active[0].lineageKey, active[0]);
            for (const item of active.slice(-Math.max(1, activeBudget - 1))) keep.set(item.lineageKey, item);
        }
        for (const item of siblings.slice(0, siblingBudget)) keep.set(item.lineageKey, item);
        if (!active.length) for (const item of normalized.slice(-cap)) keep.set(item.lineageKey, item);
    }

    const selected = [...keep.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
    if (!selected.length) return [];
    const budgeted = new Map();
    let used = 0;
    const oldestActive = selected.find(item => activeKeys.has(item.lineageKey)) || null;
    if (oldestActive) {
        const size = checkpointBytes(oldestActive);
        if (size <= BRANCH_SNAPSHOT_BUDGET_BYTES) {
            budgeted.set(oldestActive.lineageKey, oldestActive);
            used += size;
        }
    }
    for (const item of [...selected].sort((a, b) => b.createdAt - a.createdAt || b.messageId - a.messageId)) {
        if (budgeted.has(item.lineageKey)) continue;
        const size = checkpointBytes(item);
        if (size > BRANCH_SNAPSHOT_MAX_BYTES || used + size > BRANCH_SNAPSHOT_BUDGET_BYTES) continue;
        budgeted.set(item.lineageKey, item);
        used += size;
    }
    return [...budgeted.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
}

function boundRootSnapshot(state) {
    if (!state?.branchRootSnapshot || typeof state.branchRootSnapshot !== 'object') return;
    if (utf8Bytes(state.branchRootSnapshot) > BRANCH_SNAPSHOT_MAX_BYTES) state.branchRootSnapshot = null;
}

export function migrateLegacyBranchState(state, chat, limit = legacy.BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    if (Number(state.branchLineageVersion || 0) >= BRANCH_LINEAGE_VERSION) {
        state.checkpoints = pruneBranchCheckpoints(state.checkpoints, Array.isArray(state.lineage) ? state.lineage : [], limit);
        boundRootSnapshot(state);
        ensureBranchFamilyId(state, (state.lineage || []).slice(0, 4).join('|'));
        prunePortraitAssetsInPlace(state);
        return state;
    }
    const lineage = chatLineage(chat);
    const keys = lineageCheckpointKeys(lineage);
    const storedVersion = Number(state.branchLineageVersion || 0);
    const storedLineage = Array.isArray(state.lineage) ? [...state.lineage] : [];
    const proofLineage = storedVersion <= 0 ? legacy.legacyChatLineageV0210(chat) : legacy.chatLineage(chat);
    const hostRenameRebase = state.hostRenameRebaseAllowed === true;
    let provenPrefixLength = hostRenameRebase ? Math.min(storedLineage.length, proofLineage.length) : 0;
    if (!hostRenameRebase) {
        const common = Math.min(storedLineage.length, proofLineage.length);
        while (provenPrefixLength < common && storedLineage[provenPrefixLength] === proofLineage[provenPrefixLength]) provenPrefixLength += 1;
    }
    const prefixMatches = messageId => {
        if (hostRenameRebase) return true;
        if (!Number.isInteger(messageId) || messageId < 0 || messageId >= proofLineage.length) return false;
        for (let i = 0; i <= messageId; i += 1) if (!storedLineage[i] || storedLineage[i] !== proofLineage[i]) return false;
        return true;
    };
    if (storedVersion < BRANCH_LINEAGE_VERSION) {
        const migrated = [];
        for (const raw of Array.isArray(state.checkpoints) ? state.checkpoints : []) {
            const messageId = Number(raw?.messageId);
            if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length || !raw?.snapshot || !prefixMatches(messageId)) continue;
            migrated.push({
                ...raw,
                messageId,
                fingerprint: lineage[messageId],
                lineageKey: keys[messageId],
                parentLineageKey: messageId > 0 ? keys[messageId - 1] : 'root',
                reason: String(raw.reason || 'v3-migrated'),
            });
        }
        state.checkpoints = migrated;
        state.inlineCards = (Array.isArray(state.inlineCards) ? state.inlineCards : []).map(entry => {
            const messageId = Number(entry?.messageId);
            if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length || !prefixMatches(messageId)) return null;
            return { ...entry, fingerprint: lineage[messageId], lineageKey: keys[messageId] };
        }).filter(Boolean);
    }
    // Preserve the prior branch shape through the one-time v2 -> v3 conversion. Relabel the
    // proven common prefix with v3 fingerprints, but use deterministic legacy sentinels for
    // the old suffix. The next reconciliation can therefore still detect a swipe/edit/tail
    // divergence instead of migration accidentally making old and current lineages identical.
    if (hostRenameRebase) {
        state.lineage = lineage;
    } else {
        state.lineage = storedLineage.map((storedFingerprint, index) => index < provenPrefixLength && index < lineage.length
            ? lineage[index]
            : branchHash(`legacy-lineage-v${storedVersion}:${index}:${storedFingerprint}`));
    }
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    delete state.hostRenameRebaseAllowed;
    // Migrated checkpoints exist only on the proven current prefix and are keyed to current v3
    // content. Preserve them against the current lineage even while state.lineage retains the
    // previous-branch sentinels for one reconciliation cycle.
    state.checkpoints = pruneBranchCheckpoints(state.checkpoints, lineage, limit);
    boundRootSnapshot(state);
    ensureBranchFamilyId(state, lineage.slice(0, 4).join('|'));
    prunePortraitAssetsInPlace(state);
    return state;
}

export function rebaseBranchStateForHostRename(state, chat, limit = legacy.BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    if (Number(state.branchLineageVersion || 0) >= BRANCH_LINEAGE_VERSION) return state;
    state.hostRenameRebaseAllowed = true;
    return migrateLegacyBranchState(state, chat, limit);
}

export function ensureBranchParentAnchor(state, chat, messageId, reason = 'parent-anchor', limit = legacy.BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object' || !Number.isInteger(messageId) || messageId < 0) return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    ensureBranchFamilyId(state, lineage.slice(0, 4).join('|'));
    if (messageId === 0) {
        if (!state.branchRootSnapshot || typeof state.branchRootSnapshot !== 'object') {
            const snapshot = legacy.snapshotBranchState(state);
            state.branchRootSnapshot = utf8Bytes(snapshot) <= BRANCH_SNAPSHOT_MAX_BYTES ? snapshot : null;
        }
        prunePortraitAssetsInPlace(state);
        return state;
    }
    if (messageId > lineage.length - 1) return state;
    const keys = lineageCheckpointKeys(lineage);
    const parentId = messageId - 1;
    const parentKey = keys[parentId];
    const checkpoints = normalizeBranchCheckpointsV3(state.checkpoints, lineage);
    if (!checkpoints.some(item => item.lineageKey === parentKey)) {
        const snapshot = legacy.snapshotBranchState(state);
        if (utf8Bytes(snapshot) <= BRANCH_SNAPSHOT_MAX_BYTES) checkpoints.push({
            messageId: parentId,
            fingerprint: lineage[parentId],
            lineageKey: parentKey,
            parentLineageKey: parentId > 0 ? keys[parentId - 1] : 'root',
            reason: String(reason || 'parent-anchor'),
            createdAt: Date.now(),
            snapshot,
        });
    }
    state.checkpoints = pruneBranchCheckpoints(checkpoints, lineage, limit);
    prunePortraitAssetsInPlace(state);
    return state;
}

export function recordBranchCheckpoint(state, chat, messageId, reason = 'state', limit = legacy.BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    ensureBranchFamilyId(state, lineage.slice(0, 4).join('|'));
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length) {
        prunePortraitAssetsInPlace(state);
        return state;
    }
    const keys = lineageCheckpointKeys(lineage);
    const snapshot = legacy.snapshotBranchState(state);
    if (utf8Bytes(snapshot) <= BRANCH_SNAPSHOT_MAX_BYTES) {
        const checkpoint = {
            messageId,
            fingerprint: lineage[messageId],
            lineageKey: keys[messageId],
            parentLineageKey: messageId > 0 ? keys[messageId - 1] : 'root',
            reason: String(reason || 'state'),
            createdAt: Date.now(),
            snapshot,
        };
        const checkpoints = normalizeBranchCheckpointsV3(state.checkpoints, lineage);
        const existingIndex = checkpoints.findIndex(item => item.lineageKey === checkpoint.lineageKey);
        if (existingIndex >= 0) checkpoints[existingIndex] = checkpoint;
        else checkpoints.push(checkpoint);
        state.checkpoints = pruneBranchCheckpoints(checkpoints, lineage, limit);
    } else {
        state.checkpoints = pruneBranchCheckpoints(state.checkpoints, lineage, limit);
    }
    prunePortraitAssetsInPlace(state);
    return state;
}

function cloneNpcList(npcs) {
    return Array.isArray(npcs) ? structuredClone(npcs) : [];
}

function npcLabels(npc) {
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])].map(normalizeName).filter(Boolean);
}

function enforceUserDismissals(state, groups) {
    const normalizedGroups = legacy.normalizeUserDismissedGroups(groups);
    const blockedIds = new Set(normalizedGroups.flatMap(group => group.ids));
    const legacyBlockedLabels = new Set(normalizedGroups.filter(group => !group.ids.length).flatMap(group => group.labels));
    state.userDismissedGroups = normalizedGroups;
    if (!blockedIds.size && !legacyBlockedLabels.size) return state;
    const blockedNpc = npc => blockedIds.has(String(npc?.id || '')) || npcLabels(npc).some(label => legacyBlockedLabels.has(label));
    const removedNpcs = (Array.isArray(state.npcs) ? state.npcs : []).filter(blockedNpc);
    state.npcs = (Array.isArray(state.npcs) ? state.npcs : []).filter(npc => !blockedNpc(npc));
    for (const removedNpc of removedNpcs) {
        state.socialGraph = removeNpcFromSocialGraph(state.socialGraph, removedNpc.id);
        purgeNpcStructuredReferences(state.npcs, removedNpc);
    }
    state.candidates = (Array.isArray(state.candidates) ? state.candidates : []).filter(candidate => {
        if (blockedIds.has(String(candidate?.id || ''))) return false;
        return !npcLabels(candidate).some(label => legacyBlockedLabels.has(label));
    });
    state.pendingBackfills = (Array.isArray(state.pendingBackfills) ? state.pendingBackfills : []).filter(item => {
        if (blockedIds.has(String(item?.npcId || ''))) return false;
        const label = normalizeName(item?.label);
        return !label || !legacyBlockedLabels.has(label);
    });
    const existingDismissed = (Array.isArray(state.dismissed) ? state.dismissed : []).map(normalizeName).filter(Boolean);
    state.dismissed = [...new Set([...existingDismissed, ...legacyBlockedLabels])];
    return state;
}

function latestAssistantMessageId(chat = []) {
    for (let i = (Array.isArray(chat) ? chat.length : 0) - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (message && !message.is_user && !message.is_system && String(message.mes || '').trim()) return i;
    }
    return -1;
}

function matchingCheckpoints(checkpoints, lineage) {
    const keys = lineageCheckpointKeys(lineage);
    return checkpoints
        .filter(item => Number.isInteger(item?.messageId) && item.messageId >= 0 && item.messageId < keys.length)
        .filter(item => item.lineageKey === keys[item.messageId])
        .sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
}

export function reconcileBranchState(state, chat, { explicitDivergence = null } = {}) {
    migrateLegacyBranchState(state, chat);
    const currentLineage = chatLineage(chat);
    const previousLineage = Array.isArray(state?.lineage) ? state.lineage : [];
    let divergence = legacy.firstLineageDivergence(previousLineage, currentLineage);
    if (Number.isInteger(explicitDivergence) && explicitDivergence >= 0) divergence = divergence < 0 ? explicitDivergence : Math.min(divergence, explicitDivergence);
    if (divergence < 0) {
        state.lineage = currentLineage;
        prunePortraitAssetsInPlace(state);
        return { state: { ...state, lineage: currentLineage }, divergence: -1, restoredFromMessageId: null, invalidated: false, exactRestored: false };
    }

    const currentNpcs = cloneNpcList(state?.npcs);
    const checkpoints = normalizeBranchCheckpointsV3(state?.checkpoints, previousLineage);
    const matches = matchingCheckpoints(checkpoints, currentLineage);
    const deepestMatch = matches.at(-1) || null;
    const lastAssistantId = latestAssistantMessageId(chat);
    const exactCheckpoint = deepestMatch && deepestMatch.messageId >= lastAssistantId ? deepestMatch : null;
    let restored;
    let checkpoint;
    let exactRestored = false;
    if (exactCheckpoint) {
        checkpoint = exactCheckpoint;
        restored = legacy.restoreSnapshotIntoState(state, checkpoint.snapshot);
        exactRestored = true;
    } else {
        checkpoint = deepestMatch || null;
        restored = checkpoint
            ? legacy.restoreSnapshotIntoState(state, checkpoint.snapshot)
            : (state?.branchRootSnapshot && typeof state.branchRootSnapshot === 'object'
                ? legacy.restoreSnapshotIntoState(state, state.branchRootSnapshot)
                : { ...state, processedOocMessageId: null, lastScannedMessageId: null, assistantSinceScan: 0 });
    }
    restored.npcs = legacy.preserveUserNpcMetadata(restored.npcs, currentNpcs);
    enforceUserDismissals(restored, state?.userDismissedGroups);
    restored.lineage = currentLineage;
    restored.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    restored.branchFamilyId = String(state?.branchFamilyId || restored.branchFamilyId || '');
    ensureBranchFamilyId(restored, currentLineage.slice(0, 4).join('|'));
    restored.checkpoints = pruneBranchCheckpoints(checkpoints, currentLineage);
    restored.inlineCards = Array.isArray(state?.inlineCards) ? structuredClone(state.inlineCards) : [];
    if (!exactRestored) {
        if (Number.isInteger(restored.lastScannedMessageId) && restored.lastScannedMessageId >= divergence) restored.lastScannedMessageId = null;
        if (Number.isInteger(restored.processedOocMessageId) && restored.processedOocMessageId >= divergence) restored.processedOocMessageId = null;
    }
    prunePortraitAssetsInPlace(restored);
    return {
        state: restored,
        divergence,
        restoredFromMessageId: checkpoint?.messageId ?? null,
        restoredLineageKey: checkpoint?.lineageKey || '',
        invalidated: true,
        exactRestored,
        restoredFromRoot: !checkpoint && Boolean(state?.branchRootSnapshot),
        legacyFallback: !checkpoint && checkpoints.length === 0 && !state?.branchRootSnapshot,
    };
}

function candidateMatchesExplicitParent(key) {
    if (!provenanceHint.mainChat) return true;
    const parsed = parseQualifiedChatKey(key);
    return Boolean(parsed && parsed.chatId === provenanceHint.mainChat);
}

export function bestAncestorState(chats = {}, currentKey = '', currentChat = []) {
    const lineage = chatLineage(currentChat);
    const legacyLineage = legacy.chatLineage(currentChat);
    const currentKeys = lineageCheckpointKeys(lineage);
    const legacyCurrentKeys = legacy.lineageCheckpointKeys(legacyLineage);
    let best = null;
    const hasExplicitParent = Boolean(provenanceHint.mainChat);

    for (const [key, state] of Object.entries(chats || {})) {
        if (key === currentKey || !state || !Array.isArray(state.lineage) || !Array.isArray(state.checkpoints)) continue;
        if (hasExplicitParent && !candidateMatchesExplicitParent(key)) continue;
        const isV3 = Number(state.branchLineageVersion || 0) >= BRANCH_LINEAGE_VERSION;
        let prefixLength = 0;
        let sourceCheckpoints = [];

        if (hasExplicitParent) {
            // SillyTavern writes chat_metadata.main_chat when it creates a branch. That host
            // provenance is stronger than prose similarity and remains valid while v2 state is
            // upgraded to the rename-stable v3 lineage format.
            prefixLength = isV3
                ? legacy.commonPrefixLength(state.lineage, lineage)
                : legacy.commonPrefixLength(state.lineage, legacyLineage);
            if (prefixLength < 1) continue;
            sourceCheckpoints = isV3
                ? normalizeBranchCheckpointsV3(state.checkpoints, lineage)
                : legacy.normalizeBranchCheckpoints(state.checkpoints, state.lineage);
        } else {
            const canonical = Boolean(parseQualifiedChatKey(key));
            // New v0.2.19 canonical state only crosses chat boundaries when SillyTavern
            // explicitly identifies a parent via chat_metadata.main_chat. Text similarity is
            // retained only as a migration fallback for older state and legacy unqualified tests.
            if (canonical && isV3) continue;
            const comparisonLineage = isV3 ? lineage : legacyLineage;
            prefixLength = legacy.commonPrefixLength(state.lineage, comparisonLineage);
            const minPrefix = canonical ? 8 : 4;
            const minUserTurns = canonical ? 3 : 2;
            if (prefixLength < minPrefix) continue;
            const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);
            if (sharedPrefix.filter(message => message?.is_user).length < minUserTurns) continue;
            sourceCheckpoints = isV3
                ? normalizeBranchCheckpointsV3(state.checkpoints, state.lineage)
                : legacy.normalizeBranchCheckpoints(state.checkpoints, state.lineage);
        }

        const checkpoint = sourceCheckpoints
            .filter(item => item.messageId < prefixLength)
            .filter(item => {
                if (hasExplicitParent) return true;
                const keys = isV3 ? currentKeys : legacyCurrentKeys;
                return item.lineageKey === keys[item.messageId];
            })
            .sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt)
            .at(-1);
        if (!checkpoint) continue;
        if (!best || checkpoint.messageId > best.checkpoint.messageId) {
            best = { key, state, checkpoint, prefixLength, sourceCheckpoints, isV3 };
        }
    }

    if (!best) return null;
    const inherited = legacy.restoreSnapshotIntoState({}, best.checkpoint.snapshot);
    inherited.lineage = lineage;
    inherited.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    inherited.checkpoints = pruneBranchCheckpoints(
        best.sourceCheckpoints
            .filter(item => item.messageId <= best.checkpoint.messageId)
            .map(item => ({ ...item, lineageKey: '', parentLineageKey: '', fingerprint: '' })),
        lineage,
    );
    inherited.inlineCards = structuredClone((best.state.inlineCards || []).filter(item => {
        const messageId = Number(item?.messageId);
        return Number.isInteger(messageId) && messageId >= 0 && messageId <= best.checkpoint.messageId && messageId < lineage.length;
    }).map(item => ({ ...item, fingerprint: lineage[item.messageId], lineageKey: currentKeys[item.messageId] })));
    inherited.portraitAssets = structuredClone(best.state.portraitAssets || {});
    inherited.userDismissedGroups = structuredClone(legacy.normalizeUserDismissedGroups(best.state.userDismissedGroups));
    enforceUserDismissals(inherited, inherited.userDismissedGroups);
    inherited.branchParent = best.key;
    inherited.branchForkMessageId = best.checkpoint.messageId;
    inherited.branchFamilyId = String(best.state.branchFamilyId || '');
    ensureBranchFamilyId(inherited, best.key);
    prunePortraitAssetsInPlace(inherited);
    return inherited;
}
