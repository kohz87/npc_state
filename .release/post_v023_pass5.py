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

runtime_path = root / 'tests' / 'runtime-smoke.mjs'
runtime = runtime_path.read_text(encoding='utf-8')
cast_start = runtime.find('    // v0.2.23: an NPC involved at the beginning of a response must still reconcile')
cast_end = runtime.find('    // Non-truncation structural JSON errors', cast_start)
if cast_start < 0 or cast_end < 0:
    raise SystemExit('v0.2.23 cast regression block not found')
cast_block = runtime[cast_start:cast_end]
if 'Yunyun' not in cast_block or 'yunyunBeforeCast' not in cast_block:
    raise SystemExit('stale Yunyun cast regression fixture not found')
cast_block = cast_block.replace('Yunyun', 'Mira').replace('yunyun', 'mira')
cast_block = cast_block.replace('/Requested NPC: Neri/i', '/^Requested NPC: Neri$/im')
cast_block = cast_block.replace(
    "    assert.equal(state.pendingBackfills.length, 0, 'successful cast sweep should drain its queue');",
    "    assert.equal(state.pendingBackfills.some(item => item.npcId === miraAfterCast.id || item.npcId === neri.id), false, 'successful cast reconciliation should drain the current Mira/Neri requests without deleting unrelated retry backlog');",
)
runtime = runtime[:cast_start] + cast_block + runtime[cast_end:]

swipe_anchor = "    const rawCallsBeforeSwipe = mockState.rawCalls.length;"
swipe_replacement = "    const rawCallsBeforeSwipe = mockState.rawCalls.length;\n    const broadScansBeforeSwipe = mockState.rawCalls.filter(call => /isolated dossier scanner/i.test(String(call?.[0]?.systemPrompt || ''))).length;"
if swipe_anchor not in runtime:
    raise SystemExit('swipe raw-call baseline not found')
runtime = runtime.replace(swipe_anchor, swipe_replacement, 1)
old_swipe_assert = "    assert.equal(mockState.rawCalls.length, rawCallsBeforeSwipe + 1, 'settled replacement should receive exactly one deferred dossier scan');"
new_swipe_assert = "    const broadScansAfterSwipe = mockState.rawCalls.filter(call => /isolated dossier scanner/i.test(String(call?.[0]?.systemPrompt || ''))).length;\n    assert.equal(broadScansAfterSwipe, broadScansBeforeSwipe + 1, 'settled replacement should receive exactly one deferred dossier scan even when that scan also needs focused relationship evaluation');"
if old_swipe_assert not in runtime:
    raise SystemExit('stale swipe raw-call assertion not found')
runtime = runtime.replace(old_swipe_assert, new_swipe_assert, 1)
runtime_path.write_text(runtime, encoding='utf-8')

migration_path = root / 'tests' / 'migration-smoke.mjs'
migration = migration_path.read_text(encoding='utf-8')
old_schema_assert = "    assert.equal(settings.schemaVersion, 28);"
new_schema_assert = "    assert.equal(settings.schemaVersion, 29);"
if old_schema_assert not in migration:
    raise SystemExit('stale migration schema assertion not found')
migration_path.write_text(migration.replace(old_schema_assert, new_schema_assert, 1), encoding='utf-8')

print('v0.2.23 manual relationship repair preserved with rolling-history scrub')
