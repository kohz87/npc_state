import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-runtime-'));
const extRoot = path.join(tempRoot, 'public', 'scripts', 'extensions', 'third-party', 'npc_state');
fs.mkdirSync(extRoot, { recursive: true });
for (const name of ['index.js', 'core.js', 'bundle.js', 'branch.js', 'social.js', 'storage.js', 'identity.js']) {
    fs.copyFileSync(path.join(sourceRoot, name), path.join(extRoot, name));
}
fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }));

const mockState = {
    extensionSettings: {},
    prompts: [],
    listeners: new Map(),
    quietResponder: null,
    rawCalls: [],
    quietCalls: [],
    files: new Map(),
    messageDomReady: true,
    popupCalls: [],
    swipeState: 'none',
    slashCalls: [],
    uploadCalls: 0,
    uploadBarrier: null,
    readBarrier: null,
};

fs.writeFileSync(path.join(tempRoot, 'public', 'scripts', 'extensions.js'), `
export const extension_settings = globalThis.__npcMock.extensionSettings;
export function getContext() { return globalThis.__npcMock.context; }
`);
fs.writeFileSync(path.join(tempRoot, 'public', 'script.js'), `
export const extension_prompt_types = { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export function getRequestHeaders() { return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'mock' }; }
`);

const POPUP_TYPE = { TEXT: 1, DISPLAY: 4 };
const POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };
class MockPopup {
    constructor(content, type, inputValue = '', options = {}) {
        this.content = content;
        this.type = type;
        this.inputValue = inputValue;
        this.options = options;
        this.result = undefined;
        const classes = new Set();
        this.dlg = {
            open: false,
            isConnected: false,
            classList: { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name) },
        };
        mockState.popupCalls.push(this);
    }
    async show() {
        this.dlg.open = true;
        this.dlg.isConnected = true;
        document.body.appendChild?.(this.dlg);
        this.options.onOpen?.(this);
        this._promise = new Promise(resolve => { this._resolve = resolve; });
        return this._promise;
    }
    async complete(result) {
        this.result = result;
        if (this.options.onClosing) {
            const allowed = await this.options.onClosing(this);
            if (allowed === false) return undefined;
        }
        this.dlg.open = false;
        this.dlg.isConnected = false;
        await this.options.onClose?.(this);
        this._resolve?.(result);
        return result;
    }
    async completeCancelled() { return this.complete(POPUP_RESULT.CANCELLED); }
}

const eventSource = {
    on(name, fn) {
        const list = mockState.listeners.get(name) || [];
        list.push(fn);
        mockState.listeners.set(name, list);
    },
    emit(name, ...args) {
        for (const fn of mockState.listeners.get(name) || []) fn(...args);
    },
};

mockState.context = {
    chatId: 'smoke-chat',
    getCurrentChatId: () => 'smoke-chat',
    chat: [],
    characters: [{ name: 'Megumin', avatar: 'megumin.png' }],
    characterId: 0,
    groupId: null,
    name1: 'Kazuma',
    name2: 'Megumin',
    saveSettingsDebounced: () => {},
    setExtensionPrompt: (...args) => mockState.prompts.push(args),
    eventSource,
    eventTypes: {
        APP_READY: 'app_ready',
        EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
        MESSAGE_SENT: 'message_sent',
        MESSAGE_RECEIVED: 'message_received',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_DELETED: 'message_deleted',
        MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
        CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        MESSAGE_UPDATED: 'message_updated',
        MORE_MESSAGES_LOADED: 'more_messages_loaded',
        CHAT_LOADED: 'chat_loaded',
        CHAT_CHANGED: 'chat_changed',
        CHAT_DELETED: 'chat_deleted',
        GROUP_CHAT_DELETED: 'group_chat_deleted',
        CHAT_RENAMED: 'chat_renamed',
    },
    generateRaw: async (...args) => { mockState.rawCalls.push(args); return mockState.quietResponder ? mockState.quietResponder(...args) : '{"npcs":[]}'; },
    generateQuietPrompt: async (...args) => { mockState.quietCalls.push(args); return '{"npcs":[]}'; },
    executeSlashCommandsWithOptions: async (...args) => { mockState.slashCalls.push(args); return { pipe: '/user/images/npc-state-generated.png' }; },
    Popup: MockPopup,
    POPUP_TYPE,
    POPUP_RESULT,
    swipe: { state: () => mockState.swipeState },
};
globalThis.__npcMock = mockState;
globalThis.window = globalThis;

globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/files/upload') {
        mockState.uploadCalls += 1;
        const barrier = mockState.uploadBarrier;
        if (barrier) {
            mockState.uploadBarrier = null;
            barrier.entered?.();
            await barrier.promise;
        }
        const body = JSON.parse(options.body || '{}');
        const filePath = `/user/files/${body.name}`;
        mockState.files.set(filePath, Buffer.from(body.data, 'base64').toString('utf8'));
        return { ok: true, status: 200, json: async () => ({ path: filePath }), text: async () => '' };
    }
    if (url === '/api/files/delete') {
        const body = JSON.parse(options.body || '{}');
        const existed = mockState.files.delete(body.path);
        return { ok: existed, status: existed ? 200 : 404, text: async () => '' };
    }
    if (mockState.files.has(url)) {
        const barrier = mockState.readBarrier;
        if (barrier) {
            mockState.readBarrier = null;
            barrier.entered?.();
            await barrier.promise;
        }
        return { ok: true, status: 200, text: async () => mockState.files.get(url) };
    }
    return { ok: false, status: 404, text: async () => '' };
};

globalThis.toastr = { warning() {}, error() {}, success() {}, info() {} };
globalThis.URL = globalThis.URL || { createObjectURL: () => 'blob:mock', revokeObjectURL() {} };

const inlineAnchors = [];
const messageElements = new Map();
const meguminBlocks = new Map();
const documentListeners = new Map();
const mutationObservers = [];

function nodeHasClass(node, name) {
    return String(node?.className || '').split(/\s+/).filter(Boolean).includes(name);
}

function mockSelectorMatches(node, selector) {
    return String(selector || '').split(',').map(part => part.trim()).some(part => {
        if (!part.startsWith('.')) return false;
        return nodeHasClass(node, part.slice(1));
    });
}

function makeMockDomNode(tag = 'div') {
    const listeners = new Map();
    const node = {
        tagName: String(tag).toUpperCase(), className: '', dataset: {}, innerHTML: '', style: {}, id: '', title: '', type: '',
        children: [], parentNode: null, isConnected: true,
        classList: {
            contains(name) { return nodeHasClass(node, name); },
            add(...names) {
                const set = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
                names.forEach(name => set.add(name)); node.className = [...set].join(' ');
            },
            remove(...names) {
                const remove = new Set(names);
                node.className = String(node.className || '').split(/\s+/).filter(name => name && !remove.has(name)).join(' ');
            },
            toggle(name, force) {
                const has = nodeHasClass(node, name);
                const next = force === undefined ? !has : Boolean(force);
                if (next) this.add(name); else this.remove(name);
                return next;
            },
        },
        addEventListener(name, fn) {
            const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list);
        },
        click() {
            const event = {
                target: node,
                defaultPrevented: false,
                stopPropagation() {},
                preventDefault() { event.defaultPrevented = true; },
            };
            for (const fn of listeners.get('click') || []) fn(event);
        },
        appendChild(child) {
            if (!child) return child;
            if (child.parentNode && child.parentNode !== node) child.remove?.();
            child.parentNode = node;
            if (!node.children.includes(child)) node.children.push(child);
            return child;
        },
        before(child) {
            const parent = node.parentNode;
            if (!parent?.children || !child) return;
            child.remove?.();
            const i = parent.children.indexOf(node);
            child.parentNode = parent;
            parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
        },
        remove() {
            if (node.parentNode?.children) {
                const i = node.parentNode.children.indexOf(node);
                if (i >= 0) node.parentNode.children.splice(i, 1);
            }
            node.parentNode = null;
            node.isConnected = false;
            if (editorOverlay === node) editorOverlay = null;
            const index = inlineAnchors.indexOf(node); if (index >= 0) inlineAnchors.splice(index, 1);
        },
        querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
        querySelectorAll(selector) {
            const found = [];
            const walk = parent => {
                for (const child of parent.children || []) {
                    if (mockSelectorMatches(child, selector)) found.push(child);
                    walk(child);
                }
            };
            walk(node);
            return found;
        },
        closest(selector) {
            let cur = node;
            while (cur) {
                if (mockSelectorMatches(cur, selector)) return cur;
                cur = cur.parentNode;
            }
            return null;
        },
    };
    return node;
}

function createMockMeguminBlock() {
    const card = makeMockDomNode('div'); card.className = 'meg-blocks';
    const tabs = makeMockDomNode('div'); tabs.className = 'meg-blocks-tabs';
    const nativeTab = makeMockDomNode('button'); nativeTab.className = 'meg-blocks-tab active'; nativeTab.dataset.key = 'world'; nativeTab.dataset.blockId = 'world';
    const collapse = makeMockDomNode('button'); collapse.className = 'meg-blocks-collapse';
    const panel = makeMockDomNode('div'); panel.className = 'meg-blocks-panel';
    const nativePane = makeMockDomNode('div'); nativePane.className = 'meg-block-body'; nativePane.dataset.key = 'world'; nativePane.style.display = '';
    tabs.appendChild(nativeTab); tabs.appendChild(collapse); panel.appendChild(nativePane); card.appendChild(tabs); card.appendChild(panel);

    // Mirror Megumin's private selected-key closure closely enough to catch foreign-tab
    // integrations that only change DOM state. With no CYOA/resting tab, clicking the
    // active native tab closes the card and clicking it from null opens it.
    let current = 'world';
    const select = key => {
        current = key;
        nativeTab.classList.toggle('active', key === 'world');
        nativePane.style.display = key === 'world' ? '' : 'none';
        card.classList.toggle('meg-blocks-shut', key === null);
    };
    nativeTab.addEventListener('click', () => select(current === 'world' ? null : 'world'));
    collapse.addEventListener('click', () => select(null));

    return { card, tabs, panel, nativeTab, nativePane, collapse, current: () => current };
}
const chatRoot = {
    closest() { return null; },
    querySelectorAll(selector) { return globalThis.document?.querySelectorAll?.(selector) || []; },
};
class MockMutationObserver {
    constructor(callback) { this.callback = callback; this.target = null; mutationObservers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
    trigger(mutations = [{ type: 'childList', target: chatRoot }]) { this.callback(mutations); }
}
globalThis.MutationObserver = MockMutationObserver;
let editorOverlay = null;
function getMessageElement(id) {
    if (!messageElements.has(id)) {
        const text = { insertAdjacentElement(_where, node) { if (!inlineAnchors.includes(node)) inlineAnchors.push(node); } };
        messageElements.set(id, {
            querySelector(selector) {
                if (selector === '.mes_text') return text;
                if (selector === '.meg-blocks') return meguminBlocks.get(id)?.card || null;
                return null;
            },
            appendChild(node) { if (!inlineAnchors.includes(node)) inlineAnchors.push(node); },
        });
    }
    return messageElements.get(id);
}
function emitDocumentEvent(name, event) {
    for (const fn of documentListeners.get(name) || []) fn(event);
}
globalThis.document = {
    body: { appendChild(node) { if (node?.id === 'npc_state_editor_overlay') editorOverlay = node; if (node) node.isConnected = true; }, contains(node) { return Boolean(node?.isConnected); } },
    addEventListener(name, fn) {
        const list = documentListeners.get(name) || [];
        list.push(fn);
        documentListeners.set(name, list);
    },
    querySelector(selector) {
        if (selector === '#npc_state_editor_overlay') return editorOverlay;
        if (selector === '#chat') return chatRoot;
        const match = String(selector).match(/\.mes\[(?:data-)?mesid=\"(\d+)\"\]/);
        return match && mockState.messageDomReady ? getMessageElement(Number(match[1])) : null;
    },
    querySelectorAll(selector) {
        if (selector === '.npc-state-inline-anchor') return [...inlineAnchors];
        if (selector === '#chat .mes') return mockState.messageDomReady ? [...messageElements.values()] : [];
        if (String(selector).includes('npc-state-megumin')) {
            return [...meguminBlocks.values()].flatMap(item => item.card.querySelectorAll(selector));
        }
        return [];
    },
    createElement(tag) { return makeMockDomNode(tag); },
};

let mounted = false;
const makeQuery = (selector) => {
    const isHost = selector === '#extensions_settings2';
    const isLegacyHost = selector === '#extensions_settings' || selector === '#extensionsMenu';
    const isPanel = selector === '#npc_state_settings';
    const exists = selector === document || isHost || (mounted && !isLegacyHost) || (isPanel && mounted);
    const q = {
        length: exists ? 1 : 0,
        append(html) { if (String(html).includes('id="npc_state_settings"')) mounted = true; return q; },
        off() { return q; }, on() { return q; }, prop() { return q; }, val() { return q; },
        html() { return q; }, toggleClass() { return q; }, text() { return q; }, attr() { return q; }, data() { return undefined; },
    };
    return q;
};
globalThis.$ = (selector) => {
    if (typeof selector === 'function') { queueMicrotask(() => selector()); return makeQuery(document); }
    return makeQuery(selector);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
    await import(pathToFileURL(path.join(extRoot, 'index.js')).href + `?t=${Date.now()}`);
    await sleep(30);
    assert.equal(mounted, true, 'settings panel should mount');
    assert.equal(globalThis.NPCState?.version, '0.2.17');
    assert.ok(mockState.extensionSettings.npc_state, 'settings namespace should initialize');
    assert.equal(mockState.extensionSettings.npc_state.admissionMode, 'conservative');
    assert.equal(mockState.extensionSettings.npc_state.chats, undefined, 'live NPC database should not be stored in extension_settings');
    assert.equal((mockState.listeners.get('message_sent') || []).length, 1);
    eventSource.emit('app_ready');
    eventSource.emit('extension_settings_loaded');
    await sleep(20);
    assert.equal((mockState.listeners.get('message_sent') || []).length, 1, 'lifecycle retries must not duplicate listeners');
    mockState.extensionSettings.npc_state.relationshipBaseline = { trust: 0, affection: -12, desire: 0, tension: -7 };
    mockState.extensionSettings.npc_state.relationshipCaps = { ordinary: 2, meaningful: 3, major: 9, extreme: 18 };
    mockState.extensionSettings.npc_state.relationshipCriteria = 'Runtime custom relationship rubric.';
    mockState.extensionSettings.npc_state.relationshipImpactCriteria = 'Runtime custom impact rubric.';
    mockState.extensionSettings.npc_state.memoryCriteria = 'Runtime custom memory rubric.';
    mockState.extensionSettings.npc_state.behaviorCriteria = 'Runtime custom behavior rubric.';

    // OOC add creates the persistent dossier but does not force an off-screen inline card.
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: add Yunyun)' });
    eventSource.emit('message_sent', 0);
    await sleep(20);
    assert.deepEqual(globalThis.NPCState.getState().npcs.map(n => n.name), ['Yunyun']);
    assert.equal(inlineAnchors.length, 0, 'OOC add should not bypass presence gating');
    await globalThis.NPCState.flush();
    const pointer = globalThis.NPCState.dataFile();
    assert.ok(pointer?.path, 'chat state should be persisted to an extension-owned JSON sidecar file');
    assert.ok(mockState.files.has(pointer.path));
    const persistedAfterAdd = JSON.parse(mockState.files.get(pointer.path));
    assert.equal(persistedAfterAdd.state.npcs[0].name, 'Yunyun');
    assert.deepEqual(Object.keys(persistedAfterAdd.state.npcs[0].relationship).sort(), ['affection', 'desire', 'tension', 'trust']);
    assert.deepEqual(persistedAfterAdd.state.npcs[0].relationship, { trust: 0, affection: -12, desire: 0, tension: -7 }, 'manual/OOC add should support a configured bipolar baseline');

    // Scanner admits proper/dossier-worthy NPCs and only renders the one actually present in the latest scene.
    mockState.quietResponder = async (args = {}) => {
        if (args.jsonSchema) return '{"npcs":[]}';
        return JSON.stringify({ npcs: [
            { name: 'Yunyun', present: true, role: 'adventurer', species: 'Crimson Demon', age: '18', appearance: 'Young woman with long dark brown hair, crimson eyes, a slim build, and a black-and-red adventurer outfit.', personality: 'proud but earnest', speech: 'formal when nervous', relationshipSummary: 'She is cautiously warming to Kazuma and beginning to trust him.', relationshipImpact: 'meaningful', relationshipDelta: { trust: 3, affection: 2, desire: 0, tension: 0 }, relationshipEvidence: { trust: 'Yunyun explicitly says she trusts Kazuma more.', affection: 'Yunyun explicitly says she is fond of Kazuma.', desire: '', tension: '' }, relationshipChangeReason: 'Yunyun tells Kazuma she trusts him more and is fond of him.', mannerisms: ['boasts when embarrassed'] },
            { name: 'Wiz', present: false, worldActive: true, role: 'shopkeeper', location: 'Wiz\'s shop', relationshipImpact: 'ordinary', relationshipDelta: { tension: -4 } },
        ] });
    };
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', mes: 'Yunyun, a young woman with long dark brown hair and crimson eyes, waves awkwardly. She remains proud but earnest, shows dry humor with trusted companions, consistently uses proper titles with elders, and stays formal when nervous. Yunyun tells Kazuma she trusts him more, is fond of him, and feels attracted but tense. Wiz remains back at her shop.', swipe_id: 0 });
    eventSource.emit('message_received', 1);
    await sleep(320);
    let state = globalThis.NPCState.getState();
    assert.deepEqual(state.npcs.map(n => n.name).sort(), ['Wiz', 'Yunyun']);
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').present, true);
    assert.ok(mockState.rawCalls.length >= 1, 'scanner should use generateRaw');
    assert.equal(mockState.quietCalls.length, 0, 'scanner must not use generateQuietPrompt or inherit chat context');
    const rawScanArgs = [...mockState.rawCalls].reverse().map(call => call?.[0] || {}).find(args => /isolated dossier scanner/i.test(String(args.systemPrompt || ''))) || {};
    assert.match(String(rawScanArgs.systemPrompt || ''), /isolated dossier scanner/i);
    assert.match(String(rawScanArgs.prompt || ''), /private NPC dossier scanner/i);
    assert.match(String(rawScanArgs.prompt || ''), /CONSERVATIVE:/i);
    assert.match(String(rawScanArgs.prompt || ''), /Runtime custom memory rubric/i, 'automatic scanner should receive the player memory criteria');
    assert.equal(rawScanArgs.responseLength, 1800);
    const scanMetrics = globalThis.NPCState.scanMetrics();
    assert.equal(scanMetrics.promptChars, String(rawScanArgs.prompt || '').length, 'scan telemetry should expose the actual compact prompt size');
    assert.ok(Number.isFinite(scanMetrics.durationMs) && scanMetrics.durationMs >= 0, 'scan telemetry should expose duration');
    assert.equal(scanMetrics.retried, false);
    assert.equal(scanMetrics.relationshipPass, false, 'a complete primary relationship decision should not pay for a second model call');
    assert.equal(scanMetrics.relationshipTargets, 0);
    const relationshipCallsAfterCompletePrimary = mockState.rawCalls.map(call => call?.[0] || {}).filter(args => /isolated relationship evaluator/i.test(String(args.systemPrompt || '')));
    assert.equal(relationshipCallsAfterCompletePrimary.length, 0, 'focused relationship generation is reserved for incomplete primary decisions');
    assert.equal(rawScanArgs.instructOverride, true);
    assert.equal(rawScanArgs.trimNames, false);
    assert.equal('jsonSchema' in rawScanArgs, false, 'raw scanner must not depend on provider structured-output schemas');
    assert.equal('quietPrompt' in rawScanArgs, false);
    const rawBackfillArgs = [...mockState.rawCalls].reverse().map(call => call?.[0] || {}).find(args => /backfill scanner/i.test(String(args.systemPrompt || ''))) || {};
    assert.match(String(rawBackfillArgs.prompt || ''), /targeted dossier backfill extractor/i);
    assert.match(String(rawBackfillArgs.prompt || ''), /Runtime custom memory rubric/i, 'targeted backfill should use the same memory criteria');
    assert.equal('jsonSchema' in rawBackfillArgs, false, 'backfill must not depend on provider structured-output schemas');
    assert.equal(rawBackfillArgs.responseLength, 3200);
    assert.equal(globalThis.NPCState.getState().pendingBackfills.length, 0, 'queued OOC backfill should be consumed after the next assistant reply');
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').age, '18');
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').species, 'Crimson Demon');
    assert.match(state.npcs.find(n => n.name === 'Yunyun').appearance, /crimson eyes/);
    assert.equal('thoughts' in state.npcs.find(n => n.name === 'Yunyun'), false);
    assert.equal(state.npcs.find(n => n.name === 'Wiz').present, false);
    assert.equal(state.npcs.find(n => n.name === 'Wiz').worldActive, true, 'World State-style off-screen activity should be tracked separately from presence');
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').relationship.trust, 3, 'meaningful delta should respect configured cap of 3 from neutral zero');
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').lastRelationshipChange.delta.trust, 3);
    assert.equal(state.npcs.find(n => n.name === 'Wiz').relationship.tension, -7, 'ungrounded non-zero Wiz delta must be rejected instead of accumulating silent relationship drift');
    const portraitPrompts = globalThis.NPCState.portraitPrompts('Yunyun');
    assert.match(portraitPrompts.positive, /fantasy anime character illustration/i, 'portrait builder should apply the configured global theme');
    assert.match(portraitPrompts.positive, /Crimson Demon/);
    assert.match(portraitPrompts.positive, /crimson eyes/);
    assert.doesNotMatch(portraitPrompts.positive, /proud but earnest/i, 'nonvisual Personality prose should not be dumped into portrait prompts');
    const generatedUrl = await globalThis.NPCState.generatePortraitUrl('Yunyun');
    assert.equal(generatedUrl, '/user/images/npc-state-generated.png');
    assert.equal(mockState.slashCalls.length, 1, 'one portrait request should execute exactly one native ST slash command');
    const portraitCommand = String(mockState.slashCalls[0][0] || '');
    assert.match(portraitCommand, /^\/imagine\s/);
    assert.match(portraitCommand, /\bquiet=true\b/);
    assert.match(portraitCommand, /\bgallery=false\b/);
    assert.match(portraitCommand, /negative="[^"]+/);
    assert.match(portraitCommand, /Crimson Demon/);
    assert.equal(mockState.context.chat.length, 2, 'quiet native portrait generation must not add a chat message in the runtime harness');
    assert.equal(inlineAnchors.length, 1, 'only the latest present-cast roster should mount');
    assert.match(inlineAnchors[0].innerHTML, /npc-state-present-grid/);
    assert.match(inlineAnchors[0].innerHTML, /npc-state-present-card/);
    assert.match(inlineAnchors[0].innerHTML, /Yunyun/);
    assert.doesNotMatch(inlineAnchors[0].innerHTML, />Wiz</);
    assert.match(inlineAnchors[0].innerHTML, /npc-state-present-card-overlay/);
    assert.match(inlineAnchors[0].innerHTML, /<small>adventurer(?: · [^<]+)?<\/small>/i);
    assert.doesNotMatch(inlineAnchors[0].innerHTML, /T \+3 · A -9|npc-state-present-card-relation/, 'gallery cards should keep relationship metrics in the dossier viewer');
    assert.doesNotMatch(inlineAnchors[0].innerHTML, /Desire|Mannerisms|Species \/ Race|Copy portrait prompts|Current thoughts|Thought basis/, 'portrait grid should stay compact; detailed fields belong in the focused viewer');
    assert.equal(globalThis.NPCState.openViewer('Yunyun'), true, 'present NPC portrait viewer should open from the live dossier state');
    assert.equal(globalThis.NPCState.uiStatus().viewerOpen, true);
    assert.equal(globalThis.NPCState.uiStatus().viewerNpcId, state.npcs.find(n => n.name === 'Yunyun').id);
    assert.equal(globalThis.NPCState.openPortraitGenerator('Yunyun'), true, 'portrait generator should open while the full-screen dossier remains mounted underneath');
    assert.equal(globalThis.NPCState.uiStatus().portraitGeneratorOpen, true);
    assert.equal(globalThis.NPCState.uiStatus().viewerOpen, true, 'opening portrait generation should not destroy the underlying dossier');
    emitDocumentEvent('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(globalThis.NPCState.uiStatus().portraitGeneratorOpen, false, 'Escape should close the top portrait-generator layer first');
    assert.equal(globalThis.NPCState.uiStatus().viewerOpen, true, 'closing the generator should return to the same still-open dossier');
    globalThis.NPCState.closeViewer();
    assert.equal(globalThis.NPCState.uiStatus().viewerOpen, false, 'focused viewer should close without affecting the chat state');

    // Durable-profile updates use their own top-level channel so a manual baseline can
    // organically refine even when the ordinary NPC delta object carries no profile text.
    const yunyunProfileId = state.npcs.find(n => n.name === 'Yunyun').id;
    const wizProfileId = state.npcs.find(n => n.name === 'Wiz').id;
    mockState.quietResponder = async () => JSON.stringify({
        npcs: [
            { id: yunyunProfileId, present: true, worldActive: false, relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 } },
            { id: wizProfileId, present: false, worldActive: true, location: "Wiz's shop", relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 } },
        ],
        profileUpdates: [{
            id: yunyunProfileId,
            evidence: { personality: ['Shows dry humor with trusted companions.'], speech: ['Consistently uses proper titles with elders.'] },
            personalityState: 'refine',
            personality: 'proud but earnest; dryly humorous with trusted companions.',
            speechState: 'refine',
            speech: 'formal when nervous; consistently uses proper titles with elders.',
        }],
    });
    await globalThis.NPCState.scan();
    await sleep(80);
    state = globalThis.NPCState.getState();
    assert.match(state.npcs.find(n => n.name === 'Yunyun').personality, /dryly humorous/i, 'top-level profileUpdates should refine Personality through the live scan path');
    assert.match(state.npcs.find(n => n.name === 'Yunyun').speech, /proper titles/i, 'top-level profileUpdates should refine Speech through the live scan path');
    const profileMetrics = globalThis.NPCState.scanMetrics();
    assert.equal(profileMetrics.profileUpdates, 1);
    assert.equal(profileMetrics.profileApplied, 1);

    // Megumin Suite 2026-08-18+ renders one .meg-blocks card. NPC State should move the
    // already-recorded snapshot into that exact card, then fall back cleanly if the card disappears.
    const meguminBlock = createMockMeguminBlock();
    meguminBlocks.set(1, meguminBlock);
    eventSource.emit('character_message_rendered', 1);
    await sleep(80);
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === '1'), false, 'Megumin-integrated message must not keep a duplicate standalone dossier anchor');
    const integratedTab = meguminBlock.card.querySelector('.npc-state-megumin-tab');
    const integratedPane = meguminBlock.card.querySelector('.npc-state-megumin-pane');
    assert.ok(integratedTab, 'NPC State tab should be inserted into Megumin master block');
    assert.ok(integratedPane, 'NPC State pane should be inserted into Megumin master block');
    assert.match(integratedPane.innerHTML, /Yunyun/);
    assert.equal(globalThis.NPCState.uiStatus().integratedMeguminBlocks, 1);
    integratedTab.click();
    assert.equal(integratedPane.style.display, '', 'clicking NPC State tab should show its pane');
    assert.equal(meguminBlock.panel.style.display, '', 'clicking NPC State tab should explicitly reopen the shared Megumin panel');
    assert.equal(meguminBlock.nativePane.style.display, 'none', 'clicking NPC State tab should hide native Megumin panes');
    assert.equal(meguminBlock.current(), null, 'opening NPC State should synchronize Megumin private selection to null');
    assert.equal(integratedPane.dataset.key, integratedTab.dataset.key, 'foreign Megumin integrations should be able to restore NPC State by the same tab/pane key');

    integratedTab.click();
    assert.equal(meguminBlock.card.classList.contains('meg-blocks-shut'), true, 'clicking the active NPC State tab again should collapse the master card like a native tab');
    assert.equal(integratedPane.style.display, 'none', 'collapsing NPC State should hide its pane');
    assert.equal(integratedTab.classList.contains('active'), false, 'collapsing NPC State should clear its active tab state');
    meguminBlock.nativeTab.click();
    assert.equal(meguminBlock.card.classList.contains('meg-blocks-shut'), false, 'a native Megumin tab should reopen in one click after NPC State collapses');
    assert.equal(meguminBlock.nativePane.style.display, '', 'native Megumin pane should reopen in that same click');

    integratedTab.click();
    assert.equal(integratedPane.style.display, '', 'NPC State should reopen from a native Megumin pane');
    assert.equal(meguminBlock.current(), null, 'reopening NPC State should reset the native selected-key closure again');
    meguminBlock.nativeTab.click();
    assert.equal(meguminBlock.card.classList.contains('meg-blocks-shut'), false, 'switching directly from NPC State to the prior native tab must open it, not close it');
    assert.equal(meguminBlock.nativePane.style.display, '', 'switching from NPC State should show the native pane on the first click');
    assert.equal(integratedPane.style.display, 'none', 'switching to a native Megumin tab should dismiss the NPC State pane');

    integratedTab.click();
    const openedSnapshotHtml = integratedPane.innerHTML.replace('<details ', '<details open ');
    integratedPane.innerHTML = openedSnapshotHtml;
    globalThis.NPCState.renderInline();
    assert.equal(integratedPane.innerHTML, openedSnapshotHtml, 'repair renders must not replace unchanged pane HTML and collapse an opened NPC dossier');
    meguminBlock.nativeTab.click();
    assert.equal(integratedPane.style.display, 'none', 'choosing a native Megumin tab should dismiss the NPC State pane');
    meguminBlocks.delete(1);
    eventSource.emit('message_updated', 1);
    await sleep(90);
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === '1'), true, 'standalone dossier should return when no compatible Megumin card is present');

    // A valid primary dossier response may omit relationship fields entirely. The focused
    // relationship pass must still apply a drastic change instead of silently treating omission as zero.
    const yunyunBeforeRepair = state.npcs.find(n => n.name === 'Yunyun');
    const wizBeforeRepair = state.npcs.find(n => n.name === 'Wiz');
    const trustBeforeRepair = yunyunBeforeRepair.relationship.trust;
    mockState.context.chat[1].mes += ' Kazuma deliberately reveals Yunyun\'s private confidence to the guild, a severe betrayal that shatters Yunyun\'s confidence in him.';
    mockState.quietResponder = async (args = {}) => {
        const systemPrompt = String(args.systemPrompt || '');
        if (/isolated relationship evaluator/i.test(systemPrompt)) {
            return JSON.stringify({ npcs: [
                { id: yunyunBeforeRepair.id, relationshipImpact: 'major', relationshipDelta: { trust: -99, affection: -99, desire: 0, tension: 99 }, relationshipEvidence: { trust: 'Kazuma exposed Yunyun\'s private confidence, betraying her trust.', affection: 'The betrayal deeply hurt Yunyun and damaged her warmth toward Kazuma.', desire: '', tension: 'The public betrayal created severe unresolved conflict and tension.' }, relationshipSummary: 'She feels deeply betrayed by Kazuma and no longer trusts him, while their former warmth now leaves her hurt and conflicted.', relationshipChangeReason: 'Kazuma reveals Yunyun\'s private confidence to the guild, a severe betrayal that shatters her confidence in him.' },
                { id: wizBeforeRepair.id, relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 }, relationshipSummary: wizBeforeRepair.relationshipSummary || '', relationshipChangeReason: '' },
            ] });
        }
        return JSON.stringify({ npcs: [
            { id: yunyunBeforeRepair.id, present: true, worldActive: false, mood: 'shaken', relationshipSummary: 'She still regards Kazuma as a cautiously trusted companion.' },
            { id: wizBeforeRepair.id, present: false, worldActive: true, location: 'Wiz\'s shop' },
        ] });
    };
    await globalThis.NPCState.scan();
    await sleep(80);
    state = globalThis.NPCState.getState();
    const repairedYunyun = state.npcs.find(n => n.name === 'Yunyun');
    assert.equal(repairedYunyun.relationship.trust, trustBeforeRepair - 9, 'focused major delta should apply the configured major cap even when primary scanner omitted relationshipDelta');
    assert.equal(repairedYunyun.lastRelationshipChange.impact, 'major');
    assert.equal(repairedYunyun.lastRelationshipChange.delta.trust, -9);
    assert.match(repairedYunyun.lastRelationshipChange.reason, /severe betrayal/i);
    assert.match(repairedYunyun.relationshipSummary, /deeply betrayed/i, 'focused major relationship evaluation must update the dossier Relationship prose field');
    assert.doesNotMatch(repairedYunyun.relationshipSummary, /cautiously trusted companion/i, 'stale primary-scanner relationshipSummary must not override the focused semantic decision');
    const betrayalSummary = repairedYunyun.relationshipSummary;
    const repairMetrics = globalThis.NPCState.scanMetrics();
    assert.equal(repairMetrics.relationshipPass, true);
    assert.equal(repairMetrics.relationshipTargets, 2);

    // Routine/no-change evaluation must keep the durable Relationship field byte-for-byte stable,
    // even if the primary dossier scanner tries to stylistically rewrite it.
    mockState.quietResponder = async (args = {}) => {
        const systemPrompt = String(args.systemPrompt || '');
        if (/isolated relationship evaluator/i.test(systemPrompt)) {
            return JSON.stringify({ npcs: [
                { id: yunyunBeforeRepair.id, relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 }, relationshipSummary: betrayalSummary, relationshipChangeReason: '' },
            ] });
        }
        return JSON.stringify({ npcs: [
            { id: yunyunBeforeRepair.id, present: true, worldActive: false, mood: 'quiet', relationshipSummary: 'A stylistic primary-scanner rewrite that should not replace the focused decision.' },
        ] });
    };
    await globalThis.NPCState.scan();
    await sleep(80);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').relationshipSummary, betrayalSummary, 'routine focused evaluation should preserve an accurate relationship summary exactly');

    // Major/extreme malformed output that omits the required prose summary must still not leave
    // a clearly stale Relationship field behind. The focused reason is used as a conservative fallback.
    const beforeFallbackSummary = state.npcs.find(n => n.name === 'Yunyun').relationshipSummary;
    mockState.context.chat[1].mes += ' Immediately after the betrayal, Kazuma risks his life to save Yunyun, forcing her to profoundly reassess him.';
    mockState.quietResponder = async (args = {}) => {
        const systemPrompt = String(args.systemPrompt || '');
        if (/isolated relationship evaluator/i.test(systemPrompt)) {
            return JSON.stringify({ npcs: [
                { id: yunyunBeforeRepair.id, relationshipImpact: 'extreme', relationshipDelta: { trust: 18, affection: 0, desire: 0, tension: 0 }, relationshipEvidence: { trust: 'Kazuma risked his life to save Yunyun, forcing her to reassess whether she can trust him.', affection: '', desire: '', tension: '' }, relationshipChangeReason: 'Kazuma risked his life to save Yunyun immediately after the betrayal, forcing a profound reassessment.' },
            ] });
        }
        return JSON.stringify({ npcs: [
            { id: yunyunBeforeRepair.id, present: true, worldActive: false, relationshipSummary: beforeFallbackSummary },
        ] });
    };
    await globalThis.NPCState.scan();
    await sleep(80);
    state = globalThis.NPCState.getState();
    const fallbackYunyun = state.npcs.find(n => n.name === 'Yunyun');
    assert.notEqual(fallbackYunyun.relationshipSummary, beforeFallbackSummary, 'major/extreme missing-summary output must not leave stale Relationship prose untouched');
    assert.match(fallbackYunyun.relationshipSummary, /risked his life to save Yunyun/i);

    // Settings-roster clicks are handled in capture phase so host drawer handlers cannot swallow them.
    const yunyunForEditor = state.npcs.find(n => n.name === 'Yunyun');
    const fakeRosterButton = {
        dataset: { npcId: yunyunForEditor.id },
        matches(selector) { return String(selector).includes('.npc-state-roster-edit'); },
        closest(selector) { return this.matches(selector) ? this : null; },
    };
    emitDocumentEvent('pointerup', {
        type: 'pointerup',
        target: fakeRosterButton,
        composedPath: () => [fakeRosterButton],
        preventDefault() {},
        stopImmediatePropagation() {},
        stopPropagation() {},
    });
    assert.equal(globalThis.NPCState.uiStatus().editorMounted, true, 'pointerup roster edit should mount the dossier editor');
    assert.equal(globalThis.NPCState.uiStatus().editorMode, 'sillytavern-popup');
    assert.equal(mockState.popupCalls.at(-1)?.options?.large, true);
    assert.equal(mockState.popupCalls.at(-1)?.options?.allowVerticalScrolling, true);
    const livePrompt = [...mockState.prompts].reverse().find(args => String(args?.[1] || '').includes('NPC STATE DOSSIER'))?.[1] || '';
    assert.match(livePrompt, /Runtime custom behavior rubric/);
    assert.match(livePrompt, /species\/race: Crimson Demon/);
    assert.match(livePrompt, /age: 18/);
    assert.doesNotMatch(livePrompt, /current thoughts/i);
    assert.match(livePrompt, /personality: proud but earnest/);
    assert.match(livePrompt, /established speech: formal when nervous/);
    assert.match(livePrompt, /PLAYER RELATIONSHIP \(secondary modifier\):/);
    assert.match(livePrompt, /Yunyun/);
    assert.doesNotMatch(livePrompt, /- Wiz:/, 'off-screen NPC must not be injected into generation');

    // Next scene flips presence. Visible NPC State follows only the newest present cast; historical
    // snapshots remain stored internally for branch rollback but disappear from the visible pane.
    mockState.quietResponder = async () => JSON.stringify({ npcs: [
        { name: 'Yunyun', present: false, location: 'Axel guild' },
        { name: 'Wiz', present: true, mood: 'concerned', location: 'Wiz\'s shop' },
    ] });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', mes: 'At Wiz\'s shop, Wiz looks up from the counter.', swipe_id: 0 });
    eventSource.emit('message_received', 2);
    await sleep(320);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').present, false);
    assert.equal(state.npcs.find(n => n.name === 'Wiz').present, true);
    assert.equal(inlineAnchors.length, 1, 'only the latest scene should keep a visible present-cast roster');
    assert.equal(inlineAnchors[0].dataset.npcStateMessageId, '2');
    assert.match(inlineAnchors[0].innerHTML, /Wiz/);
    assert.doesNotMatch(inlineAnchors[0].innerHTML, /Yunyun/);

    // Deleting the latest turn rolls back to the surviving branch checkpoint and restores presence.
    mockState.context.chat.length = 2;
    eventSource.emit('message_deleted', 2);
    await sleep(320);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').present, true);
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').age, '18');
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').species, 'Crimson Demon');
    assert.match(state.npcs.find(n => n.name === 'Yunyun').appearance, /crimson eyes/);
    assert.equal('thoughts' in state.npcs.find(n => n.name === 'Yunyun'), false);
    assert.equal(state.npcs.find(n => n.name === 'Wiz').present, false);
    assert.equal(state.inlineCards.some(entry => entry.messageId === 2), true, 'inactive sibling inline snapshot stays stored for exact branch revisit');
    assert.equal(inlineAnchors.length, 1, 'rollback should remount one live present-cast roster');
    assert.equal(inlineAnchors[0].dataset.npcStateMessageId, '1');
    assert.match(inlineAnchors[0].innerHTML, /Yunyun/);

    // Settings delete uses the dossier ID, hard-deletes the exact entry, and suppresses automatic rediscovery.
    const wizIdForDelete = state.npcs.find(n => n.name === 'Wiz').id;
    assert.equal(globalThis.NPCState.deleteNpc(wizIdForDelete), true);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.some(n => n.name === 'Wiz'), false);
    assert.ok(state.userDismissedGroups.some(group => group.ids?.includes(wizIdForDelete)), 'settings delete should suppress immediate scanner rediscovery by stable ID');
    assert.ok(!state.dismissed.includes('wiz'), 'modern ID tombstones must not globally suppress future same-name NPCs');

    // Manual archive preserves Yunyun but immediately removes her from live injection; restore is reversible.
    const yunyunId = state.npcs.find(n => n.name === 'Yunyun').id;
    assert.equal(globalThis.NPCState.archive(yunyunId), true);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').archived, true);
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').present, false);
    const promptAfterArchive = [...mockState.prompts].reverse().find(args => args?.[0] === 'npc_state_live_dossier')?.[1] || '';
    assert.doesNotMatch(promptAfterArchive, /- Yunyun:/);
    assert.equal(globalThis.NPCState.restore(yunyunId), true);
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.name === 'Yunyun').archived, false);

    // A scan generated against an older dossier revision must not overwrite a manual edit
    // made while the model call is pending, even when the chat lineage itself is unchanged.
    let resolveStateStale;
    mockState.quietResponder = () => new Promise(resolve => { resolveStateStale = resolve; });
    const stateStaleScan = globalThis.NPCState.scan();
    await sleep(15);
    assert.equal(globalThis.NPCState.archive(yunyunId), true);
    resolveStateStale(JSON.stringify({ npcs: [{ id: yunyunId, name: 'Yunyun', present: true, mood: 'STALE MODEL MOOD' }] }));
    await stateStaleScan;
    state = globalThis.NPCState.getState();
    assert.equal(state.npcs.find(n => n.id === yunyunId).archived, true, 'manual dossier mutation must win over an older in-flight scan');
    assert.notEqual(state.npcs.find(n => n.id === yunyunId).mood, 'STALE MODEL MOOD');
    assert.equal(globalThis.NPCState.restore(yunyunId), true);

    // Stale scan after a swipe/branch change must not write into the new branch.
    let resolveQuiet;
    mockState.quietResponder = () => new Promise(resolve => { resolveQuiet = resolve; });
    const staleScan = globalThis.NPCState.scan();
    await sleep(15);
    mockState.context.chat[1] = { is_user: false, is_system: false, name: 'Megumin', mes: 'A different branch entirely.', swipe_id: 1 };
    resolveQuiet('{"npcs":[{"name":"Luna","present":true}]}');
    await staleScan;
    assert.equal(globalThis.NPCState.getState().npcs.some(n => n.name === 'Luna'), false);

    // Removing an NPC purges its historical inline cards and persists the removal.
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: remove Yunyun)' });
    eventSource.emit('message_sent', 2);
    await sleep(30);
    assert.equal(globalThis.NPCState.getState().npcs.some(n => n.name === 'Yunyun'), false);
    assert.equal(globalThis.NPCState.getState().inlineCards.some(entry => entry.cards.some(card => card.name === 'Yunyun')), false);
    await globalThis.NPCState.flush();

    // Megumin World State / Inner Chatter details must remain available to two targeted OOC backfills.
    // The responder deliberately returns an empty array if jsonSchema is supplied, simulating a
    // provider whose structured-output handling rejects/overconstrains the old generic object schema.
    mockState.context.chat.push({
        is_user: false, is_system: false, name: 'Megumin', swipe_id: 0,
        mes: 'The two receptionists stack the forms. <details><summary>📌 <b>World State</b></summary><b>Myla (Senior Receptionist):</b> Working the Bluewatch guild desk, calm and methodical.<br><b>Toris (Receptionist):</b> Sorting contract ledgers beside her, tired but attentive.</details><details><summary>💭 <b>NPC Inner Chatter</b></summary>Myla: I need to finish the audit before noon.<br>Toris: I still have three ledgers to finish.</details>',
    });
    const backfillStoryId = mockState.context.chat.length - 1;
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: add Myla; add Toris)' });
    const multiOocId = mockState.context.chat.length - 1;
    eventSource.emit('message_sent', multiOocId);
    await sleep(20);
    mockState.quietResponder = async (args = {}) => {
        if (args.jsonSchema) return '{"npcs":[]}';
        const prompt = String(args.prompt || '');
        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Myla/i.test(prompt)) {
            assert.match(prompt, /World State:\s*Myla/i, 'Myla backfill prompt must preserve World State evidence');
            assert.match(prompt, /NPC Inner Chatter:.*Myla/i, 'Myla backfill prompt must preserve Inner Chatter evidence');
            return JSON.stringify({ npcs: [{
                name: 'Myla', role: 'Senior Receptionist', identityKind: 'proper_name', dossierSignal: 'incidental',
                location: 'Bluewatch guild desk', mood: 'calm and methodical', background: 'Works the Bluewatch guild desk.', present: true,
                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Toris/i.test(prompt)) {
            assert.match(prompt, /World State:.*Toris/i, 'Toris backfill prompt must preserve World State evidence');
            assert.match(prompt, /NPC Inner Chatter:.*Toris/i, 'Toris backfill prompt must preserve Inner Chatter evidence');
            return JSON.stringify({ npcs: [{
                name: 'Toris Vale', aliases: ['Toris'], role: 'Guild Receptionist', identityKind: 'proper_name', dossierSignal: 'incidental',
                location: 'Bluewatch guild desk', mood: 'tired but attentive', background: 'Works the Bluewatch guild desk.', present: true,
                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        return '{"npcs":[]}';
    };
    await globalThis.NPCState.processBackfills(backfillStoryId);
    state = globalThis.NPCState.getState();
    const myla = state.npcs.find(n => n.name === 'Myla');
    const toris = state.npcs.find(n => n.name === 'Toris Vale');
    assert.ok(myla, 'first target in a semicolon OOC add should backfill');
    assert.ok(toris, 'second target in a semicolon OOC add should backfill');
    assert.equal(myla.role, 'Senior Receptionist');
    assert.equal(toris.role, 'Guild Receptionist');
    assert.equal(state.pendingBackfills.length, 0);
    const backfillInline = state.inlineCards.find(entry => entry.messageId === backfillStoryId);
    assert.ok(backfillInline, 'present manually backfilled NPCs should create an inline snapshot under the latest assistant scene');
    assert.deepEqual(backfillInline.cards.map(card => card.name).sort(), ['Myla', 'Toris Vale']);
    const latestBackfillCalls = mockState.rawCalls.filter(call => /targeted dossier backfill extractor/i.test(String(call?.[0]?.prompt || '')));
    assert.ok(latestBackfillCalls.length >= 2);
    assert.ok(latestBackfillCalls.every(call => !('jsonSchema' in (call?.[0] || {}))), 'real backfill calls should omit structured-output schemas');

    // Truncated Gemini-style JSON must trigger one compact retry instead of surfacing an
    // "Unterminated string" failure. This covers the real backfill failure reported on mobile.
    mockState.context.chat.push({
        is_user: false, is_system: false, name: 'Megumin', swipe_id: 0,
        mes: 'Neris, the guild records clerk, closes a ledger. <details><summary>📌 <b>World State</b></summary><b>Neris (Records Clerk):</b> At the Bluewatch guild archive desk, organizing contract files.</details>',
    });
    const truncStoryId = mockState.context.chat.length - 1;
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: add Neris)' });
    const truncOocId = mockState.context.chat.length - 1;
    eventSource.emit('message_sent', truncOocId);
    await sleep(20);
    let nerisBackfillAttempt = 0;
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Neris/i.test(prompt)) {
            nerisBackfillAttempt += 1;
            if (nerisBackfillAttempt === 1) {
                return '{"npcs":[{"name":"Neris","role":"Records Clerk","appearance":"Young woman with dark';
            }
            assert.match(prompt, /CRITICAL COMPACT JSON RETRY/i, 'retry must explicitly request compact complete JSON');
            assert.equal(args.responseLength, 5200, 'truncation retry should receive a larger output ceiling');
            return JSON.stringify({ npcs: [{
                name: 'Neris', role: 'Records Clerk', identityKind: 'proper_name', dossierSignal: 'incidental',
                location: 'Bluewatch guild archive desk', appearance: 'Young woman working among the contract ledgers.',
                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        return '{"npcs":[]}';
    };
    const callsBeforeTruncationRetry = mockState.rawCalls.length;
    await globalThis.NPCState.processBackfills(truncStoryId);
    state = globalThis.NPCState.getState();
    const neris = state.npcs.find(n => n.name === 'Neris');
    assert.ok(neris, 'truncated first backfill response should recover on retry');
    assert.equal(neris.role, 'Records Clerk');
    assert.equal(nerisBackfillAttempt, 2, 'backfill should retry exactly once after truncation');
    const retryCalls = mockState.rawCalls.slice(callsBeforeTruncationRetry).map(call => call?.[0] || {});
    assert.equal(retryCalls.length, 2, 'truncated backfill should use exactly two raw calls');
    assert.equal(retryCalls[0].responseLength, 3200);
    assert.equal(retryCalls[1].responseLength, 5200);

    // Automatic Conservative scanning uses the same truncation guard. A properly named NPC
    // should still be admitted after the first JSON response is cut off mid-string.
    let autoRetryAttempt = 0;
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/private NPC dossier scanner/i.test(prompt) && /Liora/i.test(prompt)) {
            autoRetryAttempt += 1;
            if (autoRetryAttempt === 1) return '{"npcs":[{"name":"Liora","identityKind":"proper_name","role":"Courier","appearance":"Red-haired';
            assert.match(prompt, /CRITICAL COMPACT JSON RETRY/i);
            assert.equal(args.responseLength, 5200);
            return JSON.stringify({ npcs: [{
                name: 'Liora', identityKind: 'proper_name', dossierSignal: 'incidental', role: 'Courier', present: true,
                appearance: 'Red-haired human courier in a rain-dark cloak.', relationshipImpact: 'none',
                relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        return '{"npcs":[]}';
    };
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'I ask Liora the courier whether the northern road is open.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Liora shakes rain from her red hair and answers that the northern road is open.' });
    const autoRetryMessageId = mockState.context.chat.length - 1;
    await globalThis.NPCState.scan();
    state = globalThis.NPCState.getState();
    assert.ok(state.npcs.some(n => n.name === 'Liora'), 'Conservative scan should admit proper-name NPC after truncation retry');
    const lioraInline = state.inlineCards.find(entry => entry.messageId === autoRetryMessageId);
    assert.ok(lioraInline?.cards.some(card => card.name === 'Liora'), 'if merged state marks Liora present, the same scan must record her inline card');
    assert.equal(autoRetryAttempt, 2, 'automatic/manual scanner path should retry exactly once after truncation');

    // Non-truncation structural JSON errors also get one clean correction retry. Local separator
    // repair handles missing commas without a second call; this invalid literal forces the fallback.
    let malformedRetryAttempt = 0;
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/private NPC dossier scanner/i.test(prompt) && /Mave/i.test(prompt)) {
            malformedRetryAttempt += 1;
            if (malformedRetryAttempt === 1) return '{"npcs":[{"name":"Mave","identityKind":"proper_name","present":tru}]}';
            assert.match(prompt, /CRITICAL COMPACT JSON RETRY/i);
            assert.match(prompt, /previous response was not valid JSON/i);
            assert.equal(args.responseLength, 5200);
            return JSON.stringify({ npcs: [{
                name: 'Mave', identityKind: 'proper_name', dossierSignal: 'incidental', role: 'Stable Runner', present: true,
                relationshipImpact: 'none', relationshipDelta: {},
            }] });
        }
        return '{"npcs":[]}';
    };
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'I ask Mave whether the horses are ready.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Mave nods and checks the stable door.' });
    await globalThis.NPCState.scan();
    state = globalThis.NPCState.getState();
    assert.ok(state.npcs.some(n => n.name === 'Mave'), 'generic malformed JSON should recover through one correction retry');
    assert.equal(malformedRetryAttempt, 2, 'generic malformed scanner JSON should retry exactly once');

    // A scan may finish before SillyTavern inserts the assistant message DOM. The rendered-message
    // lifecycle event must mount the already-recorded inline card once the host node exists.
    mockState.quietResponder = async () => JSON.stringify({ npcs: [{
        name: 'Liora', id: globalThis.NPCState.getState().npcs.find(n => n.name === 'Liora')?.id, present: true, role: 'Courier',
        identityKind: 'proper_name', dossierSignal: 'incidental', relationshipImpact: 'none',
        relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] });
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'I nod to Liora again.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Liora waits beside the door.' });
    const lateDomMessageId = mockState.context.chat.length - 1;
    mockState.messageDomReady = false;
    await globalThis.NPCState.scan();
    state = globalThis.NPCState.getState();
    assert.ok(state.inlineCards.find(entry => entry.messageId === lateDomMessageId)?.cards.some(card => card.name === 'Liora'), 'scan should record card state even if DOM is late');
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId)), false, 'card cannot mount before host message DOM exists');
    mockState.messageDomReady = true;
    eventSource.emit('character_message_rendered', lateDomMessageId);
    await sleep(120);
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId)), true, 'render lifecycle event should mount delayed inline card');

    // Host/mobile redraws can remove extension siblings after the render event. The chat
    // MutationObserver must notice the missing anchor and restore it without another scan.
    const redrawnAnchor = inlineAnchors.find(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId));
    redrawnAnchor?.remove?.();
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId)), false, 'simulated host redraw should remove the card anchor');
    assert.ok(mutationObservers.some(observer => observer.target === chatRoot), 'inline MutationObserver should be attached to #chat');
    mutationObservers.find(observer => observer.target === chatRoot)?.trigger();
    await sleep(100);
    assert.equal(inlineAnchors.some(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId)), true, 'chat mutation should self-heal a removed inline card');

    // Reconciliation is idempotent: rendering again must not duplicate the same message anchor.
    globalThis.NPCState.renderInline();
    globalThis.NPCState.renderInline();
    assert.equal(inlineAnchors.filter(anchor => anchor.dataset.npcStateMessageId === String(lateDomMessageId)).length, 1, 'inline reconciliation should never duplicate an existing card anchor');

    // SillyTavern 1.18 emits MESSAGE_SWIPED before it starts Generate('swipe'). NPC State
    // must not launch generateRaw in that pre-generation window or it can steal the host request.
    const rawCallsBeforeSwipe = mockState.rawCalls.length;
    mockState.quietResponder = async () => '{"npcs":[]}';
    mockState.context.chat[lateDomMessageId] = {
        is_user: false, is_system: false, name: 'Megumin', swipe_id: 1,
        mes: 'On the alternate swipe, Liora steps away from the door and says nothing.',
    };
    mockState.swipeState = 'swiping';
    eventSource.emit('message_swiped', lateDomMessageId);
    await sleep(180);
    assert.equal(mockState.rawCalls.length, rawCallsBeforeSwipe, 'MESSAGE_SWIPED must never start dossier generation while host swipeState=swiping');
    assert.equal(globalThis.NPCState.uiStatus().swipeSettlementPending, true, 'swipe should be held for settled reconciliation');

    // Some providers emit MESSAGE_RECEIVED before SillyTavern clears swipeState. That must
    // also be deferred, otherwise auto-scan can still collide with the active swipe request.
    eventSource.emit('message_received', lateDomMessageId);
    await sleep(180);
    assert.equal(mockState.rawCalls.length, rawCallsBeforeSwipe, 'MESSAGE_RECEIVED during a swipe must not start dossier generation');

    mockState.swipeState = 'none';
    await sleep(420);
    assert.equal(mockState.rawCalls.length, rawCallsBeforeSwipe + 1, 'settled replacement should receive exactly one deferred dossier scan');
    assert.equal(globalThis.NPCState.uiStatus().swipeSettlementPending, false, 'settlement queue should clear after host swipe becomes idle');

    // Explicit per-NPC dossier import reads Megumin's structured New_NPC / NPC_Update blocks
    // without treating them as automatic story evidence or manufacturing player relationship scores.
    mockState.context.chat.push({
        is_user: false, is_system: false, name: 'Megumin', swipe_id: 0,
        mes: `<Blocks>\n<New_NPC name="Luna">\n**Name:** Luna | **Age:** 24\n**Role:** Guild archivist\n**Where to Find Them:** Bluewatch archive\n**Voice:** Clipped, formal, and precise.\n**Inner Circle:**\n* Mara — younger sister | fiercely protective\n* Dain — old rival | grudging respect\n**Read on the PC:** Wary but curious.\n</New_NPC>\n</Blocks>`,
    });
    const lunaDossierMessageId = mockState.context.chat.length - 1;
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: add Luna)' });
    const lunaAddMessageId = mockState.context.chat.length - 1;
    eventSource.emit('message_sent', lunaAddMessageId);
    await sleep(20);
    assert.ok(globalThis.NPCState.getState().npcs.some(n => n.name === 'Luna'));
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/explicit DOSSIER IMPORT/i.test(prompt) && /Requested NPC: Luna/i.test(prompt)) {
            assert.match(prompt, /<New_NPC name="Luna">/);
            assert.match(prompt, /Mara — younger sister/);
            assert.match(prompt, /Where to Find Them.*NOT current Location/i);
            assert.match(prompt, /Never invent numeric Trust\/Affection\/Desire\/Tension/i);
            return JSON.stringify({ npcs: [{
                name: 'Luna', age: '24', role: 'Guild archivist', speech: 'Clipped, formal, and precise.',
                keyRelationships: ['Mara — younger sister | fiercely protective', 'Dain — old rival | grudging respect'],
                relationshipSummary: 'Wary but curious about Kazuma.',
                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            }] });
        }
        return '{"npcs":[]}';
    };
    const relationshipBeforeLunaImport = { ...globalThis.NPCState.getState().npcs.find(n => n.name === 'Luna').relationship };
    const importedLuna = await globalThis.NPCState.scanDossier('Luna');
    assert.equal(importedLuna, true, 'per-NPC scanDossier should import matching Megumin dossier blocks');
    state = globalThis.NPCState.getState();
    const luna = state.npcs.find(n => n.name === 'Luna');
    assert.equal(luna.age, '24');
    assert.equal(luna.speech, 'Clipped, formal, and precise.');
    assert.deepEqual(luna.keyRelationships, ['Mara — younger sister | fiercely protective', 'Dain — old rival | grudging respect']);
    assert.equal(luna.location, '', 'Where to Find Them must not be misused as live Location');
    assert.deepEqual(luna.relationship, relationshipBeforeLunaImport, 'dossier import must not manufacture numeric player relationship changes');
    const dossierImportCalls = mockState.rawCalls.map(call => call?.[0] || {}).filter(args => /structured dossier importer/i.test(String(args.systemPrompt || '')));
    assert.ok(dossierImportCalls.length >= 1);
    assert.equal(dossierImportCalls.at(-1).responseLength, 3200);
    assert.equal('jsonSchema' in dossierImportCalls.at(-1), false);

    // Explicit social facts must update Key Relationships even when the model returns no NPC
    // delta object at all. This exercises the local current-exchange fallback and top-level edge merge.
    mockState.quietResponder = async () => '{"npcs":[]}';
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'Who is Tessa to Luna?' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: "Tessa is Luna's cousin. They grew up in neighboring households. Luna is reserved, shows dry humor with trusted colleagues, and consistently uses careful honorifics while speaking in a clipped, formal, precise manner." });
    await globalThis.NPCState.scan();
    state = globalThis.NPCState.getState();
    const lunaAfterExplicitTie = state.npcs.find(n => n.name === 'Luna');
    assert.ok(lunaAfterExplicitTie.keyRelationships.some(entry => /Tessa — cousin/i.test(entry)), 'explicit relationship statement must survive even when scanner JSON omits the NPC entirely');

    // Per-NPC Refresh from Chat re-reads the configured history window and reconciles the
    // dossier without replaying relationship deltas or pretending the NPC was newly present.
    const lunaBeforeRefresh = structuredClone(globalThis.NPCState.getState().npcs.find(n => n.name === 'Luna'));
    mockState.quietResponder = async (args = {}) => {
        const prompt = String(args.prompt || '');
        if (/TARGETED REFRESH FROM CHAT/i.test(prompt) && /Target NPC: Luna/i.test(prompt)) {
            assert.match(prompt, /currentRelationship is READ-ONLY/i);
            assert.match(prompt, /Presence\/recency are owned by the live scanner/i);
            assert.match(prompt, /recent-story window/i);
            return JSON.stringify({
                npcs: [{
                    id: lunaBeforeRefresh.id, name: 'Luna', role: 'Senior guild archivist',
                    mood: 'Quietly focused', location: 'Bluewatch archive',
                    relationshipSummary: 'Wary but increasingly comfortable around Kazuma.',
                    relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
                    present: true, worldActive: true,
                }],
                profileUpdates: [{
                    id: lunaBeforeRefresh.id,
                    evidence: { speech: ['consistently uses careful honorifics'], personality: ['shows dry humor with trusted colleagues'] },
                    personalityState: 'refine', personality: 'Reserved; shows dry humor with trusted colleagues.',
                    speechState: 'refine', speech: 'Clipped, formal, and precise; consistently uses careful honorifics.',
                }],
                keyRelationshipEdges: [],
            });
        }
        return '{"npcs":[]}';
    };
    const refreshedLuna = await globalThis.NPCState.refreshFromChat('Luna');
    assert.equal(refreshedLuna, true, 'per-NPC Refresh from Chat should complete');
    state = globalThis.NPCState.getState();
    const lunaAfterRefresh = state.npcs.find(n => n.name === 'Luna');
    assert.match(lunaAfterRefresh.personality, /dry humor/i);
    assert.match(lunaAfterRefresh.speech, /honorifics/i);
    assert.equal(lunaAfterRefresh.role, 'Senior guild archivist');
    assert.equal(lunaAfterRefresh.mood, 'Quietly focused');
    assert.equal(lunaAfterRefresh.location, 'Bluewatch archive');
    assert.deepEqual(lunaAfterRefresh.relationship, lunaBeforeRefresh.relationship, 'history refresh must never replay numeric relationship deltas');
    assert.equal(lunaAfterRefresh.present, lunaBeforeRefresh.present, 'history refresh must preserve live presence');
    assert.equal(lunaAfterRefresh.worldActive, lunaBeforeRefresh.worldActive, 'history refresh must preserve current off-screen activity');
    assert.equal(lunaAfterRefresh.seenCount, lunaBeforeRefresh.seenCount, 'history refresh must not increment seen count');
    assert.equal(lunaAfterRefresh.lastSeenTurn, lunaBeforeRefresh.lastSeenTurn, 'history refresh must not rewrite recency');
    assert.equal(globalThis.NPCState.scanMetrics()?.label, 'targeted-refresh');

    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: '(OOC: NPC State: remove Luna)' });
    const lunaRemoveMessageId = mockState.context.chat.length - 1;
    eventSource.emit('message_sent', lunaRemoveMessageId);
    await sleep(20);
    assert.equal(globalThis.NPCState.getState().npcs.some(n => n.name === 'Luna'), false, 'test cleanup should remove imported Luna');
    assert.equal(globalThis.NPCState.getState().pendingBackfills.some(item => item.label === 'Luna'), false, 'removal should also clear the queued OOC backfill');

    // Optional full-scan mode must use the configured rolling window every assistant turn,
    // even when the quick-scan cadence would not otherwise be due. Relationship scoring is
    // explicitly isolated to the newest exchange inside that wider reconciliation prompt.
    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;
    mockState.extensionSettings.npc_state.scanEvery = 20;
    mockState.extensionSettings.npc_state.scanDepth = 4;
    const fullScanTarget = globalThis.NPCState.getState().npcs.find(n => !n.archived);
    assert.ok(fullScanTarget, 'runtime should retain at least one active dossier for full-scan validation');
    const relationshipBeforeFullScan = structuredClone(fullScanTarget.relationship);
    mockState.quietResponder = async (args = {}) => {
        if (/relationship evaluator/i.test(String(args.systemPrompt || ''))) {
            return JSON.stringify({ npcs: [{
                id: fullScanTarget.id,
                relationshipImpact: 'none',
                relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
                relationshipSummary: fullScanTarget.relationshipSummary || '',
                relationshipChangeReason: '',
            }] });
        }
        return JSON.stringify({ npcs: [{
            id: fullScanTarget.id, name: fullScanTarget.name, present: true,
            relationshipImpact: 'extreme', relationshipDelta: { trust: 25, affection: 25, desire: 25, tension: -25 },
            relationshipChangeReason: 'OLD WINDOW EVENT THAT MUST NOT REPLAY',
        }], profileUpdates: [], keyRelationshipEdges: [] });
    };
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'FULL-HISTORY-MARKER: The tracked NPC consistently uses ceremonial honorifics.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', mes: `${fullScanTarget.name} answers quietly.`, swipe_id: 0 });
    const firstFullScanMessageId = mockState.context.chat.length - 1;
    eventSource.emit('message_received', firstFullScanMessageId);
    await sleep(220);
    const callsAfterFirstFullScan = mockState.rawCalls.length;
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'What happens next?' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', mes: `${fullScanTarget.name} waits beside the doorway.`, swipe_id: 0 });
    const secondFullScanMessageId = mockState.context.chat.length - 1;
    eventSource.emit('message_received', secondFullScanMessageId);
    await sleep(220);
    assert.ok(mockState.rawCalls.length > callsAfterFirstFullScan, 'full scan every turn should override a Scan every 20 cadence');
    const fullScanArgs = [...mockState.rawCalls].reverse().map(call => call?.[0] || {}).find(args => /automatic full dossier scan/i.test(String(args?.label || '')) || (/isolated dossier scanner/i.test(String(args.systemPrompt || '')) && /FULL-WINDOW RECONCILIATION/.test(String(args.prompt || '')))) || {};
    assert.equal(fullScanArgs.responseLength, 3200, 'full auto scan should receive the larger response budget');
    assert.match(String(fullScanArgs.prompt || ''), /FULL-HISTORY-MARKER/, 'full auto scan should retain earlier messages inside the configured history window');
    assert.match(String(fullScanArgs.prompt || ''), /CURRENT exchange \(authoritative for presence\/live state and numeric relationship deltas\)/);
    assert.match(String(fullScanArgs.prompt || ''), /Kazuma: What happens next\?[\s\S]*waits beside the doorway\./);
    assert.equal(globalThis.NPCState.scanMetrics()?.label, 'automatic-full');
    assert.deepEqual(globalThis.NPCState.getState().npcs.find(n => n.id === fullScanTarget.id).relationship, relationshipBeforeFullScan, 'full-window scans must not replay numeric relationship deltas from older history');
    assert.equal(globalThis.NPCState.scanMetrics()?.relationshipPass, true, 'full-window existing-NPC relationship scoring should be revalidated against only the current exchange');


    // Persistence is version-aware: a mutation made while the first upload is in
    // flight must trigger a second snapshot instead of being falsely marked saved.
    const persistenceTarget = globalThis.NPCState.getState().npcs.find(n => !n.archived);
    assert.ok(persistenceTarget, 'runtime should retain an NPC for persistence race validation');
    let releaseUpload;
    let markUploadEntered;
    const uploadEntered = new Promise(resolve => { markUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markUploadEntered,
        promise: new Promise(resolve => { releaseUpload = resolve; }),
    };
    const uploadsBeforeRace = mockState.uploadCalls;
    // v0.2.17 starts high-value user mutations immediately. Install the barrier before
    // the archive so the test blocks that first critical write, then mutates again while
    // it is in flight and verifies the writer loops to a newer snapshot.
    globalThis.NPCState.archive(persistenceTarget.id);
    await uploadEntered;
    const racingFlush = globalThis.NPCState.flush();
    globalThis.NPCState.restore(persistenceTarget.id);
    releaseUpload();
    await racingFlush;
    await globalThis.NPCState.flush();
    assert.ok(mockState.uploadCalls >= uploadsBeforeRace + 2, 'an in-flight critical mutation should produce a follow-up sidecar write');
    const racePointer = globalThis.NPCState.dataFile();
    const persistedAfterRace = JSON.parse(mockState.files.get(racePointer.path));
    assert.equal(persistedAfterRace.state.npcs.find(n => n.id === persistenceTarget.id).archived, false, 'latest in-memory state must win the write race');

    // Whole-chat deletion waits for an in-flight write before removing the pointer,
    // so the completed upload cannot resurrect a deleted chat sidecar.
    let releaseDeleteUpload;
    let markDeleteUploadEntered;
    const deleteUploadEntered = new Promise(resolve => { markDeleteUploadEntered = resolve; });
    mockState.uploadBarrier = {
        entered: markDeleteUploadEntered,
        promise: new Promise(resolve => { releaseDeleteUpload = resolve; }),
    };
    globalThis.NPCState.archive(persistenceTarget.id);
    const pendingDeleteWrite = globalThis.NPCState.flush();
    await deleteUploadEntered;
    const deletedPointer = globalThis.NPCState.dataFile();
    eventSource.emit('chat_deleted', 'smoke-chat');
    releaseDeleteUpload();
    await pendingDeleteWrite;
    await sleep(100);
    assert.equal(mockState.extensionSettings.npc_state.dataFiles['chat:megumin.png:smoke-chat'], undefined);
    assert.equal(mockState.files.has(deletedPointer.path), false);

    // SillyTavern exposes both groupId and the active group chat_id as chatId. Group identity must win.
    mockState.context.groupId = 'party-1';
    mockState.context.chatId = 'group-chat-1';
    mockState.context.getCurrentChatId = () => 'group-chat-1';
    mockState.context.chat = [{ is_user: false, is_system: false, name: 'Megumin', mes: 'Group opening.' }, { is_user: true, is_system: false, name: 'Kazuma', mes: 'We enter together.' }];
    eventSource.emit('chat_changed');
    await sleep(80);
    assert.equal(globalThis.NPCState.uiStatus().chatKey, 'group:party-1:group-chat-1', 'group identity must include both group owner and active group chat id');

    // Two character cards may legitimately use the same chat filename. Their durable namespaces must never collide.
    mockState.context.groupId = null;
    mockState.context.characters = [{ name: 'Megumin', avatar: 'megumin.png' }, { name: 'Yunyun', avatar: 'yunyun.png' }];
    mockState.context.characterId = 0;
    mockState.context.chatId = 'shared-save';
    mockState.context.getCurrentChatId = () => 'shared-save';
    mockState.context.chat = [{ is_user: false, is_system: false, name: 'Megumin', mes: 'Same opening.' }, { is_user: true, is_system: false, name: 'Kazuma', mes: 'Same reply.' }];
    eventSource.emit('chat_changed');
    await sleep(80);
    const ownerAKey = globalThis.NPCState.uiStatus().chatKey;
    mockState.context.characterId = 1;
    eventSource.emit('chat_changed');
    await sleep(80);
    const ownerBKey = globalThis.NPCState.uiStatus().chatKey;
    assert.equal(ownerAKey, 'chat:megumin.png:shared-save');
    assert.equal(ownerBKey, 'chat:yunyun.png:shared-save');
    assert.notEqual(ownerAKey, ownerBKey);
    await sleep(120);

    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');
} finally {
    delete globalThis.__npcMock;
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
