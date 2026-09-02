import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../v03/editor-surface.js', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('bootstrap loads the dossier/editor surface coordinator after the runtime', () => {
    const runtime = bootstrap.indexOf("await import('./v03/index.js')");
    const coordinator = bootstrap.indexOf("await import('./v03/editor-surface.js')");
    assert.ok(runtime >= 0);
    assert.ok(coordinator > runtime);
});

test('Edit transitions remove the portrait library before the existing editor handler runs', () => {
    assert.match(source, /addEventListener\('click',\s*onDocumentClickCapture,\s*true\)/);
    assert.match(source, /library\?\.remove\?\.\(\)/);
    assert.match(source, /npc-state-v3-library-open/);
    assert.match(source, /EDIT_SELECTOR\s*=\s*'\.npc-state-v3-edit'/);
});

test('editor transition restores the same dossier after close and reports mount failures', () => {
    assert.match(source, /openLibrary\?\.\(returning\.npcId\)/);
    assert.match(source, /editor did not mount/);
    assert.match(source, /getElementById\(EDITOR_ID\)/);
    assert.match(source, /MutationObserver/);
});
