from pathlib import Path
import json

ROOT = Path('.')


def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'missing v0.2.18 release anchor: {label}')
    p.write_text(text.replace(old, new, 1))


replace_once('index.js', '/* NPC State v0.2.17', '/* NPC State v0.2.18', 'index banner')
replace_once('core.js', "NPC_STATE_VERSION = '0.2.17'", "NPC_STATE_VERSION = '0.2.18'", 'core version')

manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['version'] = '0.2.18'
manifest_path.write_text(json.dumps(manifest, indent=4) + '\n')

replace_once('README.md', '# NPC State v0.2.17', '# NPC State v0.2.18', 'README title')
replace_once('CODE-REVIEW.md', '# NPC State v0.2.17 Code Review', '# NPC State v0.2.18 Code Review', 'code-review title')
replace_once('TEST-REPORT.md', '# NPC State v0.2.17 Test Report', '# NPC State v0.2.18 Test Report', 'test-report title')
replace_once('tests/package.test.js', "assert.equal(manifest.version, '0.2.17');", "assert.equal(manifest.version, '0.2.18');", 'package version assertion')
replace_once('tests/v0214-hardening.test.js', "test('release metadata is v0.2.17'", "test('release metadata is v0.2.18'", 'release metadata test title')
replace_once('tests/v0214-hardening.test.js', "/NPC_STATE_VERSION = '0\\.2\\.17'/", "/NPC_STATE_VERSION = '0\\.2\\.18'/", 'release metadata core assertion')
replace_once('tests/v0214-hardening.test.js', "assert.equal(manifest.version, '0.2.17');", "assert.equal(manifest.version, '0.2.18');", 'release metadata manifest assertion')
replace_once('tests/runtime-smoke.mjs', "assert.equal(globalThis.NPCState?.version, '0.2.17');", "assert.equal(globalThis.NPCState?.version, '0.2.18');", 'runtime version assertion')

review = ROOT / 'CODE-REVIEW.md'
review_text = review.read_text()
review_entry = """## v0.2.18 verified release promotion\n\nThe v0.2.17 identity/storage hardening candidate is promoted as v0.2.18 after the release pipeline itself was corrected. Runtime behavior is unchanged from the fully hardened candidate: owner-qualified chat identity, owner-scoped ancestry, lineage-gated legacy migration, destructive tombstone authority, bounded branch snapshots, portrait garbage collection, bounded dormant-chat caching, clean hydration revisions, and immediate persistence for high-value manual mutations remain intact.\n\n**Release-process fix:** production `ci.yml` is read-only and version-neutral. The temporary v0.2.18 gate is a separate workflow and never attempts to commit or modify workflow files, avoiding GitHub App workflow-permission rejection. The exact v0.2.18 candidate must complete ten consecutive full passes before promotion to `main`.\n\n"""
if '## v0.2.18 verified release promotion' not in review_text:
    marker = '# NPC State v0.2.18 Code Review\n\n'
    review_text = review_text.replace(marker, marker + review_entry, 1)
    review.write_text(review_text)

report = ROOT / 'TEST-REPORT.md'
report_text = report.read_text()
report_entry = """## v0.2.18 release-gate coverage\n\n- **Node test count pending release gate**\n- Ten consecutive `npm test` passes are required on the exact v0.2.18 candidate.\n- Every pass also runs syntax checks for all runtime modules plus `git diff --check`.\n- Dedicated owner-qualified identity/storage adversarial tests run after the ten-pass loop.\n- Release consistency verifies manifest, core runtime version, README title, changelog entry, and schema-v26 coverage.\n- The release gate never stages `.github/workflows/**`; production CI remains read-only and version-neutral.\n\n"""
if '## v0.2.18 release-gate coverage' not in report_text:
    marker = '## Result\n\n**PASS**\n\n'
    report_text = report_text.replace(marker, marker + report_entry, 1)
    report.write_text(report_text)

changelog = ROOT / 'CHANGELOG.md'
changelog_text = changelog.read_text()
changelog_entry = """## 0.2.18\n\n- Promotes the fully verified owner-qualified identity and storage hardening as the actual production release.\n- Corrects release metadata so manifest, runtime constant, README, tests, and reports all agree on v0.2.18.\n- Keeps permanent CI read-only and version-neutral while moving the ten-pass release gate into a separate temporary workflow.\n- Avoids GitHub App workflow-permission failures by never asking CI-authored commits to modify `.github/workflows/**`.\n\n"""
if '## 0.2.18' not in changelog_text:
    marker = '# Changelog\n\n'
    changelog_text = changelog_text.replace(marker, marker + changelog_entry, 1)
    changelog.write_text(changelog_text)

print('v0.2.18 release surfaces prepared')
