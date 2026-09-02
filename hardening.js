import { extension_settings, getContext } from '../../../extensions.js';
import { getRequestHeaders, saveSettings as saveHostSettings } from '../../../../script.js';
import { NPC_STATE_VERSION } from './core.js';
import {
    chatLineage as legacyV2Lineage,
    legacyChatLineageV0210,
} from './branch-v0218.js';
import {
    BRANCH_LINEAGE_VERSION,
    chatLineage,
    migrateLegacyBranchState,
    rebaseBranchStateForHostRename,
    setBranchProvenanceHint,
} from './branch.js';
import {
    buildQualifiedChatKey,
    chatOwnerScope,
    getCharacterOwnerId,
    getChatIdentityFromContext,
    parseQualifiedChatKey,
} from './identity.js';
import {
    deleteNpcStateDataFile,
    makeNpcStateRecoveryFileName,
    readNpcStateDataFile,
    retireNpcStateDataFile,
    writeNpcStateDataFile,
} from './storage.js';
import {
    allSettingsKeys,
    applyCanonicalOwnershipMove,
    destinationKeyForOwnerRename,
    qualifiedKeysForOwner,
    resolveGroupOwnerId,
    retargetBranchIndexEntry,
    strongLegacyMigrationMatches,
    uniqueQualifiedKeyForChat,
} from './hardening-core.js';

const EXTENSION_NAME = 'npc_state';
const RECOVERY_HISTORY_LIMIT = 80;
let installed = false;
let historicalRenameIndexPromise = null;
let historicalRenamePair = '';

function settings() {
    const value = extension_settings[EXTENSION_NAME] && typeof extension_settings[EXTENSION_NAME] === 'object'
        ? extension_settings[EXTENSION_NAME]
        : (extension_settings[EXTENSION_NAME] = {});
    for (const key of ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex', 'legacyOwnershipClaims', 'recoveryHistory', 'recoveryGarbage']) {
        if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) value[key] = {};
    }
    return value;
}

function queueSettingsSave() {
    try { getContext()?.saveSettingsDebounced?.(); }
    catch (error) { console.debug('[NPC State] v0.2.19 settings save was deferred', error); }
}

async function saveSettingsNow() {
    await saveHostSettings();
}

function headers() {
    try { return getRequestHeaders?.() || {}; }
    catch { return {}; }
}

function archiveRecoveryRecord(config, key, reason = 'superseded') {
    const existing = config.recoveryFiles?.[key];
    if (!existing) return;
    const stamp = Date.now();
    const historyKey = `${key}@${stamp}:${Math.random().toString(36).slice(2, 8)}`;
    config.recoveryHistory[historyKey] = { ...structuredClone(existing), archivedAt: stamp, archiveReason: reason };
    delete config.recoveryFiles[key];
    const entries = Object.entries(config.recoveryHistory).sort((a, b) => Number(b[1]?.archivedAt || 0) - Number(a[1]?.archivedAt || 0));
    for (const [oldKey, record] of entries.slice(RECOVERY_HISTORY_LIMIT)) {
        if (record?.path) config.recoveryGarbage[oldKey] = { name: record.name || '', path: record.path, queuedAt: Date.now() };
        delete config.recoveryHistory[oldKey];
    }
}

async function cleanupRecoveryGarbage(config = settings()) {
    let changed = false;
    for (const [key, pointer] of Object.entries(config.recoveryGarbage || {})) {
        if (!pointer?.path) { delete config.recoveryGarbage[key]; changed = true; continue; }
        try {
            await deleteNpcStateDataFile(pointer, { headers: headers() });
            delete config.recoveryGarbage[key];
            changed = true;
        } catch (error) {
            console.debug(`[NPC State] recovery garbage cleanup deferred for ${pointer.path}.`, error);
        }
    }
    if (changed) await saveHostSettings();
    return changed;
}

async function stateFromPointer(key, pointer, inlineState = null) {
    if (pointer?.path) {
        const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
        if (!payload || payload.retired || !payload.state) return null;
        return structuredClone(payload.state);
    }
    return inlineState && typeof inlineState === 'object' ? structuredClone(inlineState) : null;
}

async function writeVerifiedState(key, state, pointer = null, { operationKey = '' } = {}) {
    const written = await writeNpcStateDataFile({
        chatKey: key,
        state,
        appVersion: NPC_STATE_VERSION,
        pointer,
        operationKey,
        headers: headers(),
    });
    const verified = await readNpcStateDataFile(written, { expectedChatKey: key });
    if (!verified || verified.retired || !verified.state) throw new Error(`NPC State verification failed after writing ${key}.`);
    return written;
}

async function writeRecovery(key, state, reason) {
    const name = makeNpcStateRecoveryFileName(key);
    const operationKey = `recovery:${key}:${name}`;
    const pointer = await writeVerifiedState(key, state, { name }, { operationKey });
    return { ...pointer, reason: String(reason || 'recovery'), recoveredAt: Date.now() };
}

function installBranchProvenanceHint() {
    const ctx = getContext() || {};
    const identity = getChatIdentityFromContext(ctx);
    const metadata = ctx.chatMetadata || ctx.chat_metadata || {};
    setBranchProvenanceHint({
        mainChat: metadata?.main_chat || '',
        ownerScope: chatOwnerScope(identity.key),
        currentKey: identity.key,
    });
}

async function safeLegacyMigrationForCurrent() {
    const ctx = getContext() || {};
    const identity = getChatIdentityFromContext(ctx);
    installBranchProvenanceHint();
    if (identity.pending || !identity.key || !identity.legacyCandidateKey) return false;
    const config = settings();
    if (config.dataFiles?.[identity.key]) return false;
    const oldKey = identity.legacyCandidateKey;
    const oldPointer = config.dataFiles?.[oldKey] || null;
    const oldInline = config.chats?.[oldKey] || null;
    if (!oldPointer?.path && !oldInline) return false;
    const claim = config.legacyOwnershipClaims?.[oldKey];
    if (claim?.canonicalKey && claim.canonicalKey !== identity.key) {
        console.warn(`[NPC State] v0.2.20 preserved legacy namespace ${oldKey}; another canonical owner already claimed it.`);
        return false;
    }

    const rawState = await stateFromPointer(oldKey, oldPointer, oldInline);
    if (!rawState) return false;
    if (!strongLegacyMigrationMatches(rawState, ctx.chat || [], { lineageV2Fn: legacyV2Lineage, lineageV0210Fn: legacyChatLineageV0210 })) {
        console.warn(`[NPC State] v0.2.20 preserved ambiguous legacy namespace ${oldKey}; the entire stored lineage must prove ownership.`);
        return false;
    }

    const migrated = migrateLegacyBranchState(rawState, ctx.chat || []);
    const newPointer = await writeVerifiedState(identity.key, migrated);
    const recoveryPointer = await writeRecovery(oldKey, migrated, `qualified-namespace-migrated:${identity.key}`);
    try {
        if (oldPointer?.path) await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `qualified-namespace-migrated:${identity.key}`, appVersion: NPC_STATE_VERSION, headers: headers() });
    } catch (error) {
        try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); } catch { /* best effort */ }
        console.warn(`[NPC State] v0.2.20 refused legacy ownership migration for ${oldKey}; the source changed during the transaction.`, error);
        return false;
    }

    archiveRecoveryRecord(config, identity.key, 'canonical-ownership-reestablished');
    config.recoveryFiles[oldKey] = recoveryPointer;
    config.sidecarTombstones[oldKey] = { reason: `qualified-namespace-migrated:${identity.key}`, at: Date.now() };
    config.legacyOwnershipClaims[oldKey] = { canonicalKey: identity.key, ownerId: identity.ownerId, kind: identity.kind, at: Date.now(), proofVersion: 3 };
    config.dataFiles[identity.key] = newPointer;
    delete config.sidecarTombstones[identity.key];
    delete config.dataFiles[oldKey];
    delete config.branchIndex[oldKey];
    if (config.chats?.[oldKey]) delete config.chats[oldKey];
    if (config.chats && Object.keys(config.chats).length === 0) delete config.chats;
    await saveSettingsNow();
    await cleanupRecoveryGarbage(config);
    return true;
}

async function migrateCharacterOwner(oldAvatar, newAvatar) {
    const oldOwner = String(oldAvatar || '').trim();
    const newOwner = String(newAvatar || '').trim();
    if (!oldOwner || !newOwner || oldOwner === newOwner) return false;
    const config = settings();
    try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', oldOwner); }
    catch (error) { console.debug('[NPC State] owner pre-rename cache flush was incomplete.', error); }

    const sourceKeys = qualifiedKeysForOwner(config, 'chat', oldOwner);
    if (!sourceKeys.length) return false;
    const moved = new Map();
    let changed = false;

    for (const oldKey of sourceKeys) {
        const newKey = destinationKeyForOwnerRename(oldKey, newOwner);
        if (!newKey || newKey === oldKey) continue;
        if (config.dataFiles?.[newKey]) {
            console.warn(`[NPC State] character rename preserved ${oldKey}; destination ${newKey} already has live state.`);
            continue;
        }
        const oldPointer = config.dataFiles?.[oldKey] || null;
        const oldInline = config.chats?.[oldKey] || null;
        let state = null;
        let newPointer = null;
        let recoveryPointer = null;
        let sourceRetired = !oldPointer?.path;

        for (let attempt = 0; attempt < 4; attempt += 1) {
            state = await stateFromPointer(oldKey, oldPointer, oldInline);
            if (!state) break;
            newPointer = await writeVerifiedState(newKey, state, newPointer?.path ? newPointer : null);
            if (recoveryPointer?.path) {
                try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); } catch { /* best effort */ }
            }
            recoveryPointer = await writeRecovery(oldKey, state, `character-renamed:${newKey}`);
            if (!oldPointer?.path) { sourceRetired = true; break; }
            try {
                await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `character-renamed:${newKey}`, appVersion: NPC_STATE_VERSION, headers: headers() });
                sourceRetired = true;
                break;
            } catch (error) {
                if (error?.code !== 'NPC_STATE_WRITE_CONFLICT' || attempt >= 3) {
                    console.warn(`[NPC State] character rename left ${oldKey} under its prior durable owner because it kept changing in another writer.`, error);
                    break;
                }
            }
        }
        if (state && !sourceRetired) {
            if (newPointer?.path) { try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); } catch { /* best effort */ } }
            if (recoveryPointer?.path) { try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); } catch { /* best effort */ } }
            continue;
        }

        archiveRecoveryRecord(config, newKey, 'canonical-ownership-reestablished');
        applyCanonicalOwnershipMove(config, { oldKey, newKey, newPointer, recoveryPointer, reason: 'character-renamed' });
        if (config.chats?.[oldKey]) {
            config.chats[newKey] = config.chats[oldKey];
            delete config.chats[oldKey];
        }
        moved.set(oldKey, newKey);
        changed = true;
    }

    for (const claim of Object.values(config.legacyOwnershipClaims || {})) {
        const replacement = moved.get(String(claim?.canonicalKey || ''));
        if (replacement) claim.canonicalKey = replacement;
    }
    if (changed) await saveSettingsNow();
    globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);
    globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', newOwner);
    if (changed) await cleanupRecoveryGarbage(config);
    return changed;
}

async function retireCharacterOwner(avatar, reason = 'character-deleted') {
    const owner = String(avatar || '').trim();
    if (!owner) return false;
    const config = settings();
    try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner); }
    catch (error) { console.debug('[NPC State] owner pre-delete cache flush was incomplete.', error); }
    const keys = qualifiedKeysForOwner(config, 'chat', owner);
    if (!keys.length) {
        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);
        return false;
    }
    let changed = false;
    for (const key of keys) {
        const pointer = config.dataFiles?.[key] || null;
        const inline = config.chats?.[key] || null;
        const state = await stateFromPointer(key, pointer, inline);
        const recoveryPointer = state ? await writeRecovery(key, state, reason) : null;
        try {
            if (pointer?.path) await retireNpcStateDataFile({ chatKey: key, pointer, reason, appVersion: NPC_STATE_VERSION, headers: headers() });
        } catch (error) {
            if (recoveryPointer?.path) { try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); } catch { /* best effort */ } }
            console.warn(`[NPC State] character deletion preserved changing sidecar ${key} rather than tombstoning a newer writer.`, error);
            continue;
        }
        archiveRecoveryRecord(config, key, 'character-deleted-replaced');
        if (recoveryPointer) config.recoveryFiles[key] = recoveryPointer;
        config.sidecarTombstones[key] = { reason, at: Date.now() };
        delete config.dataFiles[key];
        delete config.branchIndex[key];
        if (config.chats?.[key]) delete config.chats[key];
        changed = true;
    }
    if (changed) await saveSettingsNow();
    globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);
    if (changed) await cleanupRecoveryGarbage(config);
    return changed;
}

async function rebaseActiveStateAfterHostRename(messages) {
    const ctx = getContext() || {};
    const active = Array.isArray(ctx.chat) ? ctx.chat : [];
    const renamed = stripHostChatHeader(messages);
    if (!active.length || !renamed.length || !sameNarrativeContent(active, renamed)) return false;
    const identity = getChatIdentityFromContext(ctx);
    return rebaseCanonicalStateForHostRename(identity.key, renamed);
}

function stripHostChatHeader(messages) {
    const source = Array.isArray(messages) ? messages : [];
    return source.filter((message, index) => !(index === 0 && message && typeof message === 'object' && Object.hasOwn(message, 'chat_metadata')));
}

function sameNarrativeContent(left, right) {
    const a = chatLineage(stripHostChatHeader(left));
    const b = chatLineage(stripHostChatHeader(right));
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hostChatIntegrity(messages) {
    const header = Array.isArray(messages) ? messages.find(message => message && typeof message === 'object' && Object.hasOwn(message, 'chat_metadata')) : null;
    return String(header?.chat_metadata?.integrity || '').trim();
}

async function loadPersistedGroupChat(chatId) {
    const response = await globalThis.fetch?.('/api/chats/group/get', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: String(chatId || '') }),
    });
    if (!response?.ok) return [];
    const data = typeof response.json === 'function' ? await response.json() : [];
    return Array.isArray(data) ? data : [];
}

async function rebaseCanonicalStateForHostRename(key, renamedMessages) {
    if (!key) return false;
    const config = settings();
    const pointer = config.dataFiles?.[key];
    if (!pointer?.path) return false;
    const state = await stateFromPointer(key, pointer);
    if (!state || Number(state.branchLineageVersion || 0) >= BRANCH_LINEAGE_VERSION) return false;
    rebaseBranchStateForHostRename(state, renamedMessages);
    const written = await writeVerifiedState(key, state, pointer);
    config.dataFiles[key] = written;
    queueSettingsSave();
    return true;
}

function resetHistoricalRenameIndex() {
    historicalRenameIndexPromise = null;
    historicalRenamePair = '';
}

async function loadPersistedCharacterChat(chatId, avatar = '') {
    const context = getContext() || {};
    const character = (Array.isArray(context.characters) ? context.characters : []).find(item => String(item?.avatar || '') === String(avatar || ''));
    const response = await globalThis.fetch?.('/api/chats/get', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ch_name: String(character?.name || ''), file_name: String(chatId || ''), avatar_url: String(avatar || '') }),
    });
    if (!response?.ok) return [];
    const data = typeof response.json === 'function' ? await response.json() : [];
    return Array.isArray(data) ? data : [];
}

function historicalChatSignature(messages) {
    const integrity = hostChatIntegrity(messages);
    if (integrity) return `integrity:${integrity}`;
    const lineage = chatLineage(stripHostChatHeader(messages));
    return lineage.length ? `lineage:${lineage.join('|')}` : '';
}

async function buildHistoricalRenameIndex(oldAvatar = '', newAvatar = '') {
    const oldOwner = String(oldAvatar || '').trim();
    const newOwner = String(newAvatar || '').trim();
    const pair = `${oldOwner}->${newOwner}`;
    if (historicalRenameIndexPromise && historicalRenamePair === pair) return historicalRenameIndexPromise;
    historicalRenamePair = pair;
    historicalRenameIndexPromise = (async () => {
        const context = getContext() || {};
        const config = settings();
        const relevantGroups = new Set((Array.isArray(context.groups) ? context.groups : [])
            .filter(group => {
                const members = Array.isArray(group?.members) ? group.members : [];
                return members.includes(oldOwner) || members.includes(newOwner);
            })
            .map(group => String(group?.id || '').trim()).filter(Boolean));
        const candidateKeys = Object.keys(config.dataFiles || {}).filter(key => {
            const parsed = parseQualifiedChatKey(key);
            if (!parsed) return false;
            if (parsed.kind === 'chat') return parsed.ownerId === newOwner;
            return parsed.kind === 'group' && relevantGroups.has(parsed.ownerId);
        });
        const index = new Map();
        let cursor = 0;
        const workers = Array.from({ length: Math.min(4, Math.max(1, candidateKeys.length)) }, async () => {
            while (cursor < candidateKeys.length) {
                const key = candidateKeys[cursor++];
                const parsed = parseQualifiedChatKey(key);
                if (!parsed) continue;
                const persisted = parsed.kind === 'group'
                    ? await loadPersistedGroupChat(parsed.chatId)
                    : await loadPersistedCharacterChat(parsed.chatId, newOwner);
                const signature = historicalChatSignature(persisted);
                if (!signature) continue;
                const list = index.get(signature) || [];
                list.push(key);
                index.set(signature, list);
            }
        });
        await Promise.all(workers);
        return index;
    })().catch(error => {
        resetHistoricalRenameIndex();
        throw error;
    });
    return historicalRenameIndexPromise;
}

async function rebaseHistoricalState(messages, oldAvatar = '', newAvatar = '') {
    const signature = historicalChatSignature(messages);
    if (!signature) return false;
    const index = await buildHistoricalRenameIndex(oldAvatar, newAvatar);
    const matches = [...new Set(index.get(signature) || [])];
    if (matches.length !== 1) return false;
    return rebaseCanonicalStateForHostRename(matches[0], stripHostChatHeader(messages));
}

function reportLifecycleError(label, error) {
    console.error(`[NPC State] v0.2.19 ${label} failed`, error);
    try { globalThis.toastr?.error?.(`NPC State ${label} failed safely. Existing state was preserved or recovery-staged.`, 'NPC State'); } catch { /* noop */ }
}

function queueActiveCharacterCacheRefresh(newAvatar) {
    const expectedOwner = String(newAvatar || '').trim();
    if (!expectedOwner) return;
    const delays = [0, 60, 180, 400, 800];
    let completed = false;
    for (const delay of delays) {
        globalThis.setTimeout?.(() => {
            if (completed) return;
            void (async () => {
                const ctx = getContext() || {};
                if (ctx.groupId) { completed = true; return; }
                if (getCharacterOwnerId(ctx) !== expectedOwner) return;
                const event = (ctx.eventTypes || ctx.event_types || {}).CHAT_CHANGED;
                const source = ctx.eventSource;
                if (!event || typeof source?.emit !== 'function') return;
                completed = true;
                await source.emit(event, ctx.chatId || ctx.getCurrentChatId?.() || '');
            })().catch(error => reportLifecycleError('post-rename cache hydration', error));
        }, delay);
    }
}

export async function prepareNpcStateHardening() {
    if (installed) return;
    const ctx = getContext() || {};
    const source = ctx.eventSource;
    const events = ctx.eventTypes || ctx.event_types || {};
    if (!source || typeof source.on !== 'function') return;
    installed = true;
    const on = source.on.bind(source);

    if (events.CHAT_CHANGED) on(events.CHAT_CHANGED, async () => {
        try {
            installBranchProvenanceHint();
            await safeLegacyMigrationForCurrent();
        } catch (error) { reportLifecycleError('legacy ownership migration', error); }
    });
    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, async (oldAvatar, newAvatar) => {
        try {
            resetHistoricalRenameIndex();
            await migrateCharacterOwner(oldAvatar, newAvatar);
            queueActiveCharacterCacheRefresh(newAvatar);
        } catch (error) { reportLifecycleError('character owner rename migration', error); }
    });
    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, async (messages, oldAvatar, newAvatar) => {
        try {
            if (await rebaseActiveStateAfterHostRename(messages)) return;
            await rebaseHistoricalState(messages, String(oldAvatar || '').trim(), String(newAvatar || '').trim());
        } catch (error) { reportLifecycleError('historical rename lineage rebase', error); }
    });
    if (events.CHARACTER_DELETED) on(events.CHARACTER_DELETED, async data => {
        try {
            const avatar = String(data?.character?.avatar || data?.avatar || '').trim();
            if (avatar) await retireCharacterOwner(avatar, 'character-deleted');
        } catch (error) { reportLifecycleError('character deletion retirement', error); }
    });

    installBranchProvenanceHint();
    try { await safeLegacyMigrationForCurrent(); }
    catch (error) { reportLifecycleError('startup legacy ownership migration', error); }
    try { await cleanupRecoveryGarbage(settings()); }
    catch (error) { console.debug('[NPC State] startup recovery garbage cleanup deferred.', error); }
}
