import test from 'node:test';
import assert from 'node:assert/strict';
import {
    castRailHtml,
    dossierHtml,
    dossierStatusLabel,
    filterDossierNpcs,
    sortDossierNpcs,
} from '../v03/dossier-view.js';
import { normalizeNpc } from '../v03/schema.js';

function npc(id, name, patch = {}) {
    return normalizeNpc({ id, name, ...patch });
}

test('dossier library sorting prioritizes present, then world-active, then ordinary active, then archived NPCs', () => {
    const rows = sortDossierNpcs([
        npc('archive', 'Archive', { archived: true }),
        npc('away', 'Away'),
        npc('world', 'World', { worldActive: true }),
        npc('present', 'Present', { present: true }),
    ]);
    assert.deepEqual(rows.map(item => item.id), ['present', 'world', 'away', 'archive']);
});

test('dossier library search matches name, alias, role, species, and lifecycle state', () => {
    const rows = [
        npc('maren', 'Maren Kroll', { aliases: ['Ledger Hawk'], role: 'Guild Clerk', species: 'Human', present: true }),
        npc('astra', 'Astra', { role: 'Guesthouse Keeper', species: 'Chimera' }),
    ];
    assert.deepEqual(filterDossierNpcs(rows, 'ledger').map(item => item.id), ['maren']);
    assert.deepEqual(filterDossierNpcs(rows, 'clerk').map(item => item.id), ['maren']);
    assert.deepEqual(filterDossierNpcs(rows, 'chimera').map(item => item.id), ['astra']);
    assert.deepEqual(filterDossierNpcs(rows, 'present').map(item => item.id), ['maren']);
});

test('portrait-first dossier renderer emits hero, current state, relationship, and modular profile blocks', () => {
    const maren = npc('maren', 'Maren Kroll', {
        role: 'Guild Clerk',
        species: 'Human',
        apparentAge: '25',
        portrait: { dataUrl: 'data:image/png;base64,abc' },
        mood: 'Cold and rigid',
        location: 'Guild Hall',
        goal: 'Enforce guild standards',
        status: 'Defiant',
        personality: 'Pragmatic',
        appearance: 'Dark hair and grey vest',
        behaviorProfile: ['States risks plainly'],
        speech: 'Clipped and direct',
        mannerisms: ['Taps the ledger'],
        memories: ['Caught a fraudulent bounty claim'],
        keyRelationships: ['Jarek · distrusted'],
        background: 'Veteran guild clerk',
    });
    const html = dossierHtml(maren);
    assert.match(html, /npc-state-v3-dossier-hero/);
    assert.match(html, /npc-state-v3-hero-portrait/);
    assert.match(html, />Current</);
    assert.match(html, />Relationship with player</);
    assert.match(html, />Personality</);
    assert.match(html, />Appearance</);
    assert.match(html, />Behavioral profile</);
    assert.match(html, />Speech</);
    assert.match(html, />Mannerisms</);
    assert.match(html, />Important memories</);
    assert.match(html, />Background</);
    assert.match(html, /<div class="npc-state-v3-dossier-block /);
    assert.doesNotMatch(html, /<section class="npc-state-v3-dossier-block/);
});

test('cast rail uses portrait cards and marks only the selected stable ID active', () => {
    const rows = [
        npc('harl', 'Harl', { present: true }),
        npc('maren', 'Maren Kroll', { role: 'Guild Clerk', present: true, portrait: { dataUrl: 'data:image/png;base64,abc' } }),
        npc('anke', 'Anke Karr'),
    ];
    const html = castRailHtml(rows, 'maren');
    assert.equal((html.match(/npc-state-v3-cast-card active/g) || []).length, 1);
    assert.match(html, /data-npc-id="maren" aria-pressed="true"/);
    assert.match(html, /npc-state-v3-cast-image/);
    assert.match(html, /Maren Kroll/);
    assert.equal(dossierStatusLabel(rows[2]), 'Off-screen');
});
