from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def write(rel, value):
    (ROOT / rel).write_text(value, encoding='utf-8')


def replace_once(value, old_value, new_value, label):
    count = value.count(old_value)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return value.replace(old_value, new_value, 1)

core = read('core-v0218.js')
old_desire = "    desire: /\\b(desire|desired|attract|attraction|romantic|romance|intimacy|intimate|kiss|kissed|kissing|sexual|sexually|lust|longing|yearn|flirt|date|lover|physical closeness|physical contact|wanted? (?:him|her|them|the player)|drawn to)\\b/i,"
new_desire = "    desire: /\\b(desire|desires|desired|desiring|attract|attracts|attracted|attracting|attraction|attractive|romantic|romance|intimacy|intimate|kiss|kisses|kissed|kissing|sexual|sexually|lust|longing|yearn|yearns|yearned|yearning|flirt|flirts|flirted|flirting|date|dating|lover|physical closeness|physical contact|(?:want|wants|wanted|wanting) (?:him|her|them|the player)|drawn to)\\b/i,"
core = replace_once(core, old_desire, new_desire, 'Desire inflection coverage')

# Restore source grounding for every accepted axis. Trust/Affection/Tension no longer require
# magic cue vocabulary, but their evidence must still overlap the CURRENT exchange. Desire
# requires both narration/evidence attraction cues plus the same grounding check.
core = replace_once(core,
    "        return RELATIONSHIP_AXIS_CUES.desire.test(source);",
    "        return RELATIONSHIP_AXIS_CUES.desire.test(source) && relationshipChangeReasonGrounded(explanation, source);",
    'Desire source grounding')
core = replace_once(core,
    "    }\n    return true;\n}\n\nexport function filterRelationshipDeltaByEvidence",
    "    }\n    if (!source) return true;\n    return relationshipChangeReasonGrounded(explanation, source);\n}\n\nexport function filterRelationshipDeltaByEvidence",
    'non-Desire current-exchange grounding')
write('core-v0218.js', core)

# Regression coverage for common inflections and hallucinated non-Desire evidence.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "test('invalid Desire does not erase valid Affection', () => {",
    "test('non-desire evidence must still be grounded in the current exchange', () => {\n    assert.equal(relationshipAxisEvidenceGrounded('affection', 'She gives him a treasured keepsake.', 'They exchange ordinary greetings at the gate.'), false);\n    assert.equal(relationshipAxisEvidenceGrounded('affection', 'She stays to share supper with him.', 'She stays to share supper with him.'), true);\n});\n\ntest('invalid Desire does not erase valid Affection', () => {",
    'grounded non-Desire regression')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 2 fixes applied')
