from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
path = Path(__file__).with_name('patch_v022_fixed.py')
text = path.read_text(encoding='utf-8')
old = "changelog = replace_once(changelog, '# Changelog\\n\\n', '# Changelog\\n\\n' + entry, 'changelog')"
new = "changelog = changelog.replace('# Changelog\\n\\n', '# Changelog\\n\\n' + entry, 1)"
if old not in text:
    raise SystemExit('v0.2.22 runner could not locate changelog insertion guard')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
runpy.run_path(str(path), run_name='__main__')


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def write(rel, value):
    (ROOT / rel).write_text(value, encoding='utf-8')


def replace_once(value, old_value, new_value, label):
    count = value.count(old_value)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return value.replace(old_value, new_value, 1)

# Hard-pass 1: the 25 milestone is a boundary. Ordinary evidence may reach 25 from 24,
# but cannot deepen beyond 25 until a meaningful event unlocks that direction.
core = read('core-v0218.js')
core = core.replace('Ordinary evidence cannot unlock/cross the 25 milestone; deeper bonds require meaningful evidence.', 'Ordinary evidence may reach 25, but cannot deepen beyond that boundary until a meaningful event unlocks the milestone.')
core = core.replace('Ordinary evidence cannot unlock/cross the 25 milestone.', 'Ordinary evidence may reach 25, but cannot deepen beyond it until the milestone is unlocked by meaningful evidence.')
# Desire remains strict on both the axis explanation and narration, but exact paraphrase overlap
# is unnecessary because the overall event reason is grounded separately.
core = replace_once(core,
    "        return RELATIONSHIP_AXIS_CUES.desire.test(source) && relationshipChangeReasonGrounded(explanation, source);",
    "        return RELATIONSHIP_AXIS_CUES.desire.test(source);",
    'Desire cue firewall')
write('core-v0218.js', core)

# Keep old release metadata assertion current.
vtest = read('tests/v0214-hardening.test.js')
vtest = vtest.replace("release metadata is v0.2.21", "release metadata is v0.2.22")
vtest = vtest.replace("NPC_STATE_VERSION = '0\\.2\\.21'", "NPC_STATE_VERSION = '0\\.2\\.22'")
vtest = vtest.replace("manifest.version, '0.2.21'", "manifest.version, '0.2.22'")
write('tests/v0214-hardening.test.js', vtest)

# Update the new milestone test to assert the real boundary contract.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.equal(locked.relationship.trust, 24);\n    assert.equal(locked.milestoneBlocks.some(item => item.axis === 'trust' && item.threshold === 25), true);",
    "    assert.equal(locked.relationship.trust, 25, 'ordinary low-band evidence may reach the first milestone boundary');\n    const beyond = applyRelationshipDelta(locked.relationship, { trust: 1, affection: 0, desire: 0, tension: 0 }, 'ordinary', undefined, locked.relationshipProgress, locked.relationshipMilestones);\n    assert.equal(beyond.relationship.trust, 25, 'ordinary evidence cannot deepen beyond the locked 25 boundary');\n    assert.equal(beyond.milestoneBlocks.some(item => item.axis === 'trust' && item.threshold === 25), true);",
    'milestone boundary regression')
write('tests/hardening-v0222.test.js', test)

index = read('index.js')
# Preserve the just-scanned live state while the queued historical backfill enriches durable fields.
index = replace_once(index,
    "        requestedMessageId: Number.isInteger(item?.requestedMessageId) ? item.requestedMessageId : null,\n        requestedAt: Number(item?.requestedAt || 0) || Date.now(),",
    "        requestedMessageId: Number.isInteger(item?.requestedMessageId) ? item.requestedMessageId : null,\n        preserveLiveState: item?.preserveLiveState === true,\n        requestedAt: Number(item?.requestedAt || 0) || Date.now(),",
    'pending backfill live-state normalization')
index = replace_once(index,
    "function queueNpcBackfillInState(state, npcId, label, requestedMessageId = null) {",
    "function queueNpcBackfillInState(state, npcId, label, requestedMessageId = null, options = {}) {",
    'backfill queue options signature')
index = replace_once(index,
    "        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,\n        requestedAt: Date.now(),",
    "        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,\n        preserveLiveState: options?.preserveLiveState === true,\n        requestedAt: Date.now(),",
    'backfill queue live-state flag')
index = replace_once(index,
    "        parsed.npcs = matches\n            .slice(0, 1)\n            .map(npc => ({\n                ...npc,\n                id: request.npcId,",
    "        const liveBeforeBackfill = request.preserveLiveState === true\n            ? getChatState(chatKey).npcs.find(item => item.id === request.npcId)\n            : null;\n        parsed.npcs = matches\n            .slice(0, 1)\n            .map(npc => ({\n                ...npc,\n                id: request.npcId,\n                ...(liveBeforeBackfill ? {\n                    present: Boolean(liveBeforeBackfill.present),\n                    worldActive: Boolean(liveBeforeBackfill.worldActive) && !Boolean(liveBeforeBackfill.present),\n                    mood: liveBeforeBackfill.mood || npc.mood || '',\n                    location: liveBeforeBackfill.location || npc.location || '',\n                    goal: liveBeforeBackfill.goal || npc.goal || '',\n                    status: liveBeforeBackfill.status || npc.status || '',\n                } : {}),",
    'automatic backfill live-state preservation')
index = replace_once(index,
    "                if (npc) queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId);",
    "                if (npc) queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId, { preserveLiveState: true });",
    'automatic enrichment live-state queue flag')

# The focused evaluator is capped at four targets per call. Batch newly admitted NPCs so a scene
# with five or more new dossiers does not silently leave later NPCs without current-only scoring.
old_block = '''        if (fullWindowScan && newlyAdmittedIds.length) {
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
new_block = '''        if (fullWindowScan && newlyAdmittedIds.length) {
            const newTargets = merged.state.npcs.filter(npc => newlyAdmittedIds.includes(npc.id) && !npc.archived);
            if (newTargets.length) {
                const combinedDecisions = new Map();
                let combinedTargetCount = 0;
                let combinedResponseChars = 0;
                let combinedRetried = false;
                for (let offset = 0; offset < newTargets.length; offset += 4) {
                    const batch = newTargets.slice(offset, offset + 4);
                    const result = await runFocusedRelationshipPass(
                        ctx,
                        fullWindowRelationship.evaluation,
                        batch,
                        currentTranscript || transcript,
                        settings,
                    );
                    for (const [id, decision] of result.decisions || []) combinedDecisions.set(id, decision);
                    combinedTargetCount += Number(result.targetCount || 0);
                    combinedResponseChars += Number(result.responseChars || 0);
                    combinedRetried ||= Boolean(result.retried);
                }
                newNpcRelationshipPass = {
                    decisions: combinedDecisions,
                    used: combinedTargetCount > 0,
                    targetCount: combinedTargetCount,
                    responseChars: combinedResponseChars,
                    retried: combinedRetried,
                };
                applyFocusedRelationshipDecisions(merged.state, combinedDecisions, settings.relationshipCaps, targetMessageId, merged.report);
                if (lastScanMetrics) {
                    lastScanMetrics.newNpcRelationshipTargets = combinedTargetCount;
                    lastScanMetrics.newNpcRelationshipResponseChars = combinedResponseChars;
                }
            }
        }
'''
index = replace_once(index, old_block, new_block, 'new NPC relationship batching')
write('index.js', index)

# Strengthen runtime/static regressions for the hard-pass findings.
runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
    "    assert.match(mira.personality, /Patient/i);\n    assert.equal(state.pendingBackfills.some(item => item.npcId === mira.id), false);",
    "    assert.match(mira.personality, /Patient/i);\n    assert.equal(mira.present, true, 'automatic historical enrichment must not erase the live presence established by the full scan');\n    assert.equal(state.pendingBackfills.some(item => item.npcId === mira.id), false);",
    'runtime live-state enrichment assertion')
write('tests/runtime-smoke.mjs', runtime)

test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.match(source, /queueNpcBackfillInState\\(nextState, npc\\.id, npc\\.name, targetMessageId\\)/);",
    "    assert.match(source, /queueNpcBackfillInState\\(nextState, npc\\.id, npc\\.name, targetMessageId, \\{ preserveLiveState: true \\}\\)/);",
    'static auto backfill live-state assertion')
test = replace_once(test,
    "    assert.match(source, /newNpcRelationshipPass = await runFocusedRelationshipPass/);",
    "    assert.match(source, /for \\(let offset = 0; offset < newTargets\\.length; offset \\+= 4\\)/);\n    assert.match(source, /preserveLiveState: item\\?\\.preserveLiveState === true/);",
    'static relationship batching assertion')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 1 fixes applied')
