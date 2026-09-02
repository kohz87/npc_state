from pathlib import Path

path = Path(__file__).resolve().with_name('apply_v023.py')
text = path.read_text(encoding='utf-8')

start = text.index("portrait_bind_pattern = r'''")
end_marker = "index = regex_once(index, portrait_bind_pattern, portrait_bind_replacement, 'portrait UI binding transaction')"
end = text.index(end_marker, start) + len(end_marker)

replacement = r"""portrait_bind_old = '''    bindSettingsCheckbox('#npc_state_portrait_generation_enabled', 'portraitGenerationEnabled', refreshNpcViewer);
    $(document).on('change.npcState', '#npc_state_portrait_theme_preset', function () {
        const settings = getSettings();
        const key = PORTRAIT_THEME_PRESETS[this.value] ? this.value : 'custom';
        settings.portraitThemePreset = key;
        const preset = PORTRAIT_THEME_PRESETS[key];
        if (key !== 'custom') {
            settings.portraitStylePositive = preset.positive;
            settings.portraitStyleNegative = preset.negative;
        }
        syncSettingsControls(); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_portrait_style_positive, #npc_state_portrait_style_negative', function () {
        const settings = getSettings();
        settings.portraitStylePositive = String($('#npc_state_portrait_style_positive').val() || '').slice(0, 2400);
        settings.portraitStyleNegative = String($('#npc_state_portrait_style_negative').val() || '').slice(0, 2400);
        settings.portraitThemePreset = 'custom';
        syncSettingsControls(); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_portrait_composition', function () {
        getSettings().portraitComposition = String(this.value || '').slice(0, 1200); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_portrait_prompt_format', function () {
        getSettings().portraitPromptFormat = normalizePortraitPromptFormat(this.value); this.value = getSettings().portraitPromptFormat; persistSettings();
    });
    bindSettingsCheckbox('#npc_state_portrait_use_mood', 'portraitUseMood');
    bindSettingsCheckbox('#npc_state_portrait_use_location', 'portraitUseLocation');
    bindSettingsCheckbox('#npc_state_portrait_save_gallery', 'portraitSaveToGallery');
    $(document).on('click.npcState', '#npc_state_reset_portrait_theme', () => {
        const settings = getSettings();
        settings.portraitThemePreset = 'fantasy_anime';
        settings.portraitStylePositive = DEFAULT_PORTRAIT_STYLE_POSITIVE;
        settings.portraitStyleNegative = DEFAULT_PORTRAIT_STYLE_NEGATIVE;
        settings.portraitComposition = DEFAULT_PORTRAIT_COMPOSITION;
        settings.portraitPromptFormat = 'hybrid';
        settings.portraitUseMood = true;
        settings.portraitUseLocation = false;
        settings.portraitSaveToGallery = false;
        syncSettingsControls(); persistSettings();
        globalThis.toastr?.success?.('NPC State: portrait generation theme reset to Fantasy Anime defaults.');
    });'''
portrait_bind_new = '''    $(document).on('change.npcState', '#npc_state_portrait_theme_preset', function () {
        const key = PORTRAIT_THEME_PRESETS[this.value] ? this.value : 'custom';
        const preset = PORTRAIT_THEME_PRESETS[key];
        if (key !== 'custom' && preset) {
            $('#npc_state_portrait_style_positive').val(preset.positive);
            $('#npc_state_portrait_style_negative').val(preset.negative);
        }
        markPortraitSettingsDirty();
    });
    $(document).on('input.npcState', '#npc_state_portrait_style_positive, #npc_state_portrait_style_negative, #npc_state_portrait_composition', function () {
        if (this.id === 'npc_state_portrait_style_positive' || this.id === 'npc_state_portrait_style_negative') {
            $('#npc_state_portrait_theme_preset').val('custom');
        }
        markPortraitSettingsDirty();
    });
    $(document).on('change.npcState', '#npc_state_portrait_generation_enabled, #npc_state_portrait_prompt_format, #npc_state_portrait_use_mood, #npc_state_portrait_use_location, #npc_state_portrait_save_gallery', () => {
        markPortraitSettingsDirty();
    });
    $(document).on('click.npcState', '#npc_state_reset_portrait_theme', () => {
        writePortraitSettingsDraftToUi({
            portraitGenerationEnabled: true,
            portraitThemePreset: 'fantasy_anime',
            portraitStylePositive: DEFAULT_PORTRAIT_STYLE_POSITIVE,
            portraitStyleNegative: DEFAULT_PORTRAIT_STYLE_NEGATIVE,
            portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
            portraitPromptFormat: 'hybrid',
            portraitUseMood: true,
            portraitUseLocation: false,
            portraitSaveToGallery: false,
        });
        markPortraitSettingsDirty();
        globalThis.toastr?.info?.('NPC State: Fantasy Anime defaults loaded as an unsaved portrait-settings draft.');
    });
    $(document).on('click.npcState', '#npc_state_save_portrait_settings', () => { void savePortraitSettingsDraft(); });'''
index = replace_once(index, portrait_bind_old, portrait_bind_new, 'portrait UI binding transaction')"""

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding='utf-8')
print('v0.2.23 patch-script portrait splice corrected')
