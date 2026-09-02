import {
    PORTRAIT_PROMPT_PLACEHOLDERS,
    buildPortraitPrompt,
    buildPortraitPrompts,
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
        <small class="npc-state-muted">Prompt composition only. The portrait preset contains both positive and negative reusable text. NPC State does not call an image API, generate images, queue portraits, or regenerate them automatically.</small>
        <label class="npc-state-v3-portrait-mode"><span><b>Character formatting</b><small>Controls only the auto-built {{character}} placeholder.</small></span><select id="npc_state_v3_portrait_mode" class="text_pole"><option value="natural">Natural</option><option value="tags">Tags</option><option value="hybrid">Hybrid</option></select></label>
        <div class="npc-state-v3-portrait-preset-pair">
          <label><b>Positive preset</b><small>Reusable positive style, quality, and composition text. Insert with {{positivePreset}}.</small><textarea id="npc_state_v3_portrait_positive_preset" class="text_pole" rows="5"></textarea></label>
          <label><b>Negative preset</b><small>Reusable exclusions and negative-quality tags. Insert with {{negativePreset}}.</small><textarea id="npc_state_v3_portrait_negative_preset" class="text_pole" rows="5"></textarea></label>
        </div>
        <div class="npc-state-v3-portrait-template-pair">
          <label><b>Positive prompt template</b><small>How the positive side is assembled for the selected NPC.</small><textarea id="npc_state_v3_portrait_positive_template" class="text_pole" rows="7"></textarea></label>
          <label><b>Negative prompt template</b><small>How the negative side is assembled. It may be only {{negativePreset}} or may use dossier placeholders too.</small><textarea id="npc_state_v3_portrait_negative_template" class="text_pole" rows="7"></textarea></label>
        </div>
        <div class="npc-state-v3-portrait-placeholders"><b>Placeholders</b><small>${escapeHtml(placeholderText)}</small></div>
        <div class="npc-state-actions"><button id="npc_state_v3_portrait_save" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> Save portrait prompt settings</button><span id="npc_state_v3_portrait_dirty" class="npc-state-muted"></span></div>
        <div class="npc-state-v3-portrait-preview-box">
          <label><b>Preview NPC</b><select id="npc_state_v3_portrait_npc" class="text_pole"></select></label>
          <div class="npc-state-v3-portrait-preview-pair">
            <label><b>Resolved positive</b><textarea id="npc_state_v3_portrait_positive_preview" class="text_pole" rows="10" readonly></textarea></label>
            <label><b>Resolved negative</b><textarea id="npc_state_v3_portrait_negative_preview" class="text_pole" rows="10" readonly></textarea></label>
          </div>
          <div class="npc-state-actions">
            <button id="npc_state_v3_portrait_copy_positive" class="menu_button"><i class="fa-solid fa-copy"></i> Copy positive</button>
            <button id="npc_state_v3_portrait_copy_negative" class="menu_button"><i class="fa-solid fa-copy"></i> Copy negative</button>
            <button id="npc_state_v3_portrait_copy_both" class="menu_button"><i class="fa-solid fa-copy"></i> Copy both</button>
          </div>
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
            portraitPreset: {
                positive: root.querySelector('#npc_state_v3_portrait_positive_preset')?.value,
                negative: root.querySelector('#npc_state_v3_portrait_negative_preset')?.value,
            },
            portraitPositivePrompt: root.querySelector('#npc_state_v3_portrait_positive_template')?.value,
            portraitNegativePrompt: root.querySelector('#npc_state_v3_portrait_negative_template')?.value,
        });
    }

    function chosenNpc(root = panel()) {
        const id = root?.querySelector('#npc_state_v3_portrait_npc')?.value || '';
        return id ? findNpcByReference(state(), id) : null;
    }

    function renderPreview(root = panel()) {
        if (!root) return { positive: '', negative: '', combined: '' };
        const positivePreview = root.querySelector('#npc_state_v3_portrait_positive_preview');
        const negativePreview = root.querySelector('#npc_state_v3_portrait_negative_preview');
        const positiveButton = root.querySelector('#npc_state_v3_portrait_copy_positive');
        const negativeButton = root.querySelector('#npc_state_v3_portrait_copy_negative');
        const bothButton = root.querySelector('#npc_state_v3_portrait_copy_both');
        const npc = chosenNpc(root);
        const values = npc ? buildPortraitPrompts(npc, draftSettings(root)) : { positive: '', negative: '', combined: '' };
        if (positivePreview) positivePreview.value = values.positive;
        if (negativePreview) negativePreview.value = values.negative;
        if (positiveButton) positiveButton.disabled = !values.positive;
        if (negativeButton) negativeButton.disabled = !values.negative;
        if (bothButton) bothButton.disabled = !values.positive && !values.negative;
        const dirtyLabel = root.querySelector('#npc_state_v3_portrait_dirty');
        if (dirtyLabel) dirtyLabel.textContent = dirty ? 'Unsaved changes' : 'Saved';
        return values;
    }

    function loadSavedFields(root = panel()) {
        if (!root) return false;
        const saved = normalizePortraitPromptSettings(getSettings());
        const mode = root.querySelector('#npc_state_v3_portrait_mode');
        const positivePreset = root.querySelector('#npc_state_v3_portrait_positive_preset');
        const negativePreset = root.querySelector('#npc_state_v3_portrait_negative_preset');
        const positiveTemplate = root.querySelector('#npc_state_v3_portrait_positive_template');
        const negativeTemplate = root.querySelector('#npc_state_v3_portrait_negative_template');
        if (mode) mode.value = saved.portraitPromptMode;
        if (positivePreset) positivePreset.value = saved.portraitPreset.positive;
        if (negativePreset) negativePreset.value = saved.portraitPreset.negative;
        if (positiveTemplate) positiveTemplate.value = saved.portraitPositivePrompt;
        if (negativeTemplate) negativeTemplate.value = saved.portraitNegativePrompt;
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
        settings.portraitPreset = structuredClone(next.portraitPreset);
        settings.portraitPositivePrompt = next.portraitPositivePrompt;
        settings.portraitNegativePrompt = next.portraitNegativePrompt;
        delete settings.portraitGenerationPrompt;
        delete settings.portraitPositivePreset;
        delete settings.portraitNegativePreset;
        persistSettings();
        dirty = false;
        renderPreview(root);
        notify('success', 'portrait positive and negative prompt settings saved.');
        return true;
    }

    async function copyChannel(channel, root = panel()) {
        const values = renderPreview(root);
        const value = channel === 'negative' ? values.negative : channel === 'both' ? values.combined : values.positive;
        if (!value) return false;
        await copyText(value);
        notify('success', channel === 'both' ? 'positive and negative portrait prompts copied.' : `${channel} portrait prompt copied.`);
        return true;
    }

    function bind(root) {
        for (const selector of [
            '#npc_state_v3_portrait_mode',
            '#npc_state_v3_portrait_positive_preset',
            '#npc_state_v3_portrait_negative_preset',
            '#npc_state_v3_portrait_positive_template',
            '#npc_state_v3_portrait_negative_template',
        ]) {
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
        root.querySelector('#npc_state_v3_portrait_copy_positive')?.addEventListener('click', () => copyChannel('positive', root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy_negative')?.addEventListener('click', () => copyChannel('negative', root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy_both')?.addEventListener('click', () => copyChannel('both', root).catch(error => notify('error', error.message)));
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

    function buildPairFor(reference) {
        const npc = findNpcByReference(state(), reference);
        return npc ? buildPortraitPrompts(npc, normalizePortraitPromptSettings(getSettings())) : { positive: '', negative: '', combined: '' };
    }

    function buildFor(reference) {
        const npc = findNpcByReference(state(), reference);
        return npc ? buildPortraitPrompt(npc, normalizePortraitPromptSettings(getSettings())) : '';
    }

    async function copyPositiveFor(reference) {
        const value = buildPairFor(reference).positive;
        if (!value) return false;
        await copyText(value);
        notify('success', 'positive portrait prompt copied.');
        return true;
    }

    async function copyNegativeFor(reference) {
        const value = buildPairFor(reference).negative;
        if (!value) return false;
        await copyText(value);
        notify('success', 'negative portrait prompt copied.');
        return true;
    }

    async function copyBothFor(reference) {
        const value = buildPairFor(reference).combined;
        if (!value) return false;
        await copyText(value);
        notify('success', 'positive and negative portrait prompts copied.');
        return true;
    }

    // Backward-compatible original helper copies the positive channel.
    async function copyFor(reference) {
        return copyPositiveFor(reference);
    }

    return Object.freeze({
        scheduleMount,
        refresh,
        buildFor,
        buildPairFor,
        copyFor,
        copyPositiveFor,
        copyNegativeFor,
        copyBothFor,
        get dirty() { return dirty; },
    });
}
