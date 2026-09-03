import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    RELATIONSHIP_HISTORY_DEFAULT,
    RELATIONSHIP_HISTORY_MAX,
    normalizeRelationshipHistoryLimit,
    relationshipAxisIndependencePrompt,
    trimRelationshipHistory,
    trimStateRelationshipHistory,
} from '../v03/relationship-policy.js';

const engineSource = readFileSync(new URL('../v03/engine.js', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../v03/relationship-history-ui.js', import.meta.url), 'utf8');
const dossierSource = readFileSync(new URL('../v03/dossier-view.js', import.meta.url), 'utf8');

test('relationship history defaults to eight and can be configured through the safety ceiling', () => {
    assert.equal(RELATIONSHIP_HISTORY_DEFAULT, 8);
    assert.equal(RELATIONSHIP_HISTORY_MAX, 24);
    assert.equal(normalizeRelationshipHistoryLimit(undefined), 8);
    assert.equal(normalizeRelationshipHistoryLimit(0), 1);
    assert.equal(normalizeRelationshipHistoryLimit(4), 4);
    assert.equal(normalizeRelationshipHistoryLimit(99), 24);
});

test('relationship history rotates oldest events and preserves newest order', () => {
    const npc = { id: 'npc-a', relationshipHistory: Array.from({ length: 10 }, (_, index) => ({ turn: index + 1 })) };
    const trimmed = trimRelationshipHistory(npc, 4);
    assert.deepEqual(trimmed.relationshipHistory.map(item => item.turn), [7, 8, 9, 10]);
    assert.equal(npc.relationshipHistory.length, 10, 'helper must not mutate the source dossier');

    const state = { npcs: [npc, { id: 'npc-b', relationshipHistory: [{ turn: 1 }] }] };
    const next = trimStateRelationshipHistory(state, 3);
    assert.deepEqual(next.npcs[0].relationshipHistory.map(item => item.turn), [8, 9, 10]);
    assert.equal(next.npcs[1].relationshipHistory.length, 1);
});

test('axis independence requires distinct evidence instead of sentiment spreading', () => {
    const prompt = relationshipAxisIndependencePrompt();
    assert.match(prompt, /Score trust, affection, desire, and tension independently/);
    assert.match(prompt, /distinct evidence for that specific axis/);
    assert.match(prompt, /Multiple axes may change from one event only when there is separate concrete evidence/);
    assert.match(prompt, /does not automatically imply/);
});

test('engine applies the working history cap to scans refreshes and manual relationship edits', () => {
    assert.match(engineSource, /trimStateRelationshipHistory\(applied\.state, relationshipHistoryLimit\)/);
    assert.match(engineSource, /relationshipHistory = \[\.\.\.\(current\.relationshipHistory \|\| \[\]\), event\]\.slice\(-relationshipHistoryLimit\)/);
    assert.match(engineSource, /relationshipAxisIndependencePrompt\(\)/);
});

test('relationship history setting is mounted in dossier evolution and loaded by bootstrap', () => {
    assert.match(bootstrapSource, /startRelationshipHistoryUi/);
    assert.match(uiSource, /npc_state_v3_relationship_history_limit/);
    assert.match(uiSource, /npc-state-v3-dossier-evolution > \.npc-state-settings-grid/);
    assert.match(uiSource, /Oldest entries rotate out first/);
    assert.match(uiSource, /applyVisibleLimit\(\)/);
});

test('dossier keeps up to the safety ceiling available while eight remains the no-script default', () => {
    assert.match(dossierSource, /relationshipHistory\.slice\(-24\)\.reverse\(\)/);
    assert.match(dossierSource, /index >= 8 \? ' hidden' : ''/);
});
