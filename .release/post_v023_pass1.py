from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'tests' / 'hardening-v0223.test.js'
text = path.read_text(encoding='utf-8')

bad = """    assert.doesNotMatch(source, /\\.slice\\(0, 4\\);
\\s*if \\(!targets\\.length\\)/);"""
good = """    const relationshipPassSource = source.slice(
        source.indexOf('async function runFocusedRelationshipPass'),
        source.indexOf('function prepareFullWindowRelationshipEvaluation'),
    );
    assert.doesNotMatch(relationshipPassSource, /\\.slice\\(0,\\s*4\\)/);"""
if bad not in text:
    raise SystemExit('generated v0.2.23 relationship-cap assertion not found')
path.write_text(text.replace(bad, good, 1), encoding='utf-8')
print('v0.2.23 generated invariant test syntax corrected')
