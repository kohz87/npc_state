from pathlib import Path

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
path.write_text(text, encoding='utf-8')
print('v0.2.21 transform postfix applied')
