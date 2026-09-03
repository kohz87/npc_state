/* NPC State v0.3.1 manual Scan/Refresh feedback.
   This bridge runs after the normal button handler has received the click, so it
   never owns the operation itself. It only mirrors the engine's existing busy
   state into a persistent toast and an obvious busy button state. */

const SCAN_SELECTOR = '#npc_state_v3_scan_now';
const REFRESH_SELECTOR = '.npc-state-v3-refresh';
const POLL_MS = 80;
const START_GRACE_MS = 320;

let started = false;
const activeButtons = new WeakSet();

function npcNameFor(button) {
    const id = String(button?.dataset?.npcId || '').trim();
    if (!id) return '';
    try {
        const state = globalThis.NPCState?.getState?.();
        return String(state?.npcs?.find?.(npc => npc?.id === id)?.name || '').trim();
    } catch {
        return '';
    }
}

function beginProgressToast(message) {
    const toastr = globalThis.toastr;
    if (typeof toastr?.info !== 'function') return () => {};
    try {
        const toast = toastr.info(message, undefined, {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            closeButton: false,
            progressBar: false,
        });
        return () => {
            try {
                if (toast && typeof toastr.clear === 'function') toastr.clear(toast);
                else toast?.remove?.();
            } catch {
                // A missing/removed toast must never affect the underlying scan.
            }
        };
    } catch {
        try { toastr.info(message); } catch { /* feedback is best-effort */ }
        return () => {};
    }
}

function markButtonBusy(button, label) {
    if (!button) return () => {};
    const originalHtml = button.innerHTML;
    const originalAriaBusy = button.getAttribute?.('aria-busy');
    button.disabled = true;
    button.setAttribute?.('aria-busy', 'true');
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${label}</span>`;
    return () => {
        if (!button.isConnected) return;
        button.innerHTML = originalHtml;
        // A button that emitted this click was enabled before the authoritative
        // target handler ran. Refresh itself may disable it before bubble phase,
        // so do not preserve that transient disabled snapshot.
        button.disabled = false;
        if (originalAriaBusy == null) button.removeAttribute?.('aria-busy');
        else button.setAttribute?.('aria-busy', originalAriaBusy);
    };
}

function engineBusy() {
    try { return Boolean(globalThis.NPCState?.isBusy?.()); }
    catch { return false; }
}

function finishWhenIdle({ startedAt, restoreButton, clearToast, button }) {
    let sawBusy = false;
    const check = () => {
        const busy = engineBusy();
        sawBusy ||= busy;
        const elapsed = Date.now() - startedAt;
        if (!busy && (sawBusy || elapsed >= START_GRACE_MS)) {
            clearToast();
            restoreButton();
            activeButtons.delete(button);
            return;
        }
        setTimeout(check, POLL_MS);
    };
    setTimeout(check, POLL_MS);
}

function beginFeedback(button, kind) {
    if (!button || activeButtons.has(button)) return false;
    activeButtons.add(button);

    const isScan = kind === 'scan';
    const npcName = isScan ? '' : npcNameFor(button);
    const message = isScan
        ? 'NPC State: scanning current cast...'
        : `NPC State: refreshing ${npcName ? `${npcName} ` : ''}dossier...`;
    const label = isScan ? 'Scanning...' : 'Refreshing...';
    const restoreButton = markButtonBusy(button, label);
    const clearToast = beginProgressToast(message);
    finishWhenIdle({ startedAt: Date.now(), restoreButton, clearToast, button });
    return true;
}

function onDocumentClick(event) {
    const target = event.target;
    if (!target?.closest) return;
    const scanButton = target.closest(SCAN_SELECTOR);
    if (scanButton) {
        beginFeedback(scanButton, 'scan');
        return;
    }
    const refreshButton = target.closest(REFRESH_SELECTOR);
    if (refreshButton) beginFeedback(refreshButton, 'refresh');
}

export function startManualOperationFeedback() {
    if (started || !globalThis.document?.addEventListener) return false;
    started = true;
    // Bubble phase is deliberate: the authoritative ui.js target listener starts
    // the scan/refresh first. This bridge only adds feedback afterward.
    globalThis.document.addEventListener('click', onDocumentClick, false);
    return true;
}

export function stopManualOperationFeedback() {
    if (!started) return false;
    globalThis.document?.removeEventListener?.('click', onDocumentClick, false);
    started = false;
    return true;
}
