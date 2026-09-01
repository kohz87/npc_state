import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

test('swipe branch handling waits for SillyTavern swipe idle before dossier generation', () => {
    assert.match(index, /function hostSwipeState\(\)[\s\S]*?getContext\(\)\.swipe\?\.state\?\.\(\)/);
    assert.match(index, /function isHostSwipeActive\(\)[\s\S]*?hostSwipeState\(\) !== 'none'/);
    assert.match(index, /events\.MESSAGE_SWIPED[\s\S]*?queueSettledSwipeReconcile/);
    assert.doesNotMatch(index, /events\.MESSAGE_SWIPED[\s\S]{0,450}?queueBranchReconcile/);
    assert.match(index, /if \(!allowDuringSwipe && isHostSwipeActive\(\)\)/, 'scanNow must refuse hidden generation during host swipe');
    assert.match(index, /MESSAGE_RECEIVED while swipeState is still SWIPING[\s\S]*?queueSettledSwipeReconcile/, 'early MESSAGE_RECEIVED must be deferred');
});
