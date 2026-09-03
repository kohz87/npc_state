export const NPC_STATE_VERSION = '0.3.1';
export const NPC_STATE_SCHEMA_VERSION = 1;
export const RELATIONSHIP_AXES = Object.freeze(['trust', 'affection', 'desire', 'tension']);
export const STABLE_PROFILE_FIELDS = Object.freeze([
    'name', 'aliases', 'role', 'species', 'age', 'apparentAge', 'appearance',
    'personality', 'behaviorProfile', 'speech', 'mannerisms', 'background', 'keyRelationships',
]);
export const DEFAULT_RELATIONSHIP = Object.freeze({ trust: 0, affection: 0, desire: 0, tension: 0 });
export const DEFAULT_RELATIONSHIP_CAPS = Object.freeze({ ordinary: 1, meaningful: 2, major: 5, extreme: 10 });
export const MEMORY_LIMIT = 5;
export const KEY_RELATIONSHIP_LIMIT = 12;
export const MANNERISM_LIMIT = 8;
export const BEHAVIOR_PROFILE_LIMIT = 8;
export const DOSSIER_LIMIT_DEFAULTS = Object.freeze({
    memories: MEMORY_LIMIT,
    keyRelationships: KEY_RELATIONSHIP_LIMIT,
    mannerisms: MANNERISM_LIMIT,
    behaviorProfile: BEHAVIOR_PROFILE_LIMIT,
});
export const DOSSIER_LIMIT_MAXIMUMS = Object.freeze({
    memories: 20,
    keyRelationships: 30,
    mannerisms: 16,
    behaviorProfile: 16,
});
export const CHECKPOINT_LIMIT = 48;

function text(value, max = 1200) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max = 12, itemMax = 500) {
    const input = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const out = [];
    const seen = new Set();
    for (const item of input) {
        const clean = text(item, itemMax);
        const key = clean.toLocaleLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out;
}

function clampRelationship(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.round(number))) : 0;
}

function normalizeSocialEdges(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of value) {
        const fromId = text(raw?.fromId, 160);
        const toId = text(raw?.toId, 160);
        const relation = text(raw?.relation, 160);
        if (!fromId || !toId || fromId === toId || !relation) continue;
        const key = `${fromId}\0${toId}\0${normalizeName(relation)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            fromId,
            toId,
            relation,
            summary: text(raw?.summary, 500),
            updatedAt: Number(raw?.updatedAt) || Date.now(),
            sourceMessageId: Number.isInteger(raw?.sourceMessageId) ? raw.sourceMessageId : null,
        });
        if (out.length >= 200) break;
    }
    return out;
}

export function normalizeName(value) {
    return text(value, 160).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
}

export function normalizeApparentAge(value) {
    const raw = text(value, 80);
    if (!raw) return '';
    // Apparent age is deliberately one approximate number, never a decade or range.
    if (/\b\d{1,4}\s*['’]?\s*s\b/i.test(raw)) return '';
    const matches = [...raw.matchAll(/(^|[^\d])(\d{1,4})(?!\d)/g)].map(match => Number(match[2]));
    if (matches.length !== 1 || !Number.isInteger(matches[0]) || matches[0] < 0) return '';
    return `~${matches[0]}`;
}

export function normalizeDossierLimits(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.keys(DOSSIER_LIMIT_DEFAULTS).map(key => {
        const number = Math.round(Number(source[key]));
        const fallback = DOSSIER_LIMIT_DEFAULTS[key];
        const maximum = DOSSIER_LIMIT_MAXIMUMS[key];
        return [key, Number.isFinite(number) ? Math.max(1, Math.min(maximum, number)) : fallback];
    }));
}

export function makeNpcId(name = 'npc', nonce = '') {
    const slug = text(name, 60).normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLocaleLowerCase().slice(0, 36) || 'npc';
    const seed = `${name}\0${nonce || `${Date.now()}-${Math.random()}`}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `npc-${slug}-${(hash >>> 0).toString(36)}`;
}

export function normalizeRelationship(value = {}) {
    return Object.fromEntries(RELATIONSHIP_AXES.map(axis => [axis, clampRelationship(value?.[axis])]));
}

export function emptyRelationshipChange() {
    return {
        impact: 'none',
        delta: { ...DEFAULT_RELATIONSHIP },
        evidence: '',
        reason: '',
        sourceMessageId: null,
        turn: null,
        at: null,
    };
}

export function normalizeNpc(input = {}, options = {}) {
    const now = Number(options.now) || Date.now();
    const name = text(input.name || input.label || 'Unknown NPC', 120);
    const id = text(input.id, 160) || makeNpcId(name, options.nonce);
    const locked = new Set(list(input.manualProfileFields, STABLE_PROFILE_FIELDS.length, 80));
    const archiveReason = text(input.archiveReason, 80);
    const archived = input.archived === true;
    const relationshipHistory = Array.isArray(input.relationshipHistory) ? input.relationshipHistory.slice(-24).map(item => ({
        impact: ['none', 'ordinary', 'meaningful', 'major', 'extreme', 'manual'].includes(String(item?.impact)) ? String(item.impact) : 'ordinary',
        delta: normalizeRelationship(item?.delta),
        evidence: text(item?.evidence, 800),
        reason: text(item?.reason, 800),
        sourceMessageId: Number.isInteger(item?.sourceMessageId) ? item.sourceMessageId : null,
        turn: Number.isInteger(item?.turn) ? item.turn : null,
        at: Number(item?.at) || now,
    })) : [];
    return {
        id,
        name,
        aliases: list(input.aliases, 10, 120).filter(alias => normalizeName(alias) !== normalizeName(name)),
        role: text(input.role, 240),
        species: text(input.species, 160),
        age: text(input.age, 80),
        apparentAge: normalizeApparentAge(input.apparentAge),
        appearance: text(input.appearance, 1800),
        personality: text(input.personality, 1200),
        behaviorProfile: list(input.behaviorProfile, DOSSIER_LIMIT_MAXIMUMS.behaviorProfile, 360),
        speech: text(input.speech, 900),
        mannerisms: list(input.mannerisms, DOSSIER_LIMIT_MAXIMUMS.mannerisms, 280),
        background: text(input.background, 1600),
        keyRelationships: list(input.keyRelationships, DOSSIER_LIMIT_MAXIMUMS.keyRelationships, 500),
        memories: list(input.memories, DOSSIER_LIMIT_MAXIMUMS.memories, 700),
        relationship: normalizeRelationship(input.relationship || DEFAULT_RELATIONSHIP),
        relationshipSummary: text(input.relationshipSummary, 1000),
        relationshipHistory,
        lastRelationshipChange: input.lastRelationshipChange ? {
            ...emptyRelationshipChange(),
            impact: ['none', 'ordinary', 'meaningful', 'major', 'extreme', 'manual'].includes(String(input.lastRelationshipChange.impact)) ? String(input.lastRelationshipChange.impact) : 'none',
            delta: normalizeRelationship(input.lastRelationshipChange.delta),
            evidence: text(input.lastRelationshipChange.evidence, 800),
            reason: text(input.lastRelationshipChange.reason, 800),
            sourceMessageId: Number.isInteger(input.lastRelationshipChange.sourceMessageId) ? input.lastRelationshipChange.sourceMessageId : null,
            turn: Number.isInteger(input.lastRelationshipChange.turn) ? input.lastRelationshipChange.turn : null,
            at: Number(input.lastRelationshipChange.at) || null,
        } : emptyRelationshipChange(),
        mood: text(input.mood, 240),
        location: text(input.location, 360),
        goal: text(input.goal, 600),
        status: text(input.status, 360),
        present: archived ? false : input.present === true,
        worldActive: archived ? false : input.worldActive === true,
        lifeState: ['alive', 'dead', 'unknown'].includes(String(input.lifeState)) ? String(input.lifeState) : 'unknown',
        lifeStateCertainty: text(input.lifeStateCertainty, 80),
        lifeStateReason: text(input.lifeStateReason, 500),
        archived,
        archiveReason,
        archivedAt: archived ? (Number(input.archivedAt) || now) : null,
        importance: Math.max(0, Math.min(100, Math.round(Number(input.importance) || 0))),
        manualProfileFields: STABLE_PROFILE_FIELDS.filter(field => locked.has(field)),
        retentionProtected: input.retentionProtected === true,
        minor: input.minor === true,
        portrait: input.portrait && typeof input.portrait === 'object' ? structuredClone(input.portrait) : null,
        createdAt: Number(input.createdAt) || now,
        updatedAt: Number(input.updatedAt) || now,
        firstSeenMessageId: Number.isInteger(input.firstSeenMessageId) ? input.firstSeenMessageId : null,
        lastSeenMessageId: Number.isInteger(input.lastSeenMessageId) ? input.lastSeenMessageId : null,
        lastInteractionMessageId: Number.isInteger(input.lastInteractionMessageId) ? input.lastInteractionMessageId : null,
        lastActivityTurn: Number.isInteger(input.lastActivityTurn) ? Math.max(0, input.lastActivityTurn) : null,
        lastActivityMessageId: Number.isInteger(input.lastActivityMessageId) ? input.lastActivityMessageId : null,
        lastActivityReason: text(input.lastActivityReason, 80),
        seenCount: Math.max(0, Math.round(Number(input.seenCount) || 0)),
        manual: input.manual === true,
    };
}

export function createEmptyState(chatKey = '') {
    return {
        schemaVersion: NPC_STATE_SCHEMA_VERSION,
        appVersion: NPC_STATE_VERSION,
        chatKey: String(chatKey || ''),
        revision: 0,
        turn: 0,
        lastScannedMessageId: null,
        npcs: [],
        socialGraph: [],
        suppressedNames: [],
        deletedNpcIds: [],
        lastObservation: {
            messageId: null,
            exchangeActiveNpcIds: [],
            finalPresentNpcIds: [],
            worldActiveNpcIds: [],
            targetNpcIds: [],
        },
        checkpoints: [],
        branchBase: null,
        branchHeadLineage: [],
        branchSafety: { status: 'safe', reason: '' },
        migration: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function normalizeState(input = {}, chatKey = '') {
    const base = createEmptyState(chatKey || input.chatKey || '');
    const dedup = new Map();
    for (const raw of Array.isArray(input.npcs) ? input.npcs : []) {
        const npc = normalizeNpc(raw);
        if (dedup.has(npc.id)) continue;
        dedup.set(npc.id, npc);
    }
    const suppressedNames = list(input.suppressedNames || input.dismissed, 300, 160);
    const deletedNpcIds = list(input.deletedNpcIds, 500, 160);
    const observation = input.lastObservation && typeof input.lastObservation === 'object' ? input.lastObservation : {};
    const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints.slice(-CHECKPOINT_LIMIT).map(item => ({
        messageId: Number.isInteger(item?.messageId) ? item.messageId : null,
        lineage: Array.isArray(item?.lineage) ? item.lineage.map(value => String(value || '')).filter(Boolean) : [],
        reason: text(item?.reason, 80),
        createdAt: Number(item?.createdAt) || Date.now(),
        snapshot: item?.snapshot && typeof item.snapshot === 'object' ? structuredClone(item.snapshot) : null,
    })).filter(item => item.messageId !== null && item.snapshot) : [];
    const rawBranchBase = input.branchBase && typeof input.branchBase === 'object' ? input.branchBase : null;
    const branchBase = rawBranchBase?.snapshot && Array.isArray(rawBranchBase.lineage)
        ? {
            messageId: Number.isInteger(rawBranchBase.messageId) ? rawBranchBase.messageId : null,
            lineage: rawBranchBase.lineage.map(value => String(value || '')).filter(Boolean),
            createdAt: Number(rawBranchBase.createdAt) || Date.now(),
            snapshot: structuredClone(rawBranchBase.snapshot),
        }
        : null;
    const rawSafety = input.branchSafety && typeof input.branchSafety === 'object' ? input.branchSafety : {};
    const branchSafetyStatus = ['safe', 'prebaseline-diverged'].includes(String(rawSafety.status)) ? String(rawSafety.status) : 'safe';
    return {
        ...base,
        schemaVersion: NPC_STATE_SCHEMA_VERSION,
        appVersion: NPC_STATE_VERSION,
        chatKey: String(chatKey || input.chatKey || ''),
        revision: Math.max(0, Math.trunc(Number(input.revision) || 0)),
        turn: Math.max(0, Math.trunc(Number(input.turn) || 0)),
        lastScannedMessageId: Number.isInteger(input.lastScannedMessageId) ? input.lastScannedMessageId : null,
        npcs: [...dedup.values()],
        socialGraph: normalizeSocialEdges(input.socialGraph),
        suppressedNames,
        deletedNpcIds,
        lastObservation: {
            messageId: Number.isInteger(observation.messageId) ? observation.messageId : null,
            exchangeActiveNpcIds: list(observation.exchangeActiveNpcIds, 100, 160),
            finalPresentNpcIds: list(observation.finalPresentNpcIds, 100, 160),
            worldActiveNpcIds: list(observation.worldActiveNpcIds, 100, 160),
            targetNpcIds: list(observation.targetNpcIds, 100, 160),
        },
        checkpoints,
        branchBase,
        branchHeadLineage: Array.isArray(input.branchHeadLineage) ? input.branchHeadLineage.map(value => String(value || '')).filter(Boolean) : [],
        branchSafety: {
            status: branchSafetyStatus,
            reason: text(rawSafety.reason, 500),
        },
        migration: input.migration && typeof input.migration === 'object' ? structuredClone(input.migration) : null,
        createdAt: Number(input.createdAt) || Date.now(),
        updatedAt: Number(input.updatedAt) || Date.now(),
    };
}

export function npcMatchesReference(npc, reference) {
    const raw = String(reference ?? '').trim();
    if (!npc || !raw) return false;
    if (npc.id === raw) return true;
    const key = normalizeName(raw);
    if (!key) return false;
    if (normalizeName(npc.name) === key) return true;
    return (npc.aliases || []).some(alias => normalizeName(alias) === key);
}

export function findNpcByReference(state, reference) {
    return (state?.npcs || []).find(npc => npcMatchesReference(npc, reference)) || null;
}

export function snapshotForCheckpoint(state) {
    const copy = normalizeState(state, state?.chatKey || '');
    copy.checkpoints = [];
    copy.branchBase = null;
    return copy;
}
