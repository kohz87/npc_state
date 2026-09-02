import { bestCheckpoint, ensureBranchBase, fingerprintMessage, reconcileToCurrentBranch, recordCheckpoint } from './branches.js';
import { readLegacyV02Sidecar } from './migrate-v02.js';
import {
    DEFAULT_RELATIONSHIP_CAPS,
    createEmptyState,
    findNpcByReference,
    makeNpcId,
    normalizeName,
    normalizeNpc,
    normalizeRelationship,
    normalizeState,
} from './schema.js';
import {
    applyScanResult,
    buildScanPrompt,
    buildTargetedRefreshPrompt,
    currentExchange,
    parseScanJson,
} from './scanner.js';
import {
    applyStaleLifecycle,
    buildStaleReport,
    narrativeTurnForMessage,
    referencedNpcIdsFromExchange,
} from './stale.js';
import { readV3PointerHint, readV3Sidecar, writeV3Sidecar } from './storage.js';

const SYSTEM_PROMPT = 'Return only valid JSON for the NPC State v0.3 structured scanner. Obey the supplied schema and evidence rules exactly.';

function latestAssistantMessageId(chat = []) {
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (message && !message.is_system && !message.is_user) return i;
    }
    return -1;
}

function lifecycleNotice(result) {
    const parts = [];
    if (result?.archivedIds?.length) parts.push(`archived ${result.archivedIds.length} stale dossier${result.archivedIds.length === 1 ? '' : 's'}`);
    if (result?.restoredIds?.length) parts.push(`restored ${result.restoredIds.length} narratively active dossier${result.restoredIds.length === 1 ? '' : 's'}`);
    if (result?.deletedIds?.length) parts.push(`removed ${result.deletedIds.length} stale archive${result.deletedIds.length === 1 ? '' : 's'}`);
    return parts.join(', ');
}

export function createNpcStateEngine(adapters = {}) {
    const cache = new Map();
    const hydration = new Map();
    const operationEpoch = new Map();
    const locks = new Map();

    const getContext = adapters.getContext;
    const getChatKey = adapters.getChatKey;
    const getSettings = adapters.getSettings;
    const getPointer = adapters.getPointer || (() => null);
    const setPointer = adapters.setPointer || (() => {});
    const getLegacyPointer = adapters.getLegacyPointer || (() => null);
    const persistSettings = adapters.persistSettings || (() => {});
    const getHeaders = adapters.getHeaders || (() => ({}));
    const fetchFn = adapters.fetchFn || globalThis.fetch;
    const generate = adapters.generate;
    const onStateChanged = adapters.onStateChanged || (() => {});
    const notify = adapters.notify || (() => {});

    if (typeof getContext !== 'function' || typeof getChatKey !== 'function' || typeof getSettings !== 'function' || typeof generate !== 'function') {
        throw new Error('NPC State v0.3 engine requires getContext, getChatKey, getSettings, and generate adapters.');
    }

    function epoch(chatKey) { return operationEpoch.get(chatKey) || 0; }
    function invalidate(chatKey = getChatKey()) {
        if (!chatKey || chatKey === 'no-chat') return 0;
        const next = epoch(chatKey) + 1;
        operationEpoch.set(chatKey, next);
        return next;
    }

    async function exclusive(chatKey, task) {
        const key = String(chatKey || '');
        const previous = locks.get(key) || Promise.resolve();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const queued = previous.catch(() => {}).then(() => gate);
        locks.set(key, queued);
        await previous.catch(() => {});
        try { return await task(); }
        finally {
            release();
            if (locks.get(key) === queued) locks.delete(key);
        }
    }

    async function persist(chatKey, state) {
        const result = await writeV3Sidecar({
            chatKey,
            state,
            pointer: getPointer(chatKey),
            fetchFn,
            headers: getHeaders(),
        });
        setPointer(chatKey, result.pointer);
        persistSettings();
        cache.set(chatKey, result.state);
        hydration.set(chatKey, { status: 'ready', error: null });
        onStateChanged(chatKey, structuredClone(result.state));
        return result.state;
    }

    async function loadChat(chatKey = getChatKey()) {
        if (!chatKey || chatKey === 'no-chat' || /-pending:/.test(chatKey)) return null;
        if (cache.has(chatKey)) return cache.get(chatKey);
        hydration.set(chatKey, { status: 'loading', error: null });
        try {
            const configuredPointer = getPointer(chatKey);
            const hintedPointer = readV3PointerHint(chatKey);
            const pointer = !configuredPointer?.path && hintedPointer?.path
                ? hintedPointer
                : (configuredPointer?.path && hintedPointer?.path && configuredPointer.path === hintedPointer.path && Number(hintedPointer.revision || 0) > Number(configuredPointer.revision || 0) ? hintedPointer : configuredPointer);
            let state;
            let importedLegacy = false;
            if (pointer?.path) {
                const loaded = await readV3Sidecar({ chatKey, pointer, fetchFn });
                if (!loaded) throw new Error('NPC State v0.3 sidecar pointer exists but the file is missing. Refusing to create a blank replacement.');
                state = loaded.state;
                if (!configuredPointer?.path || Number(pointer.revision || 0) > Number(configuredPointer.revision || 0)) {
                    setPointer(chatKey, pointer);
                    persistSettings();
                }
            } else {
                const legacyPointer = getLegacyPointer(chatKey);
                if (legacyPointer?.path) {
                    const legacy = await readLegacyV02Sidecar({ chatKey, pointer: legacyPointer, fetchFn });
                    if (!legacy) throw new Error('NPC State v0.2 sidecar pointer exists but the legacy file is missing. Refusing to overwrite it.');
                    state = legacy.state;
                    importedLegacy = true;
                } else {
                    state = createEmptyState(chatKey);
                }
            }
            state = ensureBranchBase(normalizeState(state, chatKey), getContext().chat || []);
            if (importedLegacy) {
                state = await persist(chatKey, state);
                notify('success', `Imported ${state.npcs.length} NPC dossier${state.npcs.length === 1 ? '' : 's'} from v0.2 into an independent v0.3 sidecar.`);
            }
            cache.set(chatKey, state);
            hydration.set(chatKey, { status: 'ready', error: null });
            onStateChanged(chatKey, structuredClone(state));
            return state;
        } catch (error) {
            hydration.set(chatKey, { status: 'error', error });
            throw error;
        }
    }

    async function invokeJson(prompt, label = 'scan') {
        let raw = await generate({ systemPrompt: SYSTEM_PROMPT, prompt, responseLength: 7000, label });
        try { return parseScanJson(raw); }
        catch (firstError) {
            raw = await generate({
                systemPrompt: SYSTEM_PROMPT,
                prompt: `${prompt}\n\nYour previous response was malformed. Return exactly one valid JSON object, no markdown and no commentary.`,
                responseLength: 7000,
                label: `${label}-json-retry`,
            });
            try { return parseScanJson(raw); }
            catch (secondError) {
                secondError.cause = firstError;
                throw secondError;
            }
        }
    }

    async function scan(messageId, { manual = false, force = false } = {}) {
        const chatKey = getChatKey();
        if (!chatKey || chatKey === 'no-chat' || /-pending:/.test(chatKey)) return { ok: false, reason: 'no-chat' };
        const settings = getSettings();
        if (!manual && settings.enabled === false) return { ok: false, reason: 'disabled' };
        if (!manual && settings.autoScan === false) return { ok: false, reason: 'auto-disabled' };
        return exclusive(chatKey, async () => {
            const state = await loadChat(chatKey);
            if (!state) return { ok: false, reason: 'no-state' };
            if (state.branchSafety?.status === 'prebaseline-diverged') return { ok: false, reason: 'branch-unsafe', messageId };
            if (!force && state.lastScannedMessageId === messageId) return { ok: true, skipped: true, reason: 'already-scanned', messageId };
            const ctx = getContext();
            const chat = ctx.chat || [];
            const exchange = currentExchange(chat, messageId);
            if (!exchange) return { ok: false, reason: 'not-assistant-message' };
            const startEpoch = epoch(chatKey);
            const startFingerprint = fingerprintMessage(chat[messageId] || {});
            const prompt = buildScanPrompt({
                state,
                chat,
                assistantMessageId: messageId,
                scanDepth: settings.scanDepth,
                relationshipCriteria: settings.relationshipCriteria,
                memoryCriteria: settings.memoryCriteria,
            });
            const parsed = await invokeJson(prompt, manual ? 'manual-current-cast' : 'automatic-current-cast');
            const liveCtx = getContext();
            const liveChat = liveCtx.chat || [];
            if (getChatKey() !== chatKey || epoch(chatKey) !== startEpoch || fingerprintMessage(liveChat[messageId] || {}) !== startFingerprint) {
                return { ok: false, discarded: true, reason: 'stale-operation', messageId };
            }
            const working = normalizeState(state, chatKey);
            working.turn = Math.max(0, Number(working.turn) || 0) + 1;
            const applied = applyScanResult(working, parsed, {
                sourceMessageId: messageId,
                turn: working.turn,
                relationshipCaps: settings.relationshipCaps || DEFAULT_RELATIONSHIP_CAPS,
            });
            const referencedNpcIds = referencedNpcIdsFromExchange(applied.state, exchange);
            const stale = applyStaleLifecycle(applied.state, {
                settings,
                currentTurn: narrativeTurnForMessage(liveChat, messageId),
                sourceMessageId: messageId,
                exchangeActiveNpcIds: applied.exchangeActiveNpcIds,
                finalPresentNpcIds: applied.finalPresentNpcIds,
                worldActiveNpcIds: applied.worldActiveNpcIds,
                referencedNpcIds,
            });
            let committed = recordCheckpoint(stale.state, liveChat, messageId, manual ? 'manual-scan' : 'auto-scan');
            committed.lastScannedMessageId = messageId;
            committed.updatedAt = Date.now();
            const persisted = await persist(chatKey, committed);
            const notice = lifecycleNotice(stale);
            if (notice) notify('info', `Stale management ${notice}.`);
            return {
                ok: true,
                messageId,
                exchangeActiveNpcIds: applied.exchangeActiveNpcIds,
                finalPresentNpcIds: applied.finalPresentNpcIds,
                worldActiveNpcIds: applied.worldActiveNpcIds,
                referencedNpcIds,
                targetNpcIds: applied.targetNpcIds,
                stale: {
                    archivedIds: stale.archivedIds,
                    restoredIds: stale.restoredIds,
                    deletedIds: stale.deletedIds,
                    currentTurn: stale.currentTurn,
                },
                state: structuredClone(persisted),
            };
        });
    }

    async function refreshDossier(reference) {
        const chatKey = getChatKey();
        if (!chatKey || chatKey === 'no-chat') return { ok: false, reason: 'no-chat' };
        return exclusive(chatKey, async () => {
            const state = await loadChat(chatKey);
            if (state?.branchSafety?.status === 'prebaseline-diverged') return { ok: false, reason: 'branch-unsafe' };
            const npc = findNpcByReference(state, reference);
            if (!npc) return { ok: false, reason: 'not-found' };
            const ctx = getContext();
            const chat = ctx.chat || [];
            const messageId = latestAssistantMessageId(chat);
            if (messageId < 0) return { ok: false, reason: 'no-assistant-message' };
            const startEpoch = epoch(chatKey);
            const startFingerprint = fingerprintMessage(chat[messageId] || {});
            const settings = getSettings();
            const prompt = buildTargetedRefreshPrompt({
                npc,
                chat,
                assistantMessageId: messageId,
                scanDepth: settings.scanDepth,
                memoryCriteria: settings.memoryCriteria,
            });
            const parsed = await invokeJson(prompt, `targeted-${npc.id}`);
            const liveChat = getContext().chat || [];
            if (getChatKey() !== chatKey || epoch(chatKey) !== startEpoch || fingerprintMessage(liveChat[messageId] || {}) !== startFingerprint) {
                return { ok: false, discarded: true, reason: 'stale-operation' };
            }
            const applied = applyScanResult(state, parsed, {
                sourceMessageId: messageId,
                turn: state.turn,
                preservePresence: true,
                preserveObservation: true,
                applyRelationship: false,
                allowHistoricalProfilePatches: true,
                relationshipCaps: settings.relationshipCaps || DEFAULT_RELATIONSHIP_CAPS,
            });
            const committed = recordCheckpoint(applied.state, liveChat, messageId, 'targeted-refresh');
            const persisted = await persist(chatKey, committed);
            return { ok: true, npcId: npc.id, state: structuredClone(persisted) };
        });
    }

    async function mutate(label, mutator, { checkpointReason = 'manual' } = {}) {
        const chatKey = getChatKey();
        if (!chatKey || chatKey === 'no-chat' || /-pending:/.test(chatKey)) return { ok: false, reason: 'no-chat' };
        return exclusive(chatKey, async () => {
            const state = normalizeState(await loadChat(chatKey), chatKey);
            const result = await mutator(state);
            if (result === false) return { ok: false, reason: 'rejected' };
            if (result?.rejected) return { ok: false, reason: String(result.rejected) };
            const chat = getContext().chat || [];
            const messageId = latestAssistantMessageId(chat);
            let next = normalizeState(state, chatKey);
            if (messageId >= 0) next = recordCheckpoint(next, chat, messageId, checkpointReason);
            next.updatedAt = Date.now();
            const persisted = await persist(chatKey, next);
            return { ok: true, label, state: structuredClone(persisted), result };
        });
    }

    async function addNpc(name) {
        const clean = String(name || '').trim().slice(0, 120);
        if (!clean) return { ok: false, reason: 'empty-name' };
        return mutate('add', state => {
            const existing = findNpcByReference(state, clean);
            if (existing) return { npcId: existing.id, existing: true };
            if ((state.suppressedNames || []).some(value => normalizeName(value) === normalizeName(clean))) {
                state.suppressedNames = state.suppressedNames.filter(value => normalizeName(value) !== normalizeName(clean));
            }
            const chat = getContext().chat || [];
            const messageId = latestAssistantMessageId(chat);
            const npc = normalizeNpc({
                id: makeNpcId(clean),
                name: clean,
                manual: true,
                createdAt: Date.now(),
                lastActivityTurn: narrativeTurnForMessage(chat, messageId),
                lastActivityMessageId: messageId >= 0 ? messageId : null,
                lastActivityReason: 'manual-add',
            });
            state.npcs.push(npc);
            return { npcId: npc.id, existing: false };
        }, { checkpointReason: 'manual-add' });
    }

    async function updateNpc(reference, patch = {}, options = {}) {
        return mutate('update', state => {
            const matched = findNpcByReference(state, reference);
            const index = matched ? state.npcs.findIndex(npc => npc.id === matched.id) : -1;
            if (index < 0) return false;
            const current = state.npcs[index];
            if (Number.isFinite(Number(options.expectedUpdatedAt)) && Number(current.updatedAt) !== Number(options.expectedUpdatedAt)) return { rejected: 'stale-editor' };
            const nextRaw = { ...current, ...structuredClone(patch), id: current.id, updatedAt: Math.max(Date.now(), Number(current.updatedAt || 0) + 1), manual: true };
            if (patch?.relationship && typeof patch.relationship === 'object') {
                const before = normalizeRelationship(current.relationship);
                const after = normalizeRelationship(patch.relationship);
                const delta = Object.fromEntries(Object.keys(before).map(axis => [axis, after[axis] - before[axis]]));
                if (Object.values(delta).some(value => value !== 0)) {
                    const event = {
                        impact: 'manual', delta, evidence: '', reason: 'Manual dossier adjustment by player.',
                        sourceMessageId: latestAssistantMessageId(getContext().chat || []), turn: Number.isInteger(state.turn) ? state.turn : null, at: Date.now(),
                    };
                    nextRaw.lastRelationshipChange = event;
                    nextRaw.relationshipHistory = [...(current.relationshipHistory || []), event].slice(-24);
                }
            }
            const next = normalizeNpc(nextRaw);
            const collision = state.npcs.some((npc, i) => i !== index && normalizeName(npc.name) === normalizeName(next.name));
            if (collision) return false;
            if (next.name !== current.name && current.name) next.aliases = [...new Set([...(next.aliases || []), current.name])].slice(0, 10);
            state.npcs[index] = normalizeNpc(next);
            return { npcId: current.id };
        }, { checkpointReason: 'manual-edit' });
    }

    async function archiveNpc(reference, archived = true, reason = 'manual') {
        return mutate(archived ? 'archive' : 'restore', state => {
            const npc = findNpcByReference(state, reference);
            if (!npc) return false;
            const index = state.npcs.findIndex(item => item.id === npc.id);
            const next = structuredClone(npc);
            next.updatedAt = Math.max(Date.now(), Number(npc.updatedAt || 0) + 1);
            next.archived = Boolean(archived);
            next.archiveReason = archived ? String(reason || 'manual') : '';
            next.archivedAt = archived ? Date.now() : null;
            if (archived) {
                next.present = false;
                next.worldActive = false;
            } else {
                const chat = getContext().chat || [];
                const messageId = latestAssistantMessageId(chat);
                next.lastActivityTurn = narrativeTurnForMessage(chat, messageId);
                next.lastActivityMessageId = messageId >= 0 ? messageId : null;
                next.lastActivityReason = 'manual-restore';
            }
            state.npcs[index] = normalizeNpc(next);
            return { npcId: npc.id };
        }, { checkpointReason: archived ? 'manual-archive' : 'manual-restore' });
    }

    async function resetNpcStaleness(reference) {
        return mutate('reset-staleness', state => {
            const npc = findNpcByReference(state, reference);
            if (!npc) return false;
            const index = state.npcs.findIndex(item => item.id === npc.id);
            const chat = getContext().chat || [];
            const messageId = latestAssistantMessageId(chat);
            const next = structuredClone(npc);
            next.lastActivityTurn = narrativeTurnForMessage(chat, messageId);
            next.lastActivityMessageId = messageId >= 0 ? messageId : null;
            next.lastActivityReason = 'manual-review';
            if (next.archived && next.archiveReason === 'stale') {
                next.archived = false;
                next.archiveReason = '';
                next.archivedAt = null;
            }
            next.updatedAt = Math.max(Date.now(), Number(next.updatedAt || 0) + 1);
            state.npcs[index] = normalizeNpc(next);
            return { npcId: npc.id };
        }, { checkpointReason: 'stale-reset' });
    }

    async function deleteNpc(reference) {
        return mutate('delete', state => {
            const npc = findNpcByReference(state, reference);
            if (!npc) return false;
            state.deletedNpcIds = [...new Set([...(state.deletedNpcIds || []), npc.id])];
            state.npcs = state.npcs.filter(item => item.id !== npc.id);
            state.socialGraph = (state.socialGraph || []).filter(edge => edge.fromId !== npc.id && edge.toId !== npc.id);
            return { npcId: npc.id, name: npc.name };
        }, { checkpointReason: 'manual-delete' });
    }

    function getStaleReport() {
        const chatKey = getChatKey();
        const state = cache.get(chatKey);
        if (!state) return [];
        const chat = getContext().chat || [];
        const messageId = latestAssistantMessageId(chat);
        return buildStaleReport(state, getSettings(), narrativeTurnForMessage(chat, messageId));
    }

    async function reconcileBranch({ rescan = false } = {}) {
        const chatKey = getChatKey();
        if (!chatKey || chatKey === 'no-chat') return { ok: false, reason: 'no-chat' };
        invalidate(chatKey);
        let result;
        await exclusive(chatKey, async () => {
            const state = await loadChat(chatKey);
            const reconciled = reconcileToCurrentBranch(state, getContext().chat || []);
            if (!reconciled.changed) {
                result = { ok: true, changed: false, unsafeDivergence: false, checkpoint: bestCheckpoint(state, getContext().chat || []) };
                return;
            }
            const persisted = await persist(chatKey, reconciled.state);
            result = { ok: true, changed: true, unsafeDivergence: reconciled.unsafeDivergence === true, checkpoint: reconciled.checkpoint, state: structuredClone(persisted) };
        });
        if (result?.unsafeDivergence) return result;
        if (rescan && getSettings().branchRescan !== false) {
            const id = latestAssistantMessageId(getContext().chat || []);
            if (id >= 0) result.rescan = await scan(id, { manual: false, force: true });
        }
        return result;
    }

    return Object.freeze({
        loadChat,
        scan,
        refreshDossier,
        addNpc,
        updateNpc,
        archiveNpc,
        resetNpcStaleness,
        deleteNpc,
        getStaleReport,
        reconcileBranch,
        invalidate,
        getState: chatKey => cache.has(chatKey || getChatKey()) ? structuredClone(cache.get(chatKey || getChatKey())) : null,
        hydrationStatus: chatKey => hydration.get(chatKey || getChatKey()) || { status: cache.has(chatKey || getChatKey()) ? 'ready' : 'unloaded', error: null },
        isBusy: chatKey => locks.has(chatKey || getChatKey()),
    });
}
