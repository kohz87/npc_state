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

# Broad scans intentionally require direct lexical grounding before seeding blank durable identity
# fields. A dedicated one-NPC history extractor is narrower: the runtime has already fixed the exact
# stable id, supplied a non-empty target-only history window, and isolated the model call. Permit
# that path to seed blank Appearance/Personality/Speech without requiring the narrative to repeat
# summary adjectives. Exact-id continuity and manual profile locks remain mandatory.
core = replace_once(core,
    "    const exactIdContinuity = Boolean(incoming.id && existing.id && String(incoming.id) === String(existing.id));\n    const roleContinuity = Boolean(incoming.role && (identityLabelsRelated(existing.role, incoming.role) || identityLabelsRelated(existingName, incoming.role)));",
    "    const exactIdContinuity = Boolean(incoming.id && existing.id && String(incoming.id) === String(existing.id));\n    const targetedDurableSeedAllowed = lifecycleOptions.allowTargetedDurableSeed === true\n        && exactIdContinuity\n        && Boolean(String(lifecycleOptions.developmentContext || '').trim());\n    const roleContinuity = Boolean(incoming.role && (identityLabelsRelated(existing.role, incoming.role) || identityLabelsRelated(existingName, incoming.role)));",
    'same-id targeted durable seed guard')
core = replace_once(core,
    "        if (['personality', 'speech', 'appearance'].includes(field)\n            && !String(existing[field] || '').trim()\n            && !durableSeedGrounded(value, lifecycleOptions.developmentContext)) {\n            continue;\n        }",
    "        if (['personality', 'speech', 'appearance'].includes(field)\n            && !String(existing[field] || '').trim()\n            && !targetedDurableSeedAllowed\n            && !durableSeedGrounded(value, lifecycleOptions.developmentContext)) {\n            continue;\n        }",
    'blank durable field targeted seed gate')
core = replace_once(core,
    "        skipRelationshipUpdate: Boolean(options.skipRelationshipUpdate),\n        developmentContext: String(options.developmentContext || ''),\n        memoryInputLimit,",
    "        skipRelationshipUpdate: Boolean(options.skipRelationshipUpdate),\n        developmentContext: String(options.developmentContext || ''),\n        allowTargetedDurableSeed: options.allowTargetedDurableSeed === true,\n        memoryInputLimit,",
    'targeted durable seed option propagation')
write('core-v0218.js', core)

index = read('index.js')
targeted_merge = "            skipRelationshipUpdate: true,\n            memoryInputLimit: IMPORTANT_MEMORY_LIMIT,\n            developmentContext: transcript,"
targeted_merge_replacement = "            skipRelationshipUpdate: true,\n            memoryInputLimit: IMPORTANT_MEMORY_LIMIT,\n            allowTargetedDurableSeed: true,\n            developmentContext: transcript,"
count = index.count(targeted_merge)
if count != 2:
    raise SystemExit(f'targeted refresh/backfill seed wiring: expected two matches, found {count}')
index = index.replace(targeted_merge, targeted_merge_replacement)
write('index.js', index)

runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
    "    assert.match(mira.personality, /Patient/i);\n    assert.equal(mira.present, true, 'automatic historical enrichment must not erase the live presence established by the full scan');",
    "    assert.match(mira.personality, /Patient/i);\n    assert.match(mira.speech, /dry warmth/i, 'targeted history enrichment should seed a blank durable voice without requiring adjective echo');\n    assert.equal(mira.present, true, 'automatic historical enrichment must not erase the live presence established by the full scan');",
    'runtime targeted durable seed assertion')
write('tests/runtime-smoke.mjs', runtime)

test = read('tests/hardening-v0222.test.js')
insert_before = "test('grounded axis evidence survives a paraphrased overall relationship reason', () => {"
extra = '''test('targeted same-id history extraction may seed blank durable fields without weakening broad-scan grounding', () => {
    const baseNpc = {
        id: 'npc_mira', name: 'Mira', aliases: [], role: 'Guild porter',
        appearance: '', personality: '', speech: '', background: '',
        relationship: { trust: 0, affection: 0, desire: 0, tension: 0 },
        relationshipProgress: { trust: 0, affection: 0, desire: 0, tension: 0 },
        relationshipMilestones: [], relationshipEventHistory: [], memories: [], mannerisms: [],
        behaviorProfile: [], keyRelationships: [], profileEvidence: {}, present: true, worldActive: false,
        manualProfileFields: [], createdAt: 1, updatedAt: 1, lastSeenTurn: 1, seenCount: 1,
    };
    const incoming = { npcs: [{
        id: 'npc_mira', name: 'Mira', appearance: 'A compact porter in a patched guild tabard.',
        personality: 'Patient, observant, and quietly considerate.',
        speech: 'Brief practical sentences with dry warmth.',
        relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] };
    const context = 'Mira returned a purse, shared supper, and helped around the guild over several scenes.';

    const broad = mergeScanResult({ npcs: [structuredClone(baseNpc)], candidates: [], turn: 2 }, incoming, {
        admissionMode: 'balanced', preservePresence: true, developmentContext: context,
    });
    assert.equal(broad.state.npcs[0].personality, '', 'ordinary scans keep the lexical/evidence seed firewall');
    assert.equal(broad.state.npcs[0].speech, '', 'ordinary scans cannot invent a durable voice from unrelated wording');
    assert.equal(broad.state.npcs[0].appearance, '', 'ordinary scans cannot invent ungrounded visual detail');

    const targeted = mergeScanResult({ npcs: [structuredClone(baseNpc)], candidates: [], turn: 2 }, incoming, {
        admissionMode: 'balanced', preservePresence: true, skipRelationshipUpdate: true,
        allowTargetedDurableSeed: true, developmentContext: context,
    });
    assert.match(targeted.state.npcs[0].personality, /Patient/i);
    assert.match(targeted.state.npcs[0].speech, /dry warmth/i);
    assert.match(targeted.state.npcs[0].appearance, /patched guild tabard/i);

    const mismatched = mergeScanResult({ npcs: [structuredClone(baseNpc)], candidates: [], turn: 2 }, {
        npcs: [{ ...incoming.npcs[0], id: 'npc_other' }],
    }, {
        admissionMode: 'balanced', preservePresence: true, skipRelationshipUpdate: true,
        allowTargetedDurableSeed: true, developmentContext: context,
    });
    assert.equal(mismatched.state.npcs[0].personality, '', 'same-name matching cannot borrow the targeted trust boundary without exact id continuity');

    const lockedNpc = { ...structuredClone(baseNpc), manualProfileFields: ['personality'] };
    const locked = mergeScanResult({ npcs: [lockedNpc], candidates: [], turn: 2 }, incoming, {
        admissionMode: 'balanced', preservePresence: true, skipRelationshipUpdate: true,
        allowTargetedDurableSeed: true, developmentContext: context,
    });
    assert.equal(locked.state.npcs[0].personality, '', 'manual locks remain authoritative in targeted reconciliation');
});

'''
test = replace_once(test, insert_before, extra + insert_before, 'targeted durable seed regressions')
test = replace_once(test,
    "    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);\n    assert.match(source, /finalNpc\\.seenCount = Number\\(liveBeforeBackfill\\.seenCount \\|\\| 0\\)/);",
    "    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);\n    assert.match(source, /allowTargetedDurableSeed: true/);\n    assert.match(source, /allowTargetedDurableSeed: options\\.allowTargetedDurableSeed === true/);\n    assert.match(source, /finalNpc\\.seenCount = Number\\(liveBeforeBackfill\\.seenCount \\|\\| 0\\)/);",
    'targeted durable seed wiring assertions')
write('tests/hardening-v0222.test.js', test)

changelog = read('CHANGELOG.md')
changelog = replace_once(changelog,
    "- Automatically queues the existing targeted history backfill whenever automatic scanning creates or promotes a dossier, so first-pass memories/profile data no longer depend on a manual Refresh.\n",
    "- Automatically queues the existing targeted history backfill whenever automatic scanning creates or promotes a dossier, so first-pass memories/profile data no longer depend on a manual Refresh.\n- Lets the isolated same-ID backfill/Refresh workflow seed blank Appearance, Personality, and Speech summaries from its target-only history while preserving broad-scan grounding and every manual profile lock.\n",
    'v0.2.22 targeted seed changelog')
write('CHANGELOG.md', changelog)

print('v0.2.22 hard-pass 8 targeted durable-seed fixes applied')
