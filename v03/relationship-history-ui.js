import { extension_settings, getContext } from '../../../../extensions.js';
import {
    RELATIONSHIP_HISTORY_DEFAULT,
    RELATIONSHIP_HISTORY_MAX,
    RELATIONSHIP_HISTORY_MIN,
    normalizeRelationshipHistoryLimit,
} from './relationship-policy.js';

const INPUT_ID = 'npc_state_v3_relationship_history_limit';
let observer = null;
let started = false;
let scheduled = false;

function settings() {
    let root = extension_settings.npc_state;
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
        root = {};
        extension_settings.npc_state = root;
    }
    if (!root.v3 || typeof root.v3 !== 'object' || Array.isArray(root.v3)) root.v3 = {};
    if (root.v3.relationshipHistoryLimit === undefined) root.v3.relationshipHistoryLimit = RELATIONSHIP_HISTORY_DEFAULT;
    root.v3.relationshipHistoryLimit = normalizeRelationshipHistoryLimit(root.v3.relationshipHistoryLimit);
    return root.v3;
}

function persistSettings() {
    try { getContext()?.saveSettingsDebounced?.(); }
    catch (error) { console.debug('[NPC State v0.3] relationship history setting persistence deferred', error); }
}

function ensureSettingRow() {
    const grid = globalThis.document?.querySelector?.('#npc_state_settings .npc-state-v3-dossier-evolution > .npc-state-settings-grid');
    if (!grid) return false;
    let input = globalThis.document.getElementById(INPUT_ID);
    if (!input) {
        const row = globalThis.document.createElement('label');
        row.className = 'npc-state-setting-row npc-state-v3-relationship-history-setting';
        row.innerHTML = `<span><b>Relationship history</b><small>Recent score-change events kept in the dossier. Oldest entries rotate out first.</small></span><input id="${INPUT_ID}" class="text_pole npc-state-number" type="number" min="${RELATIONSHIP_HISTORY_MIN}" max="${RELATIONSHIP_HISTORY_MAX}">`;
        grid.appendChild(row);
        input = row.querySelector(`#${INPUT_ID}`);
        input?.addEventListener('change', event => {
            const next = normalizeRelationshipHistoryLimit(event.target.value);
            settings().relationshipHistoryLimit = next;
            event.target.value = String(next);
            persistSettings();
            applyVisibleLimit();
        });
    }
    if (input) input.value = String(settings().relationshipHistoryLimit);
    return Boolean(input);
}

function applyVisibleLimit() {
    const limit = settings().relationshipHistoryLimit;
    for (const list of globalThis.document?.querySelectorAll?.('.npc-state-v3-history-list') || []) {
        [...list.children].forEach((row, index) => { row.hidden = index >= limit; });
    }
}

function apply() {
    ensureSettingRow();
    applyVisibleLimit();
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    schedule(() => {
        scheduled = false;
        apply();
    });
}

function relevantMutation(records = []) {
    for (const record of records) {
        const target = record?.target;
        if (target?.closest?.('#npc_state_settings, #npc_state_v3_library_overlay')) return true;
        for (const node of record?.addedNodes || []) {
            if (node?.id === 'npc_state_settings' || node?.id === 'npc_state_v3_library_overlay') return true;
            if (node?.querySelector?.('#npc_state_settings, #npc_state_v3_library_overlay, .npc-state-v3-history-list')) return true;
        }
    }
    return false;
}

export function startRelationshipHistoryUi() {
    if (started || !globalThis.document?.body) return false;
    started = true;
    settings();
    scheduleApply();
    if (typeof globalThis.MutationObserver === 'function') {
        observer = new globalThis.MutationObserver(records => {
            if (relevantMutation(records)) scheduleApply();
        });
        observer.observe(globalThis.document.body, { childList: true, subtree: true });
    }
    return true;
}

export function stopRelationshipHistoryUi() {
    if (!started) return false;
    observer?.disconnect?.();
    observer = null;
    scheduled = false;
    started = false;
    return true;
}
