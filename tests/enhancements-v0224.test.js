import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const enhancement = path.join(root, 'enhancements.js');
const source = fs.readFileSync(enhancement, 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');

test('optional full-cast/library enhancement parses and loads after core engine', () => {
    const result = spawnSync(process.execPath, ['--check', enhancement], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(bootstrap, /await import\('\.\/index\.js'\);[\s\S]*await import\('\.\/enhancements\.js'\);/);
});

test('full cast scan is opt-in and targets participation plus physical presence', () => {
    assert.match(source, /fullCastScanEveryTurn/);
    assert.match(source, /if \(npc\.present\) ids\.add\(npc\.id\)/);
    assert.match(source, /participantLabels\(npc, npcs\)/);
    assert.match(source, /before\.get\(npc\.id\) !== fingerprint\(npc\)/);
    assert.match(source, /await npcApi\.refreshFromChat\(id\)/);
    assert.match(source, />Full cast scan</);
});

test('dossier library includes non-present and archived dossiers and direct refresh controls', () => {
    assert.match(source, /Dossier Library/);
    assert.match(source, /including off-screen and archived NPCs/);
    assert.match(source, /npc-state-library-refresh/);
    assert.match(source, /refreshFromChat/);
    assert.match(source, /scanDossier/);
    assert.match(source, /openEditor/);
});

test('v0.2.23 redundant cast-wide backfills are guarded locally', () => {
    assert.match(source, /deepSweep\/silent are dropped by pending-backfill normalization/);
    assert.match(source, /targeted dossier backfill extractor/i);
    assert.match(source, /npc\.manual !== true/);
});
