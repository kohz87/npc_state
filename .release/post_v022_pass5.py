from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def write(rel, value):
    (ROOT / rel).write_text(value, encoding='utf-8')


def replace_once(value, old_value, new_value, label):
    count = value.count(old_value)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return value.replace(old_value, new_value, 1)

core = read('core-v0218.js')
core = replace_once(core,
    "export function normalizeScanNpc(raw = {}) {\n    const relationshipDeltaProvided = Object.prototype.hasOwnProperty.call(raw, 'relationshipDelta')",
    "export function normalizeScanNpc(raw = {}, options = {}) {\n    const memoryInputLimit = Math.max(1, Math.min(IMPORTANT_MEMORY_LIMIT, Math.round(Number(options.memoryInputLimit) || 3)));\n    const relationshipDeltaProvided = Object.prototype.hasOwnProperty.call(raw, 'relationshipDelta')",
    'normalizeScanNpc memory option')
core = replace_once(core,
    "        memories: semanticDedupeItems(cleanList(raw.memories, 6, DURABLE_PROFILE_LIMITS.memory), { maxItems: 3, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58 }),",
    "        memories: semanticDedupeItems(cleanList(raw.memories, Math.max(6, memoryInputLimit * 2), DURABLE_PROFILE_LIMITS.memory), { maxItems: memoryInputLimit, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58 }),",
    'scanner memory intake limit')
core = replace_once(core,
    "    const sourceMessageId = Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null;\n    const lifecycleOptions = {",
    "    const sourceMessageId = Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null;\n    const memoryInputLimit = Math.max(1, Math.min(IMPORTANT_MEMORY_LIMIT, Math.round(Number(options.memoryInputLimit) || 3)));\n    const lifecycleOptions = {",
    'merge memory intake option')
core = replace_once(core,
    "    for (const raw of incomingList) {\n        const incoming = normalizeScanNpc(raw);",
    "    for (const raw of incomingList) {\n        const incoming = normalizeScanNpc(raw, { memoryInputLimit });",
    'merge targeted memory normalization')
write('core-v0218.js', core)

index = read('index.js')
# Targeted manual refresh and targeted automatic/OOC backfill are allowed to admit the full stored
# memory set in one reconciliation. Broad scans retain the default 3-new-memory intake.
refresh_anchor = '''            preservePresence: true,
            skipRelationshipUpdate: true,
            developmentContext: transcript,
        });
        // A targeted refresh may use social-edge machinery internally'''
refresh_repl = '''            preservePresence: true,
            skipRelationshipUpdate: true,
            memoryInputLimit: IMPORTANT_MEMORY_LIMIT,
            developmentContext: transcript,
        });
        // A targeted refresh may use social-edge machinery internally'''
index = replace_once(index, refresh_anchor, refresh_repl, 'targeted refresh memory limit')

backfill_anchor = '''            preservePresence: true,
            skipRelationshipUpdate: true,
            developmentContext: transcript,
        });
        const nextState = merged.state;'''
backfill_repl = '''            preservePresence: true,
            skipRelationshipUpdate: true,
            memoryInputLimit: IMPORTANT_MEMORY_LIMIT,
            developmentContext: transcript,
        });
        const nextState = merged.state;'''
index = replace_once(index, backfill_anchor, backfill_repl, 'targeted backfill memory limit')

# A correction retry must not silently downgrade targeted reconciliation from 5 memories to 3.
retry_old = '''function compactRetryPrompt(prompt, label = 'scanner', reason = 'malformed') {
    const cause = reason === 'truncated'
        ? 'Your previous response ended before the JSON was complete.'
        : 'Your previous response was not valid JSON. Rebuild it from the beginning with correct commas, colons, quotes, arrays, and objects.';
    return `${prompt}\n\nCRITICAL COMPACT JSON RETRY (${label}): ${cause} Return the full JSON object again from the beginning. Use MINIFIED JSON only. Keep every value concise; shorten prose instead of risking truncation. Omit unsupported optional facts rather than explaining them. Compact rather than append: appearance under 500 characters, personality 280, speech 240, behaviorProfile at most 6 short point-form rules, background/relationship summary 280-320, mannerisms at most 4 DISTINCT short items, key relationships one entry per counterpart, memories at most 3 NEW distinct events, memoryRetention at most 5 distinct events. Close every quoted string, array, and object. No markdown, no commentary, no code fence.`;
}'''
retry_new = '''function compactRetryPrompt(prompt, label = 'scanner', reason = 'malformed') {
    const cause = reason === 'truncated'
        ? 'Your previous response ended before the JSON was complete.'
        : 'Your previous response was not valid JSON. Rebuild it from the beginning with correct commas, colons, quotes, arrays, and objects.';
    const targetedMemoryLimit = /(?:backfill|chat refresh)/i.test(String(label || '')) ? IMPORTANT_MEMORY_LIMIT : 3;
    return `${prompt}\n\nCRITICAL COMPACT JSON RETRY (${label}): ${cause} Return the full JSON object again from the beginning. Use MINIFIED JSON only. Keep every value concise; shorten prose instead of risking truncation. Omit unsupported optional facts rather than explaining them. Compact rather than append: appearance under 500 characters, personality 280, speech 240, behaviorProfile at most 6 short point-form rules, background/relationship summary 280-320, mannerisms at most 4 DISTINCT short items, key relationships one entry per counterpart, memories at most ${targetedMemoryLimit} distinct events, memoryRetention at most 5 distinct events. Close every quoted string, array, and object. No markdown, no commentary, no code fence.`;
}'''
index = replace_once(index, retry_old, retry_new, 'targeted retry memory contract')
write('index.js', index)

# Runtime targeted backfill now returns five actual memories rather than relying on memoryRetention
# to invent records. memoryRetention remains a curation signal, not a second data source.
runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
'''                memories: [
                    'Returned Kazuma\\'s dropped purse untouched.',
                    'Shared stew with Kazuma after he invited her to stay.',
                    'Helped sort a jammed delivery cart at the guild entrance.',
                ],''',
'''                memories: [
                    'Returned Kazuma\\'s dropped purse untouched.',
                    'Shared stew with Kazuma after he invited her to stay.',
                    'Helped sort a jammed delivery cart at the guild entrance.',
                    'Warned Kazuma that the north stair was slick after rain.',
                    'Remembered Kazuma\\'s preferred table near the hearth.',
                ],''',
    'runtime five-memory backfill payload')
write('tests/runtime-smoke.mjs', runtime)

# Pure regression: broad scan remains conservative at 3, targeted mode can carry all 5.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    prepareFullWindowRelationshipPayload,\n    relationshipAxisEvidenceGrounded,",
    "    prepareFullWindowRelationshipPayload,\n    normalizeScanNpc,\n    relationshipAxisEvidenceGrounded,",
    'normalizeScanNpc test import')
insert_before = "test('rolling full-window relationships are scrubbed for new and existing NPCs', () => {"
memory_test = '''test('targeted reconciliation can admit five memories while broad scans stay capped at three', () => {
    const raw = { name: 'Mira', memories: ['one', 'two', 'three', 'four', 'five'] };
    assert.deepEqual(normalizeScanNpc(raw).memories, ['one', 'two', 'three']);
    assert.deepEqual(normalizeScanNpc(raw, { memoryInputLimit: 5 }).memories, ['one', 'two', 'three', 'four', 'five']);
});

'''
test = replace_once(test, insert_before, memory_test + insert_before, 'targeted memory regression')
test = replace_once(test,
    "    assert.match(source, /schemaVersion: 28/);",
    "    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);\n    assert.match(source, /targetedMemoryLimit = \/\\(\\?:backfill\\|chat refresh\\)\/i/);\n    assert.match(source, /schemaVersion: 28/);",
    'targeted memory runtime wiring assertions')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 5 targeted-memory fixes applied')
