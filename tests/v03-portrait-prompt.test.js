import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PORTRAIT_GENERATION_PROMPT,
    DEFAULT_PORTRAIT_PRESET,
    buildPortraitCharacterBlock,
    buildPortraitPrompt,
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

test('portrait prompt settings normalize to a small three-mode schema', () => {
    assert.deepEqual(normalizePortraitPromptSettings({}), {
        portraitPromptMode: 'hybrid',
        portraitPreset: DEFAULT_PORTRAIT_PRESET,
        portraitGenerationPrompt: DEFAULT_PORTRAIT_GENERATION_PROMPT,
    });
    assert.equal(normalizePortraitPromptSettings({ portraitPromptMode: 'tags' }).portraitPromptMode, 'tags');
    assert.equal(normalizePortraitPromptSettings({ portraitPromptMode: 'anything-else' }).portraitPromptMode, 'hybrid');
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

test('generation template resolves preset, character, and direct dossier placeholders', () => {
    const result = buildPortraitPrompt(astra(), {
        portraitPromptMode: 'natural',
        portraitPreset: 'cinematic fantasy portrait',
        portraitGenerationPrompt: '{{portraitPreset}}\n{{name}} | {{role}}\n{{character}}',
    });
    assert.match(result, /^cinematic fantasy portrait\nAstra \| Guesthouse Keeper\nPortrait of Astra/);
    assert.equal(result.includes('{{name}}'), false);
    assert.equal(result.includes('{{portraitPreset}}'), false);
});

test('free-form templates support tags and hybrid composition without rewriting user text', () => {
    const tags = buildPortraitPrompt(astra(), {
        portraitPromptMode: 'tags',
        portraitPreset: 'anime portrait, clean linework',
        portraitGenerationPrompt: 'POSITIVE: {{portraitPreset}}, {{character}}',
    });
    assert.match(tags, /^POSITIVE: anime portrait, clean linework, Astra, Human/);

    const hybrid = buildPortraitPrompt(astra(), {
        portraitPromptMode: 'hybrid',
        portraitPreset: 'painterly fantasy',
        portraitGenerationPrompt: 'Style: {{portraitPreset}}\nSubject: {{character}}',
    });
    assert.match(hybrid, /^Style: painterly fantasy\nSubject: Astra, Human/);
    assert.match(hybrid, /Appearance:/);
});

test('unknown placeholders remain visible instead of silently disappearing', () => {
    const result = buildPortraitPrompt(astra(), {
        portraitPromptMode: 'hybrid',
        portraitPreset: '',
        portraitGenerationPrompt: '{{name}} {{typoField}}',
    });
    assert.equal(result, 'Astra {{typoField}}');
});

test('empty dossier fields resolve cleanly and do not manufacture portrait facts', () => {
    const npc = normalizeNpc({ id: 'npc-quiet', name: 'Quiet Stranger' });
    const result = buildPortraitPrompt(npc, {
        portraitPromptMode: 'natural',
        portraitPreset: '',
        portraitGenerationPrompt: '{{character}}\nSpecies={{species}}\nMood={{mood}}',
    });
    assert.match(result, /^Portrait of Quiet Stranger\./);
    assert.match(result, /Species=/);
    assert.match(result, /Mood=/);
    assert.equal(result.includes('human'), false);
});
