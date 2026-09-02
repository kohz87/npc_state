import { normalizeName, normalizeNpc, normalizeState } from './schema.js';

export const DEFAULT_STALE_ARCHIVE_AFTER = 30;
export const DEFAULT_STALE_DELETE_AFTER = 50;

function integer(value, fallback, min = 0, max = 10000) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeStaleSettings(settings = {}) {
    const archiveAfter = integer(settings.staleArchiveAfter, DEFAULT_STALE_ARCHIVE_AFTER, 1);
    const deleteAfter = integer(settings.staleDeleteAfter, DEFAULT_STALE_DELETE_AFTER, archiveAfter + 1);
    return {
        enabled: settings.staleManagementEnabled !== false,
        archiveAfter,
        deleteAfter: Math.max(archiveAfter + 1, deleteAfter),
    };
}

export function narrativeTurnForMessage(chat = [], messageId = null) {
    const end = Number.isInteger(messageId) ? Math.min(messageId, chat.length - 1) : chat.length - 1;
    if (end < 0) return 0;
    let turn = 0;
    for (let i = 0; i <= end; i += 1) {
        const message = chat[i];
        if (message && !message.is_system && !message.is_user) turn += 1;
    }
    return turn;
}

export function referencedNpcIdsFromExchange(state = {}, exchange = null) {
    const source = `${String(exchange?.user?.mes || '')}\n${String(exchange?.assistant?.mes || '')}`;
    const haystack = ` ${normalizeName(source)} `;
    if (!haystack.trim()) return [];
    const ids = [];
    for (const npc of state?.npcs || []) {
        const labels = [npc.name, ...(npc.aliases || [])]
            .map(value => normalizeName(value))
            .filter(value => value.length >= 2);
        if (labels.some(label => haystack.includes(` ${label} `))) ids.push(npc.id);
    }
    return [...new Set(ids)];
}

export function retentionProtectionReasons(npc = {}) {
    const reasons = [];
    if (npc.retentionProtected === true) reasons.push('retention-protected');
    if (Array.isArray(npc.manualProfileFields) && npc.manualProfileFields.length) reasons.push('profile-locked');
    return reasons;
}

export function staleAge(npc = {}, currentTurn = 0) {
    if (!Number.isInteger(npc.lastActivityTurn)) return 0;
    return Math.max(0, integer(currentTurn, 0) - npc.lastActivityTurn);
}

function activityReason(id, activity = {}) {
    if ((activity.exchangeActiveNpcIds || []).includes(id)) return 'exchange';
    if ((activity.finalPresentNpcIds || []).includes(id)) return 'present';
    if ((activity.worldActiveNpcIds || []).includes(id)) return 'world-active';
    if ((activity.referencedNpcIds || []).includes(id)) return 'referenced';
    return '';
}

function reportStatus(npc, age, protectionReasons, settings) {
    if (protectionReasons.length) return 'protected';
    if (npc.archived && npc.archiveReason === 'stale') {
        return age >= settings.deleteAfter ? 'delete-eligible' : 'stale-archived';
    }
    if (npc.archived) return 'archived-other';
    if (age >= settings.archiveAfter) return 'archive-eligible';
    return 'active';
}

export function buildStaleReport(stateInput = {}, settingsInput = {}, currentTurn = 0) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const settings = normalizeStaleSettings(settingsInput);
    return state.npcs.map(npc => {
        const protectionReasons = retentionProtectionReasons(npc);
        const age = staleAge(npc, currentTurn);
        return {
            npcId: npc.id,
            name: npc.name,
            archived: npc.archived,
            archiveReason: npc.archiveReason,
            lastActivityTurn: Number.isInteger(npc.lastActivityTurn) ? npc.lastActivityTurn : null,
            lastActivityMessageId: Number.isInteger(npc.lastActivityMessageId) ? npc.lastActivityMessageId : null,
            lastActivityReason: npc.lastActivityReason || '',
            inactiveTurns: age,
            protectionReasons,
            status: reportStatus(npc, age, protectionReasons, settings),
            archiveAfter: settings.archiveAfter,
            deleteAfter: settings.deleteAfter,
        };
    }).sort((a, b) => {
        const priority = { 'delete-eligible': 0, 'stale-archived': 1, 'archive-eligible': 2, protected: 3, active: 4, 'archived-other': 5 };
        return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || b.inactiveTurns - a.inactiveTurns || a.name.localeCompare(b.name);
    });
}

export function applyStaleLifecycle(stateInput = {}, options = {}) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const settings = normalizeStaleSettings(options.settings || {});
    const currentTurn = integer(options.currentTurn, 0);
    const sourceMessageId = Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null;
    const activity = {
        exchangeActiveNpcIds: [...new Set(options.exchangeActiveNpcIds || [])],
        finalPresentNpcIds: [...new Set(options.finalPresentNpcIds || [])],
        worldActiveNpcIds: [...new Set(options.worldActiveNpcIds || [])],
        referencedNpcIds: [...new Set(options.referencedNpcIds || [])],
    };
    const activeIds = new Set([
        ...activity.exchangeActiveNpcIds,
        ...activity.finalPresentNpcIds,
        ...activity.worldActiveNpcIds,
        ...activity.referencedNpcIds,
    ]);
    const archivedIds = [];
    const restoredIds = [];
    const deletedIds = [];
    const initializedIds = [];
    const removed = new Set();
    const nextNpcs = [];

    for (const raw of state.npcs) {
        let npc = structuredClone(raw);
        const reason = activeIds.has(npc.id) ? activityReason(npc.id, activity) : '';
        if (reason) {
            const changed = npc.lastActivityTurn !== currentTurn || npc.lastActivityMessageId !== sourceMessageId || npc.lastActivityReason !== reason;
            npc.lastActivityTurn = currentTurn;
            npc.lastActivityMessageId = sourceMessageId;
            npc.lastActivityReason = reason;
            if (settings.enabled && npc.archived && npc.archiveReason === 'stale') {
                npc.archived = false;
                npc.archiveReason = '';
                npc.archivedAt = null;
                restoredIds.push(npc.id);
            }
            if (changed || restoredIds.includes(npc.id)) npc.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
            nextNpcs.push(normalizeNpc(npc));
            continue;
        }

        if (!Number.isInteger(npc.lastActivityTurn)) {
            npc.lastActivityTurn = currentTurn;
            npc.lastActivityMessageId = Number.isInteger(npc.lastActivityMessageId) ? npc.lastActivityMessageId : null;
            npc.lastActivityReason = npc.lastActivityReason || 'baseline';
            npc.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
            initializedIds.push(npc.id);
            nextNpcs.push(normalizeNpc(npc));
            continue;
        }

        const age = staleAge(npc, currentTurn);
        const protectedNpc = retentionProtectionReasons(npc).length > 0;
        if (!settings.enabled || protectedNpc) {
            nextNpcs.push(normalizeNpc(npc));
            continue;
        }

        if (!npc.archived && age >= settings.archiveAfter) {
            npc.archived = true;
            npc.archiveReason = 'stale';
            npc.archivedAt = Date.now();
            npc.present = false;
            npc.worldActive = false;
            npc.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
            archivedIds.push(npc.id);
            nextNpcs.push(normalizeNpc(npc));
            continue;
        }

        if (npc.archived && npc.archiveReason === 'stale' && age >= settings.deleteAfter) {
            // Automatic stale cleanup is deliberately softer than an explicit user deletion.
            // It does not create a permanent tombstone, so a genuine future return can be
            // admitted again and a branch rollback can recover the dossier on another timeline.
            removed.add(npc.id);
            deletedIds.push(npc.id);
            continue;
        }

        nextNpcs.push(normalizeNpc(npc));
    }

    state.npcs = nextNpcs;
    if (removed.size) state.socialGraph = (state.socialGraph || []).filter(edge => !removed.has(edge.fromId) && !removed.has(edge.toId));
    if (archivedIds.length || restoredIds.length || deletedIds.length || initializedIds.length) state.updatedAt = Date.now();

    return {
        state: normalizeState(state, state.chatKey),
        archivedIds,
        restoredIds,
        deletedIds,
        initializedIds,
        currentTurn,
        settings,
    };
}
