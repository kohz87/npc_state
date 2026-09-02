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

# Existing semantic memory normalization keeps the newest tail when more items are supplied.
# Broad scans remain capped at three; targeted reconciliation may accept all five.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.deepEqual(normalizeScanNpc(raw).memories, ['one', 'two', 'three']);",
    "    assert.deepEqual(normalizeScanNpc(raw).memories, ['three', 'four', 'five'], 'broad normalization keeps the most recent three');",
    'broad memory retention expectation')
write('tests/hardening-v0222.test.js', test)

# Automatic historical enrichment is not a second observation of the NPC. Restore live fields and
# observation counters after merge so one assistant turn cannot increment seenCount twice or move
# recency merely because a historical backfill succeeded.
index = read('index.js')
anchor = '''        const nextState = merged.state;
        const finalNpc = nextState.npcs.find(npc => npc.id === request.npcId);
        if (targetMessageId >= 0 && finalNpc) {
'''
replacement = '''        const nextState = merged.state;
        const finalNpc = nextState.npcs.find(npc => npc.id === request.npcId);
        if (request.preserveLiveState === true && liveBeforeBackfill && finalNpc) {
            finalNpc.present = Boolean(liveBeforeBackfill.present);
            finalNpc.worldActive = Boolean(liveBeforeBackfill.worldActive) && !finalNpc.present;
            finalNpc.mood = liveBeforeBackfill.mood || '';
            finalNpc.location = liveBeforeBackfill.location || '';
            finalNpc.goal = liveBeforeBackfill.goal || '';
            finalNpc.status = liveBeforeBackfill.status || '';
            finalNpc.seenCount = Number(liveBeforeBackfill.seenCount || 0);
            finalNpc.lastSeenTurn = Number(liveBeforeBackfill.lastSeenTurn || 0);
            finalNpc.lastWorldActiveTurn = Number(liveBeforeBackfill.lastWorldActiveTurn || 0);
        }
        if (targetMessageId >= 0 && finalNpc) {
'''
index = replace_once(index, anchor, replacement, 'automatic backfill observation restoration')
write('index.js', index)

runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
    "    assert.equal(mira.present, true, 'automatic historical enrichment must not erase the live presence established by the full scan');\n    assert.equal(state.pendingBackfills.some(item => item.npcId === mira.id), false);",
    "    assert.equal(mira.present, true, 'automatic historical enrichment must not erase the live presence established by the full scan');\n    assert.equal(mira.seenCount, 1, 'automatic historical enrichment must not count as a second sighting in the same turn');\n    assert.equal(state.pendingBackfills.some(item => item.npcId === mira.id), false);",
    'runtime observation counter assertion')
write('tests/runtime-smoke.mjs', runtime)

test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);",
    "    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);\n    assert.match(source, /finalNpc\\.seenCount = Number\\(liveBeforeBackfill\\.seenCount \\|\\| 0\\)/);",
    'observation restoration wiring assertion')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 6 fixes applied')
