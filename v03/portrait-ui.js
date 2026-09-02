import {
    PORTRAIT_PROMPT_PLACEHOLDERS,
    buildPortraitPrompt,
    normalizePortraitPromptSettings,
} from './portrait-prompt.js';
import { findNpcByReference } from './schema.js';

const SECTION_ID = 'npc_state_v3_portrait_prompt';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function copyText(value) {
    const text = String(value || '');
    if (!text) return false;
    if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(text);
        return true;
    }
    const doc = globalThis.document;
    if (!doc?.body || typeof doc.execCommand !== 'function') throw new Error('Clipboard API is unavailable.');
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Browser rejected the clipboard copy request.');
    return true;
}

function sectionHtml() {
    const placeholderText = PORTRAIT_PROMPT_PLACEHOLDERS.map(key => `{{${key}}}`).join(' · ');
    return `<details id="${SECTION_ID}" class="npc-state-v3-portrait-settings">
      <summary><b>Portrait prompt</b></summary>
      <div class="npc-state-v3-portrait-settings-body">
        <small class="npc-state-muted">Prompt composition only. NPC State does not call an image API, generate images, queue portraits, or regenerate them automatically.</small>
        <label class="npc-state-v3-portrait-mode"><span><b>Character formatting</b><small>Controls only the auto-built {{character}} placeholder.</small></span><select id="npc_state_v3_portrait_mode" class="text_pole"><option value="natural">Natural</option><option value="tags">Tags</option><option value="hybrid">Hybrid</option></select></label>
        <label><b>Portrait preset</b><small>Reusable style/composition text. Insert it anywhere with {{portraitPreset}}.</small><textarea id="npc_state_v3_portrait_preset" class="text_pole" rows="5"></textarea></label>
        <label><b>Generation prompt</b><small>Template copied to your image generator after placeholders are resolved.</small><textarea id="npc_state_v3_portrait_template" class="text_pole" rows="7"></textarea></label>
        <div class="npc-state-v3-portrait-placeholders"><b>Placeholders</b><small>${escapeHtml(placeholderText)}</small></div>
        <div class="npc-state-actions"><button id="npc_state_v3_portrait_save" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> Save portrait prompt settings</button><span id="npc_state_v3_portrait_dirty" class="npc-state-muted"></span></div>
        <div class="npc-state-v3-portrait-preview-box">
          <label><b>Preview NPC</b><select id="npc_state_v3_portrait_npc" class="text_pole"></select></label>
          <label><b>Resolved prompt</b><textarea id="npc_state_v3_portrait_preview" class="text_pole" rows="10" readonly></textarea></label>
          <div class="npc-state-actions"><button id="npc_state_v3_portrait_copy" class="menu_button"><i class="fa-solid fa-copy"></i> Copy resolved prompt</button></div>
        </div>
      </div>
    </details>`;
}

export function createPortraitPromptUi(adapters = {}) {
    const engine = adapters.engine;
    const getSettings = adapters.getSettings;
    const persistSettings = adapters.persistSettings || (() => {});
    let dirty = false;
    let mountTimer = null;

    function notify(kind, message) {
        const fn = globalThis.toastr?.[kind];
        if (typeof fn === 'function') fn(`NPC State: ${message}`);
    }

    function panel() { return globalThis.document?.getElementById?.(SECTION_ID) || null; }
    function state() { return engine.getState?.() || null; }

    function draftSettings(root = panel()) {
        if (!root) return normalizePortraitPromptSettings(getSettings());
        return normalizePortraitPromptSettings({
            portraitPromptMode: root.querySelector('#npc_state_v3_portrait_mode')?.value,
            portraitPreset: root.querySelector('#npc_state_v3_portrait_preset')?.value,
            portraitGenerationPrompt: root.querySelector('#npc_state_v3_portrait_template')?.value,
        });
    }

    function chosenNpc(root = panel()) {
        const id = root?.querySelector('#npc_state_v3_portrait_npc')?.value || '';
        return id ? findNpcByReference(state(), id) : null;
    }

    function renderPreview(root = panel()) {
        if (!root) return '';
        const preview = root.querySelector('#npc_state_v3_portrait_preview');
        const copyButton = root.querySelector('#npc_state_v3_portrait_copy');
        const npc = chosenNpc(root);
        const value = npc ? buildPortraitPrompt(npc, draftSettings(root)) : '';
        if (preview) preview.value = value;
        if (copyButton) copyButton.disabled = !value;
        const dirtyLabel = root.querySelector('#npc_state_v3_portrait_dirty');
        if (dirtyLabel) dirtyLabel.textContent = dirty ? 'Unsaved changes' : 'Saved';
        return value;
    }

    function loadSavedFields(root = panel()) {
        if (!root) return false;
        const saved = normalizePortraitPromptSettings(getSettings());
        const mode = root.querySelector('#npc_state_v3_portrait_mode');
        const preset = root.querySelector('#npc_state_v3_portrait_preset');
        const template = root.querySelector('#npc_state_v3_portrait_template');
        if (mode) mode.value = saved.portraitPromptMode;
        if (preset) preset.value = saved.portraitPreset;
        if (template) template.value = saved.portraitGenerationPrompt;
        dirty = false;
        return true;
    }

    function syncNpcChoices(root = panel()) {
        if (!root) return false;
        const select = root.querySelector('#npc_state_v3_portrait_npc');
        if (!select) return false;
        const previous = select.value || '';
        const rows = [...(state()?.npcs || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        select.innerHTML = rows.length
            ? rows.map(npc => `<option value="${escapeHtml(npc.id)}">${escapeHtml(npc.name)}${npc.archived ? ' · archived' : ''}</option>`).join('')
            : '<option value="">No dossiers</option>';
        if (rows.some(npc => npc.id === previous)) select.value = previous;
        return true;
    }

    async function save(root = panel()) {
        if (!root) return false;
        const next = draftSettings(root);
        const settings = getSettings();
        settings.portraitPromptMode = next.portraitPromptMode;
        settings.portraitPreset = next.portraitPreset;
        settings.portraitGenerationPrompt = next.portraitGenerationPrompt;
        persistSettings();
        dirty = false;
        renderPreview(root);
        notify('success', 'portrait prompt settings saved.');
        return true;
    }

    async function copyCurrent(root = panel()) {
        const value = renderPreview(root);
        if (!value) return false;
        await copyText(value);
        notify('success', 'resolved portrait prompt copied.');
        return true;
    }

    function bind(root) {
        for (const selector of ['#npc_state_v3_portrait_mode', '#npc_state_v3_portrait_preset', '#npc_state_v3_portrait_template']) {
            root.querySelector(selector)?.addEventListener('input', () => {
                dirty = true;
                renderPreview(root);
            });
            root.querySelector(selector)?.addEventListener('change', () => {
                dirty = true;
                renderPreview(root);
            });
        }
        root.querySelector('#npc_state_v3_portrait_npc')?.addEventListener('change', () => renderPreview(root));
        root.querySelector('#npc_state_v3_portrait_save')?.addEventListener('click', () => save(root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy')?.addEventListener('click', () => copyCurrent(root).catch(error => notify('error', error.message)));
    }

    function attach() {
        if (panel()) return true;
        const settingsPanel = globalThis.document?.getElementById?.('npc_state_settings');
        const drawer = settingsPanel?.querySelector?.('.npc-state-drawer');
        if (!drawer) return false;
        const wrapper = globalThis.document.createElement('div');
        wrapper.innerHTML = sectionHtml();
        const section = wrapper.firstElementChild;
        const actions = drawer.querySelector('#npc_state_v3_main_actions');
        if (actions?.before) actions.before(section);
        else drawer.appendChild(section);
        bind(section);
        loadSavedFields(section);
        syncNpcChoices(section);
        renderPreview(section);
        return true;
    }

    function refresh() {
        if (!attach()) return false;
        const root = panel();
        if (!dirty) loadSavedFields(root);
        syncNpcChoices(root);
        renderPreview(root);
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

    function buildFor(reference) {
        const npc = findNpcByReference(state(), reference);
        return npc ? buildPortraitPrompt(npc, normalizePortraitPromptSettings(getSettings())) : '';
    }

    async function copyFor(reference) {
        const value = buildFor(reference);
        if (!value) return false;
        await copyText(value);
        notify('success', 'portrait prompt copied.');
        return true;
    }

    return Object.freeze({ scheduleMount, refresh, buildFor, copyFor, get dirty() { return dirty; } });
}
