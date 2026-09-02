from pathlib import Path

root = Path(__file__).resolve().parents[1]

hard = root / 'tests' / 'hardening-v0222.test.js'
text = hard.read_text(encoding='utf-8')
text = text.replace(
    "    assert.match(source, /queueNpcBackfillInState\\(nextState, npc\\.id, npc\\.name, targetMessageId, \\{ preserveLiveState: true \\}\\)/);",
    "    assert.match(source, /queueNpcBackfillInState\\(nextState, npc\\.id, npc\\.name, targetMessageId/);\n    assert.match(source, /deepSweep: true/);\n    assert.match(source, /silent: true/);",
    1,
)
text = text.replace("    assert.match(source, /schemaVersion: 28/);", "    assert.match(source, /schemaVersion: 29/);", 1)
hard.write_text(text, encoding='utf-8')

ui = root / 'tests' / 'ui-layout.test.js'
text = ui.read_text(encoding='utf-8')
old = "    assert.match(index, /runFocusedRelationshipPass\\(ctx, fullWindowRelationship\\.evaluation, state\\.npcs, currentTranscript \\|\\| transcript, settings\\)/);"
new = "    assert.match(index, /runFocusedRelationshipPass\\([\\s\\S]*?fullWindowRelationship\\.evaluation,[\\s\\S]*?state\\.npcs,[\\s\\S]*?currentTranscript \\|\\| transcript,[\\s\\S]*?settings,[\\s\\S]*?currentExchangeOnly: fullWindowScan/);"
if old not in text:
    raise SystemExit('ui relationship pass assertion not found')
ui.write_text(text.replace(old, new, 1), encoding='utf-8')

print('v0.2.23 reconciliation contract tests aligned')
