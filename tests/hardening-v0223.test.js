import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('v0.2.23 relationship repair targets current-exchange NPCs even when broad scan omits them', () => {
    assert.match(source, /currentExchangeRelationshipRelevant/);
    assert.match(source, /transcriptMentionsNpcRecord\(transcript, npc\)/);
    assert.match(source, /return !raw \|\| !hasCompletePrimaryRelationshipDecision\(raw, transcript\)/);
    assert.match(source, /for \(let offset = 0; offset < targets\.length; offset \+= 4\)/);
    const relationshipPassSource = source.slice(
        source.indexOf('async function runFocusedRelationshipPass'),
        source.indexOf('function prepareFullWindowRelationshipEvaluation'),
    );
    assert.doesNotMatch(relationshipPassSource, /\.slice\(0,\s*4\)/);
});

test('v0.2.23 new NPC admission queues a deep active-cast reconciliation and omitted participants get continuity repair', () => {
    assert.match(source, /deepSweep: true/);
    assert.match(source, /state\.pendingBackfills\.length > 100/);
    assert.match(source, /touchedIds = new Set/);
    assert.match(source, /!transcriptMentionsNpcRecord\(currentTranscript \|\| '', npc\)/);
    assert.match(source, /One failed dossier must not starve the rest of a cast reconciliation sweep/);
});

test('v0.2.23 manual and full-window scans scrub rolling relationship output and evaluate only the current exchange', () => {
    assert.match(source, /const fullWindowRelationship = \(manual \|\| fullWindowScan\)/);
    assert.match(source, /currentExchangeOnly: manual \|\| fullWindowScan/);
    assert.match(source, /if \(currentExchangeOnly\) return false/);
    const relevance = source.slice(
        source.indexOf('function currentExchangeRelationshipRelevant'),
        source.indexOf('function dossierLabelsMatch'),
    );
    assert.doesNotMatch(relevance, /npc\.present \|\| npc\.worldActive/);
});

test('v0.2.23 portrait settings use explicit transactional Save', () => {
    assert.match(source, /id="npc_state_save_portrait_settings"/);
    assert.match(source, /async function savePortraitSettingsDraft/);
    assert.match(source, /await saveHostSettings\(\)/);
    assert.match(source, /Object\.assign\(settings, before\)/);
    assert.match(source, /Unsaved changes/);
    assert.match(source, /Fantasy Anime defaults loaded as an unsaved portrait-settings draft/);
});
