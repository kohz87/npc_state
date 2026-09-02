import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../v03/editor-surface.js', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
    const start = source.indexOf(`function ${name}`);
    const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
    assert.ok(start >= 0, `${name} must exist`);
    assert.ok(end > start, `${name} must have a bounded source region`);
    return source.slice(start, end);
}

test('bootstrap loads the dossier/editor surface coordinator after the runtime', () => {
    const runtime = bootstrap.indexOf("await import('./v03/index.js')");
    const coordinator = bootstrap.indexOf("await import('./v03/editor-surface.js')");
    assert.ok(runtime >= 0);
    assert.ok(coordinator > runtime);
});

test('Edit capture remembers the transition without removing the dossier before ui.js receives the click', () => {
    assert.match(source, /addEventListener\('click',\s*onDocumentClickCapture,\s*true\)/);
    assert.match(source, /EDIT_SELECTOR\s*=\s*'\.npc-state-v3-edit'/);
    const begin = functionSource('beginEditTransition', 'onDocumentClickCapture');
    assert.doesNotMatch(begin, /removeLibrarySurface\s*\(/);
    assert.match(begin, /pendingReturn\s*=\s*\{\s*npcId,\s*chatKey:\s*currentChatKey\(\),\s*library\s*\}/);
});

test('portrait library is removed only after the editor DOM is confirmed present', () => {
    const confirm = functionSource('confirmEditorMounted', 'watchEditorState');
    const lookup = confirm.indexOf('getElementById(EDITOR_ID)');
    const removal = confirm.indexOf('removeLibrarySurface(pendingReturn.library)');
    assert.ok(lookup >= 0);
    assert.ok(removal > lookup);
    assert.match(source, /dossier editor did not mount\. The dossier was left open/);
});

test('editor transition restores the same dossier after close', () => {
    assert.match(source, /openLibrary\?\.\(returning\.npcId\)/);
    assert.match(source, /MutationObserver/);
    assert.match(source, /if \(editorSeen\) scheduleLibraryReturn\(\)/);
});
