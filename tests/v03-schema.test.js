import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNpc, normalizeState } from '../v03/schema.js';

test('archived dossiers can remain durable while strict presence is always false', () => {
    const npc = normalizeNpc({ id: 'a', name: 'Astra', archived: true, present: true, worldActive: true });
    assert.equal(npc.archived, true);
    assert.equal(npc.present, false);
    assert.equal(npc.worldActive, false);
});

test('normalization preserves only explicit current v0.3 state fields', () => {
    const state = normalizeState({ chatKey: 'x', npcs: [], pendingBackfills: [{ npcId: 'x' }] }, 'x');
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.appVersion, '0.3.0');
    assert.equal('pendingBackfills' in state, false, 'legacy runtime queues are not part of the v0.3 schema');
});
