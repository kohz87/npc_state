import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    bestAncestorState,
    chatLineage,
    recordBranchCheckpoint,
} from '../branch.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function msg(text, isUser = false) {
    return { mes: text, is_user: isUser, is_system: false, name: isUser ? 'User' : 'Character' };
}

function ancestorState(chat) {
    const state = { npcs: [{ id: 'npc_a', name: 'A' }], candidates: [], pendingBackfills: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [], turn: 1, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null, scanCount: 0, processedOocMessageId: null, checkpoints: [], lineage: [], inlineCards: [] };
    recordBranchCheckpoint(state, chat, chat.length - 1, 'test');
    return state;
}

test('same stock greeting alone never proves cross-chat ancestry', () => {
    const oldChat = [msg('Welcome, traveler.')];
    const current = [msg('Welcome, traveler.')];
    const inherited = bestAncestorState({ 'chat:old': ancestorState(oldChat) }, 'chat:new', current);
    assert.equal(inherited, null);
});

test('shared greeting plus user-authored history can prove branch ancestry', () => {
    const oldChat = [msg('Welcome, traveler.'), msg('I enter the gate.', true), msg('The guard nods.')];
    const current = [msg('Welcome, traveler.'), msg('I enter the gate.', true), msg('The guard smiles instead.')];
    const state = ancestorState(oldChat.slice(0, 2));
    state.lineage = chatLineage(oldChat);
    const inherited = bestAncestorState({ 'chat:old': state }, 'chat:new', current);
    assert.ok(inherited);
});

test('persistence and branch async work are explicitly chat-bound', () => {
    assert.match(index, /function persist\(key = getChatKey\(\)\)/);
    assert.match(index, /persist\(key\);/);
    assert.match(index, /if \(getChatKey\(\) !== key\) return null;/);
    assert.match(index, /firstLineageDivergence\(lineageBefore/);
});

test('queued scans carry branch identity and validate before drain', () => {
    assert.match(index, /fingerprint: fingerprintMessage\(message\)/);
    assert.match(index, /lineageKey: lineageCheckpointKey\(lineage, messageId\)/);
    assert.match(index, /pending\.fingerprint !== currentFingerprint/);
    assert.match(index, /pending\.lineageKey !== currentLineageKey/);
});

test('startup mounts recovery UI machinery before hydration', () => {
    const fn = index.slice(index.indexOf('async function init()'), index.indexOf('async function safeInit()'));
    assert.ok(fn.indexOf('bindUi();') < fn.indexOf('await migrateLegacyChatStates();'));
    assert.ok(fn.indexOf('registerEvents();') < fn.indexOf('await migrateLegacyChatStates();'));
    assert.match(fn, /read-only recovery mode/);
});

test('character fallback cannot become a durable mutation namespace', () => {
    assert.match(index, /key\.startsWith\('character:'\)/);
    assert.match(index, /key === 'no-chat' \|\| key\.startsWith\('character:'\) \|\| !chatStateCache/);
});

test('rename retains predecessor recovery copy and deterministic recovery probe exists', () => {
    const rename = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function flushCurrentChatOnPageHide'));
    assert.doesNotMatch(rename, /deleteNpcStateDataFile\(oldPointer/);
    assert.match(rename, /retains the predecessor sidecar as a recovery copy/);
    assert.match(index, /recovered deterministic sidecar pointer/);
    assert.match(index, /`\/user\/files\/\$\{recoveryName\}`/);
});

test('chat changes cancel global delayed branch and swipe work', () => {
    const block = index.slice(index.indexOf('source.on(events.CHAT_CHANGED'), index.indexOf('if (events.CHAT_DELETED)'));
    assert.match(block, /branchReconcilePending = null/);
    assert.match(block, /swipeSettlementPending = null/);
    assert.match(block, /swipeSettlementSequence \+= 1/);
});
