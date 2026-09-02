import {
    PORTRAIT_PRESET_LIMIT,
    PORTRAIT_PROMPT_PLACEHOLDERS,
    buildPortraitPrompt,
    buildPortraitPrompts,
    makePortraitPresetId,
    normalizePortraitPresetLibrary,
    normalizePortraitPromptSettings,
    portraitPromptSettingsForPreset,
} from './portrait-prompt.js';
import { findNpcByReference } from './schema.js';

const SECTION_ID = 'npc_state_v3_portrait_prompt';
const PROMPT_OVERLAY_ID = 'npc_state_v3_portrait_prompt_overlay';
const STYLE_ID = 'npc_state_v3_portrait_workflow_style';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function ensureStyleSheet() {
    const doc = globalThis.document;
    if (!doc?.head || doc.getElementById(STYLE_ID)) return Boolean(doc?.getElementById?.(STYLE_ID));
    const link = doc.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./portrait-workflow.css', import.meta.url).href;
    doc.head.appendChild(link);
    return true;
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

function fieldHead(title, help) {
    return `<span class="npc-state-v3-portrait-field-head"><b>${escapeHtml(title)}</b><small>${escapeHtml(help)}</small></span>`;
}

function sectionHtml() {
    const placeholderText = PORTRAIT_PROMPT_PLACEHOLDERS.map(key => `{{${key}}}`).join(' · ');
    return `<details id="${SECTION_ID}" class="npc-state-v3-portrait-settings">
      <summary><b>Portrait prompt</b></summary>
      <div class="npc-state-v3-portrait-settings-body">
        <div class="npc-state-v3-portrait-intro">Prompt composition only. Presets are named reusable positive/negative pairs. NPC State does not call an image API or generate portraits automatically.</div>

        <div class="npc-state-v3-portrait-control-grid">
          <label class="npc-state-v3-portrait-control-row">
            ${fieldHead('Character formatting', 'Controls only the auto-built {{character}} placeholder.')}
            <select id="npc_state_v3_portrait_mode" class="text_pole"><option value="natural">Natural</option><option value="tags">Tags</option><option value="hybrid">Hybrid</option></select>
          </label>
          <label class="npc-state-v3-portrait-control-row">
            ${fieldHead('Default preset', 'Used by portrait-prompt API calls and preselected in the dossier prompt dialog.')}
            <select id="npc_state_v3_portrait_preset_select" class="text_pole"></select>
          </label>
        </div>

        <section class="npc-state-v3-portrait-card npc-state-v3-portrait-preset-card">
          <header class="npc-state-v3-portrait-card-head">
            <div><b>Preset library</b><small>Up to ${PORTRAIT_PRESET_LIMIT} named positive/negative pairs.</small></div>
            <div class="npc-state-v3-portrait-preset-actions">
              <button type="button" id="npc_state_v3_portrait_new_preset" class="menu_button"><i class="fa-solid fa-plus"></i> New</button>
              <button type="button" id="npc_state_v3_portrait_duplicate_preset" class="menu_button"><i class="fa-solid fa-clone"></i> Duplicate</button>
              <button type="button" id="npc_state_v3_portrait_delete_preset" class="menu_button redWarningBG"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
          </header>
          <label class="npc-state-v3-portrait-name-field">
            ${fieldHead('Preset name', 'Shown in the dossier prompt chooser.')}
            <input id="npc_state_v3_portrait_preset_name" class="text_pole" maxlength="80">
          </label>
          <div class="npc-state-v3-portrait-preset-pair">
            <label class="npc-state-v3-portrait-field-card">
              ${fieldHead('Positive preset', 'Reusable style, quality, lighting, and composition text. Insert with {{positivePreset}}.')}
              <textarea id="npc_state_v3_portrait_positive_preset" class="text_pole" rows="6"></textarea>
            </label>
            <label class="npc-state-v3-portrait-field-card">
              ${fieldHead('Negative preset', 'Reusable exclusions and negative-quality text. Insert with {{negativePreset}}.')}
              <textarea id="npc_state_v3_portrait_negative_preset" class="text_pole" rows="6"></textarea>
            </label>
          </div>
        </section>

        <section class="npc-state-v3-portrait-card">
          <header class="npc-state-v3-portrait-card-head"><div><b>Prompt templates</b><small>Shared by all presets. Presets supply style text; templates define how dossier facts are assembled.</small></div></header>
          <div class="npc-state-v3-portrait-template-pair">
            <label class="npc-state-v3-portrait-field-card">
              ${fieldHead('Positive prompt template', 'How the positive channel is assembled for the selected NPC.')}
              <textarea id="npc_state_v3_portrait_positive_template" class="text_pole" rows="7"></textarea>
            </label>
            <label class="npc-state-v3-portrait-field-card">
              ${fieldHead('Negative prompt template', 'May be only {{negativePreset}} or may include dossier placeholders too.')}
              <textarea id="npc_state_v3_portrait_negative_template" class="text_pole" rows="7"></textarea>
            </label>
          </div>
          <details class="npc-state-v3-portrait-placeholders"><summary><b>Available placeholders</b></summary><small>${escapeHtml(placeholderText)}</small></details>
        </section>

        <div class="npc-state-v3-portrait-save-row">
          <button id="npc_state_v3_portrait_save" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> Save portrait prompt settings</button>
          <span id="npc_state_v3_portrait_dirty" class="npc-state-muted"></span>
        </div>

        <section class="npc-state-v3-portrait-card npc-state-v3-portrait-preview-box">
          <header class="npc-state-v3-portrait-card-head"><div><b>Preview</b><small>Uses the currently edited preset and templates without saving first.</small></div></header>
          <label class="npc-state-v3-portrait-control-row">
            ${fieldHead('Preview NPC', 'Choose any stored dossier, including off-screen or archived NPCs.')}
            <select id="npc_state_v3_portrait_npc" class="text_pole"></select>
          </label>
          <div class="npc-state-v3-portrait-preview-pair">
            <label class="npc-state-v3-portrait-field-card"><span class="npc-state-v3-portrait-field-head"><b>Resolved positive</b></span><textarea id="npc_state_v3_portrait_positive_preview" class="text_pole" rows="10" readonly></textarea></label>
            <label class="npc-state-v3-portrait-field-card"><span class="npc-state-v3-portrait-field-head"><b>Resolved negative</b></span><textarea id="npc_state_v3_portrait_negative_preview" class="text_pole" rows="10" readonly></textarea></label>
          </div>
          <div class="npc-state-v3-portrait-copy-row">
            <button id="npc_state_v3_portrait_copy_positive" class="menu_button"><i class="fa-solid fa-copy"></i> Copy positive</button>
            <button id="npc_state_v3_portrait_copy_negative" class="menu_button"><i class="fa-solid fa-copy"></i> Copy negative</button>
            <button id="npc_state_v3_portrait_copy_both" class="menu_button"><i class="fa-solid fa-copy"></i> Copy both</button>
          </div>
        </section>
      </div>
    </details>`;
}

function promptOptionsHtml(library, selectedId) {
    return library.portraitPresets.map(preset => `<option value="${escapeHtml(preset.id)}" ${preset.id === selectedId ? 'selected' : ''}>${escapeHtml(preset.name)}${preset.id === library.portraitActivePresetId ? ' · default' : ''}</option>`).join('');
}

function promptOverlayHtml(npc, library) {
    return `<div class="npc-state-v3-prompt-shell" role="dialog" aria-modal="true" aria-label="Generate image prompt" data-npc-id="${escapeHtml(npc.id)}" tabindex="-1">
      <header class="npc-state-v3-prompt-header">
        <div><span class="npc-state-kicker">GENERATE IMAGE PROMPT</span><h2>${escapeHtml(npc.name)}</h2><small>Compose from the saved dossier. No image provider is called.</small></div>
        <button type="button" class="npc-state-v3-prompt-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="npc-state-v3-prompt-body">
        <label class="npc-state-v3-prompt-preset-row">
          ${fieldHead('Preset', 'Choose any saved positive/negative preset for this NPC. This does not change the default preset.')}
          <select id="npc_state_v3_prompt_preset" class="text_pole">${promptOptionsHtml(library, library.portraitActivePresetId)}</select>
        </label>
        <div class="npc-state-v3-prompt-preview-pair">
          <label><span class="npc-state-v3-portrait-field-head"><b>Positive prompt</b></span><textarea id="npc_state_v3_prompt_positive" class="text_pole" rows="16" readonly></textarea></label>
          <label><span class="npc-state-v3-portrait-field-head"><b>Negative prompt</b></span><textarea id="npc_state_v3_prompt_negative" class="text_pole" rows="16" readonly></textarea></label>
        </div>
      </div>
      <footer class="npc-state-v3-prompt-actions">
        <button type="button" class="menu_button npc-state-v3-prompt-copy-positive"><i class="fa-solid fa-copy"></i> Copy positive</button>
        <button type="button" class="menu_button npc-state-v3-prompt-copy-negative"><i class="fa-solid fa-copy"></i> Copy negative</button>
        <button type="button" class="menu_button npc-state-v3-prompt-copy-both"><i class="fa-solid fa-copy"></i> Copy both</button>
      </footer>
    </div>`;
}

export function createPortraitPromptUi(adapters = {}) {
    const engine = adapters.engine;
    const getSettings = adapters.getSettings;
    const persistSettings = adapters.persistSettings || (() => {});
    let dirty = false;
    let draft = null;
    let mountTimer = null;
    let dossierBridgeBound = false;

    function notify(kind, message) {
        const fn = globalThis.toastr?.[kind];
        if (typeof fn === 'function') fn(`NPC State: ${message}`);
    }

    function panel() { return globalThis.document?.getElementById?.(SECTION_ID) || null; }
    function promptOverlay() { return globalThis.document?.getElementById?.(PROMPT_OVERLAY_ID) || null; }
    function state() { return engine.getState?.() || null; }

    function savedDraft() {
        const settings = getSettings();
        const normalized = normalizePortraitPromptSettings(settings);
        const library = normalizePortraitPresetLibrary(settings);
        return {
            mode: normalized.portraitPromptMode,
            presets: structuredClone(library.portraitPresets),
            activeId: library.portraitActivePresetId,
            positivePrompt: normalized.portraitPositivePrompt,
            negativePrompt: normalized.portraitNegativePrompt,
        };
    }

    function ensureDraft() {
        if (!draft) draft = savedDraft();
        return draft;
    }

    function activeDraftPreset() {
        const current = ensureDraft();
        return current.presets.find(preset => preset.id === current.activeId) || current.presets[0] || null;
    }

    function draftAsSettings(selectedPresetId = '') {
        const current = ensureDraft();
        return {
            portraitPromptMode: current.mode,
            portraitPresets: structuredClone(current.presets),
            portraitActivePresetId: selectedPresetId || current.activeId,
            portraitPositivePrompt: current.positivePrompt,
            portraitNegativePrompt: current.negativePrompt,
        };
    }

    function captureActivePresetFields(root = panel()) {
        if (!root) return false;
        const preset = activeDraftPreset();
        if (!preset) return false;
        preset.name = String(root.querySelector('#npc_state_v3_portrait_preset_name')?.value || '').slice(0, 80);
        preset.positive = String(root.querySelector('#npc_state_v3_portrait_positive_preset')?.value || '');
        preset.negative = String(root.querySelector('#npc_state_v3_portrait_negative_preset')?.value || '');
        ensureDraft().mode = root.querySelector('#npc_state_v3_portrait_mode')?.value || 'hybrid';
        ensureDraft().positivePrompt = String(root.querySelector('#npc_state_v3_portrait_positive_template')?.value || '');
        ensureDraft().negativePrompt = String(root.querySelector('#npc_state_v3_portrait_negative_template')?.value || '');
        return true;
    }

    function renderPresetChoices(root = panel()) {
        if (!root) return false;
        const current = ensureDraft();
        const select = root.querySelector('#npc_state_v3_portrait_preset_select');
        if (!select) return false;
        select.innerHTML = current.presets.map(preset => `<option value="${escapeHtml(preset.id)}">${escapeHtml(String(preset.name || '').trim() || 'Untitled preset')}</option>`).join('');
        select.value = current.activeId;
        return true;
    }

    function renderActivePresetFields(root = panel()) {
        if (!root) return false;
        const preset = activeDraftPreset();
        if (!preset) return false;
        const name = root.querySelector('#npc_state_v3_portrait_preset_name');
        const positive = root.querySelector('#npc_state_v3_portrait_positive_preset');
        const negative = root.querySelector('#npc_state_v3_portrait_negative_preset');
        if (name) name.value = preset.name || '';
        if (positive) positive.value = preset.positive || '';
        if (negative) negative.value = preset.negative || '';
        const deleteButton = root.querySelector('#npc_state_v3_portrait_delete_preset');
        if (deleteButton) deleteButton.disabled = ensureDraft().presets.length <= 1;
        return true;
    }

    function loadDraftFields(root = panel()) {
        if (!root) return false;
        const current = ensureDraft();
        const mode = root.querySelector('#npc_state_v3_portrait_mode');
        const positiveTemplate = root.querySelector('#npc_state_v3_portrait_positive_template');
        const negativeTemplate = root.querySelector('#npc_state_v3_portrait_negative_template');
        if (mode) mode.value = current.mode;
        if (positiveTemplate) positiveTemplate.value = current.positivePrompt;
        if (negativeTemplate) negativeTemplate.value = current.negativePrompt;
        renderPresetChoices(root);
        renderActivePresetFields(root);
        return true;
    }

    function chosenNpc(root = panel()) {
        const id = root?.querySelector('#npc_state_v3_portrait_npc')?.value || '';
        return id ? findNpcByReference(state(), id) : null;
    }

    function renderPreview(root = panel()) {
        if (!root) return { positive: '', negative: '', combined: '' };
        captureActivePresetFields(root);
        const positivePreview = root.querySelector('#npc_state_v3_portrait_positive_preview');
        const negativePreview = root.querySelector('#npc_state_v3_portrait_negative_preview');
        const positiveButton = root.querySelector('#npc_state_v3_portrait_copy_positive');
        const negativeButton = root.querySelector('#npc_state_v3_portrait_copy_negative');
        const bothButton = root.querySelector('#npc_state_v3_portrait_copy_both');
        const npc = chosenNpc(root);
        const selectedSettings = portraitPromptSettingsForPreset(draftAsSettings(), ensureDraft().activeId);
        const values = npc ? buildPortraitPrompts(npc, selectedSettings) : { positive: '', negative: '', combined: '' };
        if (positivePreview) positivePreview.value = values.positive;
        if (negativePreview) negativePreview.value = values.negative;
        if (positiveButton) positiveButton.disabled = !values.positive;
        if (negativeButton) negativeButton.disabled = !values.negative;
        if (bothButton) bothButton.disabled = !values.positive && !values.negative;
        const dirtyLabel = root.querySelector('#npc_state_v3_portrait_dirty');
        if (dirtyLabel) dirtyLabel.textContent = dirty ? 'Unsaved changes' : 'Saved';
        return values;
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

    function markDirty(root = panel()) {
        dirty = true;
        renderPreview(root);
    }

    function switchPreset(id, root = panel()) {
        if (!root) return false;
        captureActivePresetFields(root);
        const current = ensureDraft();
        if (!current.presets.some(preset => preset.id === id)) return false;
        current.activeId = id;
        renderPresetChoices(root);
        renderActivePresetFields(root);
        dirty = true;
        renderPreview(root);
        return true;
    }

    function addPreset(root = panel()) {
        if (!root) return false;
        captureActivePresetFields(root);
        const current = ensureDraft();
        if (current.presets.length >= PORTRAIT_PRESET_LIMIT) {
            notify('warning', `portrait preset limit is ${PORTRAIT_PRESET_LIMIT}.`);
            return false;
        }
        const id = makePortraitPresetId('New preset', current.presets.map(preset => preset.id));
        current.presets.push({ id, name: 'New preset', positive: '', negative: '' });
        current.activeId = id;
        renderPresetChoices(root);
        renderActivePresetFields(root);
        dirty = true;
        renderPreview(root);
        root.querySelector('#npc_state_v3_portrait_preset_name')?.focus?.();
        return true;
    }

    function duplicatePreset(root = panel()) {
        if (!root) return false;
        captureActivePresetFields(root);
        const current = ensureDraft();
        const source = activeDraftPreset();
        if (!source) return false;
        if (current.presets.length >= PORTRAIT_PRESET_LIMIT) {
            notify('warning', `portrait preset limit is ${PORTRAIT_PRESET_LIMIT}.`);
            return false;
        }
        const name = `${String(source.name || 'Preset').trim() || 'Preset'} copy`.slice(0, 80);
        const id = makePortraitPresetId(name, current.presets.map(preset => preset.id));
        current.presets.push({ id, name, positive: source.positive, negative: source.negative });
        current.activeId = id;
        renderPresetChoices(root);
        renderActivePresetFields(root);
        dirty = true;
        renderPreview(root);
        return true;
    }

    function deletePreset(root = panel()) {
        if (!root) return false;
        const current = ensureDraft();
        if (current.presets.length <= 1) return false;
        const source = activeDraftPreset();
        if (!source) return false;
        if (globalThis.confirm && !globalThis.confirm(`Delete portrait preset “${source.name || 'Untitled preset'}”?`)) return false;
        const index = current.presets.findIndex(preset => preset.id === source.id);
        current.presets.splice(index, 1);
        current.activeId = current.presets[Math.max(0, index - 1)]?.id || current.presets[0].id;
        renderPresetChoices(root);
        renderActivePresetFields(root);
        dirty = true;
        renderPreview(root);
        return true;
    }

    async function save(root = panel()) {
        if (!root) return false;
        captureActivePresetFields(root);
        const current = ensureDraft();
        const normalizedLibrary = normalizePortraitPresetLibrary({
            portraitPresets: current.presets,
            portraitActivePresetId: current.activeId,
        });
        const normalized = normalizePortraitPromptSettings({
            portraitPromptMode: current.mode,
            portraitPresets: normalizedLibrary.portraitPresets,
            portraitActivePresetId: normalizedLibrary.portraitActivePresetId,
            portraitPositivePrompt: current.positivePrompt,
            portraitNegativePrompt: current.negativePrompt,
        });
        const settings = getSettings();
        settings.portraitPromptMode = normalized.portraitPromptMode;
        settings.portraitPresets = structuredClone(normalizedLibrary.portraitPresets);
        settings.portraitActivePresetId = normalizedLibrary.portraitActivePresetId;
        settings.portraitPreset = structuredClone(normalized.portraitPreset);
        settings.portraitPositivePrompt = normalized.portraitPositivePrompt;
        settings.portraitNegativePrompt = normalized.portraitNegativePrompt;
        delete settings.portraitGenerationPrompt;
        delete settings.portraitPositivePreset;
        delete settings.portraitNegativePreset;
        delete settings.portraitPresetName;
        persistSettings();
        draft = savedDraft();
        dirty = false;
        loadDraftFields(root);
        renderPreview(root);
        notify('success', `saved ${draft.presets.length} portrait preset${draft.presets.length === 1 ? '' : 's'} and prompt templates.`);
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
        root.querySelector('#npc_state_v3_portrait_mode')?.addEventListener('change', () => markDirty(root));
        root.querySelector('#npc_state_v3_portrait_preset_select')?.addEventListener('change', event => switchPreset(event.currentTarget.value, root));
        for (const selector of [
            '#npc_state_v3_portrait_preset_name',
            '#npc_state_v3_portrait_positive_preset',
            '#npc_state_v3_portrait_negative_preset',
            '#npc_state_v3_portrait_positive_template',
            '#npc_state_v3_portrait_negative_template',
        ]) {
            root.querySelector(selector)?.addEventListener('input', () => {
                captureActivePresetFields(root);
                if (selector === '#npc_state_v3_portrait_preset_name') renderPresetChoices(root);
                markDirty(root);
            });
        }
        root.querySelector('#npc_state_v3_portrait_npc')?.addEventListener('change', () => renderPreview(root));
        root.querySelector('#npc_state_v3_portrait_new_preset')?.addEventListener('click', () => addPreset(root));
        root.querySelector('#npc_state_v3_portrait_duplicate_preset')?.addEventListener('click', () => duplicatePreset(root));
        root.querySelector('#npc_state_v3_portrait_delete_preset')?.addEventListener('click', () => deletePreset(root));
        root.querySelector('#npc_state_v3_portrait_save')?.addEventListener('click', () => save(root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy_positive')?.addEventListener('click', () => copyChannel('positive', root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy_negative')?.addEventListener('click', () => copyChannel('negative', root).catch(error => notify('error', error.message)));
        root.querySelector('#npc_state_v3_portrait_copy_both')?.addEventListener('click', () => copyChannel('both', root).catch(error => notify('error', error.message)));
    }

    function renderPromptOverlay(root = promptOverlay()) {
        const shell = root?.querySelector('.npc-state-v3-prompt-shell');
        const npc = shell ? findNpcByReference(state(), shell.dataset.npcId || '') : null;
        const select = root?.querySelector('#npc_state_v3_prompt_preset');
        const presetId = select?.value || '';
        const selectedSettings = portraitPromptSettingsForPreset(getSettings(), presetId);
        const values = npc ? buildPortraitPrompts(npc, selectedSettings) : { positive: '', negative: '', combined: '' };
        const positive = root?.querySelector('#npc_state_v3_prompt_positive');
        const negative = root?.querySelector('#npc_state_v3_prompt_negative');
        if (positive) positive.value = values.positive;
        if (negative) negative.value = values.negative;
        root?.querySelector('.npc-state-v3-prompt-copy-positive')?.toggleAttribute('disabled', !values.positive);
        root?.querySelector('.npc-state-v3-prompt-copy-negative')?.toggleAttribute('disabled', !values.negative);
        root?.querySelector('.npc-state-v3-prompt-copy-both')?.toggleAttribute('disabled', !values.positive && !values.negative);
        return values;
    }

    async function copyPromptOverlay(channel, root = promptOverlay()) {
        const values = renderPromptOverlay(root);
        const value = channel === 'negative' ? values.negative : channel === 'both' ? values.combined : values.positive;
        if (!value) return false;
        await copyText(value);
        notify('success', channel === 'both' ? 'positive and negative portrait prompts copied.' : `${channel} portrait prompt copied.`);
        return true;
    }

    function closePrompt() {
        promptOverlay()?.remove();
        globalThis.document?.documentElement?.classList.remove('npc-state-v3-prompt-open');
        globalThis.document?.body?.classList.remove('npc-state-v3-prompt-open');
    }

    function openFor(reference) {
        const npc = findNpcByReference(state(), reference);
        if (!npc || !globalThis.document?.body) return false;
        ensureStyleSheet();
        closePrompt();
        const library = normalizePortraitPresetLibrary(getSettings());
        const overlay = globalThis.document.createElement('div');
        overlay.id = PROMPT_OVERLAY_ID;
        overlay.className = 'npc-state-v3-prompt-overlay';
        overlay.innerHTML = promptOverlayHtml(npc, library);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest?.('.npc-state-v3-prompt-close')) closePrompt();
        });
        const shell = overlay.querySelector('.npc-state-v3-prompt-shell');
        shell?.addEventListener('keydown', event => { if (event.key === 'Escape') closePrompt(); });
        overlay.querySelector('#npc_state_v3_prompt_preset')?.addEventListener('change', () => renderPromptOverlay(overlay));
        overlay.querySelector('.npc-state-v3-prompt-copy-positive')?.addEventListener('click', () => copyPromptOverlay('positive', overlay).catch(error => notify('error', error.message)));
        overlay.querySelector('.npc-state-v3-prompt-copy-negative')?.addEventListener('click', () => copyPromptOverlay('negative', overlay).catch(error => notify('error', error.message)));
        overlay.querySelector('.npc-state-v3-prompt-copy-both')?.addEventListener('click', () => copyPromptOverlay('both', overlay).catch(error => notify('error', error.message)));
        globalThis.document.body.appendChild(overlay);
        globalThis.document.documentElement?.classList.add('npc-state-v3-prompt-open');
        globalThis.document.body.classList.add('npc-state-v3-prompt-open');
        renderPromptOverlay(overlay);
        try { shell?.focus({ preventScroll: true }); } catch { shell?.focus?.(); }
        return true;
    }

    function bindDossierBridge() {
        if (dossierBridgeBound || !globalThis.document?.addEventListener) return false;
        dossierBridgeBound = true;
        globalThis.document.addEventListener('click', event => {
            const button = event.target?.closest?.('.npc-state-v3-generate-image-prompt');
            if (!button) return;
            event.preventDefault();
            button.closest?.('details')?.removeAttribute?.('open');
            openFor(button.dataset.npcId || '');
        });
        return true;
    }

    function attach() {
        ensureStyleSheet();
        bindDossierBridge();
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
        draft = savedDraft();
        dirty = false;
        loadDraftFields(section);
        syncNpcChoices(section);
        renderPreview(section);
        return true;
    }

    function refresh() {
        ensureStyleSheet();
        bindDossierBridge();
        if (!attach()) return false;
        const root = panel();
        if (!dirty) {
            draft = savedDraft();
            loadDraftFields(root);
        }
        syncNpcChoices(root);
        renderPreview(root);
        if (promptOverlay()) {
            const select = promptOverlay().querySelector('#npc_state_v3_prompt_preset');
            const previous = select?.value || '';
            const library = normalizePortraitPresetLibrary(getSettings());
            if (select) {
                select.innerHTML = promptOptionsHtml(library, previous);
                select.value = library.portraitPresets.some(preset => preset.id === previous) ? previous : library.portraitActivePresetId;
            }
            renderPromptOverlay(promptOverlay());
        }
        return true;
    }

    function scheduleMount() {
        ensureStyleSheet();
        bindDossierBridge();
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

    function buildPairFor(reference, presetId = '') {
        const npc = findNpcByReference(state(), reference);
        const settings = portraitPromptSettingsForPreset(getSettings(), presetId);
        return npc ? buildPortraitPrompts(npc, settings) : { positive: '', negative: '', combined: '' };
    }

    function buildFor(reference, presetId = '') {
        const npc = findNpcByReference(state(), reference);
        const settings = portraitPromptSettingsForPreset(getSettings(), presetId);
        return npc ? buildPortraitPrompt(npc, settings) : '';
    }

    async function copyPositiveFor(reference, presetId = '') {
        const value = buildPairFor(reference, presetId).positive;
        if (!value) return false;
        await copyText(value);
        notify('success', 'positive portrait prompt copied.');
        return true;
    }

    async function copyNegativeFor(reference, presetId = '') {
        const value = buildPairFor(reference, presetId).negative;
        if (!value) return false;
        await copyText(value);
        notify('success', 'negative portrait prompt copied.');
        return true;
    }

    async function copyBothFor(reference, presetId = '') {
        const value = buildPairFor(reference, presetId).combined;
        if (!value) return false;
        await copyText(value);
        notify('success', 'positive and negative portrait prompts copied.');
        return true;
    }

    // Backward-compatible original helper copies the positive channel.
    async function copyFor(reference, presetId = '') {
        return copyPositiveFor(reference, presetId);
    }

    return Object.freeze({
        scheduleMount,
        refresh,
        openFor,
        closePrompt,
        buildFor,
        buildPairFor,
        copyFor,
        copyPositiveFor,
        copyNegativeFor,
        copyBothFor,
        get dirty() { return dirty; },
    });
}
