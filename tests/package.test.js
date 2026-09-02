import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('install folder has SillyTavern-discoverable one-level layout', () => {
    assert.equal(path.basename(root), 'npc_state');
    for (const name of [
        'manifest.json', 'bootstrap.js', 'index.js', 'hardening.js', 'hardening-core.js',
        'core.js', 'core-v0218.js', 'bundle.js', 'branch.js', 'branch-v0218.js',
        'social.js', 'storage.js', 'identity.js', 'style.css', 'README.md', 'CHANGELOG.md',
        'CODE-REVIEW.md', 'TEST-REPORT.md',
    ]) {
        assert.ok(fs.existsSync(path.join(root, name)), `${name} must be directly inside npc_state/`);
    }
    assert.equal(fs.existsSync(path.join(root, 'npc_state', 'manifest.json')), false, 'must not contain a second nested npc_state folder');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.display_name, 'NPC State');
    assert.equal(manifest.version, '0.2.22');
    assert.equal(manifest.js, 'bootstrap.js');
});
