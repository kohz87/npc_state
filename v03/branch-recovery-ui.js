const PANEL_ID = 'npc_state_settings';
const BANNER_ID = 'npc_state_v3_branch_recovery';
let started = false;
let observer = null;
let scheduled = false;
let running = false;

function state() {
    try { return globalThis.NPCState?.getState?.() || null; }
    catch { return null; }
}

export function branchRecoveryRequired(value = state()) {
    return Boolean(value?.branchSafety && value.branchSafety.status !== 'safe');
}

function messageForKind(kind = '') {
    if (kind === 'prebaseline-truncation') return 'The chat was shortened beyond NPC State\'s oldest recoverable checkpoint.';
    if (kind === 'prebaseline-rewrite') return 'The chat was rewritten before NPC State\'s oldest recoverable checkpoint.';
    return 'The current chat is outside NPC State\'s oldest recoverable checkpoint.';
}

function ensureStyles() {
    if (globalThis.document?.getElementById?.('npc_state_v3_branch_recovery_style')) return;
    const style = globalThis.document?.createElement?.('style');
    if (!style) return;
    style.id = 'npc_state_v3_branch_recovery_style';
    style.textContent = `
#${BANNER_ID}{margin:0 0 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--SmartThemeQuoteColor,#d59a32) 58%,transparent);border-radius:10px;background:color-mix(in srgb,var(--SmartThemeQuoteColor,#d59a32) 9%,transparent);display:grid;gap:7px}
#${BANNER_ID} b{font-size:.95em}#${BANNER_ID} small{line-height:1.35;opacity:.82}#${BANNER_ID} .npc-state-v3-branch-recovery-actions{display:flex;gap:8px;flex-wrap:wrap}
#${BANNER_ID} button{margin:0}#${BANNER_ID}[data-running="1"] button{opacity:.65;pointer-events:none}`;
    globalThis.document.head?.appendChild?.(style);
}

function hostForBanner() {
    const panel = globalThis.document?.getElementById?.(PANEL_ID);
    return panel?.querySelector?.('.npc-state-v3-tracking-section') || panel?.querySelector?.('.npc-state-drawer') || null;
}

async function rebaseCurrentChat() {
    if (running) return;
    const current = state();
    if (!branchRecoveryRequired(current)) return render();
    const accepted = globalThis.confirm?.(
        'Rebase NPC State to the current chat timeline?\n\n' +
        'This preserves durable dossiers, portraits, relationships, memories, manual locks, archives, social ties, and deletion tombstones. It clears live presence, chat-local message references, and incompatible branch checkpoints, then scans the latest surviving assistant exchange.\n\n' +
        'Facts learned only from deleted messages may remain until later scans revise them or you edit the dossier manually.'
    );
    if (!accepted) return;
    running = true;
    render();
    const toast = globalThis.toastr?.info?.('NPC State: rebasing to the current chat timeline...', '', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const result = await globalThis.NPCState?.reconcile?.({ rebase: true, rescan: true });
        if (!result?.ok) throw new Error(result?.reason || 'rebase failed');
        if (result.rescan?.ok) globalThis.toastr?.success?.('NPC State: timeline rebased and the latest surviving exchange was scanned.');
        else globalThis.toastr?.success?.('NPC State: timeline rebased. No surviving assistant exchange needed a scan.');
    } catch (error) {
        console.error('[NPC State v0.3.2] timeline rebase failed safely', error);
        globalThis.toastr?.error?.(`NPC State: timeline rebase failed without replacing your durable dossiers. ${error?.message || error}`);
    } finally {
        running = false;
        if (toast && globalThis.toastr?.clear) globalThis.toastr.clear(toast);
        render();
    }
}

export function renderBranchRecoveryUi() {
    ensureStyles();
    const host = hostForBanner();
    const current = state();
    const existing = globalThis.document?.getElementById?.(BANNER_ID);
    if (!host || !branchRecoveryRequired(current)) {
        existing?.remove?.();
        return false;
    }
    const kind = String(current.branchSafety?.kind || '');
    let banner = existing;
    if (!banner) {
        banner = globalThis.document.createElement('div');
        banner.id = BANNER_ID;
        const heading = host.querySelector?.('.npc-state-v3-settings-card-title');
        if (heading?.nextSibling) host.insertBefore(banner, heading.nextSibling);
        else host.prepend?.(banner);
    }
    banner.dataset.running = running ? '1' : '0';
    banner.innerHTML = `<b>Timeline rebase required</b><small>${messageForKind(kind)} Durable dossiers are intact. Rebase only if the remaining chat is now the canon you want to keep.</small><div class="npc-state-v3-branch-recovery-actions"><button type="button" class="menu_button npc-state-v3-rebase-current"><i class="fa-solid fa-code-branch"></i> ${running ? 'Rebasing...' : 'Rebase to current chat'}</button></div>`;
    banner.querySelector('.npc-state-v3-rebase-current')?.addEventListener('click', rebaseCurrentChat);
    return true;
}

function render() { return renderBranchRecoveryUi(); }

function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    schedule(() => { scheduled = false; render(); });
}

function touchesPanel(records = []) {
    const panel = globalThis.document?.getElementById?.(PANEL_ID);
    for (const record of records) {
        if (panel && (record.target === panel || panel.contains?.(record.target))) return true;
        for (const node of record.addedNodes || []) if (node?.id === PANEL_ID || node?.querySelector?.(`#${PANEL_ID}`)) return true;
    }
    return false;
}

export function startBranchRecoveryUi() {
    if (started || !globalThis.document?.addEventListener) return false;
    started = true;
    scheduleRender();
    if (typeof globalThis.MutationObserver === 'function' && globalThis.document.body) {
        observer = new globalThis.MutationObserver(records => { if (touchesPanel(records)) scheduleRender(); });
        observer.observe(globalThis.document.body, { childList: true, subtree: true });
    }
    return true;
}

export function stopBranchRecoveryUi() {
    observer?.disconnect?.();
    observer = null;
    started = false;
    scheduled = false;
    return true;
}
