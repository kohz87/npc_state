const EDITOR_ID = 'npc_state_v3_editor_overlay';
let started = false;

/**
 * Promote the already-mounted dossier editor into the browser top layer.
 * This preserves the editor DOM and all listeners owned by ui.js.
 */
export function promoteEditorToTopLayer(doc = globalThis.document) {
    const overlay = doc?.getElementById?.(EDITOR_ID);
    if (!overlay) return false;
    if (typeof overlay.showPopover !== 'function') return false;

    try {
        if (overlay.matches?.(':popover-open')) return true;
        overlay.setAttribute('popover', 'manual');
        overlay.showPopover();
        overlay.dataset.npcStateTopLayer = 'popover';
        return true;
    } catch (error) {
        overlay.removeAttribute?.('popover');
        console.warn('[NPC State v0.3] Could not promote dossier editor to the browser top layer.', error);
        return false;
    }
}

/**
 * ui.js creates the editor synchronously in the Edit button handler.
 * A delegated bubble-phase listener therefore runs after that handler, then
 * defers one microtask before promoting the mounted editor. It never prevents,
 * captures, removes, or recreates the Edit click or editor DOM.
 */
export function startEditorTopLayerBridge(doc = globalThis.document) {
    if (started || !doc?.addEventListener) return false;
    started = true;

    doc.addEventListener('click', event => {
        if (!event.target?.closest?.('.npc-state-v3-edit')) return;
        const defer = globalThis.queueMicrotask || (callback => Promise.resolve().then(callback));
        defer(() => promoteEditorToTopLayer(doc));
    });

    return true;
}
