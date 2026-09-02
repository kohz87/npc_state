import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    BRANCH_LINEAGE_VERSION,
    bestAncestorState,
    chatLineage,
    fingerprintMessage,
    legacyChatLineageV3,
    lineageCheckpointKeys,
    migrateLegacyBranchState,
    setBranchProvenanceHint,
} from '../branch.js';
import { buildQualifiedChatKey } from '../identity.js';
import { makeNpcStateRecoveryFileName, readNpcStateDataFile, writeNpcStateDataFile } from '../storage.js';

const user = (mes, send_date = '') => ({ is_user: true, is_system: false, name: 'User', mes, send_date });
const bot = (name, mes, send_date = '') => ({ is_user: false, is_system: false, name, mes, send_date });
const emptySnapshot = npcs => ({ npcs, candidates: [], pendingBackfills: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [], turn: 0, assistantSinceScan: 0, lastScanAt: 0, lastScannedMessageId: null, scanCount: 0, processedOocMessageId: null });

test('v4 branch identity distinguishes identical text by stable message instance while ignoring renamed speaker labels', () => {
    const a = bot('Astra', 'Yes.', '2026-09-02T01:02:03.100Z');
    const b = bot('Kiri', 'Yes.', '2026-09-02T01:02:03.200Z');
    assert.notEqual(fingerprintMessage(a), fingerprintMessage(b));
    const renamed = { ...a, name: 'Astra Vale', original_avatar: 'new-avatar.png' };
    assert.equal(fingerprintMessage(a), fingerprintMessage(renamed));
});

test('stored v3 text lineage migrates to v4 without discarding a proven checkpoint', () => {
    const chat = [user('A', '1'), bot('NPC', 'B', '2'), user('C', '3'), bot('NPC', 'D', '4')];
    const v3 = legacyChatLineageV3(chat);
    const v3Keys = lineageCheckpointKeys(v3);
    const state = {
        branchLineageVersion: 3,
        lineage: v3,
        checkpoints: [{ messageId: 3, fingerprint: v3[3], lineageKey: v3Keys[3], parentLineageKey: v3Keys[2], createdAt: 1, snapshot: emptySnapshot([{ id: 'npc-1', name: 'NPC' }]) }],
        inlineCards: [], portraitAssets: {}, userDismissedGroups: [], npcs: [], candidates: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [],
    };
    migrateLegacyBranchState(state, chat);
    assert.equal(BRANCH_LINEAGE_VERSION, 4);
    assert.equal(state.branchLineageVersion, 4);
    assert.deepEqual(state.lineage, chatLineage(chat));
    assert.equal(state.checkpoints.length, 1);
});

test('explicit host parent can inherit the branch root before the old 4-message heuristic', () => {
    const parentKey = buildQualifiedChatKey('chat', 'card.png', 'Parent');
    const childKey = buildQualifiedChatKey('chat', 'card.png', 'Child');
    const parentChat = [bot('NPC', 'Original greeting', '1')];
    const parent = {
        branchLineageVersion: 4,
        lineage: chatLineage(parentChat),
        checkpoints: [],
        branchRootSnapshot: emptySnapshot([{ id: 'npc-root', name: 'Root NPC' }]),
        inlineCards: [], portraitAssets: {}, userDismissedGroups: [], branchFamilyId: 'family',
    };
    setBranchProvenanceHint({ mainChat: 'Parent', currentKey: childKey });
    const inherited = bestAncestorState({ [parentKey]: parent }, childKey, [bot('NPC', 'Different greeting', '2')]);
    assert.ok(inherited);
    assert.equal(inherited.npcs[0].name, 'Root NPC');
    assert.equal(inherited.branchForkMessageId, -1);
    setBranchProvenanceHint({});
});

function fileHarness() {
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body);
            const p = "/files/" + body.name;
            files.set(p, Buffer.from(body.data, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ path: p }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    return { files, fetchFn };
}

test('hydration repairs a stale settings revision token from the authoritative sidecar', async () => {
    const { fetchFn } = fileHarness();
    const first = await writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 1 }, fetchFn });
    const stale = { ...first };
    const second = await writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 2 }, pointer: first, fetchFn });
    assert.equal(second.revision, 2);
    const payload = await readNpcStateDataFile(stale, { fetchFn, expectedChatKey: 'chat:a:x' });
    assert.equal(payload.revision, 2);
    assert.equal(stale.revision, 2);
    const third = await writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 3 }, pointer: stale, fetchFn });
    assert.equal(third.revision, 3);
});

test('v0.2.20 lifecycle hardening does not monkey-patch the shared SillyTavern event emitter', () => {
    const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.doesNotMatch(hardening, /installLegacyLifecycleRegistrationGuard|source\.on\s*=/);
    assert.doesNotMatch(hardening, /events\.(?:CHAT_RENAMED|CHAT_DELETED|GROUP_CHAT_DELETED)/);
});

test('destructive chat lifecycle retires the revision-checked source before publishing ownership metadata', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const deletion = index.slice(index.indexOf('async function removeDeletedChatState'), index.indexOf('async function moveRenamedChatState'));
    assert.ok(deletion.indexOf('retireNpcStateDataFile') >= 0);
    assert.ok(deletion.indexOf('retireNpcStateDataFile') < deletion.indexOf('settings.sidecarTombstones[key]'));
    const rename = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function legacyMigrationMatchesActiveChat'));
    assert.ok(rename.indexOf('retireNpcStateDataFile') >= 0);
    assert.ok(rename.indexOf('retireNpcStateDataFile') < rename.indexOf('settings.dataFiles[newKey] = newPointer'));
    assert.match(index, /removeDeletedChatState\(chatId, 'chat', ''\)/);
});

test('retired canonical sidecars are physically removed only after synchronous ownership metadata persistence', () => {
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const deletion = index.slice(index.indexOf('async function removeDeletedChatState'), index.indexOf('async function moveRenamedChatState'));
  const settingsSave = deletion.indexOf('await saveHostSettings()');
  const physicalDelete = deletion.indexOf('deleteNpcStateDataFile(pointer');
  assert.ok(settingsSave >= 0 && physicalDelete > settingsSave);
  const rename = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function legacyMigrationMatchesActiveChat'));
  const renameSave = rename.indexOf('await saveHostSettings()');
  const renameDelete = rename.indexOf('deleteNpcStateDataFile(oldPointer');
  assert.ok(renameSave >= 0 && renameDelete > renameSave);
});

test('retained legacy migration consumes v0.2.19 legacyCandidateKey only with four-message two-user proof', () => {
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const block = index.slice(index.indexOf('function legacyMigrationMatchesActiveChat'), index.indexOf('function flushLifecycleOwner'));
  assert.match(block, /identity\.legacyCandidateKey \|\| identity\.legacyKey/);
  assert.match(block, /required >= 4 && prefix >= required && userTurns >= 2/);
});


test('ambiguous filename deletion uses host ownership proof and never falls back to the active owner', () => {
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /async function resolveDeletedChatKey/);
  assert.match(index, /\/api\/characters\/chats/);
  assert.match(index, /absent\.length === 1 && present\.length === candidates\.length - 1/);
  assert.match(index, /removeDeletedChatState\(chatId, 'chat', ''\)/);
});

test('recovery filenames remain unique across same-millisecond calls', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1700000000000;
    const names = new Set(Array.from({ length: 16 }, () => makeNpcStateRecoveryFileName('chat:a:x')));
    assert.equal(names.size, 16);
  } finally {
    Date.now = originalNow;
  }
});

test('owner-wide retired canonical predecessors are deleted only after settings become durable', () => {
  const hardening = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
  const legacy = hardening.slice(hardening.indexOf('async function safeLegacyMigrationForCurrent'), hardening.indexOf('async function migrateCharacterOwner'));
  assert.ok(legacy.indexOf('await saveSettingsNow()') >= 0);
  assert.ok(legacy.indexOf('deleteNpcStateDataFile(oldPointer') > legacy.indexOf('await saveSettingsNow()'));
  const rename = hardening.slice(hardening.indexOf('async function migrateCharacterOwner'), hardening.indexOf('async function retireCharacterOwner'));
  assert.ok(rename.indexOf('await saveSettingsNow()') >= 0);
  assert.ok(rename.indexOf('deleteNpcStateDataFile(predecessor.pointer') > rename.indexOf('await saveSettingsNow()'));
  const deletion = hardening.slice(hardening.indexOf('async function retireCharacterOwner'), hardening.indexOf('async function rebaseActiveStateAfterHostRename'));
  assert.ok(deletion.indexOf('await saveSettingsNow()') >= 0);
  assert.ok(deletion.indexOf('deleteNpcStateDataFile(predecessor.pointer') > deletion.indexOf('await saveSettingsNow()'));
});
