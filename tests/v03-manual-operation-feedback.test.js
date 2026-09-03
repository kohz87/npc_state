import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startManualOperationFeedback, stopManualOperationFeedback } from '../v03/manual-operation-feedback.js';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../v03/manual-operation-feedback.js', import.meta.url), 'utf8');

function fakeButton(kind, npcId = '') {
    const attrs = new Map();
    return {
        dataset: { npcId },
        innerHTML: kind === 'scan'
            ? '<i class="fa-solid fa-wand-magic-sparkles"></i> Scan current cast'
            : '<i class="fa-solid fa-arrows-rotate"></i><span>Refresh</span>',
        disabled: false,
        isConnected: true,
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        setAttribute(name, value) { attrs.set(name, String(value)); },
        removeAttribute(name) { attrs.delete(name); },
        closest(selector) {
            if (kind === 'scan' && selector === '#npc_state_v3_scan_now') return this;
            if (kind === 'refresh' && selector === '.npc-state-v3-refresh') return this;
            return null;
        },
    };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('bootstrap starts manual feedback only after the authoritative v0.3 runtime', () => {
    const runtime = bootstrap.indexOf("await import('./v03/index.js')");
    const feedback = bootstrap.indexOf("await import('./v03/manual-operation-feedback.js')");
    assert.ok(runtime >= 0);
    assert.ok(feedback > runtime);
    assert.match(source, /addEventListener\('click',\s*onDocumentClick,\s*false\)/,
        'feedback must stay in bubble phase so it cannot swallow the real button action');
});

test('manual scan shows persistent progress and restores the button when the engine becomes idle', async () => {
    const previousDocument = globalThis.document;
    const previousNpcState = globalThis.NPCState;
    const previousToastr = globalThis.toastr;
    let clickHandler = null;
    let busy = true;
    let infoMessage = '';
    let infoOptions = null;
    let cleared = false;

    globalThis.document = {
        addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
        removeEventListener(type, handler) { if (type === 'click' && clickHandler === handler) clickHandler = null; },
    };
    globalThis.NPCState = { isBusy: () => busy, getState: () => ({ npcs: [] }) };
    globalThis.toastr = {
        info(message, _title, options) { infoMessage = message; infoOptions = options; return { remove() {} }; },
        clear() { cleared = true; },
    };

    try {
        stopManualOperationFeedback();
        assert.equal(startManualOperationFeedback(), true);
        const button = fakeButton('scan');
        const originalHtml = button.innerHTML;
        clickHandler({ target: button });

        assert.equal(infoMessage, 'NPC State: scanning current cast...');
        assert.equal(infoOptions?.timeOut, 0);
        assert.equal(button.disabled, true);
        assert.equal(button.getAttribute('aria-busy'), 'true');
        assert.match(button.innerHTML, /fa-spinner fa-spin/);
        assert.match(button.innerHTML, /Scanning\.\.\./);

        await sleep(90);
        busy = false;
        await sleep(150);

        assert.equal(cleared, true);
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute('aria-busy'), null);
        assert.equal(button.innerHTML, originalHtml);
    } finally {
        stopManualOperationFeedback();
        globalThis.document = previousDocument;
        globalThis.NPCState = previousNpcState;
        globalThis.toastr = previousToastr;
    }
});

test('dossier refresh progress names the selected NPC', async () => {
    const previousDocument = globalThis.document;
    const previousNpcState = globalThis.NPCState;
    const previousToastr = globalThis.toastr;
    let clickHandler = null;
    let busy = true;
    let infoMessage = '';

    globalThis.document = {
        addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
        removeEventListener(type, handler) { if (type === 'click' && clickHandler === handler) clickHandler = null; },
    };
    globalThis.NPCState = {
        isBusy: () => busy,
        getState: () => ({ npcs: [{ id: 'astra', name: 'Astra' }] }),
    };
    globalThis.toastr = {
        info(message) { infoMessage = message; return { remove() {} }; },
        clear() {},
    };

    try {
        stopManualOperationFeedback();
        startManualOperationFeedback();
        const button = fakeButton('refresh', 'astra');
        clickHandler({ target: button });
        assert.equal(infoMessage, 'NPC State: refreshing Astra dossier...');
        assert.match(button.innerHTML, /Refreshing\.\.\./);
        busy = false;
        await sleep(170);
    } finally {
        stopManualOperationFeedback();
        globalThis.document = previousDocument;
        globalThis.NPCState = previousNpcState;
        globalThis.toastr = previousToastr;
    }
});
