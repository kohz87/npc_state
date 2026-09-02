from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'tests/runtime-smoke.mjs'
text = path.read_text(encoding='utf-8')
old = "assert.equal(globalThis.NPCState?.version, '0.2.21');"
if text.count(old) != 1:
    raise SystemExit(f'runtime version assertion: expected one match, found {text.count(old)}')
path.write_text(text.replace(old, "assert.equal(globalThis.NPCState?.version, '0.2.22');", 1), encoding='utf-8')
print('v0.2.22 hard-pass 3 runtime fixture repair applied')
