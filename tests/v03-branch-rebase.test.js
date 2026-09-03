import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chatLineage, recordCheckpoint, reconcileToCurrentBranch, rebaseToCurrentChat } from '../v03/branches.js';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';

function originalChat() {
    return [
        { is_user: true, mes: 'u1' }, { is_user: false, mes: 'a1' },
        { is_user: true, mes: 'u2' }, { is_user: false, mes: 'a2' },
    ];
}

function unsafeState() {
    const chat = originalChat();
    let state = createEmptyState('chat:test:rebase');
    state.npcs = [normalizeNpc({
        id: 'astra', name: 'Astra', present: true, worldActive: true,
        memories: ['The player kept a promise.'],
        relationship: { trust: 18, affection: 7, desire: 0, tension: 1 },
        relationshipHistory: [{ impact: 'meaningful', delta: { trust: 2 }, sourceMessageId: 3, turn: 2, at: 10 }],
        lastRelationshipChange: { impact: 'meaningful', delta: { trust: 2 }, sourceMessageId: 3, turn: 2, at: 10 },
        firstSeenMessageId: 1, lastSeenMessageId: 3, lastInteractionMessageId: 3,
        lastActivityTurn: 1, lastActivityMessageId: 3, retentionProtected: true,
        manualProfileFields: ['personality'], portrait: { path: 'astra.png' },
    })];
    state.deletedNpcIds = ['npc-deleted'];
    state.socialGraph = [{ fromId: 'astra', toId: 'other', relation: 'friend', summary: '', updatedAt: 1, sourceMessageId: 3 }];
    state = recordCheckpoint(state, chat, 3, 'v3-start');
    state.checkpoints = [];
    return state;
}

test('prebaseline tail deletion is classified as recoverable truncation', () => {
    const state = unsafeState();
    const previousHead = [...state.branchHeadLineage];
    const surviving = originalChat().slice(0, 2);
    const result = reconcileToCurrentBranch(state, surviving);
    assert.equal(result.unsafeDivergence, true);
    assert.equal(result.state.branchSafety.status, 'rebase-required');
    assert.equal(result.state.branchSafety.kind, 'prebaseline-truncation');
    assert.deepEqual(result.state.branchHeadLineage, previousHead, 'unsafe state preserves pre-deletion lineage until an explicit rebase');
});

test('prebaseline rewritten history is classified separately', () => {
    const state = unsafeState();
    const rewritten = [{ is_user: true, mes: 'different user' }, { is_user: false, mes: 'different assistant' }];
    const result = reconcileToCurrentBranch(state, rewritten);
    assert.equal(result.unsafeDivergence, true);
    assert.equal(result.state.branchSafety.status, 'rebase-required');
    assert.equal(result.state.branchSafety.kind, 'prebaseline-rewrite');
});

test('explicit rebase preserves durable dossiers while resetting timeline-local state', () => {
    const surviving = originalChat().slice(0, 2);
    const unsafe = reconcileToCurrentBranch(unsafeState(), surviving).state;
    const rebased = rebaseToCurrentChat(unsafe, surviving);
    const astra = rebased.npcs.find(npc => npc.id === 'astra');

    assert.equal(rebased.branchSafety.status, 'safe');
    assert.equal(rebased.branchSafety.kind, '');
    assert.equal(rebased.checkpoints.length, 0);
    assert.ok(rebased.branchBase?.snapshot);
    assert.deepEqual(rebased.branchHeadLineage, chatLineage(surviving));
    assert.deepEqual(rebased.branchBase.lineage, chatLineage(surviving));
    assert.equal(rebased.lastScannedMessageId, null);
    assert.deepEqual(rebased.lastObservation.finalPresentNpcIds, []);

    assert.ok(astra);
    assert.equal(astra.relationship.trust, 18);
    assert.deepEqual(astra.memories, ['The player kept a promise.']);
    assert.equal(astra.retentionProtected, true);
    assert.ok(astra.manualProfileFields.includes('personality'));
    assert.deepEqual(astra.portrait, { path: 'astra.png' });
    assert.ok(rebased.deletedNpcIds.includes('npc-deleted'));

    assert.equal(astra.present, false);
    assert.equal(astra.worldActive, false);
    assert.equal(astra.firstSeenMessageId, null);
    assert.equal(astra.lastSeenMessageId, null);
    assert.equal(astra.lastInteractionMessageId, null);
    assert.equal(astra.lastActivityMessageId, null);
    assert.equal(astra.relationshipHistory[0].sourceMessageId, null);
    assert.equal(astra.relationshipHistory[0].turn, null);
    assert.equal(astra.lastRelationshipChange.sourceMessageId, null);
    assert.equal(astra.lastRelationshipChange.turn, null);
    assert.equal(rebased.socialGraph[0].sourceMessageId, null);
    assert.equal(astra.lastActivityTurn, 0, 'one turn of prior inactivity is preserved on the shorter surviving timeline');
});

test('engine and recovery UI wire an explicit rebase plus forced manual rescan', () => {
    const engine = fs.readFileSync(new URL('../v03/engine.js', import.meta.url), 'utf8');
    const ui = fs.readFileSync(new URL('../v03/branch-recovery-ui.js', import.meta.url), 'utf8');
    assert.match(engine, /reconcileBranch\(\{ rescan = false, rebase = false \}/);
    assert.match(engine, /rebaseToCurrentChat\(state, chat\)/);
    assert.match(engine, /manual: rebase === true, force: true/);
    assert.match(ui, /reconcile\?\.\(\{ rebase: true, rescan: true \}\)/);
    assert.match(ui, /Facts learned only from deleted messages may remain/);
    assert.match(ui, /timeline rebased successfully, but the latest exchange scan failed/);
});
