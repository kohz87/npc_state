from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / 'index.js'
CORE = ROOT / 'core.js'
MANIFEST = ROOT / 'manifest.json'
CHANGELOG = ROOT / 'CHANGELOG.md'
PACKAGE_TEST = ROOT / 'tests' / 'package.test.js'
RUNTIME_SMOKE = ROOT / 'tests' / 'runtime-smoke.mjs'
HARDENING_TEST = ROOT / 'tests' / 'v0214-hardening.test.js'


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Hardening patch anchor missing: {label}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    a = text.find(start)
    if a < 0:
        if replacement in text:
            return text
        raise SystemExit(f'Hardening function start missing: {label}')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'Hardening function end missing: {label}')
    return text[:a] + replacement.rstrip() + '\n\n' + text[b:]


src = INDEX.read_text()

src = replace_once(src,
    '/* NPC State v0.2.13 - standalone SillyTavern extension */',
    '/* NPC State v0.2.14 - standalone SillyTavern extension */',
    'index version header')

src = replace_once(src,
    "    deleteNpcStateDataFile,\n    readNpcStateDataFile,\n    writeNpcStateDataFile,\n} from './storage.js';",
    "    deleteNpcStateDataFile,\n    makeNpcStateDataFileName,\n    readNpcStateDataFile,\n    writeNpcStateDataFile,\n} from './storage.js';",
    'storage filename import')

src = replace_once(src,
    "let activeEditorPopup = null;\nlet activeNpcViewerOverlay = null;",
    "let activeEditorPopup = null;\nlet activeEditorChatKey = '';\nlet activeNpcViewerOverlay = null;",
    'editor chat affinity state')

src = replace_once(src,
    "let activePortraitGeneratorOverlay = null;\nlet activePortraitGeneratorNpcId = '';",
    "let activePortraitGeneratorOverlay = null;\nlet activePortraitGeneratorChatKey = '';\nlet activePortraitGeneratorNpcId = '';",
    'portrait chat affinity state')

src = replace_once(src,
    "            if (npcId && operation.metadata?.indicator === 'refresh') setNpcChatRefreshIndicator(npcId, false);\n            updateInjection();",
    "            if (npcId && operation.metadata?.indicator === 'refresh') setNpcChatRefreshIndicator(npcId, false);\n            updateInjection();\n            if (pendingAutoScans.has(operation.key)) {\n                setTimeout(() => {\n                    if (getChatKey() === operation.key && !isHostSwipeActive()) void drainPendingAutoScan(operation.key);\n                }, 0);\n            }",
    'scan-timeout pending scan drain')

src = replace_once(src,
    "        requestedMessageId: Number.isInteger(item?.requestedMessageId) ? item.requestedMessageId : null,\n        requestedAt: Number(item?.requestedAt || 0) || Date.now(),",
    "        requestedMessageId: Number.isInteger(item?.requestedMessageId) ? item.requestedMessageId : null,\n        requestedAt: Number(item?.requestedAt || 0) || Date.now(),\n        attempts: Math.max(0, Math.min(BACKFILL_MAX_ATTEMPTS, Math.round(Number(item?.attempts) || 0))),\n        lastAttemptAt: Math.max(0, Number(item?.lastAttemptAt || 0) || 0),",
    'durable backfill retry metadata')

src = replace_once(src,
    "function setChatState(key, state, { markLoaded = true } = {}) {",
    "function setChatState(key, state, { markLoaded = false } = {}) {",
    'fail-closed setChatState default')

ready_helpers = r'''function assertChatHydratedForWrite(key = getChatKey()) {
    if (!key || key === 'no-chat') return;
    const pointer = getSettings().dataFiles?.[key];
    if (pointer?.path && !loadedChatKeys.has(key)) throw new Error('Refusing to overwrite unhydrated NPC State sidecar for ' + key + '.');
}

function requireReadyChatMutation(action = 'modify NPC State', key = getChatKey(), { notify = true } = {}) {
    if (!key || key === 'no-chat') {
        if (notify) globalThis.toastr?.warning?.(`NPC State: open a chat before attempting to ${action}.`);
        return false;
    }
    if (chatHydrationStatus(key) === 'ready') return true;
    const error = hydrationErrors.get(key);
    if (notify) globalThis.toastr?.warning?.(`NPC State: cannot ${action} until this chat dossier loads successfully.${error?.message ? ` ${error.message}` : ''}`);
    return false;
}

async function retryCurrentChatHydration() {
    const key = getChatKey();
    if (!key || key === 'no-chat') return false;
    try {
        await ensureChatStateLoaded(key);
        if (getChatKey() !== key) return false;
        renderDossier();
        updateInjection();
        globalThis.toastr?.success?.('NPC State: chat dossier loaded successfully.');
        return true;
    } catch (error) {
        if (getChatKey() === key) { renderDossier(); updateInjection(); }
        globalThis.toastr?.error?.(`NPC State still cannot load this chat dossier: ${error?.message || error}`);
        return false;
    }
}'''

src = replace_between(src,
    'function assertChatHydratedForWrite(key = getChatKey()) {',
    'function requestHeaders() {',
    ready_helpers,
    'mutation guard and hydration retry')

src = replace_once(src,
    '        const state = setChatState(key, sourceState);',
    '        const state = setChatState(key, sourceState, { markLoaded: true });',
    'loader authority')

src = replace_once(src,
    "function queueStateFileWrite(key = getChatKey(), delay = STATE_WRITE_DELAY) {\n    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return;\n    markStateDirty(key);",
    "function queueStateFileWrite(key = getChatKey(), delay = STATE_WRITE_DELAY) {\n    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return;\n    if (chatHydrationStatus(key) !== 'ready') {\n        console.warn(`[NPC State] refused to queue an unhydrated state write for ${key}.`);\n        return;\n    }\n    markStateDirty(key);",
    'queued-write hydration guard')

src = replace_once(src,
    "function persist() {\n    persistSettings();\n    queueStateFileWrite();\n}",
    "function persist() {\n    const key = getChatKey();\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) {\n        console.warn(`[NPC State] refused to persist unhydrated chat state for ${key}.`);\n        return false;\n    }\n    persistSettings();\n    queueStateFileWrite(key);\n    return true;\n}",
    'persist hydration guard')

rename_fn = r'''async function moveRenamedChatState(eventData = {}) {
    const oldId = String(eventData.oldFileName || '').replace(/\.jsonl$/i, '');
    const newId = String(eventData.newFileName || '').replace(/\.jsonl$/i, '');
    if (!oldId || !newId || oldId === newId) return false;
    const settings = getSettings();
    const currentPrefix = getChatKey().startsWith('group:') ? 'group:' : 'chat:';
    const oldKey = `${currentPrefix}${oldId}`;
    const newKey = `${currentPrefix}${newId}`;
    const hasOld = Boolean(settings.dataFiles?.[oldKey] || settings.chats?.[oldKey] || chatStateCache.has(oldKey));
    if (!hasOld) return false;
    if (settings.dataFiles?.[newKey] || settings.chats?.[newKey] || chatStateCache.has(newKey)) {
        console.warn(`[NPC State] refused to rename ${oldKey} onto existing state ${newKey}.`);
        return false;
    }

    try {
        await ensureChatStateLoaded(oldKey);
        await settleStateFileWrite(oldKey, { flush: true });
        const state = structuredClone(getChatState(oldKey));
        const oldPointer = settings.dataFiles?.[oldKey] || null;
        const newName = makeNpcStateDataFileName(newKey);
        if (oldPointer?.name === newName) throw new Error('NPC State rename filename collision detected.');

        // Phase 1: write and verify the new-key sidecar while the old mapping is still authoritative.
        const newPointer = await writeNpcStateDataFile({
            chatKey: newKey,
            state,
            appVersion: NPC_STATE_VERSION,
            pointer: { name: newName },
            headers: requestHeaders(),
        });
        await readNpcStateDataFile(newPointer, { expectedChatKey: newKey });

        // Phase 2: switch ownership only after the new sidecar can be read under the new key.
        settings.dataFiles[newKey] = newPointer;
        delete settings.dataFiles[oldKey];
        if (settings.chats?.[oldKey]) delete settings.chats[oldKey];
        chatStateCache.delete(oldKey);
        loadedChatKeys.delete(oldKey);
        loadingChatStates.delete(oldKey);
        hydrationErrors.delete(oldKey);
        stateVersions.delete(oldKey);
        persistedVersions.delete(oldKey);
        stateWritePromises.delete(oldKey);
        pendingAutoScans.delete(oldKey);
        const installed = setChatState(newKey, state, { markLoaded: true });
        persistedVersions.set(newKey, Number(stateVersions.get(newKey) || 0));
        persistSettings();

        // Phase 3: old storage becomes cleanup only; failure here cannot invalidate the rename.
        if (oldPointer?.path && oldPointer.path !== newPointer.path) {
            try { await deleteNpcStateDataFile(oldPointer, { headers: requestHeaders() }); }
            catch (error) { console.warn(`[NPC State] renamed state is safe, but the old sidecar could not be deleted for ${oldKey}.`, error); }
        }
        return Boolean(installed);
    } catch (error) {
        console.warn(`[NPC State] transactional rename failed for ${oldKey}; original mapping was preserved.`, error);
        return false;
    }
}'''

src = replace_between(src,
    'async function moveRenamedChatState(eventData = {}) {',
    'function flushCurrentChatOnPageHide() {',
    rename_fn,
    'transactional chat rename')

src = replace_once(src,
    "        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,\n        requestedAt: Date.now(),",
    "        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,\n        requestedAt: Date.now(),\n        attempts: 0,\n        lastAttemptAt: 0,",
    'new backfill retry metadata')

src = replace_once(src,
    'const BACKFILL_RESPONSE_LENGTH = 3200;\nconst JSON_RETRY_RESPONSE_LENGTH = 5200;',
    'const BACKFILL_RESPONSE_LENGTH = 3200;\nconst BACKFILL_MAX_ATTEMPTS = 3;\nconst BACKFILL_RETRY_COOLDOWN_MS = 60 * 1000;\nconst JSON_RETRY_RESPONSE_LENGTH = 5200;',
    'backfill retry constants')

backfill_fn = r'''async function processPendingBackfills(messageId = null) {
    const chatKey = getChatKey();
    if (chatKey === 'no-chat' || !requireReadyChatMutation('process queued dossier backfills', chatKey, { notify: false }) || isScanBusy(chatKey) || isHostSwipeActive()) return 0;
    let processed = 0;
    while (getChatKey() === chatKey && !isScanBusy(chatKey)) {
        const state = getChatState(chatKey);
        if (!Array.isArray(state.pendingBackfills) || !state.pendingBackfills.length) break;
        const request = state.pendingBackfills[0];
        const attempts = Math.max(0, Math.round(Number(request.attempts) || 0));
        if (attempts >= BACKFILL_MAX_ATTEMPTS) {
            state.pendingBackfills.shift();
            persist();
            globalThis.toastr?.warning?.(`NPC State: stopped automatic backfill retries for ${request.label} after ${BACKFILL_MAX_ATTEMPTS} failed attempts. The bare dossier is preserved; use Scan dossier to retry manually.`);
            continue;
        }
        const lastAttemptAt = Math.max(0, Number(request.lastAttemptAt || 0) || 0);
        if (attempts > 0 && lastAttemptAt && Date.now() - lastAttemptAt < BACKFILL_RETRY_COOLDOWN_MS) break;

        const succeeded = await backfillNpcFromHistory(request, messageId);
        if (!succeeded) {
            request.attempts = attempts + 1;
            request.lastAttemptAt = Date.now();
            if (request.attempts >= BACKFILL_MAX_ATTEMPTS) {
                state.pendingBackfills = state.pendingBackfills.filter(item => item !== request && item.npcId !== request.npcId);
                globalThis.toastr?.warning?.(`NPC State: automatic backfill for ${request.label} failed ${BACKFILL_MAX_ATTEMPTS} times and was removed from the retry queue. The dossier itself was not deleted.`);
            }
            persist();
            break;
        }
        const latest = getChatState(chatKey);
        latest.pendingBackfills = (latest.pendingBackfills || []).filter(item => item !== request && item.npcId !== request.npcId);
        persist();
        processed += 1;
    }
    return processed;
}'''

src = replace_between(src,
    'async function processPendingBackfills(messageId = null) {',
    'function rawScanMatchesExisting(raw, npc) {',
    backfill_fn,
    'bounded backfill loop')

for label, old, new in [
    ('dossier scan guard',
     "    if (!id || chatKey === 'no-chat') return false;\n    if (isScanBusy(chatKey)) {",
     "    if (!id || chatKey === 'no-chat' || !requireReadyChatMutation('scan a dossier', chatKey)) return false;\n    if (isScanBusy(chatKey)) {"),
    ('refresh guard',
     "    if (!id || chatKey === 'no-chat') return false;\n    if (isScanBusy(chatKey)) {",
     "    if (!id || chatKey === 'no-chat' || !requireReadyChatMutation('refresh a dossier', chatKey)) return false;\n    if (isScanBusy(chatKey)) {"),
    ('backfill guard',
     "    if (!request?.npcId || !request?.label || chatKey === 'no-chat') return false;",
     "    if (!request?.npcId || !request?.label || chatKey === 'no-chat' || !requireReadyChatMutation('backfill a dossier', chatKey, { notify: false })) return false;"),
]:
    if old in src:
        src = src.replace(old, new, 1)
    elif new not in src:
        raise SystemExit(f'Hardening patch anchor missing: {label}')

src = replace_once(src,
    "function currentNpcById(id) {\n    return getChatState().npcs.find(npc => npc.id === id) || null;\n}",
    "function currentNpcById(id) {\n    if (chatHydrationStatus(getChatKey()) !== 'ready') return null;\n    return getChatState().npcs.find(npc => npc.id === id) || null;\n}",
    'current NPC hydration guard')

src = replace_once(src,
    "function findNpcByIdOrName(value) {\n    const query = String(value || '').trim();\n    if (!query) return null;",
    "function findNpcByIdOrName(value) {\n    const query = String(value || '').trim();\n    if (!query || chatHydrationStatus(getChatKey()) !== 'ready') return null;",
    'find NPC hydration guard')

roster_head = r'''function renderSettingsRoster() {
    const holder = $('#npc_state_roster_summary');
    if (!holder.length) return;
    const key = getChatKey();
    const hydration = chatHydrationStatus(key);
    if (key === 'no-chat') {
        holder.html('<span class="npc-state-muted">Open a chat to load its NPC State dossier.</span>');
        return;
    }
    if (hydration !== 'ready') {
        const error = hydrationErrors.get(key);
        const message = hydration === 'error'
            ? `NPC State could not load this chat dossier. Existing sidecar data is preserved and all dossier writes are locked.${error?.message ? ` ${escapeHtml(error.message)}` : ''}`
            : 'NPC State is loading this chat dossier. Dossier writes remain locked until loading succeeds.';
        const retry = hydration === 'error' ? '<div class="menu_button npc-state-retry-hydration"><i class="fa-solid fa-rotate"></i> Retry Load</div>' : '';
        holder.html(`<div class="npc-state-hydration-warning"><b>${hydration === 'error' ? 'Dossier load failed' : 'Loading dossier...'}</b><span>${message}</span>${retry}</div>`);
        return;
    }
    const state = getChatState(key);'''

src = replace_between(src,
    'function renderSettingsRoster() {',
    "    if (!state.npcs.length) {",
    roster_head,
    'hydration-aware roster')

src = replace_once(src,
    "function openNpcEditor(npcId) {\n    const npc = currentNpcById(npcId);\n    if (!npc) return null;\n    closeNpcEditor();",
    "function openNpcEditor(npcId) {\n    const originChatKey = getChatKey();\n    if (!requireReadyChatMutation('edit a dossier', originChatKey)) return null;\n    const npc = currentNpcById(npcId);\n    if (!npc) return null;\n    closeNpcEditor();\n    activeEditorChatKey = originChatKey;",
    'editor origin capture')

src = replace_once(src,
    "function saveNpcEditor(npcId, { close = true, silent = false } = {}) {\n    const state = getChatState();",
    "function saveNpcEditor(npcId, { close = true, silent = false } = {}) {\n    const originChatKey = activeEditorChatKey || getChatKey();\n    if (getChatKey() !== originChatKey || !requireReadyChatMutation('save dossier edits', originChatKey)) {\n        globalThis.toastr?.warning?.('NPC State: this editor belongs to a different or unloaded chat. Reopen the dossier in the active chat.');\n        return false;\n    }\n    const state = getChatState(originChatKey);",
    'editor save affinity')

src = replace_once(src,
    "function closeNpcEditor() {\n    const popup = activeEditorPopup;\n    activeEditorPopup = null;",
    "function closeNpcEditor() {\n    const popup = activeEditorPopup;\n    activeEditorPopup = null;\n    activeEditorChatKey = '';",
    'editor close affinity cleanup')

src = replace_once(src,
    "function closePortraitGenerator() {\n    const overlay = activePortraitGeneratorOverlay;\n    activePortraitGeneratorOverlay = null;",
    "function closePortraitGenerator() {\n    const overlay = activePortraitGeneratorOverlay;\n    activePortraitGeneratorOverlay = null;\n    activePortraitGeneratorChatKey = '';",
    'portrait close affinity cleanup')

src = replace_once(src,
    "function openPortraitGenerator(npcId) {\n    const id = String(npcId || '').trim();",
    "function openPortraitGenerator(npcId) {\n    const originChatKey = getChatKey();\n    if (!requireReadyChatMutation('generate a portrait', originChatKey)) return false;\n    const id = String(npcId || '').trim();",
    'portrait origin capture')

src = replace_once(src,
    "    activePortraitGeneratorOverlay = overlay;\n    activePortraitGeneratorNpcId = id;",
    "    activePortraitGeneratorOverlay = overlay;\n    activePortraitGeneratorChatKey = originChatKey;\n    activePortraitGeneratorNpcId = id;",
    'portrait stores origin')

src = replace_once(src,
    "function resetPortraitGeneratorFromDossier() {\n    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || portraitGenerationBusy) return false;",
    "function resetPortraitGeneratorFromDossier() {\n    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || portraitGenerationBusy) return false;\n    if (getChatKey() !== activePortraitGeneratorChatKey || !requireReadyChatMutation('reset portrait prompts', activePortraitGeneratorChatKey)) return false;",
    'portrait reset affinity')

src = replace_once(src,
    "async function generatePortraitFromDialog() {\n    const overlay = activePortraitGeneratorOverlay;\n    const npc = currentNpcById(activePortraitGeneratorNpcId);\n    if (!overlay || !npc || portraitGenerationBusy) return false;",
    "async function generatePortraitFromDialog() {\n    const overlay = activePortraitGeneratorOverlay;\n    const originChatKey = activePortraitGeneratorChatKey;\n    if (!originChatKey || getChatKey() !== originChatKey || !requireReadyChatMutation('generate a portrait', originChatKey)) return false;\n    const npc = currentNpcById(activePortraitGeneratorNpcId);\n    if (!overlay || !npc || portraitGenerationBusy) return false;",
    'portrait generation affinity')

src = replace_once(src,
    "        if (!activePortraitGeneratorOverlay || activePortraitGeneratorNpcId !== npc.id) return false;",
    "        if (!activePortraitGeneratorOverlay || activePortraitGeneratorNpcId !== npc.id || activePortraitGeneratorChatKey !== originChatKey || getChatKey() !== originChatKey) return false;",
    'portrait async completion affinity')

src = replace_once(src,
    "async function useGeneratedPortrait() {\n    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || !activePortraitGenerationUrl || portraitGenerationBusy) return false;\n    const npc = currentNpcById(activePortraitGeneratorNpcId);",
    "async function useGeneratedPortrait() {\n    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || !activePortraitGenerationUrl || portraitGenerationBusy) return false;\n    const originChatKey = activePortraitGeneratorChatKey;\n    if (!originChatKey || getChatKey() !== originChatKey || !requireReadyChatMutation('apply a generated portrait', originChatKey)) return false;\n    const npc = currentNpcById(activePortraitGeneratorNpcId);",
    'portrait apply affinity')

src = replace_once(src,
    "function deleteNpcById(npcId, { confirmAction = true } = {}) {\n    const id = String(npcId || '').trim();\n    if (!id) return false;",
    "function deleteNpcById(npcId, { confirmAction = true } = {}) {\n    const id = String(npcId || '').trim();\n    if (!id || !requireReadyChatMutation('delete a dossier')) return false;",
    'delete guard')

src = replace_once(src,
    "function setNpcArchiveStateById(npcId, archived, { reason = 'manual', confirmAction = true } = {}) {\n    const state = getChatState();",
    "function setNpcArchiveStateById(npcId, archived, { reason = 'manual', confirmAction = true } = {}) {\n    if (!requireReadyChatMutation(archived ? 'archive a dossier' : 'restore a dossier')) return false;\n    const state = getChatState();",
    'archive guard')

src = replace_once(src,
    "function exportBundleBytes() {\n    return encodeNpcStateBundle(getChatState(), {",
    "function exportBundleBytes() {\n    if (!requireReadyChatMutation('export a dossier', getChatKey(), { notify: false })) throw new Error('NPC State chat dossier is not loaded.');\n    return encodeNpcStateBundle(getChatState(), {",
    'export hydration guard')

src = replace_once(src,
    "    const state = getChatState();\n    if (!state.npcs.length && !state.dismissed?.length) {",
    "    if (!requireReadyChatMutation('export a dossier')) return null;\n    const state = getChatState();\n    if (!state.npcs.length && !state.dismissed?.length) {",
    'export UI guard')

src = replace_once(src,
    "function importBundleBytes(bytes) {\n    const settings = getSettings();",
    "function importBundleBytes(bytes) {\n    if (!requireReadyChatMutation('import a dossier')) throw new Error('NPC State chat dossier is not loaded.');\n    const settings = getSettings();",
    'import guard')

src = replace_once(src,
    "function processOocCommands(messageId = null) {\n    const settings = getSettings();\n    if (!settings.enabled || getChatKey() === 'no-chat') return [];",
    "function processOocCommands(messageId = null) {\n    const settings = getSettings();\n    if (!settings.enabled || getChatKey() === 'no-chat' || !requireReadyChatMutation('process OOC dossier commands', getChatKey(), { notify: false })) return [];",
    'OOC guard')

src = replace_once(src,
    "    $(document).on('click.npcState', '#npc_state_scan_now', () => scanNow({ manual: true, messageId: latestMessageId(true) }));",
    "    $(document).on('click.npcState', '.npc-state-retry-hydration', () => { void retryCurrentChatHydration(); });\n    $(document).on('click.npcState', '#npc_state_scan_now', () => scanNow({ manual: true, messageId: latestMessageId(true) }));",
    'retry load handler')

src = replace_once(src,
    "    $(document).on('click.npcState', '#npc_state_add_manual', () => {\n        const settings = getSettings();",
    "    $(document).on('click.npcState', '#npc_state_add_manual', () => {\n        if (!requireReadyChatMutation('add an NPC')) return;\n        const settings = getSettings();",
    'manual add guard')

src = replace_once(src,
    "    $(document).on('click.npcState', '#npc_state_clear_chat', () => {\n        if (!window.confirm('Clear every NPC State dossier for this chat? Portraits and inline dossier cards will also be removed.')) return;",
    "    $(document).on('click.npcState', '#npc_state_clear_chat', () => {\n        if (!requireReadyChatMutation('clear this chat dossier')) return;\n        if (!window.confirm('Clear every NPC State dossier for this chat? Portraits and inline dossier cards will also be removed.')) return;",
    'clear guard')

src = replace_once(src,
    "    $(document).on('change.npcState', '.npc-state-inline-portrait-file', async function () {\n        const npc = currentNpcById(this.dataset.npcId);",
    "    $(document).on('change.npcState', '.npc-state-inline-portrait-file', async function () {\n        if (!requireReadyChatMutation('attach a portrait')) { this.value = ''; return; }\n        const originChatKey = getChatKey();\n        const originRevision = Number(stateVersions.get(originChatKey) || 0);\n        const npc = currentNpcById(this.dataset.npcId);",
    'portrait upload guard')

src = replace_once(src,
    "            npc.portrait = await compressPortrait(file);\n            getChatState().portraitAssets[npc.id] = structuredClone(npc.portrait);",
    "            const portrait = await compressPortrait(file);\n            if (getChatKey() !== originChatKey || Number(stateVersions.get(originChatKey) || 0) !== originRevision || !requireReadyChatMutation('attach a portrait', originChatKey)) return;\n            const liveNpc = getChatState(originChatKey).npcs.find(item => item.id === npc.id);\n            if (!liveNpc) return;\n            liveNpc.portrait = portrait;\n            getChatState(originChatKey).portraitAssets[liveNpc.id] = structuredClone(liveNpc.portrait);\n            liveNpc.updatedAt = Date.now();",
    'portrait upload stale completion guard')

src = src.replace('            npc.updatedAt = Date.now();\n            persist(); renderDossier();\n            globalThis.toastr?.success?.(`Portrait attached to ${npc.name}.`);',
                  '            persist(); renderDossier();\n            globalThis.toastr?.success?.(`Portrait attached to ${liveNpc.name}.`);', 1)

src = replace_once(src,
    "    $(document).on('click.npcState', '.npc-state-inline-remove-portrait', function () {\n        const npc = currentNpcById(this.dataset.npcId);",
    "    $(document).on('click.npcState', '.npc-state-inline-remove-portrait', function () {\n        if (!requireReadyChatMutation('remove a portrait')) return;\n        const npc = currentNpcById(this.dataset.npcId);",
    'portrait remove guard')

src = replace_once(src,
    "    if (events.CHAT_CHANGED) {\n        source.on(events.CHAT_CHANGED, async () => {\n            const key = getChatKey();",
    "    if (events.CHAT_CHANGED) {\n        source.on(events.CHAT_CHANGED, async () => {\n            closePortraitGenerator();\n            closeNpcViewer();\n            closeNpcEditor();\n            const key = getChatKey();",
    'close chat-bound UI on chat change')

src = replace_once(src,
    "        } catch (error) { console.error('[NPC State] post-load hydration/render failed; durable data was not overwritten.', error); }",
    "        } catch (error) {\n            if (getChatKey() === key) { renderDossier(); updateInjection(); }\n            console.error('[NPC State] post-load hydration/render failed; durable data was not overwritten.', error);\n        }",
    'CHAT_LOADED error render')

src = replace_once(src,
    "        inlineEntries: getChatState().inlineCards?.length || 0,",
    "        inlineEntries: chatHydrationStatus(getChatKey()) === 'ready' ? (getChatState().inlineCards?.length || 0) : 0,",
    'debug fallback guard')

INDEX.write_text(src)

core_src = CORE.read_text()
core_src = replace_once(core_src,
    "export const NPC_STATE_VERSION = '0.2.13';",
    "export const NPC_STATE_VERSION = '0.2.14';",
    'core version')
CORE.write_text(core_src)

manifest = json.loads(MANIFEST.read_text())
manifest['version'] = '0.2.14'
manifest['author'] = 'kohz87'
MANIFEST.write_text(json.dumps(manifest, indent=4) + '\n')

for path in [PACKAGE_TEST, RUNTIME_SMOKE]:
    text = path.read_text()
    text = text.replace("0.2.13", "0.2.14")
    path.write_text(text)

changelog = CHANGELOG.read_text()
if '## v0.2.14' not in changelog:
    entry = '''## v0.2.14\n\n### Data-safety and runtime-affinity hardening\n\n- Made successful hydration the only authority transition for sidecar-backed chat state; unhydrated fallback state is read-only.\n- Added explicit load-error UI and Retry Load while blocking dossier mutations until hydration succeeds.\n- Made chat rename transactional by writing and verifying the new-key sidecar before switching ownership.\n- Drains coalesced automatic scans when a genuinely hung scan operation times out.\n- Persisted bounded backfill retry metadata with cooldown and a three-attempt automatic cap.\n- Bound editor and portrait workflows to their origin chat and rejected stale asynchronous portrait completion.\n- Added permanent GitHub Actions CI and dedicated v0.2.14 hardening assertions.\n\n'''
    changelog = changelog.replace('# NPC State Changelog\n\n', '# NPC State Changelog\n\n' + entry, 1)
    CHANGELOG.write_text(changelog)

HARDENING_TEST.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('successful hydration is the only default authority transition', () => {
    assert.match(index, /function setChatState\(key, state, \{ markLoaded = false \} = \{\}\)/);
    assert.match(index, /setChatState\(key, sourceState, \{ markLoaded: true \}\)/);
    assert.match(index, /requireReadyChatMutation\('save chat dossier changes'/);
    assert.match(index, /refused to queue an unhydrated state write/);
});

test('hydration errors render an explicit read-only retry surface', () => {
    assert.match(index, /Dossier load failed/);
    assert.match(index, /Retry Load/);
    assert.match(index, /npc-state-retry-hydration/);
    assert.match(index, /Existing sidecar data is preserved and all dossier writes are locked/);
});

test('rename verifies new storage before switching ownership', () => {
    const fn = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function flushCurrentChatOnPageHide'));
    const write = fn.indexOf('writeNpcStateDataFile');
    const verify = fn.indexOf('readNpcStateDataFile(newPointer');
    const switchPointer = fn.indexOf('settings.dataFiles[newKey] = newPointer');
    assert.ok(write >= 0 && verify > write && switchPointer > verify);
    assert.match(fn, /original mapping was preserved/);
    assert.match(fn, /makeNpcStateDataFileName\(newKey\)/);
});

test('scan timeout drains coalesced automatic work', () => {
    const block = index.slice(index.indexOf('onExpire: operation =>'), index.indexOf('function isScanBusy'));
    assert.match(block, /pendingAutoScans\.has\(operation\.key\)/);
    assert.match(block, /drainPendingAutoScan\(operation\.key\)/);
});

test('automatic backfill retries are durable cooled down and bounded', () => {
    assert.match(index, /BACKFILL_MAX_ATTEMPTS = 3/);
    assert.match(index, /BACKFILL_RETRY_COOLDOWN_MS = 60 \* 1000/);
    assert.match(index, /attempts: Math\.max\(0, Math\.min\(BACKFILL_MAX_ATTEMPTS/);
    assert.match(index, /lastAttemptAt: Math\.max\(0/);
    assert.match(index, /stopped automatic backfill retries/);
});

test('editor and portrait workflows are chat-affine', () => {
    assert.match(index, /let activeEditorChatKey = ''/);
    assert.match(index, /let activePortraitGeneratorChatKey = ''/);
    assert.match(index, /activeEditorChatKey = originChatKey/);
    assert.match(index, /activePortraitGeneratorChatKey = originChatKey/);
    assert.match(index, /originRevision = Number\(stateVersions\.get\(originChatKey\)/);
    assert.match(index, /closePortraitGenerator\(\);\n\s*closeNpcViewer\(\);\n\s*closeNpcEditor\(\);/);
});

test('release metadata is v0.2.14', () => {
    assert.match(core, /NPC_STATE_VERSION = '0\.2\.14'/);
    assert.equal(manifest.version, '0.2.14');
    assert.equal(manifest.author, 'kohz87');
});
''')

print('v0.2.14 hardening patch applied')
