import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bestAncestorState, chatLineage, recordBranchCheckpoint } from '../branch.js';
import { encodeRetiredStateFilePayload, decodeStateFilePayload, makeNpcStateRecoveryFileName } from '../storage.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function msg(text, isUser = false) { return { mes: text, is_user: isUser, is_system: false, name: isUser ? 'User' : 'Character' }; }
function stateFor(chat) {
    const state = { npcs: [{ id: 'npc_a', name: 'A' }], candidates: [], pendingBackfills: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [], turn: 1, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null, scanCount: 0, processedOocMessageId: null, checkpoints: [], lineage: [], inlineCards: [] };
    recordBranchCheckpoint(state, chat, chat.length - 1, 'test');
    state.lineage = chatLineage(chat);
    return state;
}

test('group identity takes precedence over host chatId and pending identities are noncanonical', () => {
    const body = index.slice(index.indexOf('function getChatIdentity'), index.indexOf('function freshChatState'));
    assert.ok(body.indexOf('if (hasGroup)') < body.indexOf("if (raw) return { key: `chat:"));
    assert.match(body, /group:\$\{raw\}/);
    assert.match(body, /group-pending:/);
    assert.match(body, /function isCanonicalChatKey/);
});

test('delete and hydration use ownership epochs and stale loader cannot clear a newer promise', () => {
    assert.match(index, /const ownershipEpochs = new Map\(\)/);
    assert.match(index, /bumpOwnershipEpoch\(key\);[\s\S]*scanOperations\.cancel\(key, 'chat-deleted'\)/);
    assert.match(index, /assertOwnershipEpoch\(key, epoch\)/);
    assert.match(index, /if \(loadingChatStates\.get\(key\) === task\) loadingChatStates\.delete\(key\)/);
    assert.match(index, /if \(!ownershipEpochCurrent\(key, epoch\)\) return written/);
});

test('retired sidecars are explicit durable tombstones', () => {
    const payload = decodeStateFilePayload(encodeRetiredStateFilePayload('chat:x', 'deleted', '0.2.15'));
    assert.equal(payload.retired, true);
    assert.equal(payload.chatKey, 'chat:x');
    assert.equal(payload.retireReason, 'deleted');
    assert.match(makeNpcStateRecoveryFileName('chat:x', 123), /^npc-state-recovery-/);
    assert.match(index, /retireNpcStateDataFile\(\{ chatKey: key, pointer, reason: 'chat-deleted'/);
});

test('rename uses event groupId and writes a recovery backup before retiring predecessor', () => {
    const fn = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('async function migrateActiveGroupNamespace'));
    assert.match(fn, /eventData\.groupId/);
    const recovery = fn.indexOf('makeNpcStateRecoveryFileName(oldKey)');
    const retire = fn.indexOf('retireNpcStateDataFile');
    const switchOwnership = fn.indexOf('settings.dataFiles[newKey] = newPointer');
    assert.ok(recovery >= 0 && retire > recovery && switchOwnership > retire);
});

test('broken sidecar recovery is explicit rather than silently destructive', () => {
    assert.match(index, /async function detachBrokenSidecar/);
    assert.match(index, /Detach Broken Sidecar/);
    assert.match(index, /settings\.recoveryFiles\[key\]/);
    assert.match(index, /settings\.sidecarTombstones\[key\]/);
});

test('independent chats need two shared user turns before cross-chat inheritance', () => {
    const shortA = [msg('Welcome.'), msg('I enter.', true), msg('The guard nods.')];
    const shortB = [msg('Welcome.'), msg('I enter.', true), msg('The guard nods differently.')];
    assert.equal(bestAncestorState({ 'chat:a': stateFor(shortA) }, 'chat:b', shortB), null);
    const longA = [msg('Welcome.'), msg('I enter.', true), msg('The guard nods.'), msg('I ask for work.', true), msg('A ledger opens.')];
    const longB = [msg('Welcome.'), msg('I enter.', true), msg('The guard nods.'), msg('I ask for work.', true), msg('A different ledger opens.')];
    const inherited = bestAncestorState({ 'chat:a': stateFor(longA.slice(0, 4)) }, 'chat:b', longB);
    assert.ok(inherited);
});

test('ancestor discovery is bounded by a settings branch index', () => {
    assert.match(index, /BRANCH_INDEX_MAX_CANDIDATES = 16/);
    assert.match(index, /LEGACY_BRANCH_DISCOVERY_LIMIT = 8/);
    assert.match(index, /function likelyAncestorKeys/);
    assert.match(index, /ensureLikelyAncestorStatesLoaded\(key, chat\)/);
    assert.doesNotMatch(index, /async function ensureKnownChatStatesLoaded/);
});

test('CI is version-neutral and uses Node 24 actions', () => {
    assert.match(ci, /actions\/checkout@v5/);
    assert.match(ci, /actions\/setup-node@v5/);
    assert.match(ci, /node-version: 24/);
    assert.doesNotMatch(ci, /apply_v0214_hardening|v0\.2\.14 hardening|Sync v0\.2\.14/);
});
