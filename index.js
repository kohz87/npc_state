/* NPC State v0.2.13 - standalone SillyTavern extension */
import { extension_settings, getContext } from '../../../extensions.js';
import { extension_prompt_types, extension_prompt_roles, getRequestHeaders } from '../../../../script.js';
import {
    NPC_STATE_VERSION,
    DEFAULT_RELATIONSHIP,
    DEFAULT_RELATIONSHIP_CAPS,
    DEFAULT_RELATIONSHIP_CRITERIA,
    DEFAULT_IMPACT_CRITERIA,
    DEFAULT_MEMORY_CRITERIA,
    DEFAULT_BEHAVIOR_CRITERIA,
    isLegacyStockBehaviorCriteriaV024,
    isLegacyStockRelationshipCapsV028,
    isLegacyStockRelationshipCriteriaV028,
    isLegacyStockImpactCriteriaV028,
    isLegacyStockBehaviorCriteriaV028,
    isLegacyStockRelationshipCapsV029,
    isLegacyStockRelationshipCriteriaV029,
    isLegacyStockImpactCriteriaV029,
    isLegacyStockBehaviorCriteriaV029,
    relationshipHistoryLooksDuplicate,
    IMPORTANT_MEMORY_LIMIT,
    KEY_RELATIONSHIP_LIMIT,
    BEHAVIOR_PROFILE_LIMIT,
    inferNpcIdentityKind,
    normalizeRelationshipBaseline,
    normalizeRelationshipCaps,
    normalizeRelationshipProgress,
    normalizeRelationshipMilestones,
    inferManualRelationshipMilestones,
    applyRelationshipMilestoneCrossings,
    normalizeRelationshipEvidence,
    normalizeRelationshipEventHistory,
    appendRelationshipEvent,
    applyRelationshipDelta,
    relationshipChangeReasonGrounded,
    relationshipAxisEvidenceGrounded,
    relationshipSummaryConsistent,
    calibrateRelationshipSummary,
    normalizeNpcAdmissionMode,
    buildInjection,
    buildScannerPrompt,
    buildRelationshipPassPrompt,
    buildBackfillPrompt,
    buildDossierImportPrompt,
    buildProfileRefreshPrompt,
    applyNpcStateCommand,
    mergeScanResult,
    parseOocNpcStateCommands,
    stripOocNpcStateControls,
    parseScanJson,
    npcMatchesLabel,
    normalizeName,
    normalizeNpcRecord,
    normalizeNpcCandidate,
    normalizeScanNpc,
    resolveInterimIdentityPromotions,
    setNpcArchived,
    stripUiNoise,
    hasCompactMeguminWorldState,
    extractExplicitKeyRelationshipEdges,
    applyStaleNpcLifecycle,
    DEFAULT_PORTRAIT_STYLE_POSITIVE,
    DEFAULT_PORTRAIT_STYLE_NEGATIVE,
    DEFAULT_PORTRAIT_COMPOSITION,
    normalizePortraitPromptFormat,
    buildNpcPortraitPrompts,
} from './core.js';
import {
    decodeNpcStateBundle,
    encodeNpcStateBundle,
    mergeImportedDossierState,
} from './bundle.js';
import {
    BRANCH_LINEAGE_VERSION,
    createScanOperationRegistry,
    deletedChatStateKey,
    bestAncestorState,
    chatLineage,
    fingerprintMessage,
    firstLineageDivergence,
    lineageCheckpointKey,
    addUserDismissedGroup,
    clearUserDismissedGroupsFor,
    ensureBranchParentAnchor,
    migrateLegacyBranchState,
    normalizeUserDismissedGroups,
    promoteLegacyUserDismissedGroups,
    recordBranchCheckpoint,
    reconcileBranchState,
} from './branch.js';
import {
    normalizeSocialGraph,
    reconcileSocialState,
    applyManualKeyRelationshipEdit,
    removeNpcFromSocialGraph,
    purgeNpcStructuredReferences,
} from './social.js';
import {
    deleteNpcStateDataFile,
    readNpcStateDataFile,
    writeNpcStateDataFile,
} from './storage.js';

const EXTENSION_NAME = 'npc_state';
const PROMPT_KEY = 'npc_state_live_dossier';
const UI_ID = 'npc_state_settings';
let eventsRegistered = false;
let initialized = false;
let mountRetryTimer = null;
let inlineRenderTimer = null;
let inlineObserver = null;
let inlineObserverChat = null;
let inlineWatchdogTimer = null;
let uiCaptureBridgeInstalled = false;
let activeEditorPopup = null;
let activeNpcViewerOverlay = null;
let activeNpcViewerId = '';
let activeNpcViewerOpenedAt = 0;
let activePortraitGeneratorOverlay = null;
let activePortraitGeneratorNpcId = '';
let activePortraitGenerationUrl = '';
let portraitGenerationBusy = false;
let lastViewerActivation = { npcId: '', at: 0 };
let lastEditorActivation = { npcId: '', at: 0 };
let lastScanMetrics = null;
let branchReconcileTimer = null;
let branchReconcilePending = null;
let swipeSettlementTimer = null;
let swipeSettlementPending = null;
let deferredSwipeMessageId = null;
let swipeSettlementSequence = 0;
const SWIPE_SETTLE_POLL_MS = 80;
const SWIPE_SETTLE_TIMEOUT_MS = 120000;
const INLINE_HISTORY_LIMIT = 80;
const STATE_WRITE_DELAY = 120;
const chatStateCache = new Map();
const loadedChatKeys = new Set();
const loadingChatStates = new Map();
const hydrationErrors = new Map();
const pendingAutoScans = new Map();
const stateWriteTimers = new Map();
const stateWritePromises = new Map();
const stateVersions = new Map();
const persistedVersions = new Map();
const SCAN_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;
const scanOperations = createScanOperationRegistry({
    timeoutMs: SCAN_OPERATION_TIMEOUT_MS,
    onExpire: operation => {
        console.warn(`[NPC State] ${operation.label} exceeded the scan timeout for ${operation.key}; the lock was released and any late result will be discarded.`);
        try {
            if (getChatKey() !== operation.key) return;
            setScanIndicator(false);
            const npcId = String(operation.metadata?.npcId || '');
            if (npcId && operation.metadata?.indicator === 'dossier') setNpcDossierScanIndicator(npcId, false);
            if (npcId && operation.metadata?.indicator === 'refresh') setNpcChatRefreshIndicator(npcId, false);
            updateInjection();
        } catch (error) {
            console.debug('[NPC State] scan-timeout indicator cleanup skipped', error);
        }
    },
});
function isScanBusy(key = getChatKey()) { return scanOperations.isBusy(key); }
function beginScanOperation(key, label, metadata = {}) { return scanOperations.begin(key, label, metadata); }
function scanOperationCurrent(key, operation) { return scanOperations.isCurrent(key, operation); }
function endScanOperation(key, operation) { return scanOperations.end(key, operation); }

const PORTRAIT_THEME_PRESETS = Object.freeze({
    fantasy_anime: {
        label: 'Fantasy Anime',
        positive: DEFAULT_PORTRAIT_STYLE_POSITIVE,
        negative: DEFAULT_PORTRAIT_STYLE_NEGATIVE,
    },
    anime_key_visual: {
        label: 'Anime Key Visual',
        positive: 'high-end fantasy anime key visual, crisp expressive linework, polished cel shading, luminous detailed eyes, elegant costume rendering, cinematic color design, studio-quality character illustration',
        negative: DEFAULT_PORTRAIT_STYLE_NEGATIVE,
    },
    painterly_fantasy: {
        label: 'Painterly Fantasy',
        positive: 'painterly fantasy character portrait, refined brushwork, detailed face and eyes, rich textile rendering, atmospheric cinematic light, elegant high-fantasy illustration',
        negative: 'low quality, blurry, bad anatomy, malformed hands, extra limbs, duplicate character, text, watermark, logo, flat cel shading, cheap 3d render',
    },
    dark_medieval: {
        label: 'Dark Medieval',
        positive: 'grounded dark medieval fantasy character portrait, weathered materials, restrained dramatic lighting, detailed practical clothing and armor, serious illustrated realism',
        negative: 'low quality, blurry, bad anatomy, extra limbs, duplicate character, text, watermark, logo, neon cyberpunk, modern streetwear, glossy plastic armor',
    },
    semi_realistic: {
        label: 'Semi-Realistic',
        positive: 'semi-realistic fantasy character portrait, natural facial anatomy, detailed eyes and hair, realistic fabric and metal textures, soft cinematic lighting, polished digital illustration',
        negative: 'low quality, blurry, bad anatomy, malformed hands, extra limbs, duplicate character, text, watermark, logo, chibi, super-deformed proportions, cheap 3d render',
    },
    custom: { label: 'Custom', positive: '', negative: '' },
});

const DURABLE_COMPACTION_VERSION = 1;

const DEFAULTS = Object.freeze({
    schemaVersion: 24,
    enabled: true,
    autoScan: true,
    fullScanEveryTurn: false,
    portraitGenerationEnabled: true,
    portraitThemePreset: 'fantasy_anime',
    portraitStylePositive: DEFAULT_PORTRAIT_STYLE_POSITIVE,
    portraitStyleNegative: DEFAULT_PORTRAIT_STYLE_NEGATIVE,
    portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
    portraitPromptFormat: 'hybrid',
    portraitUseMood: true,
    portraitUseLocation: false,
    portraitSaveToGallery: false,
    scanEvery: 1,
    scanDepth: 6,
    maxNpcs: 40,
    autoPruneStale: true,
    staleArchiveAfter: 30,
    staleDeleteAfter: 50,
    admissionMode: 'conservative',
    inject: true,
    injectDepth: 1,
    injectLimit: 3,
    injectBudgetTokens: 1800,
    branchRescan: true,
    relationshipBaseline: { ...DEFAULT_RELATIONSHIP },
    relationshipCaps: { ...DEFAULT_RELATIONSHIP_CAPS },
    relationshipCriteria: DEFAULT_RELATIONSHIP_CRITERIA,
    relationshipImpactCriteria: DEFAULT_IMPACT_CRITERIA,
    memoryCriteria: DEFAULT_MEMORY_CRITERIA,
    behaviorCriteria: DEFAULT_BEHAVIOR_CRITERIA,
    autoArchiveDeaths: true,
    autoReactivateArchived: true,
    dataFiles: {},
});

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\"', '&quot;')
        .replaceAll("'", '&#039;');
}

function persistSettings() {
    const ctx = getContext();
    if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
}

function getSettings() {
    let settings = extension_settings[EXTENSION_NAME];
    let dirty = false;
    if (!settings || typeof settings !== 'object') {
        settings = structuredClone(DEFAULTS);
        extension_settings[EXTENSION_NAME] = settings;
        dirty = true;
    }

    const previousSchema = Number(settings.schemaVersion || 0);
    const assign = (key, value, equal = Object.is) => {
        if (equal(settings[key], value)) return;
        settings[key] = structuredClone(value);
        dirty = true;
    };
    const sameJson = (a, b) => {
        try { return JSON.stringify(a) === JSON.stringify(b); }
        catch { return false; }
    };

    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (settings[key] === undefined) assign(key, value);
    }
    if (!settings.dataFiles || typeof settings.dataFiles !== 'object') assign('dataFiles', {});

    // One-shot migrations. All changes are saved once at the end rather than once
    // per historical schema step, which matters on older installations.
    if (previousSchema < 2) {
        if (Number(settings.maxNpcs) <= 6) assign('maxNpcs', 40);
        if (Number(settings.scanEvery) >= 2) assign('scanEvery', 1);
    }
    if (previousSchema < 8) {
        const oldDefault = { trust: 50, affection: 20, desire: 0, tension: 10 };
        const current = normalizeRelationshipBaseline(settings.relationshipBaseline);
        if (Object.keys(oldDefault).every(key => current[key] === oldDefault[key])) assign('relationshipBaseline', DEFAULT_RELATIONSHIP, sameJson);
    }
    if (previousSchema < 12) assign('admissionMode', normalizeNpcAdmissionMode(settings.admissionMode || 'conservative'));
    if (previousSchema < 14) {
        const oldThreshold = Math.max(10, Math.min(1000, Math.round(Number(settings.staleNpcAfter) || 50)));
        assign('staleDeleteAfter', oldThreshold);
    }
    if (previousSchema < 15) {
        const legacyDelete = Math.max(11, Math.min(1000, Math.round(Number(settings.staleDeleteAfter ?? settings.staleNpcAfter) || 50)));
        assign('staleDeleteAfter', legacyDelete);
        assign('staleArchiveAfter', Math.max(10, Math.min(999, Math.round(Number(settings.staleArchiveAfter) || Math.min(30, legacyDelete - 1)))));
    }
    if (previousSchema < 19 && isLegacyStockBehaviorCriteriaV024(settings.behaviorCriteria)) {
        // Upgrade only the untouched v0.2.4 stock rubric. User-customized rubrics are preserved.
        assign('behaviorCriteria', DEFAULT_BEHAVIOR_CRITERIA);
    }
    if (previousSchema < 21) {
        // v0.2.9 deliberately slows relationship progression. Migrate only untouched v0.2.8
        // defaults; explicit user tuning remains authoritative.
        if (isLegacyStockRelationshipCapsV028(settings.relationshipCaps)) assign('relationshipCaps', DEFAULT_RELATIONSHIP_CAPS, sameJson);
        if (isLegacyStockRelationshipCriteriaV028(settings.relationshipCriteria)) assign('relationshipCriteria', DEFAULT_RELATIONSHIP_CRITERIA);
        if (isLegacyStockImpactCriteriaV028(settings.relationshipImpactCriteria)) assign('relationshipImpactCriteria', DEFAULT_IMPACT_CRITERIA);
        if (isLegacyStockBehaviorCriteriaV028(settings.behaviorCriteria)) assign('behaviorCriteria', DEFAULT_BEHAVIOR_CRITERIA);
    }
    if (previousSchema < 22) {
        // v0.2.10 adds fractional evidence accumulation and lowers the untouched v0.2.9 stock
        // tier weights to 1/2/5/10. User-customized caps/rubrics remain authoritative.
        if (isLegacyStockRelationshipCapsV029(settings.relationshipCaps)) assign('relationshipCaps', DEFAULT_RELATIONSHIP_CAPS, sameJson);
        if (isLegacyStockRelationshipCriteriaV029(settings.relationshipCriteria)) assign('relationshipCriteria', DEFAULT_RELATIONSHIP_CRITERIA);
        if (isLegacyStockImpactCriteriaV029(settings.relationshipImpactCriteria)) assign('relationshipImpactCriteria', DEFAULT_IMPACT_CRITERIA);
        if (isLegacyStockBehaviorCriteriaV029(settings.behaviorCriteria)) assign('behaviorCriteria', DEFAULT_BEHAVIOR_CRITERIA);
    }
    if (previousSchema < 23) {
        // v0.2.11 stores directional relationship milestone history and exact sibling-swipe
        // checkpoints in per-chat state. NPC/chat normalization performs the data migration;
        // no user-tuned relationship settings are rewritten here.
    }

    // Canonicalize every current setting. This also repairs malformed values from
    // hand-edited settings without requiring a future schema bump.
    assign('relationshipBaseline', normalizeRelationshipBaseline(settings.relationshipBaseline), sameJson);
    assign('relationshipCaps', normalizeRelationshipCaps(settings.relationshipCaps), sameJson);
    assign('relationshipCriteria', typeof settings.relationshipCriteria === 'string' ? settings.relationshipCriteria : DEFAULT_RELATIONSHIP_CRITERIA);
    assign('relationshipImpactCriteria', typeof settings.relationshipImpactCriteria === 'string' ? settings.relationshipImpactCriteria : DEFAULT_IMPACT_CRITERIA);
    assign('memoryCriteria', typeof settings.memoryCriteria === 'string' ? settings.memoryCriteria : DEFAULT_MEMORY_CRITERIA);
    assign('behaviorCriteria', typeof settings.behaviorCriteria === 'string' ? settings.behaviorCriteria : DEFAULT_BEHAVIOR_CRITERIA);
    assign('admissionMode', normalizeNpcAdmissionMode(settings.admissionMode));
    assign('injectBudgetTokens', Math.max(512, Math.min(6000, Math.round(Number(settings.injectBudgetTokens) || 1800))));
    assign('fullScanEveryTurn', settings.fullScanEveryTurn === true);
    assign('portraitGenerationEnabled', settings.portraitGenerationEnabled !== false);
    assign('portraitThemePreset', PORTRAIT_THEME_PRESETS[settings.portraitThemePreset] ? settings.portraitThemePreset : 'custom');
    assign('portraitStylePositive', String(settings.portraitStylePositive ?? DEFAULT_PORTRAIT_STYLE_POSITIVE).slice(0, 2400));
    assign('portraitStyleNegative', String(settings.portraitStyleNegative ?? DEFAULT_PORTRAIT_STYLE_NEGATIVE).slice(0, 2400));
    assign('portraitComposition', String(settings.portraitComposition ?? DEFAULT_PORTRAIT_COMPOSITION).slice(0, 1200));
    assign('portraitPromptFormat', normalizePortraitPromptFormat(settings.portraitPromptFormat));
    assign('portraitUseMood', settings.portraitUseMood !== false);
    assign('portraitUseLocation', settings.portraitUseLocation === true);
    assign('portraitSaveToGallery', settings.portraitSaveToGallery === true);
    assign('autoPruneStale', settings.autoPruneStale !== false);
    const archiveAfter = Math.max(10, Math.min(999, Math.round(Number(settings.staleArchiveAfter) || 30)));
    assign('staleArchiveAfter', archiveAfter);
    assign('staleDeleteAfter', Math.max(archiveAfter + 1, Math.min(1000, Math.round(Number(settings.staleDeleteAfter) || 50))));
    assign('schemaVersion', DEFAULTS.schemaVersion);

    if (dirty) persistSettings();
    return settings;
}

function getChatKey() {
    const ctx = getContext();
    const raw = ctx.chatId || ctx.getCurrentChatId?.();
    if (raw) return `chat:${raw}`;
    if (ctx.groupId !== undefined && ctx.groupId !== null) return `group:${ctx.groupId}`;
    if (ctx.characterId !== undefined && ctx.characterId !== null) {
        const avatar = ctx.characters?.[ctx.characterId]?.avatar || ctx.characterId;
        return `character:${avatar}`;
    }
    return 'no-chat';
}

function freshChatState() {
    return {
        npcs: [],
        candidates: [],
        pendingBackfills: [],
        socialGraph: normalizeSocialGraph(),
        turn: 0,
        assistantSinceScan: 0,
        lastScanAt: 0,
        lastScannedMessageId: null,
        scanCount: 0,
        dismissed: [],
        processedOocMessageId: null,
        inlineCards: [],
        portraitAssets: {},
        checkpoints: [],
        lineage: [],
        branchLineageVersion: BRANCH_LINEAGE_VERSION,
        branchParent: null,
        branchForkMessageId: null,
        branchRootSnapshot: null,
        userDismissedGroups: [],
        durableCompactionVersion: DURABLE_COMPACTION_VERSION,
    };
}

function normalizeChatState(raw = {}) {
    const state = { ...freshChatState(), ...(raw && typeof raw === 'object' ? structuredClone(raw) : {}) };
    const hasLegacyBranchData = raw && typeof raw === 'object'
        && !Object.prototype.hasOwnProperty.call(raw, 'branchLineageVersion')
        && ((Array.isArray(raw.lineage) && raw.lineage.length) || (Array.isArray(raw.checkpoints) && raw.checkpoints.length));
    state.branchLineageVersion = hasLegacyBranchData
        ? 0
        : Math.max(0, Number(state.branchLineageVersion || 0));
    state.npcs = Array.isArray(state.npcs) ? state.npcs.map(normalizeNpcRecord) : [];
    state.candidates = Array.isArray(state.candidates) ? state.candidates.map(normalizeNpcCandidate).filter(Boolean) : [];
    state.socialGraph = normalizeSocialGraph(state.socialGraph);
    state.pendingBackfills = Array.isArray(state.pendingBackfills) ? state.pendingBackfills.map(item => ({
        npcId: String(item?.npcId || '').slice(0, 100),
        label: String(item?.label || '').trim().slice(0, 120),
        requestedMessageId: Number.isInteger(item?.requestedMessageId) ? item.requestedMessageId : null,
        requestedAt: Number(item?.requestedAt || 0) || Date.now(),
    })).filter(item => item.npcId && item.label) : [];
    state.dismissed = Array.isArray(state.dismissed) ? [...state.dismissed] : [];
    state.userDismissedGroups = normalizeUserDismissedGroups(state.userDismissedGroups);
    state.inlineCards = Array.isArray(state.inlineCards) ? state.inlineCards.map(entry => ({
        ...entry,
        cards: Array.isArray(entry?.cards) ? entry.cards.map(card => normalizeNpcRecord(card)) : [],
    })) : [];
    state.portraitAssets = state.portraitAssets && typeof state.portraitAssets === 'object' ? state.portraitAssets : {};
    state.checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints.map(checkpoint => {
        if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.snapshot || typeof checkpoint.snapshot !== 'object') return checkpoint;
        const snapshot = { ...checkpoint.snapshot };
        snapshot.npcs = Array.isArray(snapshot.npcs) ? snapshot.npcs.map(normalizeNpcRecord) : [];
        snapshot.candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates.map(normalizeNpcCandidate).filter(Boolean) : [];
        snapshot.socialGraph = normalizeSocialGraph(snapshot.socialGraph);
        return { ...checkpoint, snapshot };
    }).filter(Boolean) : [];
    if (state.branchRootSnapshot && typeof state.branchRootSnapshot === 'object') {
        const root = { ...state.branchRootSnapshot };
        root.npcs = Array.isArray(root.npcs) ? root.npcs.map(normalizeNpcRecord) : [];
        root.candidates = Array.isArray(root.candidates) ? root.candidates.map(normalizeNpcCandidate).filter(Boolean) : [];
        root.socialGraph = normalizeSocialGraph(root.socialGraph);
        state.branchRootSnapshot = root;
    } else {
        state.branchRootSnapshot = null;
    }
    state.lineage = Array.isArray(state.lineage) ? state.lineage : [];
    state.userDismissedGroups = promoteLegacyUserDismissedGroups(state.userDismissedGroups, [
        state.npcs,
        ...(state.checkpoints || []).map(checkpoint => checkpoint?.snapshot?.npcs || []),
        state.branchRootSnapshot?.npcs || [],
    ]);
    state.durableCompactionVersion = DURABLE_COMPACTION_VERSION;
    const socialMigration = reconcileSocialState(state, { provenance: 'migration', confidence: 'migration' });
    state.socialGraph = socialMigration.socialGraph;
    state.npcs = socialMigration.state.npcs;
    for (const npc of state.npcs) {
        if (npc?.portrait?.dataUrl && !state.portraitAssets[npc.id]) state.portraitAssets[npc.id] = structuredClone(npc.portrait);
        if (!npc?.portrait?.dataUrl && state.portraitAssets[npc.id]?.dataUrl) npc.portrait = structuredClone(state.portraitAssets[npc.id]);
    }
    return state;
}

function getChatState(key = getChatKey()) {
    if (key === 'no-chat') return freshChatState();
    if (!chatStateCache.has(key)) chatStateCache.set(key, freshChatState());
    return chatStateCache.get(key);
}

function setChatState(key, state, { markLoaded = true } = {}) {
    if (!key || key === 'no-chat') return state;
    const normalized = normalizeChatState(state);
    chatStateCache.set(key, normalized);
    if (markLoaded) { loadedChatKeys.add(key); hydrationErrors.delete(key); }
    stateVersions.set(key, Number(stateVersions.get(key) || 0) + 1);
    return normalized;
}
function chatHydrationStatus(key = getChatKey()) {
    if (!key || key === 'no-chat') return 'none';
    if (loadedChatKeys.has(key)) return 'ready';
    if (loadingChatStates.has(key)) return 'loading';
    if (hydrationErrors.has(key)) return 'error';
    return 'idle';
}
function assertChatHydratedForWrite(key = getChatKey()) {
    if (!key || key === 'no-chat') return;
    const pointer = getSettings().dataFiles?.[key];
    if (pointer?.path && !loadedChatKeys.has(key)) throw new Error('Refusing to overwrite unhydrated NPC State sidecar for ' + key + '.');
}

function requestHeaders() {
    try {
        return typeof getRequestHeaders === 'function' ? getRequestHeaders() : { 'Content-Type': 'application/json' };
    } catch {
        return { 'Content-Type': 'application/json' };
    }
}

async function ensureChatStateLoaded(key = getChatKey()) {
    if (!key || key === 'no-chat') return freshChatState();
    if (loadedChatKeys.has(key)) return getChatState(key);
    if (loadingChatStates.has(key)) return loadingChatStates.get(key);
    const task = (async () => {
        const settings = getSettings();
        const pointer = settings.dataFiles?.[key] || null;
        let loaded = null;
        if (pointer?.path) {
            let lastError = null;
            for (let attempt = 0; attempt < 3 && !loaded; attempt += 1) {
                try {
                    const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });
                    if (payload?.state) loaded = payload.state;
                    else throw new Error('NPC State sidecar returned no state payload.');
                } catch (error) {
                    lastError = error;
                    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
                }
            }
            if (!loaded) {
                hydrationErrors.set(key, lastError || new Error('NPC State sidecar could not be loaded.'));
                console.error(`[NPC State] Could not hydrate data file for ${key}; preserving the sidecar and blocking writes.`, lastError);
                throw lastError || new Error('NPC State could not hydrate ' + key + '.');
            }
        }
        const legacy = settings.chats && typeof settings.chats === 'object' ? settings.chats[key] : null;
        const sourceState = loaded || legacy || freshChatState();
        const needsDurableCompactionWrite = Boolean(loaded)
            && Number(sourceState?.durableCompactionVersion || 0) < DURABLE_COMPACTION_VERSION;
        const state = setChatState(key, sourceState);
        if ((!loaded && legacy) || needsDurableCompactionWrite) {
            try {
                await flushStateFile(key);
                if (!loaded && legacy) {
                    delete settings.chats[key];
                    if (settings.chats && Object.keys(settings.chats).length === 0) delete settings.chats;
                    persistSettings();
                    console.info(`[NPC State] migrated ${key} from extension settings into its own JSON data file.`);
                } else if (needsDurableCompactionWrite) {
                    console.info(`[NPC State] compacted legacy durable dossier summaries for ${key}.`);
                }
            } catch (error) {
                const action = !loaded && legacy ? 'legacy state migration' : 'durable dossier compaction migration';
                console.warn(`[NPC State] ${action} for ${key} could not be written yet.`, error);
            }
        }
        return state;
    })().finally(() => loadingChatStates.delete(key));
    loadingChatStates.set(key, task);
    return task;
}

async function ensureKnownChatStatesLoaded() {
    const settings = getSettings();
    const keys = new Set([
        ...Object.keys(settings.dataFiles || {}),
        ...Object.keys(settings.chats || {}),
    ]);
    await Promise.all([...keys].filter(key => key !== 'no-chat').map(key => ensureChatStateLoaded(key).catch(() => null)));
}

async function migrateLegacyChatStates() {
    const settings = getSettings();
    const legacyKeys = Object.keys(settings.chats || {}).filter(key => key !== 'no-chat');
    if (!legacyKeys.length) return;
    for (const key of legacyKeys) await ensureChatStateLoaded(key);
}

function markStateDirty(key = getChatKey()) {
    if (!key || key === 'no-chat') return;
    stateVersions.set(key, Number(stateVersions.get(key) || 0) + 1);
}

function queueStateFileWrite(key = getChatKey(), delay = STATE_WRITE_DELAY) {
    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return;
    markStateDirty(key);
    if (stateWriteTimers.has(key)) clearTimeout(stateWriteTimers.get(key));
    stateWriteTimers.set(key, setTimeout(() => {
        stateWriteTimers.delete(key);
        flushStateFile(key).catch(error => {
            console.error('[NPC State] data-file persistence failed', error);
            globalThis.toastr?.error?.('NPC State could not save its chat data file. Check the browser/server console.');
        });
    }, Math.max(0, Number(delay) || 0)));
}

async function flushStateFile(key = getChatKey()) {
    if (!key || key === 'no-chat' || !chatStateCache.has(key)) return null;
    assertChatHydratedForWrite(key);
    if (stateWriteTimers.has(key)) {
        clearTimeout(stateWriteTimers.get(key));
        stateWriteTimers.delete(key);
    }

    // One writer owns a chat key at a time. The owner loops until the persisted
    // snapshot catches the latest in-memory version, so edits made while fetch()
    // is pending cannot be falsely marked as saved.
    const active = stateWritePromises.get(key);
    if (active) return active;

    let task;
    task = (async () => {
        let pointer = getSettings().dataFiles?.[key] || null;
        while (chatStateCache.has(key)) {
            const writeVersion = Number(stateVersions.get(key) || 0);
            if (Number(persistedVersions.get(key) || -1) >= writeVersion) break;
            const snapshot = structuredClone(getChatState(key));
            const settings = getSettings();
            pointer = await writeNpcStateDataFile({
                chatKey: key,
                state: snapshot,
                appVersion: NPC_STATE_VERSION,
                pointer: settings.dataFiles?.[key] || pointer,
                headers: requestHeaders(),
            });
            settings.dataFiles[key] = pointer;
            persistedVersions.set(key, writeVersion);
            persistSettings();
            if (Number(stateVersions.get(key) || 0) <= writeVersion) break;
        }
        return pointer;
    })().finally(() => {
        if (stateWritePromises.get(key) === task) stateWritePromises.delete(key);
    });
    stateWritePromises.set(key, task);
    return task;
}

async function settleStateFileWrite(key, { flush = false } = {}) {
    if (!key || key === 'no-chat') return null;
    if (stateWriteTimers.has(key)) {
        clearTimeout(stateWriteTimers.get(key));
        stateWriteTimers.delete(key);
    }
    if (flush && chatStateCache.has(key)) return flushStateFile(key);
    const active = stateWritePromises.get(key);
    if (active) return active;
    return getSettings().dataFiles?.[key] || null;
}

function persist() {
    persistSettings();
    queueStateFileWrite();
}

function commitBranchCheckpoint(state, messageId, reason = 'state') {
    recordBranchCheckpoint(state, getContext().chat || [], messageId, reason);
    return state;
}

function seedBranchTracking(state = getChatState()) {
    const chat = getContext().chat || [];
    if (Number(state?.branchLineageVersion || 0) < BRANCH_LINEAGE_VERSION) {
        migrateLegacyBranchState(state, chat);
        return state;
    }
    const lineage = chatLineage(chat);
    if (!Array.isArray(state.lineage) || state.lineage.length === 0) state.lineage = lineage;
    if (!Array.isArray(state.checkpoints)) state.checkpoints = [];
    return state;
}

function findLatestAssistantAtOrAfter(messageId) {
    const chat = getContext().chat || [];
    for (let i = chat.length - 1; i >= Math.max(0, Number(messageId) || 0); i -= 1) {
        if (chat[i] && !chat[i].is_system && !chat[i].is_user && String(chat[i].mes || '').trim()) return i;
    }
    return -1;
}

function hostSwipeState() {
    try {
        const state = getContext().swipe?.state?.();
        return typeof state === 'string' && state ? state : 'none';
    } catch {
        return 'none';
    }
}

function isHostSwipeActive() {
    return hostSwipeState() !== 'none';
}

function mergeBranchOptions(base = {}, incoming = {}) {
    const next = { ...base, ...incoming };
    const a = base.explicitDivergence;
    const b = incoming.explicitDivergence;
    if (Number.isInteger(a) && Number.isInteger(b)) next.explicitDivergence = Math.min(a, b);
    else if (Number.isInteger(a)) next.explicitDivergence = a;
    else if (Number.isInteger(b)) next.explicitDivergence = b;
    next.rescan = Boolean(base.rescan || incoming.rescan);
    next.processOocMessageId = Number.isInteger(incoming.processOocMessageId) ? incoming.processOocMessageId : base.processOocMessageId;
    return next;
}

function queueSettledSwipeReconcile(options = {}) {
    let next = { reason: 'message-swiped', rescan: true, ...options };

    // A normal branch timer must never be allowed to fire inside SillyTavern's swipe window.
    // Fold it into the swipe settlement instead.
    if (branchReconcileTimer) {
        clearTimeout(branchReconcileTimer);
        branchReconcileTimer = null;
    }
    if (branchReconcilePending) {
        next = mergeBranchOptions(branchReconcilePending, next);
        branchReconcilePending = null;
    }
    if (swipeSettlementPending) next = mergeBranchOptions(swipeSettlementPending, next);
    swipeSettlementPending = next;

    const sequence = ++swipeSettlementSequence;
    if (swipeSettlementTimer) clearTimeout(swipeSettlementTimer);
    const startedAt = Date.now();

    const poll = async () => {
        if (sequence !== swipeSettlementSequence) return;
        if (isHostSwipeActive()) {
            if (Date.now() - startedAt >= SWIPE_SETTLE_TIMEOUT_MS) {
                swipeSettlementTimer = null;
                swipeSettlementPending = null;
                deferredSwipeMessageId = null;
                console.warn('[NPC State] swipe stayed active too long; branch rescan was skipped to avoid hijacking the host generation pipeline.');
                return;
            }
            swipeSettlementTimer = setTimeout(poll, SWIPE_SETTLE_POLL_MS);
            return;
        }

        swipeSettlementTimer = null;
        const pending = swipeSettlementPending || {};
        swipeSettlementPending = null;
        const receivedMessageId = Number.isInteger(deferredSwipeMessageId) ? deferredSwipeMessageId : null;
        deferredSwipeMessageId = null;

        try {
            const reconciliation = await reconcileCurrentBranch({ ...pending, rescan: false, reason: `${pending.reason || 'message-swiped'}-settled` });
            if (reconciliation?.exactRestored) return;
            const chat = getContext().chat || [];
            const received = Number.isInteger(receivedMessageId) ? chat[receivedMessageId] : null;
            if (received && !received.is_user && !received.is_system && String(received.mes || '').trim()) {
                await handleAssistantMessageReceived(receivedMessageId, {
                    bypassSwipeGuard: true,
                    forceBranchRescan: Boolean(pending.rescan),
                });
                return;
            }

            if (pending.rescan && getSettings().branchRescan !== false) {
                const targetAssistant = findLatestAssistantAtOrAfter(pending.explicitDivergence);
                if (targetAssistant >= 0) await scanNow({ manual: false, messageId: targetAssistant, allowDuringSwipe: true });
            }
        } catch (error) {
            console.warn('[NPC State] settled swipe reconciliation failed', error);
        }
    };

    // The host emits MESSAGE_SWIPED before Generate('swipe'). Polling the host's own
    // swipe state keeps NPC State completely out of that pre-generation gap.
    swipeSettlementTimer = setTimeout(poll, 0);
}

async function maybeInheritKnownBranch() {
    const key = getChatKey();
    if (key === 'no-chat') return false;
    await ensureChatStateLoaded(key);
    const current = getChatState(key);
    const chat = getContext().chat || [];
    const isEmptyState = !current.npcs.length && !current.candidates.length && !current.dismissed.length && !current.checkpoints.length && !current.lineage.length;
    if (!isEmptyState || chat.length < 1) return false;
    await ensureKnownChatStatesLoaded();
    const inherited = bestAncestorState(Object.fromEntries(chatStateCache.entries()), key, chat);
    if (!inherited) return false;
    setChatState(key, { ...freshChatState(), ...inherited });
    queueStateFileWrite(key, 0);
    return true;
}

async function reconcileCurrentBranch({ explicitDivergence = null, rescan = true, processOocMessageId = null, reason = 'branch' } = {}) {
    const key = getChatKey();
    if (key === 'no-chat') return null;
    const ctx = getContext();
    await ensureChatStateLoaded(key);
    const before = getChatState(key);
    seedBranchTracking(before);
    const result = reconcileBranchState(before, ctx.chat || [], { explicitDivergence });
    if (!result.invalidated) {
        before.lineage = result.state.lineage;
        return result;
    }

    setChatState(key, result.state);
    persist();
    renderDossier();
    updateInjection();

    if (Number.isInteger(processOocMessageId) && (ctx.chat || [])[processOocMessageId]?.is_user) {
        processOocCommands(processOocMessageId);
    }

    const targetAssistant = findLatestAssistantAtOrAfter(result.divergence);
    if (rescan && !result.exactRestored && getSettings().branchRescan !== false && targetAssistant >= 0) {
        if (isScanBusy(key)) queueBranchRescan(targetAssistant);
        else await scanNow({ manual: false, messageId: targetAssistant });
    }
    return result;
}

function queuePendingAutoScan(chatKey, messageId, reason = 'automatic') {
    if (!chatKey || chatKey === 'no-chat' || !Number.isInteger(messageId) || messageId < 0) return false;
    const previous = pendingAutoScans.get(chatKey);
    if (!previous || messageId >= previous.messageId) pendingAutoScans.set(chatKey, { chatKey, messageId, reason, queuedAt: Date.now() });
    return true;
}

async function drainPendingAutoScan(chatKey) {
    if (!chatKey || getChatKey() !== chatKey || isScanBusy(chatKey) || isHostSwipeActive()) return false;
    const pending = pendingAutoScans.get(chatKey);
    if (!pending) return false;
    const message = (getContext().chat || [])[pending.messageId];
    if (!message || message.is_user || message.is_system || !String(message.mes || '').trim()) {
        pendingAutoScans.delete(chatKey);
        return false;
    }
    pendingAutoScans.delete(chatKey);
    await scanNow({ manual: false, messageId: pending.messageId });
    return true;
}

function queueBranchRescan(messageId, _attempt = 0, originKey = getChatKey()) {
    if (!queuePendingAutoScan(originKey, messageId, 'branch-rescan')) return;
    if (getChatKey() === originKey && !isScanBusy(originKey) && !isHostSwipeActive()) void drainPendingAutoScan(originKey);
}

function queueBranchReconcile(options = {}, delay = 90) {
    const originKey = options.chatKey || getChatKey();
    if (originKey === 'no-chat') return;
    options = { ...options, chatKey: originKey };
    if (isHostSwipeActive()) {
        queueSettledSwipeReconcile(options);
        return;
    }
    let next = { ...options };
    if (branchReconcilePending) next = mergeBranchOptions(branchReconcilePending, next);
    branchReconcilePending = next;
    if (branchReconcileTimer) clearTimeout(branchReconcileTimer);
    branchReconcileTimer = setTimeout(async () => {
        const pending = branchReconcilePending || {};
        branchReconcilePending = null;
        branchReconcileTimer = null;
        try {
            if (pending.chatKey && getChatKey() !== pending.chatKey) return;
            await reconcileCurrentBranch(pending);
        } catch (error) {
            console.warn('[NPC State] branch reconciliation failed', error);
        }
    }, delay);
}

async function removeDeletedChatState(rawId, kind = 'chat') {
    const key = deletedChatStateKey(rawId, kind);
    if (!key) return false;
    const settings = getSettings();
    let removed = false;

    // A completed stale upload must not recreate a pointer after deletion. Cancel only
    // this chat namespace; a normal chat and a group may legitimately share the raw id.
    scanOperations.cancel(key, 'chat-deleted');
    await settleStateFileWrite(key).catch(error => console.warn(`[NPC State] Could not settle pending write for ${key}.`, error));
    const pointer = settings.dataFiles?.[key] || null;
    if (pointer) {
        delete settings.dataFiles[key];
        try { await deleteNpcStateDataFile(pointer, { headers: requestHeaders() }); }
        catch (error) { console.warn(`[NPC State] Could not delete data file for ${key}.`, error); }
        removed = true;
    }
    if (settings.chats?.[key]) { delete settings.chats[key]; removed = true; }
    chatStateCache.delete(key);
    loadedChatKeys.delete(key);
    loadingChatStates.delete(key);
    stateVersions.delete(key);
    persistedVersions.delete(key);
    stateWritePromises.delete(key);
    hydrationErrors.delete(key);
    pendingAutoScans.delete(key);
    if (removed) persistSettings();
    return removed;
}

async function moveRenamedChatState(eventData = {}) {
    const oldId = String(eventData.oldFileName || '').replace(/\.jsonl$/i, '');
    const newId = String(eventData.newFileName || '').replace(/\.jsonl$/i, '');
    if (!oldId || !newId || oldId === newId) return false;
    const settings = getSettings();
    let changed = false;

    const currentPrefix = getChatKey().startsWith('group:') ? 'group:' : 'chat:';
    for (const prefix of [currentPrefix]) {
        const oldKey = `${prefix}${oldId}`;
        const newKey = `${prefix}${newId}`;
        const hasOld = Boolean(settings.dataFiles?.[oldKey] || settings.chats?.[oldKey] || chatStateCache.has(oldKey));
        if (!hasOld) continue;

        await ensureChatStateLoaded(oldKey).catch(() => null);
        await settleStateFileWrite(oldKey, { flush: true }).catch(error => console.warn(`[NPC State] Could not settle renamed chat state for ${oldKey}.`, error));
        await settleStateFileWrite(newKey).catch(() => null);

        const oldPointer = settings.dataFiles?.[oldKey] || null;
        if (oldPointer) {
            settings.dataFiles[newKey] = oldPointer;
            delete settings.dataFiles[oldKey];
        }
        if (settings.chats?.[oldKey]) {
            settings.chats[newKey] = settings.chats[oldKey];
            delete settings.chats[oldKey];
        }
        if (chatStateCache.has(oldKey)) {
            const state = chatStateCache.get(oldKey);
            chatStateCache.delete(oldKey);
            loadedChatKeys.delete(oldKey);
            loadingChatStates.delete(oldKey);
            stateVersions.delete(oldKey);
            persistedVersions.delete(oldKey);
            stateWritePromises.delete(oldKey);
            setChatState(newKey, state);
            changed = true;
        } else {
            changed = Boolean(oldPointer || settings.chats?.[newKey]);
        }

        if (chatStateCache.has(newKey)) {
            await flushStateFile(newKey).catch(error => console.warn('[NPC State] renamed chat data-file refresh failed', error));
        }
    }
    if (changed) persistSettings();
    return changed;
}

function flushCurrentChatOnPageHide() {
    const key = getChatKey();
    if (key === 'no-chat' || !loadedChatKeys.has(key) || !chatStateCache.has(key)) return;
    void settleStateFileWrite(key, { flush: true }).catch(error => console.debug('[NPC State] page-hide flush deferred', error));
}

function cleanMessage(message) {
    if (!message || message.is_system) return '';
    const speaker = message.name || (message.is_user ? getContext().name1 : getContext().name2) || '';
    const body = stripUiNoise(stripOocNpcStateControls(message.mes || ''));
    return body ? `${speaker}: ${body}` : '';
}

function recentTranscript(limit = null) {
    const settings = getSettings();
    const chat = getContext().chat || [];
    const count = Math.max(2, Math.min(30, Number(limit ?? settings.scanDepth) || 6));
    const lines = [];
    // Walk backward and stop as soon as the requested meaningful window is full.
    // Long chats no longer pay to clean every historical message on each scan/injection.
    for (let i = chat.length - 1; i >= 0 && lines.length < count; i -= 1) {
        if (!chat[i] || chat[i].is_system) continue;
        const line = cleanMessage(chat[i]);
        if (line) lines.push(line);
    }
    return lines.reverse().join('\n');
}

function currentExchangeTranscript(messageId = null) {
    const ctx = getContext();
    const chat = ctx.chat || [];
    let assistantId = Number.isInteger(messageId) ? messageId : chat.length - 1;
    while (assistantId >= 0 && (chat[assistantId]?.is_system || chat[assistantId]?.is_user)) assistantId -= 1;
    if (assistantId < 0) return recentTranscript(2);
    let userId = -1;
    for (let i = assistantId - 1; i >= 0; i -= 1) {
        if (chat[i]?.is_system) continue;
        if (chat[i]?.is_user) { userId = i; break; }
        // Do not walk across an older assistant turn looking for a distant user message.
        if (!chat[i]?.is_user) break;
    }
    return [userId >= 0 ? chat[userId] : null, chat[assistantId]]
        .filter(Boolean)
        .map(cleanMessage)
        .filter(Boolean)
        .join('\n');
}

function currentExclusions() {
    const ctx = getContext();
    return [ctx.name1, ctx.name2].filter(Boolean);
}

function updateInjection() {
    const settings = getSettings();
    const ctx = getContext();
    const injectionKey = getChatKey();
    if (injectionKey !== 'no-chat' && chatHydrationStatus(injectionKey) !== 'ready') {
        ctx.setExtensionPrompt?.(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        return;
    }
    if (!settings.enabled || !settings.inject || getChatKey() === 'no-chat') {
        ctx.setExtensionPrompt?.(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        return;
    }
    const state = getChatState();
    const prompt = buildInjection(state.npcs, recentTranscript(4), state.turn, settings.injectLimit, settings.behaviorCriteria, settings.injectBudgetTokens, state.socialGraph);
    ctx.setExtensionPrompt?.(
        PROMPT_KEY,
        prompt,
        extension_prompt_types.IN_CHAT,
        Math.max(0, Math.min(20, Number(settings.injectDepth) || 1)),
        false,
        extension_prompt_roles.SYSTEM,
    );
}

function queueNpcBackfillInState(state, npcId, label, requestedMessageId = null) {
    if (!state || !npcId || !String(label || '').trim()) return state;
    if (!Array.isArray(state.pendingBackfills)) state.pendingBackfills = [];
    const cleanLabel = String(label || '').trim().slice(0, 120);
    state.pendingBackfills = state.pendingBackfills.filter(item => item?.npcId !== npcId);
    state.pendingBackfills.push({
        npcId: String(npcId).slice(0, 100),
        label: cleanLabel,
        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,
        requestedAt: Date.now(),
    });
    if (state.pendingBackfills.length > 8) state.pendingBackfills.splice(0, state.pendingBackfills.length - 8);
    return state;
}

function backfillScanMatchesTarget(npc, request) {
    if (!npc || !request) return false;
    if (npc.id && request.npcId && String(npc.id) === String(request.npcId)) return true;
    if (npcMatchesLabel(npc, request.label)) return true;
    const target = normalizeName(request.label);
    if (!target) return false;
    const labels = [npc.name, ...(npc.aliases || [])].map(normalizeName).filter(Boolean);
    if (labels.some(label => label === target || label.startsWith(`${target} `) || target.startsWith(`${label} `))) return true;
    const role = normalizeName(npc.role);
    return Boolean(role && (role.includes(target) || target.includes(role)));
}

function transcriptMentionsBackfillTarget(transcript, label) {
    const target = normalizeName(label);
    const haystack = normalizeName(transcript);
    if (!target || !haystack) return false;
    return (` ${haystack} `).includes(` ${target} `);
}


function dossierLabelsMatch(npc, candidateName) {
    const candidate = normalizeName(candidateName);
    if (!candidate) return false;
    const labels = [npc?.name, ...(npc?.aliases || [])].map(normalizeName).filter(Boolean);
    return labels.some(label => label === candidate || label.startsWith(`${candidate} `) || candidate.startsWith(`${label} `));
}

function meguminDossierBlocksInMessage(npc, raw, messageId) {
    const found = [];
    const tagged = /<(New_NPC|NPC_Update)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    let match;
    while ((match = tagged.exec(raw)) !== null) {
        const attr = String(match[2] || '');
        const nameMatch = attr.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
        const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? '').replace(/\*\*/g, '').trim();
        if (!dossierLabelsMatch(npc, name)) continue;
        found.push({ messageId, at: match.index, kind: match[1].toLowerCase() === 'new_npc' ? 'new' : 'update', text: match[0].trim() });
    }

    const details = /<details\b[^>]*>([\s\S]*?)<\/details\s*>/gi;
    while ((match = details.exec(raw)) !== null) {
        const whole = match[0];
        const summary = whole.match(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i)?.[1] || '';
        const plain = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const nameMatch = plain.match(/(?:New NPC|Updated NPC)\s*:\s*(.+)$/i);
        if (!nameMatch || !dossierLabelsMatch(npc, nameMatch[1].trim())) continue;
        found.push({ messageId, at: match.index, kind: /updated npc/i.test(plain) ? 'update' : 'new', text: whole.trim() });
    }
    return found.sort((a, b) => a.at - b.at);
}

export function findMeguminDossierSources(npc, chat = getContext().chat || []) {
    if (!npc) return [];
    const newerUpdates = [];
    let base = null;

    // Search newest-first and stop at the latest matching base dossier. Older chat
    // cannot affect the import once that base is found, so large roleplays stay cheap.
    for (let messageId = chat.length - 1; messageId >= 0; messageId -= 1) {
        const message = chat[messageId];
        if (!message || message.is_user || message.is_system) continue;
        const matches = meguminDossierBlocksInMessage(npc, String(message.mes || ''), messageId);
        if (!matches.length) continue;
        const latestBase = [...matches].reverse().find(item => item.kind === 'new') || null;
        if (latestBase) {
            base = latestBase;
            newerUpdates.push(...matches.filter(item => item.kind === 'update' && item.at >= latestBase.at));
            break;
        }
        newerUpdates.push(...matches.filter(item => item.kind === 'update'));
    }

    const chronological = newerUpdates
        .sort((a, b) => a.messageId - b.messageId || a.at - b.at)
        .filter((item, index, list) => list.findIndex(other => other.messageId === item.messageId && other.text === item.text) === index)
        .map(({ at, ...item }) => item);
    if (!base) return chronological.slice(-6);
    const cleanBase = { messageId: base.messageId, kind: base.kind, text: base.text };
    return [cleanBase, ...chronological.slice(-5)];
}

function setNpcDossierScanIndicator(npcId, busy) {
    const id = String(npcId || '');
    document.querySelectorAll?.(`.npc-state-scan-dossier[data-npc-id="${globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/"/g, '\\"')}"]`)?.forEach?.(button => {
        button.classList?.toggle?.('npc-state-busy', Boolean(busy));
        if (button.setAttribute) button.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
}

async function scanNpcDossier(npcId) {
    const id = String(npcId || '').trim();
    const ctx = getContext();
    const chatKey = getChatKey();
    if (!id || chatKey === 'no-chat') return false;
    if (isScanBusy(chatKey)) {
        globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');
        return false;
    }
    const state = getChatState(chatKey);
    const existing = state.npcs.find(npc => npc.id === id);
    if (!existing) return false;
    const sources = findMeguminDossierSources(existing, ctx.chat || []);
    if (!sources.length) {
        globalThis.toastr?.info?.(`NPC State: no matching Megumin dossier block found for ${existing.name}; scanning recent story context instead.`);
        return backfillNpcFromHistory({ npcId: existing.id, label: existing.name, requestedAt: Date.now() }, latestMessageId(true));
    }
    if (typeof ctx.generateRaw !== 'function') return false;
    const sourceText = sources.map(item => `[message ${item.messageId + 1} · ${item.kind}]\n${item.text}`).join('\n\n');
    const lineage = chatLineage(ctx.chat || []);
    const prompt = buildDossierImportPrompt({
        dossierText: sourceText,
        targetName: existing.name,
        existingNpc: existing,
        userName: ctx.name1 || 'User',
        charName: ctx.name2 || 'Character',
    });
    const scanStateVersion = Number(stateVersions.get(chatKey) || 0);
    const operation = beginScanOperation(chatKey, `dossier import for ${existing.name}`, { npcId: id, indicator: 'dossier' });
    if (!operation) {
        globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');
        return false;
    }
    setScanIndicator(true);
    setNpcDossierScanIndicator(id, true);
    try {
        const { parsed } = await generateParsedNpcJson(ctx, {
            systemPrompt: "You are NPC State's isolated structured dossier importer. Use only the supplied dossier payload. Return only the requested JSON object.",
            prompt,
            responseLength: BACKFILL_RESPONSE_LENGTH,
            label: `dossier import for ${existing.name}`,
        });
        if (!scanOperationCurrent(chatKey, operation)) {
            console.info('[NPC State] discarded expired or superseded dossier import.');
            return false;
        }
        const currentLineage = chatLineage(getContext().chat || []);
        if (getChatKey() !== chatKey || firstLineageDivergence(lineage, currentLineage) !== -1 || Number(stateVersions.get(chatKey) || 0) !== scanStateVersion) {
            globalThis.toastr?.info?.('NPC State: chat changed during dossier import; stale result was discarded.');
            return false;
        }
        const returned = Array.isArray(parsed.npcs) ? parsed.npcs : [];
        const match = returned.find(npc => backfillScanMatchesTarget(npc, { npcId: id, label: existing.name })) || (returned.length === 1 ? returned[0] : null);
        if (!match) {
            globalThis.toastr?.warning?.(`NPC State: the dossier importer did not return ${existing.name}.`);
            return false;
        }
        parsed.npcs = [{
            ...match,
            id,
            present: Boolean(existing.present),
            worldActive: Boolean(existing.worldActive) && !Boolean(existing.present),
            relationshipImpact: 'none',
            relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            relationshipChangeReason: '',
        }];
        const latest = getChatState(chatKey);
        const targetMessageId = latestMessageId(true);
        const merged = mergeScanResult(latest, parsed, {
            maxNpcs: getSettings().maxNpcs,
            excludeNames: [...currentExclusions(), ...(latest.dismissed || [])],
            turn: latest.turn,
            sourceMessageId: targetMessageId,
            relationshipBaseline: getSettings().relationshipBaseline,
            relationshipCaps: getSettings().relationshipCaps,
            autoArchiveDeaths: getSettings().autoArchiveDeaths !== false,
            autoReactivateArchived: getSettings().autoReactivateArchived !== false,
            admissionMode: getSettings().admissionMode,
            preservePresence: true,
            skipRelationshipUpdate: true,
            developmentContext: sourceText,
        });
        const nextState = merged.state;
        if (targetMessageId >= 0) commitBranchCheckpoint(nextState, targetMessageId, 'dossier-import');
        setChatState(chatKey, nextState);
        persist();
        renderDossier();
        updateInjection();
        const saved = nextState.npcs.find(npc => npc.id === id);
        globalThis.toastr?.success?.(`NPC State: imported ${saved?.name || existing.name} from ${sources.length} Megumin dossier block${sources.length === 1 ? '' : 's'}.`);
        return true;
    } catch (error) {
        console.error('[NPC State] structured dossier import failed', error);
        globalThis.toastr?.warning?.(`NPC State dossier import failed for ${existing.name}: ${error?.message || error}`);
        return false;
    } finally {
        const owned = scanOperationCurrent(chatKey, operation);
        endScanOperation(chatKey, operation);
        if (getChatKey() === chatKey) setScanIndicator(isScanBusy(chatKey));
        if (owned) setNpcDossierScanIndicator(id, false);
        updateInjection();
    }
}

function setNpcChatRefreshIndicator(npcId, busy) {
    const id = String(npcId || '');
    const selectorId = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/"/g, '\\"');
    document.querySelectorAll?.(`.npc-state-refresh-chat[data-npc-id="${selectorId}"]`)?.forEach?.(button => {
        button.classList?.toggle?.('npc-state-busy', Boolean(busy));
        if (button.setAttribute) button.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (button.innerHTML !== undefined) button.innerHTML = busy
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing from chat...'
            : '<i class="fa-solid fa-arrows-rotate"></i> Refresh from Chat';
    });
}

function syncOpenNpcEditorFields(npc) {
    if (!npc || !editorIsMounted()) return;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; };
    set('npc_state_edit_name', npc.name || '');
    set('npc_state_edit_role', npc.role || '');
    set('npc_state_edit_species', npc.species || '');
    set('npc_state_edit_age', npc.age || '');
    set('npc_state_edit_apparent_age', npc.apparentAge || '');
    set('npc_state_edit_personality', npc.personality || '');
    set('npc_state_edit_speech', npc.speech || '');
    set('npc_state_edit_behavior_profile', (npc.behaviorProfile || []).join('\n'));
    set('npc_state_edit_appearance', npc.appearance || '');
    set('npc_state_edit_background', npc.background || '');
    set('npc_state_edit_mannerisms', (npc.mannerisms || []).join('\n'));
    set('npc_state_edit_key_relationships', (npc.keyRelationships || []).join('\n'));
    set('npc_state_edit_relationship_summary', npc.relationshipSummary || '');
    set('npc_state_edit_mood', npc.mood || '');
    set('npc_state_edit_location', npc.location || '');
    set('npc_state_edit_goal', npc.goal || '');
    set('npc_state_edit_status', npc.status || '');
    set('npc_state_edit_importance', Math.round(Number(npc.importance) || 0));
    set('npc_state_edit_memories', (npc.memories || []).join('\n'));
    set('npc_state_edit_trust', relationshipNumber(npc.relationship?.trust));
    set('npc_state_edit_affection', relationshipNumber(npc.relationship?.affection));
    set('npc_state_edit_desire', relationshipNumber(npc.relationship?.desire));
    set('npc_state_edit_tension', relationshipNumber(npc.relationship?.tension));
    const lock = document.getElementById('npc_state_edit_lock_profile');
    if (lock) lock.checked = Boolean((npc.manualProfileFields || []).length);
}

function refreshChangedFields(before, after) {
    const fields = ['name','role','species','age','apparentAge','appearance','personality','speech','behaviorProfile','background','keyRelationships','relationshipSummary','mood','location','goal','status','lifeState','mannerisms','memories','importance'];
    return fields.filter(field => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
}

async function refreshNpcFromChat(npcId) {
    const id = String(npcId || '').trim();
    const ctx = getContext();
    const chatKey = getChatKey();
    if (!id || chatKey === 'no-chat') return false;
    if (isScanBusy(chatKey)) {
        globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');
        return false;
    }
    if (typeof ctx.generateRaw !== 'function') return false;
    // Preserve any edits currently visible in this dossier before reading history. Otherwise
    // the old popup values could overwrite a successful refresh when Save is clicked later.
    if (editorIsMounted()) saveNpcEditor(id, { close: false, silent: true });
    const settings = getSettings();
    const state = getChatState(chatKey);
    const existing = state.npcs.find(npc => npc.id === id);
    if (!existing) return false;
    const transcript = recentTranscript(settings.scanDepth);
    if (!transcript) {
        globalThis.toastr?.info?.(`NPC State: no recent story text is available to refresh ${existing.name}.`);
        return false;
    }
    const before = structuredClone(existing);
    const lineage = chatLineage(ctx.chat || []);
    const refreshStartedAt = performance.now?.() ?? Date.now();
    const prompt = buildProfileRefreshPrompt({
        transcript,
        targetNpc: existing,
        userName: ctx.name1 || 'User',
        charName: ctx.name2 || 'Character',
        memoryCriteria: settings.memoryCriteria,
    });
    const scanStateVersion = Number(stateVersions.get(chatKey) || 0);
    const operation = beginScanOperation(chatKey, `chat refresh for ${existing.name}`, { npcId: id, indicator: 'refresh' });
    if (!operation) {
        globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');
        return false;
    }
    setScanIndicator(true);
    setNpcChatRefreshIndicator(id, true);
    try {
        const { parsed, raw, retried } = await generateParsedNpcJson(ctx, {
            systemPrompt: "You are NPC State's targeted dossier reconciliation scanner. Re-read the supplied recent-story window for exactly one existing NPC. Return only the requested JSON object.",
            prompt,
            responseLength: BACKFILL_RESPONSE_LENGTH,
            label: `chat refresh for ${existing.name}`,
        });
        if (!scanOperationCurrent(chatKey, operation)) {
            console.info('[NPC State] discarded expired or superseded dossier refresh.');
            return false;
        }
        const currentLineage = chatLineage(getContext().chat || []);
        if (getChatKey() !== chatKey || firstLineageDivergence(lineage, currentLineage) !== -1 || Number(stateVersions.get(chatKey) || 0) !== scanStateVersion) {
            globalThis.toastr?.info?.('NPC State: chat or dossier state changed during dossier refresh; stale result was discarded.');
            return false;
        }
        const returned = Array.isArray(parsed.npcs) ? parsed.npcs : [];
        let match = returned.find(npc => backfillScanMatchesTarget(npc, { npcId: id, label: existing.name }));
        if (!match && returned.length === 1) match = returned[0];
        parsed.npcs = match ? [{
            ...match,
            id,
            name: match.name || existing.name,
            present: false,
            worldActive: false,
            relationshipImpact: 'none',
            relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            relationshipChangeReason: '',
        }] : [];
        const rawProfileUpdates = Array.isArray(parsed.profileUpdates) ? parsed.profileUpdates : (Array.isArray(parsed.profile_updates) ? parsed.profile_updates : []);
        if (rawProfileUpdates.length) {
            const profile = rawProfileUpdates.find(item => String(item?.id || '') === id || (item?.name && npcMatchesLabel(existing, item.name))) || (rawProfileUpdates.length === 1 ? rawProfileUpdates[0] : null);
            parsed.profileUpdates = profile ? [{ ...profile, id, name: existing.name }] : [];
        }
        const edgeTouchesTarget = edge => String(edge?.aId || edge?.a_id || '') === id
            || String(edge?.bId || edge?.b_id || '') === id
            || npcMatchesLabel(existing, edge?.a || edge?.from || edge?.source || '')
            || npcMatchesLabel(existing, edge?.b || edge?.to || edge?.target || '');
        const localEdges = extractExplicitKeyRelationshipEdges(transcript, state.npcs, currentExclusions()).filter(edgeTouchesTarget);
        const modelEdges = (Array.isArray(parsed.keyRelationshipEdges) ? parsed.keyRelationshipEdges : []).filter(edgeTouchesTarget);
        parsed.keyRelationshipEdges = [...modelEdges, ...localEdges];
        if (!parsed.npcs.length && !(parsed.profileUpdates || []).length && !parsed.keyRelationshipEdges.length) {
            globalThis.toastr?.info?.(`NPC State: no grounded dossier changes found for ${existing.name} in the last ${settings.scanDepth} messages.`);
            return true;
        }
        const latest = getChatState(chatKey);
        const liveBefore = latest.npcs.find(npc => npc.id === id);
        if (!liveBefore) return false;
        const targetMessageId = latestMessageId(true);
        const merged = mergeScanResult(latest, parsed, {
            maxNpcs: settings.maxNpcs,
            excludeNames: [...currentExclusions(), ...(latest.dismissed || [])],
            turn: latest.turn,
            sourceMessageId: targetMessageId,
            relationshipBaseline: settings.relationshipBaseline,
            relationshipCaps: settings.relationshipCaps,
            autoArchiveDeaths: settings.autoArchiveDeaths !== false,
            autoReactivateArchived: false,
            admissionMode: settings.admissionMode,
            preservePresence: true,
            skipRelationshipUpdate: true,
            developmentContext: transcript,
        });
        // A targeted refresh may use social-edge machinery internally, but it must never
        // mutate a second dossier as a side effect. Restore every non-target record verbatim.
        const latestById = new Map((latest.npcs || []).map(npc => [npc.id, structuredClone(npc)]));
        merged.state.npcs = (merged.state.npcs || []).map(npc => npc.id === id ? npc : (latestById.get(npc.id) || npc));
        const refreshed = merged.state.npcs.find(npc => npc.id === id);
        if (!refreshed) return false;
        // Manual history reconciliation must never pretend the NPC was just seen or change
        // current presence merely because an older message in the window mentioned them.
        refreshed.present = Boolean(liveBefore.present);
        refreshed.worldActive = Boolean(liveBefore.worldActive);
        refreshed.lastSeenTurn = liveBefore.lastSeenTurn;
        refreshed.lastWorldActiveTurn = liveBefore.lastWorldActiveTurn;
        refreshed.seenCount = liveBefore.seenCount;
        refreshed.relationship = structuredClone(liveBefore.relationship || DEFAULT_RELATIONSHIP);
        refreshed.lastRelationshipChange = structuredClone(liveBefore.lastRelationshipChange || refreshed.lastRelationshipChange);
        const proposedSummary = String(match?.relationshipSummary ?? match?.relationship_summary ?? '').trim().slice(0, 900);
        if (proposedSummary && !(liveBefore.manualProfileFields || []).includes('relationshipSummary')) refreshed.relationshipSummary = proposedSummary;
        if (targetMessageId >= 0) commitBranchCheckpoint(merged.state, targetMessageId, 'chat-refresh');
        setChatState(chatKey, merged.state);
        persist();
        renderDossier();
        updateInjection();
        const saved = getChatState(chatKey).npcs.find(npc => npc.id === id);
        syncOpenNpcEditorFields(saved);
        const changed = refreshChangedFields(before, saved);
        lastScanMetrics = {
            label: 'targeted-refresh',
            durationMs: Math.max(0, Math.round((performance.now?.() ?? Date.now()) - refreshStartedAt)),
            promptChars: prompt.length,
            responseChars: String(raw ?? '').length,
            retried: Boolean(retried),
            relationshipPass: false,
            relationshipTargets: 0,
            relationshipResponseChars: 0,
            relationshipRetried: false,
            relationshipEdges: parsed.keyRelationshipEdges.length,
            relationshipEdgeFallbacks: localEdges.length,
            profileUpdates: (parsed.profileUpdates || []).length,
            profileApplied: Number(merged.report?.profileUpdateStats?.applied || 0),
            profileEvidenceAdded: Number(merged.report?.profileUpdateStats?.evidenceAdded || 0),
            at: Date.now(),
        };
        console.info('[NPC State] targeted refresh metrics', lastScanMetrics);
        globalThis.toastr?.success?.(changed.length
            ? `NPC State: refreshed ${saved?.name || existing.name} from the last ${settings.scanDepth} messages (${changed.join(', ')}).`
            : `NPC State: ${saved?.name || existing.name} is already consistent with the last ${settings.scanDepth} messages.`);
        return true;
    } catch (error) {
        console.error('[NPC State] targeted chat refresh failed', error);
        globalThis.toastr?.warning?.(`NPC State refresh failed for ${existing.name}: ${error?.message || error}`);
        return false;
    } finally {
        const owned = scanOperationCurrent(chatKey, operation);
        endScanOperation(chatKey, operation);
        if (getChatKey() === chatKey) setScanIndicator(isScanBusy(chatKey));
        if (owned) setNpcChatRefreshIndicator(id, false);
        updateInjection();
    }
}

const SCAN_RESPONSE_LENGTH = 1800;
const FULL_SCAN_RESPONSE_LENGTH = 3200;
const RELATIONSHIP_RESPONSE_LENGTH = 900;
const BACKFILL_RESPONSE_LENGTH = 3200;
const JSON_RETRY_RESPONSE_LENGTH = 5200;

function isTruncatedScannerJsonError(error) {
    const text = [error?.message, error?.cause?.message]
        .filter(Boolean)
        .join(' ');
    return /unterminated string|unexpected end of json input|unexpected end of data|end of json input/i.test(text);
}

function compactRetryPrompt(prompt, label = 'scanner', reason = 'malformed') {
    const cause = reason === 'truncated'
        ? 'Your previous response ended before the JSON was complete.'
        : 'Your previous response was not valid JSON. Rebuild it from the beginning with correct commas, colons, quotes, arrays, and objects.';
    return `${prompt}

CRITICAL COMPACT JSON RETRY (${label}): ${cause} Return the full JSON object again from the beginning. Use MINIFIED JSON only. Keep every value concise; shorten prose instead of risking truncation. Omit unsupported optional facts rather than explaining them. Compact rather than append: appearance under 500 characters, personality 280, speech 240, behaviorProfile at most 6 short point-form rules, background/relationship summary 280-320, mannerisms at most 4 DISTINCT short items, key relationships one entry per counterpart, memories at most 3 NEW distinct events, memoryRetention at most 5 distinct events. Close every quoted string, array, and object. No markdown, no commentary, no code fence.`;
}

async function generateParsedNpcJson(ctx, {
    systemPrompt,
    prompt,
    responseLength,
    label = 'scanner',
}) {
    const invoke = async (retry = false, retryReason = 'malformed') => {
        const raw = await ctx.generateRaw({
            systemPrompt,
            prompt: retry ? compactRetryPrompt(prompt, label, retryReason) : prompt,
            quietToLoud: false,
            instructOverride: true,
            responseLength: retry ? Math.max(JSON_RETRY_RESPONSE_LENGTH, Number(responseLength) || 0) : responseLength,
            trimNames: false,
        });
        try {
            return { parsed: parseScanJson(raw), raw, retried: retry };
        } catch (error) {
            const truncated = isTruncatedScannerJsonError(error);
            if (!retry) {
                console.warn(`[NPC State] ${label} returned invalid JSON; retrying once with a compact correction prompt.`, {
                    responseChars: String(raw ?? '').length,
                    truncated,
                    error: error?.message || String(error),
                });
                return invoke(true, truncated ? 'truncated' : 'malformed');
            }
            const wrapped = new Error(truncated
                ? `${label} JSON was truncated twice; the model did not finish its JSON response. ${error?.message || error}`
                : `${label} returned malformed JSON twice; the model did not produce a valid dossier object. ${error?.message || error}`);
            wrapped.cause = error;
            throw wrapped;
        }
    };
    return invoke(false);
}

async function backfillNpcFromHistory(request, messageId = null) {
    const settings = getSettings();
    const ctx = getContext();
    const chatKey = getChatKey();
    if (!request?.npcId || !request?.label || chatKey === 'no-chat') return false;
    if (isScanBusy(chatKey)) return false;
    if (typeof ctx.generateRaw !== 'function') return false;
    const state = getChatState(chatKey);
    const existing = state.npcs.find(npc => npc.id === request.npcId);
    if (!existing) return false;
    const transcript = recentTranscript(settings.scanDepth);
    if (!transcript) return false;
    const scanLineage = chatLineage(ctx.chat || []);
    const prompt = buildBackfillPrompt({
        transcript,
        targetName: request.label,
        existingNpc: existing,
        userName: ctx.name1 || 'User',
        charName: ctx.name2 || 'Character',
        memoryCriteria: settings.memoryCriteria,
    });

    const scanStateVersion = Number(stateVersions.get(chatKey) || 0);
    const operation = beginScanOperation(chatKey, `backfill for ${request.label}`, { npcId: request.npcId, indicator: 'backfill' });
    if (!operation) return false;
    setScanIndicator(true);
    try {
        const { parsed } = await generateParsedNpcJson(ctx, {
            systemPrompt: "You are NPC State's isolated dossier backfill scanner. Use only the supplied scanner payload. Return only the requested JSON object.",
            prompt,
            responseLength: BACKFILL_RESPONSE_LENGTH,
            label: `backfill for ${request.label}`,
        });
        if (!scanOperationCurrent(chatKey, operation)) {
            console.info('[NPC State] discarded expired or superseded dossier backfill.');
            return false;
        }
        const currentLineage = chatLineage(getContext().chat || []);
        if (getChatKey() !== chatKey || firstLineageDivergence(scanLineage, currentLineage) !== -1 || Number(stateVersions.get(chatKey) || 0) !== scanStateVersion) {
            console.info('[NPC State] discarded stale dossier backfill after chat or dossier state changed.');
            return false;
        }
        const returned = Array.isArray(parsed.npcs) ? parsed.npcs : [];
        let matches = returned.filter(npc => backfillScanMatchesTarget(npc, request));
        // The backfill prompt is single-target by construction. If the model expands a short
        // label (e.g. Toris -> Toris Vale) without repeating the alias, accept the sole result
        // when the requested target is actually present in the supplied history.
        if (!matches.length && returned.length === 1 && transcriptMentionsBackfillTarget(transcript, request.label)) matches = returned;
        parsed.npcs = matches
            .slice(0, 1)
            .map(npc => ({
                ...npc,
                id: request.npcId,
                relationshipImpact: 'none',
                relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
                relationshipChangeReason: '',
            }));
        if (!parsed.npcs.length) {
            const literalMention = transcriptMentionsBackfillTarget(transcript, request.label);
            console.warn('[NPC State] targeted backfill returned no accepted NPC', { target: request.label, literalMention, returnedCount: returned.length });
            globalThis.toastr?.warning?.(`NPC State: ${request.label} was added, but the backfill model returned no matching dossier details from the last ${settings.scanDepth} messages.`);
            return false;
        }
        const latestState = getChatState(chatKey);
        const targetMessageId = Number.isInteger(messageId) ? messageId : latestMessageId(true);
        const merged = mergeScanResult(latestState, parsed, {
            maxNpcs: settings.maxNpcs,
            excludeNames: [...currentExclusions(), ...(latestState.dismissed || [])],
            turn: latestState.turn,
            sourceMessageId: targetMessageId,
            relationshipBaseline: settings.relationshipBaseline,
            relationshipCaps: settings.relationshipCaps,
            autoArchiveDeaths: settings.autoArchiveDeaths !== false,
            autoReactivateArchived: settings.autoReactivateArchived !== false,
            admissionMode: settings.admissionMode,
            preservePresence: true,
            skipRelationshipUpdate: true,
            developmentContext: transcript,
        });
        const nextState = merged.state;
        const finalNpc = nextState.npcs.find(npc => npc.id === request.npcId);
        if (targetMessageId >= 0 && finalNpc) {
            if (!finalNpc.archived && finalNpc.present) recordInlineCardsInState(nextState, targetMessageId, [finalNpc.id], 'ooc-backfill');
            else removeNpcInlineCardAtMessage(nextState, targetMessageId, finalNpc.id);
            commitBranchCheckpoint(nextState, targetMessageId, 'ooc-backfill');
        }
        setChatState(chatKey, nextState);
        persist();
        renderDossier();
        updateInjection();
        const savedNpc = nextState.npcs.find(npc => npc.id === request.npcId);
        globalThis.toastr?.success?.(`NPC State: backfilled ${savedNpc?.name || request.label} from recent story context.`);
        return true;
    } catch (error) {
        console.error('[NPC State] dossier backfill failed', error);
        globalThis.toastr?.warning?.(`NPC State backfill failed for ${request.label}: ${error?.message || error}`);
        return false;
    } finally {
        endScanOperation(chatKey, operation);
        if (getChatKey() === chatKey) setScanIndicator(isScanBusy(chatKey));
        updateInjection();
    }
}

async function processPendingBackfills(messageId = null) {
    const chatKey = getChatKey();
    if (chatKey === 'no-chat' || isScanBusy(chatKey) || isHostSwipeActive()) return 0;
    let processed = 0;
    while (getChatKey() === chatKey && !isScanBusy(chatKey)) {
        const state = getChatState(chatKey);
        if (!Array.isArray(state.pendingBackfills) || !state.pendingBackfills.length) break;
        const request = state.pendingBackfills[0];
        const succeeded = await backfillNpcFromHistory(request, messageId);
        if (!succeeded) {
            request.attempts = Math.max(0, Number(request.attempts || 0)) + 1;
            request.lastAttemptAt = Date.now();
            persist();
            break;
        }
        const latest = getChatState(chatKey);
        latest.pendingBackfills = (latest.pendingBackfills || []).filter(item => item !== request && item.npcId !== request.npcId);
        persist();
        processed += 1;
    }
    return processed;
}

function rawScanMatchesExisting(raw, npc) {
    if (!raw || !npc) return false;
    if (raw.id && String(raw.id) === String(npc.id)) return true;
    if (raw.name && npcMatchesLabel(npc, raw.name)) return true;
    return Array.isArray(raw.aliases) && raw.aliases.some(alias => npcMatchesLabel(npc, alias));
}

function hasCompletePrimaryRelationshipDecision(raw, transcript = '') {
    if (!raw || typeof raw !== 'object') return false;
    const delta = raw.relationshipDelta ?? raw.relationship_delta;
    const hasFullDelta = delta && typeof delta === 'object'
        && ['trust', 'affection', 'desire', 'tension'].every(key => Number.isFinite(Number(delta[key])));
    if (!hasFullDelta) return false;
    const rawImpact = String(raw.relationshipImpact ?? raw.impactLevel ?? raw.relationshipImpactLevel ?? '').trim().toLowerCase();
    if (!['none', 'ordinary', 'meaningful', 'major', 'extreme'].includes(rawImpact)) return false;
    const hasNonZero = ['trust', 'affection', 'desire', 'tension'].some(key => Number(delta[key]) !== 0);
    if (hasNonZero && rawImpact === 'none') return false;
    if (!hasNonZero && rawImpact !== 'none') return false;
    if (hasNonZero) {
        const reason = raw.relationshipChangeReason ?? raw.relationship_change_reason ?? raw.relationshipReason ?? '';
        if (!relationshipChangeReasonGrounded(reason, transcript)) return false;
        const evidenceSource = raw.relationshipEvidence ?? raw.relationship_evidence;
        if (!evidenceSource || typeof evidenceSource !== 'object') return false;
        const evidence = normalizeRelationshipEvidence(evidenceSource);
        for (const key of ['trust', 'affection', 'desire', 'tension']) {
            if (Number(delta[key]) !== 0 && !relationshipAxisEvidenceGrounded(key, evidence[key], transcript)) return false;
        }
    }
    if (hasNonZero && ['major', 'extreme'].includes(rawImpact)) {
        const summary = raw.relationshipSummary ?? raw.relationship_summary;
        if (typeof summary !== 'string' || !summary.trim()) return false;
    }
    return true;
}

async function runFocusedRelationshipPass(ctx, parsed, existingNpcs, transcript, settings) {
    const returned = Array.isArray(parsed?.npcs) ? parsed.npcs : [];
    // The focused evaluator is a REPAIR path, not a mandatory second scanner. A complete
    // primary relationship decision is applied directly, keeping normal scans to one model call.
    const targets = (Array.isArray(existingNpcs) ? existingNpcs : [])
        .filter(npc => !npc?.archived)
        .filter(npc => {
            const raw = returned.find(item => rawScanMatchesExisting(item, npc));
            return Boolean(raw) && !hasCompletePrimaryRelationshipDecision(raw, transcript);
        })
        .slice(0, 4);
    if (!targets.length) return { decisions: new Map(), used: false, responseChars: 0, retried: false, targetCount: 0 };

    try {
        const relationshipPrompt = buildRelationshipPassPrompt({
            transcript,
            targets,
            userName: ctx.name1 || 'User',
            relationshipCriteria: settings.relationshipCriteria,
            impactCriteria: settings.relationshipImpactCriteria,
            relationshipCaps: settings.relationshipCaps,
        });
        const { parsed: relationshipParsed, raw, retried } = await generateParsedNpcJson(ctx, {
            systemPrompt: "You are NPC State's isolated relationship evaluator. Use only the supplied targets and current exchange. Return only the requested JSON object.",
            prompt: relationshipPrompt,
            responseLength: RELATIONSHIP_RESPONSE_LENGTH,
            label: 'relationship pass',
        });
        const decisions = new Map();
        for (const target of targets) {
            const rawDecision = (relationshipParsed.npcs || []).find(item => String(item?.id || '') === String(target.id) || (item?.name && npcMatchesLabel(target, item.name)));
            if (!rawDecision) continue;
            const deltaSource = rawDecision.relationshipDelta ?? rawDecision.relationship_delta;
            const hasFullDelta = deltaSource && typeof deltaSource === 'object'
                && ['trust', 'affection', 'desire', 'tension'].every(key => Number.isFinite(Number(deltaSource[key])));
            if (!hasFullDelta) continue;
            const normalized = normalizeScanNpc(rawDecision);
            const hasNonZeroNormalizedDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);
            if (hasNonZeroNormalizedDelta && !relationshipChangeReasonGrounded(normalized.relationshipChangeReason, transcript)) continue;
            if (hasNonZeroNormalizedDelta && !Object.entries(normalized.relationshipDelta).every(([key, value]) => value === 0 || relationshipAxisEvidenceGrounded(key, normalized.relationshipEvidence?.[key], transcript))) continue;
            const rawSummary = rawDecision.relationshipSummary ?? rawDecision.relationship_summary;
            const explicitSummaryProvided = typeof rawSummary === 'string';
            const explicitSummary = explicitSummaryProvided ? String(rawSummary).trim().slice(0, 700) : '';
            const hasNonZeroDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);
            const needsTurningPointSummary = hasNonZeroDelta && ['major', 'extreme'].includes(normalized.relationshipImpact);
            const fallbackSummary = needsTurningPointSummary && !explicitSummary && normalized.relationshipChangeReason
                ? `${target.name || 'This NPC'}'s relationship with the player changed ${normalized.relationshipImpact === 'extreme' ? 'fundamentally' : 'substantially'}: ${normalized.relationshipChangeReason}`.slice(0, 700)
                : '';
            const relationshipSummary = explicitSummary || fallbackSummary;
            const relationshipSummaryDecisionProvided = explicitSummaryProvided || Boolean(fallbackSummary);
            decisions.set(target.id, {
                relationshipDelta: normalized.relationshipDelta,
                relationshipImpact: normalized.relationshipImpact,
                relationshipEvidence: normalized.relationshipEvidence,
                relationshipChangeReason: normalized.relationshipChangeReason,
                relationshipSummary,
                relationshipSummaryDecisionProvided,
            });
        }
        if (decisions.size !== targets.length) {
            console.warn('[NPC State] focused relationship pass omitted or malformed one or more target decisions.', {
                targets: targets.map(npc => npc.id),
                decided: [...decisions.keys()],
            });
        }
        return { decisions, used: true, responseChars: String(raw ?? '').length, retried: Boolean(retried), targetCount: targets.length };
    } catch (error) {
        console.warn('[NPC State] focused relationship pass failed; retaining the primary scanner relationship output.', error);
        return { decisions: new Map(), used: true, responseChars: 0, retried: false, targetCount: targets.length, failed: true };
    }
}

function prepareFullWindowRelationshipEvaluation(parsed, existingNpcs) {
    const evaluation = structuredClone(parsed || { npcs: [] });
    const mergeSafe = structuredClone(parsed || { npcs: [] });
    const existing = Array.isArray(existingNpcs) ? existingNpcs : [];
    for (let i = 0; i < (mergeSafe.npcs || []).length; i += 1) {
        const safeRaw = mergeSafe.npcs[i];
        const evalRaw = evaluation.npcs?.[i];
        const matched = existing.find(npc => rawScanMatchesExisting(safeRaw, npc));
        if (!matched) continue;
        // The rolling-history scanner may recover durable dossier facts, but numeric relationship
        // changes are non-idempotent. Never trust them from the rolling window. Force the focused
        // evaluator to score only the newest exchange; if that repair fails, zero is safer than replay.
        if (evalRaw) {
            delete evalRaw.relationship;
            delete evalRaw.relationship_delta;
            delete evalRaw.relationshipDelta;
            delete evalRaw.relationshipImpact;
            delete evalRaw.relationship_impact;
            delete evalRaw.relationshipChangeReason;
            delete evalRaw.relationship_change_reason;
            delete evalRaw.relationshipEvidence;
            delete evalRaw.relationship_evidence;
        }
        delete safeRaw.relationship;
        delete safeRaw.relationship_delta;
        safeRaw.relationshipImpact = 'none';
        safeRaw.relationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
        safeRaw.relationshipEvidence = { trust: '', affection: '', desire: '', tension: '' };
        safeRaw.relationshipChangeReason = '';
    }
    return { evaluation, mergeSafe };
}

function suppressPrimaryRelationshipForFocusedDecisions(parsed, decisions) {
    if (!decisions?.size) return parsed;
    const clone = structuredClone(parsed || { npcs: [] });
    for (const raw of clone.npcs || []) {
        const matchedId = [...decisions.keys()].find(id => {
            if (String(raw?.id || '') === String(id)) return true;
            const stateNpc = getChatState().npcs.find(npc => npc.id === id);
            return Boolean(stateNpc && raw?.name && npcMatchesLabel(stateNpc, raw.name));
        });
        if (!matchedId) continue;
        delete raw.relationship;
        delete raw.relationship_delta;
        if (decisions.get(matchedId)?.relationshipSummaryDecisionProvided) {
            delete raw.relationshipSummary;
            delete raw.relationship_summary;
        }
        raw.relationshipImpact = 'none';
        raw.relationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
        raw.relationshipEvidence = { trust: '', affection: '', desire: '', tension: '' };
        raw.relationshipChangeReason = '';
    }
    return clone;
}

function applyFocusedRelationshipDecisions(state, decisions, caps, sourceMessageId, report = null) {
    if (!decisions?.size) return state;
    for (const [id, decision] of decisions) {
        const npc = state.npcs.find(item => item.id === id);
        if (!npc) continue;
        const requestedHasDelta = Object.values(decision.relationshipDelta || {}).some(value => Number(value) !== 0);
        const evidence = normalizeRelationshipEvidence(decision.relationshipEvidence);
        const duplicateAward = requestedHasDelta && relationshipHistoryLooksDuplicate(npc.relationshipEventHistory, decision.relationshipChangeReason, {
            sourceMessageId,
            turn: state.turn,
            evidence,
        });
        const validReason = !requestedHasDelta || (relationshipChangeReasonGrounded(decision.relationshipChangeReason, '') && !duplicateAward);
        const update = applyRelationshipDelta(
            npc.relationship || DEFAULT_RELATIONSHIP,
            validReason ? decision.relationshipDelta : { trust: 0, affection: 0, desire: 0, tension: 0 },
            validReason ? decision.relationshipImpact : 'none',
            caps,
            npc.relationshipProgress,
            npc.relationshipMilestones,
        );
        npc.relationship = update.relationship;
        npc.relationshipProgress = update.relationshipProgress;
        npc.relationshipMilestones = applyRelationshipMilestoneCrossings(
            npc.relationshipMilestones,
            update.milestoneCrossings,
            {
                reason: decision.relationshipChangeReason || '',
                sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
                turn: Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
            },
        );
        const eventAccepted = Boolean(validReason && update.evidenceAccepted);
        const relationshipActuallyChanged = Object.values(update.appliedDelta || {}).some(value => Number(value) !== 0);
        const relationshipStateAdvanced = relationshipActuallyChanged
            || update.progressChanged
            || update.milestoneCrossings.length > 0;
        const narrativeAdvance = eventAccepted && (
            relationshipStateAdvanced
            || update.milestoneBlocks.length === 0
        );
        let summaryChanged = false;
        if (narrativeAdvance
            && decision.relationshipSummaryDecisionProvided
            && !(Array.isArray(npc.manualProfileFields) && npc.manualProfileFields.includes('relationshipSummary'))) {
            const proposedSummary = String(decision.relationshipSummary || '').trim().slice(0, 700);
            if (relationshipSummaryConsistent(proposedSummary, npc.relationship, '', npc.relationshipMilestones)) {
                const calibrated = calibrateRelationshipSummary(proposedSummary, npc.relationship);
                if (calibrated && calibrated !== String(npc.relationshipSummary || '').trim()) {
                    npc.relationshipSummary = calibrated;
                    summaryChanged = true;
                }
            }
        }
        if (eventAccepted) {
            const event = {
                impact: update.impact,
                delta: update.appliedDelta,
                evidence,
                reason: decision.relationshipChangeReason || '',
                sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
                turn: Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
            };
            npc.relationshipEventHistory = appendRelationshipEvent(npc.relationshipEventHistory, event);
            if (relationshipStateAdvanced) npc.lastRelationshipChange = event;
        } else {
            npc.relationshipEventHistory = normalizeRelationshipEventHistory(npc.relationshipEventHistory);
        }
        if (eventAccepted || update.progressChanged || summaryChanged) {
            npc.updatedAt = Date.now();
            if (report?.updated && !report.updated.includes(id)) report.updated.push(id);
        }
    }
    return state;
}

function collectStaleCleanupProtectedIds(state, scanResult, transcript = '') {
    const ids = new Set();
    const npcs = Array.isArray(state?.npcs) ? state.npcs : [];
    const addReference = (id, label) => {
        const directId = String(id || '').trim();
        if (directId && npcs.some(npc => npc.id === directId)) ids.add(directId);
        const name = String(label || '').trim();
        if (!name) return;
        const matched = npcs.find(npc => npcMatchesLabel(npc, name));
        if (matched) ids.add(matched.id);
    };

    for (const raw of Array.isArray(scanResult?.npcs) ? scanResult.npcs : []) addReference(raw?.id, raw?.name);
    for (const raw of Array.isArray(scanResult?.profileUpdates) ? scanResult.profileUpdates : []) addReference(raw?.id, raw?.name);
    for (const edge of Array.isArray(scanResult?.keyRelationshipEdges) ? scanResult.keyRelationshipEdges : []) {
        addReference(edge?.aId, edge?.a);
        addReference(edge?.bId, edge?.b);
    }

    // Conservative local guard: if the current scan text explicitly names a stale NPC,
    // never prune that dossier even if the model omitted its delta object.
    const haystack = ` ${normalizeName(transcript)} `;
    if (haystack.trim()) {
        for (const npc of npcs) {
            const labels = [npc.name, ...(npc.aliases || [])]
                .map(normalizeName)
                .filter(label => label.length >= 3);
            if (labels.some(label => haystack.includes(` ${label} `))) ids.add(npc.id);
        }
    }
    return ids;
}

function applyStaleLifecycleAfterScan(state, scanResult, transcript, settings, { onlyWhenAtCap = false } = {}) {
    if (settings.autoPruneStale === false) return { state, archived: [], removed: [] };
    const activeCount = (state.npcs || []).filter(npc => !npc?.archived).length;
    if (onlyWhenAtCap && activeCount < Number(settings.maxNpcs || 40)) return { state, archived: [], removed: [] };
    return applyStaleNpcLifecycle(state, {
        turn: state.turn,
        archiveAfter: settings.staleArchiveAfter,
        deleteAfter: settings.staleDeleteAfter,
        protectedIds: [...collectStaleCleanupProtectedIds(state, scanResult, transcript)],
    });
}

async function scanNow({ manual = false, messageId = null, allowDuringSwipe = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (!allowDuringSwipe && isHostSwipeActive()) {
        if (manual) globalThis.toastr?.info?.('NPC State: wait for the current swipe to finish before scanning.');
        return;
    }
    const ctx = getContext();
    const scanChatKey = getChatKey();
    if (scanChatKey === 'no-chat') return;
    await ensureChatStateLoaded(scanChatKey);
    if (isScanBusy(scanChatKey)) {
        if (manual) globalThis.toastr?.info?.('NPC State: another dossier scan is already running in this chat.');
        else if (Number.isInteger(messageId)) queuePendingAutoScan(scanChatKey, messageId, 'busy-auto-scan');
        return;
    }
    const scanLineage = chatLineage(ctx.chat || []);
    const currentTranscript = currentExchangeTranscript(messageId);
    const fullWindowScan = Boolean(!manual && settings.fullScanEveryTurn);
    const transcript = (manual || fullWindowScan) ? recentTranscript(settings.scanDepth) : currentTranscript;
    if (!transcript) {
        if (manual) globalThis.toastr?.warning?.('NPC State: no story text to scan yet.');
        return;
    }
    if (typeof ctx.generateRaw !== 'function') {
        globalThis.toastr?.error?.('NPC State: this SillyTavern build does not expose generateRaw().');
        return;
    }

    const operation = beginScanOperation(scanChatKey, manual ? 'manual dossier scan' : 'automatic dossier scan');
    if (!operation) return;
    setScanIndicator(true);
    const state = getChatState(scanChatKey);
    const scanStateVersion = Number(stateVersions.get(scanChatKey) || 0);
    const prompt = buildScannerPrompt({
        transcript,
        existingNpcs: state.npcs,
        candidates: state.candidates,
        userName: ctx.name1 || 'User',
        charName: ctx.name2 || 'Character',
        maxNpcs: settings.maxNpcs,
        relationshipBaseline: settings.relationshipBaseline,
        relationshipCaps: settings.relationshipCaps,
        relationshipCriteria: settings.relationshipCriteria,
        impactCriteria: settings.relationshipImpactCriteria,
        memoryCriteria: settings.memoryCriteria,
        admissionMode: settings.admissionMode,
        currentTranscript,
        fullScanMode: fullWindowScan,
    });

    let relationshipEdgeCount = 0;
    let relationshipEdgeFallbacks = 0;
    let profileUpdateCount = 0;
    try {
        const scanStartedAt = performance.now?.() ?? Date.now();
        const { parsed, raw, retried } = await generateParsedNpcJson(ctx, {
            systemPrompt: "You are NPC State's isolated dossier scanner. Use only the supplied scanner payload. Return only the requested JSON object.",
            prompt,
            responseLength: fullWindowScan ? FULL_SCAN_RESPONSE_LENGTH : SCAN_RESPONSE_LENGTH,
            label: manual ? 'manual dossier scan' : (fullWindowScan ? 'automatic full dossier scan' : 'automatic dossier scan'),
        });
        let currentLineage = chatLineage(getContext().chat || []);
        if (!scanOperationCurrent(scanChatKey, operation) || getChatKey() !== scanChatKey || firstLineageDivergence(scanLineage, currentLineage) !== -1 || Number(stateVersions.get(scanChatKey) || 0) !== scanStateVersion) {
            const scanFinishedAt = performance.now?.() ?? Date.now();
            lastScanMetrics = {
                label: manual ? 'manual' : (fullWindowScan ? 'automatic-full' : 'automatic'),
                durationMs: Math.max(0, Math.round(scanFinishedAt - scanStartedAt)),
                promptChars: prompt.length,
                responseChars: String(raw ?? '').length,
                retried: Boolean(retried),
                relationshipPass: false,
                relationshipTargets: 0,
                relationshipResponseChars: 0,
                relationshipRetried: false,
                relationshipEdges: relationshipEdgeCount,
                relationshipEdgeFallbacks,
                profileUpdates: profileUpdateCount,
                profileApplied: 0,
                profileEvidenceAdded: 0,
                stale: true,
                at: Date.now(),
            };
            console.info('[NPC State] discarded stale dossier scan after chat or dossier state changed.');
            if (manual) globalThis.toastr?.info?.('NPC State: chat changed during scan; stale result was discarded.');
            return;
        }

        const resolvedParsed = resolveInterimIdentityPromotions(parsed, state.npcs, state.candidates);
        profileUpdateCount = Array.isArray(resolvedParsed.profileUpdates) ? resolvedParsed.profileUpdates.length : (Array.isArray(resolvedParsed.profile_updates) ? resolvedParsed.profile_updates.length : 0);
        // Relationship-edge extraction is a separate channel from ordinary NPC delta admission.
        // Add a deterministic fallback for explicit binary statements so a missed lifecycle field
        // cannot silently discard facts such as "Elena is Marris's older sister".
        const explicitRelationshipEdges = extractExplicitKeyRelationshipEdges(transcript, state.npcs, currentExclusions());
        const modelEdges = Array.isArray(resolvedParsed.keyRelationshipEdges) ? resolvedParsed.keyRelationshipEdges : [];
        relationshipEdgeFallbacks = explicitRelationshipEdges.length;
        relationshipEdgeCount = modelEdges.length + explicitRelationshipEdges.length;
        if (explicitRelationshipEdges.length) resolvedParsed.keyRelationshipEdges = [...modelEdges, ...explicitRelationshipEdges];
        const fullWindowRelationship = fullWindowScan
            ? prepareFullWindowRelationshipEvaluation(resolvedParsed, state.npcs)
            : { evaluation: resolvedParsed, mergeSafe: resolvedParsed };
        const relationshipPass = await runFocusedRelationshipPass(ctx, fullWindowRelationship.evaluation, state.npcs, currentTranscript || transcript, settings);
        const scanFinishedAt = performance.now?.() ?? Date.now();
        lastScanMetrics = {
            label: manual ? 'manual' : (fullWindowScan ? 'automatic-full' : 'automatic'),
            durationMs: Math.max(0, Math.round(scanFinishedAt - scanStartedAt)),
            promptChars: prompt.length,
            responseChars: String(raw ?? '').length,
            retried: Boolean(retried),
            relationshipPass: relationshipPass.used,
            relationshipTargets: relationshipPass.targetCount,
            relationshipResponseChars: relationshipPass.responseChars,
            relationshipRetried: relationshipPass.retried,
            relationshipEdges: relationshipEdgeCount,
            relationshipEdgeFallbacks,
            profileUpdates: profileUpdateCount,
            profileApplied: 0,
            profileEvidenceAdded: 0,
            at: Date.now(),
        };
        currentLineage = chatLineage(getContext().chat || []);
        if (!scanOperationCurrent(scanChatKey, operation) || getChatKey() !== scanChatKey || firstLineageDivergence(scanLineage, currentLineage) !== -1 || Number(stateVersions.get(scanChatKey) || 0) !== scanStateVersion) {
            console.info('[NPC State] discarded stale dossier scan after chat or dossier state changed during relationship evaluation.');
            if (manual) globalThis.toastr?.info?.('NPC State: chat changed during scan; stale result was discarded.');
            return;
        }
        const targetMessageId = Number.isInteger(messageId) ? messageId : latestMessageId(true);
        const compactWorldStateTurn = hasCompactMeguminWorldState(ctx.chat?.[targetMessageId]?.mes || '');
        const parsedForMerge = suppressPrimaryRelationshipForFocusedDecisions(fullWindowRelationship.mergeSafe, relationshipPass.decisions);
        // If the registry is already full, free truly stale slots before admission so a new
        // current NPC is not rejected just because a long-gone dossier still occupies the cap.
        const preCleanup = applyStaleLifecycleAfterScan(state, parsedForMerge, currentTranscript || transcript, settings, { onlyWhenAtCap: true });
        const mergeBaseState = structuredClone(preCleanup.state);
        for (const npc of mergeBaseState.npcs || []) {
            npc.present = false;
            if (!compactWorldStateTurn) npc.worldActive = false;
        }
        const merged = mergeScanResult(mergeBaseState, parsedForMerge, {
            maxNpcs: settings.maxNpcs,
            excludeNames: [...currentExclusions(), ...(state.dismissed || [])],
            turn: state.turn,
            sourceMessageId: targetMessageId,
            relationshipBaseline: settings.relationshipBaseline,
            relationshipCaps: settings.relationshipCaps,
            autoArchiveDeaths: settings.autoArchiveDeaths !== false,
            autoReactivateArchived: settings.autoReactivateArchived !== false,
            admissionMode: settings.admissionMode,
            preserveWorldActive: compactWorldStateTurn,
            developmentContext: transcript,
        });
        if (lastScanMetrics) {
            lastScanMetrics.profileApplied = Number(merged.report?.profileUpdateStats?.applied || 0);
            lastScanMetrics.profileEvidenceAdded = Number(merged.report?.profileUpdateStats?.evidenceAdded || 0);
            console.info('[NPC State] dossier scan metrics', lastScanMetrics);
        }
        applyFocusedRelationshipDecisions(merged.state, relationshipPass.decisions, settings.relationshipCaps, targetMessageId, merged.report);
        const postCleanup = applyStaleLifecycleAfterScan(merged.state, parsedForMerge, currentTranscript || transcript, settings);
        const staleArchived = [...preCleanup.archived, ...postCleanup.archived]
            .filter((entry, index, all) => all.findIndex(other => other.id === entry.id) === index);
        const stalePruned = [...preCleanup.removed, ...postCleanup.removed]
            .filter((entry, index, all) => all.findIndex(other => other.id === entry.id) === index);
        merged.state = postCleanup.state;
        merged.report.staleArchived = staleArchived;
        merged.report.stalePruned = stalePruned;
        if (lastScanMetrics) {
            lastScanMetrics.staleArchived = staleArchived.length;
            lastScanMetrics.stalePruned = stalePruned.length;
        }
        const chatKey = scanChatKey;
        const nextState = {
            ...merged.state,
            assistantSinceScan: 0,
            lastScanAt: Date.now(),
            lastScannedMessageId: Number.isInteger(messageId) ? messageId : ((ctx.chat || []).length - 1),
            scanCount: Number(state.scanCount || 0) + 1,
        };
        const inlineIds = scanInlineNpcIds(resolvedParsed, merged);
        if (targetMessageId >= 0) {
            clearInlineCardsAtMessage(nextState, targetMessageId);
            if (inlineIds.length) recordInlineCardsInState(nextState, targetMessageId, inlineIds, 'scan');
        }
        if (targetMessageId >= 0) commitBranchCheckpoint(nextState, targetMessageId, 'scan');
        setChatState(chatKey, nextState);
        persist();
        renderDossier();
        updateInjection();
        if (manual) {
            const { created, updated, candidates, promoted, skipped, staleArchived = [], stalePruned = [] } = merged.report;
            globalThis.toastr?.success?.(`NPC State scan complete: ${created.length} new, ${updated.length} updated${promoted.length ? `, ${promoted.length} promoted` : ''}${candidates.length ? `, ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} held` : ''}${staleArchived.length ? `, ${staleArchived.length} stale archived` : ''}${stalePruned.length ? `, ${stalePruned.length} stale deleted` : ''}${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
        } else if ((merged.report.staleArchived || []).length || (merged.report.stalePruned || []).length) {
            const archivedCount = (merged.report.staleArchived || []).length;
            const removed = merged.report.stalePruned || [];
            const names = removed.slice(0, 3).map(item => item.name).join(', ');
            const extra = removed.length > 3 ? ` +${removed.length - 3} more` : '';
            const parts = [];
            if (archivedCount) parts.push(`${archivedCount} stale archived`);
            if (removed.length) parts.push(`${removed.length} stale deleted${names ? ` (${names}${extra})` : ''}`);
            globalThis.toastr?.info?.(`NPC State: ${parts.join(', ')}. Deleted stale NPCs can be rediscovered if they return.`);
        }
    } catch (error) {
        console.error('[NPC State] dossier scan failed', error);
        if (manual) globalThis.toastr?.error?.(`NPC State scan failed: ${error?.message || error}`);
    } finally {
        endScanOperation(scanChatKey, operation);
        if (getChatKey() === scanChatKey) setScanIndicator(isScanBusy(scanChatKey));
        updateInjection();
        if (getChatKey() === scanChatKey) void drainPendingAutoScan(scanChatKey);
    }
}

function setScanIndicator(busy) {
    const button = $('#npc_state_scan_now');
    if (!button.length) return;
    button.toggleClass('npc-state-busy', busy);
    button.html(busy ? '<i class="fa-solid fa-spinner fa-spin"></i> Scanning dossier...' : '<i class="fa-solid fa-wand-magic-sparkles"></i> Scan dossier now');
}

function settingRow(id, label, control, hint = '') {
    return `<label class="npc-state-setting-row" for="${id}"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>${control}</label>`;
}

function buildSettingsHtml() {
    return `
    <div id="${UI_ID}" class="extension_container npc-state-extension">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>NPC State <span class="npc-state-version">v${NPC_STATE_VERSION}</span></b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content npc-state-drawer">
          <div class="npc-state-intro">Standalone narrated-NPC dossier tracker. Admission is configurable: Conservative avoids routine transactional extras, Balanced admits direct interactions more eagerly, and Manual only requires explicit promotion. Incidental role-only figures stay lightweight candidates; only NPCs detected as physically present in the latest scene receive a new inline card. Settings Add NPC creates a bare dossier with a per-NPC Scan dossier wand; OOC <code>add</code> still creates/promotes and backfills recent story context; Settings trash or OOC <code>remove</code> hard-deletes/suppresses it.</div>
          <div class="npc-state-settings-grid">
            ${settingRow('npc_state_enabled', 'Enable NPC State', '<input id="npc_state_enabled" type="checkbox">')}
            ${settingRow('npc_state_auto', 'Auto scan', '<input id="npc_state_auto" type="checkbox">', 'Runs after assistant replies.')}
            ${settingRow('npc_state_full_scan_every_turn', 'Full scan every turn', '<input id="npc_state_full_scan_every_turn" type="checkbox">', 'When Auto scan is enabled, reconcile the configured recent-story window after every assistant reply instead of scanning only the current exchange. Overrides Scan every. Uses more context/output tokens, but relationship-score deltas still come only from the newest exchange so old events are not replayed.')}
            ${settingRow('npc_state_scan_every', 'Scan every', '<span><input id="npc_state_scan_every" type="number" min="1" max="20" class="text_pole npc-state-number"> replies</span>', 'Quick-scan cadence when Full scan every turn is off.')}
            ${settingRow('npc_state_scan_depth', 'Full/manual scan context', '<span><input id="npc_state_scan_depth" type="number" min="2" max="30" class="text_pole npc-state-number"> messages</span>', 'History window used by Full scan every turn, global Scan dossier now, OOC Add backfill, per-NPC dossier fallback, and Edit Dossier Refresh from Chat. Quick automatic scans still use only the current user + assistant exchange.')}
            ${settingRow('npc_state_admission_mode', 'NPC admission', '<select id="npc_state_admission_mode" class="text_pole"><option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="manual_only">Manual only</option></select>', 'Conservative: proper names immediately; role labels require confirmed recurrence or manual Add. Balanced: meaningful/persistent or directly interactive role NPCs can also admit immediately. Manual only: all new dossiers require OOC/manual Add.')}
            ${settingRow('npc_state_max', 'Maximum active NPCs', '<input id="npc_state_max" type="number" min="1" max="100" class="text_pole npc-state-number">', 'Cap for active dossiers only. Archived dossiers no longer consume an active roster slot.')}
            ${settingRow('npc_state_auto_prune_stale', 'Auto-manage stale NPCs', '<input id="npc_state_auto_prune_stale" type="checkbox">', 'Two-stage stale lifecycle after successful scans: long-absent active NPCs auto-archive first, then stale auto-archives are deleted later. Manual/death archives and protected NPCs are preserved; deleted stale names are not suppressed and can be rediscovered.')}
            ${settingRow('npc_state_stale_archive_after', 'Auto-archive after', '<span><input id="npc_state_stale_archive_after" type="number" min="10" max="999" class="text_pole npc-state-number"> assistant replies</span>', 'Default 30. Counts NPC State story turns since the NPC was last physically present or explicitly active off-screen. Auto-archive immediately frees an active roster slot.')}
            ${settingRow('npc_state_stale_delete_after', 'Auto-delete after', '<span><input id="npc_state_stale_delete_after" type="number" min="11" max="1000" class="text_pole npc-state-number"> assistant replies</span>', 'Default 50. Only NPCs auto-archived for staleness are timed out. Manual archives and confirmed-death archives are never deleted by this timer.')}
            ${settingRow('npc_state_inject', 'Inject present NPC state', '<input id="npc_state_inject" type="checkbox">', 'Only active, non-archived NPCs marked present in the latest scanned scene are eligible for generation injection.')}
            ${settingRow('npc_state_inject_budget', 'Injection budget', '<span>~<input id="npc_state_inject_budget" type="number" min="512" max="6000" step="100" class="text_pole npc-state-number"> tokens</span>', 'Approximate hard ceiling for the present-NPC dossier injected into main generation. If needed, lower-priority fields and then lower-ranked NPCs are trimmed first.')}
            ${settingRow('npc_state_archive_deaths', 'Archive confirmed deaths', '<input id="npc_state_archive_deaths" type="checkbox">', 'Explicitly confirmed current-timeline deaths are archived instead of deleted. Ambiguous death language is ignored.')}
            ${settingRow('npc_state_reactivate_archived', 'Reactivate on clear return', '<input id="npc_state_reactivate_archived" type="checkbox">', 'Manually archived NPCs reactivate when they physically return or are clearly active off-screen in current World State. Death-archived NPCs require an explicit living return, survival, or resurrection.')}
            ${settingRow('npc_state_branch_rescan', 'Rescan changed branches', '<input id="npc_state_branch_rescan" type="checkbox">', 'Re-evaluates the surviving branch after a swipe/edit or middle-message deletion.')}
          </div>
          <details class="npc-state-portrait-generation-settings">
            <summary><b>Portrait generation</b> <small>SillyTavern Image Generation integration</small></summary>
            <div class="npc-state-portrait-settings-body">
              <p class="npc-state-muted">NPC State builds a positive + negative prompt from the dossier, then calls SillyTavern's native <code>/imagine</code> command with <code>quiet=true</code>. SillyTavern keeps control of the configured image backend, model/checkpoint, sampler, steps, workflow, credentials, and resolution.</p>
              ${settingRow('npc_state_portrait_generation_enabled', 'Enable Generate Portrait', '<input id="npc_state_portrait_generation_enabled" type="checkbox">', 'Shows Generate Portrait in the dossier utility menu. If SillyTavern Image Generation is unavailable or unconfigured, generation fails safely without changing the dossier.')}
              <label class="npc-state-rubric-label" for="npc_state_portrait_theme_preset"><b>Theme preset</b><small>Choosing a preset replaces the global positive/negative style fields below. Choose Custom before hand-editing them.</small></label>
              <select id="npc_state_portrait_theme_preset" class="text_pole">${Object.entries(PORTRAIT_THEME_PRESETS).map(([key, item]) => `<option value="${key}">${escapeHtml(item.label)}</option>`).join('')}</select>
              <label class="npc-state-rubric-label" for="npc_state_portrait_style_positive"><b>Positive style / theme</b><small>Use this for a house style such as anime key visual, painterly fantasy, dark medieval, or your own model-specific style keywords.</small></label>
              <textarea id="npc_state_portrait_style_positive" class="text_pole npc-state-rubric-textarea" rows="4" maxlength="2400"></textarea>
              <label class="npc-state-rubric-label" for="npc_state_portrait_style_negative"><b>Global negative prompt</b><small>Quality, anatomy, composition, or style exclusions applied to every generated NPC portrait.</small></label>
              <textarea id="npc_state_portrait_style_negative" class="text_pole npc-state-rubric-textarea" rows="4" maxlength="2400"></textarea>
              <label class="npc-state-rubric-label" for="npc_state_portrait_composition"><b>Portrait composition</b><small>Kept separate from appearance so you can change framing without rewriting dossiers.</small></label>
              <textarea id="npc_state_portrait_composition" class="text_pole npc-state-rubric-textarea" rows="3" maxlength="1200"></textarea>
              <div class="npc-state-portrait-settings-grid">
                ${settingRow('npc_state_portrait_prompt_format', 'Prompt format', '<select id="npc_state_portrait_prompt_format" class="text_pole"><option value="hybrid">Structured hybrid</option><option value="tags">Comma tags</option><option value="natural">Natural language</option></select>', 'Hybrid keeps theme tags while grouping dossier facts; Tags favors SD/anime checkpoints; Natural is useful for instruction-oriented image models.')}
                ${settingRow('npc_state_portrait_use_mood', 'Use current mood', '<input id="npc_state_portrait_use_mood" type="checkbox">', 'Adds current mood as expression/bearing. Stable Personality and Background are never dumped into the image prompt.')}
                ${settingRow('npc_state_portrait_use_location', 'Use current location', '<input id="npc_state_portrait_use_location" type="checkbox">', 'Off by default so portraits stay character-focused.')}
                ${settingRow('npc_state_portrait_save_gallery', 'Also save to ST character gallery', '<input id="npc_state_portrait_save_gallery" type="checkbox">', 'Off by default. NPC State embeds only the result you choose as its portrait. Enable this if you also want each native generation placed in the current SillyTavern character gallery.')}
              </div>
              <div class="npc-state-actions npc-state-tuning-actions"><div id="npc_state_reset_portrait_theme" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset Fantasy Anime theme</div></div>
            </div>
          </details>
          <details class="npc-state-relationship-tuning">
            <summary><b>Relationship tuning</b> <small>Delta rules and scanner rubric</small></summary>
            <div class="npc-state-tuning-body">
              <p class="npc-state-muted">The scanner proposes relationship deltas; NPC State applies them in code and clamps every stat to the selected impact-tier cap. Stats are bipolar from -100 to +100 with 0 neutral. Starting values affect newly created NPCs only.</p>
              <div class="npc-state-tuning-grid">
                <div class="npc-state-tuning-group"><b>New NPC starting values</b>
                  <label>Trust <input id="npc_state_base_trust" type="number" min="-100" max="100" class="text_pole npc-state-number"></label>
                  <label>Affection <input id="npc_state_base_affection" type="number" min="-100" max="100" class="text_pole npc-state-number"></label>
                  <label>Desire <input id="npc_state_base_desire" type="number" min="-100" max="100" class="text_pole npc-state-number"></label>
                  <label>Tension <input id="npc_state_base_tension" type="number" min="-100" max="100" class="text_pole npc-state-number"></label>
                </div>
                <div class="npc-state-tuning-group"><b>Maximum ± change per scan</b>
                  <label>Ordinary <input id="npc_state_cap_ordinary" type="number" min="0" max="25" class="text_pole npc-state-number"></label>
                  <label>Meaningful <input id="npc_state_cap_meaningful" type="number" min="0" max="35" class="text_pole npc-state-number"></label>
                  <label>Major <input id="npc_state_cap_major" type="number" min="0" max="50" class="text_pole npc-state-number"></label>
                  <label>Extreme <input id="npc_state_cap_extreme" type="number" min="0" max="100" class="text_pole npc-state-number"></label>
                </div>
              </div>
              <label class="npc-state-rubric-label" for="npc_state_relationship_criteria"><b>Relationship stat criteria</b><small>Injected into the private dossier scanner. Change these definitions/evidence rules to suit your RP.</small></label>
              <textarea id="npc_state_relationship_criteria" class="text_pole npc-state-rubric-textarea" rows="9"></textarea>
              <label class="npc-state-rubric-label" for="npc_state_impact_criteria"><b>Impact-tier criteria</b><small>Defines what counts as ordinary, meaningful, major, or extreme. Code caps still apply even if the model proposes larger numbers.</small></label>
              <textarea id="npc_state_impact_criteria" class="text_pole npc-state-rubric-textarea" rows="7"></textarea>
              <div class="npc-state-actions npc-state-tuning-actions"><div id="npc_state_reset_relationship_rules" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset relationship rules</div></div>
            </div>
          </details>
          <details class="npc-state-relationship-tuning npc-state-memory-tuning">
            <summary><b>Important memory tuning</b> <small>What becomes a persistent NPC memory</small></summary>
            <div class="npc-state-tuning-body">
              <p class="npc-state-muted">This rubric is injected into automatic scans and targeted backfills. It decides which established events are durable enough to enter the NPC's persistent Important memories list. Existing memories are shown to the scanner for strongly relevant NPCs so it can avoid duplicates.</p>
              <label class="npc-state-rubric-label" for="npc_state_memory_criteria"><b>Important Memory Criteria</b><small>Define what should be remembered across later scenes. Keep routine dialogue, transient feelings, and moment-to-moment Inner Chatter out unless you intentionally change the rubric.</small></label>
              <textarea id="npc_state_memory_criteria" class="text_pole npc-state-rubric-textarea" rows="8"></textarea>
              <div class="npc-state-actions npc-state-tuning-actions"><div id="npc_state_reset_memory_rules" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset memory criteria</div></div>
            </div>
          </details>
          <details class="npc-state-relationship-tuning npc-state-behavior-tuning">
            <summary><b>Behavior expression</b> <small>How relationship stats affect present NPC behavior</small></summary>
            <div class="npc-state-tuning-body">
              <p class="npc-state-muted">This rubric is injected only with NPCs marked present. Identity is injected first: Personality, Behavioral profile, Speech, and Mannerisms remain authoritative while Trust, Affection, Desire, and Tension only modify player-specific expression. High relationship scores do not imply obedience, jealousy, clinginess, cruelty toward others, or a generic romance archetype.</p>
              <label class="npc-state-rubric-label" for="npc_state_behavior_criteria"><b>Relationship-to-behavior rubric</b><small>Edit this if your RP uses different behavioral assumptions.</small></label>
              <textarea id="npc_state_behavior_criteria" class="text_pole npc-state-rubric-textarea" rows="10"></textarea>
              <div class="npc-state-actions npc-state-tuning-actions"><div id="npc_state_reset_behavior_rules" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset behavior rubric</div></div>
            </div>
          </details>
          <div class="npc-state-actions">
            <div id="npc_state_scan_now" class="menu_button"><i class="fa-solid fa-wand-magic-sparkles"></i> Scan dossier now</div>
            <div id="npc_state_add_manual" class="menu_button"><i class="fa-solid fa-user-plus"></i> Add NPC</div>
            <div id="npc_state_export_bundle" class="menu_button"><i class="fa-solid fa-file-export"></i> Export dossier</div>
            <input id="npc_state_import_bundle_file" type="file" accept=".npcstate,application/octet-stream" hidden>
            <label for="npc_state_import_bundle_file" class="menu_button"><i class="fa-solid fa-file-import"></i> Import dossier</label>
            <div id="npc_state_clear_chat" class="menu_button redWarningBG"><i class="fa-solid fa-trash"></i> Clear chat dossier</div>
          </div>
          <div id="npc_state_roster_summary" class="npc-state-roster-summary"></div>
        </div>
      </div>
    </div>`;
}

function syncSettingsControls() {
    const s = getSettings();
    $('#npc_state_enabled').prop('checked', !!s.enabled);
    $('#npc_state_auto').prop('checked', !!s.autoScan);
    $('#npc_state_full_scan_every_turn').prop('checked', !!s.fullScanEveryTurn);
    $('#npc_state_scan_every').val(s.scanEvery);
    $('#npc_state_scan_depth').val(s.scanDepth);
    $('#npc_state_admission_mode').val(s.admissionMode);
    $('#npc_state_max').val(s.maxNpcs);
    $('#npc_state_auto_prune_stale').prop('checked', s.autoPruneStale !== false);
    $('#npc_state_stale_archive_after').val(s.staleArchiveAfter);
    $('#npc_state_stale_delete_after').val(s.staleDeleteAfter);
    $('#npc_state_inject').prop('checked', !!s.inject);
    $('#npc_state_inject_budget').val(s.injectBudgetTokens);
    $('#npc_state_archive_deaths').prop('checked', s.autoArchiveDeaths !== false);
    $('#npc_state_reactivate_archived').prop('checked', s.autoReactivateArchived !== false);
    $('#npc_state_branch_rescan').prop('checked', s.branchRescan !== false);
    $('#npc_state_portrait_generation_enabled').prop('checked', s.portraitGenerationEnabled !== false);
    $('#npc_state_portrait_theme_preset').val(s.portraitThemePreset);
    $('#npc_state_portrait_style_positive').val(s.portraitStylePositive);
    $('#npc_state_portrait_style_negative').val(s.portraitStyleNegative);
    $('#npc_state_portrait_composition').val(s.portraitComposition);
    $('#npc_state_portrait_prompt_format').val(s.portraitPromptFormat);
    $('#npc_state_portrait_use_mood').prop('checked', s.portraitUseMood !== false);
    $('#npc_state_portrait_use_location').prop('checked', s.portraitUseLocation === true);
    $('#npc_state_portrait_save_gallery').prop('checked', s.portraitSaveToGallery === true);
    $('#npc_state_base_trust').val(s.relationshipBaseline.trust);
    $('#npc_state_base_affection').val(s.relationshipBaseline.affection);
    $('#npc_state_base_desire').val(s.relationshipBaseline.desire);
    $('#npc_state_base_tension').val(s.relationshipBaseline.tension);
    $('#npc_state_cap_ordinary').val(s.relationshipCaps.ordinary);
    $('#npc_state_cap_meaningful').val(s.relationshipCaps.meaningful);
    $('#npc_state_cap_major').val(s.relationshipCaps.major);
    $('#npc_state_cap_extreme').val(s.relationshipCaps.extreme);
    $('#npc_state_relationship_criteria').val(s.relationshipCriteria);
    $('#npc_state_impact_criteria').val(s.relationshipImpactCriteria);
    $('#npc_state_memory_criteria').val(s.memoryCriteria);
    $('#npc_state_behavior_criteria').val(s.behaviorCriteria);
}

function relationshipNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.max(-100, Math.min(100, number))) : 0;
}

function signedRelationship(value) {
    const number = relationshipNumber(value);
    return number > 0 ? `+${number}` : String(number);
}

function barHtml(label, value, kind) {
    const number = relationshipNumber(value);
    const width = Math.abs(number) / 2;
    const left = number >= 0 ? 50 : 50 - width;
    const polarity = number < 0 ? 'negative' : (number > 0 ? 'positive' : 'neutral');
    return `<div class="npc-state-bar-row"><div class="npc-state-bar-label"><span>${escapeHtml(label)}</span><b>${signedRelationship(number)}</b></div><div class="npc-state-bar"><i class="npc-state-bar-zero"></i><i class="npc-state-bar-fill npc-state-${kind} npc-state-bar-${polarity}" style="left:${left}%;width:${width}%"></i></div></div>`;
}

function latestMessageId(preferAssistant = false) {
    const chat = getContext().chat || [];
    if (preferAssistant) {
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            if (chat[i] && !chat[i].is_system && !chat[i].is_user) return i;
        }
    }
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        if (chat[i] && !chat[i].is_system) return i;
    }
    return -1;
}

function snapshotNpc(npc) {
    return {
        id: npc.id,
        name: npc.name || '',
        aliases: [...(npc.aliases || [])],
        role: npc.role || '',
        species: npc.species || '',
        age: npc.age || '',
        apparentAge: npc.apparentAge || '',
        appearance: npc.appearance || '',
        personality: npc.personality || '',
        speech: npc.speech || '',
        behaviorProfile: [...(npc.behaviorProfile || [])],
        background: npc.background || '',
        relationshipSummary: npc.relationshipSummary || '',
        mood: npc.mood || '',
        location: npc.location || '',
        goal: npc.goal || '',
        status: npc.status || '',
        memories: [...(npc.memories || [])],
        mannerisms: [...(npc.mannerisms || [])],
        keyRelationships: [...(npc.keyRelationships || [])],
        present: Boolean(npc.present),
        worldActive: Boolean(npc.worldActive),
        lifeState: npc.lifeState || 'unknown',
        lifeStateCertainty: npc.lifeStateCertainty || '',
        lifeStateReason: npc.lifeStateReason || '',
        archived: Boolean(npc.archived),
        archiveReason: npc.archiveReason || '',
        archivedAt: npc.archivedAt || null,
        archiveSourceMessageId: Number.isInteger(npc.archiveSourceMessageId) ? npc.archiveSourceMessageId : null,
        importance: Number(npc.importance || 0),
        relationship: { ...(npc.relationship || {}) },
        lastRelationshipChange: structuredClone(npc.lastRelationshipChange || { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, reason: '', sourceMessageId: null }),
        updatedAt: npc.updatedAt || Date.now(),
        seenCount: Number(npc.seenCount || 0),
        manualProfileFields: [...(npc.manualProfileFields || [])],
        retentionProtected: Boolean(npc.retentionProtected),
        minor: Boolean(npc.minor),
    };
}

function currentLineageKeyForMessage(messageId) {
    const lineage = chatLineage(getContext().chat || []);
    return lineageCheckpointKey(lineage, messageId);
}

function clearUserDismissedSuppression(state, target) {
    if (!state || typeof state !== 'object') return state;
    const cleared = clearUserDismissedGroupsFor(state.userDismissedGroups, target, { modernByIdOnly: true });
    state.userDismissedGroups = cleared.groups;
    if (cleared.removedLabels.length) {
        const removed = new Set(cleared.removedLabels.map(normalizeName).filter(Boolean));
        state.dismissed = (Array.isArray(state.dismissed) ? state.dismissed : [])
            .filter(label => !removed.has(normalizeName(label)));
    }
    return state;
}

function recordInlineCardsInState(state, messageId, npcIds, reason = 'scan') {
    if (!Number.isInteger(messageId) || messageId < 0) return state;
    if (!Array.isArray(state.inlineCards)) state.inlineCards = [];
    const ids = [...new Set((npcIds || []).filter(Boolean))];
    const cards = ids.map(id => state.npcs.find(npc => npc.id === id)).filter(Boolean).map(snapshotNpc);
    if (!cards.length) return state;
    const messageFingerprint = fingerprintMessage((getContext().chat || [])[messageId] || {});
    const lineageKey = currentLineageKeyForMessage(messageId);
    let entry = state.inlineCards.find(item => lineageKey && item.lineageKey === lineageKey);
    if (!entry) {
        entry = { messageId, fingerprint: messageFingerprint, lineageKey, reason, createdAt: Date.now(), cards: [] };
        state.inlineCards.push(entry);
    }
    entry.messageId = messageId;
    entry.fingerprint = messageFingerprint;
    entry.lineageKey = lineageKey;
    entry.reason = reason || entry.reason;
    entry.createdAt = Date.now();
    for (const card of cards) {
        const index = entry.cards.findIndex(existing => existing.id === card.id);
        if (index >= 0) entry.cards[index] = card;
        else entry.cards.push(card);
    }
    state.inlineCards.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    if (state.inlineCards.length > INLINE_HISTORY_LIMIT) state.inlineCards.splice(0, state.inlineCards.length - INLINE_HISTORY_LIMIT);
    return state;
}

function clearInlineCardsAtMessage(state, messageId) {
    if (!Array.isArray(state.inlineCards)) state.inlineCards = [];
    const lineageKey = currentLineageKeyForMessage(messageId);
    state.inlineCards = state.inlineCards.filter(entry => {
        if (lineageKey && entry?.lineageKey) return entry.lineageKey !== lineageKey;
        return !(Number(entry?.messageId) === Number(messageId) && entry?.fingerprint === fingerprintMessage((getContext().chat || [])[messageId] || {}));
    });
    return state;
}

function removeNpcInlineCardAtMessage(state, messageId, npcId) {
    if (!Array.isArray(state.inlineCards) || !Number.isInteger(messageId) || messageId < 0 || !npcId) return state;
    const lineageKey = currentLineageKeyForMessage(messageId);
    state.inlineCards = state.inlineCards.map(entry => {
        const matches = lineageKey && entry?.lineageKey
            ? entry.lineageKey === lineageKey
            : Number(entry?.messageId) === Number(messageId);
        if (!matches) return entry;
        return { ...entry, cards: (entry.cards || []).filter(card => card.id !== npcId) };
    }).filter(entry => (entry.cards || []).length);
    return state;
}

function purgeInlineCardsInState(state, npcId = null, name = '') {
    if (!Array.isArray(state.inlineCards)) state.inlineCards = [];
    state.inlineCards = state.inlineCards.map(entry => ({
        ...entry,
        cards: (entry.cards || []).filter(card => {
            if (npcId && card.id === npcId) return false;
            if (name && npcMatchesLabel(card, name)) return false;
            return true;
        }),
    })).filter(entry => entry.cards.length);
    return state;
}

function scanInlineNpcIds(_parsed, merged) {
    // mergeScanResult clears stale presence on ordinary scans and then reapplies the
    // latest scanner result. The merged state is therefore the authoritative source
    // for which NPCs belong under the current assistant message. Do not require a
    // second "touched" match here: that could leave the roster showing ● present
    // while no inline snapshot was recorded.
    return merged.state.npcs
        .filter(npc => !npc.archived && npc.present && !npc.minor)
        .map(npc => npc.id);
}

function currentNpcById(id) {
    return getChatState().npcs.find(npc => npc.id === id) || null;
}

function findNpcByIdOrName(value) {
    const query = String(value || '').trim();
    if (!query) return null;
    const normalized = normalizeName(query);
    return getChatState().npcs.find(npc => npc.id === query || normalizeName(npc.name) === normalized) || null;
}

function portraitMarkup(npc, displayName, placeholderClass = 'npc-state-inline-avatar-placeholder') {
    const portraitUrl = npc?.portrait?.dataUrl || '';
    if (portraitUrl) return `<img src="${escapeHtml(portraitUrl)}" alt="${escapeHtml(displayName)} portrait">`;
    const initial = String(displayName || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="${placeholderClass}" aria-hidden="true"><span>${escapeHtml(initial)}</span></div>`;
}

function inlineCardHtml(npc, messageId) {
    if (!npc || npc.archived || !npc.present || npc.minor) return '';
    const displayName = npc.name || 'NPC';
    const identityLine = [npc.role, npc.mood].filter(Boolean).join(' · ') || 'Present NPC';
    const portrait = portraitMarkup(npc, displayName, 'npc-state-present-card-placeholder');
    return `
      <button type="button" class="npc-state-present-card" data-npc-id="${escapeHtml(npc.id)}" data-message-id="${messageId}" aria-label="Open ${escapeHtml(displayName)} dossier">
        <span class="npc-state-present-card-portrait">${portrait}</span>
        <span class="npc-state-present-card-overlay">
          <b>${escapeHtml(displayName)}</b>
          <small>${escapeHtml(identityLine)}</small>
        </span>
      </button>`;
}

function inlineRosterHtml(cards, messageId) {
    const currentById = new Map(getChatState().npcs.map(npc => [npc.id, npc]));
    const visible = (cards || []).map(card => currentById.get(card.id)).filter(npc => npc?.present && !npc.archived && !npc.minor);
    if (!visible.length) return '';
    return `
      <section class="npc-state-present-roster" data-message-id="${messageId}">
        <div class="npc-state-present-roster-head"><span class="npc-state-kicker">PRESENT NPCS</span><small>${visible.length} shown</small></div>
        <div class="npc-state-present-grid">${visible.map(npc => inlineCardHtml(npc, messageId)).join('')}</div>
      </section>`;
}

function relationshipChangeHtml(card) {
    const lastChange = normalizeNpcRecord(card).lastRelationshipChange || {};
    const delta = lastChange.delta || {};
    const changeParts = [['Trust', delta.trust], ['Affection', delta.affection], ['Desire', delta.desire], ['Tension', delta.tension]]
        .map(([label, value]) => [label, Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value !== 0)
        .map(([label, value]) => `<span class="npc-state-delta-pill">${label} ${value > 0 ? '+' : ''}${Math.round(value)}</span>`);
    if (!changeParts.length) return '';
    const impactLabel = String(lastChange.impact || 'ordinary').replace(/[^a-z]/gi, '').toLowerCase();
    const safeImpact = ['none', 'ordinary', 'meaningful', 'major', 'extreme', 'manual'].includes(impactLabel) ? impactLabel : 'ordinary';
    return `
      <section class="npc-state-viewer-section npc-state-relationship-change"><b>Last relationship change</b>
        <p><span class="npc-state-impact-badge">${escapeHtml(safeImpact)}</span>${changeParts.join('')}</p>
        ${lastChange.reason ? `<p>${escapeHtml(lastChange.reason)}</p>` : ''}
      </section>`;
}

function npcViewerDialogHtml(npc, messageId = -1) {
    const rel = npc.relationship || {};
    const displayName = npc.name || 'NPC';
    const portrait = portraitMarkup(npc, displayName, 'npc-state-viewer-placeholder');
    const inputId = `npc_state_viewer_portrait_${String(npc.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const portraitUrl = npc?.portrait?.dataUrl || '';
    const generatePortraitAction = getSettings().portraitGenerationEnabled !== false
        ? `<button type="button" class="menu_button npc-state-generate-portrait" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate portrait</button>`
        : '';
    const memories = npc.memories?.length
        ? `<ul class="npc-state-viewer-list">${npc.memories.map(memory => `<li>${escapeHtml(memory)}</li>`).join('')}</ul>`
        : `<span class="npc-state-muted">No persistent memory recorded yet.</span>`;
    const keyRelationships = npc.keyRelationships?.length
        ? `<ul class="npc-state-viewer-list">${npc.keyRelationships.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<span class="npc-state-muted">No key relationships established yet.</span>`;
    const mannerisms = npc.mannerisms?.length
        ? `<ul class="npc-state-viewer-list">${npc.mannerisms.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<span class="npc-state-muted">None established yet.</span>`;
    const behaviorProfile = npc.behaviorProfile?.length
        ? `<ul class="npc-state-viewer-list">${npc.behaviorProfile.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<span class="npc-state-muted">No compact behavioral breakdown established yet.</span>`;
    const identityLine = [
        npc.species || 'Species unknown',
        npc.role || 'Role not established',
        npc.age ? `Age ${npc.age}` : 'Age unknown',
        npc.apparentAge ? `Looks ${npc.apparentAge}` : '',
    ].filter(Boolean).join(' · ');
    const sourceText = Number.isInteger(Number(messageId)) && Number(messageId) >= 0 ? `Current scene · message ${Number(messageId) + 1}` : 'Current live dossier';
    return `
      <div class="npc-state-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="npc_state_viewer_title" tabindex="-1">
        <header class="npc-state-viewer-header">
          <span class="npc-state-kicker">NPC DOSSIER</span>
          <button type="button" class="npc-state-viewer-close" aria-label="Close NPC dossier"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="npc-state-viewer-page">
          <aside class="npc-state-viewer-portrait-rail">
            <div class="npc-state-viewer-portrait">${portrait}</div>
            <div class="npc-state-viewer-portrait-caption">
              <h2 id="npc_state_viewer_title">${escapeHtml(displayName)}</h2>
              <p>${escapeHtml(identityLine)}</p>
            </div>
          </aside>

          <main class="npc-state-viewer-document">
            <section class="npc-state-viewer-glance npc-state-viewer-glance-top">
              <div class="npc-state-viewer-glance-title">Current</div>
              <div class="npc-state-viewer-facts">
                <div><b>Mood</b><span>${escapeHtml(npc.mood || 'Unknown')}</span></div>
                <div><b>Location</b><span>${escapeHtml(npc.location || 'Unknown')}</span></div>
                <div><b>Goal</b><span>${escapeHtml(npc.goal || 'Unknown')}</span></div>
                <div><b>Status</b><span>${escapeHtml(npc.status || 'Stable / unknown')}</span></div>
              </div>
            </section>

            <section class="npc-state-viewer-group">
              <div class="npc-state-viewer-group-title">Profile</div>
              <section class="npc-state-viewer-section npc-state-viewer-section-first"><b>Personality</b><p>${escapeHtml(npc.personality || 'Unknown')}</p></section>
              <section class="npc-state-viewer-section"><b>Behavioral profile</b>${behaviorProfile}</section>
              <section class="npc-state-viewer-section"><b>Speech</b><p>${escapeHtml(npc.speech || 'Unknown')}</p></section>
              <section class="npc-state-viewer-section"><b>Appearance</b><p>${escapeHtml(npc.appearance || 'Unknown')}</p></section>
              <section class="npc-state-viewer-section"><b>Mannerisms</b>${mannerisms}</section>
            </section>

            <section class="npc-state-viewer-group">
              <div class="npc-state-viewer-group-title">Relationships</div>
              <section class="npc-state-viewer-section npc-state-viewer-section-first"><b>With player</b><p>${escapeHtml(npc.relationshipSummary || 'No established relationship summary yet.')}</p>
                <div class="npc-state-bars npc-state-viewer-bars">
                  ${barHtml('Trust', rel.trust, 'trust')}
                  ${barHtml('Affection', rel.affection, 'affection')}
                  ${barHtml('Desire', rel.desire, 'desire')}
                  ${barHtml('Tension', rel.tension, 'tension')}
                </div>
              </section>
              ${relationshipChangeHtml(npc)}
              <section class="npc-state-viewer-section"><b>Key relationships</b>${keyRelationships}</section>
            </section>

            <section class="npc-state-viewer-group">
              <div class="npc-state-viewer-group-title">Background</div>
              <section class="npc-state-viewer-section npc-state-viewer-section-first"><p>${escapeHtml(npc.background || 'Unknown')}</p></section>
            </section>

            <section class="npc-state-viewer-group">
              <div class="npc-state-viewer-group-title">Important memories</div>
              <section class="npc-state-viewer-section npc-state-viewer-section-first">${memories}</section>
            </section>

            <div class="npc-state-page-foot">${escapeHtml(sourceText)} · ${npc.updatedAt ? new Date(npc.updatedAt).toLocaleString() : 'unknown update time'}</div>
          </main>
        </div>
        <footer class="npc-state-viewer-commandbar" aria-label="NPC dossier actions">
          <button type="button" class="menu_button npc-state-inline-edit-npc" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-pen-to-square"></i> <span>Edit dossier</span></button>
          <button type="button" class="menu_button npc-state-refresh-chat" data-npc-id="${escapeHtml(npc.id)}" title="Refresh from Chat"><i class="fa-solid fa-arrows-rotate"></i> <span>Refresh</span></button>
          <details class="npc-state-viewer-more">
            <summary><i class="fa-solid fa-ellipsis"></i> <span>More</span></summary>
            <div class="npc-state-viewer-more-menu">
              ${generatePortraitAction}
              <input id="${inputId}" class="npc-state-inline-portrait-file" data-npc-id="${escapeHtml(npc.id)}" type="file" accept="image/*" hidden>
              <label for="${inputId}" class="menu_button npc-state-inline-image-button"><i class="fa-solid fa-image"></i> ${portraitUrl ? 'Change portrait' : 'Attach portrait'}</label>
              ${portraitUrl ? `<button type="button" class="menu_button npc-state-inline-remove-portrait" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-xmark"></i> Remove portrait</button>` : ''}
              <button type="button" class="menu_button npc-state-copy-image-prompt" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-copy"></i> Copy portrait prompts</button>
            </div>
          </details>
        </footer>
      </div>`;
}

function closeNpcViewer() {
    const overlay = activeNpcViewerOverlay;
    activeNpcViewerOverlay = null;
    activeNpcViewerId = '';
    activeNpcViewerOpenedAt = 0;
    overlay?.remove?.();
    document.body?.classList?.remove?.('npc-state-viewer-open');
    document.documentElement?.classList?.remove?.('npc-state-viewer-open');
}

function refreshNpcViewer() {
    if (!activeNpcViewerOverlay || !activeNpcViewerId) return false;
    const npc = currentNpcById(activeNpcViewerId);
    if (!npc || npc.archived || !npc.present) {
        closeNpcViewer();
        return false;
    }
    const messageId = Number(activeNpcViewerOverlay.dataset?.messageId ?? -1);
    const oldPage = activeNpcViewerOverlay.querySelector?.('.npc-state-viewer-page');
    const oldDocument = activeNpcViewerOverlay.querySelector?.('.npc-state-viewer-document');
    const pageScrollTop = Number(oldPage?.scrollTop || 0);
    const documentScrollTop = Number(oldDocument?.scrollTop || 0);
    activeNpcViewerOverlay.innerHTML = npcViewerDialogHtml(npc, messageId);
    const nextPage = activeNpcViewerOverlay.querySelector?.('.npc-state-viewer-page');
    const nextDocument = activeNpcViewerOverlay.querySelector?.('.npc-state-viewer-document');
    if (nextPage) nextPage.scrollTop = pageScrollTop;
    if (nextDocument) nextDocument.scrollTop = documentScrollTop;
    return true;
}

function openNpcViewer(npcId, messageId = -1) {
    const id = String(npcId || '').trim();
    const npc = currentNpcById(id);
    if (!npc || npc.archived || !npc.present) return false;
    closeNpcViewer();
    const overlay = document.createElement('div');
    overlay.id = 'npc_state_viewer_overlay';
    overlay.className = 'npc-state-viewer-overlay';
    overlay.dataset.npcId = id;
    overlay.dataset.messageId = String(Number.isInteger(Number(messageId)) ? Number(messageId) : -1);
    overlay.innerHTML = npcViewerDialogHtml(npc, Number(overlay.dataset.messageId));
    overlay.addEventListener?.('click', event => {
        const closeButton = eventTargetClosest(event, '.npc-state-viewer-close');
        const settledBackdropClick = event.target === overlay && Date.now() - activeNpcViewerOpenedAt > 350;
        if (closeButton || settledBackdropClick) {
            event.preventDefault?.();
            event.stopPropagation?.();
            closeNpcViewer();
        }
    });
    document.body?.appendChild?.(overlay);
    document.body?.classList?.add?.('npc-state-viewer-open');
    document.documentElement?.classList?.add?.('npc-state-viewer-open');
    activeNpcViewerOverlay = overlay;
    activeNpcViewerId = id;
    activeNpcViewerOpenedAt = Date.now();
    globalThis.requestAnimationFrame?.(() => overlay.querySelector?.('.npc-state-viewer-close')?.focus?.());
    return true;
}

function messageElement(messageId) {
    if (!Number.isInteger(messageId) || messageId < 0) return null;
    const selectors = [
        `#chat .mes[mesid="${messageId}"]`,
        `.mes[mesid="${messageId}"]`,
        `#chat .mes[data-mesid="${messageId}"]`,
        `.mes[data-mesid="${messageId}"]`,
        `#chat .mes[data-message-id="${messageId}"]`,
        `.mes[data-message-id="${messageId}"]`,
    ];
    for (const selector of selectors) {
        const found = document.querySelector?.(selector);
        if (found) return found;
    }

    // Defensive fallback for themes/plugins that clone message markup without SillyTavern's
    // mesid attribute. Only use DOM order when it lines up exactly with non-system chat rows.
    const domMessages = [...(document.querySelectorAll?.('#chat .mes') || [])];
    const visibleMessageIds = (getContext().chat || [])
        .map((message, index) => (!message?.is_system ? index : null))
        .filter(index => index !== null);
    if (domMessages.length && domMessages.length === visibleMessageIds.length) {
        const domIndex = visibleMessageIds.indexOf(messageId);
        if (domIndex >= 0) return domMessages[domIndex] || null;
    }
    return null;
}

function inlineEntriesForRender(state) {
    // Visible NPC State is a live present-cast view, not a historical dossier timeline.
    // Keep inlineCards internally for branch/rollback safety, but render only the latest
    // assistant message and only NPCs physically present in the current merged state.
    const latestAssistantId = latestMessageId(true);
    if (latestAssistantId < 0) return [];
    const presentCards = (state.npcs || [])
        .filter(npc => !npc.archived && npc.present && !npc.minor)
        .map(snapshotNpc);
    if (!presentCards.length) return [];
    return [{
        messageId: latestAssistantId,
        reason: 'live-present-grid',
        createdAt: Date.now(),
        cards: presentCards,
    }];
}

function meguminIntegrationMessageId(node) {
    const value = Number(node?.dataset?.npcStateMessageId);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function meguminBlockCardForMessage(message) {
    return message?.querySelector?.('.meg-blocks') || null;
}

function setClassActive(node, active) {
    if (!node) return;
    if (node.classList?.toggle) node.classList.toggle('active', Boolean(active));
    else {
        const names = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
        if (active) names.add('active'); else names.delete('active');
        node.className = [...names].join(' ');
    }
}

function meguminSnapshotSignature(html) {
    const text = String(html || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function closeMeguminNpcStatePane(card) {
    if (!card?.querySelectorAll) return;
    for (const pane of [...(card.querySelectorAll('.npc-state-megumin-pane') || [])]) {
        if (pane?.style) pane.style.display = 'none';
    }
    for (const tab of [...(card.querySelectorAll('.npc-state-megumin-tab') || [])]) {
        setClassActive(tab, false);
        tab.setAttribute?.('aria-expanded', 'false');
    }
}

function mountNpcStateInsideMeguminBlock(message, messageId, html) {
    const card = meguminBlockCardForMessage(message);
    if (!card?.querySelector) return false;
    const tabs = card.querySelector('.meg-blocks-tabs');
    const panel = card.querySelector('.meg-blocks-panel');
    if (!tabs || !panel) return false;

    let button = card.querySelector('.npc-state-megumin-tab');
    let pane = card.querySelector('.npc-state-megumin-pane');
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'meg-blocks-tab npc-state-megumin-tab';
        button.dataset.npcStateMessageId = String(messageId);
        button.dataset.key = `npc-state:${messageId}`;
        button.title = 'NPC State';
        button.setAttribute?.('aria-expanded', 'false');
        button.innerHTML = '<span class="meg-blocks-tab-emoji">👥</span><span class="meg-blocks-tab-label">NPC State</span>';
        button.addEventListener?.('click', event => {
            // Inventory Ledger may deliberately restore this foreign tab from its own bridge.
            // In that case it prevents the click after restoring our pane; do not immediately
            // interpret the same click as a second toggle and close it again.
            if (event?.defaultPrevented) return;
            event?.stopPropagation?.();

            const isOpen = button.classList?.contains?.('active')
                && pane?.style?.display !== 'none'
                && !card.classList?.contains?.('meg-blocks-shut');
            if (isOpen) {
                closeMeguminNpcStatePane(card);
                card.classList?.add?.('meg-blocks-shut');
                return;
            }

            // Megumin keeps its selected-tab key in a private closure. Merely changing the DOM
            // leaves that hidden state pointing at the previously selected native tab, which makes
            // the next click on that tab CLOSE it instead of opening it. Drive Megumin's own
            // collapse button until its native state reaches the shut/null state first. With a
            // resting CYOA tab the first click can open that resting tab, so a second click is the
            // deterministic fallback that returns the closure to null.
            const collapse = tabs.querySelector?.('.meg-blocks-collapse');
            if (typeof collapse?.click === 'function') {
                collapse.click();
                if (!card.classList?.contains?.('meg-blocks-shut')) collapse.click();
            }

            for (const nativePane of [...(card.querySelectorAll?.('.meg-block-body') || [])]) {
                if (nativePane?.style) nativePane.style.display = nativePane === pane ? '' : 'none';
            }
            for (const tab of [...(card.querySelectorAll?.('.meg-blocks-tab') || [])]) setClassActive(tab, tab === button);
            if (panel?.style) panel.style.display = '';
            card.classList?.remove?.('meg-blocks-shut');
            button.setAttribute?.('aria-expanded', 'true');
        });
        const collapse = tabs.querySelector?.('.meg-blocks-collapse');
        if (collapse?.before) collapse.before(button);
        else tabs.appendChild?.(button);
    }

    if (!pane) {
        pane = document.createElement('div');
        pane.className = 'meg-block-body npc-state-megumin-pane';
        pane.dataset.npcStateMessageId = String(messageId);
        if (pane.style) pane.style.display = 'none';
        panel.appendChild?.(pane);
    }
    // Keep the foreign tab/pane key pair compatible with other Megumin card integrations
    // (notably Inventory Ledger) so they can restore NPC State as the prior active pane.
    pane.dataset.key = button.dataset.key;
    const snapshotSignature = meguminSnapshotSignature(html);
    // Do not compare pane.innerHTML with the source string. Browsers serialize an opened
    // <details> with an `open` attribute, so the old comparison treated normal expansion as
    // stale content and replaced the pane on the next repair render, instantly collapsing it.
    if (pane.dataset.npcStateSnapshotSignature !== snapshotSignature || !String(pane.innerHTML || '').trim()) {
        pane.innerHTML = html;
        pane.dataset.npcStateSnapshotSignature = snapshotSignature;
    }

    // Megumin owns its native tab state through private closure variables. Bind a small bridge
    // after those native listeners: choosing any native tab/collapse simply hides our foreign pane,
    // while choosing NPC State hides Megumin's panes. No message.mes rewrite or Megumin import needed.
    for (const control of [...(card.querySelectorAll?.('.meg-blocks-tab, .meg-blocks-collapse') || [])]) {
        if (control === button || control?.dataset?.npcStateDismissBound === '1') continue;
        if (control?.dataset) control.dataset.npcStateDismissBound = '1';
        control?.addEventListener?.('click', () => closeMeguminNpcStatePane(card));
    }
    return true;
}

function cleanupStaleMeguminIntegrations(desiredIds, root = chatElementForInlineObserver() || document) {
    for (const node of [...(root.querySelectorAll?.('.npc-state-megumin-pane, .npc-state-megumin-tab') || [])]) {
        const messageId = meguminIntegrationMessageId(node);
        if (messageId === null || !desiredIds.has(messageId)) node.remove?.();
    }
}

function inlineAnchorMessageId(anchor) {
    const value = Number(anchor?.dataset?.npcStateMessageId);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function chatElementForInlineObserver() {
    return document.querySelector?.('#chat') || null;
}

function ensureInlineObserver() {
    if (typeof globalThis.MutationObserver !== 'function') return false;
    const chat = chatElementForInlineObserver();
    if (!chat) return false;
    if (inlineObserver && inlineObserverChat === chat) return true;
    try { inlineObserver?.disconnect?.(); } catch {}
    inlineObserverChat = chat;
    inlineObserver = new globalThis.MutationObserver(mutations => {
        // Ignore text-only mutations inside our own card. Host message redraws, removed
        // anchors, pagination and markdown replacements all arrive as child-list changes.
        const relevant = (mutations || []).some(mutation => {
            if (mutation?.type && mutation.type !== 'childList') return false;
            const target = mutation?.target;
            if (typeof target?.closest === 'function' && target.closest('.npc-state-inline-anchor, .npc-state-megumin-pane')) return false;
            return true;
        });
        if (relevant) queueInlineRender(45);
    });
    try {
        inlineObserver.observe(chat, { childList: true, subtree: true });
        return true;
    } catch (error) {
        console.debug('[NPC State] inline MutationObserver could not attach', error);
        inlineObserver = null;
        inlineObserverChat = null;
        return false;
    }
}

function inlineMountNeedsRepair() {
    let chatKey;
    try { chatKey = getChatKey(); } catch { return false; }
    if (chatKey === 'no-chat' || chatHydrationStatus(chatKey) !== 'ready') return false;
    const desired = inlineEntriesForRender(getChatState(chatKey)).filter(entry => (entry.cards || []).length);
    if (!desired.length) return false;
    const root = chatElementForInlineObserver() || document;
    const standaloneMounted = new Set(
        [...(root.querySelectorAll?.('.npc-state-inline-anchor') || [])].map(inlineAnchorMessageId).filter(id => id !== null),
    );
    const meguminMounted = new Set(
        [...(root.querySelectorAll?.('.npc-state-megumin-pane') || [])].map(meguminIntegrationMessageId).filter(id => id !== null),
    );
    return desired.some(entry => {
        const messageId = Number(entry.messageId);
        const message = messageElement(messageId);
        if (!message) return false;
        const block = meguminBlockCardForMessage(message);
        const canIntegrate = Boolean(block?.querySelector?.('.meg-blocks-tabs') && block?.querySelector?.('.meg-blocks-panel'));
        return canIntegrate ? !meguminMounted.has(messageId) : !standaloneMounted.has(messageId);
    });
}

function startInlineWatchdog() {
    ensureInlineObserver();
    if (inlineWatchdogTimer || typeof setInterval !== 'function') return;
    inlineWatchdogTimer = setInterval(() => {
        try {
            ensureInlineObserver();
            if (inlineMountNeedsRepair()) queueInlineRender(0);
        } catch (error) {
            console.debug('[NPC State] inline watchdog check failed', error);
        }
    }, 2200);
    inlineWatchdogTimer?.unref?.();
}

function renderInlineCards() {
    let chatKey;
    try { chatKey = getChatKey(); } catch { return { rendered: 0, missing: 0 }; }
    if (chatKey === 'no-chat' || chatHydrationStatus(chatKey) !== 'ready') return { rendered: 0, missing: 0 };
    ensureInlineObserver();

    const state = getChatState(chatKey);
    const desiredEntries = inlineEntriesForRender(state).filter(entry => (entry.cards || []).length);
    const desiredIds = new Set(desiredEntries.map(entry => Number(entry.messageId)));
    const existingById = new Map();
    const root = chatElementForInlineObserver() || document;
    cleanupStaleMeguminIntegrations(desiredIds, root);

    for (const anchor of [...(root.querySelectorAll?.('.npc-state-inline-anchor') || [])]) {
        const messageId = inlineAnchorMessageId(anchor);
        if (messageId === null || !desiredIds.has(messageId)) {
            anchor.remove?.();
            continue;
        }
        if (existingById.has(messageId)) {
            anchor.remove?.();
            continue;
        }
        existingById.set(messageId, anchor);
    }

    let rendered = 0;
    let missing = 0;
    for (const entry of desiredEntries) {
        const messageId = Number(entry.messageId);
        const message = messageElement(messageId);
        if (!message) {
            missing += 1;
            continue;
        }

        const html = inlineRosterHtml(entry.cards || [], messageId);
        let anchor = existingById.get(messageId);
        if (mountNpcStateInsideMeguminBlock(message, messageId, html)) {
            anchor?.remove?.();
            existingById.delete(messageId);
            rendered += 1;
            continue;
        }
        if (!anchor) {
            anchor = document.createElement('div');
            anchor.className = 'npc-state-inline-anchor';
            anchor.dataset.npcStateMessageId = String(messageId);
            anchor.innerHTML = html;
            const text = message.querySelector?.('.mes_text');
            if (text?.insertAdjacentElement) text.insertAdjacentElement('afterend', anchor);
            else (message.querySelector?.('.mes_block') || message).appendChild?.(anchor);
            existingById.set(messageId, anchor);
        } else if (anchor.innerHTML !== html) {
            anchor.innerHTML = html;
        }
        rendered += 1;
    }
    return { rendered, missing };
}

const INLINE_RENDER_RETRY_DELAYS = [80, 180, 350, 700, 1400];
function queueInlineRender(delay = 0, retryIndex = 0) {
    if (inlineRenderTimer) clearTimeout(inlineRenderTimer);
    inlineRenderTimer = setTimeout(() => {
        inlineRenderTimer = null;
        try {
            const result = renderInlineCards();
            if (result?.missing > 0 && retryIndex < INLINE_RENDER_RETRY_DELAYS.length) {
                queueInlineRender(INLINE_RENDER_RETRY_DELAYS[retryIndex], retryIndex + 1);
            }
        } catch (error) {
            console.warn('[NPC State] inline render failed', error);
        }
    }, Math.max(0, Number(delay) || 0));
}

function eventTargetClosest(event, selector) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
        if (typeof node?.matches === 'function' && node.matches(selector)) return node;
    }
    return typeof event?.target?.closest === 'function' ? event.target.closest(selector) : null;
}

function activateNpcViewerFromEvent(event) {
    const card = eventTargetClosest(event, '.npc-state-present-card');
    if (!card) return false;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return false;
    const npcId = String(card.dataset?.npcId || '').trim();
    if (!npcId) return false;
    const now = Date.now();
    if (lastViewerActivation.npcId === npcId && now - lastViewerActivation.at < 650) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        event.stopPropagation?.();
        return true;
    }
    lastViewerActivation = { npcId, at: now };
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    openNpcViewer(npcId, Number(card.dataset?.messageId ?? -1));
    return true;
}

function handleNpcViewerEscape(event) {
    if (event?.key !== 'Escape') return false;
    if (activePortraitGeneratorOverlay) {
        if (portraitGenerationBusy) return false;
        event.preventDefault?.();
        event.stopPropagation?.();
        closePortraitGenerator();
        return true;
    }
    if (!activeNpcViewerOverlay) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    closeNpcViewer();
    return true;
}

function editorIsMounted() {
    if (activeEditorPopup?.dlg) {
        return Boolean(activeEditorPopup.dlg.open || activeEditorPopup.dlg.isConnected || document.body?.contains?.(activeEditorPopup.dlg));
    }
    return Boolean(document.querySelector?.('.popup.npc-state-editor-popup, #npc_state_editor_overlay'));
}

function openNpcEditorSafely(npcId) {
    const id = String(npcId || '').trim();
    if (!id) return false;
    try {
        const npc = currentNpcById(id);
        if (!npc) throw new Error(`NPC id ${id} is not in the active chat state.`);
        const editor = openNpcEditor(id);
        if (!editor) throw new Error('SillyTavern editor popup could not be created.');
        return true;
    } catch (error) {
        console.error('[NPC State] dossier editor failed to open', error);
        globalThis.toastr?.error?.(`NPC State editor failed: ${error?.message || error}`);
        return false;
    }
}

function activateNpcEditorFromEvent(event) {
    const editButton = eventTargetClosest(event, '.npc-state-roster-edit, .npc-state-inline-edit-npc');
    if (!editButton) return false;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return false;
    const npcId = String(editButton.dataset?.npcId || '').trim();
    if (!npcId) return false;
    const now = Date.now();
    if (lastEditorActivation.npcId === npcId && now - lastEditorActivation.at < 650) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        event.stopPropagation?.();
        return true;
    }
    lastEditorActivation = { npcId, at: now };
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    closeNpcViewer();
    openNpcEditorSafely(npcId);
    return true;
}

function installUiCaptureBridge() {
    if (uiCaptureBridgeInstalled || typeof document?.addEventListener !== 'function') return;
    uiCaptureBridgeInstalled = true;
    document.addEventListener('pointerup', activateNpcViewerFromEvent, true);
    document.addEventListener('click', activateNpcViewerFromEvent, true);
    document.addEventListener('keydown', activateNpcViewerFromEvent, true);
    document.addEventListener('keydown', handleNpcViewerEscape, true);
    document.addEventListener('pointerup', activateNpcEditorFromEvent, true);
    document.addEventListener('click', activateNpcEditorFromEvent, true);
    document.addEventListener('keydown', activateNpcEditorFromEvent, true);
    try {
        document.addEventListener('touchend', activateNpcViewerFromEvent, { capture: true, passive: false });
        document.addEventListener('touchend', activateNpcEditorFromEvent, { capture: true, passive: false });
    } catch {
        document.addEventListener('touchend', activateNpcViewerFromEvent, true);
        document.addEventListener('touchend', activateNpcEditorFromEvent, true);
    }
}

function wireSettingsRosterEditor() {
    const holder = document.querySelector?.('#npc_state_roster_summary');
    if (!holder?.querySelectorAll) return;
    holder.querySelectorAll('.npc-state-roster-edit').forEach(control => {
        if (control.dataset?.npcStateEditorBound === '1') return;
        if (control.dataset) control.dataset.npcStateEditorBound = '1';
        control.addEventListener?.('pointerup', activateNpcEditorFromEvent);
        control.addEventListener?.('click', activateNpcEditorFromEvent);
        control.addEventListener?.('keydown', activateNpcEditorFromEvent);
    });
}

function renderSettingsRoster() {
    const holder = $('#npc_state_roster_summary');
    if (!holder.length) return;
    const state = getChatState();
    if (!state.npcs.length) {
        holder.html('<span class="npc-state-muted">No tracked NPCs yet. Named NPCs are stored persistently; inline cards appear only when the latest scene marks them present.</span>');
        return;
    }
    const pointer = getSettings().dataFiles?.[getChatKey()] || null;
    const active = state.npcs.filter(npc => !npc.archived);
    const archived = state.npcs.filter(npc => npc.archived);
    const activeRows = active.length ? active.map(npc => `
      <div class="npc-state-roster-entry" data-npc-id="${escapeHtml(npc.id)}">
        <div class="menu_button npc-state-roster-edit" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Edit ${escapeHtml(npc.name)} dossier">${npc.present ? '● ' : (npc.worldActive ? '◌ ' : '')}${npc.retentionProtected ? '📌 ' : ''}${npc.minor ? '·minor ' : ''}${escapeHtml(npc.name)} <i class="fa-solid fa-pen"></i></div>
        <div class="menu_button npc-state-roster-scan npc-state-scan-dossier" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Scan matching Megumin dossier for ${escapeHtml(npc.name)}"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div class="menu_button npc-state-roster-archive npc-state-archive-npc" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Archive ${escapeHtml(npc.name)}"><i class="fa-solid fa-box-archive"></i></div>
        <div class="menu_button npc-state-roster-delete npc-state-delete-npc" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Delete ${escapeHtml(npc.name)} dossier"><i class="fa-solid fa-trash-can"></i></div>
      </div>`).join('') : '<span class="npc-state-muted">No active NPCs.</span>';
    const archivedRows = archived.length ? archived.map(npc => `
      <div class="npc-state-roster-entry npc-state-roster-entry-archived" data-npc-id="${escapeHtml(npc.id)}">
        <div class="menu_button npc-state-roster-edit" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Edit archived ${escapeHtml(npc.name)} dossier">${npc.retentionProtected ? '📌 ' : ''}${npc.minor ? '·minor ' : ''}${escapeHtml(npc.name)}${npc.archiveReason === 'deceased' ? ' ☠' : (npc.archiveReason === 'stale' ? ' ⏳' : '')} <i class="fa-solid fa-pen"></i></div>
        <div class="menu_button npc-state-roster-scan npc-state-scan-dossier" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Scan matching Megumin dossier for ${escapeHtml(npc.name)}"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div class="menu_button npc-state-roster-restore npc-state-restore-npc" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Restore ${escapeHtml(npc.name)} to active roster"><i class="fa-solid fa-box-open"></i></div>
        <div class="menu_button npc-state-roster-delete npc-state-delete-npc" role="button" tabindex="0" data-npc-id="${escapeHtml(npc.id)}" title="Delete ${escapeHtml(npc.name)} dossier"><i class="fa-solid fa-trash-can"></i></div>
      </div>`).join('') : '<span class="npc-state-muted">No archived NPCs.</span>';
    holder.html(`
      <span class="npc-state-muted">Persistent NPC database:</span>
      <div class="npc-state-roster-block"><b>Active (${active.length})</b><div class="npc-state-roster-chips">${activeRows}</div></div>
      <details class="npc-state-archived-roster" ${archived.length ? '' : ''}><summary><b>Archived (${archived.length})</b></summary><div class="npc-state-roster-chips">${archivedRows}</div><small class="npc-state-muted">Archived dossiers remain in the JSON database, branch history, exports, and portraits, but are excluded from portrait cards and generation injection. Stale auto-archives may be deleted at the configured delete threshold; manual/death archives are preserved.</small></details>
      <small class="npc-state-muted">● present in the latest scanned scene · ◌ current off-screen activity from World State · 📌 protected from stale lifecycle · ·minor hidden from the portrait gallery. Present Minor NPCs still update and remain eligible for generation injection. Auto-archive is reversible; timed stale deletion does not suppress rediscovery, while manual trash does.</small>
      <small class="npc-state-muted npc-state-data-file">Data file: ${escapeHtml(pointer?.path || 'created on first save')}</small>`);
    wireSettingsRosterEditor();
}

function renderDossier() {
    renderSettingsRoster();
    startInlineWatchdog();
    queueInlineRender();
    refreshNpcViewer();
}

function cleanEditorList(value, max = 12) {
    return [...new Set(String(value || '').split(/\r?\n|\s*;\s*/).map(item => item.trim()).filter(Boolean))].slice(0, max);
}

function editorValue(value) {
    return escapeHtml(String(value ?? ''));
}

function openNpcEditor(npcId) {
    const npc = currentNpcById(npcId);
    if (!npc) return null;
    closeNpcEditor();
    const ctx = getContext();
    const Popup = ctx.Popup;
    const POPUP_TYPE = ctx.POPUP_TYPE;
    const POPUP_RESULT = ctx.POPUP_RESULT;
    if (typeof Popup !== 'function' || !POPUP_TYPE?.TEXT || !POPUP_RESULT) {
        throw new Error('SillyTavern Popup API is unavailable. NPC State requires SillyTavern 1.18+ for dossier editing.');
    }
    const rel = npc.relationship || DEFAULT_RELATIONSHIP;
    const locked = new Set(npc.manualProfileFields || []);
    const content = document.createElement('div');
    content.id = 'npc_state_editor_content';
    content.className = 'npc-state-editor-native';
    content.innerHTML = `
      <div class="npc-state-editor-head"><div><span class="npc-state-kicker">LIVE DOSSIER</span><h3 id="npc_state_editor_title">Edit ${editorValue(npc.name)}</h3></div></div>
      <p class="npc-state-muted">Edits save to NPC State's extension-owned JSON data. Relationship numbers are authoritative current values on a -100 to +100 scale where 0 is neutral; future story deltas continue from them.</p>
      <div class="npc-state-editor-lifecycle"><b>Lifecycle</b><span>${npc.archived ? 'Archived' : (npc.present ? 'Active · Present' : (npc.worldActive ? 'Active · Off-screen' : 'Active'))}${npc.archiveReason === 'deceased' ? ' · Deceased' : (npc.archiveReason === 'stale' ? ' · Stale auto-archive' : '')}</span>${npc.lifeStateReason ? `<small>${editorValue(npc.lifeStateReason)}</small>` : ''}</div>
      <div class="npc-state-editor-tools"><div class="menu_button npc-state-scan-dossier" role="button" tabindex="0" data-npc-id="${editorValue(npc.id)}" title="Import matching Megumin New NPC / NPC Update dossier blocks; falls back to recent story context"><i class="fa-solid fa-wand-magic-sparkles"></i> Scan dossier</div><div class="menu_button npc-state-refresh-chat" role="button" tabindex="0" data-npc-id="${editorValue(npc.id)}" title="Re-read the configured recent-chat window for this NPC and reconcile every grounded unlocked dossier field without replaying relationship deltas"><i class="fa-solid fa-arrows-rotate"></i> Refresh from Chat</div><div class="menu_button npc-state-copy-image-prompt" role="button" tabindex="0" data-npc-id="${editorValue(npc.id)}"><i class="fa-solid fa-copy"></i> Copy portrait prompts</div>${npc.archived ? `<div class="menu_button npc-state-restore-npc npc-state-editor-archive-toggle" role="button" tabindex="0" data-npc-id="${editorValue(npc.id)}"><i class="fa-solid fa-box-open"></i> Restore active</div>` : `<div class="menu_button npc-state-archive-npc npc-state-editor-archive-toggle" role="button" tabindex="0" data-npc-id="${editorValue(npc.id)}"><i class="fa-solid fa-box-archive"></i> Archive dossier</div>`}</div>
      <div class="npc-state-editor-grid npc-state-editor-profile">
        <label>Name<input id="npc_state_edit_name" class="text_pole" value="${editorValue(npc.name)}"></label>
        <label>Species / Race<input id="npc_state_edit_species" class="text_pole" maxlength="160" placeholder="Half-elf, dwarf, dwelf, human, custom species..." value="${editorValue(npc.species)}"></label>
        <label>Role<input id="npc_state_edit_role" class="text_pole" value="${editorValue(npc.role)}"></label>
        <label>Chronological age<input id="npc_state_edit_age" class="text_pole" maxlength="80" placeholder="Actual stated age; leave blank if unknown" value="${editorValue(npc.age)}"></label>
        <label>Apparent age<input id="npc_state_edit_apparent_age" class="text_pole" maxlength="80" placeholder="~25, young, middle-aged..." value="${editorValue(npc.apparentAge)}"></label>
        <label>Personality<textarea id="npc_state_edit_personality" class="text_pole" rows="3">${editorValue(npc.personality)}</textarea></label>
        <label class="npc-state-editor-wide">Behavioral profile <small>Max ${BEHAVIOR_PROFILE_LIMIT} compact point-form rules, one per line</small><textarea id="npc_state_edit_behavior_profile" class="text_pole" rows="6" placeholder="Disposition: kind - broadly considerate; avoids needless harm&#10;Expressiveness: low - strong feelings show subtly&#10;Independence: high - keeps own goals and boundaries&#10;Care: practical - helps through actions before reassurance&#10;Conflict: controlled - concise, firm, not gratuitously cruel">${editorValue((npc.behaviorProfile || []).join('\n'))}</textarea></label>
        <label>Speech<textarea id="npc_state_edit_speech" class="text_pole" rows="3">${editorValue(npc.speech)}</textarea></label>
        <label class="npc-state-editor-wide">Appearance <small>Prompt-ready visual description</small><textarea id="npc_state_edit_appearance" class="text_pole" rows="6" maxlength="1800" placeholder="Face, hair, eyes, build, clothing, accessories, distinguishing features, current visual state...">${editorValue(npc.appearance)}</textarea></label>
        <label>Background<textarea id="npc_state_edit_background" class="text_pole" rows="3">${editorValue(npc.background)}</textarea></label>
        <label class="npc-state-editor-wide">Established mannerisms <small>One per line</small><textarea id="npc_state_edit_mannerisms" class="text_pole" rows="4">${editorValue((npc.mannerisms || []).join('\n'))}</textarea></label>
        <label class="npc-state-editor-wide">Key relationships <small>Max ${KEY_RELATIONSHIP_LIMIT} · family, friends, rivals, mentors, partners · one per line</small><textarea id="npc_state_edit_key_relationships" class="text_pole" rows="5" placeholder="Yunyun — friend / rival | competitive but loyal">${editorValue((npc.keyRelationships || []).join('\n'))}</textarea></label>
      </div>
      <details class="npc-state-editor-portrait-overrides">
        <summary><b>Portrait prompt overrides</b> <small>Optional per-NPC additions</small></summary>
        <div class="npc-state-editor-portrait-overrides-body">
          <p class="npc-state-muted">These are appended only when building image prompts. They are never injected into roleplay generation and never rewritten by the NPC scanner.</p>
          <label>Additional positive prompt<textarea id="npc_state_edit_portrait_positive" class="text_pole" rows="4" maxlength="1800" placeholder="black ceremonial ribbon, winter uniform, gold ear cuff...">${editorValue(npc.portraitPromptPositive)}</textarea></label>
          <label>Additional negative prompt<textarea id="npc_state_edit_portrait_negative" class="text_pole" rows="4" maxlength="1800" placeholder="helmet, hood, short hair...">${editorValue(npc.portraitPromptNegative)}</textarea></label>
          <label class="npc-state-editor-lock"><input id="npc_state_edit_portrait_replace" type="checkbox" ${npc.portraitPromptReplace ? 'checked' : ''}> Replace the automatic positive prompt entirely <small>Use only when this NPC needs a hand-authored model-specific prompt. The global negative prompt still applies.</small></label>
        </div>
      </details>
      <label class="npc-state-editor-lock"><input id="npc_state_edit_lock_profile" type="checkbox" ${locked.length ? 'checked' : ''}> Protect edited stable profile fields from future scanner rewrites <small>Leave off to use manual edits as an organic baseline. Existing locks stay protected until you uncheck and save.</small></label>
      ${locked.length ? `<p class="npc-state-muted">Currently protected: ${editorValue([...locked].join(', '))}</p>` : ''}
      <label class="npc-state-editor-lock"><input id="npc_state_edit_retention_protected" type="checkbox" ${npc.retentionProtected ? 'checked' : ''}> Keep this NPC from automatic stale cleanup <small>Use for recurring or major NPCs who may disappear for long arcs. This does not lock their profile fields.</small></label>
      <label class="npc-state-editor-lock"><input id="npc_state_edit_minor" type="checkbox" ${npc.minor ? 'checked' : ''}> Minor NPC · hide portrait card <small>The dossier still scans, updates, stores memories/relationships, and injects when present; only the present-NPC gallery card is hidden.</small></label>
      <div class="npc-state-editor-grid">
        <label>Relationship summary<textarea id="npc_state_edit_relationship_summary" class="text_pole" rows="3">${editorValue(npc.relationshipSummary)}</textarea></label>
        <label>Mood<input id="npc_state_edit_mood" class="text_pole" value="${editorValue(npc.mood)}"></label>
        <label>Location<input id="npc_state_edit_location" class="text_pole" value="${editorValue(npc.location)}"></label>
        <label>Goal<input id="npc_state_edit_goal" class="text_pole" value="${editorValue(npc.goal)}"></label>
        <label>Status<input id="npc_state_edit_status" class="text_pole" value="${editorValue(npc.status)}"></label>
        <label>Importance<input id="npc_state_edit_importance" class="text_pole" type="number" min="0" max="100" value="${Math.round(Number(npc.importance) || 0)}"></label>
        <label class="npc-state-editor-wide">Important memories <small>Max 5 · one per line</small><textarea id="npc_state_edit_memories" class="text_pole" rows="5">${editorValue((npc.memories || []).join('\n'))}</textarea></label>
      </div>
      <div class="npc-state-editor-stats">
        <label>Trust<input id="npc_state_edit_trust" class="text_pole" type="number" min="-100" max="100" value="${relationshipNumber(rel.trust)}"></label>
        <label>Affection<input id="npc_state_edit_affection" class="text_pole" type="number" min="-100" max="100" value="${relationshipNumber(rel.affection)}"></label>
        <label>Desire<input id="npc_state_edit_desire" class="text_pole" type="number" min="-100" max="100" value="${relationshipNumber(rel.desire)}"></label>
        <label>Tension<input id="npc_state_edit_tension" class="text_pole" type="number" min="-100" max="100" value="${relationshipNumber(rel.tension)}"></label>
      </div>`;

    let popup;
    popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: 'Save dossier',
        cancelButton: 'Cancel',
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        animation: 'fast',
        onClosing: async currentPopup => {
            if (currentPopup.result === POPUP_RESULT.AFFIRMATIVE) {
                return saveNpcEditor(npc.id, { close: false });
            }
            return true;
        },
        onClose: () => {
            if (activeEditorPopup === popup) activeEditorPopup = null;
        },
    });
    popup.dlg?.classList?.add?.('npc-state-editor-popup');
    activeEditorPopup = popup;
    Promise.resolve(popup.show()).catch(error => {
        if (activeEditorPopup === popup) activeEditorPopup = null;
        console.error('[NPC State] native dossier popup failed', error);
        globalThis.toastr?.error?.(`NPC State editor failed: ${error?.message || error}`);
    });
    return popup;
}

function portraitPromptOptions() {
    const settings = getSettings();
    return {
        stylePositive: settings.portraitStylePositive,
        styleNegative: settings.portraitStyleNegative,
        composition: settings.portraitComposition,
        format: settings.portraitPromptFormat,
        useMood: settings.portraitUseMood !== false,
        useLocation: settings.portraitUseLocation === true,
    };
}

function npcImagePromptPair(npc) {
    return buildNpcPortraitPrompts(npc || {}, portraitPromptOptions());
}

function npcImagePromptText(npc) {
    const prompts = npcImagePromptPair(npc);
    if (!prompts.positive) return '';
    return `POSITIVE\n${prompts.positive}\n\nNEGATIVE\n${prompts.negative || '(none)'}`;
}

async function copyNpcImagePrompt(npcId) {
    const npc = getChatState().npcs.find(item => item.id === npcId);
    const text = npcImagePromptText(npc);
    if (!text) {
        globalThis.toastr?.warning?.('NPC State: no appearance description or portrait override is established for this NPC yet.');
        return false;
    }
    try {
        if (globalThis.navigator?.clipboard?.writeText) {
            await globalThis.navigator.clipboard.writeText(text);
        } else {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand?.('copy');
            area.remove();
        }
        globalThis.toastr?.success?.(`NPC State: copied positive + negative portrait prompts for ${npc.name}.`);
        return true;
    } catch (error) {
        console.warn('[NPC State] Could not copy portrait prompts', error);
        globalThis.toastr?.warning?.('NPC State: could not access the clipboard.');
        return false;
    }
}

function slashQuoted(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

async function executeNativePortraitGeneration(positive, negative) {
    const prompt = String(positive || '').trim();
    if (!prompt) throw new Error('Positive portrait prompt is empty.');
    const ctx = getContext();
    const execute = ctx.executeSlashCommandsWithOptions;
    if (typeof execute !== 'function') {
        throw new Error('This SillyTavern build does not expose executeSlashCommandsWithOptions().');
    }
    const settings = getSettings();
    const command = [
        '/imagine',
        'quiet=true',
        `gallery=${settings.portraitSaveToGallery ? 'true' : 'false'}`,
        negative ? `negative=${slashQuoted(negative)}` : '',
        slashQuoted(prompt),
    ].filter(Boolean).join(' ');
    let result;
    try {
        result = await execute(command, {
            handleParserErrors: false,
            handleExecutionErrors: false,
            source: 'npc_state_portrait',
        });
    } catch (error) {
        const message = String(error?.message || error || 'Unknown image generation error');
        if (/unknown command|imagine|image generation|not configured|not available/i.test(message)) {
            throw new Error(`SillyTavern Image Generation is unavailable or not configured. ${message}`);
        }
        throw error;
    }
    const url = String(result?.pipe ?? '').trim();
    if (!url) throw new Error('SillyTavern Image Generation returned no image URL. Check Image Generation settings and try /imagine manually once.');
    return url;
}

function portraitGeneratorHtml(npc, prompts) {
    const theme = PORTRAIT_THEME_PRESETS[getSettings().portraitThemePreset]?.label || 'Custom';
    return `
      <div class="npc-state-portrait-generator-dialog" role="dialog" aria-modal="true" aria-labelledby="npc_state_portrait_generator_title">
        <header class="npc-state-portrait-generator-header">
          <div><span class="npc-state-kicker">PORTRAIT GENERATOR</span><h2 id="npc_state_portrait_generator_title">${escapeHtml(npc.name)}</h2><small>${escapeHtml(theme)} · SillyTavern Image Generation</small></div>
          <button type="button" class="npc-state-portrait-generator-close" aria-label="Close portrait generator"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="npc-state-portrait-generator-body">
          <section class="npc-state-portrait-generator-preview" aria-live="polite">
            <div class="npc-state-portrait-generator-placeholder"><i class="fa-solid fa-image"></i><b>Generated portrait preview</b><small>The result stays out of chat. Nothing replaces the current portrait until you choose Use as Portrait.</small></div>
            <img class="npc-state-portrait-generator-image" alt="Generated portrait preview" hidden>
            <div class="npc-state-portrait-generator-status" hidden></div>
          </section>
          <section class="npc-state-portrait-generator-prompts">
            <label><b>Positive prompt</b><small>Built from the current dossier + global portrait theme. Edit freely for this generation.</small><textarea id="npc_state_portrait_positive" class="text_pole" rows="9">${escapeHtml(prompts.positive)}</textarea></label>
            <label><b>Negative prompt</b><small>Global exclusions + this NPC's optional negative override.</small><textarea id="npc_state_portrait_negative" class="text_pole" rows="7">${escapeHtml(prompts.negative)}</textarea></label>
          </section>
        </div>
        <footer class="npc-state-portrait-generator-actions">
          <button type="button" class="menu_button npc-state-portrait-reset"><i class="fa-solid fa-rotate-left"></i> Reset from dossier</button>
          <button type="button" class="menu_button npc-state-portrait-run"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>
          <button type="button" class="menu_button npc-state-portrait-use" disabled><i class="fa-solid fa-check"></i> Use as Portrait</button>
        </footer>
      </div>`;
}

function closePortraitGenerator() {
    const overlay = activePortraitGeneratorOverlay;
    activePortraitGeneratorOverlay = null;
    activePortraitGeneratorNpcId = '';
    activePortraitGenerationUrl = '';
    portraitGenerationBusy = false;
    overlay?.remove?.();
    document.body?.classList?.remove?.('npc-state-portrait-generator-open');
    document.documentElement?.classList?.remove?.('npc-state-portrait-generator-open');
}

function openPortraitGenerator(npcId) {
    const id = String(npcId || '').trim();
    const npc = currentNpcById(id);
    if (!npc) return false;
    if (getSettings().portraitGenerationEnabled === false) {
        globalThis.toastr?.info?.('NPC State: Generate Portrait is disabled in settings.');
        return false;
    }
    const prompts = npcImagePromptPair(npc);
    if (!prompts.positive) {
        globalThis.toastr?.warning?.(`NPC State: ${npc.name} needs an Appearance description or a per-NPC positive prompt before image generation.`);
        return false;
    }
    closePortraitGenerator();
    const overlay = document.createElement('div');
    overlay.id = 'npc_state_portrait_generator_overlay';
    overlay.className = 'npc-state-portrait-generator-overlay';
    // Keep the generator above the already-open full-screen dossier on tablet/mobile.
    overlay.style.zIndex = '2147483600';
    overlay.dataset.npcId = id;
    overlay.innerHTML = portraitGeneratorHtml(npc, prompts);
    overlay.addEventListener?.('click', event => {
        const closeButton = eventTargetClosest(event, '.npc-state-portrait-generator-close');
        if ((event.target === overlay || closeButton) && !portraitGenerationBusy) {
            event.preventDefault?.();
            event.stopPropagation?.();
            closePortraitGenerator();
        }
    });
    document.body?.appendChild?.(overlay);
    document.body?.classList?.add?.('npc-state-portrait-generator-open');
    document.documentElement?.classList?.add?.('npc-state-portrait-generator-open');
    activePortraitGeneratorOverlay = overlay;
    activePortraitGeneratorNpcId = id;
    activePortraitGenerationUrl = '';
    globalThis.requestAnimationFrame?.(() => overlay.querySelector?.('#npc_state_portrait_positive')?.focus?.());
    return true;
}

function setPortraitGeneratorBusy(busy, text = '') {
    portraitGenerationBusy = Boolean(busy);
    const overlay = activePortraitGeneratorOverlay;
    if (!overlay) return;
    const run = overlay.querySelector?.('.npc-state-portrait-run');
    const reset = overlay.querySelector?.('.npc-state-portrait-reset');
    const use = overlay.querySelector?.('.npc-state-portrait-use');
    const close = overlay.querySelector?.('.npc-state-portrait-generator-close');
    const status = overlay.querySelector?.('.npc-state-portrait-generator-status');
    if (run) { run.disabled = portraitGenerationBusy; run.innerHTML = portraitGenerationBusy ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating...' : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate again'; }
    if (reset) reset.disabled = portraitGenerationBusy;
    if (close) close.disabled = portraitGenerationBusy;
    if (use) use.disabled = portraitGenerationBusy || !activePortraitGenerationUrl;
    if (status) {
        status.hidden = !text;
        status.textContent = text;
    }
}

function resetPortraitGeneratorFromDossier() {
    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || portraitGenerationBusy) return false;
    const npc = currentNpcById(activePortraitGeneratorNpcId);
    if (!npc) return false;
    const prompts = npcImagePromptPair(npc);
    const positive = activePortraitGeneratorOverlay.querySelector?.('#npc_state_portrait_positive');
    const negative = activePortraitGeneratorOverlay.querySelector?.('#npc_state_portrait_negative');
    if (positive) positive.value = prompts.positive;
    if (negative) negative.value = prompts.negative;
    return true;
}

async function generatePortraitFromDialog() {
    const overlay = activePortraitGeneratorOverlay;
    const npc = currentNpcById(activePortraitGeneratorNpcId);
    if (!overlay || !npc || portraitGenerationBusy) return false;
    const positive = String(overlay.querySelector?.('#npc_state_portrait_positive')?.value || '').trim();
    const negative = String(overlay.querySelector?.('#npc_state_portrait_negative')?.value || '').trim();
    if (!positive) {
        globalThis.toastr?.warning?.('NPC State: positive portrait prompt is empty.');
        return false;
    }
    activePortraitGenerationUrl = '';
    setPortraitGeneratorBusy(true, 'Generating through SillyTavern Image Generation…');
    try {
        const url = await executeNativePortraitGeneration(positive, negative);
        if (!activePortraitGeneratorOverlay || activePortraitGeneratorNpcId !== npc.id) return false;
        activePortraitGenerationUrl = url;
        const image = activePortraitGeneratorOverlay.querySelector?.('.npc-state-portrait-generator-image');
        const placeholder = activePortraitGeneratorOverlay.querySelector?.('.npc-state-portrait-generator-placeholder');
        if (image) {
            image.src = url;
            image.hidden = false;
        }
        if (placeholder) placeholder.hidden = true;
        setPortraitGeneratorBusy(false, 'Generation complete. Review the result before applying it.');
        return true;
    } catch (error) {
        console.error('[NPC State] portrait generation failed', error);
        setPortraitGeneratorBusy(false, 'Generation failed.');
        globalThis.toastr?.error?.(`NPC State portrait generation: ${error?.message || error}`);
        return false;
    }
}

async function portraitAssetFromGeneratedUrl(url, npcName = 'npc') {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('Generated image URL is empty.');
    const absolute = new URL(raw, globalThis.location?.href || 'http://localhost/').href;
    const response = await fetch(absolute, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Could not load generated image (${response.status}).`);
    const blob = await response.blob();
    if (!blob.type?.startsWith('image/')) throw new Error('Generated URL did not return an image.');
    const extension = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const filename = `${safeFilenamePart(npcName)}-generated.${extension}`;
    const file = new File([blob], filename, { type: blob.type });
    const portrait = await compressPortrait(file);
    portrait.generatedFrom = raw;
    portrait.sourceName = filename;
    return portrait;
}

async function useGeneratedPortrait() {
    if (!activePortraitGeneratorOverlay || !activePortraitGeneratorNpcId || !activePortraitGenerationUrl || portraitGenerationBusy) return false;
    const npc = currentNpcById(activePortraitGeneratorNpcId);
    if (!npc) return false;
    setPortraitGeneratorBusy(true, 'Importing generated image into the NPC dossier…');
    try {
        npc.portrait = await portraitAssetFromGeneratedUrl(activePortraitGenerationUrl, npc.name);
        getChatState().portraitAssets[npc.id] = structuredClone(npc.portrait);
        npc.updatedAt = Date.now();
        persist();
        renderDossier();
        refreshNpcViewer();
        const name = npc.name;
        closePortraitGenerator();
        globalThis.toastr?.success?.(`NPC State: generated portrait applied to ${name}.`);
        return true;
    } catch (error) {
        console.error('[NPC State] generated portrait import failed', error);
        setPortraitGeneratorBusy(false, 'Could not import the generated result.');
        globalThis.toastr?.error?.(`NPC State portrait import: ${error?.message || error}`);
        return false;
    }
}

function closeNpcEditor() {
    const popup = activeEditorPopup;
    activeEditorPopup = null;
    if (popup?.completeCancelled) {
        Promise.resolve(popup.completeCancelled()).catch(error => console.debug('[NPC State] editor popup close failed', error));
    }
    document.querySelector?.('#npc_state_editor_overlay')?.remove();
}

function editorField(id) {
    return document.getElementById(id)?.value ?? '';
}

function clampEditorStat(id) {
    return Math.max(0, Math.min(100, Math.round(Number(editorField(id)) || 0)));
}

function clampEditorRelationshipStat(id) {
    const value = Number(editorField(id));
    return Number.isFinite(value) ? Math.max(-100, Math.min(100, Math.round(value))) : 0;
}

function saveNpcEditor(npcId, { close = true, silent = false } = {}) {
    const state = getChatState();
    const index = state.npcs.findIndex(item => item.id === npcId);
    if (index < 0) { if (close) closeNpcEditor(); return false; }
    const current = state.npcs[index];
    const beforeKeyRelationships = [...(current.keyRelationships || [])];
    const previousCanonicalName = current.name;
    const next = structuredClone(current);
    const oldRelationship = { ...(current.relationship || DEFAULT_RELATIONSHIP) };
    const stableInputs = {
        name: String(editorField('npc_state_edit_name')).trim().slice(0, 120) || current.name,
        role: String(editorField('npc_state_edit_role')).trim().slice(0, 240),
        species: String(editorField('npc_state_edit_species')).trim().slice(0, 160),
        age: String(editorField('npc_state_edit_age')).trim().slice(0, 80),
        apparentAge: String(editorField('npc_state_edit_apparent_age')).trim().slice(0, 80),
        personality: String(editorField('npc_state_edit_personality')).trim().slice(0, 900),
        speech: String(editorField('npc_state_edit_speech')).trim().slice(0, 600),
        behaviorProfile: cleanEditorList(editorField('npc_state_edit_behavior_profile'), BEHAVIOR_PROFILE_LIMIT),
        appearance: String(editorField('npc_state_edit_appearance')).trim().slice(0, 1800),
        background: String(editorField('npc_state_edit_background')).trim().slice(0, 1200),
        mannerisms: cleanEditorList(editorField('npc_state_edit_mannerisms'), 8),
        keyRelationships: cleanEditorList(editorField('npc_state_edit_key_relationships'), KEY_RELATIONSHIP_LIMIT),
    };
    const nameCollision = state.npcs.some((item, i) => i !== index && npcMatchesLabel(item, stableInputs.name));
    if (nameCollision) {
        globalThis.toastr?.warning?.(`NPC State: another dossier already matches ${stableInputs.name}.`);
        return false;
    }
    if (stableInputs.name !== current.name && current.name) {
        next.aliases = [...new Set([...(current.aliases || []), current.name])].slice(0, 8);
    }
    Object.assign(next, stableInputs);
    next.portraitPromptPositive = String(editorField('npc_state_edit_portrait_positive')).trim().slice(0, 1800);
    next.portraitPromptNegative = String(editorField('npc_state_edit_portrait_negative')).trim().slice(0, 1800);
    next.portraitPromptReplace = Boolean(document.getElementById('npc_state_edit_portrait_replace')?.checked);
    next.identityKind = inferNpcIdentityKind(stableInputs.name);
    next.relationshipSummary = String(editorField('npc_state_edit_relationship_summary')).trim().slice(0, 900);
    next.mood = String(editorField('npc_state_edit_mood')).trim().slice(0, 240);
    next.location = String(editorField('npc_state_edit_location')).trim().slice(0, 300);
    next.goal = String(editorField('npc_state_edit_goal')).trim().slice(0, 500);
    next.status = String(editorField('npc_state_edit_status')).trim().slice(0, 300);
    next.importance = clampEditorStat('npc_state_edit_importance');
    next.memories = cleanEditorList(editorField('npc_state_edit_memories'), IMPORTANT_MEMORY_LIMIT);
    next.relationship = {
        trust: clampEditorRelationshipStat('npc_state_edit_trust'),
        affection: clampEditorRelationshipStat('npc_state_edit_affection'),
        desire: clampEditorRelationshipStat('npc_state_edit_desire'),
        tension: clampEditorRelationshipStat('npc_state_edit_tension'),
    };
    const relationshipDelta = Object.fromEntries(['trust', 'affection', 'desire', 'tension'].map(key => [key, next.relationship[key] - Number(oldRelationship[key] || 0)]));
    if (Object.values(relationshipDelta).some(value => value !== 0)) {
        const progress = normalizeRelationshipProgress(current.relationshipProgress);
        for (const key of ['trust', 'affection', 'desire', 'tension']) if (relationshipDelta[key] !== 0) progress[key] = 0;
        next.relationshipProgress = progress;
        next.relationshipMilestones = inferManualRelationshipMilestones(
            current.relationshipMilestones,
            next.relationship,
            'Manual dossier adjustment established this relationship depth.',
            latestMessageId(false),
            Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
        );
        next.lastRelationshipChange = {
            impact: 'manual',
            delta: relationshipDelta,
            evidence: normalizeRelationshipEvidence(),
            reason: 'Manual dossier adjustment by player.',
            sourceMessageId: latestMessageId(false),
            turn: Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
        };
    }
    const stableKeys = ['name', 'role', 'species', 'age', 'apparentAge', 'personality', 'speech', 'behaviorProfile', 'appearance', 'background', 'mannerisms', 'keyRelationships'];
    if (document.getElementById('npc_state_edit_lock_profile')?.checked) {
        const locks = new Set(current.manualProfileFields || []);
        for (const key of stableKeys) {
            const listField = key === 'mannerisms' || key === 'behaviorProfile' || key === 'keyRelationships';
            const before = listField ? JSON.stringify(current[key] || []) : String(current[key] || '');
            const after = listField ? JSON.stringify(next[key] || []) : String(next[key] || '');
            if (before !== after) locks.add(key);
        }
        next.manualProfileFields = [...locks];
    } else {
        next.manualProfileFields = [];
    }
    next.manualProfileLocksExplicit = true;
    next.retentionProtected = Boolean(document.getElementById('npc_state_edit_retention_protected')?.checked);
    next.minor = Boolean(document.getElementById('npc_state_edit_minor')?.checked);
    next.manual = true;
    next.updatedAt = Date.now();
    state.npcs[index] = normalizeNpcRecord(next);
    if (next.lastRelationshipChange?.impact === 'manual') state.npcs[index].lastRelationshipChange = structuredClone(next.lastRelationshipChange);
    const targetMessageId = latestMessageId(false);
    applyManualKeyRelationshipEdit(state, npcId, beforeKeyRelationships, state.npcs[index].keyRelationships || [], {
        sourceMessageId: targetMessageId,
        turn: Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
    });
    const reconciledSocial = reconcileSocialState(state, {
        provenance: 'manual', confidence: 'manual', sourceMessageId: targetMessageId,
        turn: Number.isFinite(Number(state.turn)) ? Number(state.turn) : null,
    });
    state.socialGraph = reconciledSocial.socialGraph;
    state.npcs = reconciledSocial.state.npcs;
    if (previousCanonicalName !== state.npcs.find(item => item.id === npcId)?.name) {
        // Old canonical name remains an alias, while every structured neighbor reference
        // now renders the promoted/manual canonical name through the stable NPC id.
    }
    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, 'manual-edit');
    persist();
    if (close) closeNpcEditor();
    renderDossier();
    updateInjection();
    if (!silent) globalThis.toastr?.success?.(`NPC State: saved manual dossier edits for ${state.npcs[index].name}.`);
    return true;
}


function deleteNpcById(npcId, { confirmAction = true } = {}) {
    const id = String(npcId || '').trim();
    if (!id) return false;
    const settings = getSettings();
    const state = getChatState();
    const current = state.npcs.find(item => item.id === id);
    if (!current) return false;
    if (confirmAction) {
        const message = `Delete ${current.name}? This permanently removes this dossier and prevents older branch snapshots from restoring this identity. A genuinely different future NPC with the same name remains trackable.`;
        if (!window.confirm(message)) return false;
    }

    const result = applyNpcStateCommand(state, { action: 'remove', name: current.name, npcId: id }, {
        maxNpcs: settings.maxNpcs,
        excludeNames: currentExclusions(),
        turn: state.turn,
        relationshipBaseline: settings.relationshipBaseline,
    });
    const working = result.state;
    if (result.report.status !== 'removed') return false;
    // applyNpcStateCommand's narrative remove path suppresses by label. Manual UI trash is
    // identity-specific instead: remove those labels from narrative dismissal and retain an
    // ID-backed tombstone so a future homonym is not blocked.
    const permanentLabels = new Set([current.name, ...(current.aliases || [])].map(normalizeName).filter(Boolean));
    working.dismissed = (Array.isArray(working.dismissed) ? working.dismissed : [])
        .filter(label => !permanentLabels.has(normalizeName(label)));
    working.userDismissedGroups = addUserDismissedGroup(state.userDismissedGroups, current);
    working.socialGraph = removeNpcFromSocialGraph(working.socialGraph, current.id);
    purgeNpcStructuredReferences(working.npcs, current);
    const socialAfterDelete = reconcileSocialState(working, { provenance: 'manual', confidence: 'manual' });
    working.socialGraph = socialAfterDelete.socialGraph;
    working.npcs = socialAfterDelete.state.npcs;
    purgeInlineCardsInState(working, result.report.npcId, result.report.name);
    const reportKey = normalizeName(result.report.name);
    working.pendingBackfills = (working.pendingBackfills || []).filter(item => item.npcId !== result.report.npcId && normalizeName(item.label) !== reportKey);
    const targetMessageId = latestMessageId(false);
    if (targetMessageId >= 0) commitBranchCheckpoint(working, targetMessageId, 'manual-delete');
    setChatState(getChatKey(), working);
    persist();
    closeNpcEditor();
    renderDossier();
    updateInjection();
    globalThis.toastr?.success?.(`NPC State: deleted ${result.report.name}; older branch snapshots cannot restore that identity.`);
    return true;
}

function setNpcArchiveStateById(npcId, archived, { reason = 'manual', confirmAction = true } = {}) {
    const state = getChatState();
    const index = state.npcs.findIndex(item => item.id === npcId);
    if (index < 0) return false;
    const current = state.npcs[index];
    if (Boolean(current.archived) === Boolean(archived)) return false;
    const action = archived ? 'archive' : 'restore';
    if (confirmAction) {
        const message = archived
            ? `Archive ${current.name}? The dossier, portrait, history, and relationship state will be preserved, but it will stop receiving inline cards and prompt injection until restored or clearly returned in the story.`
            : `Restore ${current.name} to the active roster?`;
        if (!window.confirm(message)) return false;
    }
    state.npcs[index] = setNpcArchived(current, archived, {
        reason: archived ? reason : '',
        sourceMessageId: latestMessageId(false),
    });
    const targetMessageId = latestMessageId(false);
    if (targetMessageId >= 0) commitBranchCheckpoint(state, targetMessageId, archived ? 'manual-archive' : 'manual-restore');
    persist();
    closeNpcEditor();
    renderDossier();
    updateInjection();
    globalThis.toastr?.success?.(archived
        ? `NPC State: archived ${current.name}. Their dossier and history are preserved.`
        : `NPC State: restored ${current.name} to the active roster.`);
    return true;
}

async function compressPortrait(file) {
    if (!file || !file.type?.startsWith('image/')) throw new Error('Choose an image file.');
    const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode image.'));
        img.src = source;
    });
    // Keep enough source resolution for the full-screen dossier viewer and high-DPI mobile/tablet displays.
    // The old 512 px cap looked acceptable in roster thumbnails but became visibly pixelated when expanded.
    const maxSide = 1536;
    const maxDataUrlLength = 1_600_000;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const encode = quality => {
        let value = canvas.toDataURL('image/webp', quality);
        if (!value.startsWith('data:image/webp')) value = canvas.toDataURL('image/jpeg', quality);
        return value;
    };

    let dataUrl = encode(0.88);
    // Prefer preserving pixels. Only lower quality if an unusually complex portrait exceeds the bounded state-file budget.
    for (const quality of [0.84, 0.80, 0.76, 0.72, 0.68]) {
        if (dataUrl.length <= maxDataUrlLength) break;
        dataUrl = encode(quality);
    }
    if (dataUrl.length > maxDataUrlLength) {
        throw new Error('Portrait is still too large after high-resolution compression. Try a smaller image.');
    }
    return {
        dataUrl,
        mime: dataUrl.slice(5, dataUrl.indexOf(';')),
        sourceName: file.name,
        width: canvas.width,
        height: canvas.height,
        updatedAt: Date.now(),
    };
}

function safeFilenamePart(value) {
    return String(value || 'chat')
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'chat';
}

function buildBundleFilename() {
    const date = new Date();
    const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        '-',
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
    ].join('');
    return `npc-state-${safeFilenamePart(getChatKey().replace(/^\w+:/, ''))}-${stamp}.npcstate`;
}

function exportBundleBytes() {
    return encodeNpcStateBundle(getChatState(), {
        appVersion: NPC_STATE_VERSION,
        chatKey: getChatKey(),
    });
}

function downloadBundle(bytes, filename = buildBundleFilename()) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDossierBundle() {
    if (getChatKey() === 'no-chat') {
        globalThis.toastr?.warning?.('NPC State: open a chat before exporting a dossier.');
        return null;
    }
    const state = getChatState();
    if (!state.npcs.length && !state.dismissed?.length) {
        globalThis.toastr?.warning?.('NPC State: this chat dossier is empty.');
        return null;
    }
    try {
        const bytes = exportBundleBytes();
        downloadBundle(bytes);
        const portraitCount = state.npcs.filter(npc => npc.portrait?.dataUrl).length;
        globalThis.toastr?.success?.(`NPC State: exported ${state.npcs.length} dossier(s) with ${portraitCount} embedded portrait(s).`);
        return bytes;
    } catch (error) {
        console.error('[NPC State] export failed', error);
        globalThis.toastr?.error?.(`NPC State export failed: ${error?.message || error}`);
        return null;
    }
}

function importBundleBytes(bytes) {
    const settings = getSettings();
    const decoded = decodeNpcStateBundle(bytes);
    const before = getChatState();
    const importReport = {};
    const merged = mergeImportedDossierState(before, decoded.state, {
        maxNpcs: settings.maxNpcs,
        excludeNames: currentExclusions(),
        report: importReport,
    });
    // Only an actually accepted import can deliberately resurrect an ID-backed deleted
    // identity. Capacity/exclusion/duplicate skips must not weaken tombstones.
    for (const accepted of importReport.accepted || []) {
        clearUserDismissedSuppression(merged, { id: accepted.id, name: accepted.name });
    }
    if (!merged.portraitAssets || typeof merged.portraitAssets !== 'object') merged.portraitAssets = {};
    for (const npc of merged.npcs) if (npc.portrait?.dataUrl) merged.portraitAssets[npc.id] = structuredClone(npc.portrait);
    const socialImport = reconcileSocialState(merged, { provenance: 'migration', confidence: 'migration' });
    merged.socialGraph = socialImport.socialGraph;
    merged.npcs = socialImport.state.npcs;
    const targetMessageId = latestMessageId(false);
    if (targetMessageId >= 0) commitBranchCheckpoint(merged, targetMessageId, 'import');
    setChatState(getChatKey(), merged);
    persist();
    renderDossier();
    updateInjection();
    return { decoded, merged, importReport };
}

async function importDossierBundle(file) {
    if (!file) return;
    try {
        if (getChatKey() === 'no-chat') throw new Error('Open a chat before importing a dossier.');
        if (file.size > 32 * 1024 * 1024) throw new Error('Bundle exceeds the 32 MB safety limit.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { decoded, importReport } = importBundleBytes(bytes);
        const total = decoded.state.npcs.length;
        const accepted = (importReport.accepted || []).length;
        const skipped = importReport.skipped || [];
        const portraitCount = decoded.state.npcs.filter(npc => npc.portrait?.dataUrl).length;
        const capacitySkipped = skipped.filter(item => item.reason === 'capacity').length;
        globalThis.toastr?.success?.(`NPC State: accepted ${accepted}/${total} dossier(s); bundle contained ${portraitCount} embedded portrait(s).${capacitySkipped ? ` ${capacitySkipped} new active dossier(s) were skipped because the roster is full; existing active dossiers were preserved.` : ''}`);
        if (skipped.length && !capacitySkipped) globalThis.toastr?.info?.(`NPC State: ${skipped.length} import entr${skipped.length === 1 ? 'y was' : 'ies were'} skipped by identity/exclusion safety checks.`);
    } catch (error) {
        console.error('[NPC State] import failed', error);
        globalThis.toastr?.error?.(`NPC State import failed: ${error?.message || error}`);
    }
}

function bindSettingsCheckbox(selector, key, after = null) {
    $(document).on('change.npcState', selector, function () {
        getSettings()[key] = Boolean(this.checked);
        persistSettings();
        after?.();
    });
}

function bindSettingsNumber(selector, key, min, max, fallback, after = null) {
    $(document).on('change.npcState', selector, function () {
        const value = Math.max(min, Math.min(max, Math.round(Number(this.value) || fallback)));
        getSettings()[key] = value;
        this.value = value;
        persistSettings();
        after?.();
    });
}

function bindSettingsText(selector, key, after = null) {
    $(document).on('change.npcState', selector, function () {
        getSettings()[key] = String(this.value || '');
        persistSettings();
        after?.();
    });
}

function bindUi() {
    $(document).off('.npcState');
    bindSettingsCheckbox('#npc_state_enabled', 'enabled', () => { updateInjection(); renderDossier(); });
    bindSettingsCheckbox('#npc_state_auto', 'autoScan');
    bindSettingsCheckbox('#npc_state_full_scan_every_turn', 'fullScanEveryTurn');
    bindSettingsCheckbox('#npc_state_inject', 'inject', updateInjection);
    bindSettingsNumber('#npc_state_inject_budget', 'injectBudgetTokens', 512, 6000, 1800, updateInjection);
    bindSettingsCheckbox('#npc_state_archive_deaths', 'autoArchiveDeaths');
    bindSettingsCheckbox('#npc_state_reactivate_archived', 'autoReactivateArchived');
    bindSettingsCheckbox('#npc_state_branch_rescan', 'branchRescan');
    bindSettingsCheckbox('#npc_state_portrait_generation_enabled', 'portraitGenerationEnabled', refreshNpcViewer);
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
    });
    bindSettingsNumber('#npc_state_scan_every', 'scanEvery', 1, 20, 2);
    bindSettingsNumber('#npc_state_scan_depth', 'scanDepth', 2, 30, 6);
    $(document).on('change.npcState', '#npc_state_admission_mode', function () {
        getSettings().admissionMode = normalizeNpcAdmissionMode(this.value); this.value = getSettings().admissionMode; persistSettings();
    });
    bindSettingsNumber('#npc_state_max', 'maxNpcs', 1, 100, 40);
    bindSettingsCheckbox('#npc_state_auto_prune_stale', 'autoPruneStale');
    $(document).on('change.npcState', '#npc_state_stale_archive_after', function () {
        const settings = getSettings();
        settings.staleArchiveAfter = Math.max(10, Math.min(999, Math.round(Number(this.value) || 30)));
        if (settings.staleDeleteAfter <= settings.staleArchiveAfter) settings.staleDeleteAfter = Math.min(1000, settings.staleArchiveAfter + 1);
        syncSettingsControls(); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_stale_delete_after', function () {
        const settings = getSettings();
        settings.staleDeleteAfter = Math.max(settings.staleArchiveAfter + 1, Math.min(1000, Math.round(Number(this.value) || 50)));
        syncSettingsControls(); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_base_trust, #npc_state_base_affection, #npc_state_base_desire, #npc_state_base_tension', function () {
        const settings = getSettings();
        const key = this.id.replace('npc_state_base_', '');
        settings.relationshipBaseline[key] = Math.max(-100, Math.min(100, Math.round(Number(this.value) || 0)));
        settings.relationshipBaseline = normalizeRelationshipBaseline(settings.relationshipBaseline);
        syncSettingsControls(); persistSettings();
    });
    $(document).on('change.npcState', '#npc_state_cap_ordinary, #npc_state_cap_meaningful, #npc_state_cap_major, #npc_state_cap_extreme', function () {
        const settings = getSettings();
        const key = this.id.replace('npc_state_cap_', '');
        settings.relationshipCaps[key] = Math.max(0, Math.round(Number(this.value) || 0));
        settings.relationshipCaps = normalizeRelationshipCaps(settings.relationshipCaps);
        syncSettingsControls(); persistSettings();
    });
    bindSettingsText('#npc_state_relationship_criteria', 'relationshipCriteria');
    bindSettingsText('#npc_state_impact_criteria', 'relationshipImpactCriteria');
    bindSettingsText('#npc_state_memory_criteria', 'memoryCriteria');
    bindSettingsText('#npc_state_behavior_criteria', 'behaviorCriteria', updateInjection);
    $(document).on('click.npcState', '#npc_state_reset_relationship_rules', () => {
        const settings = getSettings();
        settings.relationshipBaseline = { ...DEFAULT_RELATIONSHIP };
        settings.relationshipCaps = { ...DEFAULT_RELATIONSHIP_CAPS };
        settings.relationshipCriteria = DEFAULT_RELATIONSHIP_CRITERIA;
        settings.relationshipImpactCriteria = DEFAULT_IMPACT_CRITERIA;
        syncSettingsControls(); persistSettings();
        globalThis.toastr?.success?.('NPC State: relationship tuning reset to defaults.');
    });
    $(document).on('click.npcState', '#npc_state_reset_memory_rules', () => {
        getSettings().memoryCriteria = DEFAULT_MEMORY_CRITERIA;
        syncSettingsControls(); persistSettings();
        globalThis.toastr?.success?.('NPC State: important memory criteria reset to default.');
    });
    $(document).on('click.npcState', '#npc_state_reset_behavior_rules', () => {
        getSettings().behaviorCriteria = DEFAULT_BEHAVIOR_CRITERIA;
        syncSettingsControls(); persistSettings(); updateInjection();
        globalThis.toastr?.success?.('NPC State: behavior rubric reset to default.');
    });
    $(document).on('click.npcState', '#npc_state_scan_now', () => scanNow({ manual: true, messageId: latestMessageId(true) }));
    $(document).on('click.npcState', '#npc_state_export_bundle', () => exportDossierBundle());
    $(document).on('change.npcState', '#npc_state_import_bundle_file', async function () {
        const file = this.files?.[0];
        this.value = '';
        await importDossierBundle(file);
    });
    $(document).on('click.npcState', '#npc_state_add_manual', () => {
        const settings = getSettings();
        const state = getChatState();
        if (state.npcs.filter(npc => !npc?.archived).length >= settings.maxNpcs) return globalThis.toastr?.warning?.(`NPC State: active roster cap is ${settings.maxNpcs}. Archived dossiers do not count.`);
        const name = window.prompt('NPC name to add to this chat dossier:')?.trim();
        if (!name) return;
        const result = applyNpcStateCommand(state, { action: 'add', name }, {
            maxNpcs: settings.maxNpcs,
            excludeNames: currentExclusions(),
            turn: state.turn,
            relationshipBaseline: settings.relationshipBaseline,
        });
        if (result.report.status === 'excluded') return globalThis.toastr?.warning?.('NPC State: player/main character cannot be added as an NPC.');
        if (result.report.status === 'full') return globalThis.toastr?.warning?.(`NPC State: active roster cap is ${settings.maxNpcs}. Archived dossiers do not count.`);
        if (['added', 'exists', 'restored'].includes(result.report.status)) clearUserDismissedSuppression(result.state, name);
        const targetMessageId = latestMessageId(false);
        if (targetMessageId >= 0) commitBranchCheckpoint(result.state, targetMessageId, 'manual-add');
        setChatState(getChatKey(), result.state);
        persist(); renderDossier(); updateInjection();
        const addedNpc = result.report.npcId ? result.state.npcs.find(npc => npc.id === result.report.npcId) : null;
        if (addedNpc) globalThis.toastr?.success?.(`NPC State: ${addedNpc.name} created. Use the wand beside the dossier to Scan dossier and populate it.`);
    });
    $(document).on('click.npcState', '.npc-state-roster-edit', function (event) { event.preventDefault?.(); event.stopPropagation?.(); openNpcEditorSafely(this.dataset.npcId); });
    $(document).on('click.npcState', '.npc-state-inline-edit-npc', function () { closeNpcViewer(); openNpcEditorSafely(this.dataset.npcId); });
    $(document).on('click.npcState', '.npc-state-scan-dossier', function (event) { event.preventDefault?.(); event.stopPropagation?.(); void scanNpcDossier(String(this.dataset.npcId || '')); });
    $(document).on('click.npcState', '.npc-state-refresh-chat', function (event) { event.preventDefault?.(); event.stopPropagation?.(); void refreshNpcFromChat(String(this.dataset.npcId || '')); });
    $(document).on('click.npcState', '.npc-state-copy-image-prompt', function () { copyNpcImagePrompt(String(this.dataset.npcId || '')); });
    $(document).on('click.npcState', '.npc-state-generate-portrait', function (event) { event.preventDefault?.(); event.stopPropagation?.(); openPortraitGenerator(String(this.dataset.npcId || '')); });
    $(document).on('click.npcState', '.npc-state-portrait-reset', function (event) { event.preventDefault?.(); resetPortraitGeneratorFromDossier(); });
    $(document).on('click.npcState', '.npc-state-portrait-run', function (event) { event.preventDefault?.(); void generatePortraitFromDialog(); });
    $(document).on('click.npcState', '.npc-state-portrait-use', function (event) { event.preventDefault?.(); void useGeneratedPortrait(); });
    $(document).on('click.npcState', '.npc-state-archive-npc', function () { closeNpcViewer(); setNpcArchiveStateById(this.dataset.npcId, true, { reason: 'manual' }); });
    $(document).on('click.npcState', '.npc-state-restore-npc', function () { setNpcArchiveStateById(this.dataset.npcId, false); });
    $(document).on('click.npcState', '.npc-state-delete-npc', function () { deleteNpcById(this.dataset.npcId); });
    $(document).on('keydown.npcState', '.npc-state-delete-npc', function (event) {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault?.();
        deleteNpcById(this.dataset.npcId);
    });
    $(document).on('click.npcState', '#npc_state_clear_chat', () => {
        if (!window.confirm('Clear every NPC State dossier for this chat? Portraits and inline dossier cards will also be removed.')) return;
        closePortraitGenerator();
        const cleared = freshChatState();
        cleared.lineage = chatLineage(getContext().chat || []);
        setChatState(getChatKey(), cleared);
        persist(); renderDossier(); updateInjection();
    });
    $(document).on('change.npcState', '.npc-state-inline-portrait-file', async function () {
        const npc = currentNpcById(this.dataset.npcId);
        const file = this.files?.[0];
        this.value = '';
        if (!npc || !file) return;
        try {
            npc.portrait = await compressPortrait(file);
            getChatState().portraitAssets[npc.id] = structuredClone(npc.portrait);
            npc.updatedAt = Date.now();
            persist(); renderDossier();
            globalThis.toastr?.success?.(`Portrait attached to ${npc.name}.`);
        } catch (error) {
            globalThis.toastr?.error?.(`NPC State portrait: ${error?.message || error}`);
        }
    });
    $(document).on('click.npcState', '.npc-state-inline-remove-portrait', function () {
        const npc = currentNpcById(this.dataset.npcId);
        if (!npc) return;
        npc.portrait = null;
        delete getChatState().portraitAssets[npc.id];
        npc.updatedAt = Date.now(); persist(); renderDossier();
    });
}

function attachSettingsPanel() {
    if ($(`#${UI_ID}`).length) return true;
    let host = $('#extensions_settings2');
    if (!host.length) host = $('#extensions_settings');
    if (!host.length) host = $('#extensionsMenu');
    if (!host.length) {
        console.warn('[NPC State] Could not find SillyTavern extensions settings host yet.');
        return false;
    }
    host.append(buildSettingsHtml());
    syncSettingsControls();
    renderDossier();
    return true;
}

function scheduleSettingsMountRetries() {
    if (attachSettingsPanel()) return;
    if (mountRetryTimer) clearInterval(mountRetryTimer);
    let attempts = 0;
    mountRetryTimer = setInterval(() => {
        attempts += 1;
        if (attachSettingsPanel() || attempts >= 40) {
            clearInterval(mountRetryTimer);
            mountRetryTimer = null;
            if (attempts >= 40 && !$(`#${UI_ID}`).length) {
                console.error('[NPC State] Settings panel host never appeared; extension logic is loaded but UI could not mount.');
            }
        }
    }, 250);
}

function processOocCommands(messageId = null) {
    const settings = getSettings();
    if (!settings.enabled || getChatKey() === 'no-chat') return [];
    const ctx = getContext();
    const chat = ctx.chat || [];
    let resolvedId = Number.isInteger(messageId) ? messageId : chat.length - 1;
    let message = chat[resolvedId];
    if (!message?.is_user) {
        resolvedId = -1;
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            if (chat[i]?.is_user && !chat[i]?.is_system) { resolvedId = i; message = chat[i]; break; }
        }
    }
    if (!message?.is_user || message?.is_system) return [];
    const state = getChatState();
    if (state.processedOocMessageId === resolvedId) return [];
    const commands = parseOocNpcStateCommands(message.mes || '');
    if (!commands.length) return [];

    ensureBranchParentAnchor(state, chat, resolvedId, 'ooc-parent');
    let working = state;
    const reports = [];
    for (const command of commands) {
        const result = applyNpcStateCommand(working, command, {
            maxNpcs: settings.maxNpcs,
            excludeNames: currentExclusions(),
            turn: state.turn,
            relationshipBaseline: settings.relationshipBaseline,
        });
        working = result.state;
        reports.push(result.report);
        if (command.action === 'add' && ['added', 'exists', 'restored'].includes(result.report.status) && result.report.npcId) {
            clearUserDismissedSuppression(working, command.name || result.report.name);
            queueNpcBackfillInState(working, result.report.npcId, command.name || result.report.name, resolvedId);
        }
    }
    working.processedOocMessageId = resolvedId;
    for (const report of reports) {
        if (report.status === 'removed' || report.status === 'suppressed') {
            const removedNpc = state.npcs.find(item => item.id === report.npcId || npcMatchesLabel(item, report.name));
            if (removedNpc) {
                working.socialGraph = removeNpcFromSocialGraph(working.socialGraph, removedNpc.id);
                purgeNpcStructuredReferences(working.npcs, removedNpc);
            }
            purgeInlineCardsInState(working, report.npcId, report.name);
            const reportKey = normalizeName(report.name);
            working.pendingBackfills = (working.pendingBackfills || []).filter(item => item.npcId !== report.npcId && normalizeName(item.label) !== reportKey);
        }
    }
    const oocSocial = reconcileSocialState(working, { provenance: 'manual', confidence: 'manual', sourceMessageId: resolvedId, turn: state.turn });
    working.socialGraph = oocSocial.socialGraph;
    working.npcs = oocSocial.state.npcs;
    if (resolvedId >= 0) commitBranchCheckpoint(working, resolvedId, 'ooc');
    setChatState(getChatKey(), working);
    persist();
    renderDossier();
    updateInjection();

    for (const report of reports) {
        if (report.status === 'added') globalThis.toastr?.success?.(`NPC State: added ${report.name}; recent-history dossier backfill is queued.`);
        else if (report.status === 'exists') globalThis.toastr?.info?.(`NPC State: ${report.name} already exists; recent-history backfill is queued.`);
        else if (report.status === 'restored') globalThis.toastr?.success?.(`NPC State: restored ${report.name}; recent-history backfill is queued.`);
        else if (report.status === 'removed') globalThis.toastr?.success?.(`NPC State: removed ${report.name} and suppressed rediscovery.`);
        else if (report.status === 'suppressed') globalThis.toastr?.info?.(`NPC State: ${report.name} is now suppressed.`);
        else if (report.status === 'excluded') globalThis.toastr?.warning?.(`NPC State: ${report.name} is the player/main character and was not added.`);
        else if (report.status === 'full') globalThis.toastr?.warning?.(`NPC State: active roster cap is ${settings.maxNpcs}; ${report.name} was not added. Archived dossiers do not count.`);
    }
    return reports;
}

async function handleAssistantMessageReceived(messageId, { bypassSwipeGuard = false, forceBranchRescan = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return;
    const eventChatKey = getChatKey();
    if (eventChatKey === 'no-chat') return;
    try { await ensureChatStateLoaded(eventChatKey); }
    catch (error) {
        console.error('[NPC State] assistant event deferred because chat hydration failed.', error);
        globalThis.toastr?.error?.('NPC State could not load this chat dossier. Existing sidecar data was preserved; retry after the server is available.');
        return;
    }
    if (getChatKey() !== eventChatKey) return;

    // SillyTavern 1.18 emits MESSAGE_SWIPED before starting Generate('swipe'). Some
    // backends then emit MESSAGE_RECEIVED while swipeState is still SWIPING. Never run
    // dossier generation in that window; settlement will replay this message safely.
    if (!bypassSwipeGuard && isHostSwipeActive()) {
        if (Number.isInteger(messageId)) deferredSwipeMessageId = messageId;
        queueSettledSwipeReconcile({
            explicitDivergence: Number.isInteger(messageId) ? messageId : null,
            rescan: true,
            reason: 'message-swiped-received',
        });
        return;
    }

    const state = getChatState();
    if (state.lastScannedMessageId === messageId && !forceBranchRescan) return;
    if (Number.isInteger(messageId)) ensureBranchParentAnchor(state, getContext().chat || [], messageId, 'assistant-parent');
    state.turn = Number(state.turn || 0) + 1;
    const receivedMessage = Number.isInteger(messageId) ? getContext().chat?.[messageId] : null;
    const compactWorldStateTurn = hasCompactMeguminWorldState(receivedMessage?.mes || '');
    // Presence remains last-confirmed until a successful scanner observation replaces it.
    // A skipped, busy, failed, or timed-out scan must not make every NPC disappear.
    if (!compactWorldStateTurn) for (const npc of state.npcs) npc.worldActive = Boolean(npc.worldActive);
    state.assistantSinceScan = Number(state.assistantSinceScan || 0) + 1;
    const shouldForceBranchScan = forceBranchRescan && settings.branchRescan !== false;
    const autoScanDue = settings.autoScan && (settings.fullScanEveryTurn || state.assistantSinceScan >= settings.scanEvery);
    const scanExpected = shouldForceBranchScan || autoScanDue;
    if (Number.isInteger(messageId) && !scanExpected) commitBranchCheckpoint(state, messageId, 'turn');
    else state.lineage = chatLineage(getContext().chat || []);
    persist();
    renderDossier();
    updateInjection();

    if (scanExpected) {
        await scanNow({ manual: false, messageId, allowDuringSwipe: bypassSwipeGuard });
    }
    await processPendingBackfills(messageId);
}

function registerEvents() {
    if (eventsRegistered) return;
    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types || {};
    const source = ctx.eventSource;
    if (!source?.on) return;
    eventsRegistered = true;

    if (events.MESSAGE_SENT) {
        source.on(events.MESSAGE_SENT, async (messageId) => {
            const key = getChatKey();
            if (key === 'no-chat') return;
            try { await ensureChatStateLoaded(key); } catch (error) { console.error('[NPC State] OOC command skipped because chat hydration failed.', error); return; }
            if (getChatKey() !== key) return;
            const reports = processOocCommands(messageId);
            if (!reports.length && getChatKey() !== 'no-chat') {
                getChatState().lineage = chatLineage(getContext().chat || []);
            }
        });
    }

    if (events.MESSAGE_RECEIVED) {
        source.on(events.MESSAGE_RECEIVED, async (messageId) => {
            await handleAssistantMessageReceived(messageId);
        });
    }
    if (events.CHARACTER_MESSAGE_RENDERED) source.on(events.CHARACTER_MESSAGE_RENDERED, () => queueInlineRender(0));
    if (events.MESSAGE_UPDATED) source.on(events.MESSAGE_UPDATED, () => queueInlineRender(30));
    if (events.MORE_MESSAGES_LOADED) source.on(events.MORE_MESSAGES_LOADED, () => queueInlineRender(30));
    if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, async () => {
        const key = getChatKey();
        if (key === 'no-chat') return;
        try {
            await ensureChatStateLoaded(key);
            if (getChatKey() !== key) return;
            renderDossier(); ensureInlineObserver(); queueInlineRender(0);
        } catch (error) { console.error('[NPC State] post-load hydration/render failed; durable data was not overwritten.', error); }
    });

    if (events.MESSAGE_DELETED) {
        source.on(events.MESSAGE_DELETED, () => {
            queueBranchReconcile({ rescan: true, reason: 'message-deleted' }, 70);
        });
    }
    if (events.MESSAGE_SWIPED) {
        source.on(events.MESSAGE_SWIPED, (messageId) => {
            queueSettledSwipeReconcile({
                explicitDivergence: Number.isInteger(messageId) ? messageId : null,
                rescan: true,
                reason: 'message-swiped',
            });
        });
    }
    if (events.MESSAGE_SWIPE_DELETED) {
        source.on(events.MESSAGE_SWIPE_DELETED, (messageId) => {
            queueSettledSwipeReconcile({
                explicitDivergence: Number.isInteger(messageId) ? messageId : null,
                rescan: true,
                reason: 'swipe-deleted',
            });
        });
    }
    if (events.MESSAGE_EDITED) {
        source.on(events.MESSAGE_EDITED, (messageId) => {
            queueBranchReconcile({
                explicitDivergence: Number.isInteger(messageId) ? messageId : null,
                rescan: true,
                processOocMessageId: Number.isInteger(messageId) ? messageId : null,
                reason: 'message-edited',
            }, 110);
        });
    }

    if (events.CHAT_CHANGED) {
        source.on(events.CHAT_CHANGED, async () => {
            const key = getChatKey();
            try {
                if (key !== 'no-chat') await ensureChatStateLoaded(key);
                if (getChatKey() !== key) return;
                const inherited = await maybeInheritKnownBranch();
                if (getChatKey() !== key) return;
                const state = key === 'no-chat' ? null : getChatState(key);
                if (state) seedBranchTracking(state);
                if (inherited) persist();
                setScanIndicator(key !== 'no-chat' && isScanBusy(key));
                renderDossier();
                ensureInlineObserver();
                queueInlineRender(30);
                updateInjection();
                if (!inherited && state?.lineage?.length) queueBranchReconcile({ chatKey: key, rescan: false, reason: 'chat-changed' }, 80);
                if (key !== 'no-chat') void drainPendingAutoScan(key);
            } catch (error) {
                if (getChatKey() === key) { renderDossier(); updateInjection(); }
                console.error('[NPC State] chat change hydration failed; durable state was preserved.', error);
            }
        });
    }

    if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'chat'); });
    if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, async (chatId) => { await removeDeletedChatState(chatId, 'group'); });
    if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, async (eventData) => { await moveRenamedChatState(eventData); });
}

async function init() {
    if (initialized) {
        scheduleSettingsMountRetries();
        return;
    }
    initialized = true;
    getSettings();
    await migrateLegacyChatStates();
    const key = getChatKey();
    if (key !== 'no-chat') {
        await ensureChatStateLoaded(key);
        if (getChatKey() === key) {
            await maybeInheritKnownBranch();
            if (getChatKey() === key) seedBranchTracking(getChatState(key));
        }
    }
    bindUi();
    installUiCaptureBridge();
    registerEvents();
    startInlineWatchdog();
    globalThis.addEventListener?.('pagehide', flushCurrentChatOnPageHide);
    globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document?.visibilityState === 'hidden') flushCurrentChatOnPageHide(); });
    scheduleSettingsMountRetries();
    updateInjection();
    console.log(`[NPC State] v${NPC_STATE_VERSION} loaded`);
}

async function safeInit() {
    try {
        await init();
    } catch (error) {
        initialized = false;
        console.error('[NPC State] initialization failed', error);
    }
}

$(safeInit);

// Some SillyTavern builds finish extension discovery after DOM ready. Re-running the
// idempotent bootstrap on lifecycle events makes the settings card appear reliably.
try {
    const bootContext = getContext();
    const bootEvents = bootContext.eventTypes || bootContext.event_types || {};
    if (bootContext.eventSource?.on) {
        if (bootEvents.APP_READY) bootContext.eventSource.on(bootEvents.APP_READY, safeInit);
        if (bootEvents.EXTENSION_SETTINGS_LOADED) bootContext.eventSource.on(bootEvents.EXTENSION_SETTINGS_LOADED, safeInit);
    }
} catch (error) {
    console.debug('[NPC State] lifecycle bootstrap will rely on DOM ready.', error);
}

// Small debug surface for deployment tests.
window.NPCState = Object.freeze({
    version: NPC_STATE_VERSION,
    scan: () => scanNow({ manual: true }),
    processOoc: processOocCommands,
    processBackfills: processPendingBackfills,
    scanDossier: value => { const npc = findNpcByIdOrName(value); return npc ? scanNpcDossier(npc.id) : false; },
    refreshFromChat: value => { const npc = findNpcByIdOrName(value); return npc ? refreshNpcFromChat(npc.id) : false; },
    portraitPrompts: value => { const npc = findNpcByIdOrName(value); return npc ? npcImagePromptPair(npc) : null; },
    generatePortraitUrl: async (value, overrides = {}) => {
        const npc = findNpcByIdOrName(value);
        if (!npc) return null;
        const prompts = npcImagePromptPair(npc);
        return executeNativePortraitGeneration(
            String(overrides?.positive ?? prompts.positive).trim(),
            String(overrides?.negative ?? prompts.negative).trim(),
        );
    },
    openPortraitGenerator: value => { const npc = findNpcByIdOrName(value); return npc ? openPortraitGenerator(npc.id) : false; },
    render: renderDossier,
    renderInline: renderInlineCards,
    openEditor: value => { const npc = findNpcByIdOrName(value); return npc ? openNpcEditorSafely(npc.id) : false; },
    openViewer: value => { const npc = findNpcByIdOrName(value); return npc ? openNpcViewer(npc.id, latestMessageId(true)) : false; },
    closeViewer: closeNpcViewer,
    uiStatus: () => ({
        version: NPC_STATE_VERSION,
        chatKey: getChatKey(),
        hydrationStatus: chatHydrationStatus(getChatKey()),
        hydrationError: hydrationErrors.get(getChatKey())?.message || null,
        scanBusyForChat: isScanBusy(getChatKey()),
        scanOperation: scanOperations.status(getChatKey()),
        inlineEntries: getChatState().inlineCards?.length || 0,
        mountedInlineAnchors: document.querySelectorAll?.('.npc-state-inline-anchor')?.length || 0,
        integratedMeguminBlocks: document.querySelectorAll?.('.npc-state-megumin-pane')?.length || 0,
        settingsPanelMounted: Boolean(document.querySelector?.(`#${UI_ID}`)),
        rosterMounted: Boolean(document.querySelector?.('#npc_state_roster_summary')),
        editorMounted: editorIsMounted(),
        editorMode: activeEditorPopup ? 'sillytavern-popup' : (document.querySelector?.('#npc_state_editor_overlay') ? 'legacy-overlay' : 'closed'),
        viewerOpen: Boolean(activeNpcViewerOverlay),
        viewerNpcId: activeNpcViewerId || null,
        portraitGeneratorOpen: Boolean(activePortraitGeneratorOverlay),
        portraitGeneratorNpcId: activePortraitGeneratorNpcId || null,
        portraitGenerationBusy,
        inlineAnchors: document.querySelectorAll?.('.npc-state-inline-anchor')?.length || 0,
        inlineObserver: Boolean(inlineObserver && inlineObserverChat),
        inlineNeedsRepair: inlineMountNeedsRepair(),
        lastScan: lastScanMetrics ? { ...lastScanMetrics } : null,
        swipeState: hostSwipeState(),
        swipeSettlementPending: Boolean(swipeSettlementPending || swipeSettlementTimer),
    }),
    exportBytes: exportBundleBytes,
    importBytes: importBundleBytes,
    reconcile: (options = {}) => reconcileCurrentBranch(options),
    scanMetrics: () => lastScanMetrics ? { ...lastScanMetrics } : null,
    getState: () => structuredClone(getChatState()),
    flush: () => flushStateFile(),
    dataFile: () => structuredClone(getSettings().dataFiles?.[getChatKey()] || null),
    archive: npcId => setNpcArchiveStateById(npcId, true, { reason: 'manual', confirmAction: false }),
    restore: npcId => setNpcArchiveStateById(npcId, false, { confirmAction: false }),
    deleteNpc: npcId => deleteNpcById(npcId, { confirmAction: false }),
});
