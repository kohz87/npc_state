const SECTION_ID = 'npc_state_v3_bundle_management';
const FILE_ID = 'npc_state_v3_bundle_file';
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function downloadJson(bundle, filename) {
    const BlobCtor = globalThis.Blob;
    const URLCtor = globalThis.URL;
    if (typeof BlobCtor !== 'function' || typeof URLCtor?.createObjectURL !== 'function') throw new Error('Browser download APIs are unavailable.');
    const blob = new BlobCtor([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URLCtor.createObjectURL(blob);
    try {
        const anchor = globalThis.document?.createElement?.('a');
        if (!anchor) throw new Error('Could not create a browser download link.');
        anchor.href = url;
        anchor.download = filename || 'npc-state-v3-bundle.json';
        anchor.style.display = 'none';
        globalThis.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        setTimeout(() => URLCtor.revokeObjectURL?.(url), 0);
    }
}

function previewText(preview) {
    if (!preview || preview.reason === 'no-chat') return 'No active chat is available for import.';
    if (preview.reason === 'replace-requires-full-chat') return 'Replace mode requires a full-chat bundle.';
    const lines = [
        `Bundle: ${preview.bundle?.bundleType === 'npc' ? 'selected NPC' : 'full chat'}`,
        `Incoming dossiers: ${preview.incomingNpcCount || 0}`,
        `New stable IDs: ${preview.newNpcIds?.length || 0}`,
        `Matching stable IDs: ${preview.matches?.length || 0}`,
        `Social edges: ${preview.incomingSocialEdgeCount || 0}`,
        `Tombstones: ${preview.incomingTombstoneCount || 0}`,
        `Hard conflicts: ${preview.conflicts?.length || 0}`,
    ];
    if (preview.conflicts?.length) {
        lines.push('', 'Conflicts:');
        for (const item of preview.conflicts.slice(0, 8)) {
            const label = item.importedName || item.existingName || item.npcId;
            lines.push(`- ${label}: ${item.detail || item.type}`);
        }
        if (preview.conflicts.length > 8) lines.push(`- ...and ${preview.conflicts.length - 8} more`);
    }
    return lines.join('\n');
}

function confirmationText(preview, options) {
    const lines = [previewText(preview), ''];
    if (options.mode === 'replace') {
        lines.push('REPLACE DURABLE STATE: current dossiers, social graph, suppression names, and tombstones will be replaced by this full-chat backup. Current branch/runtime machinery is not imported.');
    } else {
        lines.push(`Merge matching IDs: ${options.matchPolicy === 'replace' ? 'use imported dossier data' : 'keep current dossier data'}.`);
        lines.push(`Hard conflicts: ${options.conflictPolicy === 'skip' ? 'skip conflicting imported identities' : 'abort the entire import'}.`);
    }
    lines.push('', 'Continue with this import?');
    return lines.join('\n');
}

export function createBundleManagementUi(adapters = {}) {
    const engine = adapters.engine;
    const ui = adapters.ui;
    let mountTimer = null;

    function notify(kind, message) {
        const fn = globalThis.toastr?.[kind];
        if (typeof fn === 'function') fn(`NPC State: ${message}`);
    }

    function state() { return engine.getState?.() || null; }

    function sectionHtml() {
        return `<details id="${SECTION_ID}" class="npc-state-v3-bundle-settings">
          <summary><b>Bundle import / export</b></summary>
          <div class="npc-state-v3-bundle-settings-body">
            <small class="npc-state-muted">Exports normalized v0.3 dossier data only. Branch checkpoints, branch baselines, observations, sidecar revisions, migration/runtime state, and operation locks are never bundled.</small>
            <div class="npc-state-v3-bundle-export-grid">
              <div><b>Full-chat backup</b><small>All dossiers, memories, relationships, social graph, portraits, suppression names, tombstones, archive state, and stale lifecycle fields.</small><button id="npc_state_v3_bundle_export_full" class="menu_button"><i class="fa-solid fa-file-export"></i> Export full chat</button></div>
              <div><b>Selected NPC</b><small>One normalized dossier plus social edges that touch that stable NPC id. Edges whose counterpart is absent in the destination are safely dropped during import.</small><select id="npc_state_v3_bundle_npc" class="text_pole"></select><button id="npc_state_v3_bundle_export_npc" class="menu_button"><i class="fa-solid fa-user-tag"></i> Export selected NPC</button></div>
            </div>
            <div class="npc-state-v3-bundle-import-box">
              <b>Import bundle</b>
              <div class="npc-state-v3-bundle-import-options">
                <label><span>Mode</span><select id="npc_state_v3_bundle_mode" class="text_pole"><option value="merge">Safe merge</option><option value="replace">Replace durable state</option></select></label>
                <label><span>Matching stable ID</span><select id="npc_state_v3_bundle_match" class="text_pole"><option value="keep">Keep current dossier</option><option value="replace">Use imported dossier</option></select></label>
                <label><span>Hard identity conflict</span><select id="npc_state_v3_bundle_conflict" class="text_pole"><option value="abort">Abort import</option><option value="skip">Skip conflicting import</option></select></label>
              </div>
              <input id="${FILE_ID}" type="file" accept="application/json,.json" hidden>
              <div class="npc-state-actions"><button id="npc_state_v3_bundle_import" class="menu_button"><i class="fa-solid fa-file-import"></i> Choose bundle and import</button></div>
              <pre id="npc_state_v3_bundle_preview" class="npc-state-v3-bundle-preview">No bundle selected.</pre>
            </div>
          </div>
        </details>`;
    }

    function options(panel) {
        return {
            mode: panel.querySelector('#npc_state_v3_bundle_mode')?.value || 'merge',
            matchPolicy: panel.querySelector('#npc_state_v3_bundle_match')?.value || 'keep',
            conflictPolicy: panel.querySelector('#npc_state_v3_bundle_conflict')?.value || 'abort',
        };
    }

    function sync() {
        const panel = globalThis.document?.getElementById?.(SECTION_ID);
        if (!panel) return false;
        const select = panel.querySelector('#npc_state_v3_bundle_npc');
        const exportButton = panel.querySelector('#npc_state_v3_bundle_export_npc');
        const current = state();
        const previous = select?.value || '';
        const rows = [...(current?.npcs || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        if (select) {
            select.innerHTML = rows.length
                ? rows.map(npc => `<option value="${escapeHtml(npc.id)}">${escapeHtml(npc.name)}${npc.archived ? ' · archived' : ''}</option>`).join('')
                : '<option value="">No dossiers</option>';
            if (rows.some(npc => npc.id === previous)) select.value = previous;
        }
        if (exportButton) exportButton.disabled = !rows.length;
        const mode = panel.querySelector('#npc_state_v3_bundle_mode')?.value || 'merge';
        for (const selector of ['#npc_state_v3_bundle_match', '#npc_state_v3_bundle_conflict']) {
            const control = panel.querySelector(selector);
            if (control) control.disabled = mode === 'replace';
        }
        return true;
    }

    async function exportFull() {
        const result = await engine.exportBundle();
        if (!result.ok) return notify('warning', `full-chat export was not created (${result.reason || 'unknown'}).`);
        downloadJson(result.bundle, result.filename);
        notify('success', `exported ${result.npcCount} dossier${result.npcCount === 1 ? '' : 's'} as a full-chat v0.3 backup.`);
    }

    async function exportSelected(panel) {
        const id = panel.querySelector('#npc_state_v3_bundle_npc')?.value || '';
        if (!id) return notify('warning', 'select an NPC dossier to export.');
        const result = await engine.exportBundle(id);
        if (!result.ok) return notify('warning', `selected-NPC export was not created (${result.reason || 'unknown'}).`);
        downloadJson(result.bundle, result.filename);
        notify('success', 'exported the selected v0.3 dossier bundle.');
    }

    async function importFile(panel, file) {
        const previewHolder = panel.querySelector('#npc_state_v3_bundle_preview');
        if (!file) return;
        if (Number(file.size) > MAX_BUNDLE_BYTES) {
            if (previewHolder) previewHolder.textContent = 'Bundle rejected: file exceeds the 50 MB safety limit.';
            return notify('error', 'bundle exceeds the 50 MB safety limit.');
        }
        let source;
        try { source = await file.text(); }
        catch (error) {
            if (previewHolder) previewHolder.textContent = `Could not read bundle: ${error.message}`;
            return notify('error', `could not read the selected bundle. ${error.message}`);
        }
        const importOptions = options(panel);
        let preview;
        try { preview = await engine.previewBundleImport(source, importOptions); }
        catch (error) {
            if (previewHolder) previewHolder.textContent = `Bundle rejected: ${error.message}`;
            return notify('error', `bundle validation failed. ${error.message}`);
        }
        if (previewHolder) previewHolder.textContent = previewText(preview);
        if (!preview.ok) {
            notify('warning', preview.reason === 'identity-conflict'
                ? 'bundle has stable-identity conflicts. Resolve by choosing Skip conflicting import or by fixing the source bundle.'
                : `bundle cannot be imported (${preview.reason || 'validation failed'}).`);
            return;
        }
        if (!globalThis.confirm?.(confirmationText(preview, importOptions))) return;
        let result;
        try { result = await engine.importBundle(source, importOptions); }
        catch (error) {
            if (previewHolder) previewHolder.textContent = `${previewText(preview)}\n\nImport failed safely: ${error.message}`;
            return notify('error', `bundle import failed without committing partial state. ${error.message}`);
        }
        if (!result.ok) {
            if (previewHolder) previewHolder.textContent = `${previewText(result.preview || preview)}\n\nNo changes committed: ${result.reason || 'rejected'}.`;
            return notify('warning', `bundle import did not commit (${result.reason || 'rejected'}).`);
        }
        const imported = result.result?.importedNpcIds?.length || 0;
        const skipped = result.result?.skippedNpcIds?.length || 0;
        if (previewHolder) previewHolder.textContent = `${previewText(result.preview || preview)}\n\nCommitted: ${result.mode}; imported/updated ${imported}; skipped ${skipped}; dropped unresolved edges ${result.result?.droppedSocialEdges || 0}.`;
        notify('success', `${result.mode === 'replace' ? 'restored full-chat durable state' : 'merged bundle'}; ${imported} dossier${imported === 1 ? '' : 's'} imported or updated${skipped ? `, ${skipped} skipped` : ''}.`);
        ui?.refresh?.();
        refresh();
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
        section.querySelector('#npc_state_v3_bundle_export_full')?.addEventListener('click', () => exportFull().catch(error => notify('error', error.message)));
        section.querySelector('#npc_state_v3_bundle_export_npc')?.addEventListener('click', () => exportSelected(section).catch(error => notify('error', error.message)));
        section.querySelector('#npc_state_v3_bundle_mode')?.addEventListener('change', sync);
        section.querySelector('#npc_state_v3_bundle_import')?.addEventListener('click', () => section.querySelector(`#${FILE_ID}`)?.click?.());
        section.querySelector(`#${FILE_ID}`)?.addEventListener('change', async event => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            await importFile(section, file);
        });
        sync();
        return true;
    }

    function refresh() {
        if (!attach()) return false;
        return sync();
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

    return Object.freeze({ scheduleMount, refresh });
}
