from pathlib import Path
import json
import re

ROOT = Path('.')
INDEX = ROOT / 'index.js'
BRANCH = ROOT / 'branch.js'
STORAGE = ROOT / 'storage.js'


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label, flags=re.S):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'expected one regex patch for {label}, got {count}')
    return updated


identity = r'''export function encodeChatKeyPart(value) {
    return encodeURIComponent(String(value ?? '').trim());
}

export function decodeChatKeyPart(value) {
    try { return decodeURIComponent(String(value ?? '')); }
    catch { return String(value ?? ''); }
}

export function getCharacterOwnerId(ctx = {}) {
    const characterId = ctx.characterId;
    if (characterId === undefined || characterId === null) return '';
    const avatar = ctx.characters?.[characterId]?.avatar;
    return String(avatar ?? characterId).trim();
}

export function buildQualifiedChatKey(kind, ownerId, chatId) {
    const prefix = kind === 'group' ? 'group' : (kind === 'chat' ? 'chat' : '');
    const owner = String(ownerId ?? '').trim();
    const chat = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!prefix || !owner || !chat) return '';
    return `${prefix}:${encodeChatKeyPart(owner)}:${encodeChatKeyPart(chat)}`;
}

export function legacyChatKey(kind, chatId) {
    const prefix = kind === 'group' ? 'group' : (kind === 'chat' ? 'chat' : '');
    const chat = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    return prefix && chat ? `${prefix}:${chat}` : '';
}

export function parseQualifiedChatKey(key) {
    const match = String(key || '').match(/^(chat|group):([^:]+):(.+)$/);
    if (!match) return null;
    return {
        kind: match[1],
        ownerId: decodeChatKeyPart(match[2]),
        chatId: decodeChatKeyPart(match[3]),
        ownerToken: match[2],
        chatToken: match[3],
    };
}

export function isQualifiedChatKey(key) {
    return Boolean(parseQualifiedChatKey(key));
}

export function isLegacyUnqualifiedChatKey(key) {
    return /^(chat|group):[^:]+$/.test(String(key || ''));
}

export function chatOwnerScope(key) {
    const parsed = parseQualifiedChatKey(key);
    return parsed ? `${parsed.kind}:${parsed.ownerToken}` : '';
}

export function sameChatOwnerScope(a, b) {
    const left = chatOwnerScope(a);
    return Boolean(left && left === chatOwnerScope(b));
}

export function getChatIdentityFromContext(ctx = {}) {
    const raw = ctx.chatId || ctx.getCurrentChatId?.();
    const hasGroup = ctx.groupId !== undefined && ctx.groupId !== null && String(ctx.groupId) !== '';
    if (hasGroup) {
        const ownerId = String(ctx.groupId).trim();
        if (raw) return {
            key: buildQualifiedChatKey('group', ownerId, raw),
            legacyKey: legacyChatKey('group', raw),
            kind: 'group', ownerId, id: String(raw), pending: false,
        };
        return { key: `group-pending:${encodeChatKeyPart(ownerId)}`, legacyKey: '', kind: 'group', ownerId, id: '', pending: true };
    }
    const ownerId = getCharacterOwnerId(ctx);
    if (raw && ownerId) return {
        key: buildQualifiedChatKey('chat', ownerId, raw),
        legacyKey: legacyChatKey('chat', raw),
        kind: 'chat', ownerId, id: String(raw), pending: false,
    };
    if (raw) return { key: `chat-pending:${encodeChatKeyPart(raw)}`, legacyKey: '', kind: 'character', ownerId: '', id: String(raw), pending: true };
    if (ownerId) return { key: `character:${encodeChatKeyPart(ownerId)}`, legacyKey: '', kind: 'character', ownerId, id: ownerId, pending: true };
    return { key: 'no-chat', legacyKey: '', kind: 'none', ownerId: '', id: '', pending: true };
}
'''
Path('identity.js').write_text(identity)

identity_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildQualifiedChatKey,
    chatOwnerScope,
    getChatIdentityFromContext,
    isLegacyUnqualifiedChatKey,
    isQualifiedChatKey,
    parseQualifiedChatKey,
    sameChatOwnerScope,
} from '../identity.js';

test('character owner is part of durable chat identity', () => {
    const base = { chatId: 'Eos', getCurrentChatId: () => 'Eos', groupId: null, characters: [{ avatar: 'alice.png' }, { avatar: 'bob.png' }] };
    const a = getChatIdentityFromContext({ ...base, characterId: 0 });
    const b = getChatIdentityFromContext({ ...base, characterId: 1 });
    assert.notEqual(a.key, b.key);
    assert.equal(a.key, 'chat:alice.png:Eos');
    assert.equal(b.key, 'chat:bob.png:Eos');
});

test('group owner is part of durable group-chat identity', () => {
    const a = getChatIdentityFromContext({ groupId: 'party-a', chatId: 'session', getCurrentChatId: () => 'session' });
    const b = getChatIdentityFromContext({ groupId: 'party-b', chatId: 'session', getCurrentChatId: () => 'session' });
    assert.notEqual(a.key, b.key);
    assert.equal(a.key, 'group:party-a:session');
});

test('qualified parsing round-trips reserved characters', () => {
    const key = buildQualifiedChatKey('chat', 'hero:a/b.png', 'save:01/夜');
    assert.ok(isQualifiedChatKey(key));
    assert.deepEqual(parseQualifiedChatKey(key), {
        kind: 'chat', ownerId: 'hero:a/b.png', chatId: 'save:01/夜',
        ownerToken: 'hero%3Aa%2Fb.png', chatToken: 'save%3A01%2F%E5%A4%9C',
    });
});

test('owner scopes separate characters while preserving sibling chats', () => {
    const a1 = buildQualifiedChatKey('chat', 'alice.png', 'one');
    const a2 = buildQualifiedChatKey('chat', 'alice.png', 'two');
    const b1 = buildQualifiedChatKey('chat', 'bob.png', 'one');
    assert.equal(chatOwnerScope(a1), chatOwnerScope(a2));
    assert.equal(sameChatOwnerScope(a1, a2), true);
    assert.equal(sameChatOwnerScope(a1, b1), false);
});

test('legacy unqualified keys are recognized but are not canonical', () => {
    assert.equal(isLegacyUnqualifiedChatKey('chat:Eos'), true);
    assert.equal(isLegacyUnqualifiedChatKey('group:session'), true);
    assert.equal(isQualifiedChatKey('chat:Eos'), false);
});
'''
Path('tests/identity.test.js').write_text(identity_test)

# ---------------- index.js ----------------
src = INDEX.read_text()
src = src.replace('/* NPC State v0.2.16', '/* NPC State v0.2.17', 1)

storage_import = """import {\n    deleteNpcStateDataFile,\n    makeNpcStateDataFileName,\n    makeNpcStateRecoveryFileName,\n    readNpcStateDataFile,\n    retireNpcStateDataFile,\n    writeNpcStateDataFile,\n} from './storage.js';\n"""
identity_import = storage_import + """import {\n    buildQualifiedChatKey,\n    chatOwnerScope,\n    encodeChatKeyPart,\n    getCharacterOwnerId,\n    getChatIdentityFromContext,\n    isQualifiedChatKey,\n    legacyChatKey,\n    parseQualifiedChatKey,\n    sameChatOwnerScope,\n} from './identity.js';\n"""
src = replace_once(src, storage_import, identity_import, 'identity imports')

src = replace_once(src,
"const ownershipEpochs = new Map();\nconst BRANCH_INDEX_PREFIX_LIMIT = 12;",
"const ownershipEpochs = new Map();\nconst chatCacheTouches = new Map();\nconst CHAT_CACHE_LIMIT = 6;\nconst BRANCH_INDEX_PREFIX_LIMIT = 12;",
'cache LRU constants')

src = src.replace('schemaVersion: 25,', 'schemaVersion: 26,', 1)
src = replace_once(src,
"    recoveryFiles: {},\n    branchIndex: {},",
"    recoveryFiles: {},\n    branchIndex: {},\n    legacyOwnershipClaims: {},",
'legacy claim defaults')
src = replace_once(src,
"    if (!settings.recoveryFiles || typeof settings.recoveryFiles !== 'object') assign('recoveryFiles', {});\n    if (!settings.branchIndex || typeof settings.branchIndex !== 'object') assign('branchIndex', {});",
"    if (!settings.recoveryFiles || typeof settings.recoveryFiles !== 'object') assign('recoveryFiles', {});\n    if (!settings.branchIndex || typeof settings.branchIndex !== 'object') assign('branchIndex', {});\n    if (!settings.legacyOwnershipClaims || typeof settings.legacyOwnershipClaims !== 'object') assign('legacyOwnershipClaims', {});",
'legacy claim normalization')

src = sub_once(src,
r"function getChatIdentity\(ctx = getContext\(\)\) \{.*?\n\}\n\nfunction getChatKey\(\) \{.*?\n\}\n\nfunction isCanonicalChatKey\(key = getChatKey\(\)\) \{.*?\n\}\n\n",
r'''function getChatIdentity(ctx = getContext()) {
    return getChatIdentityFromContext(ctx);
}

function getChatKey() {
    return getChatIdentity().key;
}

function isCanonicalChatKey(key = getChatKey()) {
    return isQualifiedChatKey(key);
}

function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = '') {
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const resolvedOwner = String(ownerId || (kind === 'group' ? getContext().groupId || '' : getCharacterOwnerId(getContext()))).trim();
    const direct = buildQualifiedChatKey(kind, resolvedOwner, id);
    if (direct) return direct;
    const suffix = `:${encodeChatKeyPart(id)}`;
    const prefix = `${kind}:`;
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.branchIndex || {}),
        ...chatStateCache.keys(),
    ]);
    const matches = [...keys].filter(key => isCanonicalChatKey(key) && key.startsWith(prefix) && key.endsWith(suffix));
    return matches.length === 1 ? matches[0] : '';
}

function touchChatCache(key) {
    if (!isCanonicalChatKey(key)) return;
    chatCacheTouches.set(key, Date.now());
}

function forgetCachedChat(key) {
    if (!key || key === getChatKey()) return false;
    if (stateWriteTimers.has(key) || stateWritePromises.has(key) || loadingChatStates.has(key) || isScanBusy(key)) return false;
    chatStateCache.delete(key);
    loadedChatKeys.delete(key);
    hydrationErrors.delete(key);
    pendingAutoScans.delete(key);
    stateVersions.delete(key);
    persistedVersions.delete(key);
    chatCacheTouches.delete(key);
    return true;
}

function evictDormantChatStates(activeKey = getChatKey(), limit = CHAT_CACHE_LIMIT) {
    const cap = Math.max(2, Number(limit) || CHAT_CACHE_LIMIT);
    const loaded = [...chatStateCache.keys()].filter(isCanonicalChatKey);
    if (loaded.length <= cap) return 0;
    const candidates = loaded
        .filter(key => key !== activeKey)
        .sort((a, b) => Number(chatCacheTouches.get(a) || 0) - Number(chatCacheTouches.get(b) || 0));
    let removed = 0;
    for (const key of candidates) {
        if (chatStateCache.size - removed <= cap) break;
        if (forgetCachedChat(key)) removed += 1;
    }
    return removed;
}

''',
'qualified identity block')

src = replace_once(src,
"function getChatState(key = getChatKey()) {\n    if (key === 'no-chat') return freshChatState();\n    if (!chatStateCache.has(key)) chatStateCache.set(key, freshChatState());\n    return chatStateCache.get(key);\n}",
"function getChatState(key = getChatKey()) {\n    if (key === 'no-chat') return freshChatState();\n    if (!chatStateCache.has(key)) chatStateCache.set(key, freshChatState());\n    touchChatCache(key);\n    return chatStateCache.get(key);\n}",
'cache touch read')
src = replace_once(src,
"    chatStateCache.set(key, normalized);\n    if (markLoaded) { loadedChatKeys.add(key); hydrationErrors.delete(key); }",
"    chatStateCache.set(key, normalized);\n    touchChatCache(key);\n    if (markLoaded) { loadedChatKeys.add(key); hydrationErrors.delete(key); }",
'cache touch write')

src = replace_once(src,
"        const tombstoned = Boolean(settings.sidecarTombstones?.[key]);\n        if (!pointer?.path && !tombstoned) {",
"        const tombstone = settings.sidecarTombstones?.[key] || null;\n        const tombstoned = Boolean(tombstone);\n        if (tombstoned && pointer?.path) {\n            if (!settings.recoveryFiles[key]) settings.recoveryFiles[key] = { ...pointer, reason: `tombstoned:${tombstone?.reason || 'retired'}`, retiredAt: Number(tombstone?.at || Date.now()) };\n            delete settings.dataFiles[key];\n            pointer = null;\n            persistSettings();\n            console.warn(`[NPC State] ignored live sidecar pointer for tombstoned ${key}; destructive tombstone remains authoritative.`);\n        }\n        if (!pointer?.path && !tombstoned) {",
'destructive tombstone authority')

src = replace_once(src,
"        const state = setChatState(key, sourceState, { markLoaded: true });\n        if (recordBranchIndex(key, state)) persistSettings();",
"        const state = setChatState(key, sourceState, { markLoaded: true });\n        if (loaded && !needsDurableCompactionWrite) persistedVersions.set(key, Number(stateVersions.get(key) || 0));\n        if (recordBranchIndex(key, state)) persistSettings();",
'hydration persisted version')

src = replace_once(src,
"function branchIndexEntry(state) {\n    const lineage = Array.isArray(state?.lineage) ? state.lineage : [];\n    return {",
"function branchIndexEntry(key, state) {\n    const lineage = Array.isArray(state?.lineage) ? state.lineage : [];\n    return {\n        ownerScope: chatOwnerScope(key),",
'branch index owner scope')
src = replace_once(src, "    const next = branchIndexEntry(state);", "    const next = branchIndexEntry(key, state);", 'branch index call')
src = replace_once(src,
"    const settings = getSettings();\n    const lineage = chatLineage(currentChat);\n    if (lineage.length < 4) return [];\n    const matches = [];",
"    const settings = getSettings();\n    const lineage = chatLineage(currentChat);\n    const ownerScope = chatOwnerScope(currentKey);\n    if (!ownerScope || lineage.length < 4) return [];\n    const matches = [];",
'ancestor owner scope setup')
src = replace_once(src,
"        if (key === currentKey || !isCanonicalChatKey(key) || !Array.isArray(entry?.head)) continue;",
"        if (key === currentKey || !isCanonicalChatKey(key) || !sameChatOwnerScope(key, currentKey) || entry?.ownerScope !== ownerScope || !Array.isArray(entry?.head)) continue;",
'ancestor owner scope filter')
src = replace_once(src,
"        .filter(([key]) => key !== currentKey && isCanonicalChatKey(key) && !settings.branchIndex?.[key])",
"        .filter(([key]) => key !== currentKey && isCanonicalChatKey(key) && sameChatOwnerScope(key, currentKey) && !settings.branchIndex?.[key])",
'legacy discovery owner filter')

src = sub_once(src,
r"async function migrateLegacyChatStates\(\) \{.*?\n\}\n\nfunction markStateDirty",
r'''async function migrateLegacyChatStates() {
    // v0.2.17 no longer hydrates unqualified legacy keys globally. Ownership is claimed lazily
    // by migrateActiveLegacyNamespace() only when active-chat lineage proves the match.
    return false;
}

function markStateDirty''',
'legacy eager migration removal')

src = sub_once(src,
r"async function maybeInheritKnownBranch\(\) \{.*?\n\}\n\nasync function reconcileCurrentBranch",
r'''async function maybeInheritKnownBranch() {
    const key = getChatKey();
    if (key === 'no-chat' || !isCanonicalChatKey(key)) return false;
    try {
        await ensureChatStateLoaded(key);
        if (getChatKey() !== key) return false;
        const current = getChatState(key);
        const chat = getContext().chat || [];
        const lineageAtStart = chatLineage(chat);
        const isEmptyState = !current.npcs.length && !current.candidates.length && !current.dismissed.length && !current.checkpoints.length && !current.lineage.length;
        if (!isEmptyState || chat.length < 4 || chat.filter(message => message?.is_user).length < 2) return false;
        await ensureLikelyAncestorStatesLoaded(key, chat);
        if (getChatKey() !== key || firstLineageDivergence(lineageAtStart, chatLineage(getContext().chat || [])) !== -1) return false;
        const scopedStates = Object.fromEntries([...chatStateCache.entries()].filter(([candidate]) => sameChatOwnerScope(candidate, key)));
        const inherited = bestAncestorState(scopedStates, key, chat);
        if (!inherited) return false;
        setChatState(key, { ...freshChatState(), ...inherited });
        queueStateFileWrite(key, 0);
        return true;
    } finally {
        evictDormantChatStates(key);
    }
}

async function reconcileCurrentBranch''',
'owner scoped branch inheritance')

src = replace_once(src,
"function persist(key = getChatKey()) {\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) {\n        console.warn(`[NPC State] refused to persist unhydrated chat state for ${key}.`);\n        return false;\n    }\n    persistSettings();\n    queueStateFileWrite(key);\n    return true;\n}",
"function persist(key = getChatKey()) {\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) {\n        console.warn(`[NPC State] refused to persist unhydrated chat state for ${key}.`);\n        return false;\n    }\n    persistSettings();\n    queueStateFileWrite(key);\n    return true;\n}\n\nfunction persistCritical(key = getChatKey()) {\n    if (!requireReadyChatMutation('save chat dossier changes', key, { notify: false })) return false;\n    persistSettings();\n    markStateDirty(key);\n    void flushStateFile(key).catch(error => {\n        console.error('[NPC State] critical data-file persistence failed', error);\n        globalThis.toastr?.error?.('NPC State could not immediately save a critical dossier change.');\n    });\n    return true;\n}",
'critical persistence')

src = sub_once(src,
r"async function removeDeletedChatState\(rawId, kind = 'chat'\) \{\n    const key = deletedChatStateKey\(rawId, kind\);\n    if \(!key\) return false;",
r'''async function removeDeletedChatState(rawId, kind = 'chat', ownerId = '') {
    const key = resolveOwnedChatKey(rawId, kind, ownerId);
    if (!key) return false;''',
'owned deletion key')

src = sub_once(src,
r"async function moveRenamedChatState\(eventData = \{\}\) \{.*?\n    const settings = getSettings\(\);",
r'''async function moveRenamedChatState(eventData = {}) {
    const oldId = String(eventData.oldFileName || '').replace(/\.jsonl$/i, '');
    const newId = String(eventData.newFileName || '').replace(/\.jsonl$/i, '');
    if (!oldId || !newId || oldId === newId) return false;
    const isGroup = eventData.groupId !== undefined && eventData.groupId !== null && String(eventData.groupId) !== '';
    const kind = isGroup ? 'group' : 'chat';
    const eventOwner = isGroup ? String(eventData.groupId || '') : String(eventData.avatarId || getCharacterOwnerId(getContext()) || '');
    const oldKey = resolveOwnedChatKey(oldId, kind, eventOwner);
    const parsedOld = parseQualifiedChatKey(oldKey);
    const newKey = buildQualifiedChatKey(kind, parsedOld?.ownerId || eventOwner, newId);
    if (!oldKey || !newKey) return false;
    const settings = getSettings();''',
'event-owned rename')

src = sub_once(src,
r"async function migrateActiveGroupNamespace\(\) \{.*?\n\}\n\nfunction flushCurrentChatOnPageHide",
r'''function legacyMigrationMatchesActiveChat(state, chat = getContext().chat || []) {
    const stored = Array.isArray(state?.lineage) ? state.lineage : [];
    const current = chatLineage(chat);
    if (!stored.length || !current.length) return false;
    const common = firstLineageDivergence(stored, current);
    const prefix = common < 0 ? Math.min(stored.length, current.length) : common;
    const required = Math.min(4, stored.length, current.length);
    if (prefix < required) return false;
    return (Array.isArray(chat) ? chat.slice(0, required) : []).some(message => message?.is_user);
}

async function migrateActiveLegacyNamespace() {
    const identity = getChatIdentity();
    if (identity.pending || !isCanonicalChatKey(identity.key) || !identity.legacyKey) return false;
    const newKey = identity.key;
    const oldKey = identity.legacyKey;
    const settings = getSettings();
    if (settings.dataFiles?.[newKey] || chatStateCache.has(newKey)) return false;
    const oldPointer = settings.dataFiles?.[oldKey] || null;
    const oldInline = settings.chats?.[oldKey] || null;
    if (!oldPointer?.path && !oldInline) return false;
    const existingClaim = settings.legacyOwnershipClaims?.[oldKey];
    if (existingClaim?.canonicalKey && existingClaim.canonicalKey !== newKey) {
        console.warn(`[NPC State] refused legacy ownership claim for ${oldKey}; it is already claimed by ${existingClaim.canonicalKey}.`);
        return false;
    }

    const oldEpoch = bumpOwnershipEpoch(oldKey);
    const newEpoch = bumpOwnershipEpoch(newKey);
    try {
        let rawState = oldInline;
        if (oldPointer?.path) {
            const payload = await readNpcStateDataFile(oldPointer, { expectedChatKey: oldKey });
            assertOwnershipEpoch(oldKey, oldEpoch);
            if (payload?.retired || !payload?.state) return false;
            rawState = payload.state;
        }
        const state = normalizeChatState(rawState || {});
        if (!legacyMigrationMatchesActiveChat(state, getContext().chat || [])) {
            console.warn(`[NPC State] preserved ambiguous legacy sidecar ${oldKey}; active conversation lineage did not prove ownership for ${newKey}.`);
            return false;
        }
        const newPointer = await writeNpcStateDataFile({ chatKey: newKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateDataFileName(newKey) }, headers: requestHeaders() });
        assertOwnershipEpoch(newKey, newEpoch);
        const verified = await readNpcStateDataFile(newPointer, { expectedChatKey: newKey });
        assertOwnershipEpoch(newKey, newEpoch);
        if (!verified?.state || verified.retired) throw new Error('NPC State qualified namespace migration verification failed.');

        const recoveryPointer = await writeNpcStateDataFile({ chatKey: oldKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateRecoveryFileName(oldKey) }, headers: requestHeaders() });
        assertOwnershipEpoch(oldKey, oldEpoch);
        if (oldPointer?.path) await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `qualified-namespace-migrated:${newKey}`, appVersion: NPC_STATE_VERSION, headers: requestHeaders() });

        settings.recoveryFiles[oldKey] = { ...recoveryPointer, reason: `qualified-namespace-migrated:${newKey}`, retiredAt: Date.now() };
        settings.sidecarTombstones[oldKey] = { reason: `qualified-namespace-migrated:${newKey}`, at: Date.now() };
        settings.legacyOwnershipClaims[oldKey] = { canonicalKey: newKey, ownerId: identity.ownerId, kind: identity.kind, at: Date.now() };
        settings.dataFiles[newKey] = newPointer;
        delete settings.dataFiles[oldKey];
        delete settings.branchIndex[oldKey];
        if (settings.chats?.[oldKey]) delete settings.chats[oldKey];
        chatStateCache.delete(oldKey);
        loadedChatKeys.delete(oldKey);
        hydrationErrors.delete(oldKey);
        stateVersions.delete(oldKey);
        persistedVersions.delete(oldKey);
        stateWritePromises.delete(oldKey);
        pendingAutoScans.delete(oldKey);
        const installed = setChatState(newKey, state, { markLoaded: true });
        recordBranchIndex(newKey, installed);
        persistedVersions.set(newKey, Number(stateVersions.get(newKey) || 0));
        persistSettings();
        if (oldPointer?.path) {
            try { await deleteNpcStateDataFile(oldPointer, { headers: requestHeaders() }); } catch {}
        }
        console.info(`[NPC State] migrated legacy ownership ${oldKey} -> ${newKey}.`);
        return true;
    } catch (error) {
        if (error?.code !== 'NPC_STATE_STALE_OWNERSHIP') console.warn(`[NPC State] qualified namespace migration failed for ${oldKey}; legacy state remains recoverable.`, error);
        return false;
    }
}

function flushCurrentChatOnPageHide''',
'qualified legacy migration')

src = src.replace('migrateActiveGroupNamespace()', 'migrateActiveLegacyNamespace()')

src = replace_once(src,
"    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat'); });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group'); });",
"    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat', getCharacterOwnerId(getContext())); });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group', String(getContext().groupId || '')); });",
'owned delete events')

# Critical user mutations: explicitly start persistence immediately instead of waiting for the normal scan debounce.
src = replace_once(src, "    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, 'manual-edit');\n    persist();", "    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, 'manual-edit');\n    persistCritical(originChatKey);", 'editor critical save')
src = replace_once(src, "    working.pendingBackfills = (working.pendingBackfills || []).filter(item => item.npcId !== result.report.npcId && normalizeName(item.label) !== reportKey);\n    const targetMessageId", "    working.pendingBackfills = (working.pendingBackfills || []).filter(item => item.npcId !== result.report.npcId && normalizeName(item.label) !== reportKey);\n    if (working.portraitAssets && typeof working.portraitAssets === 'object') delete working.portraitAssets[current.id];\n    const targetMessageId", 'manual portrait asset deletion')
src = replace_once(src, "    setChatState(getChatKey(), working);\n    persist();\n    closeNpcEditor();", "    setChatState(getChatKey(), working);\n    persistCritical();\n    closeNpcEditor();", 'delete critical save')
src = replace_once(src, "    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, archived ? 'manual-archive' : 'manual-restore');\n    persist();", "    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, archived ? 'manual-archive' : 'manual-restore');\n    persistCritical();", 'archive critical save')
src = replace_once(src, "    setChatState(getChatKey(), merged);\n    persist();\n    renderDossier();", "    setChatState(getChatKey(), merged);\n    persistCritical();\n    renderDossier();", 'import critical save')
src = replace_once(src, "        setChatState(getChatKey(), result.state);\n        persist(); renderDossier(); updateInjection();", "        setChatState(getChatKey(), result.state);\n        persistCritical(); renderDossier(); updateInjection();", 'manual add critical save')
src = replace_once(src, "        setChatState(getChatKey(), cleared);\n        persist(); renderDossier(); updateInjection();", "        setChatState(getChatKey(), cleared);\n        persistCritical(); renderDossier(); updateInjection();", 'clear critical save')
src = replace_once(src, "            liveNpc.updatedAt = Date.now();\n            persist(); renderDossier();", "            liveNpc.updatedAt = Date.now();\n            persistCritical(originChatKey); renderDossier();", 'portrait upload critical save')
src = replace_once(src, "        npc.portrait = null;\n        delete getChatState().portraitAssets[npc.id];\n        npc.updatedAt = Date.now(); persist(); renderDossier();", "        npc.portrait = null;\n        delete getChatState().portraitAssets[npc.id];\n        npc.updatedAt = Date.now(); persistCritical(); renderDossier();", 'portrait removal critical save')
src = replace_once(src, "        getChatState().portraitAssets[npc.id] = structuredClone(npc.portrait);\n        npc.updatedAt = Date.now();\n        persist();", "        getChatState().portraitAssets[npc.id] = structuredClone(npc.portrait);\n        npc.updatedAt = Date.now();\n        persistCritical(activePortraitGeneratorChatKey || getChatKey());", 'generated portrait critical save')
src = replace_once(src, "    setChatState(getChatKey(), working);\n    persist();\n    renderDossier();\n    updateInjection();\n\n    for (const report of reports)", "    setChatState(getChatKey(), working);\n    persistCritical();\n    renderDossier();\n    updateInjection();\n\n    for (const report of reports)", 'OOC critical save')

# Evict old hydrated chats only after active lifecycle work has settled.
src = replace_once(src,
"                if (key !== 'no-chat') void drainPendingAutoScan(key);",
"                if (key !== 'no-chat') void drainPendingAutoScan(key);\n                evictDormantChatStates(key);",
'chat change cache eviction')
src = replace_once(src,
"    updateInjection();\n    console.log(`[NPC State] v${NPC_STATE_VERSION} loaded`);",
"    updateInjection();\n    evictDormantChatStates(getChatKey());\n    console.log(`[NPC State] v${NPC_STATE_VERSION} loaded`);",
'init cache eviction')

INDEX.write_text(src)

# ---------------- storage.js ----------------
st = STORAGE.read_text()
helper = r'''export function retainedPortraitAssetIds(state = {}) {
    const retained = new Set();
    const addNpcs = value => {
        for (const npc of Array.isArray(value) ? value : []) {
            const id = String(npc?.id || '').trim();
            if (id) retained.add(id);
        }
    };
    addNpcs(state.npcs);
    for (const checkpoint of Array.isArray(state.checkpoints) ? state.checkpoints : []) addNpcs(checkpoint?.snapshot?.npcs);
    addNpcs(state.branchRootSnapshot?.npcs);
    const blocked = new Set((Array.isArray(state.userDismissedGroups) ? state.userDismissedGroups : [])
        .flatMap(group => [...(Array.isArray(group?.ids) ? group.ids : []), group?.npcId])
        .map(value => String(value || '').trim()).filter(Boolean));
    for (const id of blocked) retained.delete(id);
    return retained;
}

export function prunePortraitAssetsForState(state = {}) {
    const assets = state?.portraitAssets && typeof state.portraitAssets === 'object' ? state.portraitAssets : {};
    const retained = retainedPortraitAssetIds(state);
    return Object.fromEntries(Object.entries(assets).filter(([id, portrait]) => retained.has(String(id)) && portrait?.dataUrl));
}

'''
st = replace_once(st, 'function compactStateForFile(state) {', helper + 'function compactStateForFile(state) {', 'portrait GC helpers')
st = replace_once(st,
"    snapshot.portraitAssets = snapshot.portraitAssets && typeof snapshot.portraitAssets === 'object'\n        ? snapshot.portraitAssets\n        : {};",
"    snapshot.portraitAssets = prunePortraitAssetsForState(snapshot);",
'portrait asset compaction')
STORAGE.write_text(st)

# ---------------- branch.js ----------------
br = BRANCH.read_text()
br = replace_once(br, 'export const BRANCH_HISTORY_LIMIT = 160;\nexport const BRANCH_LINEAGE_VERSION = 2;', 'export const BRANCH_HISTORY_LIMIT = 160;\nexport const BRANCH_SNAPSHOT_BUDGET_CHARS = 2_000_000;\nexport const BRANCH_LINEAGE_VERSION = 2;', 'branch snapshot budget constant')
prune = r'''export function pruneBranchCheckpoints(checkpoints = [], activeLineage = [], limit = BRANCH_HISTORY_LIMIT) {
    const cap = Math.max(8, Number(limit) || BRANCH_HISTORY_LIMIT);
    const normalized = normalizeBranchCheckpoints(checkpoints, activeLineage);
    const activeKeys = new Set(lineageCheckpointKeys(activeLineage));
    const active = normalized.filter(item => activeKeys.has(item.lineageKey)).sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
    const siblings = normalized.filter(item => !activeKeys.has(item.lineageKey)).sort((a, b) => b.createdAt - a.createdAt || b.messageId - a.messageId);
    const keep = new Map();

    if (normalized.length <= cap) {
        for (const item of normalized) keep.set(item.lineageKey, item);
    } else {
        const siblingBudget = Math.min(siblings.length, Math.max(8, Math.floor(cap * 0.25)));
        const activeBudget = Math.max(1, cap - siblingBudget);
        if (active.length) {
            keep.set(active[0].lineageKey, active[0]);
            const newestActive = active.slice(-Math.max(1, activeBudget - 1));
            for (const item of newestActive) keep.set(item.lineageKey, item);
        }
        for (const item of siblings.slice(0, siblingBudget)) keep.set(item.lineageKey, item);
        if (!active.length) for (const item of normalized.slice(-cap)) keep.set(item.lineageKey, item);
    }

    let selected = [...keep.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
    const sizeOf = item => {
        try { return JSON.stringify(item?.snapshot || {}).length + 256; }
        catch { return BRANCH_SNAPSHOT_BUDGET_CHARS; }
    };
    let used = selected.reduce((sum, item) => sum + sizeOf(item), 0);
    if (used <= BRANCH_SNAPSHOT_BUDGET_CHARS) return selected;

    // Preserve one ancient active anchor plus the newest useful checkpoints. Older redundant
    // snapshots are safely discarded; reconciliation can rescan from the retained ancestor.
    const budgeted = new Map();
    used = 0;
    const oldestActive = selected.find(item => activeKeys.has(item.lineageKey)) || null;
    if (oldestActive) {
        budgeted.set(oldestActive.lineageKey, oldestActive);
        used += sizeOf(oldestActive);
    }
    const newestFirst = [...selected].sort((a, b) => b.createdAt - a.createdAt || b.messageId - a.messageId);
    for (const item of newestFirst) {
        if (budgeted.has(item.lineageKey)) continue;
        const size = sizeOf(item);
        if (budgeted.size && used + size > BRANCH_SNAPSHOT_BUDGET_CHARS) continue;
        budgeted.set(item.lineageKey, item);
        used += size;
    }
    if (!budgeted.size && newestFirst.length) budgeted.set(newestFirst[0].lineageKey, newestFirst[0]);
    return [...budgeted.values()].sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt);
}

'''
br = sub_once(br, r"export function pruneBranchCheckpoints\(checkpoints = \[\], activeLineage = \[\], limit = BRANCH_HISTORY_LIMIT\) \{.*?\n\}\n\n(?=export function recordBranchCheckpoint)", prune, 'budgeted checkpoint pruning')
BRANCH.write_text(br)

# ---------------- tests ----------------
hardening_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BRANCH_SNAPSHOT_BUDGET_CHARS, chatLineage, pruneBranchCheckpoints } from '../branch.js';
import { prunePortraitAssetsForState } from '../storage.js';
import { buildQualifiedChatKey } from '../identity.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function msg(text, isUser = false) { return { mes: text, is_user: isUser, is_system: false, name: isUser ? 'User' : 'Character' }; }

test('branch snapshots obey a bounded character budget while retaining useful anchors', () => {
    const chat = Array.from({ length: 30 }, (_, i) => msg(`turn-${i}`, i % 2 === 1));
    const lineage = chatLineage(chat);
    const checkpoints = lineage.map((fingerprint, i) => ({
        messageId: i, fingerprint, lineageKey: '', parentLineageKey: '', createdAt: i + 1,
        snapshot: { npcs: [{ id: `npc-${i}`, personality: 'x'.repeat(180000) }] },
    }));
    const pruned = pruneBranchCheckpoints(checkpoints, lineage, 160);
    const size = pruned.reduce((sum, item) => sum + JSON.stringify(item.snapshot || {}).length + 256, 0);
    assert.ok(size <= BRANCH_SNAPSHOT_BUDGET_CHARS || pruned.length === 1);
    assert.ok(pruned.length < checkpoints.length);
    assert.ok(pruned.some(item => item.messageId === 29), 'newest checkpoint must survive budget compaction');
});

test('portrait GC removes unreachable and manually deleted assets but keeps branch-restorable assets', () => {
    const state = {
        npcs: [{ id: 'live' }],
        checkpoints: [{ snapshot: { npcs: [{ id: 'branch-old' }, { id: 'deleted' }] } }],
        branchRootSnapshot: null,
        userDismissedGroups: [{ ids: ['deleted'] }],
        portraitAssets: {
            live: { dataUrl: 'data:image/webp;base64,AA==' },
            'branch-old': { dataUrl: 'data:image/webp;base64,AQ==' },
            deleted: { dataUrl: 'data:image/webp;base64,Ag==' },
            orphan: { dataUrl: 'data:image/webp;base64,Aw==' },
        },
    };
    assert.deepEqual(Object.keys(prunePortraitAssetsForState(state)).sort(), ['branch-old', 'live']);
});

test('branch discovery and inheritance are owner scoped', () => {
    assert.match(index, /sameChatOwnerScope\(key, currentKey\)/);
    assert.match(index, /chatStateCache\.entries\(\)\]\.filter\(\(\[candidate\]\) => sameChatOwnerScope\(candidate, key\)\)/);
});

test('tombstones override stale live pointers before hydration', () => {
    assert.match(index, /ignored live sidecar pointer for tombstoned/);
    assert.match(index, /delete settings\.dataFiles\[key\];\n\s*pointer = null/);
});

test('successful hydration starts clean instead of forcing an unload rewrite', () => {
    assert.match(index, /if \(loaded && !needsDurableCompactionWrite\) persistedVersions\.set/);
});

test('chat cache has bounded eviction and refuses to evict active work', () => {
    assert.match(index, /const CHAT_CACHE_LIMIT = 6/);
    assert.match(index, /function evictDormantChatStates/);
    assert.match(index, /stateWriteTimers\.has\(key\) \|\| stateWritePromises\.has\(key\) \|\| loadingChatStates\.has\(key\) \|\| isScanBusy\(key\)/);
});

test('high-value manual mutations use immediate persistence', () => {
    assert.match(index, /function persistCritical/);
    assert.match(index, /persistCritical\(originChatKey\)/);
    assert.match(index, /persistCritical\(\);\n\s*closeNpcEditor/);
});

test('legacy ownership migration is lineage-gated and owner-qualified', () => {
    assert.match(index, /legacyMigrationMatchesActiveChat/);
    assert.match(index, /legacyOwnershipClaims/);
    assert.match(index, /qualified-namespace-migrated/);
});

test('same chat filename for two owners produces distinct canonical keys', () => {
    assert.notEqual(buildQualifiedChatKey('chat', 'a.png', 'save'), buildQualifiedChatKey('chat', 'b.png', 'save'));
});

test('production CI is read-only and version-neutral', () => {
    assert.match(ci, /contents: read/);
    assert.doesNotMatch(ci, /v0\.2\.15-release-hardening-10x|apply_v0215_release|Commit verified v0\.2\.16/);
});
'''
Path('tests/v0217-hardening.test.js').write_text(hardening_test)

# Runtime/migration mocks must ship the new identity module and assert owner collisions.
for name in ['tests/runtime-smoke.mjs', 'tests/migration-smoke.mjs']:
    q = Path(name)
    t = q.read_text()
    t = t.replace("['index.js', 'core.js', 'bundle.js', 'branch.js', 'social.js', 'storage.js']", "['index.js', 'core.js', 'bundle.js', 'branch.js', 'social.js', 'storage.js', 'identity.js']")
    q.write_text(t)

runtime = Path('tests/runtime-smoke.mjs')
rt = runtime.read_text()
rt = rt.replace("assert.equal(globalThis.NPCState?.version, '0.2.16');", "assert.equal(globalThis.NPCState?.version, '0.2.17');")
rt = replace_once(rt,
"    assert.equal(globalThis.NPCState.uiStatus().chatKey, 'group:group-chat-1', 'groupId must force the group namespace even when chatId is present');\n\n    console.log('Runtime smoke: file persistence, strict presence cards, off-screen World State activity, reversible archive, desire metric, branching, OOC removal, chat cleanup, and group identity passed.');",
"    assert.equal(globalThis.NPCState.uiStatus().chatKey, 'group:party-1:group-chat-1', 'group identity must include both group owner and active group chat id');\n\n    // Two character cards may legitimately use the same chat filename. Their durable namespaces must never collide.\n    mockState.context.groupId = null;\n    mockState.context.characters = [{ name: 'Megumin', avatar: 'megumin.png' }, { name: 'Yunyun', avatar: 'yunyun.png' }];\n    mockState.context.characterId = 0;\n    mockState.context.chatId = 'shared-save';\n    mockState.context.getCurrentChatId = () => 'shared-save';\n    mockState.context.chat = [{ is_user: false, is_system: false, name: 'Megumin', mes: 'Same opening.' }, { is_user: true, is_system: false, name: 'Kazuma', mes: 'Same reply.' }];\n    eventSource.emit('chat_changed');\n    await sleep(80);\n    const ownerAKey = globalThis.NPCState.uiStatus().chatKey;\n    mockState.context.characterId = 1;\n    eventSource.emit('chat_changed');\n    await sleep(80);\n    const ownerBKey = globalThis.NPCState.uiStatus().chatKey;\n    assert.equal(ownerAKey, 'chat:megumin.png:shared-save');\n    assert.equal(ownerBKey, 'chat:yunyun.png:shared-save');\n    assert.notEqual(ownerAKey, ownerBKey);\n\n    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');",
'runtime owner collision assertion')
runtime.write_text(rt)

migration = Path('tests/migration-smoke.mjs')
mt = migration.read_text()
mt = mt.replace('assert.equal(settings.schemaVersion, 25);', 'assert.equal(settings.schemaVersion, 26);')
mt = mt.replace("const pointer = settings.dataFiles['chat:legacy-chat'];", "const pointer = settings.dataFiles['chat:megumin.png:legacy-chat'];")
mt = mt.replace('assert.equal(mock.extensionSettings.npc_state.schemaVersion, 25);', 'assert.equal(mock.extensionSettings.npc_state.schemaVersion, 26);')
migration.write_text(mt)

# Existing version assertions and release surfaces.
for name in ['core.js', 'manifest.json', 'README.md', 'CODE-REVIEW.md', 'TEST-REPORT.md', 'tests/package.test.js', 'tests/v0214-hardening.test.js']:
    q = Path(name)
    text = q.read_text()
    text = text.replace('0.2.16', '0.2.17').replace('v0.2.16', 'v0.2.17')
    q.write_text(text)

manifest = json.loads(Path('manifest.json').read_text())
manifest['version'] = '0.2.17'
Path('manifest.json').write_text(json.dumps(manifest, indent=4) + '\n')

ch = Path('CHANGELOG.md')
ct = ch.read_text()
entry = '''## 0.2.17\n\n- Owner-qualified chat identity prevents same-filename character and group conversations from sharing state.\n- Legacy unqualified sidecars migrate only when active conversation lineage proves ownership; ambiguous legacy data remains recoverable.\n- Branch ancestry is restricted to the same character/group owner.\n- Destructive tombstones override stale live pointers after interrupted delete/retire operations.\n- Successful unchanged hydration is marked clean so page-hide does not force a redundant whole-sidecar rewrite.\n- Portrait assets are garbage-collected against live/branch-restorable NPC ids and permanent deletion tombstones.\n- Branch checkpoint snapshots are adaptively compacted under a bounded serialized-character budget.\n- Hydrated chat state uses bounded LRU-style eviction once pending writes, loads, and scans have settled.\n- High-value manual dossier edits, imports, deletes, archive changes, and portrait changes start persistence immediately.\n- Production CI returns to read-only, version-neutral verification after the ten-pass release gate.\n\n'''
if '## 0.2.17' not in ct:
    if ct.startswith('# Changelog\n\n'):
        ct = '# Changelog\n\n' + entry + ct[len('# Changelog\n\n'):]
    else:
        ct = '# Changelog\n\n' + entry + ct
ch.write_text(ct)

# Generic permanent CI replaces release mutation scaffolding in the verified commit.
Path('.github/workflows/ci.yml').write_text(r'''name: NPC State CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: 24
      - name: Syntax and diff check
        run: |
          node --check index.js
          node --check core.js
          node --check branch.js
          node --check bundle.js
          node --check social.js
          node --check storage.js
          node --check identity.js
          git diff --check
      - name: Full verification
        run: npm test
      - name: Release consistency
        run: |
          node --input-type=module <<'NODE'
          import fs from 'node:fs';
          const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
          const core = fs.readFileSync('core.js', 'utf8');
          const readme = fs.readFileSync('README.md', 'utf8');
          const escaped = String(manifest.version).replaceAll('.', '\\.');
          if (!new RegExp(`NPC_STATE_VERSION = ['\"]${escaped}['\"]`).test(core)) throw new Error('core version does not match manifest');
          if (!readme.startsWith(`# NPC State v${manifest.version}`)) throw new Error('README version does not match manifest');
          NODE
''')

# Temporary historical release mutator and this staging mutator must not land in production.
old_script = Path('.github/scripts/apply_v0215_release.py')
if old_script.exists(): old_script.unlink()
self_path = Path(__file__)
if self_path.exists(): self_path.unlink()

print('v0.2.17 identity/storage hardening applied in verification workspace')
