/* NPC State v0.3.2 responsive settings layout coordinator.
   This module only reorganizes existing settings DOM. It moves live nodes rather
   than recreating controls, so the authoritative listeners owned by ui.js and the
   feature modules stay attached. */

const PANEL_ID = 'npc_state_settings';
const SCANNER_GROUP_ID = 'npc_state_v3_scanner_rules';
const MAINTENANCE_GROUP_ID = 'npc_state_v3_maintenance';
const CAST_SECTION_ID = 'npc_state_v3_cast_settings';

let started = false;
let observer = null;
let scheduled = false;

function makeElement(tag, className = '', text = '') {
    const node = globalThis.document?.createElement?.(tag);
    if (!node) return null;
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function directChild(root, selector) {
    return [...(root?.children || [])].find(node => node.matches?.(selector)) || null;
}

function ensureHeader(panel) {
    const header = panel?.querySelector?.('.inline-drawer-header');
    if (!header) return null;
    header.classList.add('npc-state-v3-responsive-header');

    let subtitle = header.querySelector('.npc-state-v3-header-subtitle');
    if (!subtitle) {
        subtitle = makeElement('small', 'npc-state-v3-header-subtitle', 'Persistent NPC memory & relationship tracker');
        const icon = header.querySelector('.inline-drawer-icon');
        if (subtitle) header.insertBefore(subtitle, icon || null);
    }

    const enableInput = panel.querySelector('#npc_state_v3_enabled');
    let status = header.querySelector('.npc-state-v3-header-status');
    if (enableInput && !status) {
        const originalRow = enableInput.closest?.('.npc-state-setting-row');
        status = makeElement('label', 'npc-state-v3-header-status');
        if (status) {
            status.title = 'Enable or disable automatic NPC State scanning and injection';
            enableInput.setAttribute('aria-label', 'Enable NPC State');
            status.appendChild(enableInput);
            const dot = makeElement('span', 'npc-state-v3-header-status-dot');
            const text = makeElement('span', 'npc-state-v3-header-status-text');
            const enabled = makeElement('span', 'npc-state-v3-header-status-enabled', 'Enabled');
            const disabled = makeElement('span', 'npc-state-v3-header-status-disabled', 'Disabled');
            if (dot) status.appendChild(dot);
            if (text) {
                if (enabled) text.appendChild(enabled);
                if (disabled) text.appendChild(disabled);
                status.appendChild(text);
            }
            status.addEventListener('click', event => event.stopPropagation());
            const icon = header.querySelector('.inline-drawer-icon');
            header.insertBefore(status, icon || null);
            originalRow?.remove?.();
        }
    }
    return header;
}

function ensureTracking(drawer) {
    let section = drawer?.querySelector?.('.npc-state-v3-tracking-section');
    if (section) return section;
    const grid = directChild(drawer, '.npc-state-settings-grid');
    if (!grid) return null;
    section = makeElement('section', 'npc-state-v3-tracking-section npc-state-v3-settings-card');
    const heading = makeElement('h3', 'npc-state-v3-settings-card-title', 'Tracking');
    if (!section) return null;
    grid.classList.add('npc-state-v3-tracking-grid');
    grid.before(section);
    if (heading) section.appendChild(heading);
    section.appendChild(grid);
    return section;
}

function ensureDossierEvolution(drawer) {
    const section = drawer?.querySelector?.('.npc-state-v3-dossier-evolution');
    if (!section) return null;
    section.classList.add('npc-state-v3-settings-card', 'npc-state-v3-evolution-card');
    if (!section.dataset.npcStateResponsiveDefault) {
        section.open = true;
        section.dataset.npcStateResponsiveDefault = '1';
        const intro = section.querySelector('.npc-state-intro');
        if (intro) intro.textContent = 'Entries evolve as canon changes. Lower caps apply when that collection is next curated or manually saved.';
    }
    return section;
}

function ensureParentDetails(drawer, id, title, className) {
    let group = globalThis.document?.getElementById?.(id);
    if (group) return group;
    group = makeElement('details', `npc-state-v3-settings-group npc-state-v3-settings-card ${className}`);
    if (!group) return null;
    group.id = id;
    const summary = makeElement('summary');
    const label = makeElement('b', '', title);
    const body = makeElement('div', 'npc-state-v3-settings-group-body');
    if (summary && label) summary.appendChild(label);
    if (summary) group.appendChild(summary);
    if (body) group.appendChild(body);
    drawer?.appendChild?.(group);
    return group;
}

function ensureScannerRules(drawer) {
    const relationship = drawer?.querySelector?.('#npc_state_v3_relationship_criteria')?.closest?.('details') || null;
    const memory = drawer?.querySelector?.('#npc_state_v3_memory_criteria')?.closest?.('details') || null;
    if (!relationship && !memory) return globalThis.document?.getElementById?.(SCANNER_GROUP_ID) || null;
    const group = ensureParentDetails(drawer, SCANNER_GROUP_ID, 'Scanner rules', 'npc-state-v3-scanner-rules');
    const body = group?.querySelector?.('.npc-state-v3-settings-group-body');
    if (!body) return group;
    for (const section of [relationship, memory]) {
        if (section && section.parentElement !== body) body.appendChild(section);
    }
    return group;
}

function ensureMaintenance(drawer) {
    const stale = globalThis.document?.getElementById?.('npc_state_v3_stale_management') || null;
    const bundle = globalThis.document?.getElementById?.('npc_state_v3_bundle_management') || null;
    let group = globalThis.document?.getElementById?.(MAINTENANCE_GROUP_ID) || null;
    if (!stale && !bundle && !group) return null;
    group ||= ensureParentDetails(drawer, MAINTENANCE_GROUP_ID, 'Maintenance', 'npc-state-v3-maintenance-group');
    const body = group?.querySelector?.('.npc-state-v3-settings-group-body');
    if (!body) return group;
    for (const section of [stale, bundle]) {
        if (section && section.parentElement !== body) body.appendChild(section);
    }
    return group;
}

function ensurePortrait(drawer) {
    const section = globalThis.document?.getElementById?.('npc_state_v3_portrait_prompt') || null;
    if (!section) return null;
    section.classList.add('npc-state-v3-settings-card', 'npc-state-v3-portrait-group');
    const label = section.querySelector('summary b');
    if (label && label.textContent !== 'Portraits') label.textContent = 'Portraits';
    return section;
}

function ensureCast(drawer) {
    const holder = globalThis.document?.getElementById?.('npc_state_v3_roster_summary') || null;
    if (!holder) return null;
    let section = globalThis.document?.getElementById?.(CAST_SECTION_ID) || null;
    if (!section) {
        section = makeElement('section', 'npc-state-v3-cast-section npc-state-v3-settings-card');
        if (!section) return null;
        section.id = CAST_SECTION_ID;
        const heading = makeElement('h3', 'npc-state-v3-settings-card-title', 'Cast');
        holder.before(section);
        if (heading) section.appendChild(heading);
        section.appendChild(holder);
    } else if (holder.parentElement !== section) {
        section.appendChild(holder);
    }
    return section;
}

function decorateActions(drawer) {
    const actions = drawer?.querySelector?.('#npc_state_v3_main_actions') || null;
    if (!actions) return null;
    actions.classList.add('npc-state-v3-primary-actions');
    const definitions = [
        ['#npc_state_v3_scan_now', 'Scan current cast', 'Scan'],
        ['#npc_state_v3_library', 'Dossier Library', 'Dossiers'],
        ['#npc_state_v3_add', 'Add NPC', 'Add'],
    ];
    for (const [selector, fullLabel, compactLabel] of definitions) {
        const button = actions.querySelector(selector);
        if (!button || button.dataset.npcStateResponsiveLabel) continue;
        button.dataset.npcStateResponsiveLabel = '1';
        button.setAttribute('aria-label', fullLabel);
        const icon = button.querySelector('i');
        const iconHtml = icon?.outerHTML || '';
        button.innerHTML = `${iconHtml}<span class="npc-state-v3-action-full">${fullLabel}</span><span class="npc-state-v3-action-compact">${compactLabel}</span>`;
    }
    return actions;
}

function placeAfter(anchor, node, drawer) {
    if (!node || !drawer || node.parentElement !== drawer) return anchor;
    if (!anchor) {
        if (drawer.firstElementChild !== node) drawer.prepend(node);
    } else if (anchor.nextElementSibling !== node) {
        anchor.after(node);
    }
    return node;
}

export function applySettingsLayout() {
    const panel = globalThis.document?.getElementById?.(PANEL_ID);
    const drawer = panel?.querySelector?.('.npc-state-drawer');
    if (!panel || !drawer) return false;

    ensureHeader(panel);
    const intro = directChild(drawer, '.npc-state-intro');
    const actions = decorateActions(drawer);
    const tracking = ensureTracking(drawer);
    const evolution = ensureDossierEvolution(drawer);
    const scanner = ensureScannerRules(drawer);
    const maintenance = ensureMaintenance(drawer);
    const portrait = ensurePortrait(drawer);
    const cast = ensureCast(drawer);

    let anchor = intro;
    for (const node of [actions, tracking, evolution, scanner, maintenance, portrait, cast]) {
        anchor = placeAfter(anchor, node, drawer) || anchor;
    }
    panel.classList.add('npc-state-v3-responsive-settings-ready');
    return true;
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    schedule(() => {
        scheduled = false;
        applySettingsLayout();
    });
}

function mutationTouchesSettings(records = []) {
    const panel = globalThis.document?.getElementById?.(PANEL_ID) || null;
    for (const record of records) {
        const target = record?.target;
        if (panel && (target === panel || panel.contains?.(target))) return true;
        for (const node of record?.addedNodes || []) {
            if (node?.id === PANEL_ID || node?.querySelector?.(`#${PANEL_ID}`)) return true;
        }
    }
    return false;
}

export function startSettingsLayoutCoordinator() {
    if (started || !globalThis.document?.addEventListener) return false;
    started = true;
    scheduleApply();
    if (typeof globalThis.MutationObserver === 'function' && globalThis.document.body) {
        observer = new globalThis.MutationObserver(records => {
            if (mutationTouchesSettings(records)) scheduleApply();
        });
        observer.observe(globalThis.document.body, { childList: true, subtree: true });
    }
    return true;
}

export function stopSettingsLayoutCoordinator() {
    if (!started) return false;
    observer?.disconnect?.();
    observer = null;
    scheduled = false;
    started = false;
    return true;
}
