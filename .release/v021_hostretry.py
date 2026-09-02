from pathlib import Path


def replace_idempotent(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one host-retry match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_idempotent(
    'index.js',
    "    const resolved = resolveDeletedLifecycleKeyFromPresence(candidates, presence);\n    if (resolved) {",
    "    if (presence.some(item => item.value === null)) {\n        const error = new Error(`NPC State could not prove deleted ${kind} ${id} ownership because the SillyTavern ownership probe was unavailable.`);\n        error.code = 'NPC_STATE_DELETE_OWNERSHIP_UNAVAILABLE';\n        throw error;\n    }\n    const resolved = resolveDeletedLifecycleKeyFromPresence(candidates, presence);\n    if (resolved) {",
)

p = Path('tests/hardening-v0221.test.js')
text = p.read_text(encoding='utf-8')
marker = "test('transient host ownership probe failure is surfaced for bounded retry'"
if marker not in text:
    text = text.rstrip() + r'''

test('transient host ownership probe failure is surfaced for bounded retry', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const block = index.slice(index.indexOf('async function resolveDeletedChatKey'), index.indexOf('function touchChatCache'));
    assert.match(block, /presence\.some\(item => item\.value === null\)/);
    assert.match(block, /NPC_STATE_DELETE_OWNERSHIP_UNAVAILABLE/);
    assert.match(index, /scheduleLifecycleRetry/);
});
''' + '\n'
p.write_text(text.rstrip() + '\n', encoding='utf-8')
print('v0.2.21 transient host ownership retry guard applied')
