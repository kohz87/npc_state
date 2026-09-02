import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    DEFAULT_IMPACT_CRITERIA,
    DEFAULT_RELATIONSHIP_CRITERIA,
    applyRelationshipDelta,
    filterRelationshipDeltaByEvidence,
    prepareFullWindowRelationshipPayload,
    normalizeScanNpc,
    mergeScanResult,
    relationshipAxisEvidenceGrounded,
} from '../core.js';

test('v0.2.22 stock policy allows fresh mundane low-band progression', () => {
    assert.match(DEFAULT_RELATIONSHIP_CRITERIA, /LOW-BAND FAMILIARITY/i);
    assert.match(DEFAULT_IMPACT_CRITERIA, /below 25/i);
    const start = applyRelationshipDelta({ trust: 0, affection: 0, desire: 0, tension: 0 }, { trust: 0, affection: 1, desire: 0, tension: 0 }, 'ordinary');
    assert.equal(start.relationship.affection, 1);
    const locked = applyRelationshipDelta({ trust: 24, affection: 0, desire: 0, tension: 0 }, { trust: 1, affection: 0, desire: 0, tension: 0 }, 'ordinary');
    assert.equal(locked.relationship.trust, 25, 'ordinary low-band evidence may reach the first milestone boundary');
    const beyond = applyRelationshipDelta(locked.relationship, { trust: 1, affection: 0, desire: 0, tension: 0 }, 'ordinary', undefined, locked.relationshipProgress, locked.relationshipMilestones);
    assert.equal(beyond.relationship.trust, 25, 'ordinary evidence cannot deepen beyond the locked 25 boundary');
    assert.equal(beyond.milestoneBlocks.some(item => item.axis === 'trust' && item.threshold === 25), true);
});

test('non-desire evidence does not require axis cue words', () => {
    assert.equal(relationshipAxisEvidenceGrounded('affection', 'Mira accepts and stays to eat with Kazuma.', 'Mira accepts and stays to eat with Kazuma.'), true);
    assert.equal(relationshipAxisEvidenceGrounded('trust', 'She hands him the storeroom key before leaving.', 'She hands him the storeroom key before leaving.'), true);
});

test('Desire retains strict attraction/intimacy grounding', () => {
    assert.equal(relationshipAxisEvidenceGrounded('desire', 'She enjoys eating supper with him.', 'She enjoys eating supper with him.'), false);
    assert.equal(relationshipAxisEvidenceGrounded('desire', 'She kisses him because she is attracted to him.', 'She kisses him, openly attracted to him.'), true);
});

test('non-desire evidence must still be grounded in the current exchange', () => {
    assert.equal(relationshipAxisEvidenceGrounded('affection', 'She gives him a treasured keepsake.', 'They exchange ordinary greetings at the gate.'), false);
    assert.equal(relationshipAxisEvidenceGrounded('affection', 'She stays to share supper with him.', 'She stays to share supper with him.'), true);
});

test('invalid Desire does not erase valid Affection', () => {
    const filtered = filterRelationshipDeltaByEvidence(
        { trust: 0, affection: 1, desire: 1, tension: 0 },
        { trust: '', affection: 'She stays to share supper with him.', desire: 'She likes his company.', tension: '' },
        'She stays to share supper with him; there is no romantic advance.',
    );
    assert.equal(filtered.affection, 1);
    assert.equal(filtered.desire, 0);
});

test('targeted reconciliation can admit five memories while broad scans stay capped at three', () => {
    const raw = { name: 'Mira', memories: ['one', 'two', 'three', 'four', 'five'] };
    assert.deepEqual(normalizeScanNpc(raw).memories, ['three', 'four', 'five'], 'broad normalization keeps the most recent three');
    assert.deepEqual(normalizeScanNpc(raw, { memoryInputLimit: 5 }).memories, ['one', 'two', 'three', 'four', 'five']);
});

test('targeted merge preserves five incoming memories end to end', () => {
    const state = { npcs: [], candidates: [], turn: 1 };
    const result = mergeScanResult(state, { npcs: [{
        name: 'Mira', identityKind: 'proper_name', dossierSignal: 'meaningful', present: true,
        memories: ['one', 'two', 'three', 'four', 'five'],
    }] }, { admissionMode: 'balanced', memoryInputLimit: 5, developmentContext: '' });
    assert.deepEqual(result.state.npcs[0].memories, ['one', 'two', 'three', 'four', 'five']);
});

test('targeted same-id history extraction may seed blank durable fields without weakening broad-scan grounding', () => {
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

test('rolling full-window relationships are scrubbed for new and existing NPCs', () => {
    const parsed = { npcs: [
        { id: 'npc_old', name: 'Olda', relationshipImpact: 'major', relationshipDelta: { trust: 5 } },
        { name: 'Mira', relationshipImpact: 'major', relationshipDelta: { affection: 5 } },
    ] };
    const result = prepareFullWindowRelationshipPayload(parsed, [{ id: 'npc_old', name: 'Olda', aliases: [] }]);
    for (const row of result.mergeSafe.npcs) {
        assert.equal(row.relationshipImpact, 'none');
        assert.deepEqual(row.relationshipDelta, { trust: 0, affection: 0, desire: 0, tension: 0 });
    }
    assert.equal('relationshipDelta' in result.evaluation.npcs[0], false);
    assert.equal('relationshipDelta' in result.evaluation.npcs[1], false);
});

test('runtime wires auto enrichment and post-admission relationship repair', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /queueNpcBackfillInState\(nextState, npc\.id, npc\.name, targetMessageId, \{ preserveLiveState: true \}\)/);
    assert.match(source, /for \(let offset = 0; offset < newTargets\.length; offset \+= 4\)/);
    assert.match(source, /preserveLiveState: item\?\.preserveLiveState === true/);
    assert.match(source, /discarded stale dossier scan after new-NPC relationship evaluation/);
    assert.match(source, /prepareFullWindowRelationshipPayload/);
    assert.match(source, /memoryInputLimit: IMPORTANT_MEMORY_LIMIT/);
    assert.match(source, /allowTargetedDurableSeed: true/);
    assert.match(source, /finalNpc\.seenCount = Number\(liveBeforeBackfill\.seenCount \|\| 0\)/);
    assert.match(source, /targetedMemoryLimit = \/\(\?:backfill\|chat refresh\)\/i/);
    assert.match(source, /const reasonPresent = Boolean\(String\(normalized\.relationshipChangeReason/);
    assert.match(source, /schemaVersion: 28/);
});
