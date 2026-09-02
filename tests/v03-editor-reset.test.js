import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../v03/ui.js', import.meta.url), 'utf8');

test('editor uses the original direct ui.js open path without an interception coordinator', () => {
    assert.match(bootstrap, /await import\('\.\/v03\/index\.js'\);/);
    assert.doesNotMatch(bootstrap, /editor-responsive|editor-surface/);
    assert.match(ui, /\.npc-state-v3-edit'\)\?\.addEventListener\('click', event => openEditor\(event\.currentTarget\.dataset\.npcId\)\)/);
    assert.match(ui, /document\.body\.appendChild\(overlay\);/);
});

test('editor flex child gets only the shrink fix needed for internal scrolling', () => {
    assert.match(bootstrap, /\.npc-state-v3-editor-grid\{min-height:0\}/);
    assert.doesNotMatch(bootstrap, /100dvh|100vw|MutationObserver|capture/);
});
