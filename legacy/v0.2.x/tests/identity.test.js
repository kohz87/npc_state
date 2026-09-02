import test from 'node:test';
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
