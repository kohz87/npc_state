import { DEFAULT_RELATIONSHIP_CAPS, findNpcByReference } from './schema.js';

const SETTINGS_ID = 'npc_state_settings';
const LIBRARY_ID = 'npc_state_v3_library_overlay';
const EDITOR_ID = 'npc_state_v3_editor_overlay';
const INLINE_ID = 'npc_state_v3_inline';


export function chooseLibrarySelection(rows = [], selectedId = '') {
    const id = String(selectedId || '');
    return rows.some(npc => npc?.id === id) ? id : (rows[0]?.id || '');
}

export function editorIdentityMatches(activeId, shellId) {
    const active = String(activeId || '');
    const shell = String(shellId || '');
    return Boolean(active && shell && active === shell);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function splitLines(value, max = 12) {
    return [...new Set(String(value || '').split(/\r?\n|\s*;\s*/).map(item => item.trim()).filter(Boolean))].slice(0, max);
}

function latestAssistantMessageId(chat = []) {
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (message && !message.is_system && !message.is_user) return i;
    }
    return -1;
}

function messageElement(messageId) {
    if (!Number.isInteger(messageId) || messageId < 0) return null;
    const selectors = [
        `#chat .mes[mesid="${messageId}"]`, `.mes[mesid="${messageId}"]`,
        `#chat .mes[data-mesid="${messageId}"]`, `.mes[data-mesid="${messageId}"]`,
        `#chat .mes[data-message-id="${messageId}"]`, `.mes[data-message-id="${messageId}"]`,
    ];
    for (const selector of selectors) {
        const found = document.querySelector?.(selector);
        if (found) return found;
    }
    return null;
}

function statusLabel(npc) {
    if (npc.archived) return npc.archiveReason === 'deceased' ? 'Archived · deceased' : 'Archived';
    if (npc.present) return 'Present';
    if (npc.worldActive) return 'Active off-screen';
    return 'Off-screen';
}

function listHtml(items, empty = 'None established.') {
    return items?.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<span class="npc-state-muted">${escapeHtml(empty)}</span>`;
}

function dossierHtml(npc) {
    if (!npc) return '<div class="npc-state-v3-empty">Select a dossier.</div>';
    const rel = npc.relationship || {};
    const portrait = npc.portrait?.dataUrl
        ? `<img class="npc-state-v3-portrait" src="${escapeHtml(npc.portrait.dataUrl)}" alt="${escapeHtml(npc.name)} portrait">`
        : `<div class="npc-state-v3-portrait npc-state-v3-portrait-placeholder">${escapeHtml(String(npc.name || '?').charAt(0).toUpperCase())}</div>`;
    const identity = [npc.species, npc.role, npc.age ? `Age ${npc.age}` : '', npc.apparentAge ? `Looks ${npc.apparentAge}` : ''].filter(Boolean).join(' · ');
    const history = npc.relationshipHistory?.length ? listHtml(npc.relationshipHistory.slice(-6).reverse().map(event => {
        const delta = Object.entries(event.delta || {}).filter(([, value]) => Number(value)).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`).join(', ');
        return `${event.impact}: ${delta || 'no score change'}${event.reason ? ` | ${event.reason}` : ''}`;
    })) : '<span class="npc-state-muted">No relationship change history yet.</span>';
    return `
      <article class="npc-state-v3-dossier" data-npc-id="${escapeHtml(npc.id)}">
        <header class="npc-state-v3-dossier-head">${portrait}<div><span class="npc-state-kicker">NPC DOSSIER</span><h2>${escapeHtml(npc.name)}</h2><p>${escapeHtml(identity || 'Identity not fully established')}</p><small>${escapeHtml(statusLabel(npc))}</small></div></header>
        <div class="npc-state-v3-facts"><div><b>Mood</b><span>${escapeHtml(npc.mood || 'Unknown')}</span></div><div><b>Location</b><span>${escapeHtml(npc.location || 'Unknown')}</span></div><div><b>Goal</b><span>${escapeHtml(npc.goal || 'Unknown')}</span></div><div><b>Status</b><span>${escapeHtml(npc.status || 'Unknown')}</span></div></div>
        <section><h3>Profile</h3><b>Personality</b><p>${escapeHtml(npc.personality || 'Unknown')}</p><b>Behavioral profile</b>${listHtml(npc.behaviorProfile)}<b>Speech</b><p>${escapeHtml(npc.speech || 'Unknown')}</p><b>Appearance</b><p>${escapeHtml(npc.appearance || 'Unknown')}</p><b>Mannerisms</b>${listHtml(npc.mannerisms)}</section>
        <section><h3>Relationship with player</h3><div class="npc-state-v3-rel"><span>Trust <b>${Number(rel.trust) || 0}</b></span><span>Affection <b>${Number(rel.affection) || 0}</b></span><span>Desire <b>${Number(rel.desire) || 0}</b></span><span>Tension <b>${Number(rel.tension) || 0}</b></span></div><p>${escapeHtml(npc.relationshipSummary || 'No established relationship summary.')}</p><b>Recent relationship changes</b>${history}<b>Key relationships</b>${listHtml(npc.keyRelationships)}</section>
        <section><h3>Background</h3><p>${escapeHtml(npc.background || 'Unknown')}</p></section>
        <section><h3>Important memories</h3>${listHtml(npc.memories, 'No persistent memories recorded yet.')}</section>
        <footer class="npc-state-v3-dossier-actions"><button class="menu_button npc-state-v3-edit" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-pen"></i> Edit dossier</button><button class="menu_button npc-state-v3-refresh" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-arrows-rotate"></i> Scan dossier</button><button class="menu_button npc-state-v3-archive" data-npc-id="${escapeHtml(npc.id)}">${npc.archived ? '<i class="fa-solid fa-box-open"></i> Restore' : '<i class="fa-solid fa-box-archive"></i> Archive'}</button><button class="menu_button redWarningBG npc-state-v3-delete" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-trash"></i> Delete</button></footer>
      </article>`;
}

export function createNpcStateUi(adapters = {}) {
    const engine = adapters.engine;
    const getContext = adapters.getContext;
    const getChatKey = adapters.getChatKey;
    const getSettings = adapters.getSettings;
    const persistSettings = adapters.persistSettings || (() => {});
    const onSettingsChanged = adapters.onSettingsChanged || (() => {});
    let selectedNpcId = '';
    let activeEditorNpcId = '';
    let mountTimer = null;

    function notify(kind, message) {
        const fn = globalThis.toastr?.[kind];
        if (typeof fn === 'function') fn(message);
    }

    async function safely(label, task) {
        try { return await task(); }
        catch (error) {
            console.error(`[NPC State v0.3] ${label} failed safely`, error);
            notify('error', `NPC State: ${label} failed. No partial dossier write was committed. ${error?.message || error}`);
            return { ok: false, reason: 'error', error };
        }
    }

    function state() { return engine.getState(getChatKey()); }

    function settingsHtml() {
        return `<div id="${SETTINGS_ID}" class="extension_container npc-state-extension npc-state-v3-settings">
          <div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>NPC State <span class="npc-state-version">v0.3.0</span></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
          <div class="inline-drawer-content npc-state-drawer">
            <div class="npc-state-intro">v0.3 uses one current-exchange scanner transaction. Exchange participation, strict final physical presence, and off-screen world activity are independent signals. Existing v0.2 sidecars are imported once into a separate v0.3 file and never rewritten.</div>
            <div class="npc-state-settings-grid">
              <label class="npc-state-setting-row"><span><b>Enable NPC State</b><small>Disabling stops automatic scanning and injection. Manual dossier tools remain available.</small></span><input id="npc_state_v3_enabled" type="checkbox"></label>
              <label class="npc-state-setting-row"><span><b>Auto current-cast scan</b><small>One batch scan after each assistant reply. No cast-wide backfill queue.</small></span><input id="npc_state_v3_auto" type="checkbox"></label>
              <label class="npc-state-setting-row"><span><b>Context depth</b><small>Older messages are profile/memory context only; relationship deltas remain current-exchange-only.</small></span><input id="npc_state_v3_scan_depth" class="text_pole npc-state-number" type="number" min="2" max="30"></label>
              <label class="npc-state-setting-row"><span><b>Inject present NPCs</b><small>Only strict final-scene physical presence is injected.</small></span><input id="npc_state_v3_inject" type="checkbox"></label>
              <label class="npc-state-setting-row"><span><b>Injection budget</b><small>Approximate token budget.</small></span><input id="npc_state_v3_inject_budget" class="text_pole npc-state-number" type="number" min="256" max="8000" step="100"></label>
              <label class="npc-state-setting-row"><span><b>Rescan changed branches</b><small>Restores the best v0.3 checkpoint and rescans the surviving latest exchange.</small></span><input id="npc_state_v3_branch_rescan" type="checkbox"></label>
            </div>
            <details><summary><b>Relationship evidence rubric</b></summary><textarea id="npc_state_v3_relationship_criteria" class="text_pole npc-state-rubric-textarea" rows="8"></textarea></details>
            <details><summary><b>Important memory rubric</b></summary><textarea id="npc_state_v3_memory_criteria" class="text_pole npc-state-rubric-textarea" rows="7"></textarea></details>
            <div id="npc_state_v3_main_actions" class="npc-state-actions"><button id="npc_state_v3_scan_now" class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> Scan current cast</button><button id="npc_state_v3_library" class="menu_button"><i class="fa-solid fa-address-book"></i> Dossier Library</button><button id="npc_state_v3_add" class="menu_button"><i class="fa-solid fa-user-plus"></i> Add NPC</button></div>
            <div id="npc_state_v3_roster_summary" class="npc-state-roster-summary"></div>
          </div></div></div>`;
    }

    function syncSettings() {
        const settings = getSettings();
        const panel = document.getElementById(SETTINGS_ID);
        if (!panel) return;
        panel.querySelector('#npc_state_v3_enabled').checked = settings.enabled !== false;
        panel.querySelector('#npc_state_v3_auto').checked = settings.autoScan !== false;
        panel.querySelector('#npc_state_v3_scan_depth').value = settings.scanDepth;
        panel.querySelector('#npc_state_v3_inject').checked = settings.inject !== false;
        panel.querySelector('#npc_state_v3_inject_budget').value = settings.injectBudgetTokens;
        panel.querySelector('#npc_state_v3_branch_rescan').checked = settings.branchRescan !== false;
        panel.querySelector('#npc_state_v3_relationship_criteria').value = settings.relationshipCriteria || '';
        panel.querySelector('#npc_state_v3_memory_criteria').value = settings.memoryCriteria || '';
    }

    function bindSettings(panel) {
        const bindCheck = (selector, key) => panel.querySelector(selector)?.addEventListener('change', event => {
            getSettings()[key] = Boolean(event.target.checked); persistSettings(); onSettingsChanged();
        });
        bindCheck('#npc_state_v3_enabled', 'enabled');
        bindCheck('#npc_state_v3_auto', 'autoScan');
        bindCheck('#npc_state_v3_inject', 'inject');
        bindCheck('#npc_state_v3_branch_rescan', 'branchRescan');
        panel.querySelector('#npc_state_v3_scan_depth')?.addEventListener('change', event => {
            getSettings().scanDepth = Math.max(2, Math.min(30, Math.round(Number(event.target.value) || 8))); event.target.value = getSettings().scanDepth; persistSettings();
        });
        panel.querySelector('#npc_state_v3_inject_budget')?.addEventListener('change', event => {
            getSettings().injectBudgetTokens = Math.max(256, Math.min(8000, Math.round(Number(event.target.value) || 1800))); event.target.value = getSettings().injectBudgetTokens; persistSettings(); onSettingsChanged();
        });
        for (const [selector, key] of [['#npc_state_v3_relationship_criteria', 'relationshipCriteria'], ['#npc_state_v3_memory_criteria', 'memoryCriteria']]) {
            panel.querySelector(selector)?.addEventListener('change', event => { getSettings()[key] = String(event.target.value || '').slice(0, 12000); persistSettings(); });
        }
        panel.querySelector('#npc_state_v3_scan_now')?.addEventListener('click', async () => {
            const id = latestAssistantMessageId(getContext().chat || []);
            if (id < 0) return notify('info', 'NPC State: there is no assistant message to scan yet.');
            const result = await safely('current-cast scan', () => engine.scan(id, { manual: true, force: true }));
            if (result.ok) notify('success', `NPC State: reconciled ${result.targetNpcIds?.length || 0} current-cast dossier${result.targetNpcIds?.length === 1 ? '' : 's'}.`);
            else if (!result.discarded) notify('warning', `NPC State scan did not commit: ${result.reason || 'unknown reason'}.`);
            refresh();
        });
        panel.querySelector('#npc_state_v3_library')?.addEventListener('click', () => openLibrary());
        panel.querySelector('#npc_state_v3_add')?.addEventListener('click', async () => {
            const name = globalThis.prompt?.('NPC name or unique role label:')?.trim();
            if (!name) return;
            const result = await safely('add NPC', () => engine.addNpc(name));
            if (result.ok) { selectedNpcId = result.result?.npcId || ''; notify('success', `NPC State: ${result.result?.existing ? 'opened existing' : 'added'} ${name}.`); openLibrary(selectedNpcId); }
            refresh();
        });
    }

    function attachSettings() {
        if (document.getElementById(SETTINGS_ID)) return true;
        const host = document.querySelector('#extensions_settings2, #extensions_settings, #extensionsMenu');
        if (!host) return false;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsHtml();
        const panel = wrapper.firstElementChild;
        host.appendChild(panel);
        bindSettings(panel);
        syncSettings();
        renderRoster();
        return true;
    }

    function scheduleMount() {
        if (attachSettings()) return;
        if (mountTimer) clearInterval(mountTimer);
        let attempts = 0;
        mountTimer = setInterval(() => {
            attempts += 1;
            if (attachSettings() || attempts >= 30) { clearInterval(mountTimer); mountTimer = null; }
        }, 500);
    }

    function renderRoster() {
        const holder = document.getElementById('npc_state_v3_roster_summary');
        if (!holder) return;
        const hydration = engine.hydrationStatus(getChatKey());
        if (hydration.status === 'error') {
            holder.innerHTML = `<div class="npc-state-hydration-warning"><b>Dossier load failed</b><span>${escapeHtml(hydration.error?.message || 'Unknown sidecar error. Existing data was not overwritten.')}</span></div>`;
            return;
        }
        const current = state();
        if (!current) { holder.innerHTML = '<span class="npc-state-muted">Open a chat to load its v0.3 dossier.</span>'; return; }
        const active = current.npcs.filter(npc => !npc.archived);
        const archived = current.npcs.filter(npc => npc.archived);
        const rows = list => list.map(npc => `<button class="menu_button npc-state-v3-roster-open" data-npc-id="${escapeHtml(npc.id)}">${npc.present ? '● ' : (npc.worldActive ? '◌ ' : '')}${escapeHtml(npc.name)}</button>`).join('');
        holder.innerHTML = `<small class="npc-state-muted">Persistent v0.3 database · ${active.length} active · ${archived.length} archived</small><div class="npc-state-roster-chips">${rows(active)}${rows(archived)}</div>`;
        holder.querySelectorAll('.npc-state-v3-roster-open').forEach(button => button.addEventListener('click', () => openLibrary(button.dataset.npcId)));
    }

    function filteredNpcs(query = '') {
        const current = state();
        const rows = [...(current?.npcs || [])].sort((a, b) => Number(b.present) - Number(a.present) || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
        const needle = String(query || '').trim().toLocaleLowerCase();
        if (!needle) return rows;
        return rows.filter(npc => [npc.name, npc.role, npc.species, ...(npc.aliases || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
    }

    function libraryOverlay() { return document.getElementById(LIBRARY_ID); }

    function renderLibrary() {
        const overlay = libraryOverlay();
        if (!overlay) return;
        const search = overlay.querySelector('#npc_state_v3_library_search');
        const rows = filteredNpcs(search?.value || '');
        selectedNpcId = chooseLibrarySelection(rows, selectedNpcId);
        const list = overlay.querySelector('.npc-state-v3-library-list');
        if (list) list.innerHTML = rows.length ? rows.map(npc => `<button class="npc-state-v3-library-row ${npc.id === selectedNpcId ? 'active' : ''}" data-npc-id="${escapeHtml(npc.id)}"><b>${escapeHtml(npc.name)}</b><span>${escapeHtml(npc.role || npc.species || 'NPC')}</span><small>${escapeHtml(statusLabel(npc))}</small></button>`).join('') : '<div class="npc-state-v3-empty">No dossiers match this search.</div>';
        list?.querySelectorAll('.npc-state-v3-library-row').forEach(button => button.addEventListener('click', () => { selectedNpcId = button.dataset.npcId; renderLibrary(); }));
        const detail = overlay.querySelector('.npc-state-v3-library-detail');
        const npc = rows.find(item => item.id === selectedNpcId) || null;
        if (detail) detail.innerHTML = dossierHtml(npc);
        wireDossierActions(detail);
    }

    function openLibrary(npcId = '') {
        if (npcId) selectedNpcId = String(npcId);
        let overlay = libraryOverlay();
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = LIBRARY_ID;
            overlay.className = 'npc-state-v3-library-overlay';
            overlay.innerHTML = `<div class="npc-state-v3-library-shell" role="dialog" aria-modal="true"><header><div><span class="npc-state-kicker">DOSSIER LIBRARY</span><h2>All NPCs</h2></div><button class="npc-state-v3-library-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header><div class="npc-state-v3-library-body"><aside><input id="npc_state_v3_library_search" class="text_pole" type="search" placeholder="Search name, alias, role, species"><div class="npc-state-v3-library-list"></div></aside><main class="npc-state-v3-library-detail"></main></div></div>`;
            overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest?.('.npc-state-v3-library-close')) closeLibrary(); });
            document.body.appendChild(overlay);
            overlay.querySelector('#npc_state_v3_library_search')?.addEventListener('input', renderLibrary);
        }
        renderLibrary();
        return true;
    }

    function closeLibrary() { libraryOverlay()?.remove(); closeEditor(); }

    function wireDossierActions(root) {
        if (!root) return;
        root.querySelector('.npc-state-v3-edit')?.addEventListener('click', event => openEditor(event.currentTarget.dataset.npcId));
        root.querySelector('.npc-state-v3-refresh')?.addEventListener('click', async event => {
            const id = event.currentTarget.dataset.npcId;
            event.currentTarget.disabled = true;
            const result = await safely('dossier scan', () => engine.refreshDossier(id));
            event.currentTarget.disabled = false;
            notify(result.ok ? 'success' : 'warning', result.ok ? 'NPC State: dossier reconciled from recent chat without replaying relationship deltas.' : `NPC State: dossier scan did not commit (${result.reason || 'unknown'}).`);
            refresh();
        });
        root.querySelector('.npc-state-v3-archive')?.addEventListener('click', async event => {
            const id = event.currentTarget.dataset.npcId;
            const npc = findNpcByReference(state(), id);
            if (!npc) return;
            await safely(npc.archived ? 'restore dossier' : 'archive dossier', () => engine.archiveNpc(id, !npc.archived));
            refresh();
        });
        root.querySelector('.npc-state-v3-delete')?.addEventListener('click', async event => {
            const id = event.currentTarget.dataset.npcId;
            const npc = findNpcByReference(state(), id);
            if (!npc || !globalThis.confirm?.(`Delete ${npc.name}? Older v0.3 branch checkpoints will not be allowed to restore this identity.`)) return;
            const deleted = await safely('delete dossier', () => engine.deleteNpc(id));
            if (!deleted.ok) return;
            if (selectedNpcId === id) selectedNpcId = '';
            refresh();
        });
    }

    function editorHtml(npc) {
        const rel = npc.relationship || {};
        const field = (label, id, value, wide = false) => `<label class="${wide ? 'npc-state-v3-editor-wide' : ''}">${label}<input id="${id}" class="text_pole" value="${escapeHtml(value || '')}"></label>`;
        return `<div class="npc-state-v3-editor-shell" data-npc-id="${escapeHtml(npc.id)}" data-updated-at="${Number(npc.updatedAt) || 0}"><header><div><span class="npc-state-kicker">EDIT DOSSIER</span><h2>${escapeHtml(npc.name)}</h2></div><button class="npc-state-v3-editor-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header><div class="npc-state-v3-editor-grid">
          ${field('Name', 'npc_state_v3_edit_name', npc.name)}${field('Role', 'npc_state_v3_edit_role', npc.role)}${field('Species / race', 'npc_state_v3_edit_species', npc.species)}${field('Age', 'npc_state_v3_edit_age', npc.age)}${field('Apparent age', 'npc_state_v3_edit_apparent_age', npc.apparentAge)}
          <label class="npc-state-v3-editor-wide">Personality<textarea id="npc_state_v3_edit_personality" class="text_pole" rows="3">${escapeHtml(npc.personality)}</textarea></label><label class="npc-state-v3-editor-wide">Behavioral profile · one per line<textarea id="npc_state_v3_edit_behavior" class="text_pole" rows="5">${escapeHtml((npc.behaviorProfile || []).join('\n'))}</textarea></label><label class="npc-state-v3-editor-wide">Speech<textarea id="npc_state_v3_edit_speech" class="text_pole" rows="3">${escapeHtml(npc.speech)}</textarea></label><label class="npc-state-v3-editor-wide">Appearance<textarea id="npc_state_v3_edit_appearance" class="text_pole" rows="5">${escapeHtml(npc.appearance)}</textarea></label><label class="npc-state-v3-editor-wide">Background<textarea id="npc_state_v3_edit_background" class="text_pole" rows="4">${escapeHtml(npc.background)}</textarea></label><label class="npc-state-v3-editor-wide">Mannerisms · one per line<textarea id="npc_state_v3_edit_mannerisms" class="text_pole" rows="4">${escapeHtml((npc.mannerisms || []).join('\n'))}</textarea></label><label class="npc-state-v3-editor-wide">Key relationships · one per line<textarea id="npc_state_v3_edit_key_relationships" class="text_pole" rows="4">${escapeHtml((npc.keyRelationships || []).join('\n'))}</textarea></label>
          ${field('Mood', 'npc_state_v3_edit_mood', npc.mood)}${field('Location', 'npc_state_v3_edit_location', npc.location)}${field('Goal', 'npc_state_v3_edit_goal', npc.goal)}${field('Status', 'npc_state_v3_edit_status', npc.status)}<label class="npc-state-v3-editor-wide">Relationship summary<textarea id="npc_state_v3_edit_relationship_summary" class="text_pole" rows="3">${escapeHtml(npc.relationshipSummary)}</textarea></label><label class="npc-state-v3-editor-wide">Important memories · one per line<textarea id="npc_state_v3_edit_memories" class="text_pole" rows="5">${escapeHtml((npc.memories || []).join('\n'))}</textarea></label>
          ${field('Trust', 'npc_state_v3_edit_trust', rel.trust)}${field('Affection', 'npc_state_v3_edit_affection', rel.affection)}${field('Desire', 'npc_state_v3_edit_desire', rel.desire)}${field('Tension', 'npc_state_v3_edit_tension', rel.tension)}
          <label class="npc-state-v3-editor-wide"><input id="npc_state_v3_edit_lock" type="checkbox" ${npc.manualProfileFields?.length ? 'checked' : ''}> Protect stable profile fields from scanner rewrites</label><label class="npc-state-v3-editor-wide"><input id="npc_state_v3_edit_retention" type="checkbox" ${npc.retentionProtected ? 'checked' : ''}> Retention protected</label><label class="npc-state-v3-editor-wide"><input id="npc_state_v3_edit_minor" type="checkbox" ${npc.minor ? 'checked' : ''}> Minor NPC</label>
        </div><footer><button class="menu_button npc-state-v3-editor-cancel">Cancel</button><button class="menu_button npc-state-v3-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save dossier</button></footer></div>`;
    }

    function openEditor(id) {
        const npc = findNpcByReference(state(), id);
        if (!npc) return false;
        closeEditor();
        activeEditorNpcId = npc.id;
        const overlay = document.createElement('div');
        overlay.id = EDITOR_ID;
        overlay.className = 'npc-state-v3-editor-overlay';
        overlay.innerHTML = editorHtml(npc);
        overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest?.('.npc-state-v3-editor-close, .npc-state-v3-editor-cancel')) closeEditor(); });
        overlay.querySelector('.npc-state-v3-editor-save')?.addEventListener('click', saveEditor);
        document.body.appendChild(overlay);
        return true;
    }

    function closeEditor() { document.getElementById(EDITOR_ID)?.remove(); activeEditorNpcId = ''; }

    async function saveEditor() {
        const overlay = document.getElementById(EDITOR_ID);
        const shell = overlay?.querySelector('.npc-state-v3-editor-shell');
        const id = String(shell?.dataset.npcId || '');
        if (!overlay || !editorIdentityMatches(activeEditorNpcId, id)) {
            notify('error', 'NPC State: editor identity mismatch. No dossier was saved.');
            return false;
        }
        const value = fieldId => overlay.querySelector(`#${fieldId}`)?.value ?? '';
        const clamp = fieldId => Math.max(-100, Math.min(100, Math.round(Number(value(fieldId)) || 0)));
        const stableFields = ['name', 'role', 'species', 'age', 'apparentAge', 'personality', 'behaviorProfile', 'speech', 'appearance', 'background', 'mannerisms', 'keyRelationships'];
        const patch = {
            name: value('npc_state_v3_edit_name').trim(), role: value('npc_state_v3_edit_role'), species: value('npc_state_v3_edit_species'), age: value('npc_state_v3_edit_age'), apparentAge: value('npc_state_v3_edit_apparent_age'),
            personality: value('npc_state_v3_edit_personality'), behaviorProfile: splitLines(value('npc_state_v3_edit_behavior'), 8), speech: value('npc_state_v3_edit_speech'), appearance: value('npc_state_v3_edit_appearance'), background: value('npc_state_v3_edit_background'), mannerisms: splitLines(value('npc_state_v3_edit_mannerisms'), 8), keyRelationships: splitLines(value('npc_state_v3_edit_key_relationships'), 12),
            mood: value('npc_state_v3_edit_mood'), location: value('npc_state_v3_edit_location'), goal: value('npc_state_v3_edit_goal'), status: value('npc_state_v3_edit_status'), relationshipSummary: value('npc_state_v3_edit_relationship_summary'), memories: splitLines(value('npc_state_v3_edit_memories'), 5),
            relationship: { trust: clamp('npc_state_v3_edit_trust'), affection: clamp('npc_state_v3_edit_affection'), desire: clamp('npc_state_v3_edit_desire'), tension: clamp('npc_state_v3_edit_tension') },
            manualProfileFields: overlay.querySelector('#npc_state_v3_edit_lock')?.checked ? stableFields : [], retentionProtected: Boolean(overlay.querySelector('#npc_state_v3_edit_retention')?.checked), minor: Boolean(overlay.querySelector('#npc_state_v3_edit_minor')?.checked),
        };
        const result = await safely('save dossier', () => engine.updateNpc(id, patch, { expectedUpdatedAt: Number(shell.dataset.updatedAt) || 0 }));
        if (!result.ok) {
            notify('warning', result.reason === 'stale-editor'
                ? 'NPC State: this dossier changed while the editor was open. Reopen it before saving so newer scan data is not overwritten.'
                : 'NPC State: dossier edit was rejected, usually because the name collides with another dossier.');
            return false;
        }
        selectedNpcId = id;
        closeEditor();
        notify('success', 'NPC State: dossier saved.');
        refresh();
        return true;
    }

    function renderInline() {
        document.getElementById(INLINE_ID)?.remove();
        const current = state();
        if (!current) return;
        const present = current.npcs.filter(npc => npc.present && !npc.archived && !npc.minor);
        if (!present.length) return;
        const messageId = latestAssistantMessageId(getContext().chat || []);
        const message = messageElement(messageId);
        if (!message) return;
        const holder = document.createElement('section');
        holder.id = INLINE_ID;
        holder.className = 'npc-state-present-roster npc-state-v3-inline';
        holder.innerHTML = `<div class="npc-state-present-roster-head"><span class="npc-state-kicker">PRESENT NPCS</span><small>${present.length} shown</small></div><div class="npc-state-present-grid">${present.map(npc => `<button type="button" class="npc-state-present-card npc-state-v3-inline-card" data-npc-id="${escapeHtml(npc.id)}"><span class="npc-state-present-card-portrait">${npc.portrait?.dataUrl ? `<img src="${escapeHtml(npc.portrait.dataUrl)}" alt="">` : `<div class="npc-state-present-card-placeholder">${escapeHtml(String(npc.name || '?').charAt(0))}</div>`}</span><span class="npc-state-present-card-overlay"><b>${escapeHtml(npc.name)}</b><small>${escapeHtml([npc.role, npc.mood].filter(Boolean).join(' · ') || 'Present NPC')}</small></span></button>`).join('')}</div>`;
        holder.querySelectorAll('.npc-state-v3-inline-card').forEach(button => button.addEventListener('click', () => openLibrary(button.dataset.npcId)));
        const target = message.querySelector?.('.mes_text') || message;
        target.appendChild(holder);
    }

    function refresh() {
        scheduleMount();
        syncSettings();
        renderRoster();
        renderInline();
        if (libraryOverlay()) renderLibrary();
    }

    return Object.freeze({ scheduleMount, refresh, renderInline, openLibrary, closeLibrary, openEditor, closeEditor, get activeEditorNpcId() { return activeEditorNpcId; } });
}
