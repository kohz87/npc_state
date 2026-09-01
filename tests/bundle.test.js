import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord } from '../core.js';
import {
    decodeNpcStateBundle,
    encodeNpcStateBundle,
    mergeImportedDossierState,
} from '../bundle.js';

function makePortraitDataUrl(bytes = [0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]) {
    return `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
}

test('binary bundle round-trips dossiers and raw portrait bytes', () => {
    const npc = createNpcRecord('Yunyun');
    npc.role = 'Crimson Demon adventurer';
    npc.archived = true;
    npc.archiveReason = 'manual';
    npc.archivedAt = 12340;
    npc.portrait = {
        dataUrl: makePortraitDataUrl(),
        mime: 'image/webp',
        sourceName: 'yunyun.webp',
        updatedAt: 12345,
    };
    const bytes = encodeNpcStateBundle({ npcs: [npc], dismissed: ['wiz'] }, {
        appVersion: '0.1.2',
        chatKey: 'chat:test',
    });

    assert.equal(Buffer.from(bytes.subarray(0, 8)).toString('ascii'), 'NPCSTB01');
    const exportedText = Buffer.from(bytes).toString('utf8');
    assert.doesNotMatch(exportedText, /data:image\/webp;base64/);

    const decoded = decodeNpcStateBundle(bytes);
    assert.equal(decoded.metadata.appVersion, '0.1.2');
    assert.equal(decoded.metadata.sourceChatKey, 'chat:test');
    assert.equal(decoded.state.npcs[0].name, 'Yunyun');
    assert.equal(decoded.state.npcs[0].role, 'Crimson Demon adventurer');
    assert.equal(decoded.state.npcs[0].archived, true);
    assert.equal(decoded.state.npcs[0].archiveReason, 'manual');
    assert.equal(decoded.state.npcs[0].portrait.mime, 'image/webp');
    assert.equal(decoded.state.npcs[0].portrait.sourceName, 'yunyun.webp');
    assert.deepEqual(
        Buffer.from(decoded.state.npcs[0].portrait.dataUrl.split(',')[1], 'base64'),
        Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]),
    );
    assert.deepEqual(decoded.state.dismissed, ['wiz']);
});

test('bundle decoder rejects corrupt signature and truncated portraits', () => {
    const npc = createNpcRecord('Wiz');
    npc.portrait = { dataUrl: makePortraitDataUrl([1, 2, 3, 4]), mime: 'image/webp' };
    const valid = encodeNpcStateBundle({ npcs: [npc], dismissed: [] });

    const badMagic = valid.slice();
    badMagic[0] = 0;
    assert.throws(() => decodeNpcStateBundle(badMagic), /signature/i);

    const truncated = valid.subarray(0, valid.length - 2);
    assert.throws(() => decodeNpcStateBundle(truncated), /truncated/i);
});

test('import merge prioritizes imported dossiers, restores portraits, and lifts suppression', () => {
    const existing = createNpcRecord('Yunyun');
    existing.mood = 'old mood';
    const wiz = createNpcRecord('Wiz');
    const incoming = createNpcRecord('Yunyun');
    incoming.mood = 'determined';
    incoming.portrait = { dataUrl: makePortraitDataUrl(), mime: 'image/webp' };

    const merged = mergeImportedDossierState({
        npcs: [existing, wiz],
        dismissed: ['yunyun', 'luna'],
        processedOocMessageId: 20,
    }, {
        npcs: [incoming],
        dismissed: [],
    }, { maxNpcs: 2 });

    assert.equal(merged.npcs.length, 2);
    assert.equal(merged.npcs[0].name, 'Yunyun');
    assert.equal(merged.npcs[0].mood, 'determined');
    assert.ok(merged.npcs[0].portrait.dataUrl.startsWith('data:image/webp;base64,'));
    assert.equal(merged.npcs[1].name, 'Wiz');
    assert.ok(!merged.dismissed.includes('yunyun'));
    assert.ok(merged.dismissed.includes('luna'));
    assert.equal(merged.processedOocMessageId, null);
});

test('import merge can exclude the current player or main card', () => {
    const megumin = createNpcRecord('Megumin');
    const yunyun = createNpcRecord('Yunyun');
    const merged = mergeImportedDossierState({ npcs: [], dismissed: [] }, {
        npcs: [megumin, yunyun],
        dismissed: [],
    }, { maxNpcs: 6, excludeNames: ['Megumin'] });
    assert.deepEqual(merged.npcs.map(npc => npc.name), ['Yunyun']);
});


test('v0.2.7 import roster cap counts only active dossiers and preserves archives', () => {
    const archivedA = createNpcRecord('Old Knight');
    archivedA.archived = true;
    archivedA.archiveReason = 'stale';
    const archivedB = createNpcRecord('Dead Captain');
    archivedB.archived = true;
    archivedB.archiveReason = 'deceased';
    const activeA = createNpcRecord('Falia');
    const activeB = createNpcRecord('Marris');

    const merged = mergeImportedDossierState({ npcs: [], dismissed: [] }, {
        npcs: [archivedA, archivedB, activeA, activeB], dismissed: [],
    }, { maxNpcs: 1 });

    assert.equal(merged.npcs.filter(npc => npc.archived).length, 2, 'archives must not consume the active roster cap');
    assert.equal(merged.npcs.filter(npc => !npc.archived).length, 1);
    assert.ok(merged.npcs.some(npc => npc.name === 'Falia'));
});

test('v0.2.10 bundle/import preserves hidden relationship weight progress and dedupe history', () => {
    const npc = createNpcRecord('Myla');
    npc.relationship = { trust: 95, affection: 40, desire: 0, tension: 0 };
    npc.relationshipProgress = { trust: 0.7, affection: 0.25, desire: 0, tension: 0 };
    npc.relationshipEventHistory = [{
        impact: 'ordinary',
        reason: 'The player returned Myla\'s medicine.',
        evidence: { trust: 'Returning the medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        sourceMessageId: 10,
        turn: 5,
    }];
    const bytes = encodeNpcStateBundle({ npcs: [npc], dismissed: [] }, { appVersion: '0.2.10', chatKey: 'chat:weight' });
    const decoded = decodeNpcStateBundle(bytes);
    assert.deepEqual(decoded.state.npcs[0].relationshipProgress, npc.relationshipProgress);
    assert.equal(decoded.state.npcs[0].relationshipEventHistory.length, 1);

    const merged = mergeImportedDossierState({ npcs: [], dismissed: [] }, decoded.state, { maxNpcs: 6 });
    assert.deepEqual(merged.npcs[0].relationshipProgress, npc.relationshipProgress);
    assert.match(merged.npcs[0].relationshipEventHistory[0].reason, /medicine/i);
});
