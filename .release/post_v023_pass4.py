from pathlib import Path

root = Path(__file__).resolve().parents[1]
index_path = root / 'index.js'
index = index_path.read_text(encoding='utf-8')

old_helper = '''function currentExchangeRelationshipRelevant(npc, transcript, raw = null, { currentExchangeOnly = false } = {}) {
    if (!npc || npc.archived) return false;
    if (transcriptMentionsNpcRecord(transcript, npc)) return true;
    if (npc.present || npc.worldActive) return true;
    return !currentExchangeOnly && Boolean(raw);
}'''
new_helper = '''function currentExchangeRelationshipRelevant(npc, transcript, raw = null, { currentExchangeOnly = false } = {}) {
    if (!npc || npc.archived) return false;
    // Full-window reconciliation must never turn historical presence or a previous live flag
    // into a fresh relationship event. Only an explicit name/alias participation cue in the
    // current exchange can make an omitted existing dossier a relationship target. Quick scans
    // already operate on the current exchange, so their returned row remains sufficient.
    if (transcriptMentionsNpcRecord(transcript, npc)) return true;
    if (currentExchangeOnly) return false;
    return Boolean(raw);
}'''
if old_helper not in index:
    raise SystemExit('currentExchangeRelationshipRelevant helper not found')
index = index.replace(old_helper, new_helper, 1)

old_call = '''        const relationshipPass = await runFocusedRelationshipPass(
            ctx,
            fullWindowRelationship.evaluation,
            state.npcs,
            currentTranscript || transcript,
            settings,
            { currentExchangeOnly: fullWindowScan },
        );'''
new_call = '''        // Manual scans are historical/dossier reconciliation. They must never award numeric
        // relationship changes or spend an extra relationship-evaluator call. Automatic scans
        // alone evaluate the current exchange for fresh relationship evidence.
        const relationshipPass = manual
            ? { decisions: new Map(), used: false, responseChars: 0, retried: false, targetCount: 0, failed: false }
            : await runFocusedRelationshipPass(
                ctx,
                fullWindowRelationship.evaluation,
                state.npcs,
                currentTranscript || transcript,
                settings,
                { currentExchangeOnly: fullWindowScan },
            );'''
if old_call not in index:
    raise SystemExit('focused relationship scan call not found')
index = index.replace(old_call, new_call, 1)
index_path.write_text(index, encoding='utf-8')

hard_path = root / 'tests' / 'hardening-v0223.test.js'
hard = hard_path.read_text(encoding='utf-8')
anchor = "test('v0.2.23 portrait settings use explicit transactional Save', () => {"
extra = '''test('v0.2.23 manual reconciliation never runs the numeric relationship evaluator', () => {
    assert.match(source, /const relationshipPass = manual/);
    assert.match(source, /decisions: new Map\(\), used: false, responseChars: 0, retried: false, targetCount: 0/);
    assert.match(source, /if \(currentExchangeOnly\) return false/);
    const relevance = source.slice(
        source.indexOf('function currentExchangeRelationshipRelevant'),
        source.indexOf('function dossierLabelsMatch'),
    );
    assert.doesNotMatch(relevance, /npc\.present \|\| npc\.worldActive/);
});

'''
if anchor not in hard:
    raise SystemExit('hardening v0.2.23 portrait anchor not found')
hard = hard.replace(anchor, extra + anchor, 1)
hard_path.write_text(hard, encoding='utf-8')

print('v0.2.23 current-exchange relationship scope corrected')
