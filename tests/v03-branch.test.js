import test from 'node:test';
import assert from 'node:assert/strict';
import { recordCheckpoint, reconcileToCurrentBranch } from '../v03/branches.js';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';

test('branch rollback restores best prefix checkpoint but preserves deletion tombstones', () => {
    const originalChat = [
        { is_user: true, mes: 'u1' }, { is_user: false, mes: 'a1' },
        { is_user: true, mes: 'u2' }, { is_user: false, mes: 'a2 original' },
    ];
    let state = createEmptyState('chat:test:one');
    state.npcs = [normalizeNpc({ id: 'a', name: 'Astra' }), normalizeNpc({ id: 'm', name: 'Mira' })];
    state.lastScannedMessageId = 1;
    state = recordCheckpoint(state, originalChat, 1, 'scan');
    state.lastScannedMessageId = 3;
    state = recordCheckpoint(state, originalChat, 3, 'scan');
    state.deletedNpcIds = ['m'];
    state.npcs = state.npcs.filter(n => n.id !== 'm');

    const changedChat = [
        { is_user: true, mes: 'u1' }, { is_user: false, mes: 'a1' },
        { is_user: true, mes: 'u2 changed' }, { is_user: false, mes: 'a2 changed' },
    ];
    const reconciled = reconcileToCurrentBranch(state, changedChat);
    assert.equal(reconciled.changed, true);
    assert.equal(reconciled.checkpoint.messageId, 1);
    assert.equal(reconciled.state.npcs.some(n => n.id === 'm'), false, 'deleted identity cannot resurrect from checkpoint');
    assert.ok(reconciled.state.deletedNpcIds.includes('m'));
});

test('branch divergence before the v0.3 baseline fails closed instead of trusting stale live state', () => {
    const originalChat = [
        { is_user: true, mes: 'original user' },
        { is_user: false, mes: 'original assistant' },
    ];
    let state = createEmptyState('chat:test:baseline');
    state.npcs = [normalizeNpc({ id: 'a', name: 'Astra', present: true, worldActive: true })];
    state = recordCheckpoint(state, originalChat, 1, 'v3-start');
    state.checkpoints = [];

    const changedChat = [
        { is_user: true, mes: 'rewritten before v3 baseline' },
        { is_user: false, mes: 'different assistant branch' },
    ];
    const reconciled = reconcileToCurrentBranch(state, changedChat);
    assert.equal(reconciled.changed, true);
    assert.equal(reconciled.unsafeDivergence, true);
    assert.equal(reconciled.state.branchSafety.status, 'rebase-required');
    assert.equal(reconciled.state.npcs[0].present, false);
    assert.equal(reconciled.state.npcs[0].worldActive, false);
    assert.equal(reconciled.state.lastScannedMessageId, null);
});
