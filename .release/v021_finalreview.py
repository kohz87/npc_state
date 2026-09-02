from pathlib import Path


def update(path, transform):
    p = Path(path)
    old = p.read_text(encoding='utf-8')
    new = transform(old)
    if new != old:
        p.write_text(new, encoding='utf-8')
        return True
    return False


def replace_idempotent(path, old, new):
    def transform(text):
        if new in text:
            return text
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{path}: expected one final-review match, found {count}: {old[:120]!r}')
        return text.replace(old, new, 1)
    return update(path, transform)


# ---------------------------------------------------------------------------
# index.js: protect every destination representation and make destructive host
# event instances unique so same-filename events cannot deduplicate each other.
# ---------------------------------------------------------------------------
replace_idempotent(
    'index.js',
    "const lifecycleEventOperations = new Map();\nconst lifecycleRetryTimers = new Map();",
    "const lifecycleEventOperations = new Map();\nconst lifecycleRetryTimers = new Map();\nlet lifecycleEventSequence = 0;",
)
replace_idempotent(
    'index.js',
    "    const destinationCache = chatStateCache.get(newKey) || null;\n    const destinationEphemeral = stateLooksEmptyForLifecycleRename(destinationState || destinationCache);",
    "    const destinationCache = chatStateCache.get(newKey) || null;\n    const destinationInline = settings.chats?.[newKey] || null;\n    const destinationRepresentations = [destinationState, destinationCache, destinationInline].filter(value => value && typeof value === 'object');\n    const destinationEphemeral = destinationRepresentations.every(stateLooksEmptyForLifecycleRename);",
)
old_listeners = '''    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, (chatId) => runBoundedLifecycleEvent(\n        `delete:chat:${String(chatId || '')}`,\n        'chat deletion retirement',\n        () => removeDeletedChatState(chatId, 'chat', ''),\n    ));\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, (chatId) => runBoundedLifecycleEvent(\n        `delete:group:${String(chatId || '')}`,\n        'group chat deletion retirement',\n        () => removeDeletedChatState(chatId, 'group', ''),\n    ));\n    if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, (eventData) => {\n        const data = eventData || {};\n        const owner = String(data.groupId || data.avatarId || '');\n        return runBoundedLifecycleEvent(\n            `rename:${owner}:${String(data.oldFileName || '')}->${String(data.newFileName || '')}`,\n            'chat rename migration',\n            () => moveRenamedChatState(data),\n        );\n    });'''
new_listeners = '''    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, (chatId) => {\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedLifecycleEvent(\n            `delete:chat:${String(chatId || '')}:${eventId}`,\n            'chat deletion retirement',\n            () => removeDeletedChatState(chatId, 'chat', ''),\n        );\n    });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, (chatId) => {\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedLifecycleEvent(\n            `delete:group:${String(chatId || '')}:${eventId}`,\n            'group chat deletion retirement',\n            () => removeDeletedChatState(chatId, 'group', ''),\n        );\n    });\n    if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, (eventData) => {\n        const data = eventData || {};\n        const owner = String(data.groupId || data.avatarId || '');\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedLifecycleEvent(\n            `rename:${owner}:${String(data.oldFileName || '')}->${String(data.newFileName || '')}:${eventId}`,\n            'chat rename migration',\n            () => moveRenamedChatState(data),\n        );\n    });'''
replace_idempotent('index.js', old_listeners, new_listeners)

# ---------------------------------------------------------------------------
# storage.js: stronger cross-tab recovery token and a same-origin lease fallback
# when navigator.locks is unavailable. Lock acquisition failure is retryable.
# ---------------------------------------------------------------------------
replace_idempotent(
    'storage.js',
    "const READ_CONCURRENCY_LIMIT = 4;\nlet activeReads = 0;",
    "const READ_CONCURRENCY_LIMIT = 4;\nconst CROSS_TAB_LOCK_LEASE_MS = 15_000;\nconst CROSS_TAB_LOCK_ACQUIRE_MS = 5_000;\nlet activeReads = 0;",
)
old_writer_lock = '''async function withWriterLock(chatKey, task) {\n    const name = `npc-state-sidecar:${fnv1a(String(chatKey || ''))}`;\n    const locks = globalThis.navigator?.locks;\n    if (locks && typeof locks.request === 'function') {\n        return locks.request(name, { mode: 'exclusive' }, () => withInProcessWriterLock(chatKey, task));\n    }\n    return withInProcessWriterLock(chatKey, task);\n}\nconst writerId = (() => {\n    try { return globalThis.crypto?.randomUUID?.() || `npc-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }\n    catch { return `npc-state-${Date.now().toString(36)}`; }\n})();'''
new_writer_lock = '''const writerId = (() => {\n    try { return globalThis.crypto?.randomUUID?.() || `npc-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }\n    catch { return `npc-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }\n})();\n\nfunction localStorageLockRecord(storage, key) {\n    try {\n        const value = JSON.parse(String(storage.getItem(key) || 'null'));\n        if (!value || typeof value !== 'object') return null;\n        return { token: String(value.token || ''), expiresAt: Number(value.expiresAt || 0) };\n    } catch { return null; }\n}\n\nasync function withLocalStorageWriterLock(chatKey, task) {\n    const storage = globalThis.localStorage;\n    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {\n        return withInProcessWriterLock(chatKey, task);\n    }\n    const key = `npc-state-writer-lock:${fnv1a(String(chatKey || ''))}`;\n    const token = `${writerId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;\n    const deadline = Date.now() + CROSS_TAB_LOCK_ACQUIRE_MS;\n    while (Date.now() <= deadline) {\n        const now = Date.now();\n        const current = localStorageLockRecord(storage, key);\n        if (!current || !current.token || current.expiresAt <= now) {\n            try { storage.setItem(key, JSON.stringify({ token, expiresAt: now + CROSS_TAB_LOCK_LEASE_MS })); }\n            catch { return withInProcessWriterLock(chatKey, task); }\n            await wait(12 + Math.floor(Math.random() * 18));\n            const confirmed = localStorageLockRecord(storage, key);\n            if (confirmed?.token === token) {\n                const renew = globalThis.setInterval?.(() => {\n                    try {\n                        const owned = localStorageLockRecord(storage, key);\n                        if (owned?.token === token) storage.setItem(key, JSON.stringify({ token, expiresAt: Date.now() + CROSS_TAB_LOCK_LEASE_MS }));\n                    } catch { /* lease expiry remains the safety fallback */ }\n                }, Math.max(1000, Math.floor(CROSS_TAB_LOCK_LEASE_MS / 3)));\n                try { return await withInProcessWriterLock(chatKey, task); }\n                finally {\n                    if (renew) globalThis.clearInterval?.(renew);\n                    try { if (localStorageLockRecord(storage, key)?.token === token) storage.removeItem(key); } catch { /* lease expires */ }\n                }\n            }\n        }\n        await wait(18 + Math.floor(Math.random() * 24));\n    }\n    const error = new Error(`NPC State could not acquire the cross-tab sidecar lock for ${chatKey}.`);\n    error.code = 'NPC_STATE_LOCK_TIMEOUT';\n    throw error;\n}\n\nasync function withWriterLock(chatKey, task) {\n    const name = `npc-state-sidecar:${fnv1a(String(chatKey || ''))}`;\n    const locks = globalThis.navigator?.locks;\n    if (locks && typeof locks.request === 'function') {\n        return locks.request(name, { mode: 'exclusive' }, () => withInProcessWriterLock(chatKey, task));\n    }\n    return withLocalStorageWriterLock(chatKey, task);\n}'''
replace_idempotent('storage.js', old_writer_lock, new_writer_lock)
replace_idempotent(
    'storage.js',
    "    const writerToken = fnv1a(String(writerId || 'writer'));",
    "    const writerText = String(writerId || 'writer');\n    const writerToken = `${fnv1a(writerText)}${fnv1a([...writerText].reverse().join(''))}`;",
)
replace_idempotent(
    'storage.js',
    "    if (error?.code === 'NPC_STATE_WRITE_CONFLICT') return false;",
    "    if (error?.code === 'NPC_STATE_WRITE_CONFLICT') return false;\n    if (error?.code === 'NPC_STATE_LOCK_TIMEOUT') return true;",
)

# ---------------------------------------------------------------------------
# hardening.js: unique historical event instances, active-cache refresh even on
# partial owner rename, and transactional legacy migration cleanup/retry.
# ---------------------------------------------------------------------------
replace_idempotent(
    'hardening.js',
    "let historicalRenamePair = '';",
    "let historicalRenamePair = '';\nlet lifecycleEventSequence = 0;",
)
old_legacy = '''    const migrated = migrateLegacyBranchState(rawState, ctx.chat || []);\n    const newPointer = await writeVerifiedState(identity.key, migrated);\n    const recoveryPointer = await writeRecovery(oldKey, migrated, `qualified-namespace-migrated:${identity.key}`);\n    try {\n        if (oldPointer?.path) await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `qualified-namespace-migrated:${identity.key}`, appVersion: NPC_STATE_VERSION, headers: headers() });\n    } catch (error) {\n        try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); } catch { /* best effort */ }\n        console.warn(`[NPC State] v0.2.21 refused legacy ownership migration for ${oldKey}; the source changed during the transaction.`, error);\n        return false;\n    }'''
new_legacy = '''    const migrated = migrateLegacyBranchState(rawState, ctx.chat || []);\n    let newPointer = null;\n    let recoveryPointer = null;\n    try {\n        newPointer = await writeVerifiedState(identity.key, migrated);\n        recoveryPointer = await writeRecovery(oldKey, migrated, `qualified-namespace-migrated:${identity.key}`);\n        if (oldPointer?.path) await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `qualified-namespace-migrated:${identity.key}`, appVersion: NPC_STATE_VERSION, headers: headers() });\n    } catch (error) {\n        if (newPointer?.path) {\n            try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); }\n            catch { config.recoveryGarbage[`legacy-destination:${oldKey}:${Date.now()}`] = { ...newPointer, queuedAt: Date.now(), reason: 'legacy-destination-cleanup' }; }\n        }\n        if (recoveryPointer?.path) {\n            try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); }\n            catch { config.recoveryGarbage[`legacy-recovery:${oldKey}:${Date.now()}`] = { ...recoveryPointer, queuedAt: Date.now(), reason: 'legacy-recovery-cleanup' }; }\n        }\n        queueSettingsSave();\n        throw error;\n    }'''
replace_idempotent('hardening.js', old_legacy, new_legacy)
old_char_rename_listener = '''    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, (oldAvatar, newAvatar) => runBoundedHardeningEvent(\n        `character-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}`,\n        'character owner rename migration',\n        async () => {\n            resetHistoricalRenameIndex();\n            await migrateCharacterOwner(oldAvatar, newAvatar);\n            queueActiveCharacterCacheRefresh(newAvatar);\n        },\n    ));'''
new_char_rename_listener = '''    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedHardeningEvent(\n            `character-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${eventId}`,\n            'character owner rename migration',\n            async () => {\n                resetHistoricalRenameIndex();\n                try { await migrateCharacterOwner(oldAvatar, newAvatar); }\n                finally { queueActiveCharacterCacheRefresh(newAvatar); }\n            },\n        );\n    });'''
replace_idempotent('hardening.js', old_char_rename_listener, new_char_rename_listener)
old_hist_listener = '''    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, (messages, oldAvatar, newAvatar) => {\n        const signature = historicalChatSignature(messages) || `len:${Array.isArray(messages) ? messages.length : 0}`;\n        return runBoundedHardeningEvent(\n            `historical-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${signature}`,'''
new_hist_listener = '''    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, (messages, oldAvatar, newAvatar) => {\n        const signature = historicalChatSignature(messages) || `len:${Array.isArray(messages) ? messages.length : 0}`;\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedHardeningEvent(\n            `historical-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${signature}:${eventId}`,'''
replace_idempotent('hardening.js', old_hist_listener, new_hist_listener)
replace_idempotent(
    'hardening.js',
    "    if (events.CHARACTER_DELETED) on(events.CHARACTER_DELETED, data => {\n        const avatar = String(data?.character?.avatar || data?.avatar || '').trim();\n        if (!avatar) return undefined;\n        return runBoundedHardeningEvent(\n            `character-delete:${avatar}`,",
    "    if (events.CHARACTER_DELETED) on(events.CHARACTER_DELETED, data => {\n        const avatar = String(data?.character?.avatar || data?.avatar || '').trim();\n        if (!avatar) return undefined;\n        const eventId = ++lifecycleEventSequence;\n        return runBoundedHardeningEvent(\n            `character-delete:${avatar}:${eventId}` ,",
)

# ---------------------------------------------------------------------------
# Tests: behavioral/static guards for the final adversarial findings.
# ---------------------------------------------------------------------------
def add_tests(text):
    marker = "test('final review protects all rename destination representations and event instances are unique'"
    if marker in text:
        return text
    extra = r'''

test('final review protects all rename destination representations and event instances are unique', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(index, /destinationRepresentations = \[destinationState, destinationCache, destinationInline\]/);
    assert.match(index, /const eventId = \+\+lifecycleEventSequence/);
    assert.match(index, /delete:chat:\$\{String\(chatId \|\| ''\)\}:\$\{eventId\}/);
    assert.match(hardening, /historical-rename:[^\n]+\$\{eventId\}/);
    assert.match(hardening, /finally \{ queueActiveCharacterCacheRefresh\(newAvatar\); \}/);
});

test('final review cleans failed legacy staging and retries operational migration failures', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    const block = hardening.slice(hardening.indexOf('async function safeLegacyMigrationForCurrent'), hardening.indexOf('async function migrateCharacterOwner'));
    assert.match(block, /legacy-destination-cleanup/);
    assert.match(block, /legacy-recovery-cleanup/);
    assert.match(block, /throw error/);
});

test('storage has a cross-tab lease fallback when Web Locks are unavailable', () => {
    const storage = fs.readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
    assert.match(storage, /async function withLocalStorageWriterLock/);
    assert.match(storage, /npc-state-writer-lock:/);
    assert.match(storage, /CROSS_TAB_LOCK_LEASE_MS/);
    assert.match(storage, /NPC_STATE_LOCK_TIMEOUT/);
    assert.match(storage, /return withLocalStorageWriterLock\(chatKey, task\)/);
});
'''
    return text.rstrip() + extra + '\n'
update('tests/hardening-v0221.test.js', add_tests)

print('v0.2.21 final adversarial review patch applied')
