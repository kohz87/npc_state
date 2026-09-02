from pathlib import Path

path = Path('index.js')
text = path.read_text()
old = """        const state = normalizeChatState(rawState || {});
        if (!legacyMigrationMatchesActiveChat(state, getContext().chat || [])) {
            console.warn(`[NPC State] preserved ambiguous legacy sidecar ${oldKey}; active conversation lineage did not prove ownership for ${newKey}.`);
            return false;
        }
        const newPointer = await writeNpcStateDataFile({ chatKey: newKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateDataFileName(newKey) }, headers: requestHeaders() });"""
new = """        const state = normalizeChatState(rawState || {});
        if (!legacyMigrationMatchesActiveChat(state, getContext().chat || [])) {
            console.warn(`[NPC State] preserved ambiguous legacy sidecar ${oldKey}; active conversation lineage did not prove ownership for ${newKey}.`);
            return false;
        }
        // Ownership proof uses the legacy lineage first. Only after that proof succeeds do we
        // migrate old swipe-index/checkpoint state against the active conversation, ensuring the
        // newly qualified sidecar is canonical branch-lineage v2 from its first durable write.
        seedBranchTracking(state);
        const newPointer = await writeNpcStateDataFile({ chatKey: newKey, state, appVersion: NPC_STATE_VERSION, pointer: { name: makeNpcStateDataFileName(newKey) }, headers: requestHeaders() });"""
if old not in text:
    raise SystemExit('qualified migration canonicalization anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

Path(__file__).unlink()
print('v0.2.17 legacy branch lineage canonicalization applied')
