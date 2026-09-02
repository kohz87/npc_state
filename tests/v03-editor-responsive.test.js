import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../v03/editor-responsive.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('dossier editor can shrink inside its flex shell and uses the dynamic mobile viewport', () => {
    assert.match(css, /\.npc-state-v3-editor-grid\s*\{\s*min-height:0\s*\}/);
    assert.match(css, /height:100dvh/);
    assert.match(css, /overflow-y:auto/);
    assert.match(css, /safe-area-inset-top/);
    assert.match(css, /safe-area-inset-bottom/);
});

test('mobile editor overlay is an explicit top-level viewport sheet above the dossier', () => {
    assert.match(css, /z-index:2147483647!important/);
    assert.match(css, /display:block!important/);
    assert.match(css, /position:fixed!important/);
    assert.match(css, /pointer-events:auto!important/);
});

test('runtime bootstrap loads the responsive editor stylesheet', () => {
    assert.match(bootstrap, /\.\/v03\/editor-responsive\.css/);
    assert.match(bootstrap, /data-npc-state-editor-responsive|npcStateEditorResponsive/);
});
