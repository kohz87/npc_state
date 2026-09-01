from pathlib import Path
p=Path('index.js'); text=p.read_text()
def r(a,b,label):
 global text
 if a not in text: raise RuntimeError('missing anchor: '+label)
 text=text.replace(a,b,1)
r('const loadingChatStates = new Map();\nconst stateWriteTimers = new Map();','const loadingChatStates = new Map();\nconst hydrationErrors = new Map();\nconst stateWriteTimers = new Map();','hydration map')
r("""function setChatState(key, state) {
    if (!key || key === 'no-chat') return state;
    const normalized = normalizeChatState(state);
    chatStateCache.set(key, normalized);
    loadedChatKeys.add(key);
    stateVersions.set(key, Number(stateVersions.get(key) || 0) + 1);
    return normalized;
}""","""function setChatState(key, state, { markLoaded = true } = {}) {
    if (!key || key === 'no-chat') return state;
    const normalized = normalizeChatState(state);
    chatStateCache.set(key, normalized);
    if (markLoaded) { loadedChatKeys.add(key); hydrationErrors.delete(key); }
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
    if (pointer?.path && !loadedChatKeys.has(key)) throw new Error('Refusing to overwrite unhydrated NPC State sidecar for ' + key + '.');
}""",'set state')
r("""        if (pointer?.path) {
            try {
                const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
                if (payload?.state) loaded = payload.state;
            } catch (error) {
                console.warn(`[NPC State] Could not read data file for ${key}; using migration/fresh fallback.`, error);
            }
        }
        const legacy = settings.chats && typeof settings.chats === 'object' ? settings.chats[key] : null;
        const sourceState = loaded || legacy || freshChatState();""","""        if (pointer?.path) {
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
                console.error(`[NPC State] Could not hydrate data file for ${key}; preserving the sidecar and blocking writes.`, lastError);
                throw lastError || new Error('NPC State could not hydrate ' + key + '.');
            }
        }
        const legacy = settings.chats && typeof settings.chats === 'object' ? settings.chats[key] : null;
        const sourceState = loaded || legacy || freshChatState();""",'fail closed')
r("async function flushStateFile(key = getChatKey()) {\n    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return null;","async function flushStateFile(key = getChatKey()) {\n    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return null;\n    assertChatHydratedForWrite(key);",'write guard')
r("""async function handleAssistantMessageReceived(messageId, { bypassSwipeGuard = false, forceBranchRescan = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;""","""async function handleAssistantMessageReceived(messageId, { bypassSwipeGuard = false, forceBranchRescan = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;
    const eventChatKey = getChatKey();
    if (eventChatKey === 'no-chat') return;
    try { await ensureChatStateLoaded(eventChatKey); }
    catch (error) {
        console.error('[NPC State] assistant event deferred because chat hydration failed.', error);
        globalThis.toastr?.error?.('NPC State could not load this chat dossier. Existing sidecar data was preserved; retry after the server is available.');
        return;
    }
    if (getChatKey() !== eventChatKey) return;""",'assistant hydration')
r("""    const compactWorldStateTurn = hasCompactMeguminWorldState(receivedMessage?.mes || '');
    for (const npc of state.npcs) {
        npc.present = false;
        if (!compactWorldStateTurn) npc.worldActive = false;
    }
    state.assistantSinceScan = Number(state.assistantSinceScan || 0) + 1;""","""    const compactWorldStateTurn = hasCompactMeguminWorldState(receivedMessage?.mes || '');
    // Presence remains last-confirmed until a successful scanner observation replaces it.
    // A skipped, busy, failed, or timed-out scan must not make every NPC disappear.
    if (!compactWorldStateTurn) for (const npc of state.npcs) npc.worldActive = Boolean(npc.worldActive);
    state.assistantSinceScan = Number(state.assistantSinceScan || 0) + 1;""",'presence')
r("function queueBranchRescan(messageId, attempt = 0) {\n    if (!Number.isInteger(messageId) || messageId < 0) return;\n    setTimeout(async () => {\n        if (getChatKey() === 'no-chat') return;","function queueBranchRescan(messageId, attempt = 0, originKey = getChatKey()) {\n    if (!Number.isInteger(messageId) || messageId < 0 || originKey === 'no-chat') return;\n    setTimeout(async () => {\n        if (getChatKey() !== originKey) return;",'rescan affinity')
r('if (attempt < 12) queueBranchRescan(messageId, attempt + 1);','if (attempt < 250) queueBranchRescan(messageId, attempt + 1, originKey);','rescan lifetime')
r("function queueBranchReconcile(options = {}, delay = 90) {\n    if (isHostSwipeActive()) {","function queueBranchReconcile(options = {}, delay = 90) {\n    const originKey = options.chatKey || getChatKey();\n    if (originKey === 'no-chat') return;\n    options = { ...options, chatKey: originKey };\n    if (isHostSwipeActive()) {",'reconcile capture')
r("        try {\n            await reconcileCurrentBranch(pending);","        try {\n            if (pending.chatKey && getChatKey() !== pending.chatKey) return;\n            await reconcileCurrentBranch(pending);",'reconcile check')
r("""        const request = state.pendingBackfills.shift();
        persist();
        await backfillNpcFromHistory(request, messageId);
        processed += 1;""","""        const request = state.pendingBackfills[0];
        const succeeded = await backfillNpcFromHistory(request, messageId);
        if (!succeeded) {
            request.attempts = Math.max(0, Number(request.attempts || 0)) + 1;
            request.lastAttemptAt = Date.now();
            persist();
            break;
        }
        const latest = getChatState(chatKey);
        latest.pendingBackfills = (latest.pendingBackfills || []).filter(item => item !== request && item.npcId !== request.npcId);
        persist();
        processed += 1;""",'backfill queue')
r("        requestedAt: Number(item?.requestedAt || 0) || Date.now(),\n    })).filter(item => item.npcId && item.label) : [];","        requestedAt: Number(item?.requestedAt || 0) || Date.now(),\n        attempts: Math.max(0, Number(item?.attempts || 0)),\n        lastAttemptAt: Math.max(0, Number(item?.lastAttemptAt || 0)),\n    })).filter(item => item.npcId && item.label) : [];",'backfill metadata')
r("    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, () => queueInlineRender(30));","""    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, async () => {
        const key = getChatKey();
        if (key === 'no-chat') return;
        try {
            await ensureChatStateLoaded(key);
            if (getChatKey() !== key) return;
            renderDossier(); ensureInlineObserver(); queueInlineRender(0);
            setTimeout(() => { if (getChatKey() === key) queueInlineRender(0); }, 350);
        } catch (error) { console.error('[NPC State] post-load hydration/render failed; durable data was not overwritten.', error); }
    });""",'chat loaded render')
r("""    if (events.MESSAGE_SENT) {
        source.on(events.MESSAGE_SENT, (messageId) => {
            const reports = processOocCommands(messageId);""","""    if (events.MESSAGE_SENT) {
        source.on(events.MESSAGE_SENT, async (messageId) => {
            const key = getChatKey();
            if (key === 'no-chat') return;
            try { await ensureChatStateLoaded(key); } catch (error) { console.error('[NPC State] OOC command skipped because chat hydration failed.', error); return; }
            if (getChatKey() !== key) return;
            const reports = processOocCommands(messageId);""",'ooc hydration')
r('        scanBusyForChat: isScanBusy(getChatKey()),',"        hydrationStatus: chatHydrationStatus(getChatKey()),\n        hydrationError: hydrationErrors.get(getChatKey())?.message || null,\n        scanBusyForChat: isScanBusy(getChatKey()),",'debug')
r('/* NPC State v0.2.12 - standalone SillyTavern extension */','/* NPC State v0.2.13 - standalone SillyTavern extension */','header')
p.write_text(text)
print('Applied v0.2.13 runtime hardening')
