from pathlib import Path

path = Path('tests/runtime-smoke.mjs')
text = path.read_text()

old = '''    const persistenceTarget = globalThis.NPCState.getState().npcs.find(n => !n.archived);
    assert.ok(persistenceTarget, 'runtime should retain an NPC for persistence race validation');
    globalThis.NPCState.archive(persistenceTarget.id);
    let releaseUpload;
    let markUploadEntered;
    const uploadEntered = new Promise(resolve => { markUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markUploadEntered,
        promise: new Promise(resolve => { releaseUpload = resolve; }),
    };
    const uploadsBeforeRace = mockState.uploadCalls;
    const racingFlush = globalThis.NPCState.flush();
    await uploadEntered;
    globalThis.NPCState.restore(persistenceTarget.id);
    releaseUpload();
    await racingFlush;
    await globalThis.NPCState.flush();
    assert.ok(mockState.uploadCalls >= uploadsBeforeRace + 2, 'an in-flight mutation should produce a follow-up sidecar write');'''
new = '''    const persistenceTarget = globalThis.NPCState.getState().npcs.find(n => !n.archived);
    assert.ok(persistenceTarget, 'runtime should retain an NPC for persistence race validation');
    let releaseUpload;
    let markUploadEntered;
    const uploadEntered = new Promise(resolve => { markUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markUploadEntered,
        promise: new Promise(resolve => { releaseUpload = resolve; }),
    };
    const uploadsBeforeRace = mockState.uploadCalls;
    // v0.2.17 starts high-value user mutations immediately. Install the barrier before
    // the archive so the test blocks that first critical write, then mutates again while
    // it is in flight and verifies the writer loops to a newer snapshot.
    globalThis.NPCState.archive(persistenceTarget.id);
    await uploadEntered;
    const racingFlush = globalThis.NPCState.flush();
    globalThis.NPCState.restore(persistenceTarget.id);
    releaseUpload();
    await racingFlush;
    await globalThis.NPCState.flush();
    assert.ok(mockState.uploadCalls >= uploadsBeforeRace + 2, 'an in-flight critical mutation should produce a follow-up sidecar write');'''
if old not in text:
    raise SystemExit('persistence race block not found')
text = text.replace(old, new, 1)

old = '''    globalThis.NPCState.archive(persistenceTarget.id);
    let releaseDeleteUpload;
    let markDeleteUploadEntered;
    const deleteUploadEntered = new Promise(resolve => { markDeleteUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markDeleteUploadEntered,
        promise: new Promise(resolve => { releaseDeleteUpload = resolve; }),
    };
    const pendingDeleteWrite = globalThis.NPCState.flush();
    await deleteUploadEntered;
    const deletedPointer = globalThis.NPCState.dataFile();
    eventSource.emit('chat_deleted', 'smoke-chat');
    releaseDeleteUpload();
    await pendingDeleteWrite;
    await sleep(100);
    assert.equal(mockState.extensionSettings.npc_state.dataFiles['chat:smoke-chat'], undefined);
    assert.equal(mockState.files.has(deletedPointer.path), false);'''
new = '''    let releaseDeleteUpload;
    let markDeleteUploadEntered;
    const deleteUploadEntered = new Promise(resolve => { markDeleteUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markDeleteUploadEntered,
        promise: new Promise(resolve => { releaseDeleteUpload = resolve; }),
    };
    globalThis.NPCState.archive(persistenceTarget.id);
    const pendingDeleteWrite = globalThis.NPCState.flush();
    await deleteUploadEntered;
    const deletedPointer = globalThis.NPCState.dataFile();
    eventSource.emit('chat_deleted', 'smoke-chat');
    releaseDeleteUpload();
    await pendingDeleteWrite;
    await sleep(100);
    assert.equal(mockState.extensionSettings.npc_state.dataFiles['chat:megumin.png:smoke-chat'], undefined);
    assert.equal(mockState.files.has(deletedPointer.path), false);'''
if old not in text:
    raise SystemExit('delete race block not found')
text = text.replace(old, new, 1)

path.write_text(text)
Path(__file__).unlink()
print('v0.2.17 critical-persistence race tests updated')
