import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function functionBody(source, signature, nextSignature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} should exist`);
    const end = source.indexOf(nextSignature, start);
    assert.ok(end > start, `${nextSignature} should follow ${signature}`);
    return source.slice(start, end);
}

test('settings migration batches historical changes into one save', () => {
    const body = functionBody(index, 'function getSettings()', '\nfunction getChatKey()');
    assert.equal((body.match(/persistSettings\(\)/g) || []).length, 1);
    assert.match(body, /assign\('schemaVersion', DEFAULTS\.schemaVersion\)/);
    assert.match(body, /if \(dirty\) persistSettings\(\)/);
});

test('sidecar persistence writes immutable snapshots until the latest version is durable', () => {
    const body = functionBody(index, 'async function flushStateFile', '\nfunction persist(');
    assert.match(body, /while \(chatStateCache\.has\(key\) && ownershipEpochCurrent\(key, epoch\)\)/);
    assert.match(body, /const snapshot = structuredClone\(getChatState\(key\)\)/);
    assert.match(body, /persistedVersions\.set\(key, writeVersion\)/);
    assert.doesNotMatch(body, /persistedVersions\.set\(key, Number\(stateVersions/);
    assert.match(body, /if \(Number\(stateVersions\.get\(key\) \|\| 0\) <= writeVersion\) break/);
});

test('recent transcript collection stops after the requested meaningful tail', () => {
    const body = functionBody(index, 'function recentTranscript', '\nfunction currentExchangeTranscript');
    assert.match(body, /for \(let i = chat\.length - 1; i >= 0 && lines\.length < count; i -= 1\)/);
    assert.match(body, /return lines\.reverse\(\)\.join\('\\n'\)/);
    assert.doesNotMatch(body, /\.filter\([\s\S]*\.slice\(-count\)/);
});

test('Megumin dossier import searches newest-first and stops at the latest base', () => {
    const body = functionBody(index, 'export function findMeguminDossierSources', '\nfunction setNpcDossierScanIndicator');
    assert.match(body, /for \(let messageId = chat\.length - 1; messageId >= 0; messageId -= 1\)/);
    assert.match(body, /const latestBase/);
    assert.match(body, /break;/);
    assert.match(body, /chronological\.slice\(-5\)/);
});

test('inline watchdog queries are scoped to the chat root', () => {
    assert.match(index, /cleanupStaleMeguminIntegrations\(desiredIds, root/);
    assert.match(index, /const root = chatElementForInlineObserver\(\) \|\| document/);
    assert.match(index, /root\.querySelectorAll\?\.\('\.npc-state-inline-anchor'\)/);
});

test('retired helper and legacy dossier CSS are absent', () => {
    assert.doesNotMatch(core, /function scannerNpcMentioned/);
    for (const selector of [
        'npc-state-book',
        'npc-state-inline-card',
        'npc-state-inline-layout',
        'npc-state-viewer-columns',
        'npc-state-editor-scroll',
    ]) assert.doesNotMatch(css, new RegExp(`\\.${selector}(?:\\s|\\{|:|\\.)`));
});

test('settings-only UI changes do not rewrite the per-chat sidecar', () => {
    const body = functionBody(index, 'function bindUi()', "\n    $(document).on('click.npcState', '#npc_state_scan_now'");
    assert.match(body, /bindSettingsCheckbox/);
    assert.match(body, /persistSettings\(\)/);
    assert.doesNotMatch(body, /\bpersist\(\)/);
});
