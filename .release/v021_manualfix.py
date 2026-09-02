from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one manual-fix match, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path, marker, block):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + block.rstrip() + '\n', encoding='utf-8')


# Schema release fixture.
replace_once('tests/migration-smoke.mjs', 'assert.equal(settings.schemaVersion, 26);', 'assert.equal(settings.schemaVersion, 27);')

# A historical old-owner tombstone must never tombstone a verified live renamed destination on retry.
replace_once(
    'hardening-core.js',
    '} else if (predecessorTombstone && !config.sidecarTombstones[newKey]) {',
    '} else if (predecessorTombstone && !config.dataFiles?.[newKey] && !config.sidecarTombstones[newKey]) {',
)

# Engine lifecycle cache flush must report failures so owner-wide hardening can fail closed
# without invalidating a dirty cache and retry later.
old_flush = '''async function flushLifecycleOwner(kind = 'chat', ownerId = '') {\n    const owner = String(ownerId || '').trim();\n    if (!owner) return [];\n    const keys = [...chatStateCache.keys()].filter(key => {\n        const parsed = parseQualifiedChatKey(key);\n        return parsed?.kind === kind && parsed.ownerId === owner;\n    });\n    for (const key of keys) {\n        try { await settleStateFileWrite(key, { flush: true }); }\n        catch (error) { console.warn(`[NPC State] lifecycle flush could not settle ${key}; durable conflict handling will decide ownership.`, error); }\n    }\n    return keys;\n}'''
new_flush = '''async function flushLifecycleOwner(kind = 'chat', ownerId = '') {\n    const owner = String(ownerId || '').trim();\n    if (!owner) return [];\n    const keys = [...chatStateCache.keys()].filter(key => {\n        const parsed = parseQualifiedChatKey(key);\n        return parsed?.kind === kind && parsed.ownerId === owner;\n    });\n    const failures = [];\n    for (const key of keys) {\n        try { await settleStateFileWrite(key, { flush: true }); }\n        catch (error) {\n            failures.push({ key, error });\n            console.warn(`[NPC State] lifecycle flush could not settle ${key}; owner lifecycle will fail closed and retry later.`, error);\n        }\n    }\n    if (failures.length) {\n        const error = new AggregateError(failures.map(item => item.error), `NPC State could not settle ${failures.length} owner chat(s) before lifecycle mutation.`);\n        error.code = 'NPC_STATE_OWNER_FLUSH_INCOMPLETE';\n        error.failures = failures.map(item => item.key);\n        throw error;\n    }\n    return keys;\n}'''
replace_once('index.js', old_flush, new_flush)

# Index legacy migration is part of CHAT_CHANGED/init. Keep its own persistence bounded too.
replace_once(
    'index.js',
    "const newPointer = await writeNpcStateDataFile({ chatKey: newKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateDataFileName(newKey) }, headers: requestHeaders() });",
    "const newPointer = await writeNpcStateDataFile({ chatKey: newKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateDataFileName(newKey) }, continuousRetry: false, headers: requestHeaders() });",
)
replace_once(
    'index.js',
    "const recoveryPointer = await writeNpcStateDataFile({ chatKey: oldKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateRecoveryFileName(oldKey) }, headers: requestHeaders() });",
    "const recoveryPointer = await writeNpcStateDataFile({ chatKey: oldKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateRecoveryFileName(oldKey) }, continuousRetry: false, headers: requestHeaders() });",
)

# Destructive transactional errors must reject the bounded event operation so they are retried;
# ambiguity/no-state paths still return false before entering these catches and remain no-ops.
replace_once(
    'index.js',
    "        console.warn(`[NPC State] refused destructive retirement for ${key}; live ownership remains intact.`, error);\n        return false;",
    "        console.warn(`[NPC State] refused destructive retirement for ${key}; live ownership remains intact.`, error);\n        throw error;",
)
replace_once(
    'index.js',
    "        console.warn(`[NPC State] transactional rename failed for ${oldKey}; original durable ownership remains recoverable and no tombstone was published.`, error);\n        return false;",
    "        console.warn(`[NPC State] transactional rename failed for ${oldKey}; original durable ownership remains recoverable and no tombstone was published.`, error);\n        throw error;",
)

# Any rejection, including one that happens after the 12s foreground timeout, schedules a retry.
replace_once(
    'index.js',
    '''        lifecycleEventOperations.set(key, operation);\n        operation.then(\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n        );''',
    '''        lifecycleEventOperations.set(key, operation);\n        void operation.catch(error => {\n            console.warn(`[NPC State] ${label} background transaction failed; scheduling retry.`, error);\n            scheduleLifecycleRetry(key, label, task);\n        });\n        operation.then(\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n        );''',
)
replace_once(
    'hardening.js',
    '''        lifecycleEventOperations.set(key, operation);\n        operation.then(\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n        );''',
    '''        lifecycleEventOperations.set(key, operation);\n        void operation.catch(error => {\n            console.warn(`[NPC State] ${label} background transaction failed; scheduling retry.`, error);\n            if (retryOnFailure) scheduleHardeningRetry(key, label, task);\n        });\n        operation.then(\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),\n        );''',
)

# Queue temporary recovery cleanup failures instead of leaking untracked files until manual cleanup.
helper_marker = 'function queueRecoveryGarbagePointer('
helper = '''function queueRecoveryGarbagePointer(pointer, reason = 'temporary-recovery-cleanup') {\n    if (!pointer?.path) return false;\n    const settings = getSettings();\n    const key = `${String(reason || 'recovery')}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;\n    settings.recoveryGarbage[key] = { ...structuredClone(pointer), queuedAt: Date.now(), reason: String(reason || 'recovery') };\n    persistSettings();\n    return true;\n}'''
text = Path('index.js').read_text(encoding='utf-8')
insert_at = text.find('function stateLooksEmptyForLifecycleRename(')
if helper_marker not in text:
    if insert_at < 0:
        raise SystemExit('index.js: could not insert recovery garbage helper')
    text = text[:insert_at] + helper + '\n\n' + text[insert_at:]
Path('index.js').write_text(text, encoding='utf-8')

# Replace all best-effort temporary recovery deletions in chat delete/rename lifecycle ranges.
text = Path('index.js').read_text(encoding='utf-8')
start = text.find('async function removeDeletedChatState(')
end = text.find('function legacyMigrationMatchesActiveChat', start)
if start < 0 or end < 0:
    raise SystemExit('index.js: lifecycle range missing for recovery cleanup hardening')
block = text[start:end]
block = block.replace(
    "try { await deleteNpcStateDataFile(recoveryPointer, { headers: requestHeaders() }); } catch { /* best effort */ }",
    "try { await deleteNpcStateDataFile(recoveryPointer, { headers: requestHeaders() }); } catch { queueRecoveryGarbagePointer(recoveryPointer, 'chat-lifecycle-temp'); }",
)
text = text[:start] + block + text[end:]
Path('index.js').write_text(text, encoding='utf-8')

# Owner-wide work proceeds only after a complete cache flush; if it fails, preserve caches for retry.
replace_once(
    'hardening.js',
    "    let changed = false;\n    try {\n        try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', oldOwner); }\n        catch (error) { console.debug('[NPC State] owner pre-rename cache flush was incomplete.', error); }",
    "    let changed = false;\n    let cachesSettled = false;\n    try {\n        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', oldOwner);\n        cachesSettled = true;",
)
replace_once(
    'hardening.js',
    "    } finally {\n        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);\n        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', newOwner);\n    }\n}\n\nasync function retireCharacterOwner",
    "    } finally {\n        if (cachesSettled) {\n            globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);\n            globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', newOwner);\n        }\n    }\n}\n\nasync function retireCharacterOwner",
)
replace_once(
    'hardening.js',
    "    const retiredPredecessors = [];\n    try {\n        try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner); }\n        catch (error) { console.debug('[NPC State] owner pre-delete cache flush was incomplete.', error); }\n        const keys = qualifiedKeysForOwner(config, 'chat', owner);",
    "    const retiredPredecessors = [];\n    let cachesSettled = false;\n    try {\n        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner);\n        cachesSettled = true;\n        const keys = qualifiedKeysForOwner(config, 'chat', owner).filter(key => config.dataFiles?.[key]?.path || config.chats?.[key]);",
)
replace_once(
    'hardening.js',
    "    } finally {\n        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);\n    }\n}\n\nasync function rebaseActiveStateAfterHostRename",
    "    } finally {\n        if (cachesSettled) globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);\n    }\n}\n\nasync function rebaseActiveStateAfterHostRename",
)

# Historical rename indexing uses bounded batches but processes the complete tracked set;
# it never silently skips older chats merely because there are more than 1024.
old_hist = '''        if (allCandidates.length > HISTORICAL_RENAME_CANDIDATE_LIMIT) {\n            console.warn(`[NPC State] historical rename index bounded at ${HISTORICAL_RENAME_CANDIDATE_LIMIT}/${allCandidates.length} most-recent tracked chats.`);\n        }\n        const candidateKeys = allCandidates.slice(0, HISTORICAL_RENAME_CANDIDATE_LIMIT);\n        const index = new Map();\n        let cursor = 0;\n        const workers = Array.from({ length: Math.min(4, Math.max(1, candidateKeys.length)) }, async () => {\n            while (cursor < candidateKeys.length) {\n                const key = candidateKeys[cursor++];\n                const parsed = parseQualifiedChatKey(key);\n                if (!parsed) continue;\n                const persisted = parsed.kind === 'group'\n                    ? await loadPersistedGroupChat(parsed.chatId)\n                    : await loadPersistedCharacterChat(parsed.chatId, newOwner);\n                const signature = historicalChatSignature(persisted);\n                if (!signature) continue;\n                const list = index.get(signature) || [];\n                list.push(key);\n                index.set(signature, list);\n            }\n        });\n        await Promise.all(workers);\n        return index;'''
new_hist = '''        const index = new Map();\n        for (let offset = 0; offset < allCandidates.length; offset += HISTORICAL_RENAME_CANDIDATE_LIMIT) {\n            const candidateKeys = allCandidates.slice(offset, offset + HISTORICAL_RENAME_CANDIDATE_LIMIT);\n            let cursor = 0;\n            const workers = Array.from({ length: Math.min(4, Math.max(1, candidateKeys.length)) }, async () => {\n                while (cursor < candidateKeys.length) {\n                    const key = candidateKeys[cursor++];\n                    const parsed = parseQualifiedChatKey(key);\n                    if (!parsed) continue;\n                    const persisted = parsed.kind === 'group'\n                        ? await loadPersistedGroupChat(parsed.chatId)\n                        : await loadPersistedCharacterChat(parsed.chatId, newOwner);\n                    const signature = historicalChatSignature(persisted);\n                    if (!signature) continue;\n                    const list = index.get(signature) || [];\n                    list.push(key);\n                    index.set(signature, list);\n                }\n            });\n            await Promise.all(workers);\n            await Promise.resolve();\n        }\n        return index;'''
replace_once('hardening.js', old_hist, new_hist)

# Regression additions.
p = Path('tests/hardening-v0221.test.js')
t = p.read_text(encoding='utf-8')
t = t.replace(
    "    lifecycleRenameStateIsEmpty,\n    liveLifecycleCandidateKeys,",
    "    applyCanonicalOwnershipMove,\n    lifecycleRenameStateIsEmpty,\n    liveLifecycleCandidateKeys,",
    1,
)
extra = r'''
test('historical tombstone replay cannot poison an already-live renamed destination', () => {
    const oldKey = buildQualifiedChatKey('chat', 'old.png', 'Adventure');
    const newKey = buildQualifiedChatKey('chat', 'new.png', 'Adventure');
    const config = {
        dataFiles: { [newKey]: { path: '/live', revision: 3 } },
        sidecarTombstones: { [oldKey]: { reason: 'old-delete', at: 1 } },
        recoveryFiles: {}, branchIndex: {},
    };
    applyCanonicalOwnershipMove(config, { oldKey, newKey, reason: 'character-renamed' });
    assert.equal(config.sidecarTombstones[newKey], undefined);
    assert.equal(config.dataFiles[newKey].path, '/live');
});

test('lifecycle wrappers schedule retries for late background rejection and owner flush fails closed', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(index, /void operation\.catch\(error =>[\s\S]*scheduleLifecycleRetry/);
    assert.match(hardening, /void operation\.catch\(error =>[\s\S]*scheduleHardeningRetry/);
    assert.match(index, /NPC_STATE_OWNER_FLUSH_INCOMPLETE/);
    assert.match(hardening, /if \(cachesSettled\)/);
});

test('historical rename batching processes every tracked candidate instead of truncating after one batch', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(hardening, /for \(let offset = 0; offset < allCandidates\.length; offset \+= HISTORICAL_RENAME_CANDIDATE_LIMIT\)/);
    assert.doesNotMatch(hardening, /allCandidates\.slice\(0, HISTORICAL_RENAME_CANDIDATE_LIMIT\)/);
});
'''
if 'historical tombstone replay cannot poison' not in t:
    t = t.rstrip() + '\n\n' + extra.strip() + '\n'
p.write_text(t, encoding='utf-8')

print('v0.2.21 manual hard-pass refinements applied')
