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

# The scanner normalizer can now carry 5 targeted memories, but the merge layer still had its own
# hardcoded incoming max of 3. Thread the same limit through applyIncoming so targeted backfill and
# manual Refresh can truly populate all five stored memory slots in one reconciliation.
core = replace_once(core,
    "function mergeImportantMemories(oldList, newList, retentionList = []) {\n    const existing = semanticDedupeItems(cleanList(oldList, 64, DURABLE_PROFILE_LIMITS.memory), {\n        maxItems: 64, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,\n    });\n    const incoming = semanticDedupeItems(cleanList(newList, 6, DURABLE_PROFILE_LIMITS.memory), {\n        maxItems: 3, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,\n    });",
    "function mergeImportantMemories(oldList, newList, retentionList = [], incomingLimit = 3) {\n    const existing = semanticDedupeItems(cleanList(oldList, 64, DURABLE_PROFILE_LIMITS.memory), {\n        maxItems: 64, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,\n    });\n    const limit = Math.max(1, Math.min(IMPORTANT_MEMORY_LIMIT, Math.round(Number(incomingLimit) || 3)));\n    const incoming = semanticDedupeItems(cleanList(newList, Math.max(6, limit * 2), DURABLE_PROFILE_LIMITS.memory), {\n        maxItems: limit, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,\n    });",
    'memory merge intake limit')
core = replace_once(core,
    "    merged.memories = mergeImportantMemories(existing.memories, incoming.memories, incoming.memoryRetention);",
    "    merged.memories = mergeImportantMemories(existing.memories, incoming.memories, incoming.memoryRetention, lifecycleOptions.memoryInputLimit || 3);",
    'applyIncoming memory limit')
core = replace_once(core,
    "        developmentContext: String(options.developmentContext || ''),\n    };",
    "        developmentContext: String(options.developmentContext || ''),\n        memoryInputLimit,\n    };",
    'lifecycle memory limit propagation')

# Per-axis evidence is the actual anti-hallucination firewall. The overall reason remains required
# for audit/dedup, but it no longer has to lexically paraphrase the CURRENT exchange a second time.
# This prevents valid mundane deltas from being swallowed solely because the model summarized the
# event with different wording.
old_apply_reason = "        const reasonGrounded = !proposedHasDelta || relationshipChangeReasonGrounded(incoming.relationshipChangeReason, lifecycleOptions.developmentContext);\n        if (proposedHasDelta && (!reasonGrounded || duplicateAward)) {"
new_apply_reason = "        const reasonPresent = !proposedHasDelta || Boolean(cleanText(incoming.relationshipChangeReason, 500));\n        if (proposedHasDelta && (!reasonPresent || duplicateAward)) {"
core = replace_once(core, old_apply_reason, new_apply_reason, 'merge overall relationship reason gate')
write('core-v0218.js', core)

index = read('index.js')
# Primary relationship decision completeness: require a nonempty audit reason, then validate every
# moved axis against current-exchange evidence. Do not reject a valid decision just because the
# reason sentence itself uses synonyms.
index = replace_once(index,
    "        const reason = raw.relationshipChangeReason ?? raw.relationship_change_reason ?? raw.relationshipReason ?? '';\n        if (!relationshipChangeReasonGrounded(reason, transcript)) return false;",
    "        const reason = String(raw.relationshipChangeReason ?? raw.relationship_change_reason ?? raw.relationshipReason ?? '').trim();\n        if (!reason) return false;",
    'primary reason completeness gate')
# Focused evaluator output uses the same contract.
index = replace_once(index,
    "            const requestedHasDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);\n            const relationshipDelta = requestedHasDelta && relationshipChangeReasonGrounded(normalized.relationshipChangeReason, transcript)\n                ? filterRelationshipDeltaByEvidence(normalized.relationshipDelta, normalized.relationshipEvidence, transcript)\n                : { trust: 0, affection: 0, desire: 0, tension: 0 };",
    "            const requestedHasDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);\n            const reasonPresent = Boolean(String(normalized.relationshipChangeReason || '').trim());\n            const relationshipDelta = requestedHasDelta && reasonPresent\n                ? filterRelationshipDeltaByEvidence(normalized.relationshipDelta, normalized.relationshipEvidence, transcript)\n                : { trust: 0, affection: 0, desire: 0, tension: 0 };",
    'focused reason gate')
write('index.js', index)

# Regression coverage for the redundant reason-gate fix and true five-memory merge path.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    normalizeScanNpc,\n    relationshipAxisEvidenceGrounded,",
    "    normalizeScanNpc,\n    mergeScanResult,\n    relationshipAxisEvidenceGrounded,",
    'mergeScanResult test import')
insert_before = "test('rolling full-window relationships are scrubbed for new and existing NPCs', () => {"
extra = '''test('targeted merge preserves five incoming memories end to end', () => {
    const state = { npcs: [], candidates: [], turn: 1 };
    const result = mergeScanResult(state, { npcs: [{
        name: 'Mira', identityKind: 'proper_name', dossierSignal: 'meaningful', present: true,
        memories: ['one', 'two', 'three', 'four', 'five'],
    }] }, { admissionMode: 'balanced', memoryInputLimit: 5, developmentContext: '' });
    assert.deepEqual(result.state.npcs[0].memories, ['one', 'two', 'three', 'four', 'five']);
});

test('grounded axis evidence survives a paraphrased overall relationship reason', () => {
    const state = { npcs: [{
        id: 'npc_mira', name: 'Mira', aliases: [], relationship: { trust: 0, affection: 0, desire: 0, tension: 0 },
        relationshipProgress: { trust: 0, affection: 0, desire: 0, tension: 0 }, relationshipMilestones: [], relationshipEventHistory: [],
        memories: [], mannerisms: [], behaviorProfile: [], keyRelationships: [], profileEvidence: {}, present: true, worldActive: false,
        createdAt: 1, updatedAt: 1, lastSeenTurn: 0, seenCount: 1,
    }], candidates: [], turn: 2 };
    const result = mergeScanResult(state, { npcs: [{
        id: 'npc_mira', name: 'Mira', present: true, relationshipImpact: 'ordinary',
        relationshipDelta: { trust: 0, affection: 1, desire: 0, tension: 0 },
        relationshipEvidence: { trust: '', affection: 'Mira accepts and stays to eat with Kazuma.', desire: '', tension: '' },
        relationshipChangeReason: 'Their casual supper leaves her a little warmer toward him.',
    }] }, { admissionMode: 'balanced', developmentContext: 'Mira accepts and stays to eat with Kazuma.' });
    assert.equal(result.state.npcs[0].relationship.affection, 1);
});

'''
test = replace_once(test, insert_before, extra + insert_before, 'reason and merge-memory regressions')
test = replace_once(test,
    "    assert.match(source, /targetedMemoryLimit = \/\\(\\?:backfill\\|chat refresh\\)\/i/);",
    "    assert.match(source, /targetedMemoryLimit = \/\\(\\?:backfill\\|chat refresh\\)\/i/);\n    assert.match(source, /const reasonPresent = Boolean\\(String\\(normalized\\.relationshipChangeReason/);",
    'reason wiring assertion')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 7 memory-merge and reason-gate fixes applied')
