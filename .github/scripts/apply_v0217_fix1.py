from pathlib import Path

# Restore the parent-anchor helper accidentally swallowed by the first checkpoint-pruning rewrite.
branch = Path('branch.js')
text = branch.read_text()
if 'export function ensureBranchParentAnchor' not in text:
    anchor = "export function recordBranchCheckpoint(state, chat, messageId, reason = 'state', limit = BRANCH_HISTORY_LIMIT) {"
    helper = r'''export function ensureBranchParentAnchor(state, chat, messageId, reason = 'parent-anchor', limit = BRANCH_HISTORY_LIMIT) {
    if (!state || typeof state !== 'object' || !Number.isInteger(messageId) || messageId < 0) return state;
    const lineage = chatLineage(chat);
    state.lineage = lineage;
    state.branchLineageVersion = BRANCH_LINEAGE_VERSION;
    if (messageId === 0) {
        if (!state.branchRootSnapshot || typeof state.branchRootSnapshot !== 'object') {
            state.branchRootSnapshot = snapshotBranchState(state);
        }
        return state;
    }
    if (messageId > lineage.length - 1) return state;
    const keys = lineageCheckpointKeys(lineage);
    const parentId = messageId - 1;
    const parentKey = keys[parentId];
    const checkpoints = normalizeBranchCheckpoints(state.checkpoints, lineage);
    if (!checkpoints.some(item => item.lineageKey === parentKey)) {
        checkpoints.push({
            messageId: parentId,
            fingerprint: lineage[parentId],
            lineageKey: parentKey,
            parentLineageKey: parentId > 0 ? keys[parentId - 1] : 'root',
            reason: String(reason || 'parent-anchor'),
            createdAt: Date.now(),
            snapshot: snapshotBranchState(state),
        });
    }
    state.checkpoints = pruneBranchCheckpoints(checkpoints, lineage, limit);
    return state;
}

'''
    if anchor not in text:
        raise SystemExit('recordBranchCheckpoint anchor missing')
    text = text.replace(anchor, helper + anchor, 1)
branch.write_text(text)

# Update older structural regressions to the new owner-qualified contracts instead of weakening runtime safety.
path = Path('tests/index-hardening.test.js')
t = path.read_text()
t = t.replace("/removeDeletedChatState\\(chatId, 'chat'\\)/", "/removeDeletedChatState\\(chatId, 'chat', getCharacterOwnerId\\(getContext\\(\\)\\)\\)/")
t = t.replace("/removeDeletedChatState\\(chatId, 'group'\\)/", "/removeDeletedChatState\\(chatId, 'group', String\\(getContext\\(\\)\\.groupId \\|\\| ''\\)\\)/")
path.write_text(t)

path = Path('tests/v0214-hardening.test.js')
t = path.read_text().replace('release metadata is v0.2.16', 'release metadata is v0.2.17')
t = t.replace("NPC_STATE_VERSION = '0\\.2\\.16'", "NPC_STATE_VERSION = '0\\.2\\.17'")
t = t.replace("manifest.version, '0.2.16'", "manifest.version, '0.2.17'")
path.write_text(t)

path = Path('tests/v0215-identity-hardening.test.js')
t = path.read_text()
if "const identity = fs.readFileSync" not in t:
    t = t.replace("const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');", "const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');\nconst identity = fs.readFileSync(new URL('../identity.js', import.meta.url), 'utf8');")
old = '''test('group identity takes precedence over host chatId and pending identities are noncanonical', () => {\n    const body = index.slice(index.indexOf('function getChatIdentity'), index.indexOf('function freshChatState'));\n    assert.ok(body.indexOf('if (hasGroup)') < body.indexOf("if (raw) return { key: `chat:"));\n    assert.match(body, /group:\\$\\{raw\\}/);\n    assert.match(body, /group-pending:/);\n    assert.match(body, /function isCanonicalChatKey/);\n});'''
new = '''test('group identity takes precedence over host chatId and pending identities are noncanonical', () => {\n    assert.match(identity, /if \\(hasGroup\\)/);\n    assert.match(identity, /buildQualifiedChatKey\\('group', ownerId, raw\\)/);\n    assert.match(identity, /group-pending:/);\n    assert.match(index, /return isQualifiedChatKey\\(key\\)/);\n});'''
if old not in t:
    raise SystemExit('v0215 group identity test anchor missing')
t = t.replace(old, new, 1)
t = t.replace("index.indexOf('async function migrateActiveGroupNamespace')", "index.indexOf('function legacyMigrationMatchesActiveChat')")
path.write_text(t)

Path(__file__).unlink()
print('v0.2.17 first review fixes applied')
