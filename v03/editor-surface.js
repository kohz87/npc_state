/* NPC State v0.3 dossier/editor surface coordinator.
   The canonical dossier and editor should not remain as overlapping fixed
   surfaces on mobile. The normal ui.js Edit handler stays authoritative: this
   coordinator waits until that handler has actually mounted the editor before
   removing the dossier surface. */

const LIBRARY_ID = 'npc_state_v3_library_overlay';
const EDITOR_ID = 'npc_state_v3_editor_overlay';
const EDIT_SELECTOR = '.npc-state-v3-edit';
const MOUNT_TIMEOUT_MS = 180;

let pendingReturn = null;
let editorSeen = false;
let mountTimer = null;
let restoreTimer = null;
let observer = null;
let started = false;

function notify(kind, message) {
    const fn = globalThis.toastr?.[kind];
    if (typeof fn === 'function') fn(message);
    else if (kind === 'error') console.error(`[NPC State v0.3] ${message}`);
}

function currentChatKey() {
    try { return String(globalThis.NPCState?.getState?.()?.chatKey || ''); }
    catch { return ''; }
}

function clearMountTimer() {
    if (mountTimer) clearTimeout(mountTimer);
    mountTimer = null;
}

function clearRestoreTimer() {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = null;
}

function removeLibrarySurface(library) {
    library?.remove?.();
    globalThis.document?.documentElement?.classList?.remove('npc-state-v3-library-open');
    globalThis.document?.body?.classList?.remove('npc-state-v3-library-open');
}

function failEditTransition() {
    clearMountTimer();
    pendingReturn = null;
    editorSeen = false;
    notify('error', 'NPC State: the dossier editor did not mount. The dossier was left open.');
}

function scheduleLibraryReturn() {
    if (!pendingReturn) return false;
    const returning = pendingReturn;
    pendingReturn = null;
    editorSeen = false;
    clearMountTimer();
    clearRestoreTimer();

    restoreTimer = setTimeout(() => {
        restoreTimer = null;
        const nowKey = currentChatKey();
        if (returning.chatKey && nowKey && returning.chatKey !== nowKey) return;
        try {
            const opened = globalThis.NPCState?.openLibrary?.(returning.npcId);
            if (opened === false) notify('error', 'NPC State: could not return to the dossier after closing the editor.');
        } catch (error) {
            console.error('[NPC State v0.3] failed to restore dossier after editor', error);
            notify('error', `NPC State: failed to restore the dossier after editing. ${error?.message || error}`);
        }
    }, 0);
    return true;
}

function confirmEditorMounted() {
    if (!pendingReturn || !globalThis.document) return false;
    const editor = globalThis.document.getElementById(EDITOR_ID);
    if (!editor) return false;
    if (!editorSeen) {
        editorSeen = true;
        clearMountTimer();
        removeLibrarySurface(pendingReturn.library);
        pendingReturn.library = null;
    }
    return true;
}

function watchEditorState() {
    if (!pendingReturn || !globalThis.document) return;
    if (confirmEditorMounted()) return;
    if (editorSeen) scheduleLibraryReturn();
}

function beginEditTransition(button) {
    const library = button?.closest?.(`#${LIBRARY_ID}`);
    if (!library || !globalThis.document?.body) return false;

    const npcId = String(button.dataset?.npcId || '').trim();
    if (!npcId) {
        notify('error', 'NPC State: Edit could not resolve this dossier identity.');
        return false;
    }

    clearMountTimer();
    clearRestoreTimer();
    pendingReturn = { npcId, chatKey: currentChatKey(), library };
    editorSeen = false;

    /* This listener runs in capture phase only to remember the intended return
       dossier. It deliberately leaves the DOM untouched so the already-bound
       ui.js target listener can receive the same click and call openEditor(). */
    mountTimer = setTimeout(() => {
        mountTimer = null;
        if (!confirmEditorMounted()) failEditTransition();
    }, MOUNT_TIMEOUT_MS);
    return true;
}

function onDocumentClickCapture(event) {
    const button = event.target?.closest?.(EDIT_SELECTOR);
    if (!button) return;
    beginEditTransition(button);
}

export function startEditorSurfaceCoordinator() {
    if (started || !globalThis.document?.addEventListener) return false;
    started = true;
    globalThis.document.addEventListener('click', onDocumentClickCapture, true);
    if (typeof globalThis.MutationObserver === 'function' && globalThis.document.body) {
        observer = new globalThis.MutationObserver(watchEditorState);
        observer.observe(globalThis.document.body, { childList: true, subtree: true });
    }
    return true;
}

export function stopEditorSurfaceCoordinator() {
    if (!started) return false;
    globalThis.document?.removeEventListener?.('click', onDocumentClickCapture, true);
    observer?.disconnect?.();
    observer = null;
    clearMountTimer();
    clearRestoreTimer();
    pendingReturn = null;
    editorSeen = false;
    started = false;
    return true;
}

startEditorSurfaceCoordinator();
