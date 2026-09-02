import { normalizeName } from './core.js';
import { normalizeSocialGraph, removeNpcFromSocialGraph, purgeNpcStructuredReferences } from './social.js';

export const BRANCH_HISTORY_LIMIT = 160;
export const BRANCH_SNAPSHOT_BUDGET_CHARS = 2_000_000;
export const BRANCH_LINEAGE_VERSION = 2;

export const DEFAULT_SCAN_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

export function createScanOperationRegistry({
    timeoutMs = DEFAULT_SCAN_OPERATION_TIMEOUT_MS,
    onExpire = null,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
    const active = new Map();
    let sequence = 0;
    const timeout = Math.max(1000, Number(timeoutMs) || DEFAULT_SCAN_OPERATION_TIMEOUT_MS);

    const keyOf = value => String(value || '').trim();
    const isBusy = key => active.has(keyOf(key));
    const isCurrent = (key, operation) => Boolean(operation && active.get(keyOf(key)) === operation && !operation.expired);

    const end = (key, operation) => {
        const normalizedKey = keyOf(key);
        if (!operation || active.get(normalizedKey) !== operation) return false;
        if (operation.timer && typeof clearTimeoutFn === 'function') clearTimeoutFn(operation.timer);
        active.delete(normalizedKey);
        operation.finished = true;
        return true;
    };

    const begin = (key, label = 'scan', metadata = {}) => {
        const normalizedKey = keyOf(key);
        if (!normalizedKey || normalizedKey === 'no-chat' || active.has(normalizedKey)) return null;
        const operation = {
            id: ++sequence,
            key: normalizedKey,
            label: String(label || 'scan'),
            metadata: metadata && typeof metadata === 'object' ? structuredClone(metadata) : {},
            startedAt: Date.now(),
            expired: false,
            finished: false,
            timer: null,
        };
        if (typeof setTimeoutFn === 'function') {
            operation.timer = setTimeoutFn(() => {
                if (active.get(normalizedKey) !== operation) return;
                active.delete(normalizedKey);
                operation.expired = true;
                operation.finished = true;
                try { onExpire?.(operation); } catch (error) { console.warn('[NPC State] scan timeout cleanup callback failed', error); }
            }, timeout);
            operation.timer?.unref?.();
        }
        active.set(normalizedKey, operation);
        return operation;
    };

    const cancel = (key, reason = 'cancelled') => {
        const normalizedKey = keyOf(key);
        const operation = active.get(normalizedKey);
        if (!operation) return null;
        if (operation.timer && typeof clearTimeoutFn === 'function') clearTimeoutFn(operation.timer);
        active.delete(normalizedKey);
        operation.finished = true;
        operation.cancelled = true;
        operation.cancelReason = String(reason || 'cancelled');
        return operation;
    };

    const status = key => {
        const operation = active.get(keyOf(key));
        if (!operation) return null;
        return {
            id: operation.id,
            key: operation.key,
            label: operation.label,
            metadata: structuredClone(operation.metadata || {}),
            startedAt: operation.startedAt,
        };
    };

    return Object.freeze({ begin, end, cancel, isBusy, isCurrent, status });
}

export function deletedChatStateKey(rawId, kind = 'chat') {
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const prefix = kind === 'group' ? 'group' : (kind === 'chat' ? 'chat' : '');
    if (!prefix) return '';
    return `${prefix}:${id}`;
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
    // Two independently seeded 32-bit lanes make accidental sibling-state collisions
    // vanishingly unlikely without relying on async WebCrypto or BigInt serialization.
    const input = String(text ?? '');
    return `${fnv1a32(input, 0x811c9dc5)}.${fnv1a32(input, 0x9e3779b9)}`;
}

function legacyFingerprintMessageV0210(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
        swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : null,
    });
    return fnv1a32(payload);
}

export function legacyChatLineageV0210(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(legacyFingerprintMessageV0210);
}

export function fingerprintMessage(message = {}) {
    // Branch identity is narrative-content based. SillyTavern can renumber swipe_id when
    // an alternate is deleted, so the UI index must never be part of durable branch identity.
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
    });
    return branchHash(payload);
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
        socialGraph: normalizeSocialGraph(state.socialGraph),
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
        socialGraph: normalizeSocialGraph(snapshot.socialGraph),
        dismissed: Array.isArray(snapshot.dismissed) ? [...snapshot.dismissed] : [],
        turn: Number(snapshot.turn || 0),
        assistantSinceScan: Number(snapshot.assistantSinceScan || 0),
        lastScanAt: Number(snapshot.lastScanAt || 0),
        lastScannedMessageId: Number.isInteger(snapshot.lastScannedMessageId) ? snapshot.lastScannedMessageId : null,
        scanCount: Number(snapshot.scanCount || 0),
        processedOocMessageId: Number.isInteger(snapshot.processedOocMessageId) ? snapshot.processedOocMessageId : null,
    };
}

function npcLabels(npc) {
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]
        .map(normalizeName)
        .filter(Boolean);
}

function findNpcForMetadataRestore(npc, currentNpcs = []) {
    const records = Array.isArray(currentNpcs) ? currentNpcs : [];
    if (npc?.id) {
        const exact = records.find(candidate => candidate?.id && candidate.id === npc.id);
        if (exact) return exact;
    }
    const labels = new Set(npcLabels(npc));
    if (!labels.size) return null;
    const matches = records.filter(candidate => npcLabels(candidate).some(label => labels.has(label)));
    return matches.length === 1 ? matches[0] : null;
}

export function normalizeUserDismissedGroups(value = []) {
    const groups = [];
    for (const raw of Array.isArray(value) ? value : []) {
        const labels = [...new Set((Array.isArray(raw?.labels) ? raw.labels : [raw?.primary || (typeof raw === 'string' ? raw : '')])
            .map(normalizeName)
            .filter(Boolean))];
        const ids = [...new Set([
            ...(Array.isArray(raw?.ids) ? raw.ids : []),
            raw?.npcId,
        ].map(value => String(value || '').trim()).filter(Boolean))];
        if (!labels.length && !ids.length) continue;
        const primary = normalizeName(raw?.primary) || labels[0] || '';
        groups.push({
            primary,
            labels,
            ids,
            createdAt: Number(raw?.createdAt || 0) || Date.now(),
        });
    }
    return groups;
}

export function promoteLegacyUserDismissedGroups(groups, npcCollections = []) {
    const normalized = normalizeUserDismissedGroups(groups);
    const records = (Array.isArray(npcCollections) ? npcCollections : [])
        .flatMap(collection => Array.isArray(collection) ? collection : [])
        .filter(Boolean);
    return normalized.map(group => {
        if (group.ids.length || !group.labels.length) return group;
        const labels = new Set(group.labels);
        const candidateIds = [...new Set(records
            .filter(npc => npc?.id && npcLabels(npc).some(label => labels.has(label)))
            .map(npc => String(npc.id).trim())
            .filter(Boolean))];
        // Upgrade only when history proves one stable identity. Multiple matching ids may be
        // genuine homonyms or older split identities, so retaining legacy suppression is safer.
        return candidateIds.length === 1 ? { ...group, ids: candidateIds } : group;
    });
}

export function addUserDismissedGroup(groups, npc, { historicalNpcIds = [] } = {}) {
    const labels = [...new Set(npcLabels(npc))];
    const ids = [...new Set([npc?.id, ...(Array.isArray(historicalNpcIds) ? historicalNpcIds : [])]
        .map(value => String(value || '').trim())
        .filter(Boolean))];
    if (!labels.length && !ids.length) return normalizeUserDismissedGroups(groups);
    const existing = normalizeUserDismissedGroups(groups);
    const mergedLabels = new Set(labels);
    const mergedIds = new Set(ids);
    const kept = [];
    for (const group of existing) {
        const idOverlap = group.ids.some(id => mergedIds.has(id));
        const legacyLabelOverlap = !group.ids.length && group.labels.some(label => mergedLabels.has(label));
        if (idOverlap || legacyLabelOverlap) {
            for (const label of group.labels) mergedLabels.add(label);
            for (const id of group.ids) mergedIds.add(id);
        } else kept.push(group);
    }
    kept.push({
        primary: normalizeName(npc?.name) || labels[0] || '',
        labels: [...mergedLabels],
        ids: [...mergedIds],
        createdAt: Date.now(),
    });
    return kept;
}

export function clearUserDismissedGroupsFor(groups, target, { modernByIdOnly = false } = {}) {
    const targetLabels = new Set(typeof target === 'string' ? [normalizeName(target)].filter(Boolean) : npcLabels(target));
    const targetIds = new Set(typeof target === 'string' ? [] : [target?.id, ...(Array.isArray(target?.historicalNpcIds) ? target.historicalNpcIds : [])]
        .map(value => String(value || '').trim()).filter(Boolean));
    const kept = [];
    const removedLabels = new Set();
    const removedIds = new Set();
    for (const group of normalizeUserDismissedGroups(groups)) {
        const matchesId = group.ids.some(id => targetIds.has(id));
        // Callers handling automatic/import identity reconciliation can require modern
        // tombstones to match by stable id. The default keeps the public/manual helper
        // backward-compatible for an explicit name-based resurrection action.
        const matchesLabel = (!modernByIdOnly || !group.ids.length) && group.labels.some(label => targetLabels.has(label));
        if (matchesId || matchesLabel) {
            for (const label of group.labels) removedLabels.add(label);
            for (const id of group.ids) removedIds.add(id);
        } else kept.push(group);
    }
    return { groups: kept, removedLabels: [...removedLabels], removedIds: [...removedIds] };
}

function enforceUserDismissals(state, groups) {
    const normalizedGroups = normalizeUserDismissedGroups(groups);
    const blockedIds = new Set(normalizedGroups.flatMap(group => group.ids));
    const legacyBlockedLabels = new Set(normalizedGroups.filter(group => !group.ids.length).flatMap(group => group.labels));
    state.userDismissedGroups = normalizedGroups;
    if (!blockedIds.size && !legacyBlockedLabels.size) return state;
    const blockedNpc = npc => blockedIds.has(String(npc?.id || ''))
        || npcLabels(npc).some(label => legacyBlockedLabels.has(label));
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
    // Modern permanent deletion tombstones are ID-backed. Do not seed their labels into
    // narrative `dismissed`, or a different future NPC with the same name would be suppressed.
    const existingDismissed = (Array.isArray(state.dismissed) ? state.dismissed : []).map(normalizeName).filter(Boolean);
    state.dismissed = [...new Set([...existingDismissed, ...legacyBlockedLabels])];
    return state;
}

export function preserveUserNpcMetadata(restoredNpcs = [], currentNpcs = []) {
    const restored = cloneNpcList(restoredNpcs);
    const globallyPreserved = [
        'portraitPromptPositive', 'portraitPromptNegative', 'portraitPromptReplace',
        'retentionProtected', 'minor', 'importance',
    ];
    for (const npc of restored) {
        const current = findNpcForMetadataRestore(npc, currentNpcs);
        if (!current) continue;
        if (current?.portrait?.dataUrl) npc.portrait = structuredClone(current.portrait);
        for (const field of globallyPreserved) {
            if (Object.prototype.hasOwnProperty.call(current, field)) npc[field] = structuredClone(current[field]);
        }
        if (current.manualProfileLocksExplicit) {
            const locked = Array.isArray(current.manualProfileFields) ? [...current.manualProfileFields] : [];
            for (const field of locked) {
                if (Object.prototype.hasOwnProperty.call(current, field)) npc[field] = structuredClone(current[field]);
            }
            npc.manualProfileFields = locked;
            npc.manualProfileLocksExplicit = true;
            if (locked.includes('name')) npc.aliases = structuredClone(current.aliases || npc.aliases || []);
        }
    }
    return restored;
}

export function preservePortraitAssets(restoredNpcs = [], currentNpcs = []) {
    return preserveUserNpcMetadata(restoredNpcs, currentNpcs);
}

function normalizeCheckpoint(checkpoint, activeLineage = []) {
    if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.snapshot || typeof checkpoint.snapshot !== 'object') return null;
    const messageId = Number(checkpoint.messageId);
    if (!Number.isInteger(messageId) || messageId < 0) return null;
    const fallbackFingerprint = activeLineage[messageId] || '';
    const fingerprint = String(checkpoint.fingerprint || fallbackFingerprint);
    let lineageKey = String(checkpoint.lineageKey || checkpoint.branchKey || '');
    if (!lineageKey && fallbackFingerprint && (!checkpoint.fingerprint || checkpoint.fingerprint === fallbackFingerprint)) {
        lineageKey = lineageCheckpointKey(activeLineage, messageId);
    }
    if (!lineageKey) return null;
    return {
        ...checkpoint,
        messageId,
        fingerprint,
        lineageKey,
        parentLineageKey: String(checkpoint.parentLineageKey || (messageId > 0 ? lineageCheckpointKey(activeLineage, messageId - 1) : 'root')),
        reason: String(checkpoint.reason || 'state'),
        createdAt: Number(checkpoint.createdAt || 0) || Date.now(),
    };
}

export function normalizeBranchCheckpoints(checkpoints = [], activeLineage = []) {
    const byKey = new Map();
    for (const raw of Array.isArray(checkpoints) ? checkpoints : []) {
        const checkpoint = normalizeCheckpoint(raw, activeLineage);
        if (!checkpoint) continue;
        const existing = byKey.get(checkpoint.lineageKey);
        if (!existing || checkpoint.createdAt >= existing.createdAt) byKey.set(checkpoint.lineageKey, checkpoint);
    }
    return [...byKey.values()];
}

export function migrateLegacyBranchState(state, chat, limit = BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    if (Number(state.branchLineageVersion || 0) >= BRANCH_LINEAGE_VERSION) return state;
    const messages = Array.isArray(chat) ? chat : [];
    const contentLineage = chatLineage(messages);
    const legacyCurrentLineage = messages.map(legacyFingerprintMessageV0210);
    const storedLegacyLineage = Array.isArray(state.lineage) ? state.lineage : [];
    const keys = lineageCheckpointKeys(contentLineage);
    const prefixMatches = messageId => {
        if (!Number.isInteger(messageId) || messageId < 0 || messageId >= contentLineage.length) return false;
        for (let i = 0; i <= messageId; i += 1) {
            if (!storedLegacyLineage[i] || storedLegacyLineage[i] !== legacyCurrentLineage[i]) return false;
        }
        return true;
    };

    const migratedCheckpoints = [];
    for (const raw of Array.isArray(state.checkpoints) ? state.checkpoints : []) {
        if (!raw || typeof raw !== 'object' || !raw.snapshot || typeof raw.snapshot !== 'object') continue;
        if (raw.lineageKey || raw.branchKey) {
            migratedCheckpoints.push(raw);
            continue;
        }
        const messageId = Number(raw.messageId);
        if (!prefixMatches(messageId)) continue;
        if (raw.fingerprint && raw.fingerprint !== legacyCurrentLineage[messageId]) continue;
        migratedCheckpoints.push({
            ...raw,
            messageId,
            fingerprint: contentLineage[messageId],
            lineageKey: keys[messageId],
            parentLineageKey: messageId > 0 ? keys[messageId - 1] : 'root',
            reason: String(raw.reason || 'legacy-migrated'),
        });
    }

    state.checkpoints = pruneBranchCheckpoints(migratedCheckpoints, contentLineage, limit);
    state.inlineCards = (Array.isArray(state.inlineCards) ? state.inlineCards : []).map(entry => {
        if (!entry || typeof entry !== 'object' || entry.lineageKey) return entry;
        const messageId = Number(entry.messageId);
        if (!prefixMatches(messageId)) return null;
        if (entry.fingerprint && entry.fingerprint !== legacyCurrentLineage[messageId]) return null;
        return {
            ...entry,
            messageId,
            fingerprint: contentLineage[messageId],
            lineageKey: keys[messageId],
        };
    }).filter(Boolean);
    state.lineage = contentLineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    return state;
}

export function pruneBranchCheckpoints(checkpoints = [], activeLineage = [], limit = BRANCH_HISTORY_LIMIT) {
    const cap = Math.max(8, Number(limit) || BRANCH_HISTORY_LIMIT);
    const normalized = normalizeBranchCheckpoints(checkpoints, activeLineage);
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
            const newestActive = active.slice(-Math.max(1, activeBudget - 1));
            for (const item of newestActive) keep.set(item.lineageKey, item);
        }
        for (const item of siblings.slice(0, siblingBudget)) keep.set(item.lineageKey, item);
        if (!active.length) for (const item of normalized.slice(-cap)) keep.set(item.lineageKey, item);
    }

    let selected = [...keep.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
    const sizeOf = item => {
        try { return JSON.stringify(item?.snapshot || {}).length + 256; }
        catch { return BRANCH_SNAPSHOT_BUDGET_CHARS; }
    };
    let used = selected.reduce((sum, item) => sum + sizeOf(item), 0);
    if (used <= BRANCH_SNAPSHOT_BUDGET_CHARS) return selected;

    // Preserve one ancient active anchor plus the newest useful checkpoints. Older redundant
    // snapshots are safely discarded; reconciliation can rescan from the retained ancestor.
    const budgeted = new Map();
    used = 0;
    const oldestActive = selected.find(item => activeKeys.has(item.lineageKey)) || null;
    if (oldestActive) {
        budgeted.set(oldestActive.lineageKey, oldestActive);
        used += sizeOf(oldestActive);
    }
    const newestFirst = [...selected].sort((a, b) => b.createdAt - a.createdAt || b.messageId - a.messageId);
    for (const item of newestFirst) {
        if (budgeted.has(item.lineageKey)) continue;
        const size = sizeOf(item);
        if (budgeted.size && used + size > BRANCH_SNAPSHOT_BUDGET_CHARS) continue;
        budgeted.set(item.lineageKey, item);
        used += size;
    }
    if (!budgeted.size && newestFirst.length) budgeted.set(newestFirst[0].lineageKey, newestFirst[0]);
    return [...budgeted.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
}

export function ensureBranchParentAnchor(state, chat, messageId, reason = 'parent-anchor', limit = BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object' || !Number.isInteger(messageId) || messageId < 0) return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    if (messageId === 0) {
        if (!state.branchRootSnapshot || typeof state.branchRootSnapshot !== 'object') {
            state.branchRootSnapshot = snapshotBranchState(state);
        }
        return state;
    }
    if (messageId > lineage.length - 1) return state;
    const keys = lineageCheckpointKeys(lineage);
    const parentId = messageId - 1;
    const parentKey = keys[parentId];
    const checkpoints = normalizeBranchCheckpoints(state.checkpoints, lineage);
    if (!checkpoints.some(item => item.lineageKey === parentKey)) {
        checkpoints.push({
            messageId: parentId,
            fingerprint: lineage[parentId],
            lineageKey: parentKey,
            parentLineageKey: parentId > 0 ? keys[parentId - 1] : 'root',
            reason: String(reason || 'parent-anchor'),
            createdAt: Date.now(),
            snapshot: snapshotBranchState(state),
        });
    }
    state.checkpoints = pruneBranchCheckpoints(checkpoints, lineage, limit);
    return state;
}

export function recordBranchCheckpoint(state, chat, messageId, reason = 'state', limit = BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object') return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length) return state;
    const keys = lineageCheckpointKeys(lineage);
    if (!Array.isArray(state.checkpoints)) state.checkpoints = [];
    const checkpoint = {
        messageId,
        fingerprint: lineage[messageId],
        lineageKey: keys[messageId],
        parentLineageKey: messageId > 0 ? keys[messageId - 1] : 'root',
        reason: String(reason || 'state'),
        createdAt: Date.now(),
        snapshot: snapshotBranchState(state),
    };
    const checkpoints = normalizeBranchCheckpoints(state.checkpoints, lineage);
    const existingIndex = checkpoints.findIndex(item => item.lineageKey === checkpoint.lineageKey);
    if (existingIndex >= 0) checkpoints[existingIndex] = checkpoint;
    else checkpoints.push(checkpoint);
    state.checkpoints = pruneBranchCheckpoints(checkpoints, lineage, limit);
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
    const currentLineage = chatLineage(chat);
    const previousLineage = Array.isArray(state?.lineage) ? state.lineage : [];
    let divergence = firstLineageDivergence(previousLineage, currentLineage);
    if (Number.isInteger(explicitDivergence) && explicitDivergence >= 0) {
        divergence = divergence < 0 ? explicitDivergence : Math.min(divergence, explicitDivergence);
    }

    if (divergence < 0) {
        return { state: { ...state, lineage: currentLineage }, divergence: -1, restoredFromMessageId: null, invalidated: false, exactRestored: false };
    }

    const currentNpcs = cloneNpcList(state?.npcs);
    const checkpoints = normalizeBranchCheckpoints(state?.checkpoints, previousLineage);
    const matches = matchingCheckpoints(checkpoints, currentLineage);
    const deepestMatch = matches.at(-1) || null;
    const lastAssistantId = latestAssistantMessageId(chat);
    const exactCheckpoint = deepestMatch && deepestMatch.messageId >= lastAssistantId ? deepestMatch : null;

    let restored;
    let checkpoint;
    let exactRestored = false;
    if (exactCheckpoint) {
        checkpoint = exactCheckpoint;
        restored = restoreSnapshotIntoState(state, checkpoint.snapshot);
        exactRestored = true;
    } else {
        checkpoint = deepestMatch || null;
        // Old pre-checkpoint state is preserved rather than destructively zeroed. New state
        // keeps a root anchor, so this path should normally be limited to legacy/pruned data.
        restored = checkpoint
            ? restoreSnapshotIntoState(state, checkpoint.snapshot)
            : (state?.branchRootSnapshot && typeof state.branchRootSnapshot === 'object'
                ? restoreSnapshotIntoState(state, state.branchRootSnapshot)
                : { ...state, processedOocMessageId: null, lastScannedMessageId: null, assistantSinceScan: 0 });
    }

    restored.npcs = preserveUserNpcMetadata(restored.npcs, currentNpcs);
    enforceUserDismissals(restored, state?.userDismissedGroups);
    restored.lineage = currentLineage;
    restored.checkpoints = pruneBranchCheckpoints(checkpoints, currentLineage);
    // Inline-card history is branch-keyed independently and must retain sibling entries.
    restored.inlineCards = Array.isArray(state?.inlineCards) ? structuredClone(state.inlineCards) : [];

    if (!exactRestored) {
        if (Number.isInteger(restored.lastScannedMessageId) && restored.lastScannedMessageId >= divergence) restored.lastScannedMessageId = null;
        if (Number.isInteger(restored.processedOocMessageId) && restored.processedOocMessageId >= divergence) restored.processedOocMessageId = null;
    }

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

export function bestAncestorState(chats = {}, currentKey = '', currentChat = []) {
    const lineage = chatLineage(currentChat);
    const currentKeys = lineageCheckpointKeys(lineage);
    let best = null;
    for (const [key, state] of Object.entries(chats || {})) {
        if (key === currentKey || !state || !Array.isArray(state.lineage) || !Array.isArray(state.checkpoints)) continue;
        const prefixLength = commonPrefixLength(state.lineage, lineage);
        if (prefixLength < 4) continue;
        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);
        if (sharedPrefix.filter(message => message?.is_user).length < 2) continue;
        const checkpoints = normalizeBranchCheckpoints(state.checkpoints, state.lineage);
        const checkpoint = checkpoints
            .filter(item => item.messageId < prefixLength && item.lineageKey === currentKeys[item.messageId])
            .sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt)
            .at(-1);
        if (!checkpoint) continue;
        if (!best || checkpoint.messageId > best.checkpoint.messageId) best = { key, state, checkpoint, prefixLength, checkpoints };
    }
    if (!best) return null;
    const inherited = restoreSnapshotIntoState({}, best.checkpoint.snapshot);
    inherited.lineage = lineage;
    inherited.checkpoints = pruneBranchCheckpoints(
        best.checkpoints.filter(item => item.messageId <= best.checkpoint.messageId && item.lineageKey === currentKeys[item.messageId]),
        lineage,
    );
    inherited.inlineCards = structuredClone((best.state.inlineCards || []).filter(item => {
        const messageId = Number(item?.messageId);
        if (!Number.isInteger(messageId) || messageId > best.checkpoint.messageId) return false;
        return !item.lineageKey || item.lineageKey === currentKeys[messageId];
    }));
    inherited.portraitAssets = structuredClone(best.state.portraitAssets || {});
    inherited.userDismissedGroups = structuredClone(normalizeUserDismissedGroups(best.state.userDismissedGroups));
    enforceUserDismissals(inherited, inherited.userDismissedGroups);
    inherited.branchParent = best.key;
    inherited.branchForkMessageId = best.checkpoint.messageId;
    return inherited;
}
