from pathlib import Path


def rewrite(path, old, new):
    p = Path(path)
    src = p.read_text()
    if old not in src:
        raise RuntimeError(f'missing patch anchor in {path}')
    p.write_text(src.replace(old, new, 1))


rewrite('index.js', """function lifecycleCandidateKeys(rawId, kind = 'chat') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!id) return [];
    const suffix = `:${encodeChatKeyPart(id)}`;
    const prefix = `${kind}:`;
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.branchIndex || {}),
        ...Object.keys(settings.sidecarTombstones || {}),
        ...Object.keys(settings.recoveryFiles || {}),
        ...chatStateCache.keys(),
    ]);
    return [...keys].filter(key => isCanonicalChatKey(key) && key.startsWith(prefix) && key.endsWith(suffix));
}""", """function lifecycleCandidateKeys(rawId, kind = 'chat') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!id) return [];
    const suffix = `:${encodeChatKeyPart(id)}`;
    const prefix = `${kind}:`;
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.branchIndex || {}),
        ...Object.keys(settings.chats || {}),
        ...chatStateCache.keys(),
    ]);
    return [...keys].filter(key => isCanonicalChatKey(key) && key.startsWith(prefix) && key.endsWith(suffix));
}""")

p = Path('tests/hardening-v0220.test.js')
src = p.read_text()
src += r'''

test('ambiguous delete proof considers only live ownership and ignores historical tombstone/recovery records', () => {
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const block = index.slice(index.indexOf('function lifecycleCandidateKeys'), index.indexOf('async function hostCharacterChatPresence'));
  assert.match(block, /settings\.dataFiles/);
  assert.match(block, /settings\.branchIndex/);
  assert.match(block, /settings\.chats/);
  assert.match(block, /chatStateCache/);
  assert.doesNotMatch(block, /sidecarTombstones|recoveryFiles/);
});
'''
p.write_text(src)
print('live-owner deletion candidate patch applied')
