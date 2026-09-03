import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection } from '../v03/injection.js';
import { createEmptyState, normalizeNpc, normalizeState } from '../v03/schema.js';

test('injection contains only strict physically present active dossiers', () => {
    const state = createEmptyState('chat:test:inject');
    state.npcs = [
        normalizeNpc({ id: 'present', name: 'Astra', present: true }),
        normalizeNpc({ id: 'world', name: 'Mira', worldActive: true }),
        normalizeNpc({ id: 'archived', name: 'Neri', present: true, archived: true }),
    ];
    const prompt = buildInjection(state, { enabled: true, inject: true, injectLimit: 6, injectBudgetTokens: 1800 });
    assert.match(prompt, /Astra/);
    assert.doesNotMatch(prompt, /Mira/);
    assert.doesNotMatch(prompt, /Neri/);
});

test('rebase-required branch state injects nothing', () => {
    const state = createEmptyState('chat:test:unsafe');
    state.npcs = [normalizeNpc({ id: 'a', name: 'Astra', present: true })];
    state.branchSafety = { status: 'rebase-required', kind: 'prebaseline-truncation', reason: 'test' };
    assert.equal(buildInjection(state, { enabled: true, inject: true }), '');
});

test('legacy v0.3.1 prebaseline-diverged state normalizes into rebase-required and injects nothing', () => {
    const state = normalizeState({
        ...createEmptyState('chat:test:legacy-unsafe'),
        npcs: [normalizeNpc({ id: 'a', name: 'Astra', present: true })],
        branchSafety: { status: 'prebaseline-diverged', reason: 'legacy test' },
    }, 'chat:test:legacy-unsafe');
    assert.equal(state.branchSafety.status, 'rebase-required');
    assert.equal(state.branchSafety.kind, 'legacy-prebaseline-divergence');
    assert.equal(buildInjection(state, { enabled: true, inject: true }), '');
});
