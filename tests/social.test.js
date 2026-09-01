import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, mergeScanResult, scoreNpcRelevance } from '../core.js';
import {
    normalizeSocialGraph,
    reconcileSocialState,
    applyManualKeyRelationshipEdit,
    removeNpcFromSocialGraph,
    purgeNpcStructuredReferences,
} from '../social.js';

function stateWith(...npcs) {
    return { npcs, candidates: [], dismissed: [], socialGraph: normalizeSocialGraph(), turn: 1 };
}

test('v0.2.12 interim identity promotion rewrites neighboring family references to canonical name without duplicate fossil', () => {
    const thunderbird = createNpcRecord('Thunderbird');
    thunderbird.identityKind = 'role_label';
    const astra = createNpcRecord('Astra', [thunderbird.id]);
    astra.keyRelationships = ['Thunderbird — clone sister'];
    const result = mergeScanResult(stateWith(thunderbird, astra), {
        npcs: [{ id: thunderbird.id, name: 'Mina', aliases: ['Thunderbird'], identityKind: 'proper_name', sameIndividual: true, present: true }],
    }, { turn: 2, preservePresence: true, developmentContext: 'The Thunderbird girl formally introduces herself as Mina.' });
    const mina = result.state.npcs.find(npc => npc.id === thunderbird.id);
    const savedAstra = result.state.npcs.find(npc => npc.id === astra.id);
    assert.equal(mina.name, 'Mina');
    assert.ok(mina.aliases.includes('Thunderbird'));
    assert.deepEqual(savedAstra.keyRelationships, ['Mina — clone sister']);
    assert.equal(savedAstra.keyRelationships.some(entry => /Thunderbird/.test(entry)), false);
    const edge = result.state.socialGraph.edges.find(item => [item.aId, item.bId].includes(mina.id) && [item.aId, item.bId].includes(astra.id));
    assert.ok(edge, 'clone-sister relationship should be id-backed in the social graph');
});

test('v0.2.12 multi-hop canonical rename keeps old labels as aliases while structured relationships show only newest name', () => {
    const mina = createNpcRecord('Mina');
    mina.aliases = ['Thunderbird'];
    const astra = createNpcRecord('Astra', [mina.id]);
    astra.keyRelationships = ['Thunderbird — clone sister', 'Mina — clone sister | fiercely protective'];
    let state = reconcileSocialState(stateWith(mina, astra), { provenance: 'migration' }).state;
    const promoted = mergeScanResult(state, {
        npcs: [{ id: mina.id, name: 'Mina Vale', aliases: ['Mina', 'Thunderbird'], sameIndividual: true, identityKind: 'proper_name' }],
    }, { turn: 2, preservePresence: true });
    const saved = promoted.state.npcs.find(npc => npc.id === astra.id);
    assert.equal(saved.keyRelationships.length, 1);
    assert.match(saved.keyRelationships[0], /^Mina Vale — clone sister/);
    assert.match(saved.keyRelationships[0], /fiercely protective/);
    assert.equal(saved.keyRelationships[0].includes('Thunderbird'), false);
});

test('v0.2.12 two unnamed daughters become count-aware unresolved slots and resolve later without creating a third child', () => {
    const brina = createNpcRecord('Brina Hael');
    brina.background = 'A widow and mother of two daughters.';
    let state = reconcileSocialState(stateWith(brina), { provenance: 'migration' }).state;
    assert.equal(state.socialGraph.unresolved.filter(slot => slot.ownerId === brina.id).length, 2);

    const liza = createNpcRecord('Liza Hael', [brina.id]);
    const tessa = createNpcRecord('Tessa Hael', [brina.id, liza.id]);
    state.npcs.push(liza, tessa);
    brina.keyRelationships = ['Liza Hael — daughter', 'Tessa Hael — daughter'];
    state = reconcileSocialState(state, { provenance: 'scanner', confidence: 'explicit' }).state;
    assert.equal(state.socialGraph.unresolved.filter(slot => slot.ownerId === brina.id).length, 0);
    const childEdges = state.socialGraph.edges.filter(edge => {
        if (edge.aId === brina.id) return /daughter|child/i.test(edge.aToB);
        if (edge.bId === brina.id) return /daughter|child/i.test(edge.bToA);
        return false;
    });
    assert.equal(childEdges.length, 2);
    const sibling = state.socialGraph.edges.find(edge => [edge.aId, edge.bId].includes(liza.id) && [edge.aId, edge.bId].includes(tessa.id));
    assert.ok(sibling);
    assert.match(`${sibling.aToB} ${sibling.bToA}`, /sibling/i);
});

test('v0.2.12 partial named child resolution consumes one slot while unrelated named NPC does not resolve remaining family', () => {
    const brina = createNpcRecord('Brina Hael');
    brina.background = 'Mother of two daughters.';
    let state = reconcileSocialState(stateWith(brina), { provenance: 'migration' }).state;
    const liza = createNpcRecord('Liza Hael', [brina.id]);
    state.npcs.push(liza);
    brina.keyRelationships = ['Liza Hael — daughter'];
    state = reconcileSocialState(state, { provenance: 'scanner', confidence: 'explicit' }).state;
    assert.equal(state.socialGraph.unresolved.filter(slot => slot.ownerId === brina.id).length, 1);

    const clara = createNpcRecord('Clara', [brina.id, liza.id]);
    state.npcs.push(clara);
    state = reconcileSocialState(state, { provenance: 'scanner' }).state;
    assert.equal(state.socialGraph.unresolved.filter(slot => slot.ownerId === brina.id).length, 1, 'mere appearance of a proper name must not guess family membership');
});

test('v0.2.12 twin daughters infer symmetric twin sibling relation without older-younger invention', () => {
    const brina = createNpcRecord('Brina Hael');
    let state = stateWith(brina);
    state = reconcileSocialState(state, { transcript: 'Brina Hael has two twin daughters.', provenance: 'transcript', sourceMessageId: 4, turn: 2 }).state;
    assert.equal(state.socialGraph.unresolved.length, 2);
    assert.ok(state.socialGraph.unresolved.every(slot => slot.sharedDescriptor === 'twins'));
    const a = createNpcRecord('Astra', [brina.id]);
    const m = createNpcRecord('Mina', [brina.id, a.id]);
    state.npcs.push(a, m);
    brina.keyRelationships = ['Astra — daughter', 'Mina — daughter'];
    state = reconcileSocialState(state, { provenance: 'scanner', confidence: 'explicit' }).state;
    const sibling = state.socialGraph.edges.find(edge => [edge.aId, edge.bId].includes(a.id) && [edge.aId, edge.bId].includes(m.id));
    assert.ok(sibling);
    assert.match(`${sibling.aToB} ${sibling.bToA}`, /twin sibling/i);
    assert.doesNotMatch(`${sibling.aToB} ${sibling.bToA}`, /older|younger|elder/i);
});

test('v0.2.12 deceased counterpart remains in graph and projects a deceased family note instead of losing the relation', () => {
    const brina = createNpcRecord('Brina Hael');
    brina.lifeState = 'deceased';
    brina.archived = true;
    const liza = createNpcRecord('Liza Hael', [brina.id]);
    liza.keyRelationships = ['Brina Hael — mother'];
    const state = reconcileSocialState(stateWith(brina, liza), { provenance: 'migration' }).state;
    const saved = state.npcs.find(npc => npc.id === liza.id);
    assert.match(saved.keyRelationships.join(' '), /Brina Hael — mother/i);
    assert.match(saved.keyRelationships.join(' '), /deceased/i);
    assert.ok(state.socialGraph.edges.some(edge => [edge.aId, edge.bId].includes(brina.id) && [edge.aId, edge.bId].includes(liza.id)));
});

test('v0.2.12 manual key relationship edits update and remove graph edges deterministically', () => {
    const brina = createNpcRecord('Brina Hael');
    const liza = createNpcRecord('Liza Hael', [brina.id]);
    let state = stateWith(brina, liza);
    applyManualKeyRelationshipEdit(state, brina.id, [], ['Liza Hael — daughter'], { turn: 2 });
    assert.equal(state.socialGraph.edges.length, 1);
    applyManualKeyRelationshipEdit(state, brina.id, ['Liza Hael — daughter'], [], { turn: 3 });
    assert.equal(state.socialGraph.edges.length, 0);
});

test('v0.2.12 hard deletion removes graph edges and stale structured references', () => {
    const brina = createNpcRecord('Brina Hael');
    const liza = createNpcRecord('Liza Hael', [brina.id]);
    liza.keyRelationships = ['Brina Hael — mother'];
    let state = reconcileSocialState(stateWith(brina, liza), { provenance: 'migration' }).state;
    state.socialGraph = removeNpcFromSocialGraph(state.socialGraph, brina.id);
    purgeNpcStructuredReferences(state.npcs, brina);
    state.npcs = state.npcs.filter(npc => npc.id !== brina.id);
    assert.equal(state.socialGraph.edges.some(edge => edge.aId === brina.id || edge.bId === brina.id), false);
    assert.equal(state.npcs[0].keyRelationships.some(entry => /Brina Hael/i.test(entry)), false);
});

test('v0.2.12 hidden graph relationships can raise runtime salience even when not projected into top-five key relationships', () => {
    const parent = createNpcRecord('Marris');
    const child = createNpcRecord('Tessa', [parent.id]);
    const others = Array.from({ length: 5 }, (_, i) => createNpcRecord(`Bond ${i + 1}`, [parent.id, child.id]));
    parent.keyRelationships = others.map(npc => `${npc.name} — colleague`);
    const graph = normalizeSocialGraph({ edges: [{ aId: parent.id, bId: child.id, aToB: 'daughter', bToA: 'parent', confidence: 'explicit' }] });
    const score = scoreNpcRelevance(parent, 'Tessa is missing beyond the north gate.', 10, graph, [parent, child, ...others]);
    assert.ok(score >= 2, 'hidden graph counterpart mention should contribute runtime relevance');
});

test('v0.2.12 unnamed-family parser handles singular, twin-without-count, and explicit parent-of phrasing without distant descriptor contamination', () => {
    const brina = createNpcRecord('Brina Hael');
    let s1 = reconcileSocialState(stateWith(brina), { transcript: 'Brina Hael has a daughter.', provenance: 'transcript' }).state;
    assert.equal(s1.socialGraph.unresolved.length, 1);

    const mara = createNpcRecord('Mara', [brina.id]);
    let s2 = reconcileSocialState(stateWith(mara), { transcript: 'Mara has twin daughters.', provenance: 'transcript' }).state;
    assert.equal(s2.socialGraph.unresolved.length, 2);
    assert.ok(s2.socialGraph.unresolved.every(slot => slot.sharedDescriptor === 'twins'));

    const elena = createNpcRecord('Elena', [brina.id, mara.id]);
    let s3 = reconcileSocialState(stateWith(elena), { transcript: 'Elena is the mother of two daughters. Much later an older guard argues with a younger recruit.', provenance: 'transcript' }).state;
    assert.equal(s3.socialGraph.unresolved.length, 2);
    assert.ok(s3.socialGraph.unresolved.every(slot => !slot.descriptor), 'unrelated older/younger wording must not leak into daughter descriptors');
});

test('v0.2.12 descriptor-aware partial resolution prefers the explicitly matching older daughter slot', () => {
    const brina = createNpcRecord('Brina');
    let state = reconcileSocialState(stateWith(brina), { transcript: 'Brina has two daughters, an older daughter and a younger daughter.', provenance: 'transcript' }).state;
    assert.deepEqual(state.socialGraph.unresolved.map(slot => slot.descriptor).sort(), ['older', 'younger']);
    const liza = createNpcRecord('Liza', [brina.id]);
    state.npcs.push(liza);
    brina.keyRelationships = ['Liza — older daughter'];
    state = reconcileSocialState(state, { provenance: 'scanner', confidence: 'explicit' }).state;
    assert.equal(state.socialGraph.unresolved.length, 1);
    assert.equal(state.socialGraph.unresolved[0].descriptor, 'younger');
    const edge = state.socialGraph.edges.find(item => [item.aId, item.bId].includes(brina.id) && [item.aId, item.bId].includes(liza.id));
    assert.ok(edge?.groupId, 'resolved named child should inherit the family-group id');
});

test('v0.2.12 pre-existing split interim/proper dossiers merge conservatively and remap social edges to the survivor id', () => {
    const thunderbird = createNpcRecord('Thunderbird');
    thunderbird.identityKind = 'role_label';
    thunderbird.relationship.trust = 12;
    thunderbird.seenCount = 5;
    const mina = createNpcRecord('Mina', [thunderbird.id]);
    mina.aliases = ['Thunderbird'];
    mina.identityKind = 'proper_name';
    mina.createdAt = thunderbird.createdAt + 100;
    const astra = createNpcRecord('Astra', [thunderbird.id, mina.id]);
    const state = stateWith(thunderbird, mina, astra);
    state.socialGraph = normalizeSocialGraph({ edges: [{ aId: astra.id, bId: mina.id, aToB: 'clone sister', bToA: 'clone sister', confidence: 'explicit' }] });
    const result = mergeScanResult(state, { npcs: [] }, { turn: 2, preservePresence: true });
    const merged = result.state.npcs.filter(npc => npcMatches(npc, 'Mina'));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, thunderbird.id, 'older stable dossier id should survive duplicate repair');
    assert.equal(merged[0].relationship.trust, 12, 'relationship history on the interim dossier must not be discarded');
    assert.ok(merged[0].aliases.includes('Thunderbird'));
    assert.equal(result.state.socialGraph.edges.some(edge => edge.aId === mina.id || edge.bId === mina.id), false, 'removed duplicate id must be remapped out of graph');
    assert.ok(result.report.deduplicated.length >= 1);
});

function npcMatches(npc, label) {
    const key = String(label).toLowerCase();
    return [npc.name, ...(npc.aliases || [])].some(value => String(value).toLowerCase() === key);
}

test('v0.2.12 ambiguous shared alias never forces canonical relationship merge', () => {
    const a = createNpcRecord('Guard A');
    const b = createNpcRecord('Guard B', [a.id]);
    a.aliases = ['Sentinel'];
    b.aliases = ['Sentinel'];
    const owner = createNpcRecord('Marris', [a.id, b.id]);
    owner.keyRelationships = ['Sentinel — colleague'];
    const state = reconcileSocialState(stateWith(a, b, owner), { provenance: 'migration' }).state;
    const saved = state.npcs.find(npc => npc.id === owner.id);
    assert.deepEqual(saved.keyRelationships, ['Sentinel — colleague']);
    assert.equal(state.socialGraph.edges.some(edge => edge.aId === owner.id || edge.bId === owner.id), false, 'ambiguous alias must remain unresolved instead of guessing a graph node');
});

test('v0.2.12 reconciliation prunes graph edges whose dossier endpoint was hard-pruned while keeping surviving structured prose safe', () => {
    const brina = createNpcRecord('Brina');
    const liza = createNpcRecord('Liza', [brina.id]);
    const state = stateWith(brina);
    state.socialGraph = normalizeSocialGraph({ edges: [{ aId: brina.id, bId: liza.id, aToB: 'daughter', bToA: 'parent', confidence: 'explicit' }] });
    const reconciled = reconcileSocialState(state, { provenance: 'migration' }).state;
    assert.equal(reconciled.socialGraph.edges.length, 0, 'dangling hidden ids must not survive dossier hard-prune');
});

test('v0.2.12 inferred sibling expansion cannot crowd explicit social edges out of a large family graph', () => {
    const parent = createNpcRecord('Parent');
    const mentor = createNpcRecord('Rook', [parent.id]);
    const children = Array.from({ length: 16 }, (_, i) => createNpcRecord(`Child ${i + 1}`, [parent.id, mentor.id]));
    const state = stateWith(parent, mentor, ...children);
    state.socialGraph = normalizeSocialGraph({ edges: [{ aId: parent.id, bId: mentor.id, aToB: 'friend', bToA: 'friend', confidence: 'explicit', reason: 'longstanding friendship' }] });
    parent.keyRelationships = children.slice(0, 5).map(child => `${child.name} — child`);
    for (const child of children) child.keyRelationships = [`${parent.name} — parent`];
    const reconciled = reconcileSocialState(state, { provenance: 'scanner', confidence: 'strong-context' }).state;
    assert.ok(reconciled.socialGraph.edges.some(edge => [edge.aId, edge.bId].includes(parent.id) && [edge.aId, edge.bId].includes(mentor.id) && /friend/i.test(`${edge.aToB} ${edge.bToA}`)));
    assert.ok(reconciled.socialGraph.edges.length <= 240);
});
