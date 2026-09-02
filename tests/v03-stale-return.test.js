import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';
import { applyStaleLifecycle } from '../v03/stale.js';

function staleNpc(id) {
    return normalizeNpc({ id, name: id, archived: true, archiveReason: 'stale', lastActivityTurn: 1 });
}

test('stale archive restored by world activity remains world-active and not physically present', () => {
    const state = createEmptyState('chat:test');
    state.npcs = [staleNpc('astra')];
    const result = applyStaleLifecycle(state, {
        currentTurn: 40,
        sourceMessageId: 80,
        settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 },
        worldActiveNpcIds: ['astra'],
    });
    const npc = result.state.npcs[0];
    assert.equal(npc.archived, false);
    assert.equal(npc.present, false);
    assert.equal(npc.worldActive, true);
});

test('stale archive restored by final presence becomes physically present and not world-active', () => {
    const state = createEmptyState('chat:test');
    state.npcs = [staleNpc('astra')];
    const result = applyStaleLifecycle(state, {
        currentTurn: 40,
        sourceMessageId: 80,
        settings: { staleArchiveAfter: 30, staleDeleteAfter: 50 },
        finalPresentNpcIds: ['astra'],
        worldActiveNpcIds: ['astra'],
    });
    const npc = result.state.npcs[0];
    assert.equal(npc.archived, false);
    assert.equal(npc.present, true);
    assert.equal(npc.worldActive, false);
});
