import { normalizeStaleSettings } from './stale.js';

const SECTION_ID = 'npc_state_v3_stale_management';
const REVIEW_ID = 'npc_state_v3_stale_review_overlay';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function statusText(row) {
    if (row.status === 'delete-eligible') return `Delete eligible at ${row.deleteAfter} inactive turns`;
    if (row.status === 'stale-archived') return `Stale archive · deletes at ${row.deleteAfter} inactive turns`;
    if (row.status === 'archive-eligible') return `Archive eligible at ${row.archiveAfter} inactive turns`;
    if (row.status === 'protected') return `Protected · ${row.protectionReasons.join(', ')}`;
    if (row.status === 'archived-other') return `Archived (${row.archiveReason || 'manual'}) · stale automation leaves this alone`;
    return `${row.inactiveTurns} inactive turn${row.inactiveTurns === 1 ? '' : 's'} · archives at ${row.archiveAfter}`;
}

export function createStaleManagementUi(adapters = {}) {
    const engine = adapters.engine;
    const ui = adapters.ui;
    const getSettings = adapters.getSettings;
    const persistSettings = adapters.persistSettings || (() => {});
    let mountTimer = null;

    function notify(kind, message) {
        const fn = globalThis.toastr?.[kind];
        if (typeof fn === 'function') fn(`NPC State: ${message}`);
    }

    function closeReview() { globalThis.document?.getElementById?.(REVIEW_ID)?.remove?.(); }

    function saveThresholds(panel) {
        const settings = getSettings();
        const archiveInput = panel.querySelector('#npc_state_v3_stale_archive_after');
        const deleteInput = panel.querySelector('#npc_state_v3_stale_delete_after');
        const archiveAfter = Math.max(1, Math.min(9999, Math.round(Number(archiveInput?.value) || 30)));
        const deleteAfter = Math.max(archiveAfter + 1, Math.min(10000, Math.round(Number(deleteInput?.value) || 50)));
        settings.staleArchiveAfter = archiveAfter;
        settings.staleDeleteAfter = deleteAfter;
        if (archiveInput) archiveInput.value = String(archiveAfter);
        if (deleteInput) deleteInput.value = String(deleteAfter);
        persistSettings();
        refresh();
    }

    function sectionHtml() {
        return `<details id="${SECTION_ID}" class="npc-state-v3-stale-settings">
          <summary><b>Stale NPC management</b></summary>
          <div class="npc-state-v3-stale-settings-body">
            <label class="npc-state-setting-row"><span><b>Automatic stale lifecycle</b><small>Tracks narrative inactivity. Off-screen alone is never enough; current interaction, physical presence, world activity, or an explicit name/alias reference resets the timer.</small></span><input id="npc_state_v3_stale_enabled" type="checkbox"></label>
            <div class="npc-state-v3-stale-thresholds">
              <label><span>Archive after</span><input id="npc_state_v3_stale_archive_after" class="text_pole npc-state-number" type="number" min="1" max="9999"><small>inactive assistant turns</small></label>
              <label><span>Delete after</span><input id="npc_state_v3_stale_delete_after" class="text_pole npc-state-number" type="number" min="2" max="10000"><small>total inactive assistant turns</small></label>
            </div>
            <small class="npc-state-muted">Retention-protected dossiers and dossiers with manual profile locks are never auto-archived or auto-deleted. Automatic stale deletion does not create a permanent tombstone.</small>
            <div class="npc-state-actions"><button id="npc_state_v3_stale_review" class="menu_button"><i class="fa-solid fa-box-archive"></i> Review stale NPCs</button></div>
            <div id="npc_state_v3_stale_summary" class="npc-state-muted"></div>
          </div>
        </details>`;
    }

    function attach() {
        if (globalThis.document?.getElementById?.(SECTION_ID)) return true;
        const panel = globalThis.document?.getElementById?.('npc_state_settings');
        const drawer = panel?.querySelector?.('.npc-state-drawer');
        if (!drawer) return false;
        const wrapper = globalThis.document.createElement('div');
        wrapper.innerHTML = sectionHtml();
        const section = wrapper.firstElementChild;
        const actions = drawer.querySelector('#npc_state_v3_main_actions');
        if (actions?.before) actions.before(section);
        else drawer.appendChild(section);
        section.querySelector('#npc_state_v3_stale_enabled')?.addEventListener('change', event => {
            getSettings().staleManagementEnabled = Boolean(event.target.checked);
            persistSettings();
            refresh();
        });
        section.querySelector('#npc_state_v3_stale_archive_after')?.addEventListener('change', () => saveThresholds(section));
        section.querySelector('#npc_state_v3_stale_delete_after')?.addEventListener('change', () => saveThresholds(section));
        section.querySelector('#npc_state_v3_stale_review')?.addEventListener('click', openReview);
        sync();
        return true;
    }

    function sync() {
        const section = globalThis.document?.getElementById?.(SECTION_ID);
        if (!section) return;
        const settings = normalizeStaleSettings(getSettings());
        const enabled = section.querySelector('#npc_state_v3_stale_enabled');
        const archiveAfter = section.querySelector('#npc_state_v3_stale_archive_after');
        const deleteAfter = section.querySelector('#npc_state_v3_stale_delete_after');
        if (enabled) enabled.checked = settings.enabled;
        if (archiveAfter) archiveAfter.value = String(settings.archiveAfter);
        if (deleteAfter) deleteAfter.value = String(settings.deleteAfter);
        const report = engine.getStaleReport?.() || [];
        const stale = report.filter(row => row.status === 'stale-archived' || row.status === 'archive-eligible' || row.status === 'delete-eligible').length;
        const protectedCount = report.filter(row => row.status === 'protected').length;
        const summary = section.querySelector('#npc_state_v3_stale_summary');
        if (summary) summary.textContent = `${report.length} tracked · ${stale} stale/eligible · ${protectedCount} protected`;
    }

    function rowHtml(row) {
        const protectedByRetention = row.protectionReasons.includes('retention-protected');
        const profileLocked = row.protectionReasons.includes('profile-locked');
        return `<article class="npc-state-v3-stale-row" data-npc-id="${escapeHtml(row.npcId)}">
          <div class="npc-state-v3-stale-row-main"><b>${escapeHtml(row.name)}</b><span>${escapeHtml(statusText(row))}</span><small>Last activity: ${escapeHtml(row.lastActivityReason || 'baseline')} · inactive ${row.inactiveTurns} turn${row.inactiveTurns === 1 ? '' : 's'}</small></div>
          <div class="npc-state-v3-stale-row-actions">
            <button class="menu_button npc-state-v3-stale-open">Open dossier</button>
            <button class="menu_button npc-state-v3-stale-reset">Reset activity</button>
            <button class="menu_button npc-state-v3-stale-protect">${protectedByRetention ? 'Unprotect' : 'Protect'}</button>
            <button class="menu_button npc-state-v3-stale-archive">${row.archived ? 'Restore' : 'Archive'}</button>
            <button class="menu_button redWarningBG npc-state-v3-stale-delete">Delete</button>
          </div>
          ${profileLocked ? '<small class="npc-state-v3-stale-lock-note">Profile lock also protects this dossier from automatic stale pruning. Unlock it in the dossier editor if that is no longer desired.</small>' : ''}
        </article>`;
    }

    function renderReview() {
        const overlay = globalThis.document?.getElementById?.(REVIEW_ID);
        if (!overlay) return;
        const report = engine.getStaleReport?.() || [];
        const body = overlay.querySelector('.npc-state-v3-stale-review-list');
        if (!body) return;
        body.innerHTML = report.length ? report.map(rowHtml).join('') : '<div class="npc-state-v3-empty">No NPC dossiers are currently tracked.</div>';
        const renderedRows = [...body.querySelectorAll('.npc-state-v3-stale-row')];
        for (const row of report) {
            const root = renderedRows.find(node => node.dataset?.npcId === row.npcId);
            if (!root) continue;
            root.querySelector('.npc-state-v3-stale-open')?.addEventListener('click', () => {
                closeReview();
                ui?.openLibrary?.(row.npcId);
            });
            root.querySelector('.npc-state-v3-stale-reset')?.addEventListener('click', async () => {
                const result = await engine.resetNpcStaleness(row.npcId);
                if (result.ok) notify('success', `${row.name}'s inactivity timer was reset.`);
                refresh();
            });
            root.querySelector('.npc-state-v3-stale-protect')?.addEventListener('click', async () => {
                const protectedByRetention = row.protectionReasons.includes('retention-protected');
                const result = await engine.updateNpc(row.npcId, { retentionProtected: !protectedByRetention });
                if (result.ok) notify('success', `${row.name} is ${protectedByRetention ? 'no longer retention-protected' : 'retention-protected'}.`);
                refresh();
            });
            root.querySelector('.npc-state-v3-stale-archive')?.addEventListener('click', async () => {
                const result = await engine.archiveNpc(row.npcId, !row.archived, 'manual');
                if (result.ok) notify('success', `${row.name} ${row.archived ? 'restored' : 'archived manually'}.`);
                refresh();
            });
            root.querySelector('.npc-state-v3-stale-delete')?.addEventListener('click', async () => {
                if (!globalThis.confirm?.(`Delete ${row.name}? Manual deletion creates a stable tombstone so branch rollback cannot restore this identity.`)) return;
                const result = await engine.deleteNpc(row.npcId);
                if (result.ok) notify('success', `${row.name} deleted.`);
                refresh();
            });
        }
    }

    function openReview() {
        let overlay = globalThis.document?.getElementById?.(REVIEW_ID);
        if (!overlay) {
            overlay = globalThis.document.createElement('div');
            overlay.id = REVIEW_ID;
            overlay.className = 'npc-state-v3-library-overlay npc-state-v3-stale-review-overlay';
            overlay.innerHTML = `<div class="npc-state-v3-library-shell npc-state-v3-stale-review-shell" role="dialog" aria-modal="true"><header><div><span class="npc-state-kicker">STALE NPC REVIEW</span><h2>Narrative inactivity</h2></div><button class="npc-state-v3-stale-review-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header><div class="npc-state-v3-stale-review-help">Off-screen status alone does not age a dossier into deletion. The timer resets when an NPC interacts, remains physically present, is explicitly world-active, or is referenced by canonical name/alias in the current exchange. Automatic stale archives have a review window before the delete threshold.</div><div class="npc-state-v3-stale-review-list"></div></div>`;
            overlay.addEventListener('click', event => {
                if (event.target === overlay || event.target.closest?.('.npc-state-v3-stale-review-close')) closeReview();
            });
            globalThis.document.body.appendChild(overlay);
        }
        renderReview();
        return true;
    }

    function refresh() {
        if (!attach()) return false;
        sync();
        if (globalThis.document?.getElementById?.(REVIEW_ID)) renderReview();
        return true;
    }

    function scheduleMount() {
        if (attach()) return true;
        if (mountTimer) return false;
        let attempts = 0;
        mountTimer = setInterval(() => {
            attempts += 1;
            if (attach() || attempts >= 40) {
                clearInterval(mountTimer);
                mountTimer = null;
            }
        }, 500);
        mountTimer?.unref?.();
        return false;
    }

    return Object.freeze({ scheduleMount, refresh, openReview, closeReview });
}
