export const PORTRAIT_PROMPT_MODES = Object.freeze(['natural', 'tags', 'hybrid']);

export const DEFAULT_PORTRAIT_PRESET = Object.freeze({
    positive: 'solo character portrait, upper body, centered composition, face clearly visible',
    negative: 'low quality, blurry, low resolution, bad anatomy, malformed hands, extra fingers, missing fingers, extra limbs, duplicate body parts, distorted face, text, watermark',
});
export const DEFAULT_PORTRAIT_POSITIVE_PROMPT = '{{positivePreset}}\n{{character}}';
export const DEFAULT_PORTRAIT_NEGATIVE_PROMPT = '{{negativePreset}}';
// Backward-compatible alias for callers from the first lightweight portrait-prompt pass.
export const DEFAULT_PORTRAIT_GENERATION_PROMPT = DEFAULT_PORTRAIT_POSITIVE_PROMPT;

function cleanText(value, max = 12000) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function inlineText(value, max = 2400) {
    return cleanText(value, max).replace(/\s+/g, ' ').trim();
}

function listText(value, maxItems = 12, itemMax = 500) {
    const input = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return input.map(item => inlineText(item, itemMax)).filter(Boolean).slice(0, maxItems);
}

function normalizePreset(input = {}) {
    const hasLegacyPreset = typeof input.portraitPreset === 'string';
    const legacyPreset = hasLegacyPreset ? input.portraitPreset : '';
    const objectPreset = input.portraitPreset && typeof input.portraitPreset === 'object' && !Array.isArray(input.portraitPreset)
        ? input.portraitPreset
        : {};
    const positiveSource = Object.hasOwn(objectPreset, 'positive')
        ? objectPreset.positive
        : input.portraitPositivePreset !== undefined
            ? input.portraitPositivePreset
            : hasLegacyPreset
                ? legacyPreset
                : DEFAULT_PORTRAIT_PRESET.positive;
    const negativeSource = Object.hasOwn(objectPreset, 'negative')
        ? objectPreset.negative
        : input.portraitNegativePreset !== undefined
            ? input.portraitNegativePreset
            : DEFAULT_PORTRAIT_PRESET.negative;
    return {
        positive: cleanText(positiveSource),
        negative: cleanText(negativeSource),
    };
}

export function normalizePortraitPromptSettings(input = {}) {
    const mode = PORTRAIT_PROMPT_MODES.includes(String(input.portraitPromptMode)) ? String(input.portraitPromptMode) : 'hybrid';
    const positivePrompt = cleanText(
        input.portraitPositivePrompt
        ?? input.portraitGenerationPrompt
        ?? DEFAULT_PORTRAIT_POSITIVE_PROMPT,
    ).replace(/\{\{\s*portraitPreset\s*\}\}/g, '{{positivePreset}}');
    return {
        portraitPromptMode: mode,
        portraitPreset: normalizePreset(input),
        portraitPositivePrompt: positivePrompt,
        portraitNegativePrompt: cleanText(input.portraitNegativePrompt ?? DEFAULT_PORTRAIT_NEGATIVE_PROMPT),
    };
}

function identityBits(npc = {}) {
    const bits = [];
    const species = inlineText(npc.species, 160);
    const role = inlineText(npc.role, 240);
    const apparentAge = inlineText(npc.apparentAge, 80);
    const age = inlineText(npc.age, 80);
    if (species) bits.push(species);
    if (role) bits.push(role);
    if (apparentAge) bits.push(`apparent age ${apparentAge}`);
    else if (age) bits.push(`age ${age}`);
    return bits;
}

function naturalCharacter(npc = {}) {
    const name = inlineText(npc.name, 120) || 'Unknown NPC';
    const identity = identityBits(npc);
    const sentences = [`Portrait of ${name}${identity.length ? `, ${identity.join(', ')}` : ''}.`];
    const appearance = inlineText(npc.appearance, 3000);
    const personality = inlineText(npc.personality, 1600);
    const mannerisms = listText(npc.mannerisms, 8, 300).join('; ');
    const mood = inlineText(npc.mood, 240);
    const status = inlineText(npc.status, 360);
    if (appearance) sentences.push(`Appearance: ${appearance}.`);
    if (personality) sentences.push(`Character bearing: ${personality}.`);
    if (mannerisms) sentences.push(`Mannerisms: ${mannerisms}.`);
    if (mood) sentences.push(`Current expression or mood: ${mood}.`);
    if (status) sentences.push(`Current condition: ${status}.`);
    return sentences.join(' ').replace(/\.\./g, '.').trim();
}

function tagsCharacter(npc = {}) {
    const tags = [];
    const push = value => {
        const valueText = inlineText(value, 3000).replace(/[;,]+$/g, '').trim();
        if (valueText) tags.push(valueText);
    };
    push(npc.name);
    for (const bit of identityBits(npc)) push(bit);
    push(npc.appearance);
    for (const mannerism of listText(npc.mannerisms, 8, 300)) push(mannerism);
    push(npc.mood);
    push(npc.status);
    return tags.join(', ');
}

function hybridCharacter(npc = {}) {
    const name = inlineText(npc.name, 120) || 'Unknown NPC';
    const tags = [name, ...identityBits(npc)].filter(Boolean).join(', ');
    const prose = [];
    const appearance = inlineText(npc.appearance, 3000);
    const personality = inlineText(npc.personality, 1600);
    const mannerisms = listText(npc.mannerisms, 8, 300).join('; ');
    const mood = inlineText(npc.mood, 240);
    const status = inlineText(npc.status, 360);
    if (appearance) prose.push(`Appearance: ${appearance}.`);
    if (personality) prose.push(`Bearing: ${personality}.`);
    if (mannerisms) prose.push(`Mannerisms: ${mannerisms}.`);
    if (mood) prose.push(`Expression/mood: ${mood}.`);
    if (status) prose.push(`Condition: ${status}.`);
    return [tags, prose.join(' ')].filter(Boolean).join('. ').replace(/\.\./g, '.').trim();
}

export function buildPortraitCharacterBlock(npc = {}, mode = 'hybrid') {
    if (mode === 'natural') return naturalCharacter(npc);
    if (mode === 'tags') return tagsCharacter(npc);
    return hybridCharacter(npc);
}

export const PORTRAIT_PROMPT_PLACEHOLDERS = Object.freeze([
    'positivePreset', 'negativePreset', 'character', 'name', 'aliases', 'role', 'species', 'age', 'apparentAge',
    'appearance', 'personality', 'behaviorProfile', 'speech', 'mannerisms', 'background',
    'mood', 'location', 'goal', 'status',
]);

function placeholderValues(npc = {}, settings = {}) {
    const normalized = normalizePortraitPromptSettings(settings);
    return {
        positivePreset: normalized.portraitPreset.positive,
        negativePreset: normalized.portraitPreset.negative,
        // Legacy alias remains accepted so hand-written templates from the first pass still resolve safely.
        portraitPreset: normalized.portraitPreset.positive,
        character: buildPortraitCharacterBlock(npc, normalized.portraitPromptMode),
        name: inlineText(npc.name, 120),
        aliases: listText(npc.aliases, 10, 120).join(', '),
        role: inlineText(npc.role, 240),
        species: inlineText(npc.species, 160),
        age: inlineText(npc.age, 80),
        apparentAge: inlineText(npc.apparentAge, 80),
        appearance: inlineText(npc.appearance, 3000),
        personality: inlineText(npc.personality, 1600),
        behaviorProfile: listText(npc.behaviorProfile, 8, 360).join(', '),
        speech: inlineText(npc.speech, 1200),
        mannerisms: listText(npc.mannerisms, 8, 300).join(', '),
        background: inlineText(npc.background, 2200),
        mood: inlineText(npc.mood, 240),
        location: inlineText(npc.location, 360),
        goal: inlineText(npc.goal, 600),
        status: inlineText(npc.status, 360),
    };
}

function renderTemplate(template, values) {
    const rendered = String(template || '').replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (match, key) => (
        Object.hasOwn(values, key) ? values[key] : match
    ));
    return rendered
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function buildPortraitPrompts(npc = {}, settings = {}) {
    const normalized = normalizePortraitPromptSettings(settings);
    const values = placeholderValues(npc, normalized);
    const positive = renderTemplate(normalized.portraitPositivePrompt || DEFAULT_PORTRAIT_POSITIVE_PROMPT, values);
    const negative = renderTemplate(normalized.portraitNegativePrompt || DEFAULT_PORTRAIT_NEGATIVE_PROMPT, values);
    const combined = [
        `POSITIVE\n${positive}`,
        `NEGATIVE\n${negative}`,
    ].join('\n\n').trim();
    return { positive, negative, combined };
}

// Backward-compatible helper: the original lightweight API represented only the positive channel.
export function buildPortraitPrompt(npc = {}, settings = {}) {
    return buildPortraitPrompts(npc, settings).positive;
}
