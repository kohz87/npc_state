from pathlib import Path


def rewrite(path, old, new):
    p = Path(path)
    src = p.read_text()
    if old not in src:
        raise RuntimeError(f"missing patch anchor in {path}: {old[:80]!r}")
    p.write_text(src.replace(old, new, 1))


# 1) Resolve ambiguous filename-only deletes from authoritative host ownership.
rewrite('index.js', """function touchChatCache(key) {
    if (!isCanonicalChatKey(key)) return;
    chatCacheTouches.set(key, Date.now());
}
""", """function lifecycleCandidateKeys(rawId, kind = 'chat') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!id) return [];
    const suffix = `:${encodeChatKeyPart(id)}`;
    const prefix = `${kind}:`;
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.branchIndex || {}),
        ...Object.keys(settings.sidecarTombstones || {}),
        ...Object.keys(settings.recoveryFiles || {}),
        ...chatStateCache.keys(),
    ]);
    return [...keys].filter(key => isCanonicalChatKey(key) && key.startsWith(prefix) && key.endsWith(suffix));
}

async function hostCharacterChatPresence(ownerId, rawId) {
    const owner = String(ownerId || '').trim();
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!owner || !id) return null;
    try {
        const response = await globalThis.fetch?.('/api/characters/chats', {
            method: 'POST',
            headers: requestHeaders(),
            body: JSON.stringify({ avatar_url: owner }),
        });
        if (!response?.ok) return null;
        const data = typeof response.json === 'function' ? await response.json() : null;
        if (!data || typeof data !== 'object') return null;
        const chats = Array.isArray(data) ? data : Object.values(data);
        return chats.some(item => String(item?.file_name ?? item?.fileName ?? item?.name ?? '').replace(/\\.jsonl$/i, '').trim() === id);
    } catch (error) {
        console.debug(`[NPC State] host ownership probe failed for ${owner}/${id}.`, error);
        return null;
    }
}

function hostGroupChatPresence(ownerId, rawId) {
    const owner = String(ownerId || '').trim();
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    const groups = getContext()?.groups;
    if (!owner || !id || !Array.isArray(groups)) return null;
    const group = groups.find(item => String(item?.id ?? '').trim() === owner);
    if (!group) return false;
    const chats = [
        ...(Array.isArray(group?.chats) ? group.chats : []),
        group?.chat_id,
    ].map(value => String(value ?? '').replace(/\\.jsonl$/i, '').trim()).filter(Boolean);
    return chats.includes(id);
}

async function resolveDeletedChatKey(rawId, kind = 'chat', ownerId = '') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!id) return '';
    const hint = String(ownerId || '').trim();
    if (hint) return resolveOwnedChatKey(id, kind, hint);
    const candidates = lifecycleCandidateKeys(id, kind);
    if (candidates.length <= 1) return candidates[0] || '';

    const presence = [];
    for (const key of candidates) {
        const parsed = parseQualifiedChatKey(key);
        if (!parsed) continue;
        const value = kind === 'group'
            ? hostGroupChatPresence(parsed.ownerId, id)
            : await hostCharacterChatPresence(parsed.ownerId, id);
        presence.push({ key, value });
    }
    const absent = presence.filter(item => item.value === false);
    const present = presence.filter(item => item.value === true);
    if (absent.length === 1 && present.length === candidates.length - 1) {
        console.info(`[NPC State] resolved ambiguous deleted ${kind} ${id} from authoritative host ownership: ${absent[0].key}.`);
        return absent[0].key;
    }
    console.warn(`[NPC State] preserved ambiguous deleted ${kind} ${id}; host ownership did not prove one unique removed owner.`);
    return '';
}

function touchChatCache(key) {
    if (!isCanonicalChatKey(key)) return;
    chatCacheTouches.set(key, Date.now());
}
""")

rewrite('index.js', """async function removeDeletedChatState(rawId, kind = 'chat', ownerId = '') {
    const key = resolveOwnedChatKey(rawId, kind, ownerId);
    if (!key) return false;""", """async function removeDeletedChatState(rawId, kind = 'chat', ownerId = '') {
    const key = await resolveDeletedChatKey(rawId, kind, ownerId);
    if (!key) return false;""")

rewrite('index.js', """globalThis.__NPCStateLifecycle = Object.freeze({
    flushOwner: flushLifecycleOwner,
    invalidateOwner: invalidateLifecycleOwner,
    invalidateKey: key => clearLifecycleCacheKey(key, 'external-lifecycle'),
});""", """globalThis.__NPCStateLifecycle = Object.freeze({
    flushOwner: flushLifecycleOwner,
    invalidateOwner: invalidateLifecycleOwner,
    invalidateKey: key => clearLifecycleCacheKey(key, 'external-lifecycle'),
    resolveDeletedKey: resolveDeletedChatKey,
});""")

# 2) Central monotonic recovery naming.
rewrite('storage.js', """let activeReads = 0;
const readWaiters = [];
""", """let activeReads = 0;
const readWaiters = [];
let recoveryGeneration = Date.now() * 1024;

function nextRecoveryGeneration() {
    recoveryGeneration = Math.max(recoveryGeneration + 1, Date.now() * 1024);
    return recoveryGeneration;
}
""")
rewrite('storage.js', """export function makeNpcStateRecoveryFileName(chatKey, generation = Date.now()) {""", """export function makeNpcStateRecoveryFileName(chatKey, generation = nextRecoveryGeneration()) {""")

# 3) Physically clean owner-wide retired canonical predecessors only after durable settings.
rewrite('hardening.js', """    await saveSettingsNow();
    await cleanupRecoveryGarbage(config);
    return true;
}

async function migrateCharacterOwner""", """    await saveSettingsNow();
    if (oldPointer?.path) {
        try { await deleteNpcStateDataFile(oldPointer, { headers: headers() }); }
        catch (error) { console.warn(`[NPC State] retired legacy predecessor ${oldKey} could not be physically deleted.`, error); }
    }
    await cleanupRecoveryGarbage(config);
    return true;
}

async function migrateCharacterOwner""")

rewrite('hardening.js', """    const moved = new Map();
    let changed = false;

    for (const oldKey of sourceKeys) {""", """    const moved = new Map();
    const retiredPredecessors = [];
    let changed = false;

    for (const oldKey of sourceKeys) {""")
rewrite('hardening.js', """        moved.set(oldKey, newKey);
        changed = true;
    }

    for (const claim of Object.values(config.legacyOwnershipClaims || {})) {""", """        moved.set(oldKey, newKey);
        if (sourceRetired && oldPointer?.path) retiredPredecessors.push({ key: oldKey, pointer: oldPointer });
        changed = true;
    }

    for (const claim of Object.values(config.legacyOwnershipClaims || {})) {""")
rewrite('hardening.js', """    if (changed) await saveSettingsNow();
    globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);""", """    if (changed) {
        await saveSettingsNow();
        for (const predecessor of retiredPredecessors) {
            try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }
            catch (error) { console.warn(`[NPC State] retired character-rename predecessor ${predecessor.key} could not be physically deleted.`, error); }
        }
    }
    globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);""")

rewrite('hardening.js', """    let changed = false;
    for (const key of keys) {""", """    let changed = false;
    const retiredPredecessors = [];
    for (const key of keys) {""")
rewrite('hardening.js', """        if (config.chats?.[key]) delete config.chats[key];
        changed = true;
    }
    if (changed) await saveSettingsNow();""", """        if (config.chats?.[key]) delete config.chats[key];
        if (pointer?.path) retiredPredecessors.push({ key, pointer });
        changed = true;
    }
    if (changed) {
        await saveSettingsNow();
        for (const predecessor of retiredPredecessors) {
            try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }
            catch (error) { console.warn(`[NPC State] retired character-delete predecessor ${predecessor.key} could not be physically deleted.`, error); }
        }
    }""")

# 4) Runtime host-ownership proof coverage.
rewrite('tests/runtime-smoke.mjs', """    uploadCalls: 0,
    uploadBarrier: null,
    readBarrier: null,
};""", """    uploadCalls: 0,
    uploadBarrier: null,
    readBarrier: null,
    hostChatsByAvatar: new Map(),
};""")
rewrite('tests/runtime-smoke.mjs', """globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/files/upload') {""", """globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/characters/chats') {
        const body = JSON.parse(options.body || '{}');
        if (!mockState.hostChatsByAvatar.has(body.avatar_url)) return { ok: false, status: 404, json: async () => ({}) };
        const chats = mockState.hostChatsByAvatar.get(body.avatar_url) || [];
        return { ok: true, status: 200, json: async () => Object.fromEntries(chats.map((item, index) => [String(index), item])) };
    }
    if (url === '/api/files/upload') {""")
rewrite('tests/runtime-smoke.mjs', """    assert.equal(ownerAKey, 'chat:megumin.png:shared-save');
    assert.equal(ownerBKey, 'chat:yunyun.png:shared-save');
    assert.notEqual(ownerAKey, ownerBKey);
    await sleep(120);

    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');""", """    assert.equal(ownerAKey, 'chat:megumin.png:shared-save');
    assert.equal(ownerBKey, 'chat:yunyun.png:shared-save');
    assert.notEqual(ownerAKey, ownerBKey);

    mockState.extensionSettings.npc_state.dataFiles[ownerAKey] ||= { path: '/unused-owner-a' };
    mockState.extensionSettings.npc_state.dataFiles[ownerBKey] ||= { path: '/unused-owner-b' };
    mockState.hostChatsByAvatar.set('megumin.png', []);
    mockState.hostChatsByAvatar.set('yunyun.png', [{ file_name: 'shared-save.jsonl' }]);
    const resolvedDeletedOwner = await globalThis.__NPCStateLifecycle.resolveDeletedKey('shared-save', 'chat', '');
    assert.equal(resolvedDeletedOwner, ownerAKey, 'host ownership should resolve exactly one removed same-filename owner');
    mockState.hostChatsByAvatar.set('megumin.png', [{ file_name: 'shared-save.jsonl' }]);
    const unresolvedWhenBothOwn = await globalThis.__NPCStateLifecycle.resolveDeletedKey('shared-save', 'chat', '');
    assert.equal(unresolvedWhenBothOwn, '', 'destructive lookup must fail closed when both owners still claim the filename');
    delete mockState.extensionSettings.npc_state.dataFiles[ownerAKey];
    delete mockState.extensionSettings.npc_state.dataFiles[ownerBKey];
    await sleep(120);

    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');""")

# 5) Focused release tests.
rewrite('tests/hardening-v0220.test.js', """import { readNpcStateDataFile, writeNpcStateDataFile } from '../storage.js';""", """import { makeNpcStateRecoveryFileName, readNpcStateDataFile, writeNpcStateDataFile } from '../storage.js';""")
p = Path('tests/hardening-v0220.test.js')
src = p.read_text()
src += r'''

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
'''
p.write_text(src)

# 6) Documentation.
rewrite('CHANGELOG.md', """- Repairs the v0.2.19 release gate and smoke fixtures so wrapper dependencies and branch-lineage v4 are actually exercised.
""", """- Repairs the v0.2.19 release gate and smoke fixtures so wrapper dependencies and branch-lineage v4 are actually exercised.
- Resolves same-filename single-chat deletion from authoritative host ownership without reintroducing active-owner guessing, physically cleans owner-wide retired predecessors after durable metadata commits, and guarantees monotonic recovery filenames.
""")
rewrite('CODE-REVIEW.md', """Release verification executes the complete Node/compatibility/runtime/migration suite ten consecutive times on the exact candidate before main is updated.
""", """Filename-only delete events now use authoritative negative host ownership when multiple owner-qualified states share the same filename: exactly one absent owner and all remaining owners still claiming the file is required before destructive cleanup. Owner-wide rename/delete and legacy migration physically remove retired canonical predecessors only after synchronous metadata durability. Recovery filenames use a monotonic generation so same-millisecond lifecycle operations cannot collide.

Release verification executes the complete Node/compatibility/runtime/migration suite ten consecutive times on the exact candidate before main is updated.
""")
rewrite('TEST-REPORT.md', """- Historical character rename coverage includes solo and group state, while destructive lifecycle ordering is statically guarded so CAS retirement precedes tombstone/ownership publication.
""", """- Historical character rename coverage includes solo and group state, while destructive lifecycle ordering is statically guarded so CAS retirement precedes tombstone/ownership publication.
- Same-filename ambiguous deletion is exercised against mocked SillyTavern `/api/characters/chats` ownership, recovery filename uniqueness is stress-checked at fixed millisecond time, and owner-wide physical cleanup ordering is guarded.
""")

print('v0.2.20 final hard-pass patch applied')
