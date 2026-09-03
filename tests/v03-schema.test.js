import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DOSSIER_LIMIT_DEFAULTS,
    DOSSIER_LIMIT_MAXIMUMS,
    normalizeApparentAge,
    normalizeDossierLimits,
    normalizeNpc,
    normalizeState,
} from '../v03/schema.js';

test('archived dossiers can remain durable while strict presence is always false', () => {
    const npc = normalizeNpc({ id: 'a', name: 'Astra', archived: true, present: true, worldActive: true });
    assert.equal(npc.archived, true);
    assert.equal(npc.present, false);
    assert.equal(npc.worldActive, false);
});

test('normalization preserves only explicit current v0.3 state fields', () => {
    const state = normalizeState({ chatKey: 'x', npcs: [], pendingBackfills: [{ npcId: 'x' }] }, 'x');
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.appVersion, '0.3.1');
    assert.equal('pendingBackfills' in state, false, 'legacy runtime queues are not part of the v0.3 schema');
});

test('apparent age is one canonical approximate number rather than a prose band', () => {
    assert.equal(normalizeApparentAge('~25'), '~25');
    assert.equal(normalizeApparentAge('25'), '~25');
    assert.equal(normalizeApparentAge('looks about 25'), '~25');
    assert.equal(normalizeApparentAge('20s'), '');
    assert.equal(normalizeApparentAge('late twenties'), '');
    assert.equal(normalizeApparentAge('20-30'), '');
    assert.equal(normalizeApparentAge('around twenties to thirties'), '');
    assert.equal(normalizeNpc({ id: 'a', name: 'Astra', apparentAge: 'about 24' }).apparentAge, '~24');
});

test('dossier evolution limits keep stable defaults and clamp user settings to safety ceilings', () => {
    assert.deepEqual(DOSSIER_LIMIT_DEFAULTS, {
        memories: 5,
        keyRelationships: 12,
        mannerisms: 8,
        behaviorProfile: 8,
    });
    assert.deepEqual(DOSSIER_LIMIT_MAXIMUMS, {
        memories: 20,
        keyRelationships: 30,
        mannerisms: 16,
        behaviorProfile: 16,
    });
    assert.deepEqual(normalizeDossierLimits({ memories: 999, keyRelationships: 0, mannerisms: 14, behaviorProfile: 16 }), {
        memories: 20,
        keyRelationships: 1,
        mannerisms: 14,
        behaviorProfile: 16,
    });
    assert.deepEqual(normalizeDossierLimits({}), DOSSIER_LIMIT_DEFAULTS);
});

test('schema storage ceilings are higher than working defaults so raised settings persist', () => {
    const values = count => Array.from({ length: count }, (_, i) => `entry ${i + 1}`);
    const npc = normalizeNpc({
        id: 'a',
        name: 'Astra',
        memories: values(10),
        keyRelationships: values(40),
        mannerisms: values(20),
        behaviorProfile: values(20),
    });
    assert.equal(npc.memories.length, 10, 'storage must preserve memories above the default working cap');
    assert.equal(npc.keyRelationships.length, 30, 'key relationships stop only at the hard safety ceiling');
    assert.equal(npc.mannerisms.length, 16);
    assert.equal(npc.behaviorProfile.length, 16);
});
