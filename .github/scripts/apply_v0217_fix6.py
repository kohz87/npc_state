from pathlib import Path

path = Path('tests/migration-smoke.mjs')
text = path.read_text()
old = """    assert.equal('thoughts' in payload.state.npcs[0], false, 'legacy Current Thoughts should be removed during v0.1.15 normalization');
    assert.equal('thoughts' in payload.state.inlineCards[0].cards[0], false, 'legacy snapshot thoughts should also be removed');
    assert.deepEqual(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta, { trust: 0, affection: 0, desire: 0, tension: 0 }, 'legacy historical audit snapshots should be sanitized during load');
    assert.ok(Object.values(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta).every(Number.isFinite));
    assert.equal(payload.state.durableCompactionVersion, 1);"""
new = """    assert.equal('thoughts' in payload.state.npcs[0], false, 'legacy Current Thoughts should be removed during v0.1.15 normalization');
    // This fixture intentionally carries a placeholder legacy inline-card fingerprint. Once the
    // owner-qualified chat is upgraded to content-based branch lineage, an unverifiable historical
    // card must be discarded instead of being attached to a potentially different message.
    assert.deepEqual(payload.state.inlineCards, [], 'unverifiable legacy inline-card history must be dropped during branch migration');
    assert.equal(payload.state.durableCompactionVersion, 1);"""
if old not in text:
    raise SystemExit('legacy inline-card migration assertions not found')
path.write_text(text.replace(old, new, 1))

Path(__file__).unlink()
print('v0.2.17 legacy inline-card branch-safety expectation updated')
