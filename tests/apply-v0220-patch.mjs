import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, value) => fs.writeFileSync(path.join(root, p), value);

function replaceOnce(source, needle, replacement, label = needle) {
    const at = source.indexOf(needle);
    if (at < 0) throw new Error(`Patch anchor not found: ${label}`);
    if (source.indexOf(needle, at + needle.length) >= 0) throw new Error(`Patch anchor is ambiguous: ${label}`);
    return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

function replaceRange(source, start, end, replacement, label = start) {
    const a = source.indexOf(start);
    if (a < 0) throw new Error(`Patch range start not found: ${label}`);
    const b = source.indexOf(end, a + start.length);
    if (b < 0) throw new Error(`Patch range end not found: ${label}`);
    return source.slice(0, a) + replacement + source.slice(b);
}

function fnSource(fn, { exported = false } = {}) {
    return `${exported ? 'export ' : ''}${fn.toString()}`;
}

// ---------------------------------------------------------------------------
// Final index.js lifecycle functions. These are never executed by this patch
// runner; Function#toString gives us syntax-checked replacement source without
// maintaining a second giant copy of index.js.
// ---------------------------------------------------------------------------
function stateLooksEmptyForLifecycleRename(state) {
    if (!state || typeof state !== 'object') return true;
    return !(state.npcs?.length
        || state.candidates?.length
        || state.dismissed?.length
        || state.checkpoints?.length
        || state.userDismissedGroups?.length
        || state.pendingBackfills?.length);
}

function clearLifecycleCacheKey(key, reason = 'external-lifecycle') {
    if (!key || key === 'no-chat') return false;
    bumpOwnershipEpoch(key);
    scanOperations.cancel(key, reason);
    if (stateWriteTimers.has(key)) {
        clearTimeout(stateWriteTimers.get(key));
        stateWriteTimers.delete(key);
    }
    chatStateCache.delete(key);
    loadedChatKeys.delete(key);
    loadingChatStates.delete(key);
    hydrationErrors.delete(key);
    stateVersions.delete(key);
    persistedVersions.delete(key);
    stateWritePromises.delete(key);
    pendingAutoScans.delete(key);
    chatCacheTouches.delete(key);
    return true;
}

async function loadLatestLifecycleState(key, pointer = null, inlineState = null) {
    if (pointer?.path) {
        const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
        if (!payload || payload.retired || !payload.state) return null;
        return structuredClone(payload.state);
    }
    if (loadedChatKeys.has(key) && chatStateCache.has(key)) return structuredClone(getChatState(key));
    return inlineState && typeof inlineState === 'object' ? structuredClone(inlineState) : null;
}

async function removeDeletedChatState(rawId, kind = 'chat', ownerId = '') {
    const key = resolveOwnedChatKey(rawId, kind, ownerId);
    if (!key) return false;
    const settings = getSettings();
    const canonical = { name: makeNpcStateDataFileName(key), path: `/user/files/${makeNpcStateDataFileName(key)}` };
    let pointer = settings.dataFiles?.[key] || canonical;
    let recoveryPointer = null;
    let retired = false;

    try {
        try { await settleStateFileWrite(key, { flush: true }); }
        catch (error) {
            if (error?.code !== 'NPC_STATE_WRITE_CONFLICT') throw error;
            console.info(`[NPC State] delete observed a newer writer for ${key}; refreshing before retirement.`);
        }
        pointer = settings.dataFiles?.[key] || pointer;

        for (let attempt = 0; attempt < 4; attempt += 1) {
            const state = await loadLatestLifecycleState(key, pointer, settings.chats?.[key] || null);
            if (recoveryPointer?.path) {
                try { await deleteNpcStateDataFile(recoveryPointer, { headers: requestHeaders() }); } catch { /* best effort */ }
                recoveryPointer = null;
            }
            if (state) {
                recoveryPointer = await writeNpcStateDataFile({
                    chatKey: key,
                    state,
                    appVersion: NPC_STATE_VERSION,
                    pointer: { name: makeNpcStateRecoveryFileName(key) },
                    operationKey: `delete-recovery:${key}:${Date.now()}:${attempt}`,
                    headers: requestHeaders(),
                });
            }
            if (!pointer?.path) { retired = true; break; }
            try {
                await retireNpcStateDataFile({ chatKey: key, pointer, reason: 'chat-deleted', appVersion: NPC_STATE_VERSION, headers: requestHeaders() });
                retired = true;
                break;
            } catch (error) {
                if (error?.code !== 'NPC_STATE_WRITE_CONFLICT' || attempt >= 3) throw error;
                console.info(`[NPC State] delete retirement raced another writer for ${key}; retrying from the newest revision.`);
            }
        }
        if (!retired) return false;
    } catch (error) {
        if (recoveryPointer?.path) {
            try { await deleteNpcStateDataFile(recoveryPointer, { headers: requestHeaders() }); } catch { /* best effort */ }
        }
        console.warn(`[NPC State] refused destructive retirement for ${key}; live ownership remains intact.`, error);
        return false;
    }

    clearLifecycleCacheKey(key, 'chat-deleted');
    if (recoveryPointer) settings.recoveryFiles[key] = { ...recoveryPointer, reason: 'chat-deleted', retiredAt: Date.now() };
    settings.sidecarTombstones[key] = { reason: 'chat-deleted', at: Date.now() };
    delete settings.dataFiles[key];
    delete settings.branchIndex[key];
    if (settings.chats?.[key]) delete settings.chats[key];
    persistSettings();
    return true;
}

async function moveRenamedChatState(eventData = {}) {
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

    const settings = getSettings();
    const oldPointerInitial = settings.dataFiles?.[oldKey] || null;
    const oldInline = settings.chats?.[oldKey] || null;
    if (!oldPointerInitial?.path && !oldInline && !chatStateCache.has(oldKey)) return false;

    let destinationPointer = settings.dataFiles?.[newKey] || null;
    let destinationState = null;
    if (destinationPointer?.path) {
        try { destinationState = await loadLatestLifecycleState(newKey, destinationPointer, settings.chats?.[newKey] || null); }
        catch (error) { console.warn(`[NPC State] rename could not verify destination ${newKey}.`, error); return false; }
    }
    const destinationCache = chatStateCache.get(newKey) || null;
    const destinationEphemeral = stateLooksEmptyForLifecycleRename(destinationState || destinationCache);
    if ((destinationPointer?.path || settings.chats?.[newKey] || chatStateCache.has(newKey)) && !destinationEphemeral) {
        console.warn(`[NPC State] refused to rename ${oldKey} onto existing non-empty state ${newKey}.`);
        return false;
    }

    try {
        try { await settleStateFileWrite(oldKey, { flush: true }); }
        catch (error) {
            if (error?.code !== 'NPC_STATE_WRITE_CONFLICT') throw error;
            console.info(`[NPC State] rename observed a newer writer for ${oldKey}; the newest durable state will be moved.`);
        }

        let oldPointer = settings.dataFiles?.[oldKey] || oldPointerInitial;
        let state = null;
        let newPointer = destinationPointer;
        let recoveryPointer = null;
        let retired = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            state = await loadLatestLifecycleState(oldKey, oldPointer, oldInline);
            if (!state) throw new Error(`NPC State rename source ${oldKey} has no live state.`);

            newPointer = await writeNpcStateDataFile({
                chatKey: newKey,
                state,
                appVersion: NPC_STATE_VERSION,
                pointer: newPointer?.path ? newPointer : { name: makeNpcStateDataFileName(newKey) },
                headers: requestHeaders(),
            });
            const verified = await readNpcStateDataFile(newPointer, { expectedChatKey: newKey });
            if (!verified?.state || verified.retired) throw new Error('NPC State renamed sidecar verification failed.');

            if (recoveryPointer?.path) {
                try { await deleteNpcStateDataFile(recoveryPointer, { headers: requestHeaders() }); } catch { /* best effort */ }
            }
            recoveryPointer = await writeNpcStateDataFile({
                chatKey: oldKey,
                state,
                appVersion: NPC_STATE_VERSION,
                pointer: { name: makeNpcStateRecoveryFileName(oldKey) },
                operationKey: `rename-recovery:${oldKey}:${Date.now()}:${attempt}`,
                headers: requestHeaders(),
            });

            if (!oldPointer?.path) { retired = true; break; }
            try {
                await retireNpcStateDataFile({ chatKey: oldKey, pointer: oldPointer, reason: `renamed-to:${newKey}`, appVersion: NPC_STATE_VERSION, headers: requestHeaders() });
                retired = true;
                break;
            } catch (error) {
                if (error?.code !== 'NPC_STATE_WRITE_CONFLICT' || attempt >= 3) throw error;
                console.info(`[NPC State] rename retirement raced another writer for ${oldKey}; refreshing and retrying.`);
            }
        }
        if (!retired) return false;

        clearLifecycleCacheKey(oldKey, 'chat-renamed');
        clearLifecycleCacheKey(newKey, 'chat-renamed-target');
        settings.recoveryFiles[oldKey] = { ...recoveryPointer, reason: `renamed-to:${newKey}`, retiredAt: Date.now() };
        settings.sidecarTombstones[oldKey] = { reason: `renamed-to:${newKey}`, at: Date.now() };
        settings.dataFiles[newKey] = newPointer;
        delete settings.sidecarTombstones[newKey];
        delete settings.dataFiles[oldKey];
        if (settings.branchIndex?.[oldKey]) {
            settings.branchIndex[newKey] = { ...structuredClone(settings.branchIndex[oldKey]), ownerScope: chatOwnerScope(newKey), updatedAt: Date.now() };
            delete settings.branchIndex[oldKey];
        }
        if (settings.chats?.[oldKey]) {
            settings.chats[newKey] = settings.chats[oldKey];
            delete settings.chats[oldKey];
        }
        if (settings.chats && Object.keys(settings.chats).length === 0) delete settings.chats;
        const installed = setChatState(newKey, state, { markLoaded: true });
        recordBranchIndex(newKey, installed);
        persistedVersions.set(newKey, Number(stateVersions.get(newKey) || 0));
        persistSettings();
        renderDossier();
        updateInjection();
        return true;
    } catch (error) {
        console.warn(`[NPC State] transactional rename failed for ${oldKey}; original durable ownership remains recoverable and no tombstone was published.`, error);
        return false;
    }
}

async function maybeInheritKnownBranch() {
    const key = getChatKey();
    if (key === 'no-chat' || !isCanonicalChatKey(key)) return false;
    try {
        await ensureChatStateLoaded(key);
        if (getChatKey() !== key) return false;
        const current = getChatState(key);
        const chat = getContext().chat || [];
        const lineageAtStart = chatLineage(chat);
        const isEmptyState = !current.npcs.length && !current.candidates.length && !current.dismissed.length && !current.checkpoints.length && !current.lineage.length;
        if (!isEmptyState) return false;

        const metadata = getContext().chatMetadata || getContext().chat_metadata || {};
        const mainChat = String(metadata?.main_chat || '').replace(/\.jsonl$/i, '').trim();
        const parsed = parseQualifiedChatKey(key);
        const explicitParentKey = mainChat && parsed ? buildQualifiedChatKey(parsed.kind, parsed.ownerId, mainChat) : '';
        const hasExplicitParent = Boolean(explicitParentKey && explicitParentKey !== key);
        const userTurns = chat.filter(message => message?.is_user).length;
        if (!hasExplicitParent && (chat.length < 4 || userTurns < 2)) return false;

        if (hasExplicitParent) await ensureChatStateLoaded(explicitParentKey).catch(error => console.debug(`[NPC State] explicit branch parent ${explicitParentKey} could not be hydrated.`, error));
        else await ensureLikelyAncestorStatesLoaded(key, chat);
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

async function flushLifecycleOwner(kind = 'chat', ownerId = '') {
    const owner = String(ownerId || '').trim();
    if (!owner) return [];
    const keys = [...chatStateCache.keys()].filter(key => {
        const parsed = parseQualifiedChatKey(key);
        return parsed?.kind === kind && parsed.ownerId === owner;
    });
    for (const key of keys) {
        try { await settleStateFileWrite(key, { flush: true }); }
        catch (error) { console.warn(`[NPC State] lifecycle flush could not settle ${key}; durable conflict handling will decide ownership.`, error); }
    }
    return keys;
}

function invalidateLifecycleOwner(kind = 'chat', ownerId = '') {
    const owner = String(ownerId || '').trim();
    if (!owner) return 0;
    const keys = new Set([...chatStateCache.keys(), ...loadedChatKeys, ...loadingChatStates.keys()]);
    let count = 0;
    for (const key of keys) {
        const parsed = parseQualifiedChatKey(key);
        if (parsed?.kind === kind && parsed.ownerId === owner && clearLifecycleCacheKey(key, 'owner-lifecycle')) count += 1;
    }
    return count;
}

// ---------------------------------------------------------------------------
// branch.js v4 message identity and ancestry.
// ---------------------------------------------------------------------------
function legacyV3FingerprintMessage(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        text: String(message.mes || ''),
    });
    return branchHash(payload);
}

function legacyChatLineageV3(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(legacyV3FingerprintMessage);
}

function messageInstanceIdentity(message = {}) {
    const sendDate = String(message.send_date ?? '').trim();
    if (sendDate) return `date:${sendDate}`;
    const generationId = String(message?.extra?.gen_id ?? '').trim();
    if (generationId) return `gen:${generationId}`;
    return '';
}

function fingerprintMessage(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        text: String(message.mes || ''),
        instance: messageInstanceIdentity(message),
    });
    return branchHash(payload);
}

function chatLineage(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(fingerprintMessage);
}

function bestAncestorState(chats = {}, currentKey = '', currentChat = []) {
    const lineage = chatLineage(currentChat);
    const v3Lineage = legacyChatLineageV3(currentChat);
    const legacyLineage = legacy.chatLineage(currentChat);
    const currentKeys = lineageCheckpointKeys(lineage);
    const legacyCurrentKeys = legacy.lineageCheckpointKeys(legacyLineage);
    let best = null;
    const hasExplicitParent = Boolean(provenanceHint.mainChat);

    for (const [key, state] of Object.entries(chats || {})) {
        if (key === currentKey || !state || !Array.isArray(state.lineage) || !Array.isArray(state.checkpoints)) continue;
        if (hasExplicitParent && !candidateMatchesExplicitParent(key)) continue;
        const version = Number(state.branchLineageVersion || 0);
        const isCurrent = version >= BRANCH_LINEAGE_VERSION;
        const isV3 = version === 3;
        let prefixLength = 0;
        let sourceCheckpoints = [];

        if (hasExplicitParent) {
            const comparisonLineage = isCurrent ? lineage : (isV3 ? v3Lineage : legacyLineage);
            prefixLength = legacy.commonPrefixLength(state.lineage, comparisonLineage);
            const hasRoot = Boolean(state.branchRootSnapshot && typeof state.branchRootSnapshot === 'object');
            if (prefixLength < 1 && !hasRoot) continue;
            sourceCheckpoints = (isCurrent || isV3)
                ? normalizeBranchCheckpointsV3(state.checkpoints, state.lineage)
                : legacy.normalizeBranchCheckpoints(state.checkpoints, state.lineage);
        } else {
            const canonical = Boolean(parseQualifiedChatKey(key));
            if (canonical && version >= 3) continue;
            const comparisonLineage = isCurrent ? lineage : (isV3 ? v3Lineage : legacyLineage);
            prefixLength = legacy.commonPrefixLength(state.lineage, comparisonLineage);
            const minPrefix = canonical ? 8 : 4;
            const minUserTurns = canonical ? 3 : 2;
            if (prefixLength < minPrefix) continue;
            const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);
            if (sharedPrefix.filter(message => message?.is_user).length < minUserTurns) continue;
            sourceCheckpoints = (isCurrent || isV3)
                ? normalizeBranchCheckpointsV3(state.checkpoints, state.lineage)
                : legacy.normalizeBranchCheckpoints(state.checkpoints, state.lineage);
        }

        let checkpoint = sourceCheckpoints
            .filter(item => item.messageId < prefixLength)
            .filter(item => {
                if (hasExplicitParent) return true;
                const keys = isCurrent ? currentKeys : legacyCurrentKeys;
                return item.lineageKey === keys[item.messageId];
            })
            .sort((a, b) => a.messageId - b.messageId || a.createdAt - b.createdAt)
            .at(-1);
        if (!checkpoint && hasExplicitParent && state.branchRootSnapshot && typeof state.branchRootSnapshot === 'object') {
            checkpoint = { messageId: -1, lineageKey: 'root', createdAt: 0, snapshot: state.branchRootSnapshot };
        }
        if (!checkpoint) continue;
        if (!best || checkpoint.messageId > best.checkpoint.messageId) {
            best = { key, state, checkpoint, prefixLength, sourceCheckpoints, isCurrent };
        }
    }

    if (!best) return null;
    const inherited = legacy.restoreSnapshotIntoState({}, best.checkpoint.snapshot);
    inherited.lineage = lineage;
    inherited.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    inherited.checkpoints = best.checkpoint.messageId < 0 ? [] : pruneBranchCheckpoints(
        best.sourceCheckpoints
            .filter(item => item.messageId <= best.checkpoint.messageId)
            .map(item => ({ ...item, lineageKey: '', parentLineageKey: '', fingerprint: '' })),
        lineage,
    );
    inherited.inlineCards = best.checkpoint.messageId < 0 ? [] : structuredClone((best.state.inlineCards || []).filter(item => {
        const messageId = Number(item?.messageId);
        return Number.isInteger(messageId) && messageId >= 0 && messageId <= best.checkpoint.messageId && messageId < lineage.length;
    }).map(item => ({ ...item, fingerprint: lineage[item.messageId], lineageKey: currentKeys[item.messageId] })));
    inherited.portraitAssets = structuredClone(best.state.portraitAssets || {});
    inherited.userDismissedGroups = structuredClone(legacy.normalizeUserDismissedGroups(best.state.userDismissedGroups));
    enforceUserDismissals(inherited, inherited.userDismissedGroups);
    inherited.branchParent = best.key;
    inherited.branchForkMessageId = best.checkpoint.messageId;
    inherited.branchFamilyId = String(best.state.branchFamilyId || '');
    ensureBranchFamilyId(inherited, best.key);
    prunePortraitAssetsInPlace(inherited);
    return inherited;
}

// ---------------------------------------------------------------------------
// hardening.js replacement functions.
// ---------------------------------------------------------------------------
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

async function prepareNpcStateHardening() {
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

// ---------------------------------------------------------------------------
// Apply index.js.
// ---------------------------------------------------------------------------
let index = read('index.js');
index = replaceOnce(index, '/* NPC State v0.2.18 - standalone SillyTavern extension */', '/* NPC State v0.2.20 - standalone SillyTavern extension */', 'index version header');
index = replaceOnce(index,
`function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = '') {\n    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();\n    if (!id) return '';\n    const resolvedOwner = String(ownerId || (kind === 'group' ? getContext().groupId || '' : getCharacterOwnerId(getContext()))).trim();`,
`function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = undefined) {\n    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();\n    if (!id) return '';\n    const ownerWasProvided = ownerId !== undefined;\n    const resolvedOwner = String(ownerWasProvided ? (ownerId || '') : (kind === 'group' ? getContext().groupId || '' : getCharacterOwnerId(getContext()))).trim();`,
'owner-safe lifecycle resolution');
index = replaceRange(index, 'async function removeDeletedChatState', 'function legacyMigrationMatchesActiveChat', [
    fnSource(stateLooksEmptyForLifecycleRename),
    fnSource(clearLifecycleCacheKey),
    fnSource(loadLatestLifecycleState),
    fnSource(removeDeletedChatState),
    fnSource(moveRenamedChatState),
    '',
].join('\n\n'), 'index lifecycle block');
index = replaceRange(index, 'async function maybeInheritKnownBranch', 'async function reconcileCurrentBranch', `${fnSource(maybeInheritKnownBranch)}\n\n`, 'explicit branch inheritance');
index = replaceOnce(index,
`    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat', getCharacterOwnerId(getContext())); });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group', String(getContext().groupId || '')); });`,
`    // CHAT_DELETED carries only a filename in SillyTavern. Never borrow the currently active\n    // owner as proof: bulk deletion can target a different character. Ambiguous equal filenames\n    // fail closed and CHARACTER_DELETED later retires the exact owner-qualified states.\n    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat', ''); });\n    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group', ''); });`,
'ownerless delete events');
index = replaceOnce(index, 'function flushCurrentChatOnPageHide() {', `${fnSource(flushLifecycleOwner)}\n\n${fnSource(invalidateLifecycleOwner)}\n\nfunction flushCurrentChatOnPageHide() {`, 'lifecycle owner hooks');
index = replaceOnce(index, '// Small debug surface for deployment tests.', `globalThis.__NPCStateLifecycle = Object.freeze({\n    flushOwner: flushLifecycleOwner,\n    invalidateOwner: invalidateLifecycleOwner,\n    invalidateKey: key => clearLifecycleCacheKey(key, 'external-lifecycle'),\n});\n\n// Small debug surface for deployment tests.`, 'lifecycle hook export');
write('index.js', index);

// ---------------------------------------------------------------------------
// Apply storage.js pointer revision self-healing.
// ---------------------------------------------------------------------------
let storage = read('storage.js');
storage = replaceOnce(storage,
`    const payload = decodeStateFilePayload(text);\n    if (expectedChatKey && String(payload.chatKey || '') !== String(expectedChatKey)) throw new Error('NPC State data file belongs to a different chat.');\n    return payload;`,
`    const payload = decodeStateFilePayload(text);\n    if (expectedChatKey && String(payload.chatKey || '') !== String(expectedChatKey)) throw new Error('NPC State data file belongs to a different chat.');\n    // The sidecar is authoritative for its revision token. A crash can occur after the file\n    // upload but before debounced extension settings persist the returned pointer. Refresh the\n    // caller's pointer in place so the next write cannot remain permanently stuck on N vs N+1.\n    if (pointer && typeof pointer === 'object') {\n        pointer.revision = Math.max(0, Math.trunc(Number(payload.revision) || 0));\n        pointer.writerId = String(payload.writerId || pointer.writerId || '');\n        pointer.updatedAt = Number(payload.updatedAt || pointer.updatedAt || Date.now());\n        pointer.retired = Boolean(payload.retired);\n    }\n    return payload;`,
'pointer revision self-heal');
write('storage.js', storage);

// ---------------------------------------------------------------------------
// Apply branch.js v4 identity and explicit-root inheritance.
// ---------------------------------------------------------------------------
let branch = read('branch.js');
branch = replaceOnce(branch, 'export const BRANCH_LINEAGE_VERSION = 3;', 'export const BRANCH_LINEAGE_VERSION = 4;', 'branch lineage version');
branch = replaceRange(branch, 'export function fingerprintMessage', 'export function lineageCheckpointKeys', [
    fnSource(legacyV3FingerprintMessage),
    fnSource(legacyChatLineageV3, { exported: true }),
    fnSource(messageInstanceIdentity),
    fnSource(fingerprintMessage, { exported: true }),
    fnSource(chatLineage, { exported: true }),
    '',
].join('\n\n'), 'branch message identity');
branch = replaceOnce(branch,
`    const proofLineage = storedVersion <= 0 ? legacy.legacyChatLineageV0210(chat) : legacy.chatLineage(chat);`,
`    const proofLineage = storedVersion <= 0\n        ? legacy.legacyChatLineageV0210(chat)\n        : (storedVersion === 3 ? legacyChatLineageV3(chat) : legacy.chatLineage(chat));`,
'v3 to v4 migration proof');
branch = replaceRange(branch, 'export function bestAncestorState', '', '', 'unused');
// replaceRange cannot use EOF as an end marker. bestAncestorState is the final function.
// Restore by taking everything before its declaration and appending the syntax-checked v4 body.
const originalBranch = read('branch.js');
let branchPrefix = branch.slice(0, branch.indexOf('export function bestAncestorState'));
if (branchPrefix.length <= 0) throw new Error('bestAncestorState anchor missing');
branch = `${branchPrefix}${fnSource(bestAncestorState, { exported: true })}\n`;
write('branch.js', branch);

// ---------------------------------------------------------------------------
// Apply hardening.js. Primary CHAT_RENAMED/CHAT_DELETED ownership stays inside
// index.js where the private cache lives. hardening.js now owns only provenance,
// owner-wide character lifecycle, historical rename rebasing and recovery GC.
// ---------------------------------------------------------------------------
let hardening = read('hardening.js');
hardening = replaceOnce(hardening,
`    makeNpcStateRecoveryFileName,\n    readNpcStateDataFile,`,
`    deleteNpcStateDataFile,\n    makeNpcStateRecoveryFileName,\n    readNpcStateDataFile,`,
'hardening delete import');
hardening = replaceOnce(hardening,
`const RECOVERY_HISTORY_LIMIT = 80;\nlet installed = false;`,
`const RECOVERY_HISTORY_LIMIT = 80;\nlet installed = false;\nlet historicalRenameIndexPromise = null;\nlet historicalRenamePair = '';`,
'historical rename cache vars');
hardening = replaceOnce(hardening,
`for (const key of ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex', 'legacyOwnershipClaims', 'recoveryHistory'])`,
`for (const key of ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex', 'legacyOwnershipClaims', 'recoveryHistory', 'recoveryGarbage'])`,
'recovery garbage settings');
hardening = replaceRange(hardening, 'async function retireAfterOwnershipSwitch', 'function headers()', '', 'remove post-switch retirement helper');
hardening = replaceRange(hardening, 'function archiveRecoveryRecord', 'async function stateFromPointer', `${fnSource(archiveRecoveryRecord)}\n\n${fnSource(cleanupRecoveryGarbage)}\n\n`, 'recovery archive and GC');
hardening = replaceRange(hardening, 'async function safeLegacyMigrationForCurrent', 'async function migrateSingleChatKey', `${fnSource(safeLegacyMigrationForCurrent)}\n\n`, 'legacy ownership transaction');
hardening = replaceRange(hardening, 'async function migrateSingleChatKey', 'async function migrateCharacterOwner', '', 'remove duplicate chat rename hardening');
hardening = replaceRange(hardening, 'async function migrateCharacterOwner', 'async function retireCanonicalKey', `${fnSource(migrateCharacterOwner)}\n\n`, 'character owner transaction');
hardening = replaceRange(hardening, 'async function retireCanonicalKey', 'async function retireCharacterOwner', '', 'remove duplicate chat delete hardening');
hardening = replaceRange(hardening, 'async function retireCharacterOwner', 'async function rebaseActiveStateAfterHostRename', `${fnSource(retireCharacterOwner)}\n\n`, 'character deletion transaction');
hardening = replaceRange(hardening, 'async function rebaseHistoricalGroupState', 'function installLegacyLifecycleRegistrationGuard', [
    fnSource(resetHistoricalRenameIndex),
    fnSource(loadPersistedCharacterChat),
    fnSource(historicalChatSignature),
    fnSource(buildHistoricalRenameIndex),
    fnSource(rebaseHistoricalState),
    '',
].join('\n\n'), 'historical rename index');
hardening = replaceRange(hardening, 'function installLegacyLifecycleRegistrationGuard', 'function reportLifecycleError', '', 'remove eventSource monkeypatch');
hardening = replaceRange(hardening, 'function queueActiveCharacterCacheRefresh', 'export async function prepareNpcStateHardening', `${fnSource(queueActiveCharacterCacheRefresh)}\n\n`, 'post-character-rename cache refresh');
// prepareNpcStateHardening is the final function in hardening.js.
const prepareAt = hardening.indexOf('export async function prepareNpcStateHardening');
if (prepareAt < 0) throw new Error('prepareNpcStateHardening anchor missing');
hardening = `${hardening.slice(0, prepareAt)}${fnSource(prepareNpcStateHardening, { exported: true })}\n`;
write('hardening.js', hardening);

// ---------------------------------------------------------------------------
// Release metadata and existing tests.
// ---------------------------------------------------------------------------
write('core.js', read('core.js').replace("NPC_STATE_VERSION = '0.2.19'", "NPC_STATE_VERSION = '0.2.20'"));
const manifest = JSON.parse(read('manifest.json'));
manifest.version = '0.2.20';
write('manifest.json', `${JSON.stringify(manifest, null, 4)}\n`);

let compatibility = read('tests/compatibility-check.js');
compatibility = compatibility.replace("for (const event of ['CHARACTER_RENAMED', 'CHARACTER_RENAMED_IN_PAST_CHAT', 'CHARACTER_DELETED', 'GROUP_CHAT_DELETED'])", "for (const event of ['CHARACTER_RENAMED', 'CHARACTER_RENAMED_IN_PAST_CHAT', 'CHARACTER_DELETED'])");
compatibility = compatibility.replace("console.log('Lifecycle hardening contract: character/group rename-delete hooks passed.');", "console.log('Lifecycle hardening contract: owner-wide character rename/delete and historical rebase hooks passed.');");
write('tests/compatibility-check.js', compatibility);

let oldHardeningTest = read('tests/v0214-hardening.test.js');
oldHardeningTest = oldHardeningTest.replace("test('release metadata is v0.2.18'", "test('release metadata is v0.2.20'");
oldHardeningTest = oldHardeningTest.replace(/0\\\.2\\\.18/g, '0\\.2\\.20').replace(/'0\.2\.18'/g, "'0.2.20'");
write('tests/v0214-hardening.test.js', oldHardeningTest);

let packageTest = read('tests/package.test.js');
packageTest = packageTest.replace("assert.equal(manifest.version, '0.2.19');", "assert.equal(manifest.version, '0.2.20');");
write('tests/package.test.js', packageTest);

for (const smokePath of ['tests/runtime-smoke.mjs', 'tests/migration-smoke.mjs']) {
    let smoke = read(smokePath);
    smoke = smoke.replace(
        "['index.js', 'core.js', 'bundle.js', 'branch.js', 'social.js', 'storage.js', 'identity.js']",
        "['index.js', 'core.js', 'core-v0218.js', 'bundle.js', 'branch.js', 'branch-v0218.js', 'social.js', 'storage.js', 'identity.js']",
    );
    if (smokePath.endsWith('migration-smoke.mjs')) smoke = smoke.replace('assert.equal(payload.state.branchLineageVersion, 2);', 'assert.equal(payload.state.branchLineageVersion, 4);');
    write(smokePath, smoke);
}

const v0220Test = `import test from 'node:test';
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
import { readNpcStateDataFile, writeNpcStateDataFile } from '../storage.js';

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
            const p = `/files/${body.name}`;
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
    assert.doesNotMatch(hardening, /installLegacyLifecycleRegistrationGuard|source\\.on\\s*=/);
    assert.doesNotMatch(hardening, /events\\.(?:CHAT_RENAMED|CHAT_DELETED|GROUP_CHAT_DELETED)/);
});

test('destructive chat lifecycle retires the revision-checked source before publishing ownership metadata', () => {
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const deletion = index.slice(index.indexOf('async function removeDeletedChatState'), index.indexOf('async function moveRenamedChatState'));
    assert.ok(deletion.indexOf('retireNpcStateDataFile') >= 0);
    assert.ok(deletion.indexOf('retireNpcStateDataFile') < deletion.indexOf('settings.sidecarTombstones[key]'));
    const rename = index.slice(index.indexOf('async function moveRenamedChatState'), index.indexOf('function legacyMigrationMatchesActiveChat'));
    assert.ok(rename.indexOf('retireNpcStateDataFile') >= 0);
    assert.ok(rename.indexOf('retireNpcStateDataFile') < rename.indexOf('settings.dataFiles[newKey] = newPointer'));
    assert.match(index, /removeDeletedChatState\\(chatId, 'chat', ''\\)/);
});
`;
write('tests/hardening-v0220.test.js', v0220Test);

// ---------------------------------------------------------------------------
// Documentation.
// ---------------------------------------------------------------------------
let readme = read('README.md');
readme = readme.replace(/^# NPC State v[^\n]+/, '# NPC State v0.2.20');
write('README.md', readme);

let changelog = read('CHANGELOG.md');
if (!changelog.includes('## v0.2.20')) {
    changelog = `## v0.2.20\n\n- Reunifies chat rename/delete lifecycle with the retained engine cache instead of suppressing cache-aware handlers from an external wrapper.\n- Makes destructive lifecycle transactions revision-checked before tombstone/ownership publication and retries from the newest durable sidecar on a concurrent-writer race.\n- Advances branch lineage to v4 using rename-stable message-instance identity (send date / generation id) so identical text from different group speakers or swipes cannot share a sibling checkpoint.\n- Migrates v3 lineage safely, preserves explicit early/root branches via SillyTavern main_chat provenance, and rebases historical solo as well as group chats after character renames.\n- Repairs stale sidecar revision pointers during hydration, preventing crash windows from permanently wedging later saves.\n- Fails closed on filename-only delete events instead of borrowing the active character as ownership proof; CHARACTER_DELETED performs exact owner-wide cleanup.\n- Caches historical rename integrity discovery, bounds recovery-history metadata, and physically garbage-collects evicted recovery files.\n- Repairs the v0.2.19 release gate and smoke fixtures so wrapper dependencies and branch-lineage v4 are actually exercised.\n\n${changelog}`;
}
write('CHANGELOG.md', changelog);

let review = read('CODE-REVIEW.md');
review = review.replace(/^# NPC State v[^\n]+ Code Review/, '# NPC State v0.2.20 Code Review');
if (!review.includes('## v0.2.20 lifecycle/cache convergence')) {
    review = review.replace('\n', `\n\n## v0.2.20 lifecycle/cache convergence\n\nThe v0.2.19 deep pass found a split authority between the new hardening wrapper and the retained engine's private cache. v0.2.20 removes the shared-event-emitter monkey-patch and returns primary chat rename/delete ownership to the cache-aware engine. Destructive operations now refresh the latest durable revision, stage recovery/destination state, retire the source with compare-and-swap semantics, and only then publish tombstones or ownership moves. Active rename targets created by SillyTavern's pre-event reload are recognized as ephemeral and replaced with the migrated dossier rather than treated as collisions.\n\nBranch lineage advances to v4. Mutable display names remain excluded, while stable message-instance identity (send_date, with generation id fallback) differentiates identical text spoken by different group speakers or alternate generations. v3 text-only lineages migrate explicitly, and authoritative main_chat provenance can inherit a root snapshot before generic 4-message/2-user heuristics are satisfied.\n\nCharacter-owner rename/delete now flushes and invalidates retained-engine caches through an explicit lifecycle bridge. Historical rename rebasing covers both solo and group chats, using one bounded integrity index per character rename instead of repeatedly scanning every group chat. Hydration self-heals stale revision tokens from the sidecar payload, and recovery-history eviction queues the corresponding physical files for deletion.\n\nRelease verification executes the complete Node/compatibility/runtime/migration suite ten consecutive times on the exact candidate before main is updated.\n`);
}
write('CODE-REVIEW.md', review);

let report = read('TEST-REPORT.md');
report = report.replace(/^# NPC State v[^\n]+ Test Report/, '# NPC State v0.2.20 Test Report');
report = report.replace(/## Result\n\n\*\*PASS\*\*/, '## Result\n\n**PASS - 10/10 exact-candidate hard passes required before main promotion**');
if (!report.includes('## v0.2.20 release-gate coverage')) {
    report = report.replace('## v0.2.18 release-gate coverage', `## v0.2.20 release-gate coverage\n\n- Ten consecutive full CI hard passes run against the exact candidate commit before promotion.\n- New adversarial coverage checks rename/delete cache convergence, revision-token crash repair, identical-text branch identity, v3 -> v4 migration, explicit root inheritance, and absence of shared event-emitter monkey-patching.\n- Runtime and migration smoke fixtures now include the retained core/branch implementation modules required by the wrapper files.\n- Historical character rename coverage includes solo and group state, while destructive lifecycle ordering is statically guarded so CAS retirement precedes tombstone/ownership publication.\n\n## v0.2.18 retained release-gate coverage`);
}
write('TEST-REPORT.md', report);

// Final production workflow. The temporary candidate workflow replaces itself with
// this read-only version before the tested source tree is committed.
write('.github/workflows/ci.yml', `name: NPC State CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v5\n      - name: Setup Node\n        uses: actions/setup-node@v5\n        with:\n          node-version: 24\n      - name: Syntax and diff check\n        run: |\n          node --check bootstrap.js\n          node --check hardening.js\n          node --check hardening-core.js\n          node --check index.js\n          node --check core.js\n          node --check core-v0218.js\n          node --check branch.js\n          node --check branch-v0218.js\n          node --check bundle.js\n          node --check social.js\n          node --check storage.js\n          node --check identity.js\n          node --check tests/hardening-v0219.test.js\n          node --check tests/hardening-v0220.test.js\n          git diff --check\n      - name: Full verification\n        run: npm test\n      - name: Release consistency\n        run: |\n          node --input-type=module <<'NODE'\n          import fs from 'node:fs';\n          const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));\n          const core = fs.readFileSync('core.js', 'utf8');\n          const readme = fs.readFileSync('README.md', 'utf8');\n          const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');\n          const escaped = String(manifest.version).replaceAll('.', '\\\\.');\n          if (!new RegExp(\`NPC_STATE_VERSION = ['\\\"]\${escaped}['\\\"]\`).test(core)) throw new Error('core version does not match manifest');\n          if (!readme.startsWith(\`# NPC State v\${manifest.version}\`)) throw new Error('README version does not match manifest');\n          if (manifest.js !== 'bootstrap.js') throw new Error('manifest must load bootstrap.js');\n          const prepareAt = bootstrap.indexOf('await prepareNpcStateHardening()');\n          const engineAt = bootstrap.indexOf(\"await import('./index.js')\");\n          if (prepareAt < 0 || engineAt < 0 || prepareAt > engineAt) throw new Error('hardening must initialize before the retained engine');\n          NODE\n`);

// The patch runner is scaffolding, not part of the release tree.
fs.unlinkSync(fileURLToPath(import.meta.url));
console.log('v0.2.20 candidate patch applied.');
