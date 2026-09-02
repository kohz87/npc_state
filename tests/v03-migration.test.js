import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateV02State } from '../v03/migrate-v02.js';

test('v0.2 migration imports durable dossier data but not runtime queues/checkpoints', () => {
    const old = {
        schemaVersion: 29,
        turn: 12,
        lastScannedMessageId: 30,
        dismissed: ['Suppressed Guard'],
        pendingBackfills: [{ npcId: 'a', deepSweep: true }],
        checkpoints: [{ messageId: 2, snapshot: { npcs: [] } }],
        portraitAssets: { a: { dataUrl: 'data:image/png;base64,AAA' } },
        npcs: [{ id: 'a', name: 'Astra', personality: 'gentle', present: true, memories: ['Promise'], relationship: { trust: 12, affection: 3, desire: 0, tension: -1 } }],
    };
    const migrated = migrateV02State(old, 'chat:owner:test');
    assert.equal(migrated.npcs.length, 1);
    assert.equal(migrated.npcs[0].personality, 'gentle');
    assert.equal(migrated.npcs[0].portrait.dataUrl, old.portraitAssets.a.dataUrl);
    assert.equal(migrated.npcs[0].relationship.trust, 12);
    assert.deepEqual(migrated.suppressedNames, ['Suppressed Guard']);
    assert.deepEqual(migrated.checkpoints, []);
    assert.equal('pendingBackfills' in migrated, false);
    assert.equal(migrated.migration.source, 'v0.2.x');
});

test('v0.2 directional social edges and deceased life state are converted into the v0.3 schema', () => {
    const migrated = migrateV02State({
        npcs: [
            { id: 'a', name: 'Astra', lifeState: 'deceased', archived: true, archiveReason: 'deceased' },
            { id: 'b', name: 'Kiri' },
        ],
        socialGraph: {
            edges: [{ aId: 'a', bId: 'b', aToB: 'older sister', bToA: 'younger sister', aDynamic: 'protective', bDynamic: 'dependent' }],
        },
    }, 'chat:owner:social');
    assert.equal(migrated.npcs.find(npc => npc.id === 'a').lifeState, 'dead');
    assert.deepEqual(migrated.socialGraph.map(edge => [edge.fromId, edge.toId, edge.relation]), [
        ['a', 'b', 'older sister'],
        ['b', 'a', 'younger sister'],
    ]);
});
