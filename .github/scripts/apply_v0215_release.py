from pathlib import Path
import json

# The lifecycle fixes are already present on current main and covered by the 343-test suite.
# This staging script only advances the verified release metadata after those fixes are checked.
p = Path('index.js')
s = p.read_text().replace('/* NPC State v0.2.15', '/* NPC State v0.2.16')
p.write_text(s)

core = Path('core.js')
core.write_text(core.read_text().replace("NPC_STATE_VERSION = '0.2.15'", "NPC_STATE_VERSION = '0.2.16'"))

manifest = json.loads(Path('manifest.json').read_text())
manifest['version'] = '0.2.16'
Path('manifest.json').write_text(json.dumps(manifest, indent=4) + '\n')

for name in ['README.md', 'CODE-REVIEW.md', 'TEST-REPORT.md']:
    q = Path(name)
    if q.exists(): q.write_text(q.read_text().replace('v0.2.15', 'v0.2.16'))

ch = Path('CHANGELOG.md')
text = ch.read_text()
entry = '''# Changelog\n\n## 0.2.16\n\n- Release verification for the completed chat-identity and persistent-ownership hardening.\n- Group chat identity is namespace-safe when SillyTavern exposes both groupId and chatId.\n- Stale hydration is rejected through ownership epochs across delete and rename lifecycle races.\n- Retired sidecars and recovery metadata prevent deleted or renamed state from being resurrected.\n- Broken sidecars have an explicit non-destructive detach/recovery path.\n- Cross-chat branch inheritance requires stronger user-authored provenance and uses a bounded branch index.\n- Release candidate is required to survive ten consecutive full hard-pass cycles before promotion.\n\n'''
if text.startswith('# Changelog\n\n'):
    text = entry + text[len('# Changelog\n\n'):]
else:
    text = entry + text
ch.write_text(text)
