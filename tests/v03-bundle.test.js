import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyNpcStateBundleImport,
    createNpcStateBundle,
    parseNpcStateBundle,
    previewNpcStateBundleImport,
} from '../v03/bundle.js';
import { normalizeNpc, normalizeState } from '../v03/schema.js';

function npc(id, name, patch = {}) {
    return normalizeNpc({ id, name, ...patch });
}

function state(patch = {}) {
    return normalizeState({
        chatKey: 'chat:source',
        npcs: [
            npc('npc-astra', 'Astra', {
                memories: ['Saved the player at Glassdock.'],
                relationship: { trust: 22, affection: 8, desire: 0, tension: -2 },
                relationshipSummary: 'Trusted companion.',
                portrait: { dataUrl: 'data:image/png;base64,AAAA', prompt: 'portrait prompt' },
                archived: true,
                archiveReason: 'manual',
                retentionProtected: true,
                lastActivityTurn: 30,
                firstSeenMessageId: 2,
                lastSeenMessageId: 38,
                lastInteractionMessageId: 39,
            }),
            npc('npc-neri', 'Neri'),
        ],
        socialGraph: [{ fromId: 'npc-astra', toId: 'npc-neri', relation: 'sister', summary: 'Protective bond.', sourceMessageId: 39 }],
        suppressedNames: ['Nameless Guard'],
        deletedNpcIds: ['npc-old'],
        lastObservation: { messageId: 40, exchangeActiveNpcIds: ['npc-astra'], finalPresentNpcIds: [], worldActiveNpcIds: [], targetNpcIds: ['npc-astra'] },
        checkpoints: [{ messageId: 40, lineage: ['x'], reason: 'scan', snapshot: { npcs: [] } }],
        branchBase: { messageId: 1, lineage: ['base'], snapshot: { npcs: [] } },
        branchHeadLineage: ['base', 'x'],
        branchSafety: { status: 'safe', reason: '' },
        migration: { importedFrom: 'legacy' },
        revision: 12,
        ...patch,
    }, patch.chatKey || 'chat:source');
}

test('full-chat export contains normalized v0.3 durable data and excludes runtime/branch machinery', () => {
    const bundle = createNpcStateBundle(state(), { sourceNarrativeTurn: 40 });
    assert.equal(bundle.bundleType, 'full-chat');
    assert.equal(bundle.schemaVersion, 1);
    assert.equal(bundle.data.npcs.length, 2);
    assert.deepEqual(bundle.data.deletedNpcIds, ['npc-old']);
    assert.equal(bundle.data.npcs[0].portrait.dataUrl, 'data:image/png;base64,AAAA');
    for (const key of ['lastObservation', 'lastScannedMessageId', 'checkpoints', 'branchBase', 'branchHeadLineage', 'branchSafety', 'revision', 'migration']) {
        assert.equal(Object.hasOwn(bundle.data, key), false, `${key} must not be bundled`);
    }
});

test('selected NPC export keeps one dossier and only social edges touching that stable id', () => {
    const source = state({ socialGraph: [
        { fromId: 'npc-astra', toId: 'npc-neri', relation: 'sister' },
        { fromId: 'npc-neri', toId: 'npc-astra', relation: 'protective-of' },
        { fromId: 'npc-neri', toId: 'npc-third', relation: 'knows' },
    ] });
    const bundle = createNpcStateBundle(source, { npcId: 'npc-astra', sourceNarrativeTurn: 40 });
    assert.equal(bundle.bundleType, 'npc');
    assert.deepEqual(bundle.data.npcs.map(item => item.id), ['npc-astra']);
    assert.equal(bundle.data.socialGraph.length, 2);
    assert.deepEqual(bundle.data.suppressedNames, []);
    assert.deepEqual(bundle.data.deletedNpcIds, []);
});

test('bundle parser requires stable IDs, rejects duplicate identities, and drops unknown dossier fields', () => {
    const bundle = createNpcStateBundle(state(), { sourceNarrativeTurn: 40 });
    bundle.data.npcs[0].pendingBackfills = [{ bad: true }];
    const parsed = parseNpcStateBundle(JSON.stringify(bundle));
    assert.equal(Object.hasOwn(parsed.data.npcs[0], 'pendingBackfills'), false);

    const missingId = structuredClone(bundle);
    delete missingId.data.npcs[0].id;
    assert.throws(() => parseNpcStateBundle(missingId), /stable NPC id/);

    const duplicateName = structuredClone(bundle);
    duplicateName.data.npcs[1].name = 'Astra';
    assert.throws(() => parseNpcStateBundle(duplicateName), /canonical name/);
});

test('cross-chat selected import preserves dossier data, rebases inactivity, clears chat-local message ids, and resolves available social edges', () => {
    const bundle = createNpcStateBundle(state(), { npcId: 'npc-astra', sourceNarrativeTurn: 40 });
    const target = normalizeState({ chatKey: 'chat:target', npcs: [npc('npc-neri', 'Neri')] }, 'chat:target');
    const imported = applyNpcStateBundleImport(target, bundle, { mode: 'merge', currentNarrativeTurn: 100 });
    assert.equal(imported.ok, true);
    const astra = imported.state.npcs.find(item => item.id === 'npc-astra');
    assert.ok(astra);
    assert.deepEqual(astra.memories, ['Saved the player at Glassdock.']);
    assert.equal(astra.relationship.trust, 22);
    assert.equal(astra.portrait.dataUrl, 'data:image/png;base64,AAAA');
    assert.equal(astra.archived, true);
    assert.equal(astra.archiveReason, 'manual');
    assert.equal(astra.retentionProtected, true);
    assert.equal(astra.lastActivityTurn, 90, '10 inactive source turns are preserved against destination turn 100');
    assert.equal(astra.firstSeenMessageId, null);
    assert.equal(astra.lastSeenMessageId, null);
    assert.equal(astra.lastInteractionMessageId, null);
    assert.equal(astra.present, false);
    assert.equal(astra.worldActive, false);
    assert.equal(imported.state.socialGraph.length, 1);
    assert.equal(imported.state.socialGraph[0].sourceMessageId, null);
});

test('matching stable IDs are deliberate: keep is default and replace can import dossier data without changing live presence', () => {
    const target = normalizeState({ chatKey: 'chat:target', npcs: [npc('npc-astra', 'Astra', { personality: 'Current', present: true, lastActivityTurn: 7 })] }, 'chat:target');
    const source = normalizeState({ chatKey: 'chat:source', npcs: [npc('npc-astra', 'Astra', { personality: 'Imported', lastActivityTurn: 2 })] }, 'chat:source');
    const bundle = createNpcStateBundle(source, { sourceNarrativeTurn: 5 });

    const kept = applyNpcStateBundleImport(target, bundle, { mode: 'merge', currentNarrativeTurn: 10 });
    assert.equal(kept.state.npcs[0].personality, 'Current');

    const replaced = applyNpcStateBundleImport(target, bundle, { mode: 'merge', matchPolicy: 'replace', currentNarrativeTurn: 10 });
    assert.equal(replaced.state.npcs[0].personality, 'Imported');
    assert.equal(replaced.state.npcs[0].present, true, 'merge does not disturb current live scene presence');
    assert.equal(replaced.state.npcs[0].lastActivityTurn, 7, 'merge preserves destination lifecycle activity for an existing identity');
});

test('stable-id identity conflict aborts atomically by default and skip leaves existing dossier and its social edges untouched', () => {
    const target = normalizeState({
        chatKey: 'chat:target',
        npcs: [npc('npc-a', 'Local Astra'), npc('npc-b', 'Neri')],
        socialGraph: [{ fromId: 'npc-a', toId: 'npc-b', relation: 'friend' }],
    }, 'chat:target');
    const source = normalizeState({ chatKey: 'chat:source', npcs: [npc('npc-a', 'Different Person')] }, 'chat:source');
    const bundle = createNpcStateBundle(source, { sourceNarrativeTurn: 1 });
    const preview = previewNpcStateBundleImport(target, bundle, { mode: 'merge' });
    assert.equal(preview.ok, false);
    assert.equal(preview.conflicts[0].type, 'stable-id-identity');

    const aborted = applyNpcStateBundleImport(target, bundle, { mode: 'merge' });
    assert.equal(aborted.ok, false);
    assert.equal(aborted.state.socialGraph.length, 1);

    const skipped = applyNpcStateBundleImport(target, bundle, { mode: 'merge', conflictPolicy: 'skip' });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.state.npcs.find(item => item.id === 'npc-a').name, 'Local Astra');
    assert.equal(skipped.state.socialGraph.length, 1, 'skipping an imported conflict must not erase current social edges');
});

test('merge never silently resurrects local tombstones or applies imported tombstones over live local dossiers', () => {
    const sourceNpc = normalizeState({ chatKey: 'chat:source', npcs: [npc('npc-deleted', 'Returner')] }, 'chat:source');
    const incomingNpcBundle = createNpcStateBundle(sourceNpc, { sourceNarrativeTurn: 1 });
    const localTombstone = normalizeState({ chatKey: 'chat:target', deletedNpcIds: ['npc-deleted'] }, 'chat:target');
    const previewA = previewNpcStateBundleImport(localTombstone, incomingNpcBundle, { mode: 'merge' });
    assert.equal(previewA.conflicts[0].type, 'local-tombstone');
    const skippedA = applyNpcStateBundleImport(localTombstone, incomingNpcBundle, { mode: 'merge', conflictPolicy: 'skip' });
    assert.equal(skippedA.state.npcs.length, 0);
    assert.deepEqual(skippedA.state.deletedNpcIds, ['npc-deleted']);

    const tombstoneBundle = createNpcStateBundle(normalizeState({ chatKey: 'chat:source', deletedNpcIds: ['npc-live'] }, 'chat:source'), { sourceNarrativeTurn: 1 });
    const liveTarget = normalizeState({ chatKey: 'chat:target', npcs: [npc('npc-live', 'Living NPC')] }, 'chat:target');
    const previewB = previewNpcStateBundleImport(liveTarget, tombstoneBundle, { mode: 'merge' });
    assert.equal(previewB.conflicts[0].type, 'imported-tombstone-live');
    const skippedB = applyNpcStateBundleImport(liveTarget, tombstoneBundle, { mode: 'merge', conflictPolicy: 'skip' });
    assert.equal(skippedB.state.npcs.length, 1);
    assert.equal(skippedB.state.deletedNpcIds.includes('npc-live'), false);
});

test('full-chat replace swaps only portable durable domains while leaving destination branch machinery local', () => {
    const sourceBundle = createNpcStateBundle(state(), { sourceNarrativeTurn: 40 });
    const target = normalizeState({
        chatKey: 'chat:target',
        npcs: [npc('npc-local', 'Local')],
        lastObservation: { messageId: 9, exchangeActiveNpcIds: ['npc-local'], finalPresentNpcIds: ['npc-local'], worldActiveNpcIds: [], targetNpcIds: ['npc-local'] },
        lastScannedMessageId: 9,
        checkpoints: [{ messageId: 9, lineage: ['local'], reason: 'scan', snapshot: { npcs: [] } }],
        branchBase: { messageId: 1, lineage: ['local'], snapshot: { npcs: [] } },
        branchHeadLineage: ['local'],
    }, 'chat:target');
    const replaced = applyNpcStateBundleImport(target, sourceBundle, { mode: 'replace', currentNarrativeTurn: 100 });
    assert.equal(replaced.ok, true);
    assert.deepEqual(replaced.state.npcs.map(item => item.id).sort(), ['npc-astra', 'npc-neri']);
    assert.deepEqual(replaced.state.deletedNpcIds, ['npc-old']);
    assert.deepEqual(replaced.state.suppressedNames, ['Nameless Guard']);
    assert.equal(replaced.state.lastScannedMessageId, null);
    assert.deepEqual(replaced.state.lastObservation.exchangeActiveNpcIds, []);
    assert.deepEqual(replaced.state.branchHeadLineage, ['local']);
    assert.equal(replaced.state.checkpoints.length, 1);
    assert.equal(replaced.state.branchBase.lineage[0], 'local');
    assert.equal(replaced.state.npcs.some(item => item.present || item.worldActive), false, 'portable restore never imports live scene presence');
});
