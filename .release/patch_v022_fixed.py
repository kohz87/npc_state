from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

def regex_once(text, pattern, repl, label):
    new, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return new

# Version and schema.
core_wrapper = replace_once(read('core.js'), "export const NPC_STATE_VERSION = '0.2.21';", "export const NPC_STATE_VERSION = '0.2.22';", 'core version')
write('core.js', core_wrapper)
manifest = json.loads(read('manifest.json'))
manifest['version'] = '0.2.22'
write('manifest.json', json.dumps(manifest, indent=4) + '\n')
index = read('index.js')
index = replace_once(index, '/* NPC State v0.2.21 - standalone SillyTavern extension */', '/* NPC State v0.2.22 - standalone SillyTavern extension */', 'index header')
index = replace_once(index, '    schemaVersion: 27,', '    schemaVersion: 28,', 'schema')

# Capture untouched v0.2.21 stock rubrics before replacing them, so settings migration can
# distinguish stock configuration from user customization.
core = read('core-v0218.js')
m = re.search(r"export const DEFAULT_RELATIONSHIP_CRITERIA = (`[\s\S]*?`);\nexport const DEFAULT_IMPACT_CRITERIA = (`[\s\S]*?`);", core)
if not m:
    raise SystemExit('could not capture v0.2.21 stock relationship rubrics')
old_rel = m.group(1)
old_impact = m.group(2)
new_rel = r'''`All relationship stats use a bipolar -100 to +100 scale with 0 as neutral. Positive and negative values are durable relationship states, not percentages or per-turn rewards. Score genuinely new directional evidence; do not replay the same event or its aftermath.
LOW-BAND FAMILIARITY: while the CURRENT magnitude of an axis is below 25, a fresh mundane interaction may score ordinary +/-1 on ONE supported axis when it newly demonstrates relationship direction. Examples include voluntarily spending time together, a small personal favor, considerate treatment, keeping a small promise, mild rudeness, or a modest disagreement. A mere greeting, neutral transaction, repeated routine, or continuation of an already-scored beat is still 0. Ordinary evidence cannot unlock/cross the 25 milestone; deeper bonds require meaningful evidence.
Trust: confidence, reliance, safety, and willingness to be vulnerable. Increase for newly demonstrated dependability, kept promises, protection, honest support, entrusted vulnerability, or comparable evidence. In the low band, a small newly demonstrated act of reliability may be ordinary +1. Decrease for betrayal, deception, abandonment, unreliability, violated confidence, or comparable distrust evidence. Trust is not obedience.
Affection: fondness, attachment, warmth, and personal care. Increase for newly demonstrated kindness, chosen companionship, comfort, bonding, or comparable emotional attachment. In the low band, a fresh modest warm interaction may be ordinary +1. Decrease for supported dislike, resentment, cruelty, rejection, humiliation, neglect, or emotional injury. Affection is not devotion, clinginess, jealousy, or self-erasure.
Desire: attraction or pull toward romantic/intimate/physical closeness. Positive Desire REQUIRES explicit attraction/romantic/intimate/physical evidence in the current exchange. Friendliness, gratitude, admiration, rescue, affection, proximity, repeated contact, or trust alone are never Desire evidence. Negative Desire means explicit aversion to that kind of closeness, not mere absence of attraction.
Tension: unresolved interpersonal pressure, conflict, fear, suspicion, awkward pressure, rivalry, resentment, or exceptional ease/release when negative. In the low band, a fresh modest friction/ease beat may be ordinary +/-1 when it actually changes interpersonal pressure; simple continuation is 0.
RELATIONSHIP WEIGHT: the farther an established score is from 0, the harder it becomes to deepen further. New evidence accumulates fractionally behind the integer display. Near-extreme scores therefore require repeated fresh evidence even when each event is valid. Minor contrary evidence also meets some established-relationship resistance; major/extreme betrayal, reconciliation, or comparable turning points can overcome more of it.
Most ordinary events affect zero or one axis. Meaningful events may affect two axes only with separate evidence. Major events may affect up to three; four axes are reserved for extreme events with distinct support for every moved axis. Every non-zero axis must carry its own grounded evidence.`'''
new_impact = r'''`none: no NEW directional relationship evidence, insufficient evidence, repeated routine, or aftermath of an already-scored event; all deltas must be 0.
ordinary: a fresh modest relationship-relevant beat. Maximum raw weight 1 on one axis. While the affected axis magnitude is below 25, mundane but directional interaction may qualify: chosen companionship, a small personal favor, minor reliability, modest kindness, mild disrespect, a small disagreement, or similar fresh evidence. Mere greetings, neutral transactions, automatic politeness, and repetition of the same established routine are none. Ordinary evidence cannot unlock/cross the 25 milestone.
meaningful: clearly new evidence with noticeable emotional weight. Maximum raw weight 2 per supported axis, at most two axes. This is the minimum tier that can unlock/cross 25.
major: an important turning point with lasting consequences such as serious betrayal, costly rescue, explicit romantic advance/rejection, major reconciliation, or deep personal revelation. Maximum raw weight 5 per supported axis, at most three axes.
extreme: a rare relationship-defining event such as catastrophic betrayal, self-sacrifice, irreversible loss, or explicit decisive commitment. Maximum raw weight 10 per supported axis. Extreme is still raw evidence before score resistance, so a near-extreme relationship does not automatically jump ten visible points.`'''
core = core[:m.start()] + f"export const DEFAULT_RELATIONSHIP_CRITERIA = {new_rel};\nexport const DEFAULT_IMPACT_CRITERIA = {new_impact};" + core[m.end():]
legacy = f'''
const LEGACY_V0221_RELATIONSHIP_CRITERIA = {old_rel};
const LEGACY_V0221_IMPACT_CRITERIA = {old_impact};

export function isLegacyStockRelationshipCriteriaV0221(value) {{
    return String(value ?? '').trim() === String(LEGACY_V0221_RELATIONSHIP_CRITERIA).trim();
}}

export function isLegacyStockImpactCriteriaV0221(value) {{
    return String(value ?? '').trim() === String(LEGACY_V0221_IMPACT_CRITERIA).trim();
}}

'''
core = replace_once(core, 'const LEGACY_V028_RELATIONSHIP_CAPS = Object.freeze({ ordinary: 4, meaningful: 8, major: 15, extreme: 25 });', legacy + 'const LEGACY_V028_RELATIONSHIP_CAPS = Object.freeze({ ordinary: 4, meaningful: 8, major: 15, extreme: 25 });', 'legacy stock insertion')

# Non-desire axes no longer require magic cue vocabulary. Desire still requires explicit
# attraction/intimacy language in both evidence and source narration.
evidence_pattern = r"export function relationshipAxisEvidenceGrounded\(key, evidence, context = ''\) \{[\s\S]*?\n\}\n\nfunction relationshipEvidenceValidForDelta\(delta, evidence, context = ''\) \{[\s\S]*?\n\}"
evidence_repl = r'''export function relationshipAxisEvidenceGrounded(key, evidence, context = '') {
    if (!RELATIONSHIP_KEYS.includes(key)) return false;
    const explanation = cleanText(evidence, 300);
    if (!explanation) return false;
    const source = String(context || '').trim();
    if (key === 'desire') {
        if (!RELATIONSHIP_AXIS_CUES.desire.test(explanation)) return false;
        if (!source) return true;
        return RELATIONSHIP_AXIS_CUES.desire.test(source) && relationshipChangeReasonGrounded(explanation, source);
    }
    return true;
}

export function filterRelationshipDeltaByEvidence(delta, evidence, context = '') {
    const normalized = normalizeRelationshipDelta(delta);
    const proof = normalizeRelationshipEvidence(evidence);
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => [
        key,
        normalized[key] !== 0 && relationshipAxisEvidenceGrounded(key, proof[key], context) ? normalized[key] : 0,
    ]));
}

function relationshipEvidenceValidForDelta(delta, evidence, context = '') {
    const normalized = normalizeRelationshipDelta(delta);
    const filtered = filterRelationshipDeltaByEvidence(normalized, evidence, context);
    return RELATIONSHIP_KEYS.every(key => normalized[key] === filtered[key]);
}'''
core = regex_once(core, evidence_pattern, evidence_repl, 'evidence firewall')

old_apply = '''        const validAxisEvidence = !proposedHasDelta || relationshipEvidenceValidForDelta(
            normalizeRelationshipDelta(proposedRelationshipDelta),
            proposedEvidence,
            lifecycleOptions.developmentContext,
        );
        if (proposedHasDelta && (!relationshipChangeReasonGrounded(incoming.relationshipChangeReason, lifecycleOptions.developmentContext) || !validAxisEvidence || duplicateAward)) {
            proposedRelationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
            proposedRelationshipImpact = 'none';
        }
'''
new_apply = '''        const reasonGrounded = !proposedHasDelta || relationshipChangeReasonGrounded(incoming.relationshipChangeReason, lifecycleOptions.developmentContext);
        if (proposedHasDelta && (!reasonGrounded || duplicateAward)) {
            proposedRelationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
            proposedRelationshipImpact = 'none';
        } else if (proposedHasDelta) {
            proposedRelationshipDelta = filterRelationshipDeltaByEvidence(
                proposedRelationshipDelta,
                proposedEvidence,
                lifecycleOptions.developmentContext,
            );
            if (!RELATIONSHIP_KEYS.some(key => Number(proposedRelationshipDelta[key] || 0) !== 0)) proposedRelationshipImpact = 'none';
        }
'''
core = replace_once(core, old_apply, new_apply, 'partial-axis relationship filtering')

# Pure full-window scrubber. Rolling-history numeric relationship fields are non-idempotent for
# every row, including a brand-new NPC; existing rows are repaired before merge, new rows after IDs exist.
prepare_helper = r'''
function rawRelationshipPayloadMatchesNpc(raw, npc) {
    if (!raw || !npc) return false;
    if (raw.id && String(raw.id) === String(npc.id)) return true;
    if (raw.name && npcMatchesLabel(npc, raw.name)) return true;
    return Array.isArray(raw.aliases) && raw.aliases.some(alias => npcMatchesLabel(npc, alias));
}

function stripRollingRelationshipFields(raw, { explicitZero = false } = {}) {
    if (!raw || typeof raw !== 'object') return raw;
    delete raw.relationship;
    delete raw.relationship_delta;
    delete raw.relationshipDelta;
    delete raw.relationshipImpact;
    delete raw.relationship_impact;
    delete raw.relationshipChangeReason;
    delete raw.relationship_change_reason;
    delete raw.relationshipEvidence;
    delete raw.relationship_evidence;
    if (explicitZero) {
        raw.relationshipImpact = 'none';
        raw.relationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
        raw.relationshipEvidence = { trust: '', affection: '', desire: '', tension: '' };
        raw.relationshipChangeReason = '';
    }
    return raw;
}

export function prepareFullWindowRelationshipPayload(parsed, existingNpcs = []) {
    const evaluation = structuredClone(parsed || { npcs: [] });
    const mergeSafe = structuredClone(parsed || { npcs: [] });
    const existing = Array.isArray(existingNpcs) ? existingNpcs : [];
    const count = Math.max(evaluation.npcs?.length || 0, mergeSafe.npcs?.length || 0);
    for (let i = 0; i < count; i += 1) {
        const evalRaw = evaluation.npcs?.[i];
        const safeRaw = mergeSafe.npcs?.[i];
        const reference = safeRaw || evalRaw;
        existing.find(npc => rawRelationshipPayloadMatchesNpc(reference, npc));
        if (evalRaw) stripRollingRelationshipFields(evalRaw, { explicitZero: false });
        if (safeRaw) stripRollingRelationshipFields(safeRaw, { explicitZero: true });
    }
    return { evaluation, mergeSafe };
}
'''
core = replace_once(core, '\nexport function buildRelationshipPassPrompt({', prepare_helper + '\nexport function buildRelationshipPassPrompt({', 'full-window helper insertion')
write('core-v0218.js', core)

# Index imports + settings migration.
index = replace_once(index, '    isLegacyStockBehaviorCriteriaV029,\n', '    isLegacyStockBehaviorCriteriaV029,\n    isLegacyStockRelationshipCriteriaV0221,\n    isLegacyStockImpactCriteriaV0221,\n', 'stock helper imports')
index = replace_once(index, '    relationshipAxisEvidenceGrounded,\n', '    relationshipAxisEvidenceGrounded,\n    filterRelationshipDeltaByEvidence,\n    prepareFullWindowRelationshipPayload,\n', 'relationship helper imports')
normalization_anchor = "    assign('relationshipBaseline', normalizeRelationshipBaseline(settings.relationshipBaseline), sameJson);"
migration = '''    if (previousSchema < 28) {
        // v0.2.22 restores low-band mundane progression only for untouched stock rubrics.
        if (isLegacyStockRelationshipCriteriaV0221(settings.relationshipCriteria)) assign('relationshipCriteria', DEFAULT_RELATIONSHIP_CRITERIA);
        if (isLegacyStockImpactCriteriaV0221(settings.relationshipImpactCriteria)) assign('relationshipImpactCriteria', DEFAULT_IMPACT_CRITERIA);
    }
'''
index = replace_once(index, normalization_anchor, migration + normalization_anchor, 'schema 28 rubric migration')

prepare_pattern = r"function prepareFullWindowRelationshipEvaluation\(parsed, existingNpcs\) \{[\s\S]*?\n\}\n\nfunction suppressPrimaryRelationshipForFocusedDecisions"
index = regex_once(index, prepare_pattern, "function prepareFullWindowRelationshipEvaluation(parsed, existingNpcs) {\n    return prepareFullWindowRelationshipPayload(parsed, existingNpcs);\n}\n\nfunction suppressPrimaryRelationshipForFocusedDecisions", 'index full-window delegate')

focused_old = '''            const normalized = normalizeScanNpc(rawDecision);
            const hasNonZeroNormalizedDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);
            if (hasNonZeroNormalizedDelta && !relationshipChangeReasonGrounded(normalized.relationshipChangeReason, transcript)) continue;
            if (hasNonZeroNormalizedDelta && !Object.entries(normalized.relationshipDelta).every(([key, value]) => value === 0 || relationshipAxisEvidenceGrounded(key, normalized.relationshipEvidence?.[key], transcript))) continue;
            const rawSummary = rawDecision.relationshipSummary ?? rawDecision.relationship_summary;
'''
focused_new = '''            const normalized = normalizeScanNpc(rawDecision);
            const requestedHasDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);
            const relationshipDelta = requestedHasDelta && relationshipChangeReasonGrounded(normalized.relationshipChangeReason, transcript)
                ? filterRelationshipDeltaByEvidence(normalized.relationshipDelta, normalized.relationshipEvidence, transcript)
                : { trust: 0, affection: 0, desire: 0, tension: 0 };
            const hasNonZeroNormalizedDelta = Object.values(relationshipDelta).some(value => value !== 0);
            const relationshipImpact = hasNonZeroNormalizedDelta ? normalized.relationshipImpact : 'none';
            const rawSummary = rawDecision.relationshipSummary ?? rawDecision.relationship_summary;
'''
index = replace_once(index, focused_old, focused_new, 'focused partial-axis sanitizer')
index = replace_once(index, "            const hasNonZeroDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);", "            const hasNonZeroDelta = Object.values(relationshipDelta).some(value => value !== 0);", 'focused nonzero calculation')
index = replace_once(index, "            const needsTurningPointSummary = hasNonZeroDelta && ['major', 'extreme'].includes(normalized.relationshipImpact);", "            const needsTurningPointSummary = hasNonZeroDelta && ['major', 'extreme'].includes(relationshipImpact);", 'focused summary tier')
index = replace_once(index, "                relationshipDelta: normalized.relationshipDelta,\n                relationshipImpact: normalized.relationshipImpact,", "                relationshipDelta,\n                relationshipImpact,", 'focused decision output')

# Add a post-merge focused current-exchange pass for IDs created/promoted by a rolling full scan.
merge_marker = "        if (lastScanMetrics) {\n            lastScanMetrics.profileApplied = Number(merged.report?.profileUpdateStats?.applied || 0);"
new_rel_block = '''        const newlyAdmittedIds = [...new Set([...(merged.report?.created || []), ...(merged.report?.promoted || [])])];
        let newNpcRelationshipPass = { decisions: new Map(), used: false, targetCount: 0, responseChars: 0, retried: false };
        if (fullWindowScan && newlyAdmittedIds.length) {
            const newTargets = merged.state.npcs.filter(npc => newlyAdmittedIds.includes(npc.id) && !npc.archived);
            if (newTargets.length) {
                newNpcRelationshipPass = await runFocusedRelationshipPass(
                    ctx,
                    fullWindowRelationship.evaluation,
                    newTargets,
                    currentTranscript || transcript,
                    settings,
                );
                applyFocusedRelationshipDecisions(merged.state, newNpcRelationshipPass.decisions, settings.relationshipCaps, targetMessageId, merged.report);
                if (lastScanMetrics) {
                    lastScanMetrics.newNpcRelationshipTargets = Number(newNpcRelationshipPass.targetCount || 0);
                    lastScanMetrics.newNpcRelationshipResponseChars = Number(newNpcRelationshipPass.responseChars || 0);
                }
            }
        }
'''
index = replace_once(index, merge_marker, new_rel_block + merge_marker, 'new NPC relationship pass')

metrics_marker = "            relationshipRetried: relationshipPass.retried,\n            relationshipEdges: relationshipEdgeCount,"
index = replace_once(index, metrics_marker, "            relationshipRetried: relationshipPass.retried,\n            newNpcRelationshipTargets: 0,\n            newNpcRelationshipResponseChars: 0,\n            relationshipEdges: relationshipEdgeCount,", 'new NPC relationship metrics')

# Newly admitted automatic dossiers enter the existing retrying targeted-backfill queue.
next_state_marker = '''        const nextState = {
            ...merged.state,
            assistantSinceScan: 0,
            lastScanAt: Date.now(),
            lastScannedMessageId: Number.isInteger(messageId) ? messageId : ((ctx.chat || []).length - 1),
            scanCount: Number(state.scanCount || 0) + 1,
        };
'''
queue_block = next_state_marker + '''        if (!manual && newlyAdmittedIds.length) {
            for (const id of newlyAdmittedIds) {
                const npc = nextState.npcs.find(item => item.id === id && !item.archived);
                if (npc) queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId);
            }
        }
'''
index = replace_once(index, next_state_marker, queue_block, 'automatic enrichment queue')
write('index.js', index)

# Tests/version fixtures.
package_test = replace_once(read('tests/package.test.js'), "assert.equal(manifest.version, '0.2.21');", "assert.equal(manifest.version, '0.2.22');", 'package version test')
write('tests/package.test.js', package_test)
migration_test = read('tests/migration-smoke.mjs')
migration_test = migration_test.replace('schemaVersion, 27', 'schemaVersion, 28').replace('schemaVersion === 27', 'schemaVersion === 28').replace('schemaVersion,27', 'schemaVersion,28')
write('tests/migration-smoke.mjs', migration_test)

runtime = read('tests/runtime-smoke.mjs')
marker = "    // Non-truncation structural JSON errors also get one clean correction retry. Local separator\n"
regression = r'''    // v0.2.22: a new NPC admitted by automatic full-window scanning must be enriched
    // automatically, while its numeric relationship is scored from CURRENT exchange only.
    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Earlier, Mira returned Kazuma\'s dropped purse untouched after finding it on the guild floor.' });
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'I invite Mira to share a bowl of stew with me and thank her for staying.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Mira accepts and stays to eat with Kazuma, lingering through an easy conversation before the bowls are cleared.' });
    const miraMessageId = mockState.context.chat.length - 1;
    let miraFullScanCalls = 0;
    let miraRelationshipCalls = 0;
    let miraBackfillCalls = 0;
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/private NPC dossier scanner/i.test(prompt) && /Mira/i.test(prompt)) {
            miraFullScanCalls += 1;
            return JSON.stringify({ npcs: [{
                name: 'Mira', identityKind: 'proper_name', dossierSignal: 'meaningful', present: true, role: 'Guild porter',
                relationshipImpact: 'major', relationshipDelta: { trust: 5, affection: 0, desire: 0, tension: 0 },
                relationshipEvidence: { trust: 'Earlier she returned his purse untouched.', affection: '', desire: '', tension: '' },
                relationshipChangeReason: 'Earlier Mira returned Kazuma\'s dropped purse untouched.',
            }] });
        }
        if (/focused relationship evaluator/i.test(prompt) && /Mira/i.test(prompt)) {
            miraRelationshipCalls += 1;
            assert.match(prompt, /LOW-BAND FAMILIARITY|below 25/i);
            const id = globalThis.NPCState.getState().npcs.find(n => n.name === 'Mira')?.id;
            return JSON.stringify({ npcs: [{
                id, name: 'Mira', relationshipImpact: 'ordinary',
                relationshipDelta: { trust: 0, affection: 1, desire: 0, tension: 0 },
                relationshipEvidence: { trust: '', affection: 'Mira accepts and stays to eat with Kazuma.', desire: '', tension: '' },
                relationshipSummary: 'Mira is beginning to enjoy Kazuma\'s company.',
                relationshipChangeReason: 'Mira accepts and stays to eat with Kazuma.',
            }] });
        }
        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Mira/i.test(prompt)) {
            miraBackfillCalls += 1;
            return JSON.stringify({ npcs: [{
                name: 'Mira', identityKind: 'proper_name', dossierSignal: 'meaningful', role: 'Guild porter',
                personality: 'Patient, observant, and quietly considerate.',
                speech: 'Brief, practical sentences with dry warmth.',
                background: 'Works around the guild floor handling loads and errands.',
                memories: [
                    'Returned Kazuma\'s dropped purse untouched.',
                    'Shared stew with Kazuma after he invited her to stay.',
                    'Helped sort a jammed delivery cart at the guild entrance.',
                ],
                memoryRetention: [
                    'Returned Kazuma\'s dropped purse untouched.',
                    'Shared stew with Kazuma after he invited her to stay.',
                    'Helped sort a jammed delivery cart at the guild entrance.',
                    'Warned Kazuma that the north stair was slick after rain.',
                    'Remembered Kazuma\'s preferred table near the hearth.',
                ],
                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        return '{"npcs":[]}';
    };
    eventSource.emit('message_received', miraMessageId);
    await sleep(320);
    state = globalThis.NPCState.getState();
    const mira = state.npcs.find(n => n.name === 'Mira');
    assert.ok(mira, 'automatic full-window scan should admit Mira');
    assert.equal(miraFullScanCalls, 1);
    assert.equal(miraRelationshipCalls, 1, 'new full-window NPC should get one current-exchange relationship pass');
    assert.equal(miraBackfillCalls, 1, 'new automatic dossier should get one targeted history backfill');
    assert.equal(mira.relationship.trust, 0, 'rolling-history trust must not replay into the new record');
    assert.equal(mira.relationship.affection, 1, 'fresh mundane low-band companionship should move affection');
    assert.equal(mira.memories.length, 5, 'automatic enrichment should curate the full retained memory set');
    assert.match(mira.personality, /Patient/i);
    assert.equal(state.pendingBackfills.some(item => item.npcId === mira.id), false);
    mockState.extensionSettings.npc_state.fullScanEveryTurn = false;

'''
runtime = replace_once(runtime, marker, regression + marker, 'runtime enrichment regression')
write('tests/runtime-smoke.mjs', runtime)

write('tests/hardening-v0222.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    DEFAULT_IMPACT_CRITERIA,
    DEFAULT_RELATIONSHIP_CRITERIA,
    applyRelationshipDelta,
    filterRelationshipDeltaByEvidence,
    prepareFullWindowRelationshipPayload,
    relationshipAxisEvidenceGrounded,
} from '../core.js';

test('v0.2.22 stock policy allows fresh mundane low-band progression', () => {
    assert.match(DEFAULT_RELATIONSHIP_CRITERIA, /LOW-BAND FAMILIARITY/i);
    assert.match(DEFAULT_IMPACT_CRITERIA, /below 25/i);
    const start = applyRelationshipDelta({ trust: 0, affection: 0, desire: 0, tension: 0 }, { trust: 0, affection: 1, desire: 0, tension: 0 }, 'ordinary');
    assert.equal(start.relationship.affection, 1);
    const locked = applyRelationshipDelta({ trust: 24, affection: 0, desire: 0, tension: 0 }, { trust: 1, affection: 0, desire: 0, tension: 0 }, 'ordinary');
    assert.equal(locked.relationship.trust, 24);
    assert.equal(locked.milestoneBlocks.some(item => item.axis === 'trust' && item.threshold === 25), true);
});

test('non-desire evidence does not require axis cue words', () => {
    assert.equal(relationshipAxisEvidenceGrounded('affection', 'Mira accepts and stays to eat with Kazuma.', 'Mira accepts and stays to eat with Kazuma.'), true);
    assert.equal(relationshipAxisEvidenceGrounded('trust', 'She hands him the storeroom key before leaving.', 'She hands him the storeroom key before leaving.'), true);
});

test('Desire retains strict attraction/intimacy grounding', () => {
    assert.equal(relationshipAxisEvidenceGrounded('desire', 'She enjoys eating supper with him.', 'She enjoys eating supper with him.'), false);
    assert.equal(relationshipAxisEvidenceGrounded('desire', 'She kisses him because she is attracted to him.', 'She kisses him, openly attracted to him.'), true);
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
    assert.match(source, /queueNpcBackfillInState\(nextState, npc\.id, npc\.name, targetMessageId\)/);
    assert.match(source, /newNpcRelationshipPass = await runFocusedRelationshipPass/);
    assert.match(source, /prepareFullWindowRelationshipPayload/);
    assert.match(source, /schemaVersion: 28/);
});
''')

changelog = read('CHANGELOG.md')
entry = '''## 0.2.22

- Automatically queues the existing targeted history backfill whenever automatic scanning creates or promotes a dossier, so first-pass memories/profile data no longer depend on a manual Refresh.
- Scrubs numeric relationship fields from every rolling full-window result, including brand-new NPCs, then evaluates newly admitted NPCs from the current exchange only.
- Restores low-band mundane relationship progression: fresh directional interactions can move one axis by +/-1 below 25, while the existing 25 milestone still requires meaningful evidence.
- Removes magic-word requirements for Trust/Affection/Tension evidence while keeping Desire's strict attraction/intimacy firewall.
- Preserves valid relationship axes when a different proposed axis fails validation instead of zeroing the entire event.
- Advances settings schema to 28 and migrates only untouched v0.2.21 stock relationship rubrics; user customizations remain authoritative.
- Adds executable runtime coverage for automatic new-NPC enrichment, five retained memories, current-only relationship scoring, low-band progression, and mixed-axis validation.

'''
changelog = replace_once(changelog, '# Changelog\n\n', '# Changelog\n\n' + entry, 'changelog')
write('CHANGELOG.md', changelog)

print('v0.2.22 patch applied')
