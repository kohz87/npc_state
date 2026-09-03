import {
    DEFAULT_RELATIONSHIP_CAPS,
    RELATIONSHIP_AXES,
    STABLE_PROFILE_FIELDS,
    findNpcByReference,
    makeNpcId,
    normalizeApparentAge,
    normalizeDossierLimits,
    normalizeName,
    normalizeNpc,
    normalizeRelationship,
    normalizeState,
} from './schema.js';

const IMPACTS = new Set(['none', 'ordinary', 'meaningful', 'major', 'extreme']);
const GENERIC_REFERENCES = new Set(['he', 'she', 'they', 'them', 'him', 'her', 'it', 'someone', 'somebody', 'npc', 'unknown npc']);

function compactText(value, max = 8000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function uniqueStrings(values = [], max = 100) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const clean = String(value ?? '').trim();
        if (!clean || GENERIC_REFERENCES.has(normalizeName(clean)) || seen.has(clean)) continue;
        seen.add(clean);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out;
}

function appendUnique(existing = [], incoming = [], max = 12) {
    const out = [...existing];
    const seen = new Set(existing.map(item => normalizeName(item)));
    for (const item of incoming || []) {
        const clean = String(item ?? '').trim();
        const key = normalizeName(clean);
        if (!clean || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out.slice(0, max);
}

function nonSystemMessages(chat = []) {
    return chat.map((message, id) => ({ ...message, id })).filter(message => !message?.is_system);
}

export function currentExchange(chat = [], assistantMessageId = null) {
    const id = Number.isInteger(assistantMessageId) ? assistantMessageId : chat.length - 1;
    const assistant = chat[id];
    if (!assistant || assistant.is_system || assistant.is_user) return null;
    let user = null;
    for (let i = id - 1; i >= 0; i -= 1) {
        const candidate = chat[i];
        if (!candidate || candidate.is_system) continue;
        if (candidate.is_user) { user = { ...candidate, id: i }; break; }
        if (!candidate.is_user) break;
    }
    return {
        assistant: { ...assistant, id },
        user,
    };
}

function resolvePlayerName(explicit = '', chat = [], assistantMessageId = null) {
    const direct = compactText(explicit, 160);
    if (direct) return direct;
    if (Array.isArray(chat) && chat.length) {
        const exchange = currentExchange(chat, assistantMessageId);
        const messageName = compactText(exchange?.user?.name, 160);
        if (messageName) return messageName;
    }
    try {
        return compactText(globalThis.SillyTavern?.getContext?.()?.name1, 160);
    } catch {
        return '';
    }
}

function containsNormalizedPhrase(value, phrase) {
    const haystack = normalizeName(value);
    const needle = normalizeName(phrase);
    return Boolean(haystack && needle && ` ${haystack} `.includes(` ${needle} `));
}

export function keyRelationshipReferencesPlayer(value, playerName = '') {
    const key = normalizeName(value);
    if (!key) return false;
    if (['player', 'user', 'pc'].includes(key)) return true;
    for (const marker of ['the player', 'player character', 'the player character', 'the user', 'current player', 'current user', 'player persona', 'user persona']) {
        if (containsNormalizedPhrase(key, marker)) return true;
    }
    const playerKey = normalizeName(playerName);
    return Boolean(playerKey && containsNormalizedPhrase(key, playerKey));
}

function sanitizePlayerKeyRelationships(npc, playerName = '') {
    if ((npc?.manualProfileFields || []).includes('keyRelationships')) return npc;
    const current = Array.isArray(npc?.keyRelationships) ? npc.keyRelationships : [];
    const filtered = current.filter(item => !keyRelationshipReferencesPlayer(item, playerName));
    if (filtered.length === current.length) return npc;
    const next = structuredClone(npc);
    next.keyRelationships = filtered;
    next.updatedAt = Math.max(Date.now(), Number(next.updatedAt || 0) + 1);
    return next;
}

export function recentHistory(chat = [], assistantMessageId = null, depth = 8) {
    const exchange = currentExchange(chat, assistantMessageId);
    const cutoff = exchange?.user?.id ?? (Number.isInteger(assistantMessageId) ? assistantMessageId : chat.length);
    return nonSystemMessages(chat)
        .filter(message => message.id < cutoff)
        .slice(-Math.max(0, Math.min(30, Math.round(Number(depth) || 8))))
        .map(message => ({
            id: message.id,
            role: message.is_user ? 'USER' : 'ASSISTANT',
            text: compactText(message.mes, 7000),
        }));
}

function rosterForPrompt(state) {
    return (state?.npcs || []).map(npc => ({
        id: npc.id,
        name: npc.name,
        aliases: npc.aliases,
        role: npc.role,
        archived: npc.archived,
        archiveReason: npc.archiveReason,
        present: npc.present,
        worldActive: npc.worldActive,
        relationship: npc.relationship,
        behaviorProfile: npc.behaviorProfile,
        mannerisms: npc.mannerisms,
        memories: npc.memories,
        keyRelationships: npc.keyRelationships,
        manualProfileFields: npc.manualProfileFields,
    }));
}

function dossierCollectionRules(limits) {
    return [
        `DOSSIER COLLECTION LIMITS: behaviorProfile=${limits.behaviorProfile}, mannerisms=${limits.mannerisms}, keyRelationships=${limits.keyRelationships}, memories=${limits.memories}.`,
        '- behaviorProfile, mannerisms, keyRelationships, and memories are EVOLVING CURATED COLLECTIONS, not append-only logs.',
        '- For each evolving collection, use null when nothing materially changed and the existing collection should be preserved exactly.',
        '- When an evolving collection needs revision, return an array containing the COMPLETE authoritative replacement set, not only additions.',
        '- A replacement array may rewrite, merge, retire, reorder, or displace older entries as the NPC grows and canon changes. Preserve still-relevant durable facts from EXISTING DOSSIERS even when the current exchange does not repeat them.',
        '- Prefer current canonical truth, lasting importance, and future usefulness over chronology. Merge redundant or overlapping entries instead of keeping old and rewritten duplicates beside each other.',
        '- Never exceed the configured limit for that collection. When full, a more important or more current entry should displace a lower-value one.',
        '- Use [] only when the evidence supports deliberately clearing the whole collection. Do not clear a collection merely because the supplied chat window does not mention its existing entries.',
        '- Keep individual collection entries concise, grounded, and independently useful later.',
    ];
}

export function buildScanPrompt({ state, chat, assistantMessageId, scanDepth = 8, relationshipCriteria = '', memoryCriteria = '', playerName = '', dossierLimits = {} }) {
    const exchange = currentExchange(chat, assistantMessageId);
    if (!exchange) throw new Error('NPC State v0.3 scanner requires an assistant message and its preceding user exchange.');
    const history = recentHistory(chat, assistantMessageId, scanDepth);
    const activePlayerName = resolvePlayerName(playerName, chat, assistantMessageId);
    const limits = normalizeDossierLimits(dossierLimits);
    const contract = {
        exchangeActiveNpcIds: ['existing dossier id OR exact canonical name'],
        finalPresentNpcIds: ['existing dossier id OR exact canonical name'],
        worldActiveNpcIds: ['existing dossier id OR exact canonical name'],
        npcs: [{
            id: 'existing id when known, otherwise empty',
            name: 'canonical NPC name or unique NPC role label',
            aliases: [], role: '', species: '', age: '', apparentAge: '~N only, e.g. ~25, or empty', appearance: '', personality: '',
            behaviorProfile: null, speech: '', mannerisms: null, background: '', keyRelationships: null, memories: null,
            relationshipSummary: 'NPC relationship with PLAYER only', mood: '', location: '', goal: '', status: '', importance: 0,
            lifeState: 'alive|dead|unknown', lifeStateCertainty: 'explicit|strong|uncertain', lifeStateReason: '', livingReturn: false,
            relationshipChange: { impact: 'none|ordinary|meaningful|major|extreme', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: '', reason: '' },
        }],
        socialEdges: [{ from: 'NPC id/name only', to: 'NPC id/name only', relation: '', summary: '' }],
    };
    return [
        'You are NPC State v0.3.1, a private structured continuity scanner for a roleplay chat.',
        'Return JSON only. Never narrate, explain, or wrap the JSON in markdown.',
        '',
        `PLAYER IDENTITY:\n${JSON.stringify({ name: activePlayerName })}`,
        '',
        'SEMANTIC RULES:',
        '- exchangeActiveNpcIds: NPCs who SPOKE, ACTED, WERE DIRECTLY ACTED UPON, or DIRECTLY PERCEIVED/RECEIVED a story-relevant event in the CURRENT USER+ASSISTANT exchange.',
        '- A character who is only mentioned, remembered, discussed, named as a topic, or present only in older history is NOT exchange-active.',
        '- finalPresentNpcIds: NPCs physically present at the END of the current assistant scene. This is strict physical presence. Off-screen activity does not count.',
        '- worldActiveNpcIds: NPCs explicitly active off-screen in the current world state. Keep this separate from physical presence.',
        '- Every new NPC referenced by those arrays must also have one npcs entry so identity can be created safely.',
        '- The PLAYER/current USER persona is not an NPC for this scanner, even when named in narration. Never create the PLAYER as an npcs entry.',
        '- relationship, relationshipSummary, and relationshipChange describe THIS NPC toward the PLAYER. They are the dedicated player-relationship channel.',
        '- keyRelationships contains significant NON-PLAYER ties only, such as family, friends, rivals, patrons, dependents, or other NPCs. Never include the PLAYER/current USER persona there.',
        '- socialEdges are NPC-to-NPC only. Never use the PLAYER/current USER persona as an endpoint.',
        '- Current exchange decides relationship changes. Older history may recover stable profile facts and durable memories, but must NEVER replay relationship deltas.',
        '- Only propose a relationshipChange when the current exchange contains concrete evidence. If unsure, use impact none and zero deltas.',
        '- apparentAge is separate from actual age. When clearly supported, it MUST be one approximate integer written exactly as ~N, for example ~18 or ~25. Never output decade bands, prose bands, or ranges such as twenties, 20s, late twenties, 20-30, or twenties to thirties. If a single numeric apparent age is not supported, leave apparentAge empty.',
        ...dossierCollectionRules(limits),
        '- Do not infer romance, obedience, hostility, personality, motives, secrets, age, species, or relationships without evidence.',
        '- Confirmed death requires explicit current-timeline evidence. Ambiguous danger/injury is not death.',
        '- livingReturn is true only when a previously archived/dead dossier is explicitly alive, surviving, resurrected, or physically returned.',
        '- Stable scalar profile fields should contain only newly established or clearly supported facts. Omit/empty scalar fields rather than guessing.',
        '',
        relationshipCriteria ? `RELATIONSHIP RUBRIC:\n${compactText(relationshipCriteria, 6000)}` : '',
        memoryCriteria ? `IMPORTANT MEMORY RUBRIC:\n${compactText(memoryCriteria, 6000)}` : '',
        '',
        `EXISTING DOSSIERS:\n${JSON.stringify(rosterForPrompt(state))}`,
        `OLDER CONTEXT FOR PROFILE/MEMORY ONLY:\n${JSON.stringify(history)}`,
        `CURRENT USER MESSAGE:\n${compactText(exchange.user?.mes || '', 10000)}`,
        `CURRENT ASSISTANT MESSAGE:\n${compactText(exchange.assistant?.mes || '', 14000)}`,
        `OUTPUT CONTRACT:\n${JSON.stringify(contract)}`,
    ].filter(Boolean).join('\n\n');
}

export function buildTargetedRefreshPrompt({ npc, chat, assistantMessageId, scanDepth = 12, memoryCriteria = '', playerName = '', dossierLimits = {} }) {
    const history = nonSystemMessages(chat)
        .filter(message => !Number.isInteger(assistantMessageId) || message.id <= assistantMessageId)
        .slice(-Math.max(2, Math.min(30, Math.round(Number(scanDepth) || 12))))
        .map(message => ({ id: message.id, role: message.is_user ? 'USER' : 'ASSISTANT', text: compactText(message.mes, 8000) }));
    const activePlayerName = resolvePlayerName(playerName, chat, assistantMessageId);
    const limits = normalizeDossierLimits(dossierLimits);
    return [
        'You are NPC State v0.3.1 performing a targeted dossier reconciliation.',
        'Return JSON only using the same object shape shown below.',
        `PLAYER IDENTITY: ${JSON.stringify({ name: activePlayerName })}`,
        `TARGET DOSSIER: ${JSON.stringify(rosterForPrompt({ npcs: [npc] })[0])}`,
        'Use the supplied chat window to reconcile grounded stable profile facts, current status when supported, durable memories, and key relationships for THIS NPC only.',
        'The PLAYER/current USER persona is not an NPC. relationshipSummary is this NPC toward the PLAYER; keyRelationships is NON-PLAYER ties only and must never duplicate the PLAYER.',
        'apparentAge must be one supported numeric approximation formatted exactly as ~N. Never use decade bands, worded age bands, or ranges. Leave it empty if no single numeric apparent age is supported.',
        ...dossierCollectionRules(limits),
        'Do NOT change relationship scores or propose relationship deltas in a targeted refresh. Do NOT change global physical presence for other NPCs.',
        'If the chat does not establish a scalar field, leave it empty. Never invent facts.',
        memoryCriteria ? `IMPORTANT MEMORY RUBRIC:\n${compactText(memoryCriteria, 6000)}` : '',
        `CHAT WINDOW:\n${JSON.stringify(history)}`,
        `OUTPUT CONTRACT:\n${JSON.stringify({ exchangeActiveNpcIds: [], finalPresentNpcIds: [], worldActiveNpcIds: [], npcs: [{ id: npc.id, name: npc.name, aliases: [], role: '', species: '', age: '', apparentAge: '~N only or empty', appearance: '', personality: '', behaviorProfile: null, speech: '', mannerisms: null, background: '', keyRelationships: null, memories: null, relationshipSummary: 'NPC relationship with PLAYER only', mood: '', location: '', goal: '', status: '', importance: 0, lifeState: 'alive|dead|unknown', lifeStateCertainty: '', lifeStateReason: '', livingReturn: false, relationshipChange: { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: '', reason: '' } }], socialEdges: [] })}`,
    ].filter(Boolean).join('\n\n');
}

export function parseScanJson(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('NPC State v0.3 scanner returned an empty response.');
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const first = unfenced.indexOf('{');
    const last = unfenced.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('NPC State v0.3 scanner returned no JSON object.');
    let parsed;
    try { parsed = JSON.parse(unfenced.slice(first, last + 1)); }
    catch (error) { throw new Error(`NPC State v0.3 scanner returned malformed JSON: ${error.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NPC State v0.3 scanner JSON must be an object.');
    return {
        exchangeActiveNpcIds: uniqueStrings(parsed.exchangeActiveNpcIds),
        finalPresentNpcIds: uniqueStrings(parsed.finalPresentNpcIds),
        worldActiveNpcIds: uniqueStrings(parsed.worldActiveNpcIds),
        npcs: Array.isArray(parsed.npcs) ? parsed.npcs.filter(item => item && typeof item === 'object').slice(0, 100) : [],
        socialEdges: Array.isArray(parsed.socialEdges) ? parsed.socialEdges.filter(item => item && typeof item === 'object').slice(0, 100) : [],
    };
}

function patchReferenceMatches(patch, reference) {
    const key = normalizeName(reference);
    if (!key) return false;
    if (String(patch?.id || '').trim() === String(reference || '').trim()) return true;
    if (normalizeName(patch?.name) === key) return true;
    return (Array.isArray(patch?.aliases) ? patch.aliases : []).some(alias => normalizeName(alias) === key);
}

function createFromPatch(patch, sourceMessageId) {
    const name = String(patch?.name || '').trim();
    if (!name || GENERIC_REFERENCES.has(normalizeName(name))) return null;
    return normalizeNpc({
        id: String(patch?.id || '').trim() || makeNpcId(name, `${sourceMessageId}-${Math.random()}`),
        name,
        firstSeenMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
        createdAt: Date.now(),
    });
}

function applyStablePatch(npc, patch, options = {}) {
    const locked = new Set(npc.manualProfileFields || []);
    const next = structuredClone(npc);
    const limits = normalizeDossierLimits(options.dossierLimits);
    const stringFields = ['name', 'role', 'species', 'age', 'apparentAge', 'appearance', 'personality', 'speech', 'background'];
    for (const field of stringFields) {
        if (locked.has(field)) continue;
        const value = field === 'apparentAge'
            ? normalizeApparentAge(patch?.[field])
            : String(patch?.[field] ?? '').trim();
        if (!value) continue;
        if (field === 'name' && value !== next.name && next.name) next.aliases = appendUnique(next.aliases, [next.name], 10);
        next[field] = value;
    }
    if (!locked.has('aliases')) next.aliases = appendUnique(next.aliases, patch?.aliases, 10);
    if (!locked.has('behaviorProfile') && Array.isArray(patch?.behaviorProfile)) {
        next.behaviorProfile = appendUnique([], patch.behaviorProfile, limits.behaviorProfile);
    }
    if (!locked.has('mannerisms') && Array.isArray(patch?.mannerisms)) {
        next.mannerisms = appendUnique([], patch.mannerisms, limits.mannerisms);
    }
    if (!locked.has('keyRelationships') && Array.isArray(patch?.keyRelationships)) {
        const incoming = patch.keyRelationships.filter(item => !keyRelationshipReferencesPlayer(item, options.playerName));
        next.keyRelationships = appendUnique([], incoming, limits.keyRelationships);
    }
    return next;
}

function applyLivePatch(npc, patch) {
    const next = structuredClone(npc);
    for (const field of ['mood', 'location', 'goal', 'status']) {
        const value = String(patch?.[field] ?? '').trim();
        if (value) next[field] = value;
    }
    if (Number.isFinite(Number(patch?.importance))) next.importance = Math.max(next.importance || 0, Math.min(100, Math.max(0, Math.round(Number(patch.importance)))));
    return next;
}

function applyDynamicPatch(npc, patch, options = {}) {
    const next = applyLivePatch(npc, patch);
    const relationshipSummary = String(patch?.relationshipSummary ?? '').trim();
    if (relationshipSummary) next.relationshipSummary = relationshipSummary;
    if (Array.isArray(patch?.memories)) {
        const limits = normalizeDossierLimits(options.dossierLimits);
        next.memories = appendUnique([], patch.memories, limits.memories);
    }
    return next;
}

function relationshipDeltaForPatch(patch, caps = DEFAULT_RELATIONSHIP_CAPS) {
    const change = patch?.relationshipChange && typeof patch.relationshipChange === 'object' ? patch.relationshipChange : {};
    const impact = IMPACTS.has(String(change.impact)) ? String(change.impact) : 'none';
    const evidence = String(change.evidence || '').trim();
    const reason = String(change.reason || '').trim();
    if (impact === 'none' || !evidence || !reason) return { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: '', reason: '' };
    const cap = Math.max(0, Number(caps?.[impact] ?? DEFAULT_RELATIONSHIP_CAPS[impact] ?? 0));
    const proposed = change.delta && typeof change.delta === 'object' ? change.delta : {};
    const delta = {};
    for (const axis of RELATIONSHIP_AXES) {
        const value = Number(proposed[axis]);
        delta[axis] = Number.isFinite(value) ? Math.max(-cap, Math.min(cap, Math.round(value))) : 0;
    }
    if (!Object.values(delta).some(Boolean)) return { impact: 'none', delta, evidence: '', reason: '' };
    return { impact, delta, evidence: evidence.slice(0, 800), reason: reason.slice(0, 800) };
}

function applyRelationshipChange(npc, patch, options) {
    const change = relationshipDeltaForPatch(patch, options.relationshipCaps);
    if (change.impact === 'none') return npc;
    const next = structuredClone(npc);
    const current = normalizeRelationship(next.relationship);
    const updated = {};
    for (const axis of RELATIONSHIP_AXES) updated[axis] = Math.max(-100, Math.min(100, current[axis] + change.delta[axis]));
    next.relationship = updated;
    const event = {
        ...change,
        sourceMessageId: Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null,
        turn: Number.isInteger(options.turn) ? options.turn : null,
        at: Date.now(),
    };
    next.lastRelationshipChange = event;
    next.relationshipHistory = [...(next.relationshipHistory || []), event].slice(-24);
    return next;
}

function applyLifeState(npc, patch, options) {
    const next = structuredClone(npc);
    const lifeState = String(patch?.lifeState || '').trim();
    const certainty = String(patch?.lifeStateCertainty || '').trim();
    const reason = String(patch?.lifeStateReason || '').trim();
    if (patch?.livingReturn === true) {
        next.archived = false;
        next.archiveReason = '';
        next.archivedAt = null;
        next.lifeState = 'alive';
        next.lifeStateCertainty = certainty || 'explicit';
        next.lifeStateReason = reason || 'Explicit living return in current continuity.';
        return next;
    }
    if (['alive', 'dead', 'unknown'].includes(lifeState)) {
        next.lifeState = lifeState;
        next.lifeStateCertainty = certainty;
        if (reason) next.lifeStateReason = reason;
    }
    if (lifeState === 'dead' && ['explicit', 'confirmed'].includes(certainty.toLocaleLowerCase())) {
        next.archived = true;
        next.archiveReason = 'deceased';
        next.archivedAt = Date.now();
        next.present = false;
        next.worldActive = false;
    }
    return next;
}

function socialEdgeKey(edge) {
    const ids = [String(edge.fromId || ''), String(edge.toId || '')].sort();
    return `${ids[0]}\0${ids[1]}\0${normalizeName(edge.relation)}`;
}

export function applyScanResult(stateInput, resultInput, options = {}) {
    const state = normalizeState(stateInput, stateInput?.chatKey || '');
    const result = parseScanJson(typeof resultInput === 'string' ? resultInput : JSON.stringify(resultInput || {}));
    const sourceMessageId = Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null;
    const turn = Number.isInteger(options.turn) ? options.turn : state.turn;
    const preservePresence = options.preservePresence === true;
    const applyRelationship = options.applyRelationship !== false;
    const allowHistoricalProfilePatches = options.allowHistoricalProfilePatches === true;
    const playerName = resolvePlayerName(options.playerName);
    const dossierLimits = normalizeDossierLimits(options.dossierLimits);

    state.npcs = state.npcs.map(npc => sanitizePlayerKeyRelationships(npc, playerName));

    const exchangeRefs = uniqueStrings(result.exchangeActiveNpcIds);
    const presentRefs = uniqueStrings(result.finalPresentNpcIds);
    const worldRefs = uniqueStrings(result.worldActiveNpcIds);
    const targetRefs = [...new Set([...exchangeRefs, ...presentRefs])];

    const deletedIds = new Set(state.deletedNpcIds || []);
    const patchByNpcId = new Map();
    for (const patch of result.npcs) {
        const patchId = String(patch?.id || '').trim();
        if (patchId && deletedIds.has(patchId)) continue;
        let npc = patchId ? state.npcs.find(item => item.id === patchId) || null : null;
        if (!patchId && patch?.name) npc = findNpcByReference(state, String(patch.name));
        if (patchId && !npc && patch?.name && findNpcByReference(state, String(patch.name))) {
            // Stable IDs are authoritative once known. A model-supplied unknown ID must not
            // retarget a same-name live dossier or create a duplicate identity.
            continue;
        }
        const referenced = targetRefs.some(ref => patchReferenceMatches(patch, ref)) || worldRefs.some(ref => patchReferenceMatches(patch, ref));
        if (!npc && referenced) {
            const created = createFromPatch(patch, sourceMessageId);
            if (created && !deletedIds.has(created.id) && !(state.suppressedNames || []).some(name => normalizeName(name) === normalizeName(created.name))) {
                state.npcs.push(created);
                npc = created;
            }
        }
        if (npc) patchByNpcId.set(npc.id, patch);
    }

    const resolveRefs = refs => {
        const ids = [];
        for (const ref of refs) {
            let npc = findNpcByReference(state, ref);
            if (!npc) {
                const patch = result.npcs.find(item => patchReferenceMatches(item, ref));
                if (patch) {
                    const created = createFromPatch(patch, sourceMessageId);
                    if (created && !deletedIds.has(created.id) && !(state.suppressedNames || []).some(name => normalizeName(name) === normalizeName(created.name))) {
                        state.npcs.push(created);
                        patchByNpcId.set(created.id, patch);
                        npc = created;
                    }
                }
            }
            if (npc && !ids.includes(npc.id)) ids.push(npc.id);
        }
        return ids;
    };

    const exchangeIds = resolveRefs(exchangeRefs);
    const presentIds = resolveRefs(presentRefs);
    const worldIds = resolveRefs(worldRefs);
    const targetIds = [...new Set([...exchangeIds, ...presentIds])];
    const targetSet = new Set(targetIds);
    const exchangeSet = new Set(exchangeIds);
    const worldSet = new Set(worldIds);

    for (let i = 0; i < state.npcs.length; i += 1) {
        let npc = state.npcs[i];
        const patch = patchByNpcId.get(npc.id);
        const canPatch = Boolean(patch && (targetSet.has(npc.id) || allowHistoricalProfilePatches));
        if (canPatch) {
            npc = applyStablePatch(npc, patch, { playerName, dossierLimits });
            npc = applyDynamicPatch(npc, patch, { dossierLimits });
            npc = applyLifeState(npc, patch, options);
            if (applyRelationship && exchangeSet.has(npc.id)) npc = applyRelationshipChange(npc, patch, {
                relationshipCaps: options.relationshipCaps || DEFAULT_RELATIONSHIP_CAPS,
                sourceMessageId,
                turn,
            });
            npc.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
        } else if (patch && worldSet.has(npc.id)) {
            // Off-screen activity may update current whereabouts/status and explicit life-state
            // continuity, but never stable profile, memories, or relationship progression.
            npc = applyLivePatch(npc, patch);
            npc = applyLifeState(npc, patch, options);
            npc.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
        }
        if (exchangeSet.has(npc.id)) npc.lastInteractionMessageId = sourceMessageId;
        if (presentIds.includes(npc.id)) {
            npc.lastSeenMessageId = sourceMessageId;
            npc.seenCount = Math.max(0, Number(npc.seenCount) || 0) + 1;
        }
        state.npcs[i] = normalizeNpc(npc);
    }

    if (!preservePresence) {
        const presentSet = new Set(presentIds);
        state.npcs = state.npcs.map(raw => {
            const npc = structuredClone(raw);
            npc.present = !npc.archived && presentSet.has(npc.id);
            npc.worldActive = !npc.archived && worldSet.has(npc.id);
            return normalizeNpc(npc);
        });
    }

    const edgeMap = new Map((state.socialGraph || []).map(edge => [socialEdgeKey(edge), edge]));
    for (const raw of result.socialEdges) {
        if (keyRelationshipReferencesPlayer(raw?.from, playerName) || keyRelationshipReferencesPlayer(raw?.to, playerName)) continue;
        const from = findNpcByReference(state, raw?.from);
        const to = findNpcByReference(state, raw?.to);
        if (!from || !to || from.id === to.id) continue;
        if (!targetSet.has(from.id) && !targetSet.has(to.id) && !allowHistoricalProfilePatches) continue;
        const relation = String(raw?.relation || '').trim().slice(0, 160);
        if (!relation) continue;
        const edge = { fromId: from.id, toId: to.id, relation, summary: String(raw?.summary || '').trim().slice(0, 500), updatedAt: Date.now(), sourceMessageId };
        edgeMap.set(socialEdgeKey(edge), edge);
    }
    state.socialGraph = [...edgeMap.values()].slice(-200);

    if (options.preserveObservation !== true) {
        state.lastObservation = {
            messageId: sourceMessageId,
            exchangeActiveNpcIds: exchangeIds,
            finalPresentNpcIds: presentIds,
            worldActiveNpcIds: worldIds,
            targetNpcIds: targetIds,
        };
        state.lastScannedMessageId = sourceMessageId;
    }
    state.updatedAt = Date.now();
    return { state: normalizeState(state, state.chatKey), exchangeActiveNpcIds: exchangeIds, finalPresentNpcIds: presentIds, worldActiveNpcIds: worldIds, targetNpcIds: targetIds };
}
