export const RELATIONSHIP_HISTORY_DEFAULT = 8;
export const RELATIONSHIP_HISTORY_MIN = 1;
export const RELATIONSHIP_HISTORY_MAX = 24;

export function normalizeRelationshipHistoryLimit(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return RELATIONSHIP_HISTORY_DEFAULT;
    return Math.max(RELATIONSHIP_HISTORY_MIN, Math.min(RELATIONSHIP_HISTORY_MAX, number));
}

export function trimRelationshipHistory(npc, limit = RELATIONSHIP_HISTORY_DEFAULT) {
    if (!npc || typeof npc !== 'object') return npc;
    const cap = normalizeRelationshipHistoryLimit(limit);
    const current = Array.isArray(npc.relationshipHistory) ? npc.relationshipHistory : [];
    if (current.length <= cap) return npc;
    const next = structuredClone(npc);
    next.relationshipHistory = current.slice(-cap);
    return next;
}

export function trimStateRelationshipHistory(state, limit = RELATIONSHIP_HISTORY_DEFAULT) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.npcs)) return state;
    const cap = normalizeRelationshipHistoryLimit(limit);
    let changed = false;
    const npcs = state.npcs.map(npc => {
        const next = trimRelationshipHistory(npc, cap);
        if (next !== npc) changed = true;
        return next;
    });
    if (!changed) return state;
    const next = structuredClone(state);
    next.npcs = npcs;
    return next;
}

export function relationshipAxisIndependencePrompt() {
    return [
        'RELATIONSHIP AXIS INDEPENDENCE:',
        '- Score trust, affection, desire, and tension independently. Do not spread one general positive or negative impression across several axes just to make the reaction feel stronger.',
        '- Change an axis only when the CURRENT exchange contains distinct evidence for that specific axis.',
        '- Multiple axes may change from one event only when there is separate concrete evidence for each affected axis.',
        '- A change on one axis does not automatically imply a matching or opposite change on another axis.',
    ].join('\n');
}
