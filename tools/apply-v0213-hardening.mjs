import fs from 'node:fs';

const path = 'index.js';
let text = fs.readFileSync(path, 'utf8');
function replaceOnce(before, after, label) {
  if (!text.includes(before)) throw new Error(`patch anchor missing: ${label}`);
  text = text.replace(before, after);
}

replaceOnce(
`const loadingChatStates = new Map();
const stateWriteTimers = new Map();`,
`const loadingChatStates = new Map();
const hydrationErrors = new Map();
const stateWriteTimers = new Map();`, 'hydration map');

replaceOnce(
`function setChatState(key, state) {
    if (!key || key === 'no-chat') return state;
    const normalized = normalizeChatState(state);
    chatStateCache.set(key, normalized);
    loadedChatKeys.add(key);
    stateVersions.set(key, Number(stateVersions.get(key) || 0) + 1);
    return normalized;
}`,
`function setChatState(key, state, { markLoaded = true } = {}) {
    if (!key || key === 'no-chat') return state;
    const normalized = normalizeChatState(state);
    chatStateCache.set(key, normalized);
    if (markLoaded) {
        loadedChatKeys.add(key);
        hydrationErrors.delete(key);
    }
    stateVersions.set(key, Number(stateVersions.get(key) || 0) + 1);
    return normalized;
}

function chatHydrationStatus(key = getChatKey()) {
    if (!key || key === 'no-chat') return 'none';
    if (loadedChatKeys.has(key)) return 'ready';
    if (loadingChatStates.has(key)) return 'loading';
    if (hydrationErrors.has(key)) return 'error';
    return 'idle';
}

function assertChatHydratedForWrite(key = getChatKey()) {
    if (!key || key === 'no-chat') return;
    const pointer = getSettings().dataFiles?.[key];
    if (pointer?.path && !loadedChatKeys.has(key)) {
        throw new Error(`Refusing to overwrite unhydrated NPC State sidecar for ${key}.`);
    }
}`, 'setChatState hydration');

replaceOnce(
`        if (pointer?.path) {
            try {
                const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
                if (payload?.state) loaded = payload.state;
            } catch (error) {
                console.warn(\`[NPC State] Could not read data file for \${key}; using migration/fresh fallback.\`, error);
            }
        }
        const legacy = settings.chats && typeof settings.chats === 'object' ? settings.chats[key] : null;
        const sourceState = loaded || legacy || freshChatState();`,
`        if (pointer?.path) {
            let lastError = null;
            for (let attempt = 0; attempt < 3 && !loaded; attempt += 1) {
                try {
                    const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
                    if (payload?.state) loaded = payload.state;
                    else throw new Error('NPC State sidecar returned no state payload.');
                } catch (error) {
                    lastError = error;
                    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
                }
            }
            if (!loaded) {
                hydrationErrors.set(key, lastError || new Error('NPC State sidecar could not be loaded.'));
                console.error(\`[NPC State] Could not hydrate data file for \${key}; preserving the sidecar and blocking writes.\`, lastError);
                throw lastError || new Error(\`NPC State could not hydrate \${key}.\`);
            }
        }
        const legacy = settings.chats && typeof settings.chats === 'object' ? settings.chats[key] : null;
        const sourceState = loaded || legacy || freshChatState();`, 'sidecar fail closed');

replaceOnce(
`async function flushStateFile(key = getChatKey()) {
    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return null;`,
`async function flushStateFile(key = getChatKey()) {
    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return null;
    assertChatHydratedForWrite(key);`, 'write guard');

replaceOnce(
`async function handleAssistantMessageReceived(messageId, { bypassSwipeGuard = false, forceBranchRescan = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;`,
`async function handleAssistantMessageReceived(messageId, { bypassSwipeGuard = false, forceBranchRescan = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;
    const eventChatKey = getChatKey();
    if (eventChatKey === 'no-chat') return;
    try {
        await ensureChatStateLoaded(eventChatKey);
    } catch (error) {
        console.error('[NPC State] assistant event deferred because chat hydration failed.', error);
        globalThis.toastr?.error?.('NPC State could not load this chat dossier. Existing sidecar data was preserved; retry or refresh after the server is available.');
        return;
    }
    if (getChatKey() !== eventChatKey) return;`, 'assistant hydration');

replaceOnce(
`    const compactWorldStateTurn = hasCompactMeguminWorldState(receivedMessage?.mes || '');
    for (const npc of state.npcs) {
        npc.present = false;
        if (!compactWorldStateTurn) npc.worldActive = false;
    }
    state.assistantSinceScan = Number(state.assistantSinceScan || 0) + 1;`,
`    const compactWorldStateTurn = hasCompactMeguminWorldState(receivedMessage?.mes || '');
    // Presence is last-confirmed state. Do not erase it before a scanner succeeds:
    // a skipped, busy, failed, or timed-out scan must not teleport every NPC away.
    if (!compactWorldStateTurn) {
        for (const npc of state.npcs) npc.worldActive = Boolean(npc.worldActive);
    }
    state.assistantSinceScan = Number(state.assistantSinceScan || 0) + 1;`, 'presence transaction');

replaceOnce(
`function queueBranchRescan(messageId, attempt = 0) {
    if (!Number.isInteger(messageId) || messageId < 0) return;
    setTimeout(async () => {
        if (getChatKey() === 'no-chat') return;`,
`function queueBranchRescan(messageId, attempt = 0, originKey = getChatKey()) {
    if (!Number.isInteger(messageId) || messageId < 0 || originKey === 'no-chat') return;
    setTimeout(async () => {
        if (getChatKey() !== originKey) return;`, 'branch rescan affinity');
replaceOnce(
`            if (attempt < 12) queueBranchRescan(messageId, attempt + 1);`,
`            if (attempt < 250) queueBranchRescan(messageId, attempt + 1, originKey);`, 'branch rescan lifetime');

replaceOnce(
`function queueBranchReconcile(options = {}, delay = 90) {
    if (isHostSwipeActive()) {`,
`function queueBranchReconcile(options = {}, delay = 90) {
    const originKey = options.chatKey || getChatKey();
    if (originKey === 'no-chat') return;
    options = { ...options, chatKey: originKey };
    if (isHostSwipeActive()) {`, 'branch reconcile affinity capture');
replaceOnce(
`        try {
            await reconcileCurrentBranch(pending);`,
`        try {
            if (pending.chatKey && getChatKey() !== pending.chatKey) return;
            await reconcileCurrentBranch(pending);`, 'branch reconcile affinity check');

replaceOnce(
`        const request = state.pendingBackfills.shift();
        persist();
        await backfillNpcFromHistory(request, messageId);
        processed += 1;`,
`        const request = state.pendingBackfills[0];
        const succeeded = await backfillNpcFromHistory(request, messageId);
        if (!succeeded) {
            request.attempts = Math.max(0, Number(request.attempts || 0)) + 1;
            request.lastAttemptAt = Date.now();
            persist();
            break;
        }
        const latest = getChatState(chatKey);
        if (latest.pendingBackfills?.[0]?.npcId === request.npcId) latest.pendingBackfills.shift();
        else latest.pendingBackfills = (latest.pendingBackfills || []).filter(item => item !== request);
        persist();
        processed += 1;`, 'backfill success dequeue');

replaceOnce(
`        requestedAt: Number(item?.requestedAt || 0) || Date.now(),
    })).filter(item => item.npcId && item.label) : [];`,
`        requestedAt: Number(item?.requestedAt || 0) || Date.now(),
        attempts: Math.max(0, Number(item?.attempts || 0)),
        lastAttemptAt: Math.max(0, Number(item?.lastAttemptAt || 0)),
    })).filter(item => item.npcId && item.label) : [];`, 'backfill retry metadata');

replaceOnce(
`    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, () => queueInlineRender(30));`,
`    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, async () => {
        const key = getChatKey();
        if (key === 'no-chat') return;
        try {
            await ensureChatStateLoaded(key);
            if (getChatKey() !== key) return;
            renderDossier();
            ensureInlineObserver();
            queueInlineRender(0);
            setTimeout(() => { if (getChatKey() === key) queueInlineRender(0); }, 350);
        } catch (error) {
            console.error('[NPC State] post-load hydration/render failed; durable data was not overwritten.', error);
        }
    });`, 'post hydration render');

replaceOnce(
`    if (events.MESSAGE_SENT) {
        source.on(events.MESSAGE_SENT, (messageId) => {
            const reports = processOocCommands(messageId);`,
`    if (events.MESSAGE_SENT) {
        source.on(events.MESSAGE_SENT, async (messageId) => {
            const key = getChatKey();
            if (key === 'no-chat') return;
            try { await ensureChatStateLoaded(key); } catch (error) {
                console.error('[NPC State] OOC command skipped because chat hydration failed.', error);
                return;
            }
            if (getChatKey() !== key) return;
            const reports = processOocCommands(messageId);`, 'OOC hydration');

replaceOnce(
`        scanBusyForChat: isScanBusy(getChatKey()),`,
`        hydrationStatus: chatHydrationStatus(getChatKey()),
        hydrationError: hydrationErrors.get(getChatKey())?.message || null,
        scanBusyForChat: isScanBusy(getChatKey()),`, 'debug hydration');

replaceOnce(
`/* NPC State v0.2.12 - standalone SillyTavern extension */`,
`/* NPC State v0.2.13 - standalone SillyTavern extension */`, 'header version');

fs.writeFileSync(path, text);
console.log('Applied v0.2.13 runtime hardening patch.');
