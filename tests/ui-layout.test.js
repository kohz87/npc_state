import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('present NPC pane uses portrait-first cards and a focused dossier viewer', () => {
    assert.match(index, /function inlineRosterHtml/);
    assert.match(index, /class="npc-state-present-grid"/);
    assert.match(index, /class="npc-state-present-card"/);
    assert.match(index, /class="npc-state-present-card-portrait"/);
    assert.match(index, /class="npc-state-present-card-overlay"/);
    assert.doesNotMatch(index, /npc-state-present-card-relation/);
    assert.match(index, /function openNpcViewer/);
    assert.match(index, /overlay\.className = 'npc-state-viewer-overlay'/);
    assert.match(index, /class="npc-state-viewer-dialog"/);
    assert.match(index, /npc-state-viewer-close/);
    assert.match(css, /\.npc-state-present-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(118px, 160px\)\)[^}]*justify-content:\s*start/s);
    assert.match(css, /\.npc-state-present-card\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
    assert.match(css, /\.npc-state-present-card-overlay\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0[^}]*background:\s*linear-gradient/s);
    assert.match(css, /\.npc-state-viewer-overlay\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
});


test('present NPC gallery keeps sparse rosters card-sized on tablet instead of stretching to the block', () => {
    assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1180px\)[\s\S]*?\.npc-state-present-grid \{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(145px, 180px\)\)[^}]*justify-content:\s*start/s);
    assert.doesNotMatch(css, /npc-state-present-grid \{[^}]*repeat\(auto-fit, minmax\(145px, 1fr\)\)/s);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.npc-state-present-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test('focused dossier uses a portrait rail, scrollable document, and bottom command bar', () => {
    for (const title of ['Profile', 'Relationships', 'Background', 'Important memories']) {
        assert.match(index, new RegExp(`npc-state-viewer-group-title">${title}`));
    }
    assert.match(index, /class="npc-state-viewer-glance-title">Current<\/div>/);
    assert.match(index, /class="npc-state-viewer-portrait-rail"/);
    assert.match(index, /class="npc-state-viewer-portrait-caption"/);
    assert.match(index, /class="npc-state-viewer-document"/);
    assert.match(index, /class="npc-state-viewer-commandbar"/);
    assert.match(index, /class="npc-state-viewer-more"/);
    assert.match(index, /<summary><i class="fa-solid fa-ellipsis"><\/i> <span>More<\/span><\/summary>/);
    const pageStart = index.indexOf('class="npc-state-viewer-page"');
    const commandStart = index.indexOf('class="npc-state-viewer-commandbar"', pageStart);
    const pageHtml = index.slice(pageStart, commandStart);
    assert.match(pageHtml, /npc-state-viewer-portrait-rail/);
    assert.match(pageHtml, /npc-state-viewer-document/);
    assert.match(pageHtml, /npc-state-viewer-glance/);
    assert.doesNotMatch(pageHtml, /Edit dossier|Refresh from Chat|Copy portrait prompts|npc-state-viewer-more/);
    const commandHtml = index.slice(commandStart, index.indexOf('</footer>', commandStart));
    assert.match(commandHtml, /Edit dossier/);
    assert.match(commandHtml, /title="Refresh from Chat"/);
    assert.match(commandHtml, /npc-state-viewer-more/);
    assert.match(commandHtml, /Copy portrait prompts/);
    assert.ok(commandHtml.indexOf('Copy portrait prompts') > commandHtml.indexOf('npc-state-viewer-more'), 'copy prompt belongs inside the secondary More area');
    assert.match(css, /\.npc-state-viewer-dialog\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.npc-state-viewer-page\s*\{[^}]*display:\s*grid[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.npc-state-viewer-document\s*\{[^}]*overflow-y:\s*auto[^}]*touch-action:\s*pan-y/s);
    assert.match(css, /\.npc-state-viewer-portrait-rail\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.npc-state-viewer-commandbar\s*\{[^}]*grid-template-columns/s);
    assert.match(css, /\.npc-state-viewer-more-menu\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*calc\(100% \+ 8px\)/s);
});


test('focused dossier gives long-form prose breathing room instead of table-like compression', () => {
    const profileStart = index.indexOf('npc-state-viewer-group-title">Profile');
    const relationshipsStart = index.indexOf('npc-state-viewer-group-title">Relationships', profileStart);
    const profileHtml = index.slice(profileStart, relationshipsStart);
    assert.doesNotMatch(profileHtml, /npc-state-viewer-profile-columns/);
    assert.match(profileHtml, /<b>Personality<\/b><p>/);
    assert.match(profileHtml, /<b>Behavioral profile<\/b>/);
    assert.match(profileHtml, /<b>Speech<\/b><p>/);
    assert.match(index, /const mannerisms = npc\.mannerisms\?\.length[\s\S]*npc-state-viewer-list/);
    assert.match(css, /\.npc-state-viewer-section\s*\{[^}]*margin-top:\s*23px;[^}]*padding-top:\s*20px;/s);
    assert.match(css, /\.npc-state-viewer-section p,\s*\n\.npc-state-viewer-section ul\s*\{[^}]*line-height:\s*1\.68;/s);
    assert.match(css, /\.npc-state-viewer-section li \+ li\s*\{[^}]*margin-top:\s*9px;/s);
    assert.match(css, /\.npc-state-viewer-facts\s*\{[^}]*gap:\s*12px 14px;/s);
});

test('focused dossier refresh preserves whichever responsive viewer surface is scrolling', () => {
    assert.match(index, /const oldPage = activeNpcViewerOverlay\.querySelector\?\.\('\.npc-state-viewer-page'\)/);
    assert.match(index, /const oldDocument = activeNpcViewerOverlay\.querySelector\?\.\('\.npc-state-viewer-document'\)/);
    assert.match(index, /const pageScrollTop = Number\(oldPage\?\.scrollTop \|\| 0\)/);
    assert.match(index, /const documentScrollTop = Number\(oldDocument\?\.scrollTop \|\| 0\)/);
    assert.match(index, /const nextPage = activeNpcViewerOverlay\.querySelector\?\.\('\.npc-state-viewer-page'\)/);
    assert.match(index, /const nextDocument = activeNpcViewerOverlay\.querySelector\?\.\('\.npc-state-viewer-document'\)/);
    assert.match(index, /if \(nextPage\) nextPage\.scrollTop = pageScrollTop/);
    assert.match(index, /if \(nextDocument\) nextDocument\.scrollTop = documentScrollTop/);
});

test('tablet viewer is viewport-bound and switches between portrait rail and cinematic hero layouts', () => {
    assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1180px\)[\s\S]*?\.npc-state-viewer-dialog\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*border-radius:\s*0;/s);
    assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1180px\) and \(orientation: landscape\)[\s\S]*?\.npc-state-viewer-page\s*\{[^}]*grid-template-columns:\s*minmax\(280px, 38%\)/s);
    assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1180px\) and \(orientation: portrait\)[\s\S]*?\.npc-state-viewer-portrait-rail\s*\{[^}]*height:\s*clamp\(320px, 38dvh, 460px\)/s);
    assert.match(css, /\.npc-state-viewer-portrait-caption\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0[^}]*linear-gradient/s);
    assert.match(css, /\.npc-state-viewer-portrait img\s*\{[^}]*object-fit:\s*cover[^}]*object-position:\s*center 18%/s);
});

test('present cards and viewer resolve the current canonical NPC name after identity promotion', () => {
    assert.match(index, /const displayName = npc\.name \|\| 'NPC'/);
    assert.match(index, /Open \$\{escapeHtml\(displayName\)\} dossier/);
    assert.match(index, /<h2 id="npc_state_viewer_title">\$\{escapeHtml\(displayName\)\}<\/h2>/);
});


test('inline dossier uses trust affection desire tension and strict presence wording', () => {
    assert.match(index, /barHtml\('Trust'/);
    assert.match(index, /barHtml\('Affection'/);
    assert.match(index, /barHtml\('Desire'/);
    assert.match(index, /barHtml\('Tension'/);
    assert.doesNotMatch(index, /barHtml\('Respect'/);
    assert.match(index, /filter\(npc => !npc\.archived && npc\.present && !npc\.minor\)/);
    assert.match(index, /only NPCs detected as physically present/i);
});


test('relationship tuning exposes baseline, caps, editable rubrics, and delta audit UI', () => {
    for (const id of ['npc_state_base_trust', 'npc_state_base_affection', 'npc_state_base_desire', 'npc_state_base_tension']) assert.match(index, new RegExp(id));
    for (const id of ['npc_state_cap_ordinary', 'npc_state_cap_meaningful', 'npc_state_cap_major', 'npc_state_cap_extreme']) assert.match(index, new RegExp(id));
    assert.match(index, /npc_state_relationship_criteria/);
    assert.match(index, /npc_state_impact_criteria/);
    assert.match(index, /Reset relationship rules/);
    assert.match(index, /Last relationship change/);
    assert.match(index, /npc-state-delta-pill/);
    assert.match(css, /npc-state-rubric-textarea/);
});

test('important memory criteria are editable and resettable from settings', () => {
    assert.match(index, /Important memory tuning/);
    assert.match(index, /Important Memory Criteria/);
    assert.match(index, /npc_state_memory_criteria/);
    assert.match(index, /npc_state_reset_memory_rules/);
    assert.match(index, /Reset memory criteria/);
    assert.match(index, /Existing memories are shown to the scanner/i);
    assert.match(index, /Important memories <small>Max 5/i);
    assert.match(index, /cleanEditorList\(editorField\('npc_state_edit_memories'\), IMPORTANT_MEMORY_LIMIT\)/);
});


test('present-only behavior injection and manual dossier editor controls are exposed', () => {
    assert.match(index, /Inject present NPC state/);
    assert.match(index, /npc_state_behavior_criteria/);
    assert.match(index, /Relationship-to-behavior rubric/);
    assert.match(index, /npc-state-inline-edit-npc/);
    assert.match(index, /npc-state-roster-edit/);
    assert.match(index, /Save dossier/);
    assert.match(index, /Protect edited stable profile fields/);
    assert.match(index, /Leave off to use manual edits as an organic baseline/);
    assert.match(index, /\$\{locked\.length \? 'checked' : ''\}/);
    assert.match(index, /npc_state_edit_trust/);
    assert.match(index, /npc_state_edit_affection/);
    assert.match(index, /npc_state_edit_desire/);
    assert.match(index, /npc_state_edit_tension/);
    assert.match(index, /npc_state_edit_behavior_profile/);
    assert.match(index, /Max \${BEHAVIOR_PROFILE_LIMIT} compact point-form rules/);
    assert.match(index, /const Popup = ctx\.Popup/);
    assert.match(index, /allowVerticalScrolling: true/);
    assert.match(css, /npc-state-editor-popup/);
});


test('archive lifecycle controls stay reversible while settings roster exposes confirmed hard delete', () => {
    assert.match(index, /Archive confirmed deaths/);
    assert.match(index, /Reactivate on clear return/);
    assert.match(index, /Archived \(\$\{archived\.length\}\)/);
    assert.match(index, /npc-state-archive-npc/);
    assert.match(index, /npc-state-restore-npc/);
    assert.match(index, /npc-state-roster-delete npc-state-delete-npc/);
    assert.match(index, /Delete \${escapeHtml\(npc\.name\)} dossier/);
    assert.match(index, /function deleteNpcById/);
    assert.match(index, /window\.confirm\(message\)/);
    assert.match(index, /commitBranchCheckpoint\(working, targetMessageId, 'manual-delete'\)/);
    assert.match(index, /click\.npcState', '\.npc-state-delete-npc'/);
    assert.match(index, /keydown\.npcState', '\.npc-state-delete-npc'/);
    assert.doesNotMatch(index, /npc-state-inline-delete-npc/);
    assert.match(css, /npc-state-archived-roster/);
    assert.match(css, /npc-state-roster-delete/);
    assert.match(css, /npc-state-editor-lifecycle/);
});

test('roster exposes present versus current off-screen World State activity', () => {
    assert.match(index, /npc\.worldActive \? '◌ '/);
    assert.match(index, /current off-screen activity from World State/);
    assert.match(index, /Present Minor NPCs still update and remain eligible for generation injection/);
    assert.match(index, /Active · Off-screen/);
});


test('generation injection budget is player-configurable in settings', () => {
    assert.match(index, /npc_state_inject_budget/);
    assert.match(index, /Injection budget/);
    assert.match(index, /Approximate hard ceiling/);
});


test('relationship UI is bipolar around neutral zero and legacy audit values are finite-filtered', () => {
    for (const id of ['npc_state_base_trust', 'npc_state_base_affection', 'npc_state_base_desire', 'npc_state_base_tension']) {
        assert.match(index, new RegExp(`${id}[^>]*min=\"-100\"[^>]*max=\"100\"`));
    }
    for (const id of ['npc_state_edit_trust', 'npc_state_edit_affection', 'npc_state_edit_desire', 'npc_state_edit_tension']) {
        assert.match(index, new RegExp(`${id}[^>]*min=\"-100\"[^>]*max=\"100\"`));
    }
    assert.match(index, /signedRelationship/);
    assert.match(index, /Number\.isFinite\(value\)/);
    assert.match(css, /npc-state-bar-zero/);
    assert.match(css, /left:\s*50%/);
    assert.match(css, /npc-state-bar-negative/);
});


test('dossier exposes species/race, age, prompt-ready appearance, and portrait generation controls', () => {
    assert.match(index, /npc_state_edit_species/);
    assert.match(index, /Species \/ Race/);
    assert.match(index, /npc_state_edit_age/);
    assert.match(index, /npc_state_edit_apparent_age/);
    assert.match(index, /Apparent age/);
    assert.match(index, /Prompt-ready visual description/);
    assert.match(index, /maxlength="1800"/);
    assert.match(index, /npc-state-copy-image-prompt/);
    assert.match(index, /Copy portrait prompts/);
    assert.match(index, /Age:/);
    assert.match(index, /npcImagePromptText/);
    assert.match(index, /buildNpcPortraitPrompts/);
    assert.match(index, /Generate portrait/);
    assert.doesNotMatch(index, /<b>Current thoughts<\/b>|Thought basis|npc_state_edit_thought/i);
});

test('scanner uses current-exchange auto context and keeps wider history for manual scans', () => {
    assert.match(index, /function currentExchangeTranscript/);
    assert.match(index, /const fullWindowScan = Boolean\(!manual && settings\.fullScanEveryTurn\)/);
    assert.match(index, /\(manual \|\| fullWindowScan\) \? recentTranscript\(settings\.scanDepth\) : currentTranscript/);
    assert.match(index, /SCAN_RESPONSE_LENGTH = 1800/);
    assert.match(index, /FULL_SCAN_RESPONSE_LENGTH = 3200/);
    assert.match(index, /fullWindowScan \? FULL_SCAN_RESPONSE_LENGTH : SCAN_RESPONSE_LENGTH/);
    assert.match(index, /BACKFILL_RESPONSE_LENGTH = 3200/);
    assert.match(index, /JSON_RETRY_RESPONSE_LENGTH = 5200/);
    assert.match(index, /CRITICAL COMPACT JSON RETRY/);
    assert.match(index, /Full\/manual scan context/);
    assert.match(index, /Full scan every turn/);
    assert.match(index, /Quick automatic scans still use only the current user \+ assistant exchange/);
    assert.match(index, /settings\.fullScanEveryTurn \|\| state\.assistantSinceScan >= settings\.scanEvery/);
    assert.match(index, /prepareFullWindowRelationshipEvaluation\(resolvedParsed, state\.npcs\)/);
    assert.match(index, /runFocusedRelationshipPass\(\s*ctx,\s*fullWindowRelationship\.evaluation,\s*state\.npcs,\s*currentTranscript \|\| transcript,\s*settings,\s*\{ currentExchangeOnly: manual \|\| fullWindowScan \},\s*\)/);
    assert.match(index, /npc_state_admission_mode/);
    assert.match(index, /Conservative/);
    assert.match(index, /Balanced/);
    assert.match(index, /Manual only/);
    assert.match(index, /processPendingBackfills/);
    assert.match(index, /targeted dossier backfill extractor|dossier backfill scanner/);
});


test('inline card truth follows merged presence and settings roster editor uses direct mobile-safe binding', () => {
    assert.match(index, /function scanInlineNpcIds\(_parsed, merged\)/);
    assert.doesNotMatch(index, /const touched = new Set/);
    assert.match(index, /recordInlineCardsInState\(nextState, targetMessageId, \[finalNpc\.id\], 'ooc-backfill'\)/);
    assert.match(index, /removeNpcInlineCardAtMessage/);
    assert.match(index, /function wireSettingsRosterEditor/);
    assert.match(index, /querySelectorAll\('\.npc-state-roster-edit'\)/);
    assert.match(index, /addEventListener\?\.\('pointerup'/);
    assert.match(index, /document\.addEventListener\('touchend'/);
    assert.match(index, /event\.stopImmediatePropagation\?\.\(\)/);
    assert.match(index, /role="button" tabindex="0"[^>]*npc-state-roster-edit|npc-state-roster-edit" role="button" tabindex="0"/);
    assert.match(index, /const Popup = ctx\.Popup/);
    assert.match(index, /new Popup\(content, POPUP_TYPE\.TEXT/);
    assert.match(index, /large: true/);
    assert.match(index, /allowVerticalScrolling: true/);
    assert.doesNotMatch(index, /overlay\.style\.zIndex = '2147483000'/);
    assert.match(css, /npc-state-editor-popup/);
    assert.equal((index.match(/id="npc_state_edit_personality"/g) || []).length, 1, 'editor must not render duplicate Personality controls');
});


test('UI integration remounts inline cards on SillyTavern render lifecycle and captures roster editor clicks', () => {
    assert.match(index, /CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /MORE_MESSAGES_LOADED/);
    assert.match(index, /MESSAGE_UPDATED/);
    assert.match(index, /INLINE_RENDER_RETRY_DELAYS/);
    assert.match(index, /function inlineEntriesForRender/);
    assert.match(index, /live-present-grid/);
    assert.match(index, /function installUiCaptureBridge/);
    assert.match(index, /document\.addEventListener\('pointerup', activateNpcViewerFromEvent, true\);/);
    assert.match(index, /document\.addEventListener\('pointerup', activateNpcEditorFromEvent, true\);/);
    assert.match(index, /document\.addEventListener\('click', activateNpcViewerFromEvent, true\);/);
    assert.match(index, /document\.addEventListener\('click', activateNpcEditorFromEvent, true\);/);
    assert.match(index, /document\.addEventListener\('touchend'/);
    assert.match(index, /eventTargetClosest\(event, '\.npc-state-roster-edit, \.npc-state-inline-edit-npc'\)/);
    assert.match(index, /class="menu_button npc-state-roster-edit"/);
    assert.match(index, /\$\(document\)\.on\('click\.npcState', '\.npc-state-roster-edit'/);
    assert.match(index, /uiStatus:/);
});

test('mobile viewer is true full-screen and isolates horizontal swipe gestures', () => {
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.npc-state-viewer-dialog\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100dvh;[\s\S]*max-height:\s*100dvh;/s);
    assert.match(css, /\.npc-state-viewer-dialog\s*\{[\s\S]*touch-action:\s*pan-y;/s);
    assert.match(css, /\.npc-state-viewer-overlay\s*\{[\s\S]*touch-action:\s*none;/s);
    assert.match(css, /body\.npc-state-viewer-open\s*\{[^}]*overflow:\s*hidden\s*!important/s);
    assert.match(index, /settledBackdropClick = event\.target === overlay && Date\.now\(\) - activeNpcViewerOpenedAt > 350/);
    assert.match(index, /eventTargetClosest\(event, '\.npc-state-viewer-close'\)/);
    assert.match(index, /event\?\.key !== 'Escape'/);
});

test('visible inline rendering is latest-scene present cast only while historical snapshots remain internal', () => {
    assert.match(index, /Visible NPC State is a live present-cast view, not a historical dossier timeline/);
    assert.match(index, /const latestAssistantId = latestMessageId\(true\)/);
    assert.match(index, /filter\(npc => !npc\.archived && npc\.present && !npc\.minor\)/);
    assert.match(index, /return \[\{[\s\S]*reason: 'live-present-grid'/s);
    assert.doesNotMatch(index, /function inlineEntriesForRender\(state\) \{[\s\S]*state\.inlineCards\.map/s);
});

test('inline renderer self-heals host redraws without destructive full remounts', () => {
    assert.match(index, /new globalThis\.MutationObserver/);
    assert.match(index, /inlineMountNeedsRepair/);
    assert.match(index, /startInlineWatchdog/);
    assert.match(index, /existingById/);
    assert.match(index, /if \(!anchor\) \{/);
    assert.match(index, /else if \(anchor\.innerHTML !== html\)/);
    assert.doesNotMatch(index, /querySelectorAll\?\.\('\.npc-state-inline-anchor'\)\.forEach\(node => node\.remove\(\)\)/);
});

test('Megumin master block receives NPC State as an in-card tab with standalone fallback preserved', () => {
    assert.match(index, /function mountNpcStateInsideMeguminBlock/);
    assert.match(index, /querySelector\?\.\('\.meg-blocks'\)|querySelector\('\.meg-blocks'\)/);
    assert.match(index, /\.meg-blocks-tabs/);
    assert.match(index, /\.meg-blocks-panel/);
    assert.match(index, /className = 'meg-blocks-tab npc-state-megumin-tab'/);
    assert.match(index, /className = 'meg-block-body npc-state-megumin-pane'/);
    assert.match(index, /pane\.dataset\.key = button\.dataset\.key/);
    assert.match(index, /npcStateSnapshotSignature/);
    assert.match(index, /closest\('\.npc-state-inline-anchor, \.npc-state-megumin-pane'\)/);
    assert.match(index, /NPC State<\/span>/);
    assert.match(index, /mountNpcStateInsideMeguminBlock\(message, messageId, html\)/);
    assert.match(index, /anchor\?\.remove\?\.\(\)/, 'successful Megumin integration should remove the duplicate standalone card');
    assert.match(index, /className = 'npc-state-inline-anchor'/, 'standalone rendering remains the fallback when no Megumin block exists');
    assert.match(index, /cleanupStaleMeguminIntegrations/);
    assert.match(index, /integratedMeguminBlocks:/);
    assert.match(css, /\.npc-state-megumin-pane\s*\{/);
    assert.match(css, /\.npc-state-megumin-tab\s*\{/);
});

test('Megumin integration never rewrites canonical message text and reattaches through the existing render watchdog', () => {
    assert.doesNotMatch(index, /message\.mes\s*=.*NPC_State|\.mes\s*\+=.*NPC_State|<NPC_State>/s);
    assert.match(index, /new globalThis\.MutationObserver/);
    assert.match(index, /\.npc-state-megumin-pane/);
    assert.match(index, /inlineMountNeedsRepair/);
    assert.match(index, /CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /MESSAGE_UPDATED/);
});

test('compact Megumin World State preserves omitted off-screen activity while still resetting physical presence', () => {
    assert.match(index, /hasCompactMeguminWorldState/);
    assert.match(index, /if \(!compactWorldStateTurn\) npc\.worldActive = false/);
    assert.match(index, /preserveWorldActive: compactWorldStateTurn/);
});

test('per-NPC Scan dossier workflow and Key Relationships controls are exposed', () => {
    assert.match(index, /function findMeguminDossierSources/);
    assert.match(index, /async function scanNpcDossier/);
    assert.match(index, /<\(New_NPC\|NPC_Update\)/);
    assert.match(index, /npc-state-scan-dossier/);
    assert.match(index, /Scan dossier/);
    assert.match(index, /npc-state-refresh-chat/);
    assert.match(index, /Refresh from Chat/);
    assert.match(index, /async function refreshNpcFromChat/);
    assert.match(index, /recentTranscript\(settings\.scanDepth\)/);
    assert.match(index, /skipRelationshipUpdate: true/);
    assert.match(index, /no matching Megumin dossier block found.*scanning recent story context instead/i);
    assert.match(index, /dossier-import/);
    assert.match(index, /npc_state_edit_key_relationships/);
    assert.match(index, /Key relationships/);
    assert.match(index, /cleanEditorList\(editorField\('npc_state_edit_key_relationships'\), KEY_RELATIONSHIP_LIMIT\)/);
    assert.match(index, /keyRelationships: \[\.\.\.\(npc\.keyRelationships \|\| \[\]\)\]/);
    assert.match(index, /<b>Key relationships<\/b>/);
});


test('stale NPC lifecycle is configurable and recurring NPCs can be protected', () => {
    assert.match(index, /npc_state_auto_prune_stale/);
    assert.match(index, /Auto-manage stale NPCs/);
    assert.match(index, /npc_state_stale_archive_after/);
    assert.match(index, /npc_state_stale_delete_after/);
    assert.match(index, /staleArchiveAfter:\s*30/);
    assert.match(index, /staleDeleteAfter:\s*50/);
    assert.match(index, /applyStaleLifecycleAfterScan/);
    assert.match(index, /Archived dossiers no longer consume an active roster slot/);
    assert.match(index, /npc_state_edit_retention_protected/);
    assert.match(index, /Keep this NPC from automatic stale cleanup/);
    assert.match(index, /retentionProtected/);
    assert.match(index, /Deleted stale NPCs can be rediscovered if they return/);
});

test('minor NPC toggle hides portrait cards without disabling dossier tracking', () => {
    assert.match(index, /npc_state_edit_minor/);
    assert.match(index, /Minor NPC · hide portrait card/);
    assert.match(index, /!npc\.minor/);
    assert.match(index, /next\.minor = Boolean/);
    assert.match(index, /still scans, updates, stores memories\/relationships, and injects when present/);
});


test('v0.2 portrait generation settings expose theme, positive/negative prompts, and backend-neutral controls', () => {
    for (const id of [
        'npc_state_portrait_generation_enabled',
        'npc_state_portrait_theme_preset',
        'npc_state_portrait_style_positive',
        'npc_state_portrait_style_negative',
        'npc_state_portrait_composition',
        'npc_state_portrait_prompt_format',
        'npc_state_portrait_use_mood',
        'npc_state_portrait_use_location',
        'npc_state_portrait_save_gallery',
    ]) assert.match(index, new RegExp(id));
    assert.match(index, /SillyTavern Image Generation/i);
    assert.match(index, /Fantasy Anime/);
    assert.match(index, /Anime Key Visual/);
    assert.match(index, /Painterly Fantasy/);
    assert.match(index, /Dark Medieval/);
    assert.match(index, /Semi-Realistic/);
    assert.doesNotMatch(index, /sampler[^\n]*<select|checkpoint[^\n]*<select|cfg[^\n]*<input/i, 'NPC State should not duplicate native backend controls');
});

test('portrait generator is a review-before-apply workflow with per-NPC prompt overrides', () => {
    assert.match(index, /function portraitGeneratorHtml/);
    assert.match(index, /npc-state-portrait-generator-preview/);
    assert.match(index, /id="npc_state_portrait_positive"/);
    assert.match(index, /id="npc_state_portrait_negative"/);
    assert.match(index, /Reset from dossier/);
    assert.match(index, /> Generate</);
    assert.match(index, /Use as Portrait/);
    assert.match(index, /npc_state_edit_portrait_positive/);
    assert.match(index, /npc_state_edit_portrait_negative/);
    assert.match(index, /npc_state_edit_portrait_replace/);
    assert.match(index, /portraitPromptPositive/);
    assert.match(index, /portraitPromptNegative/);
    assert.match(index, /portraitPromptReplace/);
    assert.match(css, /\.npc-state-portrait-generator-overlay\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
    assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1180px\)[\s\S]*?\.npc-state-portrait-generator-dialog\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100dvh/s);
});

test('native portrait bridge uses quiet SillyTavern imagine command and separate negative prompt', () => {
    assert.match(index, /executeSlashCommandsWithOptions/);
    assert.match(index, /'\/imagine'/);
    assert.match(index, /'quiet=true'/);
    assert.match(index, /gallery=\$\{settings\.portraitSaveToGallery/);
    assert.match(index, /negative=\$\{slashQuoted\(negative\)\}/);
    assert.match(index, /result\?\.pipe/);
    assert.match(index, /portraitAssetFromGeneratedUrl/);
    assert.match(index, /compressPortrait\(file\)/);
});


test('portrait generator top layer stays above the full-screen dossier on tablet and mobile', () => {
    const viewer = css.match(/\.npc-state-viewer-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/);
    const generator = css.match(/\.npc-state-portrait-generator-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/);
    assert.ok(viewer, 'viewer z-index should be explicit');
    assert.ok(generator, 'portrait generator z-index should be explicit');
    assert.ok(Number(generator[1]) > Number(viewer[1]), `portrait generator (${generator[1]}) must sit above dossier (${viewer[1]})`);
    assert.match(index, /overlay\.style\.zIndex\s*=\s*'2147483600'/);
});
