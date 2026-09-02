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
write('index.js', index)

core = read('core-v0218.js')
old_helper = '''function rawRelationshipPayloadMatchesNpc(raw, npc) {
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
new_helper = '''function stripRollingRelationshipFields(raw, { explicitZero = false } = {}) {
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
    void existingNpcs; // retained API parameter for compatibility; every rolling row is scrubbed.
    const evaluation = structuredClone(parsed || { npcs: [] });
    const mergeSafe = structuredClone(parsed || { npcs: [] });
    const count = Math.max(evaluation.npcs?.length || 0, mergeSafe.npcs?.length || 0);
    for (let i = 0; i < count; i += 1) {
        const evalRaw = evaluation.npcs?.[i];
        const safeRaw = mergeSafe.npcs?.[i];
        if (evalRaw) stripRollingRelationshipFields(evalRaw, { explicitZero: false });
        if (safeRaw) stripRollingRelationshipFields(safeRaw, { explicitZero: true });
    }
    return { evaluation, mergeSafe };
}
'''
core = replace_once(core, old_helper, new_helper, 'full-window scrubber cleanup')
write('core-v0218.js', core)

runtime = read('tests/runtime-smoke.mjs')
section_marker = "    // v0.2.22: a new NPC admitted by automatic full-window scanning must be enriched\n"
if runtime.count(section_marker) != 1:
    raise SystemExit(f'runtime v0.2.22 section marker: expected one match, found {runtime.count(section_marker)}')
prefix, section = runtime.split(section_marker, 1)
section = replace_once(section,
    "    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;\n",
    "    const savedMiraFullScan = mockState.extensionSettings.npc_state.fullScanEveryTurn;\n    const savedMiraBaseline = structuredClone(mockState.extensionSettings.npc_state.relationshipBaseline);\n    mockState.extensionSettings.npc_state.relationshipBaseline = { trust: 0, affection: 0, desire: 0, tension: 0 };\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;\n",
    'runtime Mira settings snapshot')
section = replace_once(section,
    "            assert.match(prompt, /LOW-BAND FAMILIARITY|below 25/i);\n",
    "            assert.match(prompt, /Mira accepts and stays to eat with Kazuma/i, 'focused evaluator must receive the current exchange');\n",
    'runtime focused prompt assertion')
section = replace_once(section,
    "    mockState.extensionSettings.npc_state.fullScanEveryTurn = false;\n",
    "    mockState.extensionSettings.npc_state.relationshipBaseline = savedMiraBaseline;\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = savedMiraFullScan;\n",
    'runtime Mira settings restore')
runtime = prefix + section_marker + section
write('tests/runtime-smoke.mjs', runtime)

test = read('tests/hardening-v0222.test.js')
test = replace_once(test,
    "    assert.match(source, /preserveLiveState: item\\?\\.preserveLiveState === true/);\n",
    "    assert.match(source, /preserveLiveState: item\\?\\.preserveLiveState === true/);\n    assert.match(source, /discarded stale dossier scan after new-NPC relationship evaluation/);\n",
    'post-admission stale guard test')
write('tests/hardening-v0222.test.js', test)

print('v0.2.22 hard-pass 4 fixes applied')
