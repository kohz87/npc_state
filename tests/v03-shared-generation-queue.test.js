import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSharedQuietGeneration, sharedQuietGenerationStatus } from '../v03/shared-generation-queue.js';

const indexSource = readFileSync(new URL('../v03/index.js', import.meta.url), 'utf8');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('shared quiet generation queue serializes overlapping extension calls', async () => {
    let active = 0;
    let maxActive = 0;
    const order = [];
    const first = runSharedQuietGeneration('first', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push('first:start');
        await delay(20);
        order.push('first:end');
        active -= 1;
        return 'a';
    });
    const second = runSharedQuietGeneration('second', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push('second:start');
        await delay(1);
        order.push('second:end');
        active -= 1;
        return 'b';
    });
    assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
    assert.equal(maxActive, 1);
    assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
    assert.equal(sharedQuietGenerationStatus().queuedCount, 0);
});

test('a failed hidden generation does not poison later queued work', async () => {
    await assert.rejects(runSharedQuietGeneration('failure', async () => { throw new Error('expected'); }), /expected/);
    const value = await runSharedQuietGeneration('recovery', async () => 42);
    assert.equal(value, 42);
    assert.equal(sharedQuietGenerationStatus().queuedCount, 0);
});

test('NPC State generateRaw adapter participates in the shared quiet queue', () => {
    assert.match(indexSource, /runSharedQuietGeneration/);
    assert.match(indexSource, /runSharedQuietGeneration\('npc-state-scan'/);
    assert.match(indexSource, /ctx\.generateRaw\(\{/);
});
