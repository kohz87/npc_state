import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord } from '../core.js';
import {
    BRANCH_LINEAGE_VERSION,
    addUserDismissedGroup,
    bestAncestorState,
    clearUserDismissedGroupsFor,
    chatLineage,
    fingerprintMessage,
    firstLineageDivergence,
    lineageCheckpointKey,
    lineageCheckpointKeys,
    ensureBranchParentAnchor,
    migrateLegacyBranchState,
    normalizeBranchCheckpoints,
    pruneBranchCheckpoints,
    recordBranchCheckpoint,
    reconcileBranchState,
    snapshotBranchState,
} from '../branch.js';
import { normalizeSocialGraph } from '../social.js';

function user(text, name = 'Kazuma') {
    return { is_user: true, is_system: false, name, mes: text };
}
function assistant(text, swipe = 0, name = 'Megumin') {
    return { is_user: false, is_system: false, name, mes: text, swipe_id: swipe };
}

function baseState() {
    return {
        npcs: [], dismissed: [], inlineCards: [], checkpoints: [], lineage: [],
        branchLineageVersion: BRANCH_LINEAGE_VERSION,
        turn: 0, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null,
        scanCount: 0, processedOocMessageId: null,
    };
}

function legacyFingerprintV0210(message = {}) {
    let hash = 0x811c9dc5;
    const input = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
        swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : null,
    });
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

test('message fingerprint follows narrative content and ignores unstable swipe index numbering', () => {
    const a = assistant('Yunyun enters.', 0);
    const b = assistant('Yunyun leaves.', 0);
    const c = assistant('Yunyun enters.', 1);
    assert.notEqual(fingerprintMessage(a), fingerprintMessage(b));
    assert.equal(fingerprintMessage(a), fingerprintMessage(c), 'identical narrative content remains the same branch when swipe indices renumber');
    assert.equal(firstLineageDivergence(chatLineage([user('Hi'), a]), chatLineage([user('Hi'), c])), -1);
});

test('tail deletion restores the latest surviving checkpoint and removes downstream inline state', () => {
    const chat = [user('(OOC: add Yunyun)'), assistant('Yunyun waves.'), user('(OOC: add Wiz)')];
    const state = baseState();
    const yunyun = createNpcRecord('Yunyun');
    state.npcs = [yunyun];
    state.inlineCards = [{ messageId: 0, fingerprint: fingerprintMessage(chat[0]), cards: [{ id: yunyun.id, name: yunyun.name }] }];
    recordBranchCheckpoint(state, chat, 0, 'ooc');
    state.turn = 1;
    recordBranchCheckpoint(state, chat, 1, 'turn');
    const wiz = createNpcRecord('Wiz', state.npcs.map(n => n.id));
    state.npcs.push(wiz);
    state.inlineCards.push({ messageId: 2, fingerprint: fingerprintMessage(chat[2]), cards: [{ id: wiz.id, name: wiz.name }] });
    recordBranchCheckpoint(state, chat, 2, 'ooc');

    const surviving = chat.slice(0, 2);
    const result = reconcileBranchState(state, surviving);
    assert.equal(result.divergence, 2);
    assert.equal(result.restoredFromMessageId, 1);
    assert.deepEqual(result.state.npcs.map(n => n.name), ['Yunyun']);
    assert.deepEqual(result.state.inlineCards.map(entry => entry.messageId), [0, 2], 'sibling/tail inline snapshots remain stored even when inactive');
    const activeKey = lineageCheckpointKey(chatLineage(surviving), 1);
    assert.ok(result.state.checkpoints.some(item => item.lineageKey === activeKey));
});

test('swiping an assistant message rolls back to the checkpoint before that message', () => {
    const original = [user('(OOC: add Yunyun)'), assistant('Yunyun smiles.', 0), user('Continue'), assistant('Wiz appears.', 0)];
    const state = baseState();
    const yunyun = createNpcRecord('Yunyun');
    state.npcs = [yunyun];
    recordBranchCheckpoint(state, original, 0, 'ooc');
    state.turn = 1;
    yunyun.relationship.trust = 61;
    state.npcs = [yunyun];
    recordBranchCheckpoint(state, original, 1, 'scan');
    const wiz = createNpcRecord('Wiz', [yunyun.id]);
    state.npcs.push(wiz);
    state.turn = 2;
    recordBranchCheckpoint(state, original, 3, 'scan');

    const swiped = structuredClone(original);
    swiped[1] = assistant('Yunyun scowls instead.', 1);
    const result = reconcileBranchState(state, swiped, { explicitDivergence: 1 });
    assert.equal(result.divergence, 1);
    assert.equal(result.restoredFromMessageId, 0);
    assert.deepEqual(result.state.npcs.map(n => n.name), ['Yunyun']);
    assert.equal(result.state.npcs[0].relationship.trust, 0, 'old swipe relationship update must be removed');
    const activeKeys = new Set([lineageCheckpointKey(chatLineage(swiped), 0)]);
    assert.deepEqual(result.state.checkpoints.filter(item => activeKeys.has(item.lineageKey)).map(item => item.messageId), [0]);
    assert.ok(result.state.checkpoints.some(item => item.messageId === 1), 'old sibling checkpoint is retained for exact revisit');
});

test('v0.2.11 revisiting a previously scanned sibling swipe restores its exact snapshot without reconstruction', () => {
    const swipe0 = [user('Choose.'), assistant('Myla smiles and accepts the promise.', 0)];
    const state = baseState();
    const myla = createNpcRecord('Myla');
    state.npcs = [myla];
    ensureBranchParentAnchor(state, swipe0, 1, 'assistant-parent');
    state.npcs[0].relationship.trust = 61;
    state.npcs[0].relationshipProgress.trust = 0.65;
    state.lastScannedMessageId = 1;
    recordBranchCheckpoint(state, swipe0, 1, 'scan');

    const swipe1 = [user('Choose.'), assistant('Myla refuses and walks away.', 1)];
    const firstSwitch = reconcileBranchState(state, swipe1, { explicitDivergence: 1 });
    assert.equal(firstSwitch.exactRestored, false);
    firstSwitch.state.npcs[0].relationship.trust = 12;
    firstSwitch.state.npcs[0].relationshipProgress.trust = -0.4;
    firstSwitch.state.lastScannedMessageId = 1;
    recordBranchCheckpoint(firstSwitch.state, swipe1, 1, 'scan');

    const back = reconcileBranchState(firstSwitch.state, swipe0, { explicitDivergence: 1 });
    assert.equal(back.exactRestored, true);
    assert.equal(back.restoredFromMessageId, 1);
    assert.equal(back.state.npcs[0].relationship.trust, 61);
    assert.equal(back.state.npcs[0].relationshipProgress.trust, 0.65);

    const again = reconcileBranchState(back.state, swipe1, { explicitDivergence: 1 });
    assert.equal(again.exactRestored, true);
    assert.equal(again.state.npcs[0].relationship.trust, 12);
    assert.equal(again.state.npcs[0].relationshipProgress.trust, -0.4);
});

test('v0.2.11 sibling identity survives swipe-index renumbering after an alternate is deleted', () => {
    const original = [user('Choose.'), assistant('Myla nods.', 2)];
    const state = baseState();
    const myla = createNpcRecord('Myla');
    state.npcs = [myla];
    ensureBranchParentAnchor(state, original, 1, 'assistant-parent');
    state.npcs[0].relationship.affection = 44;
    state.lastScannedMessageId = 1;
    recordBranchCheckpoint(state, original, 1, 'scan');

    const renumbered = [user('Choose.'), assistant('Myla nods.', 0)];
    const restored = reconcileBranchState(state, renumbered, { explicitDivergence: 1 });
    assert.equal(restored.exactRestored, true);
    assert.equal(restored.state.npcs[0].relationship.affection, 44);
});

test('v0.2.11 branch restore overlays user-owned portrait/profile metadata without contaminating narrative relationship state', () => {
    const chat = [user('Wait.'), assistant('Myla agrees.', 0)];
    const state = baseState();
    const myla = createNpcRecord('Myla');
    myla.personality = 'Reserved.';
    state.npcs = [myla];
    ensureBranchParentAnchor(state, chat, 1, 'assistant-parent');
    state.npcs[0].relationship.trust = 20;
    recordBranchCheckpoint(state, chat, 1, 'scan');

    state.npcs[0].portraitPromptPositive = 'custom portrait override';
    state.npcs[0].retentionProtected = true;
    state.npcs[0].minor = true;
    state.npcs[0].importance = 77;
    state.npcs[0].personality = 'Reserved and dryly humorous.';
    state.npcs[0].manualProfileFields = ['personality'];
    state.npcs[0].manualProfileLocksExplicit = true;
    state.npcs[0].relationship.trust = 88;

    const sibling = [user('Wait.'), assistant('Myla refuses.', 1)];
    const result = reconcileBranchState(state, sibling, { explicitDivergence: 1 });
    assert.equal(result.state.npcs[0].portraitPromptPositive, 'custom portrait override');
    assert.equal(result.state.npcs[0].retentionProtected, true);
    assert.equal(result.state.npcs[0].minor, true);
    assert.equal(result.state.npcs[0].importance, 77);
    assert.equal(result.state.npcs[0].personality, 'Reserved and dryly humorous.');
    assert.equal(result.state.npcs[0].relationship.trust, 0, 'relationship remains narrative branch state rather than user-metadata overlay');
});

test('branch checkpoints do not duplicate portrait binary data', () => {
    const chat = [user('(OOC: add Yunyun)')];
    const state = baseState();
    const yunyun = createNpcRecord('Yunyun');
    yunyun.portrait = { dataUrl: 'data:image/webp;base64,AAAA', mime: 'image/webp' };
    state.npcs = [yunyun];
    recordBranchCheckpoint(state, chat, 0, 'ooc');
    assert.equal(state.checkpoints[0].snapshot.npcs[0].portrait, null);
});

test('portrait attachment survives branch rollback when the NPC still exists', () => {
    const chat = [user('(OOC: add Yunyun)'), assistant('Yunyun smiles.', 0)];
    const state = baseState();
    const yunyun = createNpcRecord('Yunyun');
    state.npcs = [yunyun];
    recordBranchCheckpoint(state, chat, 0, 'ooc');
    state.npcs[0].portrait = { dataUrl: 'data:image/webp;base64,AAAA', mime: 'image/webp' };
    recordBranchCheckpoint(state, chat, 1, 'scan');

    const swiped = structuredClone(chat);
    swiped[1] = assistant('Yunyun looks away.', 1);
    const result = reconcileBranchState(state, swiped, { explicitDivergence: 1 });
    assert.equal(result.state.npcs[0].portrait.dataUrl, 'data:image/webp;base64,AAAA');
});

test('legacy state without checkpoints is not destructively erased on first reconciliation', () => {
    const original = [user('Hi'), assistant('Yunyun enters.', 0)];
    const legacy = baseState();
    legacy.npcs = [createNpcRecord('Yunyun')];
    legacy.lineage = chatLineage(original);
    const changed = structuredClone(original);
    changed[1] = assistant('Wiz enters instead.', 1);
    const result = reconcileBranchState(legacy, changed, { explicitDivergence: 1 });
    assert.equal(result.legacyFallback, true);
    assert.equal(result.state.npcs[0].name, 'Yunyun');
});

test('new chat branch can inherit the nearest checkpoint from a strongly verified common prefix', () => {
    const parentChat = [user('A'), assistant('B'), user('C'), assistant('D'), user('E')];
    const parent = baseState();
    parent.npcs = [createNpcRecord('Yunyun')];
    recordBranchCheckpoint(parent, parentChat, 1, 'scan');
    parent.lineage = chatLineage(parentChat);
    const branchChat = [user('A'), assistant('B'), user('C'), assistant('D'), user('Different continuation')];
    const inherited = bestAncestorState({ 'chat:parent': parent }, 'chat:branch', branchChat);
    assert.ok(inherited);
    assert.equal(inherited.branchParent, 'chat:parent');
    assert.equal(inherited.branchForkMessageId, 1);
    assert.deepEqual(inherited.npcs.map(n => n.name), ['Yunyun']);
});


test('branch rollback restores active state when a later death archive is reverted', () => {
    const chat = [user('Stay close.'), assistant('Luna nods.'), user('Continue'), assistant('Luna dies from her wounds.')];
    const state = baseState();
    const luna = createNpcRecord('Luna');
    luna.present = true;
    state.npcs = [luna];
    recordBranchCheckpoint(state, chat, 1, 'scan');
    state.npcs[0].archived = true;
    state.npcs[0].archiveReason = 'deceased';
    state.npcs[0].lifeState = 'deceased';
    state.npcs[0].lifeStateCertainty = 'explicit';
    state.npcs[0].present = false;
    recordBranchCheckpoint(state, chat, 3, 'scan');

    const reverted = chat.slice(0, 3);
    const result = reconcileBranchState(state, reverted, { explicitDivergence: 3 });
    assert.equal(result.state.npcs[0].archived, false);
    assert.equal(result.state.npcs[0].archiveReason, '');
    assert.notEqual(result.state.npcs[0].lifeState, 'deceased');
    assert.equal(result.state.npcs[0].present, true);
});

test('branch checkpoints preserve and roll back lightweight NPC candidates', () => {
    const chat = [user('Enter the guild.'), assistant('A guild boy checks the side dock.'), user('Continue'), assistant('The same guild boy returns.')];
    const state = baseState();
    state.candidates = [{ id: 'candidate_guild-boy', name: 'Guild Boy', aliases: [], identityKind: 'role_label', dossierSignal: 'incidental', dossierReason: '', seenCount: 1, firstSeenTurn: 1, lastSeenTurn: 1, importance: 0 }];
    state.pendingBackfills = [{ npcId: 'npc_marris', label: 'receptionist', requestedMessageId: 1, requestedAt: 1 }];
    recordBranchCheckpoint(state, chat, 1, 'scan');
    state.candidates[0].seenCount = 2;
    state.pendingBackfills = [];
    state.candidates[0].lastSeenTurn = 2;
    recordBranchCheckpoint(state, chat, 3, 'scan');

    const reverted = chat.slice(0, 3);
    const result = reconcileBranchState(state, reverted, { explicitDivergence: 3 });
    assert.equal(result.state.candidates.length, 1);
    assert.equal(result.state.candidates[0].seenCount, 1);
    assert.equal(result.state.candidates[0].lastSeenTurn, 1);
    assert.equal(result.state.pendingBackfills.length, 1);
    assert.equal(result.state.pendingBackfills[0].label, 'receptionist');
});

test('v0.2.10 branch rollback restores fractional relationship progress and recent evidence history', () => {
    const chat = [user('Stay careful.'), assistant('Myla nods.', 0)];
    const state = baseState();
    const myla = createNpcRecord('Myla');
    myla.relationship.trust = 95;
    myla.relationshipProgress.trust = 0.7;
    myla.relationshipEventHistory = [{
        impact: 'ordinary', reason: 'The player returned Myla\'s medicine.',
        evidence: { trust: 'Returning the medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        sourceMessageId: 0, turn: 1,
    }];
    state.npcs = [myla];
    recordBranchCheckpoint(state, chat, 0, 'scan');

    state.npcs[0].relationshipProgress.trust = 0.2;
    state.npcs[0].relationshipEventHistory.push({
        impact: 'ordinary', reason: 'A later unrelated promise.',
        evidence: { trust: 'The later promise was kept.', affection: '', desire: '', tension: '' },
        sourceMessageId: 1, turn: 2,
    });
    recordBranchCheckpoint(state, chat, 1, 'scan');

    const swiped = structuredClone(chat);
    swiped[1] = assistant('Myla refuses.', 1);
    const result = reconcileBranchState(state, swiped, { explicitDivergence: 1 });
    assert.equal(result.state.npcs[0].relationshipProgress.trust, 0.7);
    assert.equal(result.state.npcs[0].relationshipEventHistory.length, 1);
    assert.match(result.state.npcs[0].relationshipEventHistory[0].reason, /medicine/i);
});

test('v0.2.11 first-message sibling swipes restore from a clean root anchor and later revisit exact state', () => {
    const swipeA = [assistant('Myla smiles and offers her hand.', 0)];
    const stateA = baseState();
    ensureBranchParentAnchor(stateA, swipeA, 0, 'pre-first-swipe');
    const myla = createNpcRecord('Myla');
    myla.relationship.trust = 25;
    myla.relationshipProgress.trust = 0.4;
    stateA.npcs = [myla];
    stateA.turn = 1;
    recordBranchCheckpoint(stateA, swipeA, 0, 'scan-a');

    const swipeB = [assistant('Myla recoils and shuts the door.', 1)];
    const toB = reconcileBranchState(stateA, swipeB, { explicitDivergence: 0 });
    assert.equal(toB.exactRestored, false);
    assert.equal(toB.restoredFromRoot, true);
    assert.equal(toB.state.npcs.length, 0, 'unseen first-message sibling must not inherit narrative effects from swipe A');

    const stateB = toB.state;
    const mylaB = createNpcRecord('Myla');
    mylaB.relationship.trust = -3;
    stateB.npcs = [mylaB];
    stateB.turn = 1;
    recordBranchCheckpoint(stateB, swipeB, 0, 'scan-b');

    const backToA = reconcileBranchState(stateB, swipeA, { explicitDivergence: 0 });
    assert.equal(backToA.exactRestored, true);
    assert.equal(backToA.state.npcs[0].relationship.trust, 25);
    assert.equal(backToA.state.npcs[0].relationshipProgress.trust, 0.4);
});

test('v0.2.11 v0.2.10 swipe-index checkpoints migrate only when their legacy narrative prefix still matches', () => {
    const original = [user('Wait here.'), assistant('Myla nods.'), user('Continue.')];
    const legacy = baseState();
    legacy.branchLineageVersion = 0;
    legacy.lineage = original.map(legacyFingerprintV0210);
    const myla = createNpcRecord('Myla');
    myla.relationship.trust = 12;
    legacy.npcs = [myla];
    legacy.checkpoints = [{
        messageId: 1,
        fingerprint: legacy.lineage[1],
        reason: 'legacy-scan',
        createdAt: 100,
        snapshot: snapshotBranchState(legacy),
    }];

    migrateLegacyBranchState(legacy, original);
    assert.equal(legacy.branchLineageVersion, BRANCH_LINEAGE_VERSION);
    const normalized = normalizeBranchCheckpoints(legacy.checkpoints, legacy.lineage);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].lineageKey, lineageCheckpointKey(legacy.lineage, 1));

    const changedTail = [user('Wait here.'), assistant('Myla nods.'), user('Leave instead.')];
    const restored = reconcileBranchState(legacy, changedTail, { explicitDivergence: 2 });
    assert.equal(restored.restoredFromMessageId, 1);
    assert.equal(restored.exactRestored, true);
    assert.equal(restored.state.npcs[0].relationship.trust, 12);

    const stale = baseState();
    stale.branchLineageVersion = 0;
    stale.lineage = original.map(legacyFingerprintV0210);
    stale.checkpoints = [{
        messageId: 1,
        fingerprint: stale.lineage[1],
        reason: 'legacy-scan',
        createdAt: 100,
        snapshot: snapshotBranchState({ ...stale, npcs: [myla] }),
    }];
    const editedBeforeLoad = [user('Wait somewhere else.'), assistant('Myla nods.'), user('Continue.')];
    migrateLegacyBranchState(stale, editedBeforeLoad);
    assert.equal(stale.checkpoints.length, 0, 'an edited legacy prefix must never be relabeled as an exact current-branch checkpoint');
});

test('v0.2.11 checkpoint pruning keeps a safe active anchor, recent active state, and recent sibling heads', () => {
    const activeChat = Array.from({ length: 30 }, (_, index) => index % 2 === 0
        ? user(`User line ${index}`)
        : assistant(`Assistant line ${index}`));
    const activeLineage = chatLineage(activeChat);
    const activeKeys = lineageCheckpointKeys(activeLineage);
    const snapshot = snapshotBranchState(baseState());
    const checkpoints = activeKeys.map((lineageKey, messageId) => ({
        messageId,
        fingerprint: activeLineage[messageId],
        lineageKey,
        parentLineageKey: messageId > 0 ? activeKeys[messageId - 1] : 'root',
        reason: 'active',
        createdAt: messageId + 1,
        snapshot,
    }));
    const siblingKeys = [];
    for (let i = 0; i < 20; i += 1) {
        const siblingChat = structuredClone(activeChat);
        siblingChat[29] = assistant(`Sibling ending ${i}`, i);
        const siblingLineage = chatLineage(siblingChat);
        const siblingKey = lineageCheckpointKey(siblingLineage, 29);
        siblingKeys.push(siblingKey);
        checkpoints.push({
            messageId: 29,
            fingerprint: siblingLineage[29],
            lineageKey: siblingKey,
            parentLineageKey: lineageCheckpointKey(siblingLineage, 28),
            reason: 'sibling',
            createdAt: 1000 + i,
            snapshot,
        });
    }

    const pruned = pruneBranchCheckpoints(checkpoints, activeLineage, 16);
    const kept = new Set(pruned.map(item => item.lineageKey));
    assert.equal(pruned.length, 16);
    assert.ok(kept.has(activeKeys[0]), 'oldest active anchor must survive bounded pruning');
    assert.ok(kept.has(activeKeys.at(-1)), 'latest active checkpoint must survive bounded pruning');
    for (const siblingKey of siblingKeys.slice(-4)) assert.ok(kept.has(siblingKey), 'newest sibling heads should retain a bounded exact-restore cache');
});

test('v0.2.11 permanent UI deletion suppression survives exact sibling restore and explicit re-add can lift the whole alias group', () => {
    const chat = [user('Enter.'), assistant('The innkeeper Brina greets you.')];
    const state = baseState();
    const brina = createNpcRecord('Brina Hael');
    brina.aliases = ['the innkeeper', 'Brina'];
    state.npcs = [brina];
    recordBranchCheckpoint(state, chat, 1, 'scan');

    state.userDismissedGroups = addUserDismissedGroup([], brina);
    state.npcs = [];
    state.dismissed = ['brina hael', 'the innkeeper', 'brina'];
    const restored = reconcileBranchState(state, chat, { explicitDivergence: 1 });
    assert.equal(restored.exactRestored, true);
    assert.equal(restored.state.npcs.length, 0, 'an old sibling snapshot cannot resurrect a dossier explicitly deleted in the UI');
    assert.ok(!restored.state.dismissed.includes('brina hael'), 'modern ID tombstones must not globally suppress future homonyms by label');

    const cleared = clearUserDismissedGroupsFor(restored.state.userDismissedGroups, brina, { modernByIdOnly: true });
    assert.equal(cleared.groups.length, 0);
    assert.ok(cleared.removedLabels.includes('brina hael'));
    assert.ok(cleared.removedLabels.includes('the innkeeper'));
});

test('v0.2.12 exact sibling restore includes hidden social graph and unresolved family slots', () => {
    const swipe0 = [user('Continue.'), assistant('Brina mentions her daughters.', 0)];
    const state = baseState();
    const brina = createNpcRecord('Brina');
    const liza = createNpcRecord('Liza', [brina.id]);
    state.npcs = [brina, liza];
    ensureBranchParentAnchor(state, swipe0, 1, 'assistant-parent');
    state.socialGraph = normalizeSocialGraph({
        edges: [{ aId: brina.id, bId: liza.id, aToB: 'daughter', bToA: 'parent', confidence: 'explicit' }],
        unresolved: [{ ownerId: brina.id, relation: 'daughter', groupId: 'family_brina', descriptor: 'younger', confidence: 'explicit' }],
    });
    recordBranchCheckpoint(state, swipe0, 1, 'scan');

    const swipe1 = [user('Continue.'), assistant('Brina says she never had children.', 1)];
    const switched = reconcileBranchState(state, swipe1, { explicitDivergence: 1 });
    switched.state.socialGraph = normalizeSocialGraph();
    recordBranchCheckpoint(switched.state, swipe1, 1, 'scan');

    const back = reconcileBranchState(switched.state, swipe0, { explicitDivergence: 1 });
    assert.equal(back.exactRestored, true);
    assert.equal(back.state.socialGraph.edges.length, 1);
    assert.equal(back.state.socialGraph.unresolved.length, 1);
    assert.equal(back.state.socialGraph.unresolved[0].descriptor, 'younger');
});

test('v0.2.12 permanent dismissal strips restored graph edges and stale structured family references', () => {
    const chat = [user('Continue.'), assistant('Brina and Liza speak.', 0)];
    const state = baseState();
    const brina = createNpcRecord('Brina');
    const liza = createNpcRecord('Liza', [brina.id]);
    brina.keyRelationships = ['Liza — daughter'];
    state.npcs = [brina, liza];
    state.socialGraph = normalizeSocialGraph({ edges: [{ aId: brina.id, bId: liza.id, aToB: 'daughter', bToA: 'parent', confidence: 'explicit' }] });
    ensureBranchParentAnchor(state, chat, 1, 'assistant-parent');
    recordBranchCheckpoint(state, chat, 1, 'scan');
    state.userDismissedGroups = addUserDismissedGroup([], liza);

    const changed = [user('Continue.'), assistant('Brina and Liza speak differently.', 1)];
    const restored = reconcileBranchState(state, changed, { explicitDivergence: 1 });
    assert.equal(restored.state.npcs.some(npc => npc.id === liza.id), false);
    assert.equal(restored.state.socialGraph.edges.some(edge => edge.aId === liza.id || edge.bId === liza.id), false);
    const savedBrina = restored.state.npcs.find(npc => npc.id === brina.id);
    assert.equal(savedBrina.keyRelationships.some(entry => /Liza/.test(entry)), false);
});
