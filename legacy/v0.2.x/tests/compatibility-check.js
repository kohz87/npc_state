import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const identity = fs.readFileSync(path.join(root, 'identity.js'), 'utf8');
const hardening = fs.readFileSync(path.join(root, 'hardening.js'), 'utf8');
const contextSource = `${index}\n${identity}\n${hardening}`;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const st118Contract = {
    extensionsModule: ['extension_settings', 'getContext'],
    scriptModule: ['extension_prompt_types', 'extension_prompt_roles', 'getRequestHeaders'],
    context: ['chat', 'chatId', 'getCurrentChatId', 'characterId', 'characters', 'groupId', 'saveSettingsDebounced', 'eventSource', 'eventTypes', 'generateRaw', 'setExtensionPrompt', 'Popup', 'POPUP_TYPE', 'POPUP_RESULT', 'swipe'],
    events: ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'CHAT_DELETED', 'CHAT_RENAMED'],
};

assert.equal(manifest.js, 'bootstrap.js');
assert.equal(manifest.css, 'style.css');
assert.equal(manifest.minimum_client_version, '1.18.0');
assert.match(bootstrap, /prepareNpcStateHardening/);
assert.match(bootstrap, /import\('\.\/index\.js'\)/);
assert.match(index, /from '\.\.\/\.\.\/\.\.\/extensions\.js'/);
assert.match(index, /from '\.\.\/\.\.\/\.\.\/\.\.\/script\.js'/);
for (const symbol of [...st118Contract.extensionsModule, ...st118Contract.scriptModule]) {
    assert.match(contextSource, new RegExp(`\\b${symbol}\\b`), `missing API symbol ${symbol}`);
}
for (const symbol of st118Contract.context) {
    assert.match(contextSource, new RegExp(`\\b${symbol}\\b`), `missing context contract symbol ${symbol}`);
}
for (const event of st118Contract.events) {
    assert.match(index, new RegExp(`events\\.${event}`), `missing/changed event ${event}`);
}
for (const event of ['CHARACTER_RENAMED', 'CHARACTER_RENAMED_IN_PAST_CHAT', 'CHARACTER_DELETED']) {
    assert.match(hardening, new RegExp(`events\\.${event}`), `missing lifecycle hardening event ${event}`);
}
assert.match(index, /generateRaw\(\s*\{/s, 'generateRaw should use the SillyTavern 1.18 object-parameter signature');
assert.match(index, /const Popup = ctx\.Popup/);
assert.match(index, /const POPUP_TYPE = ctx\.POPUP_TYPE/);
assert.match(index, /const POPUP_RESULT = ctx\.POPUP_RESULT/);
assert.doesNotMatch(index, /generateQuietPrompt\(\s*\{/s, 'scanner must not use chat-context generateQuietPrompt');
assert.match(index, /encodeNpcStateBundle/, 'binary export integration missing');
assert.match(index, /decodeNpcStateBundle/, 'binary import integration missing');
assert.match(index, /\.npcstate/, 'portable bundle file extension missing');
assert.match(index, /\.mes\[mesid=/, 'inline cards must target SillyTavern message elements by mesid');
assert.match(index, /npc-state-present-card/, 'present-NPC portrait card UI missing');
assert.match(index, /npc-state-viewer-dialog/, 'focused dossier viewer UI missing');
assert.match(index, /reconcileBranchState/, 'branch reconciliation integration missing');
assert.match(index, /getContext\(\)\.swipe\?\.state\?\.\(\)/, 'swipe-safe branch handling must use SillyTavern 1.18 swipe.state()');
assert.match(index, /queueSettledSwipeReconcile/, 'settled swipe reconciliation missing');
assert.doesNotMatch(index, /MESSAGE_SWIPED[\s\S]{0,500}queueBranchReconcile/, 'MESSAGE_SWIPED must not schedule the old immediate branch rescan');
assert.match(index, /recordBranchCheckpoint/, 'branch checkpoint integration missing');
assert.match(index, /writeNpcStateDataFile/, 'extension-owned JSON data-file persistence missing');
assert.match(index, /readNpcStateDataFile/, 'extension-owned JSON data-file loading missing');
assert.match(index, /dataFiles/, 'data-file pointer registry missing');
assert.match(index, /function inlineRosterHtml/, 'present-only roster renderer missing');
assert.match(index, /function openNpcViewer/, 'portrait-card dossier viewer missing');
assert.doesNotMatch(index, /\bnpcBank\b|\blocalProfile\b|from\s+['\"][^'\"]*Megumin|extension_settings\s*\[[^\]]*Megumin-Suite/i, 'standalone build must not import or access Megumin NPC Bank internals');

for (const file of ['bootstrap.js', 'index.js', 'hardening.js', 'hardening-core.js', 'core.js', 'core-v0218.js', 'bundle.js', 'branch.js', 'branch-v0218.js', 'social.js', 'storage.js', 'identity.js', 'style.css', 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

console.log('Compatibility contract: SillyTavern 1.18.0 API/import/event checks passed.');
console.log('Lifecycle hardening contract: owner-wide character rename/delete and historical rebase hooks passed.');
console.log('Isolation check: optional Megumin DOM integration has no Megumin NPC Bank imports/settings dependency.');
console.log('Manifest/layout check: passed.');
