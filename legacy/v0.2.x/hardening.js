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
const LIFECYCLE_EVENT_WAIT_MS = 12_000;
const LIFECYCLE_RETRY_DELAY_MS = 30_000;
const HISTORICAL_RENAME_CANDIDATE_LIMIT = 1024;
const lifecycleEventOperations = new Map();
const lifecycleRetryTimers = new Map();
let installed = false;
let historicalRenameIndexPromise = null;
let historicalRenamePair = '';
let lifecycleEventSequence = 0;

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
    catch (error) { console.debug('[NPC State] settings save was deferred', error); }
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
        continuousRetry: false,
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
        console.warn(`[NPC State] v0.2.21 preserved legacy namespace ${oldKey}; another canonical owner already claimed it.`);
        return false;
    }

    const rawState = await stateFromPointer(oldKey, oldPointer, oldInline);
    if (!rawState) return false;
    if (!strongLegacyMigrationMatches(rawState, ctx.chat || [], { lineageV2Fn: legacyV2Lineage, lineageV0210Fn: legacyChatLineageV0210 })) {
        console.warn(`[NPC State] v0.2.21 preserved ambiguous legacy namespace ${oldKey}; the entire stored lineage must prove ownership.`);
        return false;
    }

    const migrated = migrateLegacyBranchState(rawState, ctx.chat || []);
    let newPointer = null;
    let recoveryPointer = null;
    try {
        newPointer = await writeVerifiedState(identity.key, migrated);
        recoveryPointer = await writeRecovery(oldKey, migrated, `qualified-namespace-migrated:${identity.key}`);
        if (oldPointer?.path) await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `qualified-namespace-migrated:${identity.key}`, appVersion: NPC_STATE_VERSION, headers: headers() });
    } catch (error) {
        if (newPointer?.path) {
            try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); }
            catch { config.recoveryGarbage[`legacy-destination:${oldKey}:${Date.now()}`] = { ...newPointer, queuedAt: Date.now(), reason: 'legacy-destination-cleanup' }; }
        }
        if (recoveryPointer?.path) {
            try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); }
            catch { config.recoveryGarbage[`legacy-recovery:${oldKey}:${Date.now()}`] = { ...recoveryPointer, queuedAt: Date.now(), reason: 'legacy-recovery-cleanup' }; }
        }
        queueSettingsSave();
        throw error;
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
    if (oldPointer?.path) {
        try { await deleteNpcStateDataFile(oldPointer, { headers: headers() }); }
        catch (error) { console.warn(`[NPC State] retired legacy predecessor ${oldKey} could not be physically deleted.`, error); }
    }
    await cleanupRecoveryGarbage(config);
    return true;
}

async function migrateCharacterOwner(oldAvatar, newAvatar) {
    const oldOwner = String(oldAvatar || '').trim();
    const newOwner = String(newAvatar || '').trim();
    if (!oldOwner || !newOwner || oldOwner === newOwner) return false;
    const config = settings();
    const moved = new Map();
    const retiredPredecessors = [];
    let changed = false;
    let cachesSettled = false;
    const failedKeys = [];
    try {
        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', oldOwner);
        cachesSettled = true;

        const sourceKeys = qualifiedKeysForOwner(config, 'chat', oldOwner);
        if (!sourceKeys.length) return false;

        for (const oldKey of sourceKeys) {
            const newKey = destinationKeyForOwnerRename(oldKey, newOwner);
            if (!newKey || newKey === oldKey) continue;
            const oldPointer = config.dataFiles?.[oldKey] || null;
            const oldInline = config.chats?.[oldKey] || null;

            // Preserve historical retirement knowledge without pretending recovery/branch-index
            // records are live state that can be copied into a new canonical owner.
            if (!oldPointer?.path && !oldInline) {
                if (config.sidecarTombstones?.[oldKey]) {
                    applyCanonicalOwnershipMove(config, { oldKey, newKey, reason: 'character-renamed' });
                    moved.set(oldKey, newKey);
                    changed = true;
                }
                continue;
            }
            if (config.dataFiles?.[newKey]) {
                console.warn(`[NPC State] character rename preserved ${oldKey}; destination ${newKey} already has live state.`);
                continue;
            }

            let state = null;
            let newPointer = null;
            let recoveryPointer = null;
            let sourceRetired = !oldPointer?.path;
            try {
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    state = await stateFromPointer(oldKey, oldPointer, oldInline);
                    if (!state) throw new Error(`NPC State character rename could not read live source ${oldKey}.`);
                    newPointer = await writeVerifiedState(newKey, state, newPointer?.path ? newPointer : null);
                    if (recoveryPointer?.path) {
                        try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); }
                        catch (error) {
                            config.recoveryGarbage[`rename-temp:${oldKey}:${Date.now()}:${attempt}`] = { ...recoveryPointer, queuedAt: Date.now(), reason: 'rename-temp-cleanup' };
                            console.debug('[NPC State] queued failed rename recovery cleanup.', error);
                        }
                    }
                    recoveryPointer = await writeRecovery(oldKey, state, `character-renamed:${newKey}`);
                    if (!oldPointer?.path) { sourceRetired = true; break; }
                    try {
                        await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `character-renamed:${newKey}`, appVersion: NPC_STATE_VERSION, headers: headers() });
                        sourceRetired = true;
                        break;
                    } catch (error) {
                        if (error?.code !== 'NPC_STATE_WRITE_CONFLICT' || attempt >= 3) throw error;
                        console.info(`[NPC State] character rename retirement raced another writer for ${oldKey}; re-reading before retry.`);
                    }
                }
                if (!sourceRetired || !state || !newPointer) throw new Error(`NPC State character rename could not retire ${oldKey} safely.`);

                archiveRecoveryRecord(config, newKey, 'canonical-ownership-reestablished');
                applyCanonicalOwnershipMove(config, { oldKey, newKey, newPointer, recoveryPointer, reason: 'character-renamed' });
                if (config.chats?.[oldKey]) {
                    config.chats[newKey] = config.chats[oldKey];
                    delete config.chats[oldKey];
                }
                moved.set(oldKey, newKey);
                if (oldPointer?.path) retiredPredecessors.push({ key: oldKey, pointer: oldPointer });
                changed = true;
            } catch (error) {
                if (newPointer?.path) {
                    try { await deleteNpcStateDataFile(newPointer, { headers: headers() }); } catch { /* best effort */ }
                }
                if (recoveryPointer?.path) {
                    try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); }
                    catch {
                        config.recoveryGarbage[`rename-failed:${oldKey}:${Date.now()}`] = { ...recoveryPointer, queuedAt: Date.now(), reason: 'rename-failed-cleanup' };
                    }
                }
                failedKeys.push({ key: oldKey, error });
                console.warn(`[NPC State] character rename preserved ${oldKey} and continued with other chats.`, error);
            }
        }

        for (const claim of Object.values(config.legacyOwnershipClaims || {})) {
            const replacement = moved.get(String(claim?.canonicalKey || ''));
            if (replacement) claim.canonicalKey = replacement;
        }
        if (changed) {
            await saveSettingsNow();
            for (const predecessor of retiredPredecessors) {
                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }
                catch (error) { console.warn(`[NPC State] retired character-rename predecessor ${predecessor.key} could not be physically deleted.`, error); }
            }
            await cleanupRecoveryGarbage(config);
        }
        if (failedKeys.length) {
            const error = new AggregateError(failedKeys.map(item => item.error), `NPC State character rename left ${failedKeys.length} chat(s) under the old owner for retry.`);
            error.code = 'NPC_STATE_OWNER_RENAME_PARTIAL';
            error.failures = failedKeys.map(item => item.key);
            throw error;
        }
        return changed;
    } finally {
        if (cachesSettled) {
            globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);
            globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', newOwner);
        }
    }
}

async function retireCharacterOwner(avatar, reason = 'character-deleted') {
    const owner = String(avatar || '').trim();
    if (!owner) return false;
    const config = settings();
    let changed = false;
    const retiredPredecessors = [];
    let cachesSettled = false;
    const failedKeys = [];
    try {
        await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner);
        cachesSettled = true;
        const keys = qualifiedKeysForOwner(config, 'chat', owner).filter(key => config.dataFiles?.[key]?.path || config.chats?.[key]);
        if (!keys.length) return false;

        for (const key of keys) {
            const pointer = config.dataFiles?.[key] || null;
            const inline = config.chats?.[key] || null;
            let recoveryPointer = null;
            try {
                const state = await stateFromPointer(key, pointer, inline);
                recoveryPointer = state ? await writeRecovery(key, state, reason) : null;
                if (pointer?.path) await retireNpcStateDataFile({ chatKey: key, pointer, reason, appVersion: NPC_STATE_VERSION, headers: headers() });

                archiveRecoveryRecord(config, key, 'character-deleted-replaced');
                if (recoveryPointer) config.recoveryFiles[key] = recoveryPointer;
                config.sidecarTombstones[key] = { reason, at: Date.now() };
                delete config.dataFiles[key];
                delete config.branchIndex[key];
                if (config.chats?.[key]) delete config.chats[key];
                if (pointer?.path) retiredPredecessors.push({ key, pointer });
                changed = true;
            } catch (error) {
                if (recoveryPointer?.path) {
                    try { await deleteNpcStateDataFile(recoveryPointer, { headers: headers() }); }
                    catch {
                        config.recoveryGarbage[`delete-failed:${key}:${Date.now()}`] = { ...recoveryPointer, queuedAt: Date.now(), reason: 'delete-failed-cleanup' };
                    }
                }
                failedKeys.push({ key, error });
                console.warn(`[NPC State] character deletion preserved ${key} and continued with other chats.`, error);
            }
        }
        if (changed) {
            await saveSettingsNow();
            for (const predecessor of retiredPredecessors) {
                try { await deleteNpcStateDataFile(predecessor.pointer, { headers: headers() }); }
                catch (error) { console.warn(`[NPC State] retired character-delete predecessor ${predecessor.key} could not be physically deleted.`, error); }
            }
            await cleanupRecoveryGarbage(config);
        }
        if (failedKeys.length) {
            const error = new AggregateError(failedKeys.map(item => item.error), `NPC State character deletion left ${failedKeys.length} live chat(s) for retry.`);
            error.code = 'NPC_STATE_OWNER_DELETE_PARTIAL';
            error.failures = failedKeys.map(item => item.key);
            throw error;
        }
        return changed;
    } finally {
        if (cachesSettled) globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);
    }
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
    if (!response?.ok) throw new Error(`NPC State could not read historical group chat ${chatId}.`);
    const data = typeof response.json === 'function' ? await response.json() : null;
    if (!Array.isArray(data)) throw new Error(`NPC State historical group chat ${chatId} returned invalid data.`);
    return data;
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
    if (!response?.ok) throw new Error(`NPC State could not read historical character chat ${chatId}.`);
    const data = typeof response.json === 'function' ? await response.json() : null;
    if (!Array.isArray(data)) throw new Error(`NPC State historical character chat ${chatId} returned invalid data.`);
    return data;
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
        const allCandidates = Object.keys(config.dataFiles || {}).filter(key => {
            const parsed = parseQualifiedChatKey(key);
            if (!parsed) return false;
            if (parsed.kind === 'chat') return parsed.ownerId === newOwner;
            return parsed.kind === 'group' && relevantGroups.has(parsed.ownerId);
        }).sort((a, b) => Number(config.dataFiles?.[b]?.updatedAt || 0) - Number(config.dataFiles?.[a]?.updatedAt || 0));
        const index = new Map();
        for (let offset = 0; offset < allCandidates.length; offset += HISTORICAL_RENAME_CANDIDATE_LIMIT) {
            const candidateKeys = allCandidates.slice(offset, offset + HISTORICAL_RENAME_CANDIDATE_LIMIT);
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
            await Promise.resolve();
        }
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
    console.error(`[NPC State] v0.2.21 ${label} failed`, error);
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

function scheduleHardeningRetry(operationKey, label, task) {
    if (lifecycleRetryTimers.has(operationKey)) return;
    const timer = globalThis.setTimeout?.(() => {
        lifecycleRetryTimers.delete(operationKey);
        void runBoundedHardeningEvent(operationKey, label, task);
    }, LIFECYCLE_RETRY_DELAY_MS);
    if (timer) lifecycleRetryTimers.set(operationKey, timer);
}

async function runBoundedHardeningEvent(operationKey, label, task, { retryOnFailure = true } = {}) {
    const key = String(operationKey || label || 'hardening');
    let operation = lifecycleEventOperations.get(key);
    if (!operation) {
        operation = Promise.resolve().then(task);
        lifecycleEventOperations.set(key, operation);
        void operation.catch(error => {
            console.warn(`[NPC State] ${label} background transaction failed; scheduling retry.`, error);
            if (retryOnFailure) scheduleHardeningRetry(key, label, task);
        });
        operation.then(
            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),
            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),
        );
    }
    let timer = null;
    const timeout = new Promise(resolve => {
        timer = globalThis.setTimeout?.(() => resolve({ timedOut: true }), LIFECYCLE_EVENT_WAIT_MS);
    });
    const observed = operation.then(
        value => ({ timedOut: false, value }),
        error => ({ timedOut: false, error }),
    );
    const outcome = await Promise.race([observed, timeout]);
    if (timer) globalThis.clearTimeout?.(timer);
    if (outcome.timedOut) {
        console.warn(`[NPC State] ${label} exceeded ${LIFECYCLE_EVENT_WAIT_MS / 1000}s; SillyTavern may continue while the fail-closed transaction remains in the background.`);
        return false;
    }
    if (outcome.error) {
        reportLifecycleError(label, outcome.error);
        if (retryOnFailure) scheduleHardeningRetry(key, label, task);
        return false;
    }
    return true;
}

export async function prepareNpcStateHardening() {
    if (installed) return;
    const ctx = getContext() || {};
    const source = ctx.eventSource;
    const events = ctx.eventTypes || ctx.event_types || {};
    if (!source || typeof source.on !== 'function') return;
    installed = true;
    const on = source.on.bind(source);

    if (events.CHAT_CHANGED) on(events.CHAT_CHANGED, () => {
        const identity = getChatIdentityFromContext(getContext() || {});
        return runBoundedHardeningEvent(`legacy:${identity.key}`, 'legacy ownership migration', async () => {
            installBranchProvenanceHint();
            await safeLegacyMigrationForCurrent();
        });
    });
    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        const eventId = ++lifecycleEventSequence;
        return runBoundedHardeningEvent(
            `character-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${eventId}`,
            'character owner rename migration',
            async () => {
                resetHistoricalRenameIndex();
                try { await migrateCharacterOwner(oldAvatar, newAvatar); }
                finally { queueActiveCharacterCacheRefresh(newAvatar); }
            },
        );
    });
    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, (messages, oldAvatar, newAvatar) => {
        const signature = historicalChatSignature(messages) || `len:${Array.isArray(messages) ? messages.length : 0}`;
        const eventId = ++lifecycleEventSequence;
        return runBoundedHardeningEvent(
            `historical-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${signature}:${eventId}`,
            'historical rename lineage rebase',
            async () => {
                if (await rebaseActiveStateAfterHostRename(messages)) return;
                await rebaseHistoricalState(messages, String(oldAvatar || '').trim(), String(newAvatar || '').trim());
            },
        );
    });
    if (events.CHARACTER_DELETED) on(events.CHARACTER_DELETED, data => {
        const avatar = String(data?.character?.avatar || data?.avatar || '').trim();
        if (!avatar) return undefined;
        const eventId = ++lifecycleEventSequence;
        return runBoundedHardeningEvent(
            `character-delete:${avatar}:${eventId}` ,
            'character deletion retirement',
            () => retireCharacterOwner(avatar, 'character-deleted'),
        );
    });

    installBranchProvenanceHint();
    // The retained engine performs active legacy migration during its own initialization. Avoid
    // holding bootstrap hostage to a remote sidecar outage before index.js has even mounted.
    void cleanupRecoveryGarbage(settings()).catch(error => console.debug('[NPC State] startup recovery garbage cleanup deferred.', error));
}
