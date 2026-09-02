from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'tests' / 'v0214-hardening.test.js'
text = path.read_text(encoding='utf-8')
old = """test('release metadata is v0.2.22', () => {
    assert.match(core, /NPC_STATE_VERSION = '0\\.2\\.22'/);
    assert.equal(manifest.version, '0.2.22');
    assert.equal(manifest.author, 'kohz87');
});"""
new = """test('release metadata is v0.2.23', () => {
    assert.match(core, /NPC_STATE_VERSION = '0\\.2\\.23'/);
    assert.equal(manifest.version, '0.2.23');
    assert.equal(manifest.author, 'kohz87');
});"""
if old not in text:
    raise SystemExit('legacy release assertion not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('v0.2.23 legacy release assertion aligned')
