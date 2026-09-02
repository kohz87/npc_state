from pathlib import Path

# ---------- branch.js: expose legacy lineage only for safe ownership migration ----------
path = Path('branch.js')
text = path.read_text()
old = """function legacyFingerprintMessageV0210(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
        swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : null,
    });
    return fnv1a32(payload);
}

export function fingerprintMessage(message = {}) {"""
new = """function legacyFingerprintMessageV0210(message = {}) {
    const payload = JSON.stringify({
        user: Boolean(message.is_user),
        system: Boolean(message.is_system),
        name: String(message.name || ''),
        text: String(message.mes || ''),
        swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : null,
    });
    return fnv1a32(payload);
}

export function legacyChatLineageV0210(chat = []) {
    return (Array.isArray(chat) ? chat : []).map(legacyFingerprintMessageV0210);
}

export function fingerprintMessage(message = {}) {"""
if old not in text:
    raise SystemExit('legacy fingerprint export anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

# ---------- index.js ----------
path = Path('index.js')
text = path.read_text()
old = """    lineageCheckpointKey,
    addUserDismissedGroup,"""
new = """    lineageCheckpointKey,
    legacyChatLineageV0210,
    addUserDismissedGroup,"""
if old not in text:
    raise SystemExit('branch import anchor missing')
text = text.replace(old, new, 1)

# Resolve deletion/rename owner by known state first. A stale host owner must not manufacture a
# nonexistent key and leave the actual sidecar orphaned. Ambiguous suffix matches fail closed.
old = """function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = '') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
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
}"""
new = """function resolveOwnedChatKey(rawId, kind = 'chat', ownerId = '') {
    const id = String(rawId ?? '').replace(/\\.jsonl$/i, '').trim();
    if (!id) return '';
    const resolvedOwner = String(ownerId || (kind === 'group' ? getContext().groupId || '' : getCharacterOwnerId(getContext()))).trim();
    const direct = buildQualifiedChatKey(kind, resolvedOwner, id);
    const suffix = `:${encodeChatKeyPart(id)}`;
    const prefix = `${kind}:`;
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.branchIndex || {}),
        ...Object.keys(settings.sidecarTombstones || {}),
        ...Object.keys(settings.recoveryFiles || {}),
        ...chatStateCache.keys(),
    ]);
    if (direct && keys.has(direct)) return direct;
    const matches = [...keys].filter(key => isCanonicalChatKey(key) && key.startsWith(prefix) && key.endsWith(suffix));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        console.warn(`[NPC State] refused ambiguous ${kind} lifecycle lookup for ${id}; ${matches.length} owner-qualified states share that chat id.`);
        return '';
    }
    return direct;
}"""
if old not in text:
    raise SystemExit('owned chat resolver anchor missing')
text = text.replace(old, new, 1)

old = """    for (const key of candidates) {
        if (chatStateCache.size - removed <= cap) break;
        if (forgetCachedChat(key)) removed += 1;
    }"""
new = """    for (const key of candidates) {
        if (chatStateCache.size <= cap) break;
        if (forgetCachedChat(key)) removed += 1;
    }"""
if old not in text:
    raise SystemExit('cache eviction count anchor missing')
text = text.replace(old, new, 1)

old = """function legacyMigrationMatchesActiveChat(state, chat = getContext().chat || []) {
    const stored = Array.isArray(state?.lineage) ? state.lineage : [];
    const current = chatLineage(chat);
    if (!stored.length || !current.length) return false;
    const common = firstLineageDivergence(stored, current);
    const prefix = common < 0 ? Math.min(stored.length, current.length) : common;
    const required = Math.min(4, stored.length, current.length);
    if (prefix < required) return false;
    return (Array.isArray(chat) ? chat.slice(0, required) : []).some(message => message?.is_user);
}"""
new = """function legacyMigrationMatchesActiveChat(state, chat = getContext().chat || []) {
    const stored = Array.isArray(state?.lineage) ? state.lineage : [];
    const messages = Array.isArray(chat) ? chat : [];
    if (!stored.length || !messages.length) return false;
    const candidates = [chatLineage(messages), legacyChatLineageV0210(messages)];
    for (const current of candidates) {
        const common = firstLineageDivergence(stored, current);
        const prefix = common < 0 ? Math.min(stored.length, current.length) : common;
        const required = Math.min(4, stored.length, current.length);
        if (required > 0 && prefix >= required && messages.slice(0, required).some(message => message?.is_user)) return true;
    }
    return false;
}"""
if old not in text:
    raise SystemExit('legacy ownership proof anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

# ---------- migration smoke: exercise a real pre-v0.2.11 lineage, including safe inline migration ----------
path = Path('tests/migration-smoke.mjs')
text = path.read_text()
text = text.replace("import { chatLineage } from '../branch.js';", "import { legacyChatLineageV0210 } from '../branch.js';")
old = """const legacyChat = [
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Welcome to the old campaign.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I enter the guild.' },
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Yunyun waits beside the notice board.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I greet Yunyun.' },
];

const legacyNpc = {"""
new = """const legacyChat = [
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Welcome to the old campaign.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I enter the guild.' },
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Yunyun waits beside the notice board.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I greet Yunyun.' },
];
const legacyLineage = legacyChatLineageV0210(legacyChat);

const legacyNpc = {"""
if old not in text:
    raise SystemExit('legacy chat fixture anchor missing')
text = text.replace(old, new, 1)
text = text.replace("messageId: 0, fingerprint: 'legacy', reason: 'scan', createdAt: 1,", "messageId: 0, fingerprint: legacyLineage[0], reason: 'scan', createdAt: 1,", 1)
text = text.replace("}], portraitAssets: {}, checkpoints: [], lineage: chatLineage(legacyChat),", "}], portraitAssets: {}, checkpoints: [], lineage: legacyLineage,", 1)
old = """    // This fixture intentionally carries a placeholder legacy inline-card fingerprint. Once the
    // owner-qualified chat is upgraded to content-based branch lineage, an unverifiable historical
    // card must be discarded instead of being attached to a potentially different message.
    assert.deepEqual(payload.state.inlineCards, [], 'unverifiable legacy inline-card history must be dropped during branch migration');
    assert.equal(payload.state.durableCompactionVersion, 1);"""
new = """    assert.equal(payload.state.inlineCards.length, 1, 'verified legacy inline-card history should migrate to content lineage');
    assert.equal('thoughts' in payload.state.inlineCards[0].cards[0], false, 'legacy snapshot thoughts should be removed during normalization');
    assert.deepEqual(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta, { trust: 0, affection: 0, desire: 0, tension: 0 }, 'legacy historical audit snapshots should be sanitized during load');
    assert.ok(Object.values(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta).every(Number.isFinite));
    assert.equal(payload.state.durableCompactionVersion, 1);"""
if old not in text:
    raise SystemExit('safe inline migration assertion anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

# ---------- hardening assertions ----------
path = Path('tests/v0217-hardening.test.js')
text = path.read_text()
old = """test('chat cache has bounded eviction and refuses to evict active work', () => {
    assert.match(index, /const CHAT_CACHE_LIMIT = 6/);
    assert.match(index, /function evictDormantChatStates/);
    assert.match(index, /stateWriteTimers\\.has\\(key\\) \\|\\| stateWritePromises\\.has\\(key\\) \\|\\| loadingChatStates\\.has\\(key\\) \\|\\| isScanBusy\\(key\\)/);
});"""
new = """test('chat cache has bounded eviction and refuses to evict active work', () => {
    assert.match(index, /const CHAT_CACHE_LIMIT = 6/);
    assert.match(index, /function evictDormantChatStates/);
    assert.match(index, /if \\(chatStateCache\\.size <= cap\\) break/);
    assert.doesNotMatch(index, /chatStateCache\\.size - removed <= cap/);
    assert.match(index, /stateWriteTimers\\.has\\(key\\) \\|\\| stateWritePromises\\.has\\(key\\) \\|\\| loadingChatStates\\.has\\(key\\) \\|\\| isScanBusy\\(key\\)/);
});

test('lifecycle lookup prefers known owner state and fails closed on ambiguous suffixes', () => {
    assert.match(index, /if \\(direct && keys\\.has\\(direct\\)\\) return direct/);
    assert.match(index, /if \\(matches\\.length > 1\\)/);
    assert.match(index, /refused ambiguous/);
});

test('legacy ownership proof accepts both content lineage and pre-v0.2.11 lineage', () => {
    assert.match(index, /legacyChatLineageV0210\\(messages\\)/);
});"""
if old not in text:
    raise SystemExit('hardening cache test anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

Path(__file__).unlink()
print('v0.2.17 cache, lifecycle lookup, and legacy-lineage hardening applied')
