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

index = read('index.js')

# Hard-pass 4: the post-admission focused relationship call is asynchronous and occurs after the
# broad scan's first stale-result guard. Revalidate chat identity, lineage and dossier version
# before allowing the newly merged state to continue toward persistence.
anchor = '''        if (fullWindowScan && newlyAdmittedIds.length) {
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
replacement = anchor + '''        currentLineage = chatLineage(getContext().chat || []);
        if (!scanOperationCurrent(scanChatKey, operation)
            || getChatKey() !== scanChatKey
            || firstLineageDivergence(scanLineage, currentLineage) !== -1
            || Number(stateVersions.get(scanChatKey) || 0) !== scanStateVersion) {
            console.info('[NPC State] discarded stale dossier scan after new-NPC relationship evaluation.');
            if (manual) globalThis.toastr?.info?.('NPC State: chat changed during scan; stale result was discarded.');
            return;
        }
'''
index = replace_once(index, anchor, replacement, 'post-admission stale guard')

# The pure full-window scrubber no longer needs the old existing-NPC matcher because every row is
# intentionally scrubbed. Remove dead matching work so the safety rule is explicit rather than
# looking conditional when it is not.
index = index.replace('    relationshipAxisEvidenceGrounded,\n', '    relationshipAxisEvidenceGrounded,\n')
write('index.js', index)

core = read('core-v0218.js')
core = core.replace('''function rawRelationshipPayloadMatchesNpc(raw, npc) {
    if (!raw || !npc) return false;
    if (raw.id && String(raw.id) === String(npc.id)) return true;
    if (raw.name && npcMatchesLabel(npc, raw.name)) return true;
    return Array.isArray(raw.aliases) && raw.aliases.some(alias => npcMatchesLabel(npc, alias));
}

''', '')
core = core.replace("    const existing = Array.isArray(existingNpcs) ? existingNpcs : [];\n", '')
core = core.replace("        const reference = safeRaw || evalRaw;\n        existing.find(npc => rawRelationshipPayloadMatchesNpc(reference, npc));\n", '')
write('core-v0218.js', core)

# Runtime fixture: earlier smoke intentionally installs custom relationship settings. The new
# integration case tests plumbing, not stock-rubric migration, so temporarily neutralize only the
# baseline and assert CURRENT-exchange content instead of demanding the stock rubric text.
runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
    "    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;\n",
    "    const savedMiraFullScan = mockState.extensionSettings.npc_state.fullScanEveryTurn;\n    const savedMiraBaseline = structuredClone(mockState.extensionSettings.npc_state.relationshipBaseline);\n    mockState.extensionSettings.npc_state.relationshipBaseline = { trust: 0, affection: 0, desire: 0, tension: 0 };\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;\n",
    'runtime Mira settings snapshot')
runtime = replace_once(runtime,
    "            assert.match(prompt, /LOW-BAND FAMILIARITY|below 25/i);\n",
    "            assert.match(prompt, /Mira accepts and stays to eat with Kazuma/i, 'focused evaluator must receive the current exchange');\n",
    'runtime focused prompt assertion')
runtime = replace_once(runtime,
    "    mockState.extensionSettings.npc_state.fullScanEveryTurn = false;\n",
    "    mockState.extensionSettings.npc_state.relationshipBaseline = savedMiraBaseline;\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = savedMiraFullScan;\n",
    'runtime Mira settings restore')
write('tests/runtime-smoke.mjs', runtime)

# Static regression makes the second stale guard part of the release contract.
test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.match(source, /preserveLiveState: item\\?\\.preserveLiveState === true/);\n",
    "    assert.match(source, /preserveLiveState: item\\?\\.preserveLiveState === true/);\n    assert.match(source, /discarded stale dossier scan after new-NPC relationship evaluation/);\n",
    'post-admission stale guard test')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 4 fixes applied')
