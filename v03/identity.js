export function encodeKeyPart(value) {
    return encodeURIComponent(String(value ?? '').trim());
}

export function buildQualifiedChatKey(kind, ownerId, chatId) {
    const prefix = kind === 'group' ? 'group' : (kind === 'chat' ? 'chat' : '');
    const owner = String(ownerId ?? '').trim();
    const chat = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
    if (!prefix || !owner || !chat) return '';
    return `${prefix}:${encodeKeyPart(owner)}:${encodeKeyPart(chat)}`;
}

export function getCharacterOwnerId(ctx = {}) {
    const id = ctx.characterId;
    if (id === undefined || id === null) return '';
    return String(ctx.characters?.[id]?.avatar || '').trim();
}

export function getChatIdentity(ctx = {}) {
    const raw = ctx.chatId || ctx.getCurrentChatId?.();
    const groupId = ctx.groupId;
    if (groupId !== undefined && groupId !== null && String(groupId).trim()) {
        const ownerId = String(groupId).trim();
        return raw
            ? { key: buildQualifiedChatKey('group', ownerId, raw), kind: 'group', ownerId, chatId: String(raw), pending: false }
            : { key: `group-pending:${encodeKeyPart(ownerId)}`, kind: 'group', ownerId, chatId: '', pending: true };
    }
    const ownerId = getCharacterOwnerId(ctx);
    if (raw && ownerId) return { key: buildQualifiedChatKey('chat', ownerId, raw), kind: 'chat', ownerId, chatId: String(raw), pending: false };
    if (raw) return { key: `chat-pending:${encodeKeyPart(raw)}`, kind: 'chat', ownerId: '', chatId: String(raw), pending: true };
    if (ownerId) return { key: `character-pending:${encodeKeyPart(ownerId)}`, kind: 'chat', ownerId, chatId: '', pending: true };
    return { key: 'no-chat', kind: 'none', ownerId: '', chatId: '', pending: true };
}
