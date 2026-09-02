from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / 'index.js'
BRANCH = ROOT / 'branch.js'
TEST = ROOT / 'tests' / 'v0215-hardening.test.js'


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


def replace_function(text, name, next_name, replacement):
    start = text.find(name)
    if start < 0:
        if replacement.strip() in text:
            return text
        raise SystemExit(f'missing function start: {name}')
    end = text.find(next_name, start)
    if end < 0:
        raise SystemExit(f'missing function boundary after: {name}')
    return text[:start] + replacement.rstrip() + '\n\n' + text[end:]


src = INDEX.read_text()

# Persistence is allowed to be explicitly chat-bound instead of implicitly using whatever
# chat happens to be active when an async operation finishes.
src = replace_once(src,
"function persist() {\n    const key = getChatKey();\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) {\n        console.warn(`[NPC State] refused to persist unhydrated chat state for ${key}.`);\n        return false;\n    }\n    persistSettings();\n    queueStateFileWrite(key);\n    return true;\n}",
"function persist(key = getChatKey()) {\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) {\n        console.warn(`[NPC State] refused to persist unhydrated chat state for ${key}.`);\n        return false;\n    }\n    persistSettings();\n    queueStateFileWrite(key);\n    return true;\n}",
'chat-bound persist')

# Character-only fallback keys may exist transiently while SillyTavern switches chats. They are
# useful for diagnostics but must never become durable ownership namespaces.
src = replace_once(src,
"function requireReadyChatMutation(action = 'modify NPC State', key = getChatKey(), { notify = true } = {}) {\n    if (!key || key === 'no-chat') {",
"function requireReadyChatMutation(action = 'modify NPC State', key = getChatKey(), { notify = true } = {}) {\n    if (!key || key === 'no-chat' || key.startsWith('character:')) {",
'character fallback mutation lock')

src = replace_once(src,
"function queueStateFileWrite(key = getChatKey(), delay = STATE_WRITE_DELAY) {\n    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return;",
"function queueStateFileWrite(key = getChatKey(), delay = STATE_WRITE_DELAY) {\n    if (!key || key === 'no-chat' || key.startsWith('character:') || !chatStateCache.has(key)) return;",
'character fallback write lock')

# Recover deterministic first-save files when the settings pointer was lost before the debounced
# settings save completed. A 404 simply means this is genuinely a fresh chat.
src = replace_once(src,
"        const settings = getSettings();\n        const pointer = settings.dataFiles?.[key] || null;\n        let loaded = null;\n        if (pointer?.path) {",
"        const settings = getSettings();\n        let pointer = settings.dataFiles?.[key] || null;\n        if (!pointer?.path && (key.startsWith('chat:') || key.startsWith('group:'))) {\n            const recoveryName = makeNpcStateDataFileName(key);\n            const recoveryPointer = { name: recoveryName, path: `/user/files/${recoveryName}` };\n            try {\n                const recovered = await readNpcStateDataFile(recoveryPointer, { expectedChatKey: key });\n                if (recovered?.state) {\n                    pointer = recoveryPointer;\n                    settings.dataFiles[key] = recoveryPointer;\n                    persistSettings();\n                    console.info(`[NPC State] recovered deterministic sidecar pointer for ${key}.`);\n                }\n            } catch (error) {\n                if (!/404|not found/i.test(String(error?.message || error))) console.debug(`[NPC State] deterministic sidecar recovery skipped for ${key}.`, error);\n            }\n        }\n        let loaded = null;\n        if (pointer?.path) {",
'deterministic sidecar recovery')

# readNpcStateDataFile returns null for 404, so the deterministic probe above needs no throw. Add a
# direct payload handoff to avoid fetching the same file twice when recovery succeeds.
src = replace_once(src,
"        let pointer = settings.dataFiles?.[key] || null;\n        if (!pointer?.path && (key.startsWith('chat:') || key.startsWith('group:'))) {",
"        let pointer = settings.dataFiles?.[key] || null;\n        let recoveredState = null;\n        if (!pointer?.path && (key.startsWith('chat:') || key.startsWith('group:'))) {",
'recovery state holder')
src = replace_once(src,
"                if (recovered?.state) {\n                    pointer = recoveryPointer;",
"                if (recovered?.state) {\n                    recoveredState = recovered.state;\n                    pointer = recoveryPointer;",
'recovery state capture')
src = replace_once(src,
"        let loaded = null;\n        if (pointer?.path) {",
"        let loaded = recoveredState;\n        if (pointer?.path && !loaded) {",
'recovery state reuse')

# Cross-chat inheritance must have a real conversational prefix, not a shared stock greeting.
# bestAncestorState remains usable for actual duplicated/branched chats with at least one user turn.
branch = BRANCH.read_text()
branch = replace_once(branch,
"        const prefixLength = commonPrefixLength(state.lineage, lineage);\n        if (prefixLength < 1) continue;",
"        const prefixLength = commonPrefixLength(state.lineage, lineage);\n        if (prefixLength < 2) continue;\n        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);\n        if (!sharedPrefix.some(message => message?.is_user)) continue;",
'branch ancestor provenance threshold')
BRANCH.write_text(branch)

# Every queued scan is bound to the exact branch/message content it was requested for.
queue_fn = r'''function queuePendingAutoScan(chatKey, messageId, reason = 'automatic') {
    if (!chatKey || chatKey === 'no-chat' || !Number.isInteger(messageId) || messageId < 0) return false;
    const chat = getContext().chat || [];
    const message = chat[messageId];
    if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) return false;
    const lineage = chatLineage(chat);
    const queued = {
        chatKey,
        messageId,
        reason,
        queuedAt: Date.now(),
        fingerprint: fingerprintMessage(message),
        lineageKey: lineageCheckpointKey(lineage, messageId),
    };
    const previous = pendingAutoScans.get(chatKey);
    if (!previous || messageId >= previous.messageId) pendingAutoScans.set(chatKey, queued);
    return true;
}'''
src = replace_function(src, 'function queuePendingAutoScan(', 'async function drainPendingAutoScan(', queue_fn)

drain_fn = r'''async function drainPendingAutoScan(chatKey) {
    if (!chatKey || getChatKey() !== chatKey || isScanBusy(chatKey) || isHostSwipeActive()) return false;
    const pending = pendingAutoScans.get(chatKey);
    if (!pending) return false;
    const chat = getContext().chat || [];
    const message = chat[pending.messageId];
    const lineage = chatLineage(chat);
    const currentFingerprint = message ? fingerprintMessage(message) : '';
    const currentLineageKey = lineageCheckpointKey(lineage, pending.messageId);
    if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()
        || pending.fingerprint !== currentFingerprint
        || pending.lineageKey !== currentLineageKey) {
        pendingAutoScans.delete(chatKey);
        return false;
    }
    pendingAutoScans.delete(chatKey);
    await scanNow({ manual: false, messageId: pending.messageId });
    return true;
}'''
src = replace_function(src, 'async function drainPendingAutoScan(', 'function queueBranchRescan(', drain_fn)

# Branch reconciliation revalidates the originating chat after every await and persists explicitly
# to that key. This closes the remaining A->B rapid-switch race.
reconcile_fn = r'''async function reconcileCurrentBranch({ explicitDivergence = null, rescan = true, processOocMessageId = null, reason = 'branch', chatKey = null } = {}) {
    const key = chatKey || getChatKey();
    if (key === 'no-chat' || getChatKey() !== key) return null;
    const ctx = getContext();
    await ensureChatStateLoaded(key);
    if (getChatKey() !== key) return null;
    const before = getChatState(key);
    seedBranchTracking(before);
    const lineageBefore = chatLineage(ctx.chat || []);
    const result = reconcileBranchState(before, ctx.chat || [], { explicitDivergence });
    if (getChatKey() !== key || firstLineageDivergence(lineageBefore, chatLineage(getContext().chat || [])) !== -1) return null;
    if (!result.invalidated) {
        before.lineage = result.state.lineage;
        return result;
    }

    setChatState(key, result.state);
    persist(key);
    renderDossier();
    updateInjection();

    if (Number.isInteger(processOocMessageId) && (ctx.chat || [])[processOocMessageId]?.is_user) {
        if (getChatKey() !== key) return result;
        processOocCommands(processOocMessageId);
    }

    const targetAssistant = findLatestAssistantAtOrAfter(result.divergence);
    if (rescan && !result.exactRestored && getSettings().branchRescan !== false && targetAssistant >= 0) {
        if (getChatKey() !== key) return result;
        if (isScanBusy(key)) queueBranchRescan(targetAssistant, 0, key);
        else await scanNow({ manual: false, messageId: targetAssistant });
    }
    return result;
}'''
src = replace_function(src, 'async function reconcileCurrentBranch(', 'function queuePendingAutoScan(', reconcile_fn)

# Never merge global delayed branch work across chat keys. The UI only has one active chat, so
# replacing stale pending work is safer than letting options bleed across chats.
src = replace_once(src,
"    let next = { ...options };\n    if (branchReconcilePending) next = mergeBranchOptions(branchReconcilePending, next);",
"    let next = { ...options };\n    if (branchReconcilePending?.chatKey && branchReconcilePending.chatKey !== originKey) {\n        if (branchReconcileTimer) clearTimeout(branchReconcileTimer);\n        branchReconcileTimer = null;\n        branchReconcilePending = null;\n    }\n    if (branchReconcilePending) next = mergeBranchOptions(branchReconcilePending, next);",
'cross-chat branch queue isolation')

# Swipe settlement captures its chat. If the user moves away while SillyTavern is still generating,
# the old settlement is discarded instead of acting on the new chat.
src = replace_once(src,
"function queueSettledSwipeReconcile(options = {}) {\n    let next = { reason: 'message-swiped', rescan: true, ...options };",
"function queueSettledSwipeReconcile(options = {}) {\n    const originKey = options.chatKey || getChatKey();\n    if (originKey === 'no-chat') return;\n    let next = { reason: 'message-swiped', rescan: true, ...options, chatKey: originKey };",
'swipe origin key')
src = replace_once(src,
"        if (sequence !== swipeSettlementSequence) return;\n        if (isHostSwipeActive()) {",
"        if (sequence !== swipeSettlementSequence) return;\n        if (getChatKey() !== originKey) {\n            swipeSettlementTimer = null;\n            swipeSettlementPending = null;\n            deferredSwipeMessageId = null;\n            return;\n        }\n        if (isHostSwipeActive()) {",
'swipe chat switch cancellation')

# maybeInheritKnownBranch itself is also chat-affine across both awaits.
inherit_fn = r'''async function maybeInheritKnownBranch() {
    const key = getChatKey();
    if (key === 'no-chat') return false;
    await ensureChatStateLoaded(key);
    if (getChatKey() !== key) return false;
    const current = getChatState(key);
    const chat = getContext().chat || [];
    const lineageAtStart = chatLineage(chat);
    const isEmptyState = !current.npcs.length && !current.candidates.length && !current.dismissed.length && !current.checkpoints.length && !current.lineage.length;
    if (!isEmptyState || chat.length < 2 || !chat.some(message => message?.is_user)) return false;
    await ensureKnownChatStatesLoaded();
    if (getChatKey() !== key || firstLineageDivergence(lineageAtStart, chatLineage(getContext().chat || [])) !== -1) return false;
    const inherited = bestAncestorState(Object.fromEntries(chatStateCache.entries()), key, chat);
    if (!inherited) return false;
    setChatState(key, { ...freshChatState(), ...inherited });
    queueStateFileWrite(key, 0);
    return true;
}'''
src = replace_function(src, 'async function maybeInheritKnownBranch()', 'async function reconcileCurrentBranch(', inherit_fn)

# Rename keeps the predecessor sidecar as a recovery copy. The deterministic new-key filename makes
# the renamed chat recoverable even if the settings pointer update was interrupted.
src = replace_once(src,
"        // Phase 3: old storage becomes cleanup only; failure here cannot invalidate the rename.\n        if (oldPointer?.path && oldPointer.path !== newPointer.path) {\n            try { await deleteNpcStateDataFile(oldPointer, { headers: requestHeaders() }); }\n            catch (error) { console.warn(`[NPC State] renamed state is safe, but the old sidecar could not be deleted for ${oldKey}.`, error); }\n        }\n        return Boolean(installed);",
"        // Phase 3 intentionally retains the predecessor sidecar as a recovery copy. The new-key\n        // deterministic file can recover a lost debounced settings pointer, while the old file is\n        // harmless because no active chat mapping points to it.\n        return Boolean(installed);",
'rename predecessor retention')

# Startup must mount controls/events even when the sidecar cannot currently hydrate. This makes the
# Retry Load read-only recovery surface available instead of making the extension appear absent.
init_fn = r'''async function init() {
    if (initialized) {
        scheduleSettingsMountRetries();
        return;
    }
    initialized = true;
    getSettings();
    bindUi();
    installUiCaptureBridge();
    registerEvents();
    startInlineWatchdog();
    globalThis.addEventListener?.('pagehide', flushCurrentChatOnPageHide);
    globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document?.visibilityState === 'hidden') flushCurrentChatOnPageHide(); });
    scheduleSettingsMountRetries();

    const key = getChatKey();
    try {
        await migrateLegacyChatStates();
        if (getChatKey() !== key) return;
        if (key !== 'no-chat') {
            await ensureChatStateLoaded(key);
            if (getChatKey() !== key) return;
            await maybeInheritKnownBranch();
            if (getChatKey() !== key) return;
            seedBranchTracking(getChatState(key));
        }
    } catch (error) {
        console.error('[NPC State] startup hydration failed; extension remains mounted in read-only recovery mode.', error);
        if (getChatKey() === key) renderDossier();
    }
    updateInjection();
    console.log(`[NPC State] v${NPC_STATE_VERSION} loaded`);
}'''
src = replace_function(src, 'async function init() {', 'async function safeInit()', init_fn)

# On chat switch, cancel any global deferred branch/swipe work from the previous active chat before
# starting hydration for the new one.
src = replace_once(src,
"        source.on(events.CHAT_CHANGED, async () => {\n            closePortraitGenerator();",
"        source.on(events.CHAT_CHANGED, async () => {\n            if (branchReconcileTimer) clearTimeout(branchReconcileTimer);\n            branchReconcileTimer = null;\n            branchReconcilePending = null;\n            if (swipeSettlementTimer) clearTimeout(swipeSettlementTimer);\n            swipeSettlementTimer = null;\n            swipeSettlementPending = null;\n            deferredSwipeMessageId = null;\n            swipeSettlementSequence += 1;\n            closePortraitGenerator();",
'chat-change deferred-work cancellation')

INDEX.write_text(src)

TEST.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    bestAncestorState,
    chatLineage,
    recordBranchCheckpoint,
} from '../branch.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function msg(text, isUser = false) {
    return { mes: text, is_user: isUser, is_system: false, name: isUser ? 'User' : 'Character' };
}

function ancestorState(chat) {
    const state = { npcs: [{ id: 'npc_a', name: 'A' }], candidates: [], pendingBackfills: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [], turn: 1, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null, scanCount: 0, processedOocMessageId: null, checkpoints: [], lineage: [], inlineCards: [] };
    recordBranchCheckpoint(state, chat, chat.length - 1, 'test');
    return state;
}

test('same stock greeting alone never proves cross-chat ancestry', () => {
    const oldChat = [msg('Welcome, traveler.')];
    const current = [msg('Welcome, traveler.')];
    const inherited = bestAncestorState({ 'chat:old': ancestorState(oldChat) }, 'chat:new', current);
    assert.equal(inherited, null);
});

test('shared greeting plus user-authored history can prove branch ancestry', () => {
    const oldChat = [msg('Welcome, traveler.'), msg('I enter the gate.', true), msg('The guard nods.')];
    const current = [msg('Welcome, traveler.'), msg('I enter the gate.', true), msg('The guard smiles instead.')];
    const state = ancestorState(oldChat.slice(0, 2));
    state.lineage = chatLineage(oldChat);
    const inherited = bestAncestorState({ 'chat:old': state }, 'chat:new', current);
    assert.ok(inherited);
});

test('persistence and branch async work are explicitly chat-bound', () => {
    assert.match(index, /function persist\(key = getChatKey\(\)\)/);
    assert.match(index, /persist\(key\);/);
    assert.match(index, /if \(getChatKey\(\) !== key\) return null;/);
    assert.match(index, /firstLineageDivergence\(lineageBefore/);
});

test('queued scans carry branch identity and validate before drain', () => {
    assert.match(index, /fingerprint: fingerprintMessage\(message\)/);
    assert.match(index, /lineageKey: lineageCheckpointKey\(lineage, messageId\)/);
    assert.match(index, /pending\.fingerprint !== currentFingerprint/);
    assert.match(index, /pending\.lineageKey !== currentLineageKey/);
});

test('startup mounts recovery UI machinery before hydration', () => {
    const fn = index.slice(index.indexOf('async function init()'), index.indexOf('async function safeInit()'));
    assert.ok(fn.indexOf('bindUi();') < fn.indexOf('await migrateLegacyChatStates();'));
    assert.ok(fn.indexOf('registerEvents();') < fn.indexOf('await migrateLegacyChatStates();'));
    assert.match(fn, /read-only recovery mode/);
});

test('character fallback cannot become a durable mutation namespace', () => {
    assert.match(index, /key\.startsWith\('character:'\)/);
    assert.match(index, /key === 'no-chat' \|\| key\.startsWith\('character:'\) \|\| !chatStateCache/);
});

test('rename retains predecessor recovery copy and deterministic recovery probe exists', () => {
    const rename = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function flushCurrentChatOnPageHide'));
    assert.doesNotMatch(rename, /deleteNpcStateDataFile\(oldPointer/);
    assert.match(rename, /retains the predecessor sidecar as a recovery copy/);
    assert.match(index, /recovered deterministic sidecar pointer/);
    assert.match(index, /`\/user\/files\/\$\{recoveryName\}`/);
});

test('chat changes cancel global delayed branch and swipe work', () => {
    const block = index.slice(index.indexOf('source.on(events.CHAT_CHANGED'), index.indexOf('if (events.CHAT_DELETED)'));
    assert.match(block, /branchReconcilePending = null/);
    assert.match(block, /swipeSettlementPending = null/);
    assert.match(block, /swipeSettlementSequence \+= 1/);
});
''')

print('v0.2.15 hardening patch applied/idempotent')
