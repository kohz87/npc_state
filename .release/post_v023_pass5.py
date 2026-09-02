from pathlib import Path

root = Path(__file__).resolve().parents[1]
index_path = root / 'index.js'
index = index_path.read_text(encoding='utf-8')

old_payload = '''        const fullWindowRelationship = fullWindowScan
            ? prepareFullWindowRelationshipEvaluation(resolvedParsed, state.npcs)
            : { evaluation: resolvedParsed, mergeSafe: resolvedParsed };'''
new_payload = '''        // Any scan that reads rolling history must scrub numeric relationship output from the
        // broad dossier scanner. Relationship movement is evaluated separately against the
        // current exchange only, so manual/full scans cannot replay older relationship events.
        const fullWindowRelationship = (manual || fullWindowScan)
            ? prepareFullWindowRelationshipEvaluation(resolvedParsed, state.npcs)
            : { evaluation: resolvedParsed, mergeSafe: resolvedParsed };'''
if old_payload not in index:
    raise SystemExit('rolling relationship payload block not found')
index = index.replace(old_payload, new_payload, 1)

old_call = '''        // Manual scans are historical/dossier reconciliation. They must never award numeric
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
new_call = '''        const relationshipPass = await runFocusedRelationshipPass(
            ctx,
            fullWindowRelationship.evaluation,
            state.npcs,
            currentTranscript || transcript,
            settings,
            { currentExchangeOnly: manual || fullWindowScan },
        );'''
if old_call not in index:
    raise SystemExit('manual relationship suppression block not found')
index = index.replace(old_call, new_call, 1)
index_path.write_text(index, encoding='utf-8')

hard_path = root / 'tests' / 'hardening-v0223.test.js'
hard = hard_path.read_text(encoding='utf-8')
old_test = '''test('v0.2.23 manual reconciliation never runs the numeric relationship evaluator', () => {
    assert.match(source, /const relationshipPass = manual/);
    assert.match(source, /decisions: new Map\(\), used: false, responseChars: 0, retried: false, targetCount: 0/);
    assert.match(source, /if \(currentExchangeOnly\) return false/);
    const relevance = source.slice(
        source.indexOf('function currentExchangeRelationshipRelevant'),
        source.indexOf('function dossierLabelsMatch'),
    );
    assert.doesNotMatch(relevance, /npc\.present \|\| npc\.worldActive/);
});'''
new_test = '''test('v0.2.23 manual and full-window scans scrub rolling relationship output and evaluate only the current exchange', () => {
    assert.match(source, /const fullWindowRelationship = \(manual \|\| fullWindowScan\)/);
    assert.match(source, /currentExchangeOnly: manual \|\| fullWindowScan/);
    assert.match(source, /if \(currentExchangeOnly\) return false/);
    const relevance = source.slice(
        source.indexOf('function currentExchangeRelationshipRelevant'),
        source.indexOf('function dossierLabelsMatch'),
    );
    assert.doesNotMatch(relevance, /npc\.present \|\| npc\.worldActive/);
});'''
if old_test not in hard:
    raise SystemExit('manual relationship hardening test not found')
hard_path.write_text(hard.replace(old_test, new_test, 1), encoding='utf-8')

ui_path = root / 'tests' / 'ui-layout.test.js'
ui_lines = ui_path.read_text(encoding='utf-8').splitlines()
ui_matches = [i for i, line in enumerate(ui_lines) if 'assert.match(index, /runFocusedRelationshipPass' in line]
if len(ui_matches) != 1:
    raise SystemExit(f'focused relationship UI invariant: expected one assertion, found {len(ui_matches)}')
ui_lines[ui_matches[0]] = "    assert.match(index, /runFocusedRelationshipPass\\(\\s*ctx,\\s*fullWindowRelationship\\.evaluation,\\s*state\\.npcs,\\s*currentTranscript \\|\\| transcript,\\s*settings,\\s*\\{ currentExchangeOnly: manual \\|\\| fullWindowScan \\},\\s*\\)/);"
ui_path.write_text('\n'.join(ui_lines) + '\n', encoding='utf-8')

print('v0.2.23 manual relationship repair preserved with rolling-history scrub')
