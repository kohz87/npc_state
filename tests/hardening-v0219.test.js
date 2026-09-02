import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualifiedChatKey, getCharacterOwnerId, getChatIdentityFromContext } from '../identity.js';
import { applyCanonicalOwnershipMove, strongLegacyMigrationMatches } from '../hardening-core.js';
import { BRANCH_LINEAGE_VERSION, bestAncestorState, recordBranchCheckpoint, setBranchProvenanceHint } from '../branch.js';
import * as legacy from '../branch-v0218.js';
import { readNpcStateDataFile, retireNpcStateDataFile, writeNpcStateDataFile } from '../storage.js';

const user = mes => ({ is_user: true, is_system: false, name: 'User', mes });
const bot = mes => ({ is_user: false, is_system: false, name: 'NPC', mes });
const baseState = () => ({ npcs: [], candidates: [], pendingBackfills: [], socialGraph: { edges: [], unresolved: [] }, dismissed: [], inlineCards: [], checkpoints: [], lineage: [], portraitAssets: {}, userDismissedGroups: [], branchLineageVersion: BRANCH_LINEAGE_VERSION });

test('durable character ownership never falls back to numeric characterId', () => {
  const ctx = { characterId: 4, characters: [], chatId: 'Adventure' };
  assert.equal(getCharacterOwnerId(ctx), '');
  assert.equal(getChatIdentityFromContext(ctx).key, 'chat-pending:Adventure');
});

test('rename-back supersedes only the verified destination tombstone', () => {
  const a = buildQualifiedChatKey('chat', 'card.png', 'A');
  const b = buildQualifiedChatKey('chat', 'card.png', 'B');
  const settings = { dataFiles: { [b]: { path: '/b' } }, sidecarTombstones: { [a]: { reason: 'old' } }, recoveryFiles: {}, branchIndex: {} };
  applyCanonicalOwnershipMove(settings, { oldKey: b, newKey: a, newPointer: { path: '/a2' }, reason: 'chat-renamed' });
  assert.equal(settings.sidecarTombstones[a], undefined);
  assert.ok(settings.sidecarTombstones[b]);
});

test('fresh canonical v3 chats require host branch provenance for cross-chat inheritance', () => {
  const chat = [user('A'), bot('B'), user('C'), bot('D')];
  const parent = baseState();
  recordBranchCheckpoint(parent, chat, 3, 'scan');
  const parentKey = buildQualifiedChatKey('chat', 'card.png', 'Campaign');
  const childKey = buildQualifiedChatKey('chat', 'card.png', 'Independent');
  setBranchProvenanceHint({});
  assert.equal(bestAncestorState({ [parentKey]: parent }, childKey, chat), null);
  setBranchProvenanceHint({ mainChat: 'Campaign', currentKey: childKey });
  assert.ok(bestAncestorState({ [parentKey]: parent }, childKey, chat));
  setBranchProvenanceHint({});
});

function fileHarness() {
  const files = new Map();
  const fetchFn = async (url, options = {}) => {
    if (url === '/api/files/upload') {
      const body = JSON.parse(options.body);
      const path = `/files/${body.name}`;
      files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
      return { ok: true, status: 200, json: async () => ({ path }) };
    }
    if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
    return { ok: false, status: 404, text: async () => '' };
  };
  return { fetchFn };
}

test('stale writer and stale retirement both fail closed on revision conflict', async () => {
  const { fetchFn } = fileHarness();
  const first = await writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 1 }, fetchFn });
  const second = await writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 2 }, pointer: first, fetchFn });
  await assert.rejects(writeNpcStateDataFile({ chatKey: 'chat:a:x', state: { value: 3 }, pointer: first, fetchFn }), e => e?.code === 'NPC_STATE_WRITE_CONFLICT');
  await assert.rejects(retireNpcStateDataFile({ chatKey: 'chat:a:x', pointer: first, fetchFn }), e => e?.code === 'NPC_STATE_WRITE_CONFLICT');
  const live = await readNpcStateDataFile(second, { fetchFn, expectedChatKey: 'chat:a:x' });
  assert.equal(live.revision, 2);
});

test('legacy ownership proof requires the entire stored lineage', () => {
  const chat = Array.from({ length: 8 }, (_, i) => i % 2 ? user(`u${i}`) : bot(`a${i}`));
  const state = { lineage: legacy.chatLineage(chat) };
  assert.equal(strongLegacyMigrationMatches(state, chat, { lineageV2Fn: legacy.chatLineage, lineageV0210Fn: legacy.legacyChatLineageV0210 }), true);
  const diverged = structuredClone(chat); diverged[7].mes = 'different';
  assert.equal(strongLegacyMigrationMatches(state, diverged, { lineageV2Fn: legacy.chatLineage, lineageV0210Fn: legacy.legacyChatLineageV0210 }), false);
});
