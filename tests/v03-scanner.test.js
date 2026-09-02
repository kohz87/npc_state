import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScanResult, buildScanPrompt, currentExchange, keyRelationshipReferencesPlayer } from '../v03/scanner.js';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';

function stateWith(...npcs) {
    const state = createEmptyState('chat:test:one');
    state.npcs = npcs.map(npc => normalizeNpc(npc));
    return state;
}

test('current exchange is the adjacent user + assistant pair, not older history', () => {
    const chat = [
        { is_user: true, mes: 'old user' },
        { is_user: false, mes: 'old assistant' },
        { is_user: true, mes: 'new user' },
        { is_user: false, mes: 'new assistant' },
    ];
    const exchange = currentExchange(chat, 3);
    assert.equal(exchange.user.id, 2);
    assert.equal(exchange.assistant.id, 3);
});

test('target set is exactly exchange participants union final physical presence', () => {
    const state = stateWith(
        { id: 'a', name: 'Astra', present: true, personality: 'steady' },
        { id: 'b', name: 'Mira', present: true, personality: 'old' },
        { id: 'c', name: 'Neri', present: false },
    );
    const result = {
        exchangeActiveNpcIds: ['Astra'],
        finalPresentNpcIds: ['Neri'],
        worldActiveNpcIds: ['Mira'],
        npcs: [
            { id: 'a', name: 'Astra', mood: 'alert' },
            { id: 'b', name: 'Mira', personality: 'should not deep patch', location: 'southern road' },
            { id: 'c', name: 'Neri', mood: 'watchful' },
        ],
        socialEdges: [],
    };
    const applied = applyScanResult(state, result, { sourceMessageId: 9, turn: 1 });
    assert.deepEqual(new Set(applied.targetNpcIds), new Set(['a', 'c']));
    assert.equal(applied.state.npcs.find(n => n.id === 'a').present, false);
    assert.equal(applied.state.npcs.find(n => n.id === 'b').present, false);
    assert.equal(applied.state.npcs.find(n => n.id === 'c').present, true);
    assert.equal(applied.state.npcs.find(n => n.id === 'b').worldActive, true);
    assert.equal(applied.state.npcs.find(n => n.id === 'b').personality, 'old');
    assert.equal(applied.state.npcs.find(n => n.id === 'b').location, 'southern road', 'world-active NPC may receive grounded live-state updates without entering full target set');
});

test('mere mention cannot replay a relationship delta', () => {
    const state = stateWith(
        { id: 'a', name: 'Astra', relationship: { trust: 5, affection: 0, desire: 0, tension: 0 } },
        { id: 'm', name: 'Mira', relationship: { trust: 7, affection: 0, desire: 0, tension: 0 } },
    );
    const result = {
        exchangeActiveNpcIds: ['Astra'],
        finalPresentNpcIds: ['Astra'],
        worldActiveNpcIds: [],
        npcs: [
            { id: 'a', name: 'Astra', relationshipChange: { impact: 'major', delta: { trust: 99 }, evidence: 'Astra was directly rescued.', reason: 'Direct rescue.' } },
            { id: 'm', name: 'Mira', relationshipChange: { impact: 'extreme', delta: { trust: 99 }, evidence: 'Mira was mentioned by name.', reason: 'Mention only.' } },
        ],
        socialEdges: [],
    };
    const applied = applyScanResult(state, result, { sourceMessageId: 5, turn: 2, relationshipCaps: { ordinary: 1, meaningful: 2, major: 5, extreme: 10 } });
    assert.equal(applied.state.npcs.find(n => n.id === 'a').relationship.trust, 10, 'major delta is code-clamped to +5');
    assert.equal(applied.state.npcs.find(n => n.id === 'm').relationship.trust, 7, 'mentioned NPC receives no relationship change');
});

test('exchange-active death stays a target even though final physical presence is false', () => {
    const state = stateWith({ id: 'a', name: 'Astra', present: true, lifeState: 'alive' });
    const applied = applyScanResult(state, {
        exchangeActiveNpcIds: ['Astra'], finalPresentNpcIds: [], worldActiveNpcIds: [],
        npcs: [{ id: 'a', name: 'Astra', lifeState: 'dead', lifeStateCertainty: 'explicit', lifeStateReason: 'She dies in the current exchange.' }], socialEdges: [],
    }, { sourceMessageId: 7, turn: 3 });
    const npc = applied.state.npcs[0];
    assert.deepEqual(applied.targetNpcIds, ['a']);
    assert.equal(npc.archived, true);
    assert.equal(npc.archiveReason, 'deceased');
    assert.equal(npc.present, false);
});

test('targeted refresh preserves live presence, observation, and relationship scores', () => {
    const state = stateWith(
        { id: 'a', name: 'Astra', present: true, relationship: { trust: 10, affection: 1, desire: 0, tension: 0 }, personality: 'old' },
        { id: 'b', name: 'Mira', present: false },
    );
    state.lastScannedMessageId = 4;
    state.lastObservation = { messageId: 4, exchangeActiveNpcIds: ['a'], finalPresentNpcIds: ['a'], worldActiveNpcIds: [], targetNpcIds: ['a'] };
    const applied = applyScanResult(state, {
        exchangeActiveNpcIds: [], finalPresentNpcIds: [], worldActiveNpcIds: [],
        npcs: [{ id: 'a', name: 'Astra', personality: 'recovered profile', relationshipChange: { impact: 'extreme', delta: { trust: -10 }, evidence: 'old history', reason: 'old' } }], socialEdges: [],
    }, { sourceMessageId: 8, turn: 4, preservePresence: true, preserveObservation: true, applyRelationship: false, allowHistoricalProfilePatches: true });
    assert.equal(applied.state.npcs.find(n => n.id === 'a').present, true);
    assert.equal(applied.state.npcs.find(n => n.id === 'a').relationship.trust, 10);
    assert.equal(applied.state.npcs.find(n => n.id === 'a').personality, 'recovered profile');
    assert.equal(applied.state.lastScannedMessageId, 4);
    assert.equal(applied.state.lastObservation.messageId, 4);
});

test('a tombstoned stable ID cannot be recreated by scanner output', () => {
    const state = stateWith();
    state.deletedNpcIds = ['npc-old-mira'];
    const applied = applyScanResult(state, {
        exchangeActiveNpcIds: ['npc-old-mira'], finalPresentNpcIds: ['npc-old-mira'], worldActiveNpcIds: [],
        npcs: [{ id: 'npc-old-mira', name: 'Mira', personality: 'should never return' }], socialEdges: [],
    }, { sourceMessageId: 11, turn: 2 });
    assert.equal(applied.state.npcs.length, 0);
    assert.deepEqual(applied.targetNpcIds, []);
});

test('an unknown model ID cannot retarget a same-name live dossier', () => {
    const state = stateWith({ id: 'mira-live', name: 'Mira', personality: 'canonical' });
    const applied = applyScanResult(state, {
        exchangeActiveNpcIds: ['Mira'], finalPresentNpcIds: ['Mira'], worldActiveNpcIds: [],
        npcs: [{ id: 'invented-id', name: 'Mira', personality: 'wrong identity patch' }], socialEdges: [],
    }, { sourceMessageId: 12, turn: 3 });
    assert.equal(applied.state.npcs.length, 1);
    assert.equal(applied.state.npcs[0].id, 'mira-live');
    assert.equal(applied.state.npcs[0].personality, 'canonical');
    assert.equal(applied.state.npcs[0].present, true, 'participant resolution can still use the canonical name for presence');
});

test('scan prompt reserves the current persona for the dedicated player relationship channel', () => {
    const state = stateWith({ id: 'a', name: 'Astra' });
    const chat = [
        { is_user: true, name: 'Lucien Valentine', mes: 'I help Astra.' },
        { is_user: false, name: 'Narrator', mes: 'Astra accepts the help.' },
    ];
    const prompt = buildScanPrompt({ state, chat, assistantMessageId: 1 });
    assert.match(prompt, /PLAYER IDENTITY:[\s\S]*"name":"Lucien Valentine"/);
    assert.match(prompt, /relationship, relationshipSummary, and relationshipChange describe THIS NPC toward the PLAYER/);
    assert.match(prompt, /keyRelationships contains significant NON-PLAYER ties only/);
    assert.match(prompt, /apparentAge is separate from actual age[\s\S]*written exactly as ~N/);
});

test('player references are removed from keyRelationships while the player meter still changes', () => {
    const state = stateWith({
        id: 'a',
        name: 'Astra',
        keyRelationships: ['Lucien Valentine - rescuer', 'Mira - sister'],
        relationship: { trust: 3, affection: 1, desire: 0, tension: 0 },
    });
    const applied = applyScanResult(state, {
        exchangeActiveNpcIds: ['Astra'], finalPresentNpcIds: ['Astra'], worldActiveNpcIds: [],
        npcs: [{
            id: 'a',
            name: 'Astra',
            keyRelationships: ['Lucien Valentine - player character', 'Neri - rival'],
            relationshipSummary: 'Astra increasingly trusts Lucien.',
            relationshipChange: { impact: 'ordinary', delta: { trust: 1 }, evidence: 'Lucien kept his promise.', reason: 'Promise fulfilled.' },
        }],
        socialEdges: [],
    }, {
        sourceMessageId: 13,
        turn: 4,
        playerName: 'Lucien Valentine',
        relationshipCaps: { ordinary: 1, meaningful: 2, major: 5, extreme: 10 },
    });
    const npc = applied.state.npcs[0];
    assert.deepEqual(npc.keyRelationships, ['Mira - sister', 'Neri - rival']);
    assert.equal(npc.relationship.trust, 4);
    assert.equal(npc.relationshipSummary, 'Astra increasingly trusts Lucien.');
});

test('player-reference detector recognizes persona names and explicit player labels', () => {
    assert.equal(keyRelationshipReferencesPlayer('Lucien Valentine - trusted ally', 'Lucien Valentine'), true);
    assert.equal(keyRelationshipReferencesPlayer('The player character - rescuer', 'Lucien Valentine'), true);
    assert.equal(keyRelationshipReferencesPlayer('Mira - sister', 'Lucien Valentine'), false);
});
