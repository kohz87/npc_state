import { createEmptyState, normalizeNpc, normalizeState } from './schema.js';

function dedupeNames(values = []) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const clean = String(value || '').trim();
        const key = clean.toLocaleLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
    }
    return out;
}

export function migrateV02State(oldState = {}, chatKey = '') {
    const next = createEmptyState(chatKey);
    const portraitAssets = oldState?.portraitAssets && typeof oldState.portraitAssets === 'object' ? oldState.portraitAssets : {};
    next.npcs = (Array.isArray(oldState.npcs) ? oldState.npcs : []).map(raw => normalizeNpc({
        ...raw,
        lifeState: raw?.lifeState === 'deceased' ? 'dead' : raw?.lifeState,
        portrait: raw?.portrait || portraitAssets?.[raw?.id] || null,
    }));
    next.turn = Math.max(0, Math.trunc(Number(oldState.turn) || 0));
    next.lastScannedMessageId = Number.isInteger(oldState.lastScannedMessageId) ? oldState.lastScannedMessageId : null;
    next.suppressedNames = dedupeNames(oldState.dismissed || oldState.suppressedNames || []);
    const tombstones = new Set(Array.isArray(oldState.deletedNpcIds) ? oldState.deletedNpcIds.map(String) : []);
    for (const group of Array.isArray(oldState.userDismissedGroups) ? oldState.userDismissedGroups : []) {
        if (group?.npcId) tombstones.add(String(group.npcId));
        for (const id of Array.isArray(group?.ids) ? group.ids : []) if (id) tombstones.add(String(id));
    }
    next.deletedNpcIds = [...tombstones];
    next.npcs = next.npcs.filter(npc => !tombstones.has(npc.id));
    const rawEdges = Array.isArray(oldState.socialGraph)
        ? oldState.socialGraph
        : (Array.isArray(oldState.socialGraph?.edges) ? oldState.socialGraph.edges : []);
    next.socialGraph = rawEdges.flatMap(raw => {
        if (raw?.fromId && raw?.toId && raw?.relation) return [{
            fromId: raw.fromId, toId: raw.toId, relation: raw.relation, summary: raw.summary || '',
            updatedAt: raw.updatedAt, sourceMessageId: raw.sourceMessageId,
        }];
        const aId = String(raw?.aId ?? raw?.a_id ?? '').trim();
        const bId = String(raw?.bId ?? raw?.b_id ?? '').trim();
        if (!aId || !bId || aId === bId) return [];
        const forward = String(raw?.aToB ?? raw?.a_to_b ?? raw?.relation ?? '').trim();
        const reverse = String(raw?.bToA ?? raw?.b_to_a ?? raw?.reverseRelation ?? '').trim();
        const edges = [];
        if (forward) edges.push({ fromId: aId, toId: bId, relation: forward, summary: String(raw?.aDynamic ?? raw?.a_dynamic ?? raw?.reason ?? '').trim(), updatedAt: raw?.updatedAt, sourceMessageId: raw?.sourceMessageId });
        if (reverse) edges.push({ fromId: bId, toId: aId, relation: reverse, summary: String(raw?.bDynamic ?? raw?.b_dynamic ?? raw?.reason ?? '').trim(), updatedAt: raw?.updatedAt, sourceMessageId: raw?.sourceMessageId });
        return edges;
    }).slice(-200);
    next.migration = {
        source: 'v0.2.x',
        importedAt: Date.now(),
        sourceSchemaVersion: Number(oldState.schemaVersion) || null,
        note: 'Current dossiers imported. Legacy runtime queues and branch checkpoints were intentionally not imported.',
    };
    return normalizeState(next, chatKey);
}

export async function readLegacyV02Sidecar({ chatKey, pointer, fetchFn = globalThis.fetch }) {
    if (!pointer?.path) return null;
    const response = await fetchFn(pointer.path, { method: 'GET', cache: 'no-store' });
    if (response?.status === 404) return null;
    if (!response?.ok) throw new Error(`Legacy NPC State sidecar read failed with HTTP ${response?.status || 'error'}.`);
    let payload;
    try { payload = JSON.parse(await response.text()); }
    catch { throw new Error('Legacy NPC State sidecar contains invalid JSON.'); }
    if (payload?.format !== 'npc_state_chat_data' || payload?.formatVersion !== 1 || !payload?.state) throw new Error('Legacy NPC State sidecar has an unsupported format.');
    if (payload.chatKey && String(payload.chatKey) !== String(chatKey)) throw new Error('Legacy NPC State sidecar belongs to a different chat.');
    return { payload, state: migrateV02State(payload.state, chatKey) };
}
