/* NPC State v0.3 dossier/editor surface coordinator.
   Some mobile browsers composite overlapping fixed + backdrop-filter surfaces
   unreliably. The dossier library and editor therefore never remain mounted
   together during an Edit transition. The existing ui.js Edit handler remains
   authoritative for constructing/saving the editor. */

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

function scheduleLibraryReturn({ errorMessage = '' } = {}) {
    if (!pendingReturn) return false;
    const returning = pendingReturn;
    pendingReturn = null;
    editorSeen = false;
    clearMountTimer();
    clearRestoreTimer();

    if (errorMessage) notify('error', errorMessage);

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

function watchEditorState() {
    if (!pendingReturn || !globalThis.document) return;
    const editor = globalThis.document.getElementById(EDITOR_ID);
    if (editor) {
        editorSeen = true;
        clearMountTimer();
        return;
    }
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
    pendingReturn = { npcId, chatKey: currentChatKey() };
    editorSeen = false;

    /* Capture phase runs before ui.js's button listener. Removing the library
       here prevents overlapping fixed/backdrop-filter compositor layers while
       the already-bound target listener continues the same click dispatch and
       calls openEditor(npcId). */
    removeLibrarySurface(library);

    mountTimer = setTimeout(() => {
        mountTimer = null;
        const editor = globalThis.document?.getElementById?.(EDITOR_ID);
        if (editor) {
            editorSeen = true;
            return;
        }
        scheduleLibraryReturn({
            errorMessage: 'NPC State: the dossier editor did not mount. The dossier was restored instead of failing silently.',
        });
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
