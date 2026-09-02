import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-migration-'));
const extRoot = path.join(tempRoot, 'public', 'scripts', 'extensions', 'third-party', 'npc_state');
fs.mkdirSync(extRoot, { recursive: true });
for (const name of ['index.js', 'core.js', 'bundle.js', 'branch.js', 'social.js', 'storage.js']) fs.copyFileSync(path.join(sourceRoot, name), path.join(extRoot, name));
fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }));

const legacyNpc = {
    id: 'npc_yunyun', name: 'Yunyun', aliases: [], memories: [], importance: 50, age: 'young',
    relationship: { trust: 60, affection: 35, respect: 88, tension: 12 },
    thoughts: { current: 'Legacy thought that should not survive v0.1.15.', certainty: 'inferred', sourceMessageId: 0 },
    portrait: null, createdAt: 1, updatedAt: 2, lastSeenTurn: 1, seenCount: 1, manual: false,
};
const mock = {
    extensionSettings: {
        npc_state: {
            enabled: true, autoScan: true, scanEvery: 2, scanDepth: 8, maxNpcs: 6,
            inject: true, injectDepth: 1, injectLimit: 3, branchRescan: true,
            relationshipBaseline: { trust: 50, affection: 20, desire: 0, tension: 10 },
            chats: {
                'chat:legacy-chat': {
                    npcs: [legacyNpc], turn: 1, assistantSinceScan: 0, lastScanAt: 0,
                    lastScannedMessageId: null, scanCount: 0, dismissed: [], processedOocMessageId: null,
                    inlineCards: [{
                        messageId: 0, fingerprint: 'legacy', reason: 'scan', createdAt: 1,
                        cards: [{ ...legacyNpc, lastRelationshipChange: { impact: 'ordinary' } }],
                    }], portraitAssets: {}, checkpoints: [], lineage: [],
                },
            },
        },
    },
    files: new Map(), listeners: new Map(), prompts: [],
};
globalThis.__npcMock = mock;
fs.writeFileSync(path.join(tempRoot, 'public', 'scripts', 'extensions.js'), `
export const extension_settings = globalThis.__npcMock.extensionSettings;
export function getContext() { return globalThis.__npcMock.context; }
`);
fs.writeFileSync(path.join(tempRoot, 'public', 'script.js'), `
export const extension_prompt_types = { IN_CHAT: 1 };
export const extension_prompt_roles = { SYSTEM: 0 };
export function getRequestHeaders() { return { 'Content-Type': 'application/json' }; }
`);
const eventSource = { on(name, fn) { const list = mock.listeners.get(name) || []; list.push(fn); mock.listeners.set(name, list); } };
mock.context = {
    chatId: 'legacy-chat', getCurrentChatId: () => 'legacy-chat', chat: [],
    characters: [{ name: 'Megumin', avatar: 'megumin.png' }], characterId: 0, groupId: null,
    name1: 'Kazuma', name2: 'Megumin', saveSettingsDebounced() {}, setExtensionPrompt(...args) { mock.prompts.push(args); },
    eventSource, eventTypes: {}, generateRaw: async () => '{"npcs":[]}',
};
globalThis.window = globalThis;
globalThis.toastr = { warning() {}, error() {}, success() {}, info() {} };
globalThis.document = {
    body: { appendChild() {} }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, dataset: {}, click() {}, remove() {} }; },
};
let mounted = false;
const q = selector => ({
    length: selector === '#extensions_settings2' || (selector === '#npc_state_settings' && mounted) ? 1 : 0,
    append(html) { if (String(html).includes('npc_state_settings')) mounted = true; return this; },
    off() { return this; }, on() { return this; }, prop() { return this; }, val() { return this; }, html() { return this; },
    toggleClass() { return this; }, text() { return this; }, attr() { return this; }, data() { return undefined; },
});
globalThis.$ = selector => { if (typeof selector === 'function') { queueMicrotask(selector); return q(''); } return q(selector); };
globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/files/upload') {
        const body = JSON.parse(options.body);
        const p = `/user/files/${body.name}`;
        mock.files.set(p, Buffer.from(body.data, 'base64').toString('utf8'));
        return { ok: true, status: 200, json: async () => ({ path: p }), text: async () => '' };
    }
    if (mock.files.has(url)) return { ok: true, status: 200, text: async () => mock.files.get(url) };
    return { ok: false, status: 404, text: async () => '' };
};

try {
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?t=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 50));
    await globalThis.NPCState.flush();
    const settings = mock.extensionSettings.npc_state;
    assert.equal(settings.schemaVersion, 25);
    assert.equal(settings.admissionMode, 'conservative', 'legacy settings should adopt conservative dossier admission');
    assert.equal(settings.maxNpcs, 40);
    assert.equal(settings.scanEvery, 1);
    assert.equal(settings.fullScanEveryTurn, false);
    assert.equal(settings.portraitGenerationEnabled, true);
    assert.equal(settings.portraitThemePreset, 'fantasy_anime');
    assert.match(settings.portraitStylePositive, /fantasy anime character illustration/i);
    assert.match(settings.portraitStyleNegative, /bad anatomy/i);
    assert.match(settings.portraitComposition, /solo character portrait/i);
    assert.equal(settings.portraitPromptFormat, 'hybrid');
    assert.equal(settings.portraitUseMood, true);
    assert.equal(settings.portraitUseLocation, false);
    assert.equal(settings.portraitSaveToGallery, false);
    assert.equal(settings.injectBudgetTokens, 1800);
    assert.deepEqual(settings.relationshipBaseline, { trust: 0, affection: 0, desire: 0, tension: 0 }, 'old stock baseline should migrate to neutral zero');
    assert.deepEqual(settings.relationshipCaps, { ordinary: 1, meaningful: 2, major: 5, extreme: 10 });
    assert.match(settings.relationshipCriteria, /Trust:/);
    assert.match(settings.memoryCriteria, /durable, story-relevant events/i);
    assert.match(settings.behaviorCriteria, /IDENTITY DOMINANCE/);
    assert.match(settings.behaviorCriteria, /not devotion/i);
    assert.equal(settings.autoArchiveDeaths, true);
    assert.equal(settings.autoPruneStale, true);
    assert.equal(settings.staleArchiveAfter, 30);
    assert.equal(settings.staleDeleteAfter, 50);
    assert.equal(settings.autoReactivateArchived, true);
    assert.equal(settings.chats, undefined, 'legacy state blob should be removed from extension settings after migration');
    const pointer = settings.dataFiles['chat:legacy-chat'];
    assert.ok(pointer?.path && mock.files.has(pointer.path));
    const payload = JSON.parse(mock.files.get(pointer.path));
    assert.equal(payload.state.npcs[0].name, 'Yunyun');
    assert.deepEqual(payload.state.candidates, [], 'legacy chats should normalize with an empty candidate buffer');
    assert.equal(payload.state.npcs[0].age, '', 'legacy qualitative age must not become chronological age');
    assert.match(payload.state.npcs[0].apparentAge, /^~\d+$/, 'legacy qualitative age should migrate to stable apparent age');
    assert.deepEqual(payload.state.npcs[0].relationship, { trust: 60, affection: 35, desire: 0, tension: 12 });
    const migratedMilestones = payload.state.npcs[0].relationshipMilestones;
    assert.ok(migratedMilestones.some(item => item.axis === 'trust' && item.polarity === 1 && item.threshold === 25));
    assert.ok(migratedMilestones.some(item => item.axis === 'trust' && item.polarity === 1 && item.threshold === 50));
    assert.ok(migratedMilestones.some(item => item.axis === 'affection' && item.polarity === 1 && item.threshold === 25));
    assert.ok(!migratedMilestones.some(item => item.axis === 'trust' && item.polarity === 1 && item.threshold === 75), 'legacy visible depth must not unlock a milestone it never reached');
    assert.equal(payload.state.branchLineageVersion, 2);
    assert.equal('respect' in payload.state.npcs[0].relationship, false);
    assert.equal('thoughts' in payload.state.npcs[0], false, 'legacy Current Thoughts should be removed during v0.1.15 normalization');
    assert.equal('thoughts' in payload.state.inlineCards[0].cards[0], false, 'legacy snapshot thoughts should also be removed');
    assert.deepEqual(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta, { trust: 0, affection: 0, desire: 0, tension: 0 }, 'legacy historical audit snapshots should be sanitized during load');
    assert.ok(Object.values(payload.state.inlineCards[0].cards[0].lastRelationshipChange.delta).every(Number.isFinite));
    assert.equal(payload.state.durableCompactionVersion, 1);

    // Simulate a pre-v0.2.3 sidecar with append-only durable prose. A fresh module load
    // must compact it once and persist the canonical result back to the same sidecar.
    payload.state.durableCompactionVersion = 0;
    payload.state.npcs[0].personality = 'Gentle and soft-spoken; She shares a telepathic link with Ryu and can hear her thoughts; She and Ryu communicate through a telepathic channel that carries thoughts; Gentle and soft-spoken around family.';
    mock.files.set(pointer.path, JSON.stringify(payload));

    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?restart=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(globalThis.NPCState.getState().npcs[0].name, 'Yunyun');
    assert.deepEqual(globalThis.NPCState.getState().npcs[0].relationship, { trust: 60, affection: 35, desire: 0, tension: 12 });
    const compactedPersonality = globalThis.NPCState.getState().npcs[0].personality;
    assert.equal((compactedPersonality.match(/telepath/gi) || []).length, 1, compactedPersonality);
    const rewritten = JSON.parse(mock.files.get(pointer.path));
    assert.equal(rewritten.state.durableCompactionVersion, 1);
    assert.equal((rewritten.state.npcs[0].personality.match(/telepath/gi) || []).length, 1);

    // v0.2.10 relationship migration: untouched v0.2.8/v0.2.9 stock caps slow down, while
    // explicit user tuning remains authoritative and existing visible scores are never rescaled.
    mock.extensionSettings.npc_state = {
        schemaVersion: 20,
        enabled: true,
        relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 },
        relationshipBaseline: { trust: 0, affection: 0, desire: 0, tension: 0 },
        dataFiles: {},
    };
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?v028stock=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(mock.extensionSettings.npc_state.schemaVersion, 25);
    assert.deepEqual(mock.extensionSettings.npc_state.relationshipCaps, { ordinary: 1, meaningful: 2, major: 5, extreme: 10 }, 'untouched v0.2.8 caps should migrate through to v0.2.10 stock defaults');

    mock.extensionSettings.npc_state = {
        schemaVersion: 20,
        enabled: true,
        relationshipCaps: { ordinary: 2, meaningful: 6, major: 12, extreme: 24 },
        relationshipBaseline: { trust: 0, affection: 0, desire: 0, tension: 0 },
        dataFiles: {},
    };
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?v028custom=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(mock.extensionSettings.npc_state.schemaVersion, 25);
    assert.deepEqual(mock.extensionSettings.npc_state.relationshipCaps, { ordinary: 2, meaningful: 6, major: 12, extreme: 24 }, 'custom relationship caps must survive the v0.2.8→v0.2.10 migration');


    mock.extensionSettings.npc_state = {
        schemaVersion: 21,
        enabled: true,
        relationshipCaps: { ordinary: 1, meaningful: 3, major: 8, extreme: 20 },
        relationshipBaseline: { trust: 0, affection: 0, desire: 0, tension: 0 },
        dataFiles: {},
    };
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?v029stock=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(mock.extensionSettings.npc_state.schemaVersion, 25);
    assert.deepEqual(mock.extensionSettings.npc_state.relationshipCaps, { ordinary: 1, meaningful: 2, major: 5, extreme: 10 }, 'untouched v0.2.9 caps should migrate to v0.2.10 weights');

    const customV029Criteria = 'All relationship stats use a bipolar -100 to +100 scale with 0 as neutral. Positive and negative values are durable relationship states, not percentages or per-turn rewards. CUSTOM: my campaign deliberately changes progression.';
    mock.extensionSettings.npc_state = {
        schemaVersion: 21,
        enabled: true,
        relationshipCaps: { ordinary: 2, meaningful: 4, major: 7, extreme: 9 },
        relationshipBaseline: { trust: 0, affection: 0, desire: 0, tension: 0 },
        relationshipCriteria: customV029Criteria,
        relationshipImpactCriteria: 'CUSTOM IMPACT RUBRIC',
        behaviorCriteria: 'CUSTOM BEHAVIOR RUBRIC',
        dataFiles: {},
    };
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?v029custom=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(mock.extensionSettings.npc_state.schemaVersion, 25);
    assert.deepEqual(mock.extensionSettings.npc_state.relationshipCaps, { ordinary: 2, meaningful: 4, major: 7, extreme: 9 }, 'custom v0.2.9 caps must survive schema23 migration');
    assert.equal(mock.extensionSettings.npc_state.relationshipCriteria, customV029Criteria, 'custom v0.2.9 relationship rubric must not be mistaken for stock by prefix');
    assert.equal(mock.extensionSettings.npc_state.relationshipImpactCriteria, 'CUSTOM IMPACT RUBRIC');
    assert.equal(mock.extensionSettings.npc_state.behaviorCriteria, 'CUSTOM BEHAVIOR RUBRIC');

    console.log('Migration smoke: schema24 preserves live scores/custom tuning, infers already-passed directional milestones, migrates v0.2.8/v0.2.9 stock weights, adds conservative Social Graph state, and keeps canonical sidecars compatible.');
} finally {
    delete globalThis.__npcMock;
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
