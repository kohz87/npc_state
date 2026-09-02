from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one postfix match, found {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Remove the duplicate helper produced by the historical-rename range replacement.
path = Path('hardening.js')
text = path.read_text(encoding='utf-8')
needle = 'async function rebaseCanonicalStateForHostRename(key, renamedMessages) {'
starts = []
pos = 0
while True:
    pos = text.find(needle, pos)
    if pos < 0:
        break
    starts.append(pos)
    pos += len(needle)
if len(starts) == 2:
    second = starts[1]
    end = text.find('function resetHistoricalRenameIndex()', second)
    if end < 0:
        raise SystemExit('could not find end of duplicate rebase helper')
    text = text[:second] + text[end:]
elif len(starts) != 1:
    raise SystemExit(f'unexpected rebase helper count: {len(starts)}')
text = text.replace('/* NPC State v0.2.20 - standalone SillyTavern extension */', '/* NPC State v0.2.21 - standalone SillyTavern extension */', 1)
path.write_text(text, encoding='utf-8')

# v0.2.20 source-shape guards are intentionally superseded by executable v0.2.21 helpers.
p = Path('tests/hardening-v0220.test.js')
t = p.read_text(encoding='utf-8')
t = t.replace(
    "  assert.match(index, /absent\\.length === 1 && present\\.length === candidates\\.length - 1/);",
    "  assert.match(index, /resolveDeletedLifecycleKeyFromPresence\\(candidates, presence\\)/);",
    1,
)
old = """test('ambiguous delete proof considers only live ownership and ignores historical tombstone/recovery records', () => {\n  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');\n  const block = index.slice(index.indexOf('function lifecycleCandidateKeys'), index.indexOf('async function hostCharacterChatPresence'));\n  assert.match(block, /settings\\.dataFiles/);\n  assert.doesNotMatch(block, /settings\\.branchIndex/);\n  assert.match(block, /settings\\.chats/);\n  assert.match(block, /chatStateCache/);\n  assert.doesNotMatch(block, /sidecarTombstones|recoveryFiles/);\n});"""
new = """test('ambiguous delete proof considers only live ownership and ignores historical tombstone/recovery records', () => {\n  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');\n  const wrapper = index.slice(index.indexOf('function lifecycleCandidateKeys'), index.indexOf('async function hostCharacterChatPresence'));\n  assert.match(wrapper, /liveLifecycleCandidateKeys\\(getSettings\\(\\), chatStateCache\\.keys\\(\\), kind, id\\)/);\n  const core = fs.readFileSync(new URL('../hardening-core.js', import.meta.url), 'utf8');\n  const block = core.slice(core.indexOf('export function liveLifecycleCandidateKeys'), core.indexOf('export function resolveOwnedLifecycleKey'));\n  assert.match(block, /settings\\?\\.dataFiles/);\n  assert.match(block, /settings\\?\\.chats/);\n  assert.doesNotMatch(block, /branchIndex|recoveryFiles/);\n  assert.match(block, /sidecarTombstones/);\n});"""
if old not in t:
    raise SystemExit('hardening-v0220 live-candidate test shape changed unexpectedly')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

# Release metadata guard follows the current release rather than pinning the prior patch.
p = Path('tests/v0214-hardening.test.js')
t = p.read_text(encoding='utf-8')
t = t.replace("release metadata is v0.2.20", "release metadata is v0.2.21", 1)
t = t.replace("NPC_STATE_VERSION = '0\\.2\\.20'", "NPC_STATE_VERSION = '0\\.2\\.21'", 1)
t = t.replace("'0.2.20'", "'0.2.21'", 1)
p.write_text(t, encoding='utf-8')

# Old implementation-shape test now verifies delegation to the pure authoritative-owner helper.
p = Path('tests/v0217-hardening.test.js')
t = p.read_text(encoding='utf-8')
t = t.replace(
    "assert.match(index, /if \\(direct && keys\\.has\\(direct\\)\\) return direct/);",
    "assert.match(index, /resolveOwnedLifecycleKey\\(candidates, kind, id, resolvedOwner, ownerWasProvided\\)/);",
    1,
)
p.write_text(t, encoding='utf-8')

print('v0.2.21 transform postfix applied')
