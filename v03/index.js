/* NPC State v0.3.1 - clean runtime */
import { extension_settings, getContext } from '../../../../extensions.js';
import { extension_prompt_types, extension_prompt_roles, getRequestHeaders } from '../../../../../script.js';
import { createBundleManagementUi } from './bundle-ui.js';
import { createNpcStateEngine } from './engine.js';
import { getChatIdentity } from './identity.js';
import { buildInjection } from './injection.js';
import { createMeguminBlockIntegration } from './megumin.js';
import {
    DEFAULT_PORTRAIT_NEGATIVE_PROMPT,
    DEFAULT_PORTRAIT_POSITIVE_PROMPT,
    DEFAULT_PORTRAIT_PRESET,
    normalizePortraitPromptSettings,
} from './portrait-prompt.js';
import { createPortraitPromptUi } from './portrait-ui.js';
import { DEFAULT_RELATIONSHIP_CAPS, DOSSIER_LIMIT_DEFAULTS, NPC_STATE_VERSION, normalizeDossierLimits } from './schema.js';
import { createStaleManagementUi } from './stale-ui.js';
import { createNpcStateUi } from './ui.js';

const EXTENSION_NAME = 'npc_state';
const PROMPT_KEY = 'npc_state_v3_live_dossier';
const SETTINGS_SCHEMA = 1;
let initialized = false;
let eventsRegistered = false;
let activeChatKey = 'no-chat';
let ui = null;
let staleUi = null;
let bundleUi = null;
let portraitUi = null;

const DEFAULT_RELATIONSHIP_CRITERIA = `Relationship deltas measure only changes caused by the current USER+ASSISTANT exchange.
Trust: confidence in the player's reliability, honesty, competence, safety, or judgment.
Affection: warmth, fondness, attachment, tenderness, or personal liking toward the player.
Desire: attraction or intimate interest. Never infer it from friendliness, gratitude, beauty, proximity, or generic affection.
Tension: interpersonal strain, fear, suspicion, anger, unresolved conflict, pressure, or charged friction.
Ordinary events should usually change 0-1 points. Meaningful events may change up to 2, major events up to 5, extreme life-defining events up to 10. Zero is correct when evidence is weak or merely repeated from earlier context.`;

const DEFAULT_MEMORY_CRITERIA = `Store only durable NPC memories that can matter in later scenes: consequential promises, betrayals, rescues, injuries, discoveries, relationship-defining exchanges, major gifts/debts, established secrets, lasting changes of circumstance, and other facts the NPC would reasonably remember later. Do not store routine dialogue, transient mood, narration texture, or duplicate paraphrases of an existing memory.`;

const V3_DEFAULTS = Object.freeze({
    schemaVersion: SETTINGS_SCHEMA,
    enabled: true,
    autoScan: true,
    scanDepth: 8,
    inject: true,
    injectDepth: 1,
    injectLimit: 6,
    injectBudgetTokens: 1800,
    branchRescan: true,
    staleManagementEnabled: true,
    staleArchiveAfter: 30,
    staleDeleteAfter: 50,
    portraitPromptMode: 'hybrid',
    portraitPreset: DEFAULT_PORTRAIT_PRESET,
    portraitPositivePrompt: DEFAULT_PORTRAIT_POSITIVE_PROMPT,
    portraitNegativePrompt: DEFAULT_PORTRAIT_NEGATIVE_PROMPT,
    dossierLimits: { ...DOSSIER_LIMIT_DEFAULTS },
    relationshipCaps: { ...DEFAULT_RELATIONSHIP_CAPS },
    relationshipCriteria: DEFAULT_RELATIONSHIP_CRITERIA,
    memoryCriteria: DEFAULT_MEMORY_CRITERIA,
    dataFiles: {},
});

function rootSettings() {
    let root = extension_settings[EXTENSION_NAME];
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
        root = {};
        extension_settings[EXTENSION_NAME] = root;
    }
    return root;
}

function getSettings() {
    const root = rootSettings();
    if (!root.v3 || typeof root.v3 !== 'object' || Array.isArray(root.v3)) root.v3 = {};
    const settings = root.v3;
    const legacyPositivePrompt = settings.portraitPositivePrompt === undefined ? settings.portraitGenerationPrompt : undefined;
    for (const [key, value] of Object.entries(V3_DEFAULTS)) {
        if (settings[key] === undefined) settings[key] = structuredClone(value);
    }
    if (legacyPositivePrompt !== undefined) settings.portraitPositivePrompt = legacyPositivePrompt;
    settings.schemaVersion = SETTINGS_SCHEMA;
    settings.scanDepth = Math.max(2, Math.min(30, Math.round(Number(settings.scanDepth) || 8)));
    settings.injectDepth = Math.max(0, Math.min(20, Math.round(Number(settings.injectDepth) || 1)));
    settings.injectLimit = Math.max(1, Math.min(20, Math.round(Number(settings.injectLimit) || 6)));
    settings.injectBudgetTokens = Math.max(256, Math.min(8000, Math.round(Number(settings.injectBudgetTokens) || 1800)));
    settings.staleArchiveAfter = Math.max(1, Math.min(9999, Math.round(Number(settings.staleArchiveAfter) || 30)));
    settings.staleDeleteAfter = Math.max(settings.staleArchiveAfter + 1, Math.min(10000, Math.round(Number(settings.staleDeleteAfter) || 50)));
    settings.dossierLimits = normalizeDossierLimits(settings.dossierLimits);
    const portrait = normalizePortraitPromptSettings(settings);
    settings.portraitPromptMode = portrait.portraitPromptMode;
    settings.portraitPreset = structuredClone(portrait.portraitPreset);
    settings.portraitPositivePrompt = portrait.portraitPositivePrompt;
    settings.portraitNegativePrompt = portrait.portraitNegativePrompt;
    delete settings.portraitGenerationPrompt;
    delete settings.portraitPositivePreset;
    delete settings.portraitNegativePreset;
    settings.relationshipCaps = { ...DEFAULT_RELATIONSHIP_CAPS, ...(settings.relationshipCaps || {}) };
    if (!settings.dataFiles || typeof settings.dataFiles !== 'object' || Array.isArray(settings.dataFiles)) settings.dataFiles = {};
    return settings;
}

function persistSettings() {
    const ctx = getContext();
    if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
}

function getChatKey() {
    return getChatIdentity(getContext()).key;
}

function getV3Pointer(chatKey) {
    return getSettings().dataFiles?.[chatKey] || null;
}

function setV3Pointer(chatKey, pointer) {
    getSettings().dataFiles[chatKey] = structuredClone(pointer);
}

function getLegacyPointer(chatKey) {
    // One-way migration boundary. v0.3 never writes the legacy root-level pointer map.
    const root = rootSettings();
    return root.dataFiles?.[chatKey] || null;
}

function notify(kind, message) {
    const fn = globalThis.toastr?.[kind];
    if (typeof fn === 'function') fn(`NPC State: ${message}`);
}

async function generateJson({ systemPrompt, prompt, responseLength }) {
    const ctx = getContext();
    if (typeof ctx.generateRaw !== 'function') throw new Error('SillyTavern generateRaw() is unavailable.');
    return ctx.generateRaw({
        systemPrompt,
        prompt,
        quietToLoud: false,
        instructOverride: true,
        responseLength,
    });
}

function updateInjection() {
    const ctx = getContext();
    const settings = getSettings();
    const key = getChatKey();
    const state = key === 'no-chat' ? null : engine.getState(key);
    const prompt = state ? buildInjection(state, settings) : '';
    ctx.setExtensionPrompt?.(
        PROMPT_KEY,
        prompt,
        extension_prompt_types.IN_CHAT,
        settings.injectDepth,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

const engine = createNpcStateEngine({
    getContext,
    getChatKey,
    getSettings,
    getPointer: getV3Pointer,
    setPointer: setV3Pointer,
    getLegacyPointer,
    persistSettings,
    getHeaders: () => getRequestHeaders(),
    fetchFn: (...args) => globalThis.fetch(...args),
    generate: generateJson,
    notify,
    onStateChanged: () => {
        updateInjection();
        ui?.refresh();
        staleUi?.refresh();
        bundleUi?.refresh();
        portraitUi?.refresh();
    },
});

ui = createNpcStateUi({
    engine,
    getContext,
    getChatKey,
    getSettings,
    persistSettings,
    onSettingsChanged: updateInjection,
});

staleUi = createStaleManagementUi({
    engine,
    ui,
    getSettings,
    persistSettings,
});

bundleUi = createBundleManagementUi({
    engine,
    ui,
});

portraitUi = createPortraitPromptUi({
    engine,
    getSettings,
    persistSettings,
});

const meguminBlockIntegration = createMeguminBlockIntegration({
    renderInline: () => ui?.renderInline(),
});

function refreshSurfaces() {
    updateInjection();
    ui.refresh();
    staleUi.refresh();
    bundleUi.refresh();
    portraitUi.refresh();
}

async function hydrateActiveChat({ reconcile = true } = {}) {
    const identity = getChatIdentity(getContext());
    const key = identity.key;
    if (identity.pending || key === 'no-chat') {
        activeChatKey = key;
        refreshSurfaces();
        return null;
    }
    activeChatKey = key;
    try {
        const state = await engine.loadChat(key);
        if (getChatKey() !== key) return null;
        if (reconcile) {
            const branch = await engine.reconcileBranch({ rescan: false });
            if (branch?.unsafeDivergence) notify('warning', 'this chat diverged before its first v0.3 branch baseline. Live injection and model scans are paused because v0.2 branch checkpoints are intentionally not imported. Return to the original baseline branch to restore safe tracking.');
        }
        if (getChatKey() !== key) return null;
        refreshSurfaces();
        return state;
    } catch (error) {
        console.error('[NPC State v0.3] hydration failed safely', error);
        notify('error', `could not load this dossier. Existing sidecar data was not overwritten. ${error?.message || error}`);
        refreshSurfaces();
        return null;
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function settledBranchReconcile() {
    const key = getChatKey();
    if (!key || key === 'no-chat') return;
    engine.invalidate(key);
    try {
        await sleep(90);
        if (getChatKey() !== key) return;
        const result = await engine.reconcileBranch({ rescan: true });
        if (result?.unsafeDivergence) notify('warning', 'branch change predates the v0.3 baseline; live injection and model scans are paused rather than trusting stale legacy timeline data.');
        if (result?.rescan?.discarded) return;
        refreshSurfaces();
    } catch (error) {
        console.error('[NPC State v0.3] branch reconciliation failed safely', error);
        notify('error', `branch reconciliation failed without committing partial state. ${error?.message || error}`);
    }
}

function registerEvents() {
    if (eventsRegistered) return;
    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};
    const source = ctx.eventSource;
    if (!source?.on) return;
    eventsRegistered = true;

    if (events.MESSAGE_SENT) source.on(events.MESSAGE_SENT, () => {
        const key = getChatKey();
        if (key && key !== 'no-chat') engine.invalidate(key);
    });

    if (events.MESSAGE_RECEIVED) source.on(events.MESSAGE_RECEIVED, async messageId => {
        try {
            const result = await engine.scan(messageId, { manual: false });
            if (result?.ok || result?.discarded) refreshSurfaces();
        } catch (error) {
            console.error('[NPC State v0.3] automatic scan failed safely', error);
            notify('error', `automatic scan failed without committing partial state. ${error?.message || error}`);
        }
    });

    const load = async () => {
        if (activeChatKey && activeChatKey !== 'no-chat') engine.invalidate(activeChatKey);
        await hydrateActiveChat({ reconcile: true });
    };
    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, load);
    if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, load);

    for (const event of [events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_SWIPED, events.MESSAGE_SWIPE_DELETED].filter(Boolean)) {
        source.on(event, settledBranchReconcile);
    }

    for (const event of [events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_UPDATED, events.MORE_MESSAGES_LOADED].filter(Boolean)) {
        source.on(event, () => ui.renderInline());
    }
}

async function init() {
    getSettings();
    ui.scheduleMount();
    staleUi.scheduleMount();
    bundleUi.scheduleMount();
    portraitUi.scheduleMount();
    meguminBlockIntegration.start();
    registerEvents();
    await hydrateActiveChat({ reconcile: true });
    if (!initialized) console.log(`[NPC State] v${NPC_STATE_VERSION} clean runtime loaded`);
    initialized = true;
}

async function safeInit() {
    try { await init(); }
    catch (error) { console.error('[NPC State v0.3] initialization failed', error); }
}

if (typeof globalThis.$ === 'function') globalThis.$(safeInit);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit, { once: true });
else void safeInit();

try {
    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};
    if (ctx.eventSource?.on) {
        if (events.APP_READY) ctx.eventSource.on(events.APP_READY, safeInit);
        if (events.EXTENSION_SETTINGS_LOADED) ctx.eventSource.on(events.EXTENSION_SETTINGS_LOADED, safeInit);
    }
} catch (error) {
    console.debug('[NPC State v0.3] lifecycle bootstrap will rely on DOM ready.', error);
}

globalThis.NPCState = Object.freeze({
    version: NPC_STATE_VERSION,
    scan: () => {
        const chat = getContext().chat || [];
        let id = -1;
        for (let i = chat.length - 1; i >= 0; i -= 1) if (chat[i] && !chat[i].is_system && !chat[i].is_user) { id = i; break; }
        return id >= 0 ? engine.scan(id, { manual: true, force: true }) : Promise.resolve({ ok: false, reason: 'no-assistant-message' });
    },
    refreshFromChat: reference => engine.refreshDossier(reference),
    getState: () => engine.getState(getChatKey()),
    hydrationStatus: () => engine.hydrationStatus(getChatKey()),
    isBusy: () => engine.isBusy(getChatKey()),
    addNpc: name => engine.addNpc(name),
    updateNpc: (reference, patch) => engine.updateNpc(reference, patch),
    archive: reference => engine.archiveNpc(reference, true),
    restore: reference => engine.archiveNpc(reference, false),
    resetStaleness: reference => engine.resetNpcStaleness(reference),
    staleReport: () => engine.getStaleReport(),
    openStaleReview: () => staleUi.openReview(),
    exportBundle: reference => engine.exportBundle(reference),
    previewBundleImport: (bundle, options) => engine.previewBundleImport(bundle, options),
    importBundle: (bundle, options) => engine.importBundle(bundle, options),
    portraitPrompts: reference => portraitUi.buildPairFor(reference),
    portraitPrompt: reference => portraitUi.buildFor(reference),
    copyPortraitPositivePrompt: reference => portraitUi.copyPositiveFor(reference),
    copyPortraitNegativePrompt: reference => portraitUi.copyNegativeFor(reference),
    copyPortraitPrompts: reference => portraitUi.copyBothFor(reference),
    copyPortraitPrompt: reference => portraitUi.copyFor(reference),
    deleteNpc: reference => engine.deleteNpc(reference),
    reconcile: options => engine.reconcileBranch(options),
    openLibrary: reference => ui.openLibrary(reference),
    activeEditorNpcId: () => ui.activeEditorNpcId,
    settings: () => structuredClone(getSettings()),
});
