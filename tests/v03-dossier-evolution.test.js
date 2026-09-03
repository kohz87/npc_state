import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../v03/index.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../v03/engine.js', import.meta.url), 'utf8');
const scanner = readFileSync(new URL('../v03/scanner.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../v03/ui.js', import.meta.url), 'utf8');

function occurrences(source, pattern) {
    return [...source.matchAll(pattern)].length;
}

test('v0.3.1 settings persist one normalized dossier-limits object', () => {
    assert.match(index, /dossierLimits:\s*\{\s*\.\.\.DOSSIER_LIMIT_DEFAULTS\s*\}/);
    assert.match(index, /settings\.dossierLimits\s*=\s*normalizeDossierLimits\(settings\.dossierLimits\)/);
});

test('settings UI exposes all four dossier evolution working caps', () => {
    for (const id of [
        'npc_state_v3_limit_memories',
        'npc_state_v3_limit_key_relationships',
        'npc_state_v3_limit_mannerisms',
        'npc_state_v3_limit_behavior',
    ]) {
        assert.match(ui, new RegExp(id));
    }
    assert.match(ui, /Lowering a cap does not immediately delete existing entries/);
    assert.match(ui, /bindLimit\('#npc_state_v3_limit_memories',\s*'memories'\)/);
    assert.match(ui, /bindLimit\('#npc_state_v3_limit_key_relationships',\s*'keyRelationships'\)/);
    assert.match(ui, /bindLimit\('#npc_state_v3_limit_mannerisms',\s*'mannerisms'\)/);
    assert.match(ui, /bindLimit\('#npc_state_v3_limit_behavior',\s*'behaviorProfile'\)/);
});

test('manual dossier saves obey current working caps instead of legacy literals', () => {
    assert.match(ui, /behaviorProfile:\s*splitLines\([^\n]+limits\.behaviorProfile\)/);
    assert.match(ui, /mannerisms:\s*splitLines\([^\n]+limits\.mannerisms\)/);
    assert.match(ui, /keyRelationships:\s*splitLines\([^\n]+limits\.keyRelationships\)/);
    assert.match(ui, /memories:\s*splitLines\([^\n]+limits\.memories\)/);
});

test('engine sends dossier limits through normal and targeted prompt/apply paths', () => {
    assert.ok(occurrences(engine, /dossierLimits:\s*settings\.dossierLimits/g) >= 4,
        'normal prompt, normal apply, targeted prompt, and targeted apply must all receive working caps');
});

test('scanner contract uses preserve-on-null authoritative collection replacement semantics', () => {
    assert.match(scanner, /behaviorProfile:\s*null/);
    assert.match(scanner, /mannerisms:\s*null/);
    assert.match(scanner, /keyRelationships:\s*null/);
    assert.match(scanner, /memories:\s*null/);
    assert.match(scanner, /use null when nothing materially changed/i);
    assert.match(scanner, /COMPLETE authoritative replacement set/);
    assert.doesNotMatch(scanner, /next\.memories\s*=\s*appendUnique\(next\.memories/);
    assert.doesNotMatch(scanner, /next\.mannerisms\s*=\s*appendUnique\(next\.mannerisms/);
});
