import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('successful hydration is the only default authority transition', () => {
    assert.match(index, /function setChatState\(key, state, \{ markLoaded = false \} = \{\}\)/);
    assert.match(index, /setChatState\(key, sourceState, \{ markLoaded: true \}\)/);
    assert.match(index, /requireReadyChatMutation\('save chat dossier changes'/);
    assert.match(index, /refused to queue an unhydrated state write/);
});

test('hydration errors render an explicit read-only retry surface', () => {
    assert.match(index, /Dossier load failed/);
    assert.match(index, /Retry Load/);
    assert.match(index, /npc-state-retry-hydration/);
    assert.match(index, /Existing sidecar data is preserved and all dossier writes are locked/);
});

test('rename verifies new storage before switching ownership', () => {
    const fn = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function flushCurrentChatOnPageHide'));
    const write = fn.indexOf('writeNpcStateDataFile');
    const verify = fn.indexOf('readNpcStateDataFile(newPointer');
    const retire = fn.indexOf('retireNpcStateDataFile');
    const switchPointer = fn.indexOf('settings.dataFiles[newKey] = newPointer');
    assert.ok(write >= 0 && verify > write && retire > verify && switchPointer > retire);
    assert.match(fn, /original durable ownership remains recoverable/);
    assert.match(fn, /makeNpcStateDataFileName\(newKey\)/);
});

test('scan timeout drains coalesced automatic work', () => {
    const block = index.slice(index.indexOf('onExpire: operation =>'), index.indexOf('function isScanBusy'));
    assert.match(block, /pendingAutoScans\.has\(operation\.key\)/);
    assert.match(block, /drainPendingAutoScan\(operation\.key\)/);
});

test('automatic backfill retries are durable cooled down and bounded', () => {
    assert.match(index, /BACKFILL_MAX_ATTEMPTS = 3/);
    assert.match(index, /BACKFILL_RETRY_COOLDOWN_MS = 60 \* 1000/);
    assert.match(index, /attempts: Math\.max\(0, Math\.min\(BACKFILL_MAX_ATTEMPTS/);
    assert.match(index, /lastAttemptAt: Math\.max\(0/);
    assert.match(index, /stopped automatic backfill retries/);
});

test('editor and portrait workflows are chat-affine', () => {
    assert.match(index, /let activeEditorChatKey = ''/);
    assert.match(index, /let activePortraitGeneratorChatKey = ''/);
    assert.match(index, /activeEditorChatKey = originChatKey/);
    assert.match(index, /activePortraitGeneratorChatKey = originChatKey/);
    assert.match(index, /originRevision = Number\(stateVersions\.get\(originChatKey\)/);
    assert.match(index, /closePortraitGenerator\(\);\n\s*closeNpcViewer\(\);\n\s*closeNpcEditor\(\);/);
});

test('release metadata is v0.2.22', () => {
    assert.match(core, /NPC_STATE_VERSION = '0\.2\.22'/);
    assert.equal(manifest.version, '0.2.22');
    assert.equal(manifest.author, 'kohz87');
});
