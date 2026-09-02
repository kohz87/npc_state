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

function settings() {
    const value = extension_settings[EXTENSION_NAME] && typeof extension_settings[EXTENSION_NAME] === 'object'
        ? extension_settings[EXTENSION_NAME]
        : (extension_settings[EXTENSION_NAME] = {});
    for (const key of ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex', 'legacyOwnershipClaims', 'recoveryHistory']) {
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

async function retireAfterOwnershipSwitch(key, pointer, reason) {
    if (!pointer?.path) return false;
    try {
        await retireNpcStateDataFile({
            chatKey: key,
            pointer,
            reason,
            appVersion: NPC_STATE_VERSION,
            headers: headers(),
        });
        return true;
    } catch (error) {
        console.warn(`[NPC State] predecessor cleanup deferred for ${key}; durable ownership metadata already prevents resurrection.`, error);
        return false;
    }
}

function headers() {
    try { return getRequestHeaders?.() || {}; }
    catch { return {}; }
}

function archiveRecoveryRecord(config, key, reason = 'superseded') {
    const existing = config.recoveryFiles?.[key];
    if (!existing) return;
    const stamp = Date.now();
    config.recoveryHistory[`${key}@${stamp}`] = { ...structuredClone(existing), archivedAt: stamp, archiveReason: reason };
    delete config.recoveryFiles[key];
    const entries = Object.entries(config.recoveryHistory).sort((a, b) => Number(b[1]?.archivedAt || 0) - Number(a[1]?.archivedAt || 0));
    for (const [oldKey] of entries.slice(RECOVERY_HISTORY_LIMIT)) delete config.recoveryHistory[oldKey];
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
        console.warn(`[NPC State] v0.2.19 preserved legacy namespace ${oldKey}; another canonical owner already claimed it.`);
        return false;
    }

    const rawState = await stateFromPointer(oldKey, oldPointer, oldInline);
    if (!rawState) return false;
    if (!strongLegacyMigrationMatches(rawState, ctx.chat || [], { lineageV2Fn: legacyV2Lineage, lineageV0210Fn: legacyChatLineageV0210 })) {
        console.warn(`[NPC State] v0.2.19 preserved ambiguous legacy namespace ${oldKey}; at least six matching messages and two user turns are required for destructive ownership migration.`);
        return false;
    }

    const migrated = migrateLegacyBranchState(rawState, ctx.chat || []);
    const newPointer = await writeVerifiedState(identity.key, migrated);
    const recoveryPointer = await writeRecovery(oldKey, migrated, `qualified-namespace-migrated:${identity.key}`);

    archiveRecoveryRecord(config, identity.key, 'canonical-ownership-reestablished');
    config.recoveryFiles[oldKey] = recoveryPointer;
    config.sidecarTombstones[oldKey] = { reason: `qualified-namespace-migrated:${identity.key}`, at: Date.now() };
    config.legacyOwnershipClaims[oldKey] = { canonicalKey: identity.key, ownerId: identity.ownerId, kind: identity.kind, at: Date.now(), proofVersion: 2 };
    config.dataFiles[identity.key] = newPointer;
    delete config.sidecarTombstones[identity.key];
    delete config.dataFiles[oldKey];
    delete config.branchIndex[oldKey];
    if (config.chats?.[oldKey]) delete config.chats[oldKey];
    if (config.chats && Object.keys(config.chats).length === 0) delete config.chats;
    await saveSettingsNow();
    await retireAfterOwnershipSwitch(oldKey, oldPointer, `qualified-namespace-migrated:${identity.key}`);
    return true;
}

async function migrateSingleChatKey(oldKey, newKey, reason = 'chat-renamed') {
    if (!oldKey || !newKey || oldKey === newKey) return false;
    const config = settings();
    const oldPointer = config.dataFiles?.[oldKey] || null;
    const oldInline = config.chats?.[oldKey] || null;
    const hasSource = Boolean(oldPointer?.path || oldInline || config.branchIndex?.[oldKey] || config.sidecarTombstones?.[oldKey]);
    if (!hasSource) return false;
    if (config.dataFiles?.[newKey]) throw new Error(`NPC State rename refused because ${newKey} already owns a live sidecar.`);

    const state = await stateFromPointer(oldKey, oldPointer, oldInline);
    let newPointer = null;
    let recoveryPointer = null;
    if (state) {
        newPointer = await writeVerifiedState(newKey, state);
        recoveryPointer = await writeRecovery(oldKey, state, `${reason}:${newKey}`);
    }

    archiveRecoveryRecord(config, newKey, 'canonical-ownership-reestablished');
    applyCanonicalOwnershipMove(config, { oldKey, newKey, newPointer, recoveryPointer, reason });
    if (config.chats?.[oldKey]) {
        config.chats[newKey] = config.chats[oldKey];
        delete config.chats[oldKey];
    }
    await saveSettingsNow();
    if (state) await retireAfterOwnershipSwitch(oldKey, oldPointer, `${reason}:${newKey}`);
    return true;
}

async function migrateCharacterOwner(oldAvatar, newAvatar) {
    const oldOwner = String(oldAvatar || '').trim();
    const newOwner = String(newAvatar || '').trim();
    if (!oldOwner || !newOwner || oldOwner === newOwner) return false;
    const config = settings();

    try {
        const currentIdentity = getChatIdentityFromContext(getContext() || {});
        if (currentIdentity.ownerId === oldOwner) await globalThis.NPCState?.flush?.();
    } catch (error) {
        console.debug('[NPC State] pre-rename flush skipped', error);
    }

    const sourceKeys = qualifiedKeysForOwner(config, 'chat', oldOwner);
    if (!sourceKeys.length) return false;
    const plans = [];
    for (const oldKey of sourceKeys) {
        const newKey = destinationKeyForOwnerRename(oldKey, newOwner);
        if (!newKey || newKey === oldKey) continue;
        if (config.dataFiles?.[newKey]) throw new Error(`Character rename cannot migrate ${oldKey}: destination ${newKey} already has live state.`);
        const oldPointer = config.dataFiles?.[oldKey] || null;
        const oldInline = config.chats?.[oldKey] || null;
        const state = await stateFromPointer(oldKey, oldPointer, oldInline);
        plans.push({ oldKey, newKey, oldPointer, oldInline, state, newPointer: null, recoveryPointer: null });
    }

    // Phase 1: stage and verify every destination plus recovery copy before retiring anything.
    for (const plan of plans) {
        if (!plan.state) continue;
        plan.newPointer = await writeVerifiedState(plan.newKey, plan.state);
        plan.recoveryPointer = await writeRecovery(plan.oldKey, plan.state, `character-renamed:${plan.newKey}`);
    }
    // Phase 2: switch all ownership metadata and durably save it before predecessor cleanup.
    // If SillyTavern exits before this save completes, every predecessor sidecar is still live.
    for (const plan of plans) {
        archiveRecoveryRecord(config, plan.newKey, 'canonical-ownership-reestablished');
        applyCanonicalOwnershipMove(config, {
            oldKey: plan.oldKey,
            newKey: plan.newKey,
            newPointer: plan.newPointer,
            recoveryPointer: plan.recoveryPointer,
            reason: 'character-renamed',
        });
        if (config.chats?.[plan.oldKey]) {
            config.chats[plan.newKey] = config.chats[plan.oldKey];
            delete config.chats[plan.oldKey];
        }
    }
    for (const claim of Object.values(config.legacyOwnershipClaims || {})) {
        const parsed = parseQualifiedChatKey(claim?.canonicalKey);
        if (parsed?.kind === 'chat' && parsed.ownerId === oldOwner) claim.canonicalKey = buildQualifiedChatKey('chat', newOwner, parsed.chatId);
    }
    await saveSettingsNow();
    // Phase 3: physical retirement is cleanup only. A stale/live predecessor cannot be
    // resurrected because the durable settings transaction already tombstoned/moved it.
    for (const plan of plans) {
        if (plan.state) await retireAfterOwnershipSwitch(plan.oldKey, plan.oldPointer, `character-renamed:${plan.newKey}`);
    }
    return plans.length > 0;
}

async function retireCanonicalKey(key, reason = 'deleted') {
    if (!key) return false;
    const config = settings();
    const pointer = config.dataFiles?.[key] || null;
    const inline = config.chats?.[key] || null;
    const state = await stateFromPointer(key, pointer, inline);
    // stateFromPointer can surface the newest queued dirty snapshot. Recovery uses a
    // separate durability operation key, so the main dirty writer can remain alive until
    // ownership metadata is durably tombstoned.
    let recoveryPointer = null;
    if (state) recoveryPointer = await writeRecovery(key, state, reason);
    if (recoveryPointer) config.recoveryFiles[key] = recoveryPointer;
    config.sidecarTombstones[key] = { reason, at: Date.now() };
    delete config.dataFiles[key];
    delete config.branchIndex[key];
    if (config.chats?.[key]) delete config.chats[key];
    await saveSettingsNow();
    await retireAfterOwnershipSwitch(key, pointer, reason);
    return Boolean(pointer?.path || inline || state);
}

async function retireCharacterOwner(avatar, reason = 'character-deleted') {
    const owner = String(avatar || '').trim();
    if (!owner) return false;
    const config = settings();
    const keys = qualifiedKeysForOwner(config, 'chat', owner);
    if (!keys.length) return false;
    const plans = [];
    for (const key of keys) {
        const pointer = config.dataFiles?.[key] || null;
        const inline = config.chats?.[key] || null;
        const state = await stateFromPointer(key, pointer, inline);
        const recoveryPointer = state ? await writeRecovery(key, state, reason) : null;
        plans.push({ key, pointer, recoveryPointer });
    }
    for (const plan of plans) {
        if (plan.recoveryPointer) config.recoveryFiles[plan.key] = plan.recoveryPointer;
        config.sidecarTombstones[plan.key] = { reason, at: Date.now() };
        delete config.dataFiles[plan.key];
        delete config.branchIndex[plan.key];
        if (config.chats?.[plan.key]) delete config.chats[plan.key];
    }
    await saveSettingsNow();
    for (const plan of plans) await retireAfterOwnershipSwitch(plan.key, plan.pointer, reason);
    return true;
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

async function rebaseHistoricalGroupState(messages, newAvatar = '') {
    const context = getContext() || {};
    const config = settings();
    const integrity = hostChatIntegrity(messages);
    const renamed = stripHostChatHeader(messages);
    if (!renamed.length) return false;
    const likelyGroups = (Array.isArray(context.groups) ? context.groups : []).filter(group => {
        const members = Array.isArray(group?.members) ? group.members : [];
        return !newAvatar || members.includes(newAvatar);
    });
    const candidateKeys = [];
    for (const group of likelyGroups) {
        const groupId = String(group?.id || '').trim();
        if (!groupId) continue;
        for (const chatId of Array.isArray(group?.chats) ? group.chats : []) {
            const key = buildQualifiedChatKey('group', groupId, chatId);
            if (config.dataFiles?.[key]?.path) candidateKeys.push(key);
        }
    }
    const matches = [];
    for (const key of [...new Set(candidateKeys)]) {
        const parsed = parseQualifiedChatKey(key);
        if (!parsed) continue;
        const persisted = await loadPersistedGroupChat(parsed.chatId);
        if (!persisted.length) continue;
        if (integrity) {
            if (hostChatIntegrity(persisted) === integrity) matches.push(key);
        } else if (sameNarrativeContent(persisted, renamed)) {
            matches.push(key);
        }
    }
    if (matches.length !== 1) return false;
    return rebaseCanonicalStateForHostRename(matches[0], renamed);
}

function installLegacyLifecycleRegistrationGuard(source, events) {
    if (!source || source.__npcStateV0219LifecycleGuard) return source?.__npcStateV0219OriginalOn || source?.on?.bind(source);
    const originalOn = source.on.bind(source);
    const guarded = function (event, listener) {
        const code = (() => { try { return Function.prototype.toString.call(listener); } catch { return ''; } })();
        const legacyDelete = (event === events.CHAT_DELETED || event === events.GROUP_CHAT_DELETED) && code.includes('removeDeletedChatState');
        const legacyRename = event === events.CHAT_RENAMED && code.includes('moveRenamedChatState');
        if (legacyDelete || legacyRename) {
            console.debug(`[NPC State] v0.2.19 replaced legacy lifecycle handler for ${event}.`);
            return;
        }
        return originalOn(event, listener);
    };
    source.on = guarded;
    source.__npcStateV0219LifecycleGuard = true;
    source.__npcStateV0219OriginalOn = originalOn;
    return originalOn;
}

function reportLifecycleError(label, error) {
    console.error(`[NPC State] v0.2.19 ${label} failed`, error);
    try { globalThis.toastr?.error?.(`NPC State ${label} failed safely. Existing state was preserved or recovery-staged.`, 'NPC State'); } catch { /* noop */ }
}

function queueActiveCharacterCacheRefresh(newAvatar) {
    const expectedOwner = String(newAvatar || '').trim();
    if (!expectedOwner) return;
    globalThis.setTimeout?.(() => {
        void (async () => {
            const ctx = getContext() || {};
            if (ctx.groupId) return;
            if (getCharacterOwnerId(ctx) !== expectedOwner) return;
            const event = (ctx.eventTypes || ctx.event_types || {}).CHAT_CHANGED;
            const source = ctx.eventSource;
            if (!event || typeof source?.emit !== 'function') return;
            // The retained v0.2.18 engine owns its private cache. A post-rename CHAT_CHANGED
            // lets that engine hydrate the newly qualified key from the already migrated sidecar
            // instead of leaving the active tab pinned to the predecessor cache entry.
            await source.emit(event, ctx.chatId || ctx.getCurrentChatId?.() || '');
        })().catch(error => reportLifecycleError('post-rename cache hydration', error));
    }, 0);
}

export async function prepareNpcStateHardening() {
    if (installed) return;
    const ctx = getContext() || {};
    const source = ctx.eventSource;
    const events = ctx.eventTypes || {};
    if (!source || typeof source.on !== 'function') return;
    installed = true;
    const on = installLegacyLifecycleRegistrationGuard(source, events) || source.on.bind(source);

    // Register before the v0.2.18 engine so safe namespace/provenance work completes first.
    if (events.CHAT_CHANGED) on(events.CHAT_CHANGED, async () => {
        try {
            installBranchProvenanceHint();
            await safeLegacyMigrationForCurrent();
        } catch (error) { reportLifecycleError('legacy ownership migration', error); }
    });
    if (events.CHAT_RENAMED) on(events.CHAT_RENAMED, async eventData => {
        try {
            const data = eventData || {};
            const kind = data.groupId ? 'group' : 'chat';
            let ownerId = String(data.groupId || data.avatarId || '').trim();
            const oldId = String(data.oldFileName || '').replace(/\.jsonl$/i, '').trim();
            const newId = String(data.newFileName || '').replace(/\.jsonl$/i, '').trim();
            if (!oldId || !newId) return;
            const config = settings();
            let oldKey = ownerId ? buildQualifiedChatKey(kind, ownerId, oldId) : '';
            if (!oldKey || !allSettingsKeys(config).includes(oldKey)) oldKey = uniqueQualifiedKeyForChat(config, kind, oldId, ownerId);
            if (!oldKey) return;
            ownerId ||= parseQualifiedChatKey(oldKey)?.ownerId || '';
            const newKey = buildQualifiedChatKey(kind, ownerId, newId);
            await migrateSingleChatKey(oldKey, newKey, 'chat-renamed');
        } catch (error) { reportLifecycleError('chat rename migration', error); }
    });
    if (events.CHAT_DELETED) on(events.CHAT_DELETED, async chatId => {
        try {
            const config = settings();
            const key = uniqueQualifiedKeyForChat(config, 'chat', chatId, getCharacterOwnerId(getContext() || {}));
            if (!key) {
                console.warn(`[NPC State] v0.2.19 did not retire ambiguous deleted chat ${String(chatId || '')}; ownership could not be proven.`);
                return;
            }
            await retireCanonicalKey(key, 'chat-deleted');
        } catch (error) { reportLifecycleError('chat deletion retirement', error); }
    });
    if (events.GROUP_CHAT_DELETED) on(events.GROUP_CHAT_DELETED, async chatId => {
        try {
            const context = getContext() || {};
            const config = settings();
            const ownerId = resolveGroupOwnerId(context.groups || [], chatId);
            const key = ownerId
                ? buildQualifiedChatKey('group', ownerId, chatId)
                : uniqueQualifiedKeyForChat(config, 'group', chatId);
            if (!key) {
                console.warn(`[NPC State] v0.2.19 did not retire ambiguous group chat ${String(chatId || '')}; group ownership could not be proven from host data.`);
                return;
            }
            await retireCanonicalKey(key, 'group-chat-deleted');
        } catch (error) { reportLifecycleError('group chat deletion retirement', error); }
    });
    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, async (oldAvatar, newAvatar) => {
        try {
            await migrateCharacterOwner(oldAvatar, newAvatar);
            queueActiveCharacterCacheRefresh(newAvatar);
        }
        catch (error) { reportLifecycleError('character owner rename migration', error); }
    });
    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, async (messages, _oldAvatar, newAvatar) => {
        try {
            if (await rebaseActiveStateAfterHostRename(messages)) return;
            await rebaseHistoricalGroupState(messages, String(newAvatar || '').trim());
        }
        catch (error) { reportLifecycleError('historical rename lineage rebase', error); }
    });
    if (events.CHARACTER_DELETED) on(events.CHARACTER_DELETED, async data => {
        try {
            const avatar = String(data?.character?.avatar || data?.avatar || '').trim();
            if (avatar) await retireCharacterOwner(avatar, 'character-deleted');
        } catch (error) { reportLifecycleError('character deletion retirement', error); }
    });

    // Initial load happens before the legacy engine so a proven old namespace is canonicalized
    // before v0.2.18 hydrates its in-memory cache.
    installBranchProvenanceHint();
    try { await safeLegacyMigrationForCurrent(); }
    catch (error) { reportLifecycleError('startup legacy ownership migration', error); }
}
