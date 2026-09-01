import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// This file is intentionally regenerated below from the current branch in the hardening workflow.
// Placeholder retained only to avoid testing stale v0.2.12 source assertions during the staged patch.

test('v0.2.13 runtime source retains core UI and hydration safety hooks', () => {
    assert.match(index, /function renderDossier/);
    assert.match(index, /function renderInlineCards/);
    assert.match(index, /inlineMountNeedsRepair/);
    assert.match(index, /CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /MESSAGE_UPDATED/);
    assert.match(index, /hasCompactMeguminWorldState/);
    assert.match(index, /preserveWorldActive: compactWorldStateTurn/);
    assert.match(index, /chatHydrationStatus/);
    assert.match(index, /assertChatHydratedForWrite/);
    assert.match(index, /mergeBaseState/);
    assert.match(style, /npc-state/);
});
