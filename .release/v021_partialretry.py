from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one partial-retry match, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Character owner rename: successful chat moves are durable, failed chat keys are retried.
replace_once(
    'hardening.js',
    "    let changed = false;\n    let cachesSettled = false;",
    "    let changed = false;\n    let cachesSettled = false;\n    const failedKeys = [];",
)
replace_once(
    'hardening.js',
    "                console.warn(`[NPC State] character rename preserved ${oldKey} and continued with other chats.`, error);",
    "                failedKeys.push({ key: oldKey, error });\n                console.warn(`[NPC State] character rename preserved ${oldKey} and continued with other chats.`, error);",
)
replace_once(
    'hardening.js',
    "        if (changed) {\n            await saveSettingsNow();\n            for (const predecessor of retiredPredecessors) {\n                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }\n                catch (error) { console.warn(`[NPC State] retired character-rename predecessor ${predecessor.key} could not be physically deleted.`, error); }\n            }\n            await cleanupRecoveryGarbage(config);\n        }\n        return changed;",
    "        if (changed) {\n            await saveSettingsNow();\n            for (const predecessor of retiredPredecessors) {\n                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }\n                catch (error) { console.warn(`[NPC State] retired character-rename predecessor ${predecessor.key} could not be physically deleted.`, error); }\n            }\n            await cleanupRecoveryGarbage(config);\n        }\n        if (failedKeys.length) {\n            const error = new AggregateError(failedKeys.map(item => item.error), `NPC State character rename left ${failedKeys.length} chat(s) under the old owner for retry.`);\n            error.code = 'NPC_STATE_OWNER_RENAME_PARTIAL';\n            error.failures = failedKeys.map(item => item.key);\n            throw error;\n        }\n        return changed;",
)

# Character owner deletion: only still-live keys are retried; already tombstoned keys are skipped.
# Target the second occurrence of the common declaration by replacing the unique deletion prelude.
replace_once(
    'hardening.js',
    "    let changed = false;\n    const retiredPredecessors = [];\n    let cachesSettled = false;\n    try {\n        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner);",
    "    let changed = false;\n    const retiredPredecessors = [];\n    let cachesSettled = false;\n    const failedKeys = [];\n    try {\n        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner);",
)
replace_once(
    'hardening.js',
    "                console.warn(`[NPC State] character deletion preserved ${key} and continued with other chats.`, error);",
    "                failedKeys.push({ key, error });\n                console.warn(`[NPC State] character deletion preserved ${key} and continued with other chats.`, error);",
)
replace_once(
    'hardening.js',
    "        if (changed) {\n            await saveSettingsNow();\n            for (const predecessor of retiredPredecessors) {\n                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }\n                catch (error) { console.warn(`[NPC State] retired character-delete predecessor ${predecessor.key} could not be physically deleted.`, error); }\n            }\n            await cleanupRecoveryGarbage(config);\n        }\n        return changed;",
    "        if (changed) {\n            await saveSettingsNow();\n            for (const predecessor of retiredPredecessors) {\n                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }\n                catch (error) { console.warn(`[NPC State] retired character-delete predecessor ${predecessor.key} could not be physically deleted.`, error); }\n            }\n            await cleanupRecoveryGarbage(config);\n        }\n        if (failedKeys.length) {\n            const error = new AggregateError(failedKeys.map(item => item.error), `NPC State character deletion left ${failedKeys.length} live chat(s) for retry.`);\n            error.code = 'NPC_STATE_OWNER_DELETE_PARTIAL';\n            error.failures = failedKeys.map(item => item.key);\n            throw error;\n        }\n        return changed;",
)

# Regression guard.
p = Path('tests/hardening-v0221.test.js')
t = p.read_text(encoding='utf-8')
extra = r'''
test('owner-wide partial failures are surfaced to the retry scheduler after successful keys are persisted', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(hardening, /NPC_STATE_OWNER_RENAME_PARTIAL/);
    assert.match(hardening, /NPC_STATE_OWNER_DELETE_PARTIAL/);
    assert.match(hardening, /failedKeys\.push\(\{ key: oldKey, error \}\)/);
    assert.match(hardening, /failedKeys\.push\(\{ key, error \}\)/);
});
'''
if 'owner-wide partial failures are surfaced' not in t:
    t = t.rstrip() + '\n\n' + extra.strip() + '\n'
p.write_text(t, encoding='utf-8')

print('v0.2.21 partial owner lifecycle retry hardening applied')
