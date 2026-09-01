from pathlib import Path
p=Path('index.js'); s=p.read_text()
def rep(a,b):
    global s
    if a not in s: raise SystemExit('missing anchor: '+a[:90])
    s=s.replace(a,b,1)
rep('/* NPC State v0.2.12 - standalone SillyTavern extension */','/* NPC State v0.2.13 - standalone SillyTavern extension */')
rep("const hydrationErrors = new Map();\nconst stateWriteTimers", "const hydrationErrors = new Map();\nconst pendingAutoScans = new Map();\nconst stateWriteTimers")
rep("function updateInjection() {\n    const settings = getSettings();\n    const ctx = getContext();", "function updateInjection() {\n    const settings = getSettings();\n    const ctx = getContext();\n    const injectionKey = getChatKey();\n    if (injectionKey !== 'no-chat' && chatHydrationStatus(injectionKey) !== 'ready') {\n        ctx.setExtensionPrompt?.(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);\n        return;\n    }")
rep("    if (chatKey === 'no-chat') return false;\n    const desired = inlineEntriesForRender(getChatState(chatKey))", "    if (chatKey === 'no-chat' || chatHydrationStatus(chatKey) !== 'ready') return false;\n    const desired = inlineEntriesForRender(getChatState(chatKey))")
rep("    if (chatKey === 'no-chat') return { rendered: 0, missing: 0 };\n    ensureInlineObserver();", "    if (chatKey === 'no-chat' || chatHydrationStatus(chatKey) !== 'ready') return { rendered: 0, missing: 0 };\n    ensureInlineObserver();")
old='''function queueBranchRescan(messageId, attempt = 0, originKey = getChatKey()) {
    if (!Number.isInteger(messageId) || messageId < 0 || originKey === 'no-chat') return;
    setTimeout(async () => {
        if (getChatKey() !== originKey) return;
        if (isHostSwipeActive()) {
            queueSettledSwipeReconcile({ explicitDivergence: messageId, rescan: true, reason: 'branch-rescan-during-swipe' });
            return;
        }
        if (isScanBusy(getChatKey())) {
            if (attempt < 250) queueBranchRescan(messageId, attempt + 1, originKey);
            return;
        }
        const message = (getContext().chat || [])[messageId];
        if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) return;
        await scanNow({ manual: false, messageId });
    }, 120);
}
'''
new='''function queuePendingAutoScan(chatKey, messageId, reason = 'automatic') {
    if (!chatKey || chatKey === 'no-chat' || !Number.isInteger(messageId) || messageId < 0) return false;
    const previous = pendingAutoScans.get(chatKey);
    if (!previous || messageId >= previous.messageId) pendingAutoScans.set(chatKey, { chatKey, messageId, reason, queuedAt: Date.now() });
    return true;
}

async function drainPendingAutoScan(chatKey) {
    if (!chatKey || getChatKey() !== chatKey || isScanBusy(chatKey) || isHostSwipeActive()) return false;
    const pending = pendingAutoScans.get(chatKey);
    if (!pending) return false;
    const message = (getContext().chat || [])[pending.messageId];
    if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) {
        pendingAutoScans.delete(chatKey);
        return false;
    }
    pendingAutoScans.delete(chatKey);
    await scanNow({ manual: false, messageId: pending.messageId });
    return true;
}

function queueBranchRescan(messageId, _attempt = 0, originKey = getChatKey()) {
    if (!queuePendingAutoScan(originKey, messageId, 'branch-rescan')) return;
    if (getChatKey() === originKey && !isScanBusy(originKey) && !isHostSwipeActive()) void drainPendingAutoScan(originKey);
}
'''
rep(old,new)
rep("    if (isScanBusy(scanChatKey)) {\n        if (manual) globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');\n        return;\n    }", "    if (isScanBusy(scanChatKey)) {\n        if (manual) globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');\n        else if (Number.isInteger(messageId)) queuePendingAutoScan(scanChatKey, messageId, 'busy-auto-scan');\n        return;\n    }")
rep("        endScanOperation(scanChatKey, operation);\n        if (getChatKey() === scanChatKey) setScanIndicator(isScanBusy(scanChatKey));\n        updateInjection();\n    }\n}\n\nfunction setScanIndicator", "        endScanOperation(scanChatKey, operation);\n        if (getChatKey() === scanChatKey) setScanIndicator(isScanBusy(scanChatKey));\n        updateInjection();\n        if (getChatKey() === scanChatKey) void drainPendingAutoScan(scanChatKey);\n    }\n}\n\nfunction setScanIndicator")
rep("    stateWritePromises.delete(key);\n    if (removed) persistSettings();", "    stateWritePromises.delete(key);\n    hydrationErrors.delete(key);\n    pendingAutoScans.delete(key);\n    if (removed) persistSettings();")
oldchat='''        source.on(events.CHAT_CHANGED, async () => {
            const key = getChatKey();
            if (key !== 'no-chat') await ensureChatStateLoaded(key);
            const inherited = await maybeInheritKnownBranch();
            const state = key === 'no-chat' ? null : getChatState(key);
            if (state) seedBranchTracking(state);
            if (inherited) persist();
            setScanIndicator(key !== 'no-chat' && isScanBusy(key));
            renderDossier();
            ensureInlineObserver();
            queueInlineRender(30);
            updateInjection();
            if (!inherited && state?.lineage?.length) queueBranchReconcile({ rescan: false, reason: 'chat-changed' }, 80);
        });
'''
newchat='''        source.on(events.CHAT_CHANGED, async () => {
            const key = getChatKey();
            try {
                if (key !== 'no-chat') await ensureChatStateLoaded(key);
                if (getChatKey() !== key) return;
                const inherited = await maybeInheritKnownBranch();
                if (getChatKey() !== key) return;
                const state = key === 'no-chat' ? null : getChatState(key);
                if (state) seedBranchTracking(state);
                if (inherited) persist();
                setScanIndicator(key !== 'no-chat' && isScanBusy(key));
                renderDossier();
                ensureInlineObserver();
                queueInlineRender(30);
                updateInjection();
                if (!inherited && state?.lineage?.length) queueBranchReconcile({ chatKey: key, rescan: false, reason: 'chat-changed' }, 80);
                if (key !== 'no-chat') void drainPendingAutoScan(key);
            } catch (error) {
                if (getChatKey() === key) { renderDossier(); updateInjection(); }
                console.error('[NPC State] chat change hydration failed; durable state was preserved.', error);
            }
        });
'''
rep(oldchat,newchat)
rep("    const key = getChatKey();\n    await migrateLegacyChatStates();\n    if (key !== 'no-chat') {\n        await ensureChatStateLoaded(key);\n        await maybeInheritKnownBranch();\n        seedBranchTracking(getChatState(key));\n    }", "    await migrateLegacyChatStates();\n    const key = getChatKey();\n    if (key !== 'no-chat') {\n        await ensureChatStateLoaded(key);\n        if (getChatKey() === key) {\n            await maybeInheritKnownBranch();\n            if (getChatKey() === key) seedBranchTracking(getChatState(key));\n        }\n    }")
p.write_text(s)
t=Path('tests/index-hardening.test.js')
t.write_text(t.read_text()+'''\n\ntest('deep hardening gates rendering and injection on hydration readiness',()=>{\n  assert.match(source,/chatHydrationStatus\\(chatKey\\) !== 'ready'/);\n  assert.match(source,/chatHydrationStatus\\(injectionKey\\) !== 'ready'/);\n});\n\ntest('busy automatic scans coalesce instead of being silently dropped',()=>{\n  assert.match(source,/const pendingAutoScans = new Map\\(\\)/);\n  assert.match(source,/queuePendingAutoScan\\(scanChatKey, messageId, 'busy-auto-scan'\\)/);\n  assert.match(source,/drainPendingAutoScan\\(scanChatKey\\)/);\n  assert.doesNotMatch(source,/attempt < 250/);\n});\n\ntest('chat change hydration is chat-affine and stale async completion is rejected',()=>{\n  assert.match(source,/if \\(getChatKey\\(\\) !== key\\) return;/);\n  assert.match(source,/queueBranchReconcile\\(\\{ chatKey: key,/);\n});\n''')
ci=Path('.github/workflows/ci.yml'); ci.parent.mkdir(parents=True,exist_ok=True)
ci.write_text('''name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm test\n''')
