export function encodeChatKeyPart(value) {
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
