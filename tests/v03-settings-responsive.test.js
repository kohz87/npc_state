import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../v03/settings-layout.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../v03/settings-responsive.css', import.meta.url), 'utf8');

test('responsive settings stylesheet and coordinator load around the authoritative runtime', () => {
    const stylesheet = bootstrap.indexOf("new URL('./v03/settings-responsive.css'");
    const runtime = bootstrap.indexOf("await import('./v03/index.js')");
    const coordinator = bootstrap.indexOf("await import('./v03/settings-layout.js')");
    assert.ok(stylesheet >= 0);
    assert.ok(runtime > stylesheet, 'responsive stylesheet should be registered before runtime surfaces mount');
    assert.ok(coordinator > runtime, 'layout coordinator must run after ui.js owns and binds the real controls');
});

test('layout moves the existing enable input instead of replacing its authoritative listener', () => {
    assert.match(layout, /const enableInput = panel\.querySelector\('#npc_state_v3_enabled'\)/);
    assert.match(layout, /status\.appendChild\(enableInput\)/);
    assert.match(layout, /originalRow\?\.remove\?\.\(\)/);
    assert.doesNotMatch(layout, /cloneNode/);
});

test('settings hierarchy groups scanner maintenance portrait and cast surfaces', () => {
    assert.match(layout, /npc_state_v3_scanner_rules/);
    assert.match(layout, /Scanner rules/);
    assert.match(layout, /npc_state_v3_maintenance/);
    assert.match(layout, /Maintenance/);
    assert.match(layout, /npc_state_v3_portrait_prompt/);
    assert.match(layout, /label\.textContent = 'Portraits'/);
    assert.match(layout, /npc_state_v3_cast_settings/);
    assert.match(layout, /'Cast'/);
});

test('dossier evolution stays expanded by default without forcing it open after user interaction', () => {
    assert.match(layout, /if \(!section\.dataset\.npcStateResponsiveDefault\) \{/);
    assert.match(layout, /section\.open = true/);
    assert.match(layout, /section\.dataset\.npcStateResponsiveDefault = '1'/);
});

test('primary actions expose full and compact labels without changing button ids', () => {
    for (const id of ['npc_state_v3_scan_now', 'npc_state_v3_library', 'npc_state_v3_add']) {
        assert.match(layout, new RegExp(id));
    }
    assert.match(layout, /npc-state-v3-action-full/);
    assert.match(layout, /npc-state-v3-action-compact/);
});

test('settings observer filters unrelated body mutations before scheduling layout work', () => {
    assert.match(layout, /function mutationTouchesSettings\(records = \[\]\)/);
    assert.match(layout, /panel\.contains\?\.\(target\)/);
    assert.match(layout, /node\?\.id === PANEL_ID/);
    assert.match(layout, /if \(mutationTouchesSettings\(records\)\) scheduleApply\(\)/);
});

test('responsive density is container-driven for desktop tablet and phone', () => {
    assert.match(css, /container-type:inline-size/);
    assert.match(css, /@container \(max-width:899px\)/);
    assert.match(css, /@container \(min-width:700px\)/);
    assert.match(css, /@container \(min-width:900px\)/);
    assert.match(css, /@container \(max-width:559px\)/);
    assert.doesNotMatch(css, /@media\s*\(/, 'settings density should follow panel width, not device viewport width');
});

test('phone density uses short actions and a horizontally scrollable cast', () => {
    assert.match(css, /\.npc-state-v3-action-full\{display:none\}/);
    assert.match(css, /\.npc-state-v3-action-compact\{display:inline\}/);
    assert.match(css, /flex-wrap:nowrap/);
    assert.match(css, /overflow-x:auto/);
});

test('tablet landscape gains paired settings while narrower tablet remains single-column', () => {
    const tablet = css.slice(css.indexOf('@container (min-width:700px)'), css.indexOf('@container (min-width:900px)'));
    assert.match(tablet, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    const baseTracking = css.slice(css.indexOf('.npc-state-v3-settings .npc-state-v3-tracking-grid'), css.indexOf('.npc-state-v3-settings .npc-state-setting-row'));
    assert.match(baseTracking, /grid-template-columns:1fr/);
});

test('nested stale bundle and portrait settings also collapse by panel width', () => {
    const tablet = css.slice(css.indexOf('@container (max-width:899px)'), css.indexOf('@container (min-width:700px)'));
    for (const selector of [
        'npc-state-v3-stale-thresholds',
        'npc-state-v3-bundle-export-grid',
        'npc-state-v3-bundle-import-options',
        'npc-state-v3-portrait-control-grid',
        'npc-state-v3-portrait-preset-pair',
        'npc-state-v3-portrait-template-pair',
        'npc-state-v3-portrait-preview-pair',
    ]) {
        assert.match(tablet, new RegExp(selector));
    }
    assert.match(tablet, /grid-template-columns:1fr!important/);
});
