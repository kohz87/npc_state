import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { promoteEditorToTopLayer } from '../v03/editor-top-layer.js';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../v03/ui.js', import.meta.url), 'utf8');
const topLayer = readFileSync(new URL('../v03/editor-top-layer.js', import.meta.url), 'utf8');

test('editor keeps the original direct ui.js open path', () => {
    assert.match(ui, /\.npc-state-v3-edit'\)\?\.addEventListener\('click', event => openEditor\(event\.currentTarget\.dataset\.npcId\)\)/);
    assert.match(ui, /document\.body\.appendChild\(overlay\);/);
    assert.doesNotMatch(topLayer, /preventDefault|stopPropagation|MutationObserver|replaceWith|removeChild/);
});

test('top-layer bridge starts only after the normal v0.3 runtime', () => {
    const runtimeImport = bootstrap.indexOf("await import('./v03/index.js')");
    const bridgeImport = bootstrap.indexOf("await import('./v03/editor-top-layer.js')");
    assert.ok(runtimeImport >= 0);
    assert.ok(bridgeImport > runtimeImport);
    assert.match(bootstrap, /startEditorTopLayerBridge\(\);/);
});

test('mounted editor is promoted with the native popover top layer without recreation', () => {
    let shown = 0;
    const overlay = {
        dataset: {},
        matches: () => false,
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        showPopover() { shown += 1; },
    };
    const doc = { getElementById: id => id === 'npc_state_v3_editor_overlay' ? overlay : null };

    assert.equal(promoteEditorToTopLayer(doc), true);
    assert.equal(shown, 1);
    assert.equal(overlay.popover, 'manual');
    assert.equal(overlay.dataset.npcStateTopLayer, 'popover');
});

test('top-layer promotion fails safely when Popover API is unavailable', () => {
    const doc = { getElementById: () => ({}) };
    assert.equal(promoteEditorToTopLayer(doc), false);
});

test('legacy z-index and dossier-hiding hacks are no longer needed', () => {
    assert.match(bootstrap, /\.npc-state-v3-editor-grid\{min-height:0\}/);
    assert.match(bootstrap, /\.npc-state-v3-editor-overlay\[popover\]\{[^}]*margin:0!important;[^}]*border:0!important;[^}]*max-width:none!important;[^}]*max-height:none!important;/s);
    assert.doesNotMatch(bootstrap, /2147483647|body:has|backdrop-filter:none|100dvh|100vw|MutationObserver/);
});

test('tablet and mobile editor stays top anchored and whole-panel scrollable', () => {
    assert.match(bootstrap, /@media\(max-width:1180px\),\(hover:none\) and \(pointer:coarse\)/);
    assert.match(bootstrap, /\.npc-state-v3-editor-overlay\{[^}]*align-items:flex-start!important;[^}]*overflow-y:auto!important;/s);
    assert.match(bootstrap, /\.npc-state-v3-editor-shell\{[^}]*height:auto!important;[^}]*max-height:none!important;/s);
    assert.match(bootstrap, /\.npc-state-v3-editor-grid\{[^}]*flex:0 0 auto!important;[^}]*overflow:visible!important;/s);
});
