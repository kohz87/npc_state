import { buildQualifiedChatKey, chatOwnerScope, parseQualifiedChatKey } from './identity.js';

function firstDivergence(a = [], b = []) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    const common = Math.min(left.length, right.length);
    for (let i = 0; i < common; i += 1) if (left[i] !== right[i]) return i;
    return left.length === right.length ? -1 : common;
}

function prefixLength(a = [], b = []) {
    const divergence = firstDivergence(a, b);
    return divergence < 0 ? Math.min(a.length, b.length) : divergence;
}

export function strongLegacyMigrationMatches(state, chat = [], { lineageV2Fn, lineageV0210Fn } = {}) {
    const stored = Array.isArray(state?.lineage) ? state.lineage : [];
    const messages = Array.isArray(chat) ? chat : [];
    if (stored.length < 6 || messages.length < 6) return false;
    const candidates = [];
    if (typeof lineageV2Fn === 'function') candidates.push(lineageV2Fn(messages));
    if (typeof lineageV0210Fn === 'function') candidates.push(lineageV0210Fn(messages));
    for (const current of candidates) {
        // Destructive ownership migration must prove the full stored lineage, not merely
        // a copied starter prefix. If the active chat is shorter, keep the legacy state
        // ambiguous instead of claiming it automatically.
        const required = stored.length;
        if (required < 6 || current.length < required || prefixLength(stored, current) < required) continue;
        const userTurns = messages.slice(0, required).filter(message => message?.is_user).length;
        if (userTurns >= 2) return true;
    }
    return false;
}

export function resolveGroupOwnerId(groups = [], chatId = '') {
    const id = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const matches = (Array.isArray(groups) ? groups : []).filter(group => {
        const chats = Array.isArray(group?.chats) ? group.chats : [];
        return chats.some(chat => String(chat ?? '').replace(/\.jsonl$/i, '').trim() === id)
            || String(group?.chat_id ?? '').replace(/\.jsonl$/i, '').trim() === id;
    }).map(group => String(group?.id ?? '').trim()).filter(Boolean);
    return [...new Set(matches)].length === 1 ? matches[0] : '';
}

export function allSettingsKeys(settings = {}) {
    const maps = ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex', 'chats'];
    const keys = new Set();
    for (const mapName of maps) for (const key of Object.keys(settings?.[mapName] || {})) keys.add(key);
    return [...keys];
}

export function qualifiedKeysForOwner(settings = {}, kind = 'chat', ownerId = '') {
    const owner = String(ownerId || '').trim();
    return allSettingsKeys(settings).filter(key => {
        const parsed = parseQualifiedChatKey(key);
        return parsed?.kind === kind && parsed.ownerId === owner;
    });
}

export function uniqueQualifiedKeyForChat(settings = {}, kind = 'chat', chatId = '', ownerIdHint = '') {
    const id = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!id) return '';
    const hint = String(ownerIdHint || '').trim();
    const candidates = allSettingsKeys(settings).filter(key => {
        const parsed = parseQualifiedChatKey(key);
        return parsed?.kind === kind && parsed.chatId === id;
    });
    if (hint) {
        const direct = buildQualifiedChatKey(kind, hint, id);
        if (candidates.includes(direct)) return direct;
    }
    if (candidates.length === 1) return candidates[0];
    return '';
}

export function retargetBranchIndexEntry(entry, newKey) {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...structuredClone(entry), ownerScope: chatOwnerScope(newKey), updatedAt: Date.now() };
}

export function destinationKeyForOwnerRename(oldKey, newOwnerId) {
    const parsed = parseQualifiedChatKey(oldKey);
    if (!parsed || parsed.kind !== 'chat') return '';
    return buildQualifiedChatKey('chat', newOwnerId, parsed.chatId);
}


export function applyCanonicalOwnershipMove(config = {}, { oldKey = '', newKey = '', newPointer = null, recoveryPointer = null, reason = 'renamed' } = {}) {
    if (!oldKey || !newKey || oldKey === newKey) return config;
    for (const name of ['dataFiles', 'sidecarTombstones', 'recoveryFiles', 'branchIndex']) {
        if (!config[name] || typeof config[name] !== 'object') config[name] = {};
    }
    if (recoveryPointer) config.recoveryFiles[oldKey] = recoveryPointer;
    config.sidecarTombstones[oldKey] = { reason: `${String(reason || 'renamed')}:${newKey}`, at: Date.now() };
    const predecessorTombstone = config.sidecarTombstones?.[oldKey] || null;
    if (newPointer) {
        config.dataFiles[newKey] = newPointer;
        // Only a verified live sidecar may supersede a previous retirement marker. Tombstone-only
        // history must never clear an unrelated destination tombstone during an owner rename.
        delete config.sidecarTombstones[newKey];
    } else if (predecessorTombstone && !config.sidecarTombstones[newKey]) {
        config.sidecarTombstones[newKey] = {
            ...structuredClone(predecessorTombstone),
            reason: `${String(reason || 'renamed')}-retired:${oldKey}`,
            at: Date.now(),
        };
    }
    if (newPointer && config.branchIndex?.[oldKey]) config.branchIndex[newKey] = retargetBranchIndexEntry(config.branchIndex[oldKey], newKey);
    delete config.dataFiles[oldKey];
    delete config.branchIndex[oldKey];
    return config;
}
