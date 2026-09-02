import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../v03/editor-responsive.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('dossier editor can shrink and scroll inside the mobile sheet', () => {
    assert.match(css, /\.npc-state-v3-editor-grid\s*\{\s*min-height:0\s*\}/);
    assert.match(css, /flex:1 1 auto/);
    assert.match(css, /overflow-y:auto/);
    assert.match(css, /safe-area-inset-top/);
    assert.match(css, /safe-area-inset-bottom/);
});

test('mobile editor shell is pinned by inset instead of viewport-unit sizing', () => {
    assert.match(css, /\.npc-state-v3-editor-overlay\s*\{[^}]*position:fixed!important;[^}]*inset:0!important;/s);
    assert.match(css, /\.npc-state-v3-editor-shell\s*\{[^}]*position:absolute!important;[^}]*inset:0!important;/s);
    assert.match(css, /width:auto!important/);
    assert.match(css, /height:auto!important/);
    assert.doesNotMatch(css, /100dvh|100vw/);
});

test('mobile editor stays visible and pointer-active above the dossier', () => {
    assert.match(css, /z-index:2147483600!important/);
    assert.match(css, /display:block!important/);
    assert.match(css, /visibility:visible!important/);
    assert.match(css, /pointer-events:auto!important/);
});

test('runtime bootstrap loads the responsive editor stylesheet', () => {
    assert.match(bootstrap, /\.\/v03\/editor-responsive\.css/);
    assert.match(bootstrap, /data-npc-state-editor-responsive|npcStateEditorResponsive/);
});
