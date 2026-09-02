import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLibrarySelection, editorIdentityMatches } from '../v03/ui.js';

test('library selection follows the filtered result set instead of showing a hidden previous NPC', () => {
    const rows = [{ id: 'mira' }, { id: 'astra' }];
    assert.equal(chooseLibrarySelection(rows, 'neri'), 'mira');
    assert.equal(chooseLibrarySelection(rows, 'astra'), 'astra');
    assert.equal(chooseLibrarySelection([], 'astra'), '');
});

test('editor identity guard only permits the exact dossier that opened the form', () => {
    assert.equal(editorIdentityMatches('astra', 'astra'), true);
    assert.equal(editorIdentityMatches('astra', 'neri'), false);
    assert.equal(editorIdentityMatches('', 'astra'), false);
});
