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

test('desktop editor keeps the flex shrink correction and owns the top layer', () => {
    assert.match(bootstrap, /\.npc-state-v3-editor-grid\{min-height:0\}/);
    assert.match(bootstrap, /\.npc-state-v3-editor-overlay\{[^}]*z-index:2147483647!important;[^}]*isolation:isolate;[^}]*background:rgba\(5,6,8,\.98\)!important;/s);
    assert.doesNotMatch(bootstrap, /100dvh|100vw|MutationObserver|capture/);
});

test('dossier is not rendered while the editor surface exists', () => {
    assert.match(bootstrap, /body:has\(> #npc_state_v3_editor_overlay\)>#npc_state_v3_library_overlay\{[^}]*display:none!important;/s);
});

test('tablet and mobile editor is top anchored and whole-panel scrollable', () => {
    assert.match(bootstrap, /@media\(max-width:1180px\),\(hover:none\) and \(pointer:coarse\)/);
    assert.match(bootstrap, /\.npc-state-v3-library-overlay\{[^}]*backdrop-filter:none!important;[^}]*-webkit-backdrop-filter:none!important;/s);
    assert.match(bootstrap, /\.npc-state-v3-editor-overlay\{[^}]*align-items:flex-start!important;[^}]*overflow-y:auto!important;/s);
    assert.match(bootstrap, /\.npc-state-v3-editor-shell\{[^}]*height:auto!important;[^}]*max-height:none!important;/s);
    assert.match(bootstrap, /\.npc-state-v3-editor-grid\{[^}]*flex:0 0 auto!important;[^}]*overflow:visible!important;/s);
});

test('mobile geometry does not reintroduce forced fullscreen positioning', () => {
    assert.doesNotMatch(bootstrap, /position:absolute!important|inset:0!important|visibility:visible!important|pointer-events:auto!important/);
});
