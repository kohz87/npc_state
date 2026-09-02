import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PORTRAIT_PRESET,
    DEFAULT_PORTRAIT_PRESET_ID,
    buildPortraitPrompts,
    makePortraitPresetId,
    normalizePortraitPresetLibrary,
    portraitPromptSettingsForPreset,
} from '../v03/portrait-prompt.js';
import { dossierHtml } from '../v03/dossier-view.js';
import { normalizeNpc } from '../v03/schema.js';

function npc() {
    return normalizeNpc({
        id: 'npc-maren',
        name: 'Maren Kroll',
        role: 'Guild Clerk',
        species: 'Human',
        appearance: 'Dark hair, grey vest, ink-stained fingers.',
    });
}

test('legacy single portrait preset becomes the first named preset without losing either channel', () => {
    const library = normalizePortraitPresetLibrary({
        portraitPreset: {
            positive: 'legacy positive style',
            negative: 'legacy negative style',
        },
    });
    assert.equal(library.portraitPresets.length, 1);
    assert.equal(library.portraitPresets[0].id, DEFAULT_PORTRAIT_PRESET_ID);
    assert.equal(library.portraitPresets[0].name, 'Default');
    assert.equal(library.portraitPresets[0].positive, 'legacy positive style');
    assert.equal(library.portraitPresets[0].negative, 'legacy negative style');
    assert.equal(library.portraitActivePresetId, DEFAULT_PORTRAIT_PRESET_ID);
});

test('empty portrait settings still create the normal default preset pair', () => {
    const library = normalizePortraitPresetLibrary({});
    assert.deepEqual(library.portraitPresets[0], {
        id: DEFAULT_PORTRAIT_PRESET_ID,
        name: 'Default',
        positive: DEFAULT_PORTRAIT_PRESET.positive,
        negative: DEFAULT_PORTRAIT_PRESET.negative,
    });
});

test('named preset library preserves the selected default and can resolve another preset without mutating it', () => {
    const settings = {
        portraitPromptMode: 'tags',
        portraitPresets: [
            { id: 'preset-anime', name: 'Anime', positive: 'anime style', negative: 'photorealistic' },
            { id: 'preset-painterly', name: 'Painterly', positive: 'oil painting', negative: 'flat cel shading' },
        ],
        portraitActivePresetId: 'preset-anime',
        portraitPositivePrompt: '{{positivePreset}} | {{character}}',
        portraitNegativePrompt: '{{negativePreset}}',
    };
    const library = normalizePortraitPresetLibrary(settings);
    assert.equal(library.portraitActivePresetId, 'preset-anime');

    const painterly = portraitPromptSettingsForPreset(settings, 'preset-painterly');
    const result = buildPortraitPrompts(npc(), painterly);
    assert.match(result.positive, /^oil painting \| Maren Kroll, Human, Guild Clerk/);
    assert.equal(result.negative, 'flat cel shading');
    assert.equal(normalizePortraitPresetLibrary(settings).portraitActivePresetId, 'preset-anime');
});

test('preset ids are deterministic and collision-safe for duplicate names', () => {
    assert.equal(makePortraitPresetId('Violet Evergarden', []), 'preset-violet-evergarden');
    assert.equal(makePortraitPresetId('Violet Evergarden', ['preset-violet-evergarden']), 'preset-violet-evergarden-2');
});

test('canonical dossier More menu exposes Generate image prompt for the exact stable NPC id', () => {
    const html = dossierHtml(npc());
    assert.match(html, /npc-state-v3-generate-image-prompt/);
    assert.match(html, /Generate image prompt/);
    assert.match(html, /data-npc-id="npc-maren"/);
});
