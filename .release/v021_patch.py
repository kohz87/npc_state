from pathlib import Path
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_between(path, start, end, new_block):
    text = read(path)
    a = text.find(start)
    b = text.find(end, a + len(start)) if a >= 0 else -1
    if a < 0 or b < 0:
        raise SystemExit(f'{path}: could not find replacement range {start!r} -> {end!r}')
    write(path, text[:a] + new_block.rstrip() + '\n\n' + text[b:])


def append_once(path, marker, block):
    text = read(path)
    if marker in text:
        return
    write(path, text.rstrip() + '\n\n' + block.rstrip() + '\n')


# ---------------------------------------------------------------------------
# hardening-core.js: pure lifecycle ownership helpers used by runtime + tests.
# ---------------------------------------------------------------------------
append_once('hardening-core.js', 'export function liveLifecycleCandidateKeys(', r'''
export function liveLifecycleCandidateKeys(settings = {}, cacheKeys = [], kind = 'chat', chatId = '') {
    const id = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return [];
    const keys = new Set([
        ...Object.keys(settings?.dataFiles || {}),
        ...Object.keys(settings?.chats || {}),
        ...(cacheKeys ? [...cacheKeys] : []),
    ]);
    return [...keys].filter(key => {
        if (settings?.sidecarTombstones?.[key]) return false;
        const parsed = parseQualifiedChatKey(key);
        return parsed?.kind === kind && parsed.chatId === id;
    });
}

export function resolveOwnedLifecycleKey(candidates = [], kind = 'chat', chatId = '', ownerId = '', ownerWasProvided = false) {
    const id = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    const owner = String(ownerId || '').trim();
    if (!id) return '';
    const unique = [...new Set(Array.isArray(candidates) ? candidates : [])];
    const direct = buildQualifiedChatKey(kind, owner, id);
    if (ownerWasProvided) return direct && unique.includes(direct) ? direct : '';
    if (direct && unique.includes(direct)) return direct;
    return unique.length === 1 ? unique[0] : '';
}

export function resolveDeletedLifecycleKeyFromPresence(candidates = [], presence = []) {
    const unique = [...new Set(Array.isArray(candidates) ? candidates : [])];
    if (!unique.length) return '';
    const byKey = new Map((Array.isArray(presence) ? presence : []).map(item => [String(item?.key || ''), item?.value]));
    if (unique.some(key => !byKey.has(key) || ![true, false].includes(byKey.get(key)))) return '';
    const absent = unique.filter(key => byKey.get(key) === false);
    const present = unique.filter(key => byKey.get(key) === true);
    return absent.length === 1 && present.length === unique.length - 1 ? absent[0] : '';
}

export function lifecycleRenameStateIsEmpty(state) {
    if (!state || typeof state !== 'object') return true;
    const graph = state.socialGraph && typeof state.socialGraph === 'object' ? state.socialGraph : {};
    const root = state.branchRootSnapshot && typeof state.branchRootSnapshot === 'object'
        ? Object.keys(state.branchRootSnapshot).length > 0
        : false;
    const portraits = state.portraitAssets && typeof state.portraitAssets === 'object'
        ? Object.keys(state.portraitAssets).length > 0
        : false;
    return !(state.npcs?.length
        || state.candidates?.length
        || state.dismissed?.length
        || state.checkpoints?.length
        || state.inlineCards?.length
        || state.userDismissedGroups?.length
        || state.pendingBackfills?.length
        || graph.edges?.length
        || graph.unresolved?.length
        || root
        || portraits);
}
''')

# ---------------------------------------------------------------------------
# index.js: owner-safe resolution, host proof even for one candidate, bounded
# event waits, stronger rename destination checks, and recoverable inline state.
# ---------------------------------------------------------------------------
replace_once('index.js', "} from './identity.js';\n\nconst EXTENSION_NAME", "} from './identity.js';\nimport {\n    lifecycleRenameStateIsEmpty,\n    liveLifecycleCandidateKeys,\n    resolveDeletedLifecycleKeyFromPresence,\n    resolveOwnedLifecycleKey,\n} from './hardening-core.js';\n\nconst EXTENSION_NAME")
replace_once('index.js', 'const SCAN_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;\n', "const SCAN_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;\nconst LIFECYCLE_EVENT_WAIT_MS = 12_000;\nconst LIFECYCLE_RETRY_DELAY_MS = 30_000;\nconst lifecycleEventOperations = new Map();\nconst lifecycleRetryTimers = new Map();\n")
replace_once('index.js', '    schemaVersion: 26,\n', '    schemaVersion: 27,\n')
replace_once('index.js', '    legacyOwnershipClaims: {},\n});', '    legacyOwnershipClaims: {},\n    recoveryHistory: {},\n    recoveryGarbage: {},\n});')
replace_once('index.js', "    if (!settings.legacyOwnershipClaims || typeof settings.legacyOwnershipClaims !== 'object') assign('legacyOwnershipClaims', {});\n", "    if (!settings.legacyOwnershipClaims || typeof settings.legacyOwnershipClaims !== 'object') assign('legacyOwnershipClaims', {});\n    if (!settings.recoveryHistory || typeof settings.recoveryHistory !== 'object') assign('recoveryHistory', {});\n    if (!settings.recoveryGarbage || typeof settings.recoveryGarbage !== 'object') assign('recoveryGarbage', {});\n")

replace_between('index.js', 'function resolveOwnedChatKey(', 'function touchChatCache(', r'''function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = undefined) {
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const ownerWasProvided = ownerId !== undefined;
    const resolvedOwner = String(ownerWasProvided ? (ownerId || '') : (kind === 'group' ? getContext().groupId || '' : getCharacterOwnerId(getContext()))).trim();
    const settings = getSettings();
    const candidates = liveLifecycleCandidateKeys(settings, chatStateCache.keys(), kind, id);
    const resolved = resolveOwnedLifecycleKey(candidates, kind, id, resolvedOwner, ownerWasProvided);
    if (!resolved && candidates.length > 1) {
        console.warn(`[NPC State] refused ambiguous ${kind} lifecycle lookup for ${id}; ${candidates.length} live owner-qualified states share that chat id.`);
    }
    return resolved;
}

function lifecycleCandidateKeys(rawId, kind = 'chat') {
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    return liveLifecycleCandidateKeys(getSettings(), chatStateCache.keys(), kind, id);
}

async function hostCharacterChatPresence(ownerId, rawId) {
    const owner = String(ownerId || '').trim();
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!owner || !id) return null;
    try {
        const response = await globalThis.fetch?.('/api/characters/chats', {
            method: 'POST',
            headers: requestHeaders(),
            body: JSON.stringify({ avatar_url: owner, simple: true }),
        });
        if (!response?.ok) return null;
        const data = typeof response.json === 'function' ? await response.json() : null;
        if (!data || typeof data !== 'object') return null;
        const chats = Array.isArray(data) ? data : Object.values(data);
        return chats.some(item => String(item?.file_name ?? item?.fileName ?? item?.name ?? '').replace(/\.jsonl$/i, '').trim() === id);
    } catch (error) {
        console.debug(`[NPC State] host ownership probe failed for ${owner}/${id}.`, error);
        return null;
    }
}

function hostGroupChatPresence(ownerId, rawId) {
    const owner = String(ownerId || '').trim();
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    const groups = getContext()?.groups;
    if (!owner || !id || !Array.isArray(groups)) return null;
    const group = groups.find(item => String(item?.id ?? '').trim() === owner);
    if (!group) return false;
    const chats = [
        ...(Array.isArray(group?.chats) ? group.chats : []),
        group?.chat_id,
    ].map(value => String(value ?? '').replace(/\.jsonl$/i, '').trim()).filter(Boolean);
    return chats.includes(id);
}

async function resolveDeletedChatKey(rawId, kind = 'chat', ownerId = '') {
    const id = String(rawId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const hint = String(ownerId || '').trim();
    if (hint) return resolveOwnedChatKey(id, kind, hint);
    const candidates = lifecycleCandidateKeys(id, kind);
    if (!candidates.length) return '';

    const presence = [];
    for (const key of candidates) {
        const parsed = parseQualifiedChatKey(key);
        if (!parsed) continue;
        const value = kind === 'group'
            ? hostGroupChatPresence(parsed.ownerId, id)
            : await hostCharacterChatPresence(parsed.ownerId, id);
        presence.push({ key, value });
    }
    const resolved = resolveDeletedLifecycleKeyFromPresence(candidates, presence);
    if (resolved) {
        console.info(`[NPC State] resolved deleted ${kind} ${id} from authoritative host ownership: ${resolved}.`);
        return resolved;
    }
    console.warn(`[NPC State] preserved deleted ${kind} ${id}; host ownership did not prove one unique removed owner.`);
    return '';
}
''')

replace_between('index.js', 'function stateLooksEmptyForLifecycleRename(', 'function clearLifecycleCacheKey(', r'''function stateLooksEmptyForLifecycleRename(state) {
    return lifecycleRenameStateIsEmpty(state);
}
''')

replace_between('index.js', 'async function loadLatestLifecycleState(', 'async function removeDeletedChatState(', r'''async function loadLatestLifecycleState(key, pointer = null, inlineState = null, { fallbackOnMissing = false } = {}) {
    if (pointer?.path) {
        try {
            const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
            if (payload && !payload.retired && payload.state) return structuredClone(payload.state);
            if (!fallbackOnMissing) return null;
        } catch (error) {
            if (!fallbackOnMissing) throw error;
            console.warn(`[NPC State] lifecycle recovery could not read ${pointer.path}; falling back to the settled cache/inline state.`, error);
        }
    }
    if (loadedChatKeys.has(key) && chatStateCache.has(key)) return structuredClone(getChatState(key));
    return inlineState && typeof inlineState === 'object' ? structuredClone(inlineState) : null;
}
''')
replace_once('index.js', '            const state = await loadLatestLifecycleState(key, pointer, settings.chats?.[key] || null);\n', '            const state = await loadLatestLifecycleState(key, pointer, settings.chats?.[key] || null, { fallbackOnMissing: true });\n')

# Lifecycle recovery writes must fail closed rather than entering the normal endless dirty-write loop.
replace_once('index.js', "                    operationKey: `delete-recovery:${key}:${Date.now()}:${attempt}`,\n                    headers: requestHeaders(),", "                    operationKey: `delete-recovery:${key}:${Date.now()}:${attempt}`,\n                    continuousRetry: false,\n                    headers: requestHeaders(),")
replace_once('index.js', "                operationKey: `rename-recovery:${oldKey}:${Date.now()}:${attempt}`,\n                headers: requestHeaders(),", "                operationKey: `rename-recovery:${oldKey}:${Date.now()}:${attempt}`,\n                continuousRetry: false,\n                headers: requestHeaders(),")
# Destination write inside rename is also a lifecycle transaction.
replace_once('index.js', "                pointer: newPointer?.path ? newPointer : { name: makeNpcStateDataFileName(newKey) },\n                headers: requestHeaders(),", "                pointer: newPointer?.path ? newPointer : { name: makeNpcStateDataFileName(newKey) },\n                continuousRetry: false,\n                headers: requestHeaders(),")

# Add a bounded event wrapper immediately before event registration.
replace_once('index.js', 'function registerEvents() {\n', r'''function scheduleLifecycleRetry(operationKey, label, task) {
    if (lifecycleRetryTimers.has(operationKey)) return;
    const timer = setTimeout(() => {
        lifecycleRetryTimers.delete(operationKey);
        void runBoundedLifecycleEvent(operationKey, label, task);
    }, LIFECYCLE_RETRY_DELAY_MS);
    lifecycleRetryTimers.set(operationKey, timer);
}

async function runBoundedLifecycleEvent(operationKey, label, task) {
    const key = String(operationKey || label || 'lifecycle');
    let operation = lifecycleEventOperations.get(key);
    if (!operation) {
        operation = Promise.resolve().then(task);
        lifecycleEventOperations.set(key, operation);
        operation.then(
            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),
            () => lifecycleEventOperations.get(key) === operation && lifecycleEventOperations.delete(key),
        );
    }
    let timer = null;
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve({ timedOut: true }), LIFECYCLE_EVENT_WAIT_MS);
    });
    const observed = operation.then(
        value => ({ timedOut: false, value }),
        error => ({ timedOut: false, error }),
    );
    const outcome = await Promise.race([observed, timeout]);
    if (timer) clearTimeout(timer);
    if (outcome.timedOut) {
        console.warn(`[NPC State] ${label} exceeded ${LIFECYCLE_EVENT_WAIT_MS / 1000}s; SillyTavern may continue while the fail-closed transaction retries in the background.`);
        return false;
    }
    if (outcome.error) {
        console.error(`[NPC State] ${label} failed safely; scheduling a background retry.`, outcome.error);
        scheduleLifecycleRetry(key, label, task);
        return false;
    }
    return true;
}

function registerEvents() {
''')
replace_once('index.js', "    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat', ''); });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group', ''); });\n    if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, async (eventData) => { await moveRenamedChatState(eventData || {}); });", r'''    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, (chatId) => runBoundedLifecycleEvent(
        `delete:chat:${String(chatId || '')}`,
        'chat deletion retirement',
        () => removeDeletedChatState(chatId, 'chat', ''),
    ));
    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, (chatId) => runBoundedLifecycleEvent(
        `delete:group:${String(chatId || '')}`,
        'group chat deletion retirement',
        () => removeDeletedChatState(chatId, 'group', ''),
    ));
    if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, (eventData) => {
        const data = eventData || {};
        const owner = String(data.groupId || data.avatarId || '');
        return runBoundedLifecycleEvent(
            `rename:${owner}:${String(data.oldFileName || '')}->${String(data.newFileName || '')}`,
            'chat rename migration',
            () => moveRenamedChatState(data),
        );
    });''')

# ---------------------------------------------------------------------------
# storage.js: cross-tab recovery uniqueness, bounded lifecycle writes, and
# numeric pointer timestamps after hydration.
# ---------------------------------------------------------------------------
replace_once('storage.js', "    return `npc-state-recovery-${fnv1a(key)}${fnv1a(`npc-state-recovery\\0${[...key].reverse().join('')}`)}-${stamp}.json`;", "    const writerToken = fnv1a(String(writerId || 'writer'));\n    return `npc-state-recovery-${fnv1a(key)}${fnv1a(`npc-state-recovery\\0${[...key].reverse().join('')}`)}-${stamp}-${writerToken}.json`;")
replace_once('storage.js', "export async function writeNpcStateDataFile({ chatKey, state, appVersion = '', pointer = null, operationKey = '', fetchFn = globalThis.fetch, headers = {}, sleepFn = globalThis.setTimeout }) {", "export async function writeNpcStateDataFile({ chatKey, state, appVersion = '', pointer = null, operationKey = '', fetchFn = globalThis.fetch, headers = {}, sleepFn = globalThis.setTimeout, continuousRetry = true }) {")
replace_once('storage.js', '    let lastError = null;\n    for (const delay of NPC_STATE_WRITE_RETRY_DELAYS_MS) {', "    let lastError = null;\n    const retryDelays = continuousRetry ? NPC_STATE_WRITE_RETRY_DELAYS_MS : [0, 250, 750, 1500];\n    for (const delay of retryDelays) {")
replace_once('storage.js', "    const job = {\n        chatKey: key,", "    if (!continuousRetry) throw lastError || new Error(`NPC State bounded sidecar write failed for ${key}.`);\n    const job = {\n        chatKey: key,")
replace_once('storage.js', "        pointer.updatedAt = Number(payload.updatedAt || pointer.updatedAt || Date.now());", "        const parsedUpdatedAt = Date.parse(String(payload.updatedAt || ''));\n        pointer.updatedAt = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : (Number(pointer.updatedAt) || Date.now());")

# ---------------------------------------------------------------------------
# hardening.js: bounded host-event waits, per-chat isolation for owner-wide
# lifecycle work, bounded/non-partial historical rename indexing.
# ---------------------------------------------------------------------------
replace_once('hardening.js', "const RECOVERY_HISTORY_LIMIT = 80;\n", "const RECOVERY_HISTORY_LIMIT = 80;\nconst LIFECYCLE_EVENT_WAIT_MS = 12_000;\nconst LIFECYCLE_RETRY_DELAY_MS = 30_000;\nconst HISTORICAL_RENAME_CANDIDATE_LIMIT = 1024;\nconst lifecycleEventOperations = new Map();\nconst lifecycleRetryTimers = new Map();\n")
replace_once('hardening.js', "console.debug('[NPC State] v0.2.19 settings save was deferred'", "console.debug('[NPC State] settings save was deferred'")
replace_once('hardening.js', "        operationKey,\n        headers: headers(),", "        operationKey,\n        continuousRetry: false,\n        headers: headers(),")

# Replace owner-wide rename with per-key failure isolation and final cache invalidation.
replace_between('hardening.js', 'async function migrateCharacterOwner(', 'async function retireCharacterOwner(', r'''async function migrateCharacterOwner(oldAvatar, newAvatar) {
    const oldOwner = String(oldAvatar || '').trim();
    const newOwner = String(newAvatar || '').trim();
    if (!oldOwner || !newOwner || oldOwner === newOwner) return false;
    const config = settings();
    const moved = new Map();
    const retiredPredecessors = [];
    let changed = false;
    try {
        try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', oldOwner); }
        catch (error) { console.debug('[NPC State] owner pre-rename cache flush was incomplete.', error); }

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
        return changed;
    } finally {
        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', oldOwner);
        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', newOwner);
    }
}
''')

replace_between('hardening.js', 'async function retireCharacterOwner(', 'async function rebaseActiveStateAfterHostRename(', r'''async function retireCharacterOwner(avatar, reason = 'character-deleted') {
    const owner = String(avatar || '').trim();
    if (!owner) return false;
    const config = settings();
    let changed = false;
    const retiredPredecessors = [];
    try {
        try { await globalThis.__NPCStateLifecycle?.flushOwner?.('chat', owner); }
        catch (error) { console.debug('[NPC State] owner pre-delete cache flush was incomplete.', error); }
        const keys = qualifiedKeysForOwner(config, 'chat', owner);
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
        return changed;
    } finally {
        globalThis.__NPCStateLifecycle?.invalidateOwner?.('chat', owner);
    }
}
''')

# Historical reads must fail the index build rather than silently caching a partial index.
replace_between('hardening.js', 'async function loadPersistedGroupChat(', 'async function rebaseCanonicalStateForHostRename(', r'''async function loadPersistedGroupChat(chatId) {
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
''')

# Replace character history loader + index builder section.
replace_between('hardening.js', 'async function loadPersistedCharacterChat(', 'async function rebaseHistoricalState(', r'''async function loadPersistedCharacterChat(chatId, avatar = '') {
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
        if (allCandidates.length > HISTORICAL_RENAME_CANDIDATE_LIMIT) {
            console.warn(`[NPC State] historical rename index bounded at ${HISTORICAL_RENAME_CANDIDATE_LIMIT}/${allCandidates.length} most-recent tracked chats.`);
        }
        const candidateKeys = allCandidates.slice(0, HISTORICAL_RENAME_CANDIDATE_LIMIT);
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
''')

# Bounded hardening event bridge. Failed fast transactions retry in background;
# timed-out transactions themselves continue in the background without stalling ST.
replace_once('hardening.js', 'export async function prepareNpcStateHardening() {\n', r'''function scheduleHardeningRetry(operationKey, label, task) {
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
''')

# Replace listener body block through initial setup.
old_listener = r'''    if (events.CHAT_CHANGED) on(events.CHAT_CHANGED, async () => {
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
}'''
new_listener = r'''    if (events.CHAT_CHANGED) on(events.CHAT_CHANGED, () => {
        const identity = getChatIdentityFromContext(getContext() || {});
        return runBoundedHardeningEvent(`legacy:${identity.key}`, 'legacy ownership migration', async () => {
            installBranchProvenanceHint();
            await safeLegacyMigrationForCurrent();
        });
    });
    if (events.CHARACTER_RENAMED) on(events.CHARACTER_RENAMED, (oldAvatar, newAvatar) => runBoundedHardeningEvent(
        `character-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}`,
        'character owner rename migration',
        async () => {
            resetHistoricalRenameIndex();
            await migrateCharacterOwner(oldAvatar, newAvatar);
            queueActiveCharacterCacheRefresh(newAvatar);
        },
    ));
    if (events.CHARACTER_RENAMED_IN_PAST_CHAT) on(events.CHARACTER_RENAMED_IN_PAST_CHAT, (messages, oldAvatar, newAvatar) => {
        const signature = historicalChatSignature(messages) || `len:${Array.isArray(messages) ? messages.length : 0}`;
        return runBoundedHardeningEvent(
            `historical-rename:${String(oldAvatar || '')}->${String(newAvatar || '')}:${signature}`,
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
        return runBoundedHardeningEvent(
            `character-delete:${avatar}`,
            'character deletion retirement',
            () => retireCharacterOwner(avatar, 'character-deleted'),
        );
    });

    installBranchProvenanceHint();
    // The retained engine performs active legacy migration during its own initialization. Avoid
    // holding bootstrap hostage to a remote sidecar outage before index.js has even mounted.
    void cleanupRecoveryGarbage(settings()).catch(error => console.debug('[NPC State] startup recovery garbage cleanup deferred.', error));
}'''
replace_once('hardening.js', old_listener, new_listener)

# Current version labels in hardening diagnostics.
text = read('hardening.js').replace('v0.2.20', 'v0.2.21').replace('v0.2.19', 'v0.2.21')
write('hardening.js', text)

# ---------------------------------------------------------------------------
# Version metadata/docs.
# ---------------------------------------------------------------------------
replace_once('core.js', "NPC_STATE_VERSION = '0.2.20'", "NPC_STATE_VERSION = '0.2.21'")
replace_once('manifest.json', '"version": "0.2.20"', '"version": "0.2.21"')
replace_once('bootstrap.js', 'NPC State v0.2.19', 'NPC State v0.2.21')

readme = read('README.md')
readme = re.sub(r'^# NPC State v[^\n]+', '# NPC State v0.2.21', readme, count=1)
write('README.md', readme)

changelog = read('CHANGELOG.md')
section = '''# Changelog\n\n## 0.2.21\n\n- Makes explicit SillyTavern chat owners authoritative during rename/delete resolution; an untracked same-named chat can no longer move or retire another owner's dossier.\n- Requires host ownership proof even when NPC State sees only one same-filename candidate, and uses the cheap `simple: true` chat listing.\n- Bounds lifecycle event waits so storage outages cannot stall SillyTavern's sequential event emitter; failed transactions remain fail-closed and retry in the background.\n- Makes recovery filenames cross-tab unique, repairs hydrated pointer timestamps numerically, and bounds lifecycle-only sidecar writes.\n- Isolates character-wide rename/delete failures per chat so one corrupt sidecar cannot abort cleanup for every other chat.\n- Treats branch roots, social graph state, inline cards and portraits as meaningful rename destinations instead of ephemeral empty state.\n- Bounds historical rename indexing, refuses to cache partial HTTP failures, tracks failed temporary recovery cleanup, and advances settings schema to 27.\n- Adds executable v0.2.21 lifecycle ownership/storage regression tests.\n\n'''
if changelog.startswith('# Changelog\n'):
    changelog = section + changelog[len('# Changelog\n\n'):]
else:
    changelog = section + changelog
write('CHANGELOG.md', changelog)

for doc in ['CODE-REVIEW.md', 'TEST-REPORT.md']:
    text = read(doc)
    text = re.sub(r'^# NPC State v[^\n]+', f'# NPC State v0.2.21 {"Code Review" if doc == "CODE-REVIEW.md" else "Test Report"}', text, count=1)
    write(doc, text)

# Add a concise current review section above prior history.
code_review = read('CODE-REVIEW.md')
marker = '# NPC State v0.2.21 Code Review\n\n'
review_section = '''## v0.2.21 ownership/lifecycle deep-pass hardening\n\nThe v0.2.20 post-release deep pass found two wrong-owner same-filename paths: ownerless delete trusted a sole internal candidate without host proof, and explicit-owner rename could fall through to another owner when the requested owner had no state. v0.2.21 centralizes live ownership resolution in pure helpers, excludes tombstone/recovery/branch-index history from live evidence, makes explicit owner identity absolute, and requires authoritative host absence proof for every ownerless destructive delete including the one-candidate case.\n\nLifecycle event waits are bounded because SillyTavern awaits listeners sequentially. Transactions that exceed the foreground budget remain fail-closed in the background; fast failures receive a delayed retry. Lifecycle-only sidecar writes use bounded retry rather than joining the ordinary endless dirty-write loop. Character-wide rename/delete isolates each chat transaction and always invalidates owner caches in `finally`.\n\nRecovery filenames include a writer token for cross-tab uniqueness, sidecar ISO timestamps are parsed to numeric milliseconds, meaningful branch/social/portrait/inline destination state is protected during rename, historical rename indexing is bounded and rejects partial HTTP indexes, and failed temporary recovery cleanup is queued for later garbage collection. Settings schema is 27.\n\n'''
if review_section not in code_review:
    code_review = marker + review_section + code_review[len(marker):]
write('CODE-REVIEW.md', code_review)

test_report = read('TEST-REPORT.md')
marker = '# NPC State v0.2.21 Test Report\n\n'
report_section = '''Target: SillyTavern 1.18.0 extension contract.\n\n## v0.2.21 release gate\n\nRelease requires ten consecutive full verification passes on the exact candidate before source commit/promotion. New executable tests cover explicit-owner collision refusal, one-candidate host deletion proof, stale branch-index exclusion, meaningful rename destinations, cross-tab recovery filename uniqueness, bounded lifecycle writes, and numeric hydration timestamps.\n\n'''
if report_section not in test_report:
    # replace the old target/result preamble up to first v0.2.20 section with current preamble, retaining history
    pos = test_report.find('## v0.2.20 release-gate coverage')
    history = test_report[pos:] if pos >= 0 else test_report[len(marker):]
    test_report = marker + report_section + history
write('TEST-REPORT.md', test_report)

# ---------------------------------------------------------------------------
# New executable regressions.
# ---------------------------------------------------------------------------
test_file = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    lifecycleRenameStateIsEmpty,
    liveLifecycleCandidateKeys,
    resolveDeletedLifecycleKeyFromPresence,
    resolveOwnedLifecycleKey,
} from '../hardening-core.js';
import { buildQualifiedChatKey } from '../identity.js';
import {
    encodeStateFilePayload,
    pendingNpcStateDurabilityKeys,
    readNpcStateDataFile,
    writeNpcStateDataFile,
} from '../storage.js';

const keyA = buildQualifiedChatKey('chat', 'A.png', 'Adventure');
const keyB = buildQualifiedChatKey('chat', 'B.png', 'Adventure');

test('explicit lifecycle owner is authoritative and never falls through to another owner', () => {
    assert.equal(resolveOwnedLifecycleKey([keyA], 'chat', 'Adventure', 'B.png', true), '');
    assert.equal(resolveOwnedLifecycleKey([keyA, keyB], 'chat', 'Adventure', 'B.png', true), keyB);
});

test('ownerless deletion requires host absence proof even with one NPC-State candidate', () => {
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: true }]), '');
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: null }]), '');
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA], [{ key: keyA, value: false }]), keyA);
});

test('ambiguous deletion requires exactly one absent owner and every other candidate still present', () => {
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA, keyB], [
        { key: keyA, value: false },
        { key: keyB, value: true },
    ]), keyA);
    assert.equal(resolveDeletedLifecycleKeyFromPresence([keyA, keyB], [
        { key: keyA, value: false },
        { key: keyB, value: null },
    ]), '');
});

test('live lifecycle candidates ignore branch index, recovery and tombstone history', () => {
    const ghost = buildQualifiedChatKey('chat', 'Ghost.png', 'Adventure');
    const tombstoned = buildQualifiedChatKey('chat', 'Dead.png', 'Adventure');
    const settings = {
        dataFiles: { [keyA]: { path: '/a' }, [tombstoned]: { path: '/dead' } },
        chats: {},
        branchIndex: { [ghost]: { head: ['x'] } },
        recoveryFiles: { [ghost]: { path: '/recovery' } },
        sidecarTombstones: { [tombstoned]: { reason: 'deleted' } },
    };
    assert.deepEqual(liveLifecycleCandidateKeys(settings, [], 'chat', 'Adventure'), [keyA]);
});

test('rename destination emptiness protects branch/social/inline/portrait state', () => {
    assert.equal(lifecycleRenameStateIsEmpty({ npcs: [], candidates: [], checkpoints: [] }), true);
    assert.equal(lifecycleRenameStateIsEmpty({ branchRootSnapshot: { npcs: [{ id: 'x' }] } }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ socialGraph: { edges: [{ aId: 'a', bId: 'b' }] } }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ inlineCards: [{ messageId: 1 }] }), false);
    assert.equal(lifecycleRenameStateIsEmpty({ portraitAssets: { x: { dataUrl: 'data:image/png;base64,AA==' } } }), false);
});

function fileHarness() {
    const files = new Map();
    const fetchFn = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const body = JSON.parse(options.body);
            const path = '/files/' + body.name;
            files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
            return { ok: true, status: 200, json: async () => ({ path }) };
        }
        if (files.has(url)) return { ok: true, status: 200, text: async () => files.get(url) };
        return { ok: false, status: 404, text: async () => '' };
    };
    return { files, fetchFn };
}

test('hydration converts sidecar ISO updatedAt into finite pointer milliseconds', async () => {
    const { fetchFn } = fileHarness();
    const pointer = await writeNpcStateDataFile({ chatKey: keyA, state: { value: 1 }, fetchFn });
    pointer.updatedAt = 0;
    const payload = await readNpcStateDataFile(pointer, { fetchFn, expectedChatKey: keyA });
    assert.ok(payload.updatedAt);
    assert.ok(Number.isFinite(pointer.updatedAt));
    assert.ok(pointer.updatedAt > 0);
});

test('lifecycle bounded write mode never enters the endless durability queue', async () => {
    const fetchFn = async () => { throw new Error('network unavailable'); };
    const sleepFn = resolve => resolve();
    await assert.rejects(writeNpcStateDataFile({
        chatKey: keyA,
        state: { value: 1 },
        fetchFn,
        sleepFn,
        continuousRetry: false,
    }), /network unavailable|bounded sidecar write failed/);
    assert.deepEqual(pendingNpcStateDurabilityKeys(), []);
});

test('recovery filenames are distinct across separate module instances at the same millisecond', async () => {
    const originalNow = Date.now;
    try {
        Date.now = () => 1700000000000;
        const a = await import(`../storage.js?tab-a-${Math.random()}`);
        const b = await import(`../storage.js?tab-b-${Math.random()}`);
        assert.notEqual(a.makeNpcStateRecoveryFileName(keyA), b.makeNpcStateRecoveryFileName(keyA));
    } finally {
        Date.now = originalNow;
    }
});

test('runtime wiring uses pure owner-safe helpers and cheap host chat listing', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /resolveOwnedLifecycleKey\(candidates, kind, id, resolvedOwner, ownerWasProvided\)/);
    assert.match(source, /resolveDeletedLifecycleKeyFromPresence\(candidates, presence\)/);
    assert.match(source, /avatar_url: owner, simple: true/);
    assert.match(source, /runBoundedLifecycleEvent/);
});

test('hardening owner-wide work is per-key isolated and historical index is bounded', () => {
    const source = fs.readFileSync(new URL('../hardening.js', import.meta.url), 'utf8');
    assert.match(source, /HISTORICAL_RENAME_CANDIDATE_LIMIT = 1024/);
    assert.match(source, /character rename preserved .* continued with other chats/);
    assert.match(source, /character deletion preserved .* continued with other chats/);
    assert.match(source, /runBoundedHardeningEvent/);
});
'''
write('tests/hardening-v0221.test.js', test_file)

# Update the historical v0.2.20 live-candidate assertion to the safer v0.2.21 rule.
t20 = read('tests/hardening-v0220.test.js')
t20 = t20.replace("  assert.match(block, /settings\\.branchIndex/);\n", "  assert.doesNotMatch(block, /settings\\.branchIndex/);\n")
write('tests/hardening-v0220.test.js', t20)

# Update release version assertions in executable fixtures without rewriting historical prose tests.
for path in ['tests/runtime-smoke.mjs', 'tests/migration-smoke.mjs', 'tests/package.test.js', 'tests/compatibility-check.js']:
    text = read(path)
    text = text.replace("'0.2.20'", "'0.2.21'").replace('"0.2.20"', '"0.2.21"')
    write(path, text)

# Basic guardrails before the expensive suite runs.
for path in ['index.js', 'hardening.js', 'storage.js', 'hardening-core.js', 'core.js', 'manifest.json', 'tests/hardening-v0221.test.js']:
    if not read(path).strip():
        raise SystemExit(f'{path}: unexpectedly empty')

print('v0.2.21 patch applied')
