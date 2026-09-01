import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord } from '../core.js';
import {
    bestAncestorState,
    chatLineage,
    fingerprintMessage,
    firstLineageDivergence,
    recordBranchCheckpoint,
    reconcileBranchState,
} from '../branch.js';

function user(text, name = 'Kazuma') {
    return { is_user: true, is_system: false, name, mes: text };
}
function assistant(text, swipe = 0, name = 'Megumin') {
    return { is_user: false, is_system: false, name, mes: text, swipe_id: swipe };
}

function baseState() {
    return {
        npcs: [], dismissed: [], inlineCards: [], checkpoints: [], lineage: [],
        turn: 0, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null,
        scanCount: 0, processedOocMessageId: null,
    };
}

test('message fingerprint detects text and swipe branch changes', () => {
    const a = assistant('Yunyun enters.', 0);
    const b = assistant('Yunyun leaves.', 0);
    const c = assistant('Yunyun enters.', 1);
    assert.notEqual(fingerprintMessage(a), fingerprintMessage(b));
    assert.notEqual(fingerprintMessage(a), fingerprintMessage(c));
    assert.equal(firstLineageDivergence(chatLineage([user('Hi'), a]), chatLineage([user('Hi'), c])), 1);
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
    assert.deepEqual(result.state.inlineCards.map(entry => entry.messageId), [0]);
    assert.equal(result.state.checkpoints.at(-1).messageId, 1);
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
    assert.equal(result.state.checkpoints.at(-1).messageId, 0);
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

test('new chat branch can inherit the nearest checkpoint from a known common prefix', () => {
    const parentChat = [user('A'), assistant('B'), user('C'), assistant('D')];
    const parent = baseState();
    parent.npcs = [createNpcRecord('Yunyun')];
    recordBranchCheckpoint(parent, parentChat, 1, 'scan');
    parent.npcs.push(createNpcRecord('Wiz', parent.npcs.map(n => n.id)));
    recordBranchCheckpoint(parent, parentChat, 3, 'scan');
    const branchChat = [user('A'), assistant('B'), user('Different continuation')];
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
