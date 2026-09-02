import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';
import {
    applyStaleLifecycle,
    buildStaleReport,
    narrativeTurnForMessage,
    referencedNpcIdsFromExchange,
    retentionProtectionReasons,
} from '../v03/stale.js';

function stateWith(...npcs) {
    const state = createEmptyState('chat:test');
    state.npcs = npcs.map(npc => normalizeNpc(npc));
    return state;
}

test('narrative turn count advances only on assistant story messages, not scanner retries', () => {
    const chat = [
        { is_user: true, mes: 'u1' },
        { is_user: false, mes: 'a1' },
        { is_system: true, mes: 'system' },
        { is_user: true, mes: 'u2' },
        { is_user: false, mes: 'a2' },
    ];
    assert.equal(narrativeTurnForMessage(chat, 1), 1);
    assert.equal(narrativeTurnForMessage(chat, 1), 1, 're-evaluating the same message does not age dossiers');
    assert.equal(narrativeTurnForMessage(chat, 4), 2);
});

test('explicit canonical-name and alias references count as retention activity without changing scan targeting', () => {
    const state = stateWith(
        { id: 'astra', name: 'Astra', aliases: ['Star'] },
        { id: 'neri', name: 'Neri' },
    );
    const refs = referencedNpcIdsFromExchange(state, {
        user: { mes: 'I wonder whether Star ever reached the city.' },
        assistant: { mes: 'No one answers the question.' },
    });
    assert.deepEqual(refs, ['astra']);
});

test('missing activity metadata establishes a safe baseline instead of immediately pruning migrated dossiers', () => {
    const state = stateWith({ id: 'astra', name: 'Astra', archived: false });
    const result = applyStaleLifecycle(state, { currentTurn: 400, sourceMessageId: 800, settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 } });
    const npc = result.state.npcs[0];
    assert.equal(npc.archived, false);
    assert.equal(npc.lastActivityTurn, 400);
    assert.deepEqual(result.initializedIds, ['astra']);
});

test('off-screen status alone never prunes an NPC before the inactivity threshold', () => {
    const state = stateWith({ id: 'astra', name: 'Astra', present: false, worldActive: false, lastActivityTurn: 80 });
    const result = applyStaleLifecycle(state, { currentTurn: 100, settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 } });
    assert.equal(result.state.npcs[0].archived, false);
    assert.equal(result.archivedIds.length, 0);
});

test('inactive dossier archives at 30 total narrative turns and stale archive is removed at 50', () => {
    const initial = stateWith({ id: 'astra', name: 'Astra', lastActivityTurn: 10 });
    initial.socialGraph = [{ fromId: 'astra', toId: 'neri', relation: 'friend', summary: '', updatedAt: 1, sourceMessageId: 1 }];

    const archived = applyStaleLifecycle(initial, { currentTurn: 40, settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 } });
    assert.deepEqual(archived.archivedIds, ['astra']);
    assert.equal(archived.state.npcs[0].archived, true);
    assert.equal(archived.state.npcs[0].archiveReason, 'stale');

    const deleted = applyStaleLifecycle(archived.state, { currentTurn: 60, settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 } });
    assert.deepEqual(deleted.deletedIds, ['astra']);
    assert.equal(deleted.state.npcs.length, 0);
    assert.equal(deleted.state.socialGraph.length, 0);
    assert.deepEqual(deleted.state.deletedNpcIds, [], 'automatic stale cleanup is not a permanent manual tombstone');
});

test('retention protection and manual profile locks hard-shield automatic stale pruning', () => {
    const state = stateWith(
        { id: 'protected', name: 'Protected', lastActivityTurn: 1, retentionProtected: true },
        { id: 'locked', name: 'Locked', lastActivityTurn: 1, manualProfileFields: ['personality'] },
    );
    const result = applyStaleLifecycle(state, { currentTurn: 100, settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 } });
    assert.equal(result.state.npcs.every(npc => !npc.archived), true);
    assert.deepEqual(retentionProtectionReasons(result.state.npcs[0]), ['retention-protected']);
    assert.deepEqual(retentionProtectionReasons(result.state.npcs[1]), ['profile-locked']);
});

test('exchange, presence, world activity, or explicit reference resets inactivity and restores only stale archives', () => {
    const base = stateWith(
        { id: 'exchange', name: 'Exchange', lastActivityTurn: 1 },
        { id: 'present', name: 'Present', lastActivityTurn: 1 },
        { id: 'world', name: 'World', lastActivityTurn: 1 },
        { id: 'reference', name: 'Reference', lastActivityTurn: 1, archived: true, archiveReason: 'stale' },
        { id: 'manual', name: 'Manual', lastActivityTurn: 1, archived: true, archiveReason: 'manual' },
    );
    const result = applyStaleLifecycle(base, {
        currentTurn: 100,
        sourceMessageId: 200,
        settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 },
        exchangeActiveNpcIds: ['exchange'],
        finalPresentNpcIds: ['present'],
        worldActiveNpcIds: ['world'],
        referencedNpcIds: ['reference', 'manual'],
    });
    for (const id of ['exchange', 'present', 'world', 'reference', 'manual']) {
        assert.equal(result.state.npcs.find(npc => npc.id === id).lastActivityTurn, 100);
    }
    assert.equal(result.state.npcs.find(npc => npc.id === 'reference').archived, false);
    assert.equal(result.state.npcs.find(npc => npc.id === 'manual').archived, true, 'manual archive is never auto-restored');
});

test('stale report exposes review status and thresholds', () => {
    const state = stateWith(
        { id: 'fresh', name: 'Fresh', lastActivityTurn: 90 },
        { id: 'stale', name: 'Stale', lastActivityTurn: 60, archived: true, archiveReason: 'stale' },
        { id: 'protected', name: 'Protected', lastActivityTurn: 1, retentionProtected: true },
    );
    const report = buildStaleReport(state, { staleArchiveAfter: 30, staleDeleteAfter: 50 }, 100);
    assert.equal(report.find(row => row.npcId === 'fresh').status, 'active');
    assert.equal(report.find(row => row.npcId === 'stale').status, 'stale-archived');
    assert.equal(report.find(row => row.npcId === 'protected').status, 'protected');
});
