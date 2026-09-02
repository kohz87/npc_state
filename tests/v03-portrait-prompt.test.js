import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PORTRAIT_NEGATIVE_PROMPT,
    DEFAULT_PORTRAIT_POSITIVE_PROMPT,
    DEFAULT_PORTRAIT_PRESET,
    buildPortraitCharacterBlock,
    buildPortraitPrompt,
    buildPortraitPrompts,
    normalizePortraitPromptSettings,
} from '../v03/portrait-prompt.js';
import { normalizeNpc } from '../v03/schema.js';

function astra() {
    return normalizeNpc({
        id: 'npc-astra',
        name: 'Astra',
        role: 'Guesthouse Keeper',
        species: 'Human',
        age: '25',
        apparentAge: '25',
        appearance: 'Dark brown hair pinned loosely, amber eyes, grey wool dress.',
        personality: 'Soft-spoken, tired, observant.',
        mannerisms: ['Lowers her eyes when embarrassed', 'Fidgets with her apron'],
        mood: 'Relieved but exhausted',
        status: 'Uninjured',
    });
}

test('portrait settings normalize to paired positive and negative preset/template channels', () => {
    assert.deepEqual(normalizePortraitPromptSettings({}), {
        portraitPromptMode: 'hybrid',
        portraitPreset: {
            positive: DEFAULT_PORTRAIT_PRESET.positive,
            negative: DEFAULT_PORTRAIT_PRESET.negative,
        },
        portraitPositivePrompt: DEFAULT_PORTRAIT_POSITIVE_PROMPT,
        portraitNegativePrompt: DEFAULT_PORTRAIT_NEGATIVE_PROMPT,
    });
    assert.equal(normalizePortraitPromptSettings({ portraitPromptMode: 'tags' }).portraitPromptMode, 'tags');
    assert.equal(normalizePortraitPromptSettings({ portraitPromptMode: 'anything-else' }).portraitPromptMode, 'hybrid');
});

test('legacy single preset and generation prompt migrate into the positive side without losing user text', () => {
    const normalized = normalizePortraitPromptSettings({
        portraitPromptMode: 'natural',
        portraitPreset: 'my old positive preset',
        portraitGenerationPrompt: '{{portraitPreset}} :: {{character}}',
    });
    assert.equal(normalized.portraitPreset.positive, 'my old positive preset');
    assert.equal(normalized.portraitPreset.negative, DEFAULT_PORTRAIT_PRESET.negative);
    assert.equal(normalized.portraitPositivePrompt, '{{positivePreset}} :: {{character}}');
    assert.equal(normalized.portraitNegativePrompt, DEFAULT_PORTRAIT_NEGATIVE_PROMPT);
});

test('natural, tags, and hybrid modes change only the auto-built character block', () => {
    const npc = astra();
    const natural = buildPortraitCharacterBlock(npc, 'natural');
    const tags = buildPortraitCharacterBlock(npc, 'tags');
    const hybrid = buildPortraitCharacterBlock(npc, 'hybrid');

    assert.match(natural, /^Portrait of Astra/);
    assert.match(natural, /Appearance:/);
    assert.match(tags, /^Astra, Human, Guesthouse Keeper/);
    assert.equal(tags.includes('Appearance:'), false);
    assert.match(hybrid, /^Astra, Human, Guesthouse Keeper/);
    assert.match(hybrid, /Appearance:/);
});

test('paired templates resolve their own presets plus shared dossier placeholders', () => {
    const result = buildPortraitPrompts(astra(), {
        portraitPromptMode: 'natural',
        portraitPreset: {
            positive: 'cinematic fantasy portrait',
            negative: 'blurry, watermark',
        },
        portraitPositivePrompt: '{{positivePreset}}\n{{name}} | {{role}}\n{{character}}',
        portraitNegativePrompt: '{{negativePreset}}, wrong role: {{role}}',
    });
    assert.match(result.positive, /^cinematic fantasy portrait\nAstra \| Guesthouse Keeper\nPortrait of Astra/);
    assert.equal(result.negative, 'blurry, watermark, wrong role: Guesthouse Keeper');
    assert.match(result.combined, /^POSITIVE\n/);
    assert.match(result.combined, /\n\nNEGATIVE\n/);
});

test('legacy buildPortraitPrompt helper remains the positive-channel result', () => {
    const settings = {
        portraitPromptMode: 'tags',
        portraitPreset: { positive: 'anime portrait', negative: 'bad anatomy' },
        portraitPositivePrompt: '{{positivePreset}}, {{character}}',
        portraitNegativePrompt: '{{negativePreset}}',
    };
    const pair = buildPortraitPrompts(astra(), settings);
    assert.equal(buildPortraitPrompt(astra(), settings), pair.positive);
    assert.match(pair.positive, /^anime portrait, Astra, Human/);
    assert.equal(pair.negative, 'bad anatomy');
});

test('free-form positive and negative templates are not rewritten beyond placeholder resolution', () => {
    const result = buildPortraitPrompts(astra(), {
        portraitPromptMode: 'hybrid',
        portraitPreset: { positive: 'painterly fantasy', negative: 'text, watermark' },
        portraitPositivePrompt: 'Style: {{positivePreset}}\nSubject: {{character}}',
        portraitNegativePrompt: 'Avoid: {{negativePreset}}',
    });
    assert.match(result.positive, /^Style: painterly fantasy\nSubject: Astra, Human/);
    assert.match(result.positive, /Appearance:/);
    assert.equal(result.negative, 'Avoid: text, watermark');
});

test('unknown placeholders remain visible in either channel instead of silently disappearing', () => {
    const result = buildPortraitPrompts(astra(), {
        portraitPromptMode: 'hybrid',
        portraitPreset: { positive: '', negative: '' },
        portraitPositivePrompt: '{{name}} {{typoField}}',
        portraitNegativePrompt: '{{anotherTypo}}',
    });
    assert.equal(result.positive, 'Astra {{typoField}}');
    assert.equal(result.negative, '{{anotherTypo}}');
});

test('intentionally blank positive or negative templates remain blank', () => {
    const result = buildPortraitPrompts(astra(), {
        portraitPreset: { positive: 'positive preset', negative: 'negative preset' },
        portraitPositivePrompt: '',
        portraitNegativePrompt: '',
    });
    assert.equal(result.positive, '');
    assert.equal(result.negative, '');
    assert.equal(result.combined, 'POSITIVE\n\n\nNEGATIVE');
});

test('empty dossier fields resolve cleanly and do not manufacture portrait facts', () => {
    const npc = normalizeNpc({ id: 'npc-quiet', name: 'Quiet Stranger' });
    const result = buildPortraitPrompts(npc, {
        portraitPromptMode: 'natural',
        portraitPreset: { positive: '', negative: '' },
        portraitPositivePrompt: '{{character}}\nSpecies={{species}}\nMood={{mood}}',
        portraitNegativePrompt: '{{negativePreset}}',
    });
    assert.match(result.positive, /^Portrait of Quiet Stranger\./);
    assert.match(result.positive, /Species=/);
    assert.match(result.positive, /Mood=/);
    assert.equal(result.positive.includes('human'), false);
    assert.equal(result.negative, '');
});
