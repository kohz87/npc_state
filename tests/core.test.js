import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildInjection,
    estimateInjectionTokens,
    buildBehaviorGuidance,
    DEFAULT_BEHAVIOR_CRITERIA,
    DEFAULT_RELATIONSHIP_CAPS,
    isLegacyStockBehaviorCriteriaV024,
    DEFAULT_MEMORY_CRITERIA,
    IMPORTANT_MEMORY_LIMIT,
    KEY_RELATIONSHIP_LIMIT,
    DURABLE_PROFILE_LIMITS,
    NPC_ARCHIVE_REASONS,
    applyNpcStateCommand,
    buildScannerPrompt,
    buildRelationshipPassPrompt,
    buildBackfillPrompt,
    buildDossierImportPrompt,
    buildProfileRefreshPrompt,
    createNpcRecord,
    mergeScanResult,
    resolveInterimIdentityPromotions,
    normalizeName,
    inferNpcIdentityKind,
    normalizeAge,
    normalizeApparentAge,
    normalizeNpcRecord,
    setNpcArchived,
    normalizeRelationshipCaps,
    normalizeRelationshipBaseline,
    normalizeRelationshipProgress,
    normalizeRelationshipMilestones,
    inferManualRelationshipMilestones,
    relationshipMilestoneUnlocked,
    normalizeRelationshipEvidence,
    normalizeScanNpc,
    applyRelationshipDelta,
    relationshipChangeLooksDuplicate,
    relationshipHistoryLooksDuplicate,
    relationshipAxisEvidenceGrounded,
    relationshipSummaryConsistent,
    parseScanJson,
    parseOocNpcStateCommands,
    selectRelevantNpcs,
    scoreNpcRelevance,
    selectScannerContextNpcs,
    stripUiNoise,
    hasCompactMeguminWorldState,
    extractExplicitKeyRelationshipEdges,
    pruneStaleNpcState,
    applyStaleNpcLifecycle,
    stripOocNpcStateControls,
    buildNpcPortraitPrompts,
    normalizePortraitPromptFormat,
} from '../core.js';

test('normalizes names across punctuation and casing', () => {
    assert.equal(normalizeName('  Lady Éris!! '), 'lady éris');
});

test('archive reason contract includes automatic stale archives', () => {
    assert.deepEqual(NPC_ARCHIVE_REASONS, ['', 'manual', 'deceased', 'stale']);
});


test('stale NPC cleanup frees roster data without suppressing rediscovery', () => {
    const stale = createNpcRecord('Old Scout', [], { trust: 0, affection: 0, desire: 0, tension: 0 });
    stale.id = 'npc_old_scout';
    stale.lastSeenTurn = 50;
    stale.lastWorldActiveTurn = 20;
    stale.present = false;
    stale.worldActive = false;
    stale.retentionProtected = false;

    const pinned = createNpcRecord('Recurring Knight', [stale.id]);
    pinned.id = 'npc_recurring_knight';
    pinned.lastSeenTurn = 1;
    pinned.retentionProtected = true;

    const offscreen = createNpcRecord('Remote Queen', [stale.id, pinned.id]);
    offscreen.id = 'npc_remote_queen';
    offscreen.lastSeenTurn = 1;
    offscreen.lastWorldActiveTurn = 100;
    offscreen.worldActive = true;

    const archived = createNpcRecord('Dead Captain', [stale.id, pinned.id, offscreen.id]);
    archived.id = 'npc_dead_captain';
    archived.lastSeenTurn = 1;
    archived.archived = true;
    archived.archiveReason = 'deceased';

    const recent = createNpcRecord('Recent Clerk', [stale.id, pinned.id, offscreen.id, archived.id]);
    recent.id = 'npc_recent_clerk';
    recent.lastSeenTurn = 51;

    const state = {
        turn: 100,
        npcs: [stale, pinned, offscreen, archived, recent],
        dismissed: ['someone else'],
        candidates: [],
        pendingBackfills: [{ npcId: stale.id, label: stale.name }, { npcId: recent.id, label: recent.name }],
        inlineCards: [{ messageId: 7, cards: [stale, recent] }],
        portraitAssets: {
            [stale.id]: { dataUrl: 'data:image/png;base64,AAAA' },
            [recent.id]: { dataUrl: 'data:image/png;base64,BBBB' },
        },
    };

    const result = pruneStaleNpcState(state, { turn: 100, threshold: 50 });
    assert.deepEqual(result.removed.map(item => item.id), [stale.id], 'exactly 50 turns absent should qualify as stale');
    assert.deepEqual(result.state.npcs.map(npc => npc.id), [pinned.id, offscreen.id, archived.id, recent.id]);
    assert.equal(result.state.pendingBackfills.some(item => item.npcId === stale.id), false);
    assert.equal(result.state.inlineCards[0].cards.some(card => card.id === stale.id), false);
    assert.equal(stale.id in result.state.portraitAssets, false);
    assert.deepEqual(result.state.dismissed, ['someone else'], 'auto-prune must not suppress future rediscovery');
});

test('stale cleanup protectedIds conservatively preserves a currently referenced old NPC', () => {
    const old = createNpcRecord('Marris');
    old.id = 'npc_marris';
    old.lastSeenTurn = 1;
    const result = pruneStaleNpcState({ turn: 90, npcs: [old] }, { turn: 90, threshold: 50, protectedIds: [old.id] });
    assert.equal(result.removed.length, 0);
    assert.equal(result.state.npcs[0].id, old.id);
});


test('stale lifecycle auto-archives at 30 and deletes only stale auto-archives at 50', () => {
    const stale = createNpcRecord('Court Herald');
    stale.id = 'npc_court_herald';
    stale.lastSeenTurn = 70;

    const manual = setNpcArchived(createNpcRecord('Old Mentor'), true, { reason: 'manual' });
    manual.id = 'npc_old_mentor';
    manual.lastSeenTurn = 1;

    const dead = setNpcArchived(createNpcRecord('Dead Baron'), true, { reason: 'deceased' });
    dead.id = 'npc_dead_baron';
    dead.lastSeenTurn = 1;

    const atThirty = applyStaleNpcLifecycle({ turn: 100, npcs: [stale, manual, dead] }, { turn: 100, archiveAfter: 30, deleteAfter: 50 });
    const herald = atThirty.state.npcs.find(npc => npc.id === stale.id);
    assert.equal(herald.archived, true);
    assert.equal(herald.archiveReason, 'stale');
    assert.deepEqual(atThirty.archived.map(item => item.id), [stale.id]);
    assert.equal(atThirty.removed.length, 0);

    herald.lastSeenTurn = 50;
    const atFifty = applyStaleNpcLifecycle({ ...atThirty.state, turn: 100 }, { turn: 100, archiveAfter: 30, deleteAfter: 50 });
    assert.deepEqual(atFifty.removed.map(item => item.id), [stale.id]);
    assert.ok(atFifty.state.npcs.some(npc => npc.id === manual.id), 'manual archives must not time out');
    assert.ok(atFifty.state.npcs.some(npc => npc.id === dead.id), 'death archives must not time out');
});

test('stale auto-archive is reversible and archived dossiers do not consume the active roster cap', () => {
    const archived = createNpcRecord('Old Courtier');
    archived.id = 'npc_old_courtier';
    archived.lastSeenTurn = 1;
    const lifecycle = applyStaleNpcLifecycle({ turn: 31, npcs: [archived] }, { turn: 31, archiveAfter: 30, deleteAfter: 50 });
    assert.equal(lifecycle.state.npcs[0].archiveReason, 'stale');

    const admitted = mergeScanResult(lifecycle.state, { npcs: [{ name: 'New Courtier', present: true }] }, { turn: 31, maxNpcs: 1 });
    assert.equal(admitted.state.npcs.filter(npc => !npc.archived).length, 1);
    assert.ok(admitted.state.npcs.some(npc => npc.name === 'New Courtier'));
    assert.equal(admitted.state.npcs.length, 2, 'archive remains stored while the active slot is reusable');

    const returned = mergeScanResult(admitted.state, { npcs: [{ id: archived.id, name: 'Old Courtier', present: true }] }, { turn: 32, maxNpcs: 1, autoReactivateArchived: true });
    assert.equal(returned.state.npcs.find(npc => npc.id === archived.id).archived, false, 'stale archive should reactivate on a clear return');
});

test('minor NPC flag survives normalization and does not disable present-state generation injection', () => {
    const npc = normalizeNpcRecord({ ...createNpcRecord('Minor Noble'), minor: true, present: true, personality: 'Reserved', speech: 'Formal' });
    assert.equal(npc.minor, true);
    assert.equal(npc.present, true);
    assert.equal(npc.personality, 'Reserved');
    assert.equal(npc.speech, 'Formal');
    assert.match(buildInjection([npc], 'The court waits.', 1, 3), /Minor Noble/);
});

test('parses fenced scanner JSON', () => {
    const parsed = parseScanJson('```json\n{"npcs":[{"name":"Yunyun"}]}\n```');
    assert.equal(parsed.npcs[0].name, 'Yunyun');
});

test('repairs common model JSON defects from raw scanner output', () => {
    const trailing = parseScanJson('{\n  "npcs": [ { "name": "Marris", }, ],\n}');
    assert.equal(trailing.npcs[0].name, 'Marris');

    const bareKey = parseScanJson('{npcs:[{name:"Guild Boy", present:true}]}');
    assert.equal(bareKey.npcs[0].name, 'Guild Boy');
    assert.equal(bareKey.npcs[0].present, true);
});

test('repairs parser-position missing commas between array elements and object properties', () => {
    const objects = parseScanJson('{"npcs":[{"name":"Myla"}\n {"name":"Toris"}]}');
    assert.deepEqual(objects.npcs.map(npc => npc.name), ['Myla', 'Toris']);

    const strings = parseScanJson('{"npcs":[{"name":"Myla","memories":["first"\n "second"],"present":true "worldActive":false}]}');
    assert.deepEqual(strings.npcs[0].memories, ['first', 'second']);
    assert.equal(strings.npcs[0].present, true);
    assert.equal(strings.npcs[0].worldActive, false);
});

test('does not silently accept truncated scanner JSON', () => {
    assert.throws(
        () => parseScanJson('{"npcs":[{"name":"Myla","appearance":"Young woman with dark'),
        /Unterminated string|malformed JSON/i,
    );
});

test('strips unrelated UI blocks but preserves Megumin World State and NPC Inner Chatter evidence', () => {
    const generic = stripUiNoise('<details><summary>UI</summary>secret panel</details><p>Yunyun waves.</p>');
    assert.equal(generic, 'Yunyun waves.');

    const megumin = stripUiNoise('<details><summary>📌 <b>World State</b></summary><b>Toris (Receptionist)</b>: working the guild desk.</details><details><summary>💭 <b>NPC Inner Chatter</b></summary>Toris: Another form to file.</details><p>The receptionist looks up.</p>');
    assert.match(megumin, /World State: Toris \(Receptionist\)\s*:\s*working the guild desk\./);
    assert.match(megumin, /NPC Inner Chatter: Toris: Another form to file\./);
    assert.match(megumin, /The receptionist looks up\./);
});

test('strips the August 18 Megumin master Blocks envelope down to intentional evidence only', () => {
    const raw = `Megumin narrates the guild hall.
<Blocks>
<CYOA>1. Ask Toris about the audit</CYOA>
<World_State>**Date & Time:** 10:00\n**Location:** Bluewatch Guild\n**NPCs Present:** Toris\n**Off-Screen:** Myla is filing reports upstairs.</World_State>
<NPC_Inner_Chatter>Toris: I need to finish this ledger.</NPC_Inner_Chatter>
<Bonds>Toris: Affection: 88/100 (+8)</Bonds>
<Character_Sheet>HP: 99/100</Character_Sheet>
<New_NPC name="Secret Banker">A model-generated NPC Bank dossier that must not become story evidence.</New_NPC>
<NPC_Update name="Toris">Personality: rewritten by Megumin NPC Bank</NPC_Update>
<Story_Tracker>next_beat: reveal the vault</Story_Tracker>
<Custom_Block>future possibility that did not happen</Custom_Block>
</Blocks>`;
    const cleaned = stripUiNoise(raw);
    assert.match(cleaned, /Megumin narrates the guild hall\./);
    assert.match(cleaned, /World State: .*Bluewatch Guild/);
    assert.match(cleaned, /Off-Screen:\*\* Myla is filing reports upstairs\./);
    assert.match(cleaned, /NPC Inner Chatter: Toris: I need to finish this ledger\./);
    for (const forbidden of ['Ask Toris about the audit', 'Affection: 88', 'HP: 99', 'Secret Banker', 'rewritten by Megumin NPC Bank', 'reveal the vault', 'future possibility']) {
        assert.doesNotMatch(cleaned, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('recognizes compact Megumin World State without confusing a full state refresh', () => {
    const compact = `<Blocks><World_State>**Time & Loc:** Noon at Axel Guild\n**PC:** red cloak | standing\n**NPCs Present:**\n* Yunyun: blue robe | seated</World_State></Blocks>`;
    const full = `<Blocks><World_State>**Date & Time:** Noon\n**Location:** Axel Guild\n**Weather:** clear\n**NPCs Present:** Yunyun\n**Off-Screen:** Wiz tends the shop.</World_State></Blocks>`;
    assert.equal(hasCompactMeguminWorldState(compact), true);
    assert.equal(hasCompactMeguminWorldState(full), false);
    assert.equal(hasCompactMeguminWorldState('<p>No world tracker this turn.</p>'), false);
});

test('creates new NPC from baseline, applies deltas, and preserves portrait through scanner updates', () => {
    const state = { npcs: [], turn: 3 };
    const first = mergeScanResult(state, { npcs: [{
        name: 'Yunyun', present: true, mood: 'flustered', relationshipImpact: 'meaningful',
        relationshipDelta: { trust: 2, affection: 2 }, relationshipEvidence: { trust: 'She confided a private secret and trusted the player with it.', affection: 'The shared vulnerability deepened her emotional bond.', desire: '', tension: '' }, relationshipChangeReason: 'She confided in the player and their bond deepened.',
    }] }, { maxNpcs: 4, turn: 3, sourceMessageId: 3 });
    assert.equal(first.state.npcs.length, 1);
    const npc = first.state.npcs[0];
    assert.equal(npc.relationship.trust, 2);
    assert.equal(npc.relationship.affection, 2);
    assert.equal(npc.lastRelationshipChange.impact, 'meaningful');
    assert.equal(npc.lastRelationshipChange.sourceMessageId, 3);
    npc.portrait = { dataUrl: 'data:image/webp;base64,abc' };
    const second = mergeScanResult(first.state, { npcs: [{
        id: npc.id, name: 'Yunyun', present: true, mood: 'determined', relationshipImpact: 'ordinary',
        relationshipDelta: { trust: 99, tension: -2 }, relationshipEvidence: { trust: 'The player again proved reliable in a new small matter.', affection: '', desire: '', tension: 'The new reassurance eased some pressure.' }, relationshipChangeReason: 'A new small exchange demonstrated reliability and reassurance.',
    }] }, { maxNpcs: 4, turn: 4, sourceMessageId: 4 });
    assert.equal(second.state.npcs.length, 1);
    assert.equal(second.state.npcs[0].mood, 'determined');
    assert.equal(second.state.npcs[0].relationship.trust, 3, 'ordinary delta is intentionally limited to a single +1 axis');
    assert.equal(second.state.npcs[0].relationship.tension, 0);
    assert.equal(second.state.npcs[0].lastRelationshipChange.delta.trust, 1);
    assert.equal(second.state.npcs[0].portrait.dataUrl, 'data:image/webp;base64,abc');
});

test('zero relationship decisions preserve the last actual relationship change audit', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.relationship = { trust: 12, affection: 4, desire: 0, tension: 3 };
    npc.lastRelationshipChange = {
        impact: 'major',
        delta: { trust: -15, affection: -9, desire: 0, tension: 15 },
        evidence: { trust: '', affection: '', desire: '', tension: '' },
        reason: 'A severe betrayal changed how Myla sees the player.',
        sourceMessageId: 8,
    };
    const result = mergeScanResult({ npcs: [npc], turn: 9 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false,
        relationshipImpact: 'none',
        relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 10, sourceMessageId: 10 });
    assert.deepEqual(result.state.npcs[0].relationship, npc.relationship);
    assert.deepEqual(result.state.npcs[0].lastRelationshipChange, npc.lastRelationshipChange, 'a zero-decision scan must not erase the last actual change');
});

test('non-zero relationship deltas survive contradictory none impact as ordinary changes', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.relationship = { trust: 10, affection: 0, desire: 0, tension: 0 };

    const result = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla',
        present: true,
        worldActive: false,
        relationshipImpact: 'none',
        relationshipDelta: { trust: 6 },
        relationshipEvidence: { trust: 'The player proved reliable and earned trust.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'The scanner supplied a real trust event but contradicted it with impact none.',
    }] }, { turn: 2, relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 } });

    assert.equal(result.state.npcs[0].relationship.trust, 14, 'non-zero delta must not be clamped to zero by contradictory impact none');
    assert.equal(result.state.npcs[0].lastRelationshipChange.impact, 'ordinary');
    assert.equal(result.state.npcs[0].lastRelationshipChange.delta.trust, 4);
});

test('recovers absolute relationship output when compact scanner omits relationshipDelta', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.relationship = { trust: 20, affection: 5, desire: -3, tension: 2 };

    const recovered = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla',
        present: true,
        worldActive: false,
        relationshipImpact: 'meaningful',
        relationship: { trust: 28, affection: 1 },
        relationshipEvidence: { trust: 'The player proved reliable and increased her trust.', affection: 'A hurtful rejection reduced her affection.', desire: '', tension: '' },
        relationshipChangeReason: 'A reliable act increased trust while a hurtful rejection reduced affection.',
    }] }, { turn: 2, relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 } });

    assert.deepEqual(recovered.state.npcs[0].relationship, { trust: 28, affection: 1, desire: -3, tension: 2 });
    assert.deepEqual(recovered.state.npcs[0].lastRelationshipChange.delta, { trust: 8, affection: -4, desire: 0, tension: 0 });

    const explicitDeltaWins = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla',
        present: true,
        worldActive: false,
        relationshipImpact: 'none',
        relationshipDelta: { trust: 0 },
        relationship: { trust: 80 },
    }] }, { turn: 2 });

    assert.equal(explicitDeltaWins.state.npcs[0].relationship.trust, 20, 'an explicit relationshipDelta field must win over absolute-output recovery');
});

test('matches alias to existing NPC instead of duplicating', () => {
    const npc = createNpcRecord('Luna');
    npc.aliases = ['Guild Receptionist'];
    const result = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{ name: 'Guild Receptionist', role: 'Adventurers Guild receptionist' }] }, { maxNpcs: 6, turn: 2 });
    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.state.npcs[0].role, 'Adventurers Guild receptionist');
});

test('promotes an interim job-title dossier to a grounded proper name in place', () => {
    const npc = createNpcRecord('Guild Receptionist');
    npc.manual = false;
    npc.role = 'Adventurers Guild receptionist';
    npc.location = 'Bluewatch Guild';
    npc.memories = ['She waived the late filing fee after the rescue.'];
    npc.relationship = { trust: 17, affection: 4, desire: 0, tension: -2 };
    npc.portrait = { dataUrl: 'data:image/png;base64,abc' };

    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 4 }, { npcs: [{
        id: npc.id,
        name: 'Luna',
        aliases: ['Guild Receptionist'],
        identityKind: 'proper_name',
        sameIndividual: true,
        present: true,
        worldActive: false,
        relationshipImpact: 'none',
        relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 5 });

    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.state.npcs[0].id, npc.id, 'identity promotion must keep the dossier id');
    assert.equal(result.state.npcs[0].name, 'Luna');
    assert.equal(result.state.npcs[0].identityKind, 'proper_name');
    assert.ok(result.state.npcs[0].aliases.includes('Guild Receptionist'), 'the interim label should remain searchable as an alias');
    assert.deepEqual(result.state.npcs[0].memories, npc.memories, 'identity promotion must preserve dossier history');
    assert.deepEqual(result.state.npcs[0].relationship, npc.relationship, 'identity promotion must preserve relationship state');
    assert.deepEqual(result.state.npcs[0].portrait, npc.portrait, 'identity promotion must preserve portrait data');
    assert.deepEqual(result.report.renamed, [{ id: npc.id, from: 'Guild Receptionist', to: 'Luna' }]);
});

test('uniquely matched role continuity can promote a dossier even when the model omits its id and old alias', () => {
    const npc = createNpcRecord('Guild Receptionist');
    npc.manual = false;
    npc.role = 'Adventurers Guild Receptionist';
    npc.location = 'Bluewatch Guild';

    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, { npcs: [{
        name: 'Luna', identityKind: 'proper_name', sameIndividual: true,
        role: 'Guild Receptionist', location: 'Bluewatch Guild', present: true, worldActive: false,
        relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 3 });

    assert.equal(result.state.npcs.length, 1, 'the newly named role must not create a duplicate dossier');
    assert.equal(result.state.npcs[0].id, npc.id);
    assert.equal(result.state.npcs[0].name, 'Luna');
    assert.ok(result.state.npcs[0].aliases.includes('Guild Receptionist'));
});

test('pre-merge identity resolver attaches the old dossier id to a uniquely matched proper-name reveal', () => {
    const npc = createNpcRecord('Guild Receptionist');
    npc.role = 'Adventurers Guild Receptionist';
    npc.location = 'Bluewatch Guild';
    const resolved = resolveInterimIdentityPromotions({ npcs: [{
        name: 'Luna', identityKind: 'proper_name', role: 'Guild Receptionist', location: 'Bluewatch Guild', present: true,
    }] }, [npc], []);
    assert.equal(resolved.npcs[0].id, npc.id, 'relationship repair and merge should see the revealed name as the existing dossier before mutation');
    assert.equal(resolved.npcs[0].sameIndividual, true);
    assert.ok(resolved.npcs[0].aliases.includes('Guild Receptionist'));
});

test('unique role continuity promotes an interim dossier when the model omits sameIndividual entirely', () => {
    const npc = createNpcRecord('Guild Receptionist');
    npc.manual = false;
    npc.role = 'Adventurers Guild Receptionist';
    npc.location = 'Bluewatch Guild';

    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, { npcs: [{
        name: 'Luna', identityKind: 'proper_name',
        role: 'Guild Receptionist', location: 'Bluewatch Guild', present: true, worldActive: false,
        relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 3 });

    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.state.npcs[0].id, npc.id);
    assert.equal(result.state.npcs[0].name, 'Luna');
    assert.ok(result.state.npcs[0].aliases.includes('Guild Receptionist'));
});

test('explicit sameIndividual false prevents role-based identity fusion', () => {
    const npc = createNpcRecord('Guild Receptionist');
    npc.manual = false;
    npc.role = 'Guild Receptionist';
    npc.location = 'Bluewatch Guild';

    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, { npcs: [{
        name: 'Luna', identityKind: 'proper_name', sameIndividual: false,
        role: 'Guild Receptionist', location: 'Bluewatch Guild', present: true,
    }] }, { turn: 3 });

    assert.equal(result.state.npcs.length, 2, 'explicit different-person evidence must not merge the named NPC into the interim dossier');
    assert.ok(result.state.npcs.some(item => item.name === 'Guild Receptionist'));
    assert.ok(result.state.npcs.some(item => item.name === 'Luna'));
});

test('proper-name reveal can replace a manually locked interim profile name without losing the dossier id', () => {
    const npc = createNpcRecord('Masked Guard');
    npc.role = 'North Gate Guard';
    npc.manualProfileFields = ['name', 'role'];
    npc.memories = ['The guard let Aris through during the siege.'];

    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Marris', identityKind: 'proper_name', present: true,
        relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 5 });

    assert.equal(result.state.npcs[0].id, npc.id);
    assert.equal(result.state.npcs[0].name, 'Marris');
    assert.ok(result.state.npcs[0].aliases.includes('Masked Guard'));
    assert.deepEqual(result.state.npcs[0].memories, npc.memories);
    assert.ok(result.state.npcs[0].manualProfileFields.includes('name'), 'the promoted proper name remains protected after replacing the placeholder');
});

test('scanner cannot downgrade a known proper name back to a job title', () => {
    const npc = createNpcRecord('Luna');
    npc.manual = false;
    npc.role = 'Guild Receptionist';
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Guild Receptionist', identityKind: 'role_label', sameIndividual: true,
        present: true, worldActive: false, relationshipImpact: 'none',
        relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 3 });
    assert.equal(result.state.npcs[0].name, 'Luna');
    assert.equal(result.state.npcs[0].identityKind, 'proper_name');
    assert.equal(result.report.renamed.length, 0);
});

test('role candidate promoted by a newly learned proper name carries the old label into aliases', () => {
    const first = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Guild Receptionist', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
        role: 'Guild Receptionist', location: 'Bluewatch Guild',
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(first.state.candidates.length, 1);

    const second = mergeScanResult(first.state, { npcs: [{
        name: 'Luna', identityKind: 'proper_name', dossierSignal: 'persistent', sameIndividual: true,
        role: 'Guild Receptionist', location: 'Bluewatch Guild', present: true,
    }] }, { turn: 2, admissionMode: 'conservative' });

    assert.equal(second.state.candidates.length, 0);
    assert.equal(second.state.npcs.length, 1);
    assert.equal(second.state.npcs[0].name, 'Luna');
    assert.ok(second.state.npcs[0].aliases.includes('Guild Receptionist'));
});

test('honors exclusions and roster cap', () => {
    const result = mergeScanResult({ npcs: [], turn: 1 }, { npcs: [{ name: 'Megumin' }, { name: 'Yunyun' }, { name: 'Wiz' }] }, { maxNpcs: 1, excludeNames: ['Megumin'], turn: 1 });
    assert.deepEqual(result.state.npcs.map(n => n.name), ['Yunyun']);
    assert.equal(result.report.skipped.length, 2);
});

test('classifies obvious role labels separately from proper names', () => {
    assert.equal(inferNpcIdentityKind('Guild Boy'), 'role_label');
    assert.equal(inferNpcIdentityKind('Gate Guard'), 'role_label');
    assert.equal(inferNpcIdentityKind('Local Stable Hand'), 'role_label');
    assert.equal(inferNpcIdentityKind('Local Butcher'), 'role_label');
    assert.equal(inferNpcIdentityKind('Marris'), 'proper_name');
    assert.equal(inferNpcIdentityKind('Captain Veyra'), 'proper_name');
});

test('holds a first-time incidental role-only NPC as a lightweight candidate', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Guild Boy', aliases: ['Dock Gopher'], identityKind: 'role_label', dossierSignal: 'incidental', present: true, role: 'Guild Apprentice', location: 'Side Dock',
        role: 'Guild Apprentice', appearance: 'Young boy wearing a stained leather apron.', importance: 0,
    }] }, { turn: 1 });
    assert.equal(result.state.npcs.length, 0);
    assert.equal(result.state.candidates.length, 1);
    assert.equal(result.state.candidates[0].name, 'Guild Boy');
    assert.equal(result.state.candidates[0].seenCount, 1);
    assert.equal('appearance' in result.state.candidates[0], false, 'candidate buffer must stay lightweight');
    assert.equal(result.report.candidates.length, 1);
});

test('promotes an incidental role candidate only when the story clearly identifies the same individual again', () => {
    const first = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Guild Boy', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
    }] }, { turn: 1 });
    const second = mergeScanResult(first.state, { npcs: [{
        name: 'Guild Boy', identityKind: 'role_label', dossierSignal: 'incidental', sameIndividual: true, present: true,
        role: 'Guild Apprentice',
    }] }, { turn: 2 });
    assert.equal(second.state.candidates.length, 0);
    assert.equal(second.state.npcs.length, 1);
    assert.equal(second.state.npcs[0].name, 'Guild Boy');
    assert.equal(second.report.promoted.length, 1);
});

test('does not promote repeated generic role labels without same-individual evidence', () => {
    const first = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Gate Guard', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
    }] }, { turn: 1 });
    const second = mergeScanResult(first.state, { npcs: [{
        name: 'Gate Guard', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
    }] }, { turn: 2 });
    assert.equal(second.state.npcs.length, 0);
    assert.equal(second.state.candidates.length, 1);
    assert.equal(second.state.candidates[0].seenCount, 1);
    assert.equal(second.state.candidates[0].lastSeenTurn, 1, 'ambiguous same-role sightings should not refresh continuity');
});

test('obvious personal names override a mistaken role_label classification in Conservative mode', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Toris', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
        role: 'Guild Receptionist',
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(result.state.candidates.length, 0);
    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.state.npcs[0].name, 'Toris');
});

test('conservative admission keeps routine direct transactions as candidates', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Toll Guard', identityKind: 'role_label', dossierSignal: 'incidental', directInteraction: true, present: true,
        role: 'Gate Toll Guard', location: 'East Gate',
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(result.state.npcs.length, 0);
    assert.equal(result.state.candidates.length, 1);
    assert.equal(result.state.candidates[0].name, 'Toll Guard');
});

test('conservative never lets model relevance alone promote first-seen local service roles', () => {
    for (const [name, signal] of [['Local Stable Hand', 'persistent'], ['Local Butcher', 'meaningful']]) {
        const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
            name, identityKind: 'role_label', dossierSignal: signal, directInteraction: false, present: true,
            role: name.replace(/^Local /, ''), location: 'Village',
        }] }, { turn: 1, admissionMode: 'conservative' });
        assert.equal(result.state.npcs.length, 0, `${name} should not become a dossier on first sight`);
        assert.equal(result.state.candidates.length, 1);
        assert.equal(result.state.candidates[0].name, name);
    }
});

test('balanced admission can create a routine directly interactive role-label NPC immediately', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Receptionist', identityKind: 'role_label', dossierSignal: 'incidental', directInteraction: true, present: true,
        role: 'Guild Receptionist', location: 'Bluewatch Adventurer Guild',
    }] }, { turn: 1, admissionMode: 'balanced' });
    assert.equal(result.state.candidates.length, 0);
    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.state.npcs[0].name, 'Receptionist');
});

test('manual-only admission never auto-promotes even a proper name', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Marris', identityKind: 'proper_name', dossierSignal: 'persistent', directInteraction: true, present: true,
    }] }, { turn: 1, admissionMode: 'manual_only' });
    assert.equal(result.state.npcs.length, 0);
    assert.equal(result.state.candidates.length, 1);
    assert.equal(result.state.candidates[0].name, 'Marris');
});

test('conservative keeps first-seen meaningful role labels as candidates while proper names still admit immediately', () => {
    const role = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Masked Gate Guard', identityKind: 'role_label', dossierSignal: 'meaningful', directInteraction: true, present: true,
        dossierReason: 'Negotiated a recurring passage agreement with the player.',
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(role.state.npcs.length, 0);
    assert.equal(role.state.candidates.length, 1);
    assert.equal(role.state.candidates[0].name, 'Masked Gate Guard');
    const named = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Marris', identityKind: 'proper_name', dossierSignal: 'incidental', importance: 0, present: true,
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(named.state.npcs.length, 1);
    assert.equal(named.state.npcs[0].name, 'Marris');
});

test('balanced still admits meaningful role-label NPCs immediately', () => {
    const role = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Local Butcher', identityKind: 'role_label', dossierSignal: 'meaningful', directInteraction: false, present: true,
        role: 'Butcher', location: 'Market Street',
    }] }, { turn: 1, admissionMode: 'balanced' });
    assert.equal(role.state.candidates.length, 0);
    assert.equal(role.state.npcs.length, 1);
    assert.equal(role.state.npcs[0].name, 'Local Butcher');
});

test('stale incidental candidates expire after the candidate TTL', () => {
    const first = mergeScanResult({ npcs: [], candidates: [], turn: 1 }, { npcs: [{
        name: 'Stablehand', identityKind: 'role_label', dossierSignal: 'incidental', present: true,
    }] }, { turn: 1 });
    const expired = mergeScanResult(first.state, { npcs: [] }, { turn: 17 });
    assert.equal(expired.state.candidates.length, 0);
    assert.deepEqual(expired.report.expired, ['Stablehand']);
});

test('explicit OOC add promotes a held candidate immediately and preserves lightweight identity hints', () => {
    const scanned = mergeScanResult({ npcs: [], candidates: [], dismissed: [], turn: 1 }, { npcs: [{
        name: 'Guild Boy', aliases: ['Dock Gopher'], identityKind: 'role_label', dossierSignal: 'incidental', present: true,
        role: 'Guild Apprentice', location: 'Side Dock',
    }] }, { turn: 1 });
    const added = applyNpcStateCommand(scanned.state, { action: 'add', name: 'Guild Boy' }, { turn: 2 });
    assert.equal(added.state.candidates.length, 0);
    assert.equal(added.state.npcs.length, 1);
    assert.equal(added.state.npcs[0].name, 'Guild Boy');
    assert.equal(added.state.npcs[0].role, 'Guild Apprentice');
    assert.equal(added.state.npcs[0].location, 'Side Dock');
    assert.deepEqual(added.state.npcs[0].aliases, ['Dock Gopher']);
});

test('selects recently relevant NPCs but injection is strictly presence-gated', () => {
    const yunyun = createNpcRecord('Yunyun'); yunyun.lastSeenTurn = 10; yunyun.mood = 'embarrassed'; yunyun.present = true; yunyun.personality = 'proud but earnest'; yunyun.speech = 'formal when nervous'; yunyun.mannerisms = ['boasts when embarrassed']; yunyun.keyRelationships = ['Megumin — friend / rival | competitive but loyal'];
    const wiz = createNpcRecord('Wiz'); wiz.lastSeenTurn = 2; wiz.present = false;
    const selected = selectRelevantNpcs([wiz, yunyun], 'Yunyun enters the guild.', 10, 1);
    assert.equal(selected[0].name, 'Yunyun');
    const injection = buildInjection([wiz, yunyun], 'Yunyun enters the guild.', 10, 3, 'CUSTOM BEHAVIOR RUBRIC');
    assert.match(injection, /Yunyun/);
    assert.match(injection, /personality: proud but earnest/);
    assert.match(injection, /established speech: formal when nervous/);
    assert.match(injection, /established mannerisms: boasts when embarrassed/);
    assert.match(injection, /key relationships: Megumin — friend \/ rival \| competitive but loyal/);
    assert.match(injection, /CUSTOM BEHAVIOR RUBRIC/);
    assert.match(injection, /PLAYER RELATIONSHIP \(secondary modifier\):/);
    assert.doesNotMatch(injection, /Wiz:/);
    yunyun.present = false;
    assert.equal(buildInjection([wiz, yunyun], 'Yunyun is mentioned off-screen.', 10, 3), '');
});

test('behavior guidance interprets combinations rather than raw numbers alone', () => {
    const npc = createNpcRecord('Luna');
    npc.relationship = { trust: 75, affection: 70, desire: 65, tension: 72 };
    const guidance = buildBehaviorGuidance(npc);
    assert.match(guidance, /familiarity and strain coexist/);
    assert.match(guidance, /strong unresolved pressure/);
    assert.match(guidance, /strong trust/);
});



test('qualitative visual age evidence resolves to stable apparent age without inventing chronology', () => {
    const young = normalizeApparentAge('young', 'npc_marris');
    assert.match(young, /^~\d+$/);
    const youngNumber = Number(young.slice(1));
    assert.ok(youngNumber >= 18 && youngNumber <= 29);
    assert.equal(normalizeApparentAge('young', 'npc_marris'), young, 'same NPC/evidence should not reroll');
    assert.equal(normalizeAge('young'), '', 'visual descriptor must not become chronological age');
    assert.equal(normalizeAge('19 years old'), '19');
    const range = normalizeApparentAge('20-25', 'npc_marris');
    assert.match(range, /^~\d+$/);
    assert.ok(Number(range.slice(1)) >= 20 && Number(range.slice(1)) <= 25);
});

test('legacy/scanner qualitative age is routed into apparentAge while chronological age stays unknown', () => {
    const result = mergeScanResult({ npcs: [], turn: 1 }, { npcs: [{
        name: 'Marris', species: 'human', age: 'young', present: true,
    }] }, { turn: 1 });
    assert.equal(result.state.npcs[0].age, '');
    assert.match(result.state.npcs[0].apparentAge, /^~\d+$/);
    const estimated = Number(result.state.npcs[0].apparentAge.slice(1));
    assert.ok(estimated >= 18 && estimated <= 29);
});

test('fantasy species can have separate chronological and apparent age', () => {
    let result = mergeScanResult({ npcs: [], turn: 1 }, { npcs: [{
        name: 'Elaria', species: 'Elf', apparentAge: 'young', present: true,
    }] }, { turn: 1 });
    assert.equal(result.state.npcs[0].age, '');
    assert.match(result.state.npcs[0].apparentAge, /^~\d+$/);
    const looks = result.state.npcs[0].apparentAge;
    result = mergeScanResult(result.state, { npcs: [{
        id: result.state.npcs[0].id, name: 'Elaria', age: '143', present: true,
    }] }, { turn: 2 });
    assert.equal(result.state.npcs[0].age, '143');
    assert.equal(result.state.npcs[0].apparentAge, looks);
});

test('existing personality is keep-by-default even if the scanner casually rephrases it', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Shy, approval-seeking, and impulsive when frightened.';
    const result = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        personality: 'Quiet, insecure, and somewhat cautious.',
    }] }, { turn: 5 });
    assert.equal(result.state.npcs[0].personality, npc.personality, 'missing evolve decision must preserve established personality');
});

test('explicit grounded personality evolution replaces the durable profile over time', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Shy, approval-seeking, impulsive when frightened, and strongly dependent on her older sister.';
    const result = mergeScanResult({ npcs: [npc], turn: 20 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        personalityState: 'evolve',
        personalityReason: 'After several years living independently, she repeatedly makes difficult decisions without seeking her sister\'s approval.',
        developmentScale: 'explicit',
        developmentReason: 'After several years living independently, she repeatedly makes difficult decisions without seeking her sister\'s approval.',
        personality: 'Reserved but increasingly self-assured; still cautious under pressure, yet willing to trust her own judgment and act independently while remaining deeply attached to her sister.',
    }] }, { turn: 21 });
    assert.match(result.state.npcs[0].personality, /self-assured/i);
    assert.match(result.state.npcs[0].personality, /attached to her sister/i, 'evolution should support continuity rather than erase every core trait');
});

test('personality evolution requires a reason and still respects manual profile locks', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Patient, thoughtful, and slow to anger.';
    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Marris', personalityState: 'evolve', personality: 'Cold and reckless.', present: true,
    }] }, { turn: 2 });
    assert.equal(missingReason.state.npcs[0].personality, npc.personality, 'evolve without grounded reason must be ignored');

    npc.manualProfileFields = ['personality'];
    const locked = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Marris', personalityState: 'evolve',
        personalityReason: 'Years of war hardened her outlook.', personality: 'World-weary and severe.', present: true,
    }] }, { turn: 3 });
    assert.equal(locked.state.npcs[0].personality, npc.personality, 'manual Personality lock must remain authoritative');
});

test('manual but unlocked personality can organically refine from newly grounded traits', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Soft-spoken, cautious, and courteous.'; // manually entered baseline, not locked
    npc.manualProfileFields = [];
    const refined = mergeScanResult({ npcs: [npc], turn: 3 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        personalityState: 'refine',
        personality: 'Soft-spoken, cautious, and courteous; dryly humorous with people she trusts.',
    }] }, { turn: 4 });
    assert.match(refined.state.npcs[0].personality, /dryly humorous/i);
    assert.match(refined.state.npcs[0].personality, /cautious/i);
});

test('clearly additive unmarked personality refinement is recovered without allowing casual paraphrase drift', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Soft-spoken, cautious, and courteous.';
    const refined = mergeScanResult({ npcs: [npc], turn: 3 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        personality: 'Soft-spoken, cautious, and courteous, with a dry sense of humor around close friends.',
    }] }, { turn: 4 });
    assert.match(refined.state.npcs[0].personality, /dry sense of humor/i);
});

test('existing appearance is keep-by-default even if the scanner casually rephrases it', () => {
    const npc = createNpcRecord('Selene');
    npc.appearance = 'Tall woman with olive skin, long wavy black hair, amber eyes, and a faint scar beneath her left eye.';
    const result = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Selene', present: true,
        appearance: 'Dark-haired woman with striking features.',
    }] }, { turn: 5 });
    assert.equal(result.state.npcs[0].appearance, npc.appearance, 'missing appearance lifecycle decision must preserve established appearance');
});

test('explicit appearance refinement replaces the visual profile with more image-ready detail', () => {
    const npc = createNpcRecord('Selene');
    npc.appearance = 'Young woman with dark hair.';
    const result = mergeScanResult({ npcs: [npc], turn: 8 }, { npcs: [{
        id: npc.id, name: 'Selene', present: true,
        appearanceState: 'refine',
        appearanceReason: 'The scene clearly describes her build, eyes, skin tone, and the old scar on her cheek for the first time.',
        appearance: 'Young woman with a slim build, olive skin, long dark wavy hair, amber eyes, a narrow face, and a faint scar on her left cheek.',
    }] }, { turn: 9 });
    assert.match(result.state.npcs[0].appearance, /olive skin/i);
    assert.match(result.state.npcs[0].appearance, /amber eyes/i);
    assert.match(result.state.npcs[0].appearance, /scar/i);
});

test('appearance changes require a reason and still respect manual profile locks', () => {
    const npc = createNpcRecord('Toris');
    npc.appearance = 'Broad-shouldered man with a thick brown beard and shoulder-length hair.';
    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Toris', appearanceState: 'change', appearance: 'Clean-shaven with cropped hair.', present: true,
    }] }, { turn: 2 });
    assert.equal(missingReason.state.npcs[0].appearance, npc.appearance, 'appearance change without grounded reason must be ignored');

    npc.manualProfileFields = ['appearance'];
    const locked = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Toris', appearanceState: 'change',
        appearanceReason: 'Months later he has shaved and cut his hair short.', appearance: 'Broad-shouldered man with cropped hair and a clean-shaven jaw.', present: true,
    }] }, { turn: 3 });
    assert.equal(locked.state.npcs[0].appearance, npc.appearance, 'manual Appearance lock must remain authoritative');
});


test('existing speech is keep-by-default and only grounded durable evolution replaces it', () => {
    const npc = createNpcRecord('Marris');
    npc.speech = 'Soft-spoken, hesitant, and prone to trailing off when challenged.';

    const paraphrase = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        speech: 'Quiet and uncertain when speaking.',
    }] }, { turn: 5 });
    assert.equal(paraphrase.state.npcs[0].speech, npc.speech, 'casual speech paraphrase must not rewrite established speech habits');

    const evolved = mergeScanResult(paraphrase.state, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        speechState: 'evolve',
        speechReason: 'After years leading expeditions, she repeatedly speaks in measured direct sentences and gives orders without hedging.',
        developmentScale: 'explicit',
        developmentReason: 'After years leading expeditions, she repeatedly speaks in measured direct sentences and gives orders without hedging.',
        speech: 'Measured and direct, with deliberate pauses; gives concise instructions without her former hesitant trailing-off.',
    }] }, { turn: 6 });
    assert.match(evolved.state.npcs[0].speech, /Measured and direct/i);
    assert.match(evolved.state.npcs[0].speech, /former hesitant/i);
});

test('speech evolution requires a reason and respects manual profile locks', () => {
    const npc = createNpcRecord('Marris');
    npc.speech = 'Formal and careful with strangers.';
    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true, speechState: 'evolve', speech: 'Blunt and casual.',
    }] }, { turn: 2 });
    assert.equal(missingReason.state.npcs[0].speech, npc.speech);

    npc.manualProfileFields = ['speech'];
    const locked = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true, speechState: 'evolve',
        speechReason: 'Years among soldiers changed her habitual register.', speech: 'Blunt and colloquial.',
    }] }, { turn: 3 });
    assert.equal(locked.state.npcs[0].speech, npc.speech, 'manual Speech lock must remain authoritative');
});

test('manual but unlocked speech can refine as recurring speech habits become established', () => {
    const npc = createNpcRecord('Marris');
    npc.speech = 'Soft and formal.';
    npc.manualProfileFields = [];
    const refined = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true, speechState: 'refine',
        speech: 'Soft and formal; uses proper titles, careful requests, and rarely gives direct commands.',
    }] }, { turn: 3 });
    assert.match(refined.state.npcs[0].speech, /proper titles/i);
    assert.match(refined.state.npcs[0].speech, /Soft and formal/i);
});

test('mannerisms are keep-by-default and grounded evolution replaces the current set instead of appending history', () => {
    const npc = createNpcRecord('Marris');
    npc.mannerisms = ['Avoids eye contact when challenged.', 'Twists her sleeves when nervous.'];

    const casual = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true, mannerisms: ['Taps the table while thinking.'],
    }] }, { turn: 5 });
    assert.deepEqual(casual.state.npcs[0].mannerisms, npc.mannerisms, 'unmarked mannerisms must not accumulate forever');

    const evolved = mergeScanResult(casual.state, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        mannerismState: 'evolve',
        mannerismReason: 'Her long-established confidence is now shown repeatedly through steady eye contact, while one old anxiety tell remains.',
        developmentScale: 'explicit',
        developmentReason: 'Her long-established confidence is now shown repeatedly through steady eye contact, while one old anxiety tell remains.',
        mannerisms: ['Holds steady eye contact when making decisions.', 'Rubs her thumb over her knuckles when deeply anxious.'],
    }] }, { turn: 6 });
    assert.deepEqual(evolved.state.npcs[0].mannerisms, [
        'Holds steady eye contact when making decisions.',
        'Rubs her thumb over her knuckles when deeply anxious.',
    ]);
    assert.ok(!evolved.state.npcs[0].mannerisms.some(item => /Twists her sleeves/i.test(item)), 'obsolete mannerisms should retire instead of lingering');
});

test('unlocked mannerisms can refine with newly established habits without replacing the current set', () => {
    const npc = createNpcRecord('Toris');
    npc.mannerisms = ['Scratches his beard before answering.'];
    const refined = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, mannerismState: 'refine',
        mannerisms: ['Habitually squares his shoulders before delivering bad news.'],
    }] }, { turn: 2 });
    assert.deepEqual(refined.state.npcs[0].mannerisms, [
        'Scratches his beard before answering.',
        'Habitually squares his shoulders before delivering bad news.',
    ]);
});

test('mannerism evolution requires grounded evidence and respects manual profile locks', () => {
    const npc = createNpcRecord('Toris');
    npc.mannerisms = ['Scratches his beard before answering.'];
    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, mannerismState: 'evolve', mannerisms: ['Folds his arms while listening.'],
    }] }, { turn: 2 });
    assert.deepEqual(missingReason.state.npcs[0].mannerisms, npc.mannerisms);

    npc.manualProfileFields = ['mannerisms'];
    const locked = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, present: true, mannerismState: 'evolve', mannerismReason: 'The habit changed after he shaved.',
        mannerisms: ['Rubs his jaw before answering.'],
    }] }, { turn: 3 });
    assert.deepEqual(locked.state.npcs[0].mannerisms, npc.mannerisms);
});


test('key relationships are durable social continuity and evolution never erases unrelated bonds by omission', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = [
        'Elena — older sister | close but frequently argumentative',
        'Rook — mentor | trusted adviser',
    ];

    const casual = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true,
        keyRelationships: ['Elena — older sister | angry after today\'s argument'],
    }] }, { turn: 2 });
    assert.deepEqual(casual.state.npcs[0].keyRelationships, npc.keyRelationships, 'temporary social beats must not rewrite durable ties');

    const evolved = mergeScanResult(casual.state, { npcs: [{
        id: npc.id, present: true,
        keyRelationshipsState: 'evolve',
        keyRelationshipsReason: 'Rook died and Marris permanently reconciled with Elena after the funeral.',
        keyRelationships: [
            'Elena — older sister | reconciled and mutually protective',
            'Rook — deceased mentor | mourned and still influential',
        ],
    }] }, { turn: 3 });
    assert.deepEqual(evolved.state.npcs[0].keyRelationships, [
        'Elena — older sister | reconciled and mutually protective',
        'Rook — deceased mentor | mourned and still influential',
    ]);
    assert.equal(evolved.state.npcs[0].keyRelationships.length <= KEY_RELATIONSHIP_LIMIT, true);
});

test('key relationships update merges newly established ties without erasing existing people', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = ['Rook — mentor | trusted adviser'];
    const updated = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id,
        keyRelationshipsState: 'update',
        keyRelationshipsReason: "Elena was explicitly identified as Marris's older sister.",
        keyRelationships: ['Elena — older sister | protective but blunt'],
    }] }, { turn: 2 });
    assert.deepEqual(updated.state.npcs[0].keyRelationships, [
        'Rook — mentor | trusted adviser',
        'Elena — older sister | protective but blunt',
    ]);
});

test('key relationships update refines the same counterpart in place without requiring social evolution', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = [
        'Elena — companion | longstanding familiarity',
        'Rook — mentor | trusted adviser',
    ];
    const updated = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id,
        keyRelationshipsState: 'refine',
        keyRelationshipsReason: "The scene explicitly establishes that Elena is Marris's older sister.",
        keyRelationships: ['Elena — older sister | longstanding familiarity'],
    }] }, { turn: 2 });
    assert.deepEqual(updated.state.npcs[0].keyRelationships, [
        'Elena — older sister | longstanding familiarity',
        'Rook — mentor | trusted adviser',
    ]);
});


test('unmarked scanner extraction can recover only a newly established counterpart', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = ['Rook — mentor | trusted adviser'];
    const recovered = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id,
        keyRelationships: [
            'Rook — mentor | irritated today',
            'Elena — older sister | protective but blunt',
        ],
    }] }, { turn: 2 });
    assert.deepEqual(recovered.state.npcs[0].keyRelationships, [
        'Rook — mentor | trusted adviser',
        'Elena — older sister | protective but blunt',
    ], 'recovery may append a new counterpart but must not rewrite an existing one without lifecycle state');
});
test('key relationships evolution still requires a reason while explicit discovery update does not', () => {
    const npc = createNpcRecord('Toris');
    npc.keyRelationships = ['Myla — patrol partner | close professional trust'];
    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, keyRelationshipsState: 'evolve', keyRelationships: ['Myla — former partner | estranged'],
    }] }, { turn: 2 });
    assert.deepEqual(missingReason.state.npcs[0].keyRelationships, npc.keyRelationships);

    const discovery = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, keyRelationshipsState: 'update', keyRelationships: ['Kera — younger sister | newly established family tie'],
    }] }, { turn: 2 });
    assert.deepEqual(discovery.state.npcs[0].keyRelationships, [
        'Myla — patrol partner | close professional trust',
        'Kera — younger sister | newly established family tie',
    ]);

    npc.manualProfileFields = ['keyRelationships'];
    const locked = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, keyRelationshipsState: 'evolve', keyRelationshipsReason: 'They permanently separated.',
        keyRelationships: ['Myla — former partner | estranged'],
    }] }, { turn: 3 });
    assert.deepEqual(locked.state.npcs[0].keyRelationships, npc.keyRelationships);
});

test('top-level social edges update tracked dossiers even when no NPC delta object is returned', () => {
    const marris = createNpcRecord('Marris');
    marris.keyRelationships = ['Rook — mentor | trusted adviser'];
    const elena = createNpcRecord('Elena');
    const state = { npcs: [marris, elena], candidates: [], dismissed: [], turn: 7 };
    const result = mergeScanResult(state, {
        npcs: [],
        keyRelationshipEdges: [{
            aId: marris.id, a: 'Marris', bId: elena.id, b: 'Elena',
            aToB: 'older sister', bToA: 'younger sibling',
            reason: 'The story explicitly establishes that Elena is Marris\'s older sister.',
        }],
    }, { turn: 7 });
    const updatedMarris = result.state.npcs.find(npc => npc.id === marris.id);
    const updatedElena = result.state.npcs.find(npc => npc.id === elena.id);
    assert.deepEqual(updatedMarris.keyRelationships, [
        'Rook — mentor | trusted adviser',
        'Elena — older sister',
    ]);
    assert.deepEqual(updatedElena.keyRelationships, ['Marris — younger sibling']);
    assert.ok(result.report.updated.includes(marris.id));
    assert.ok(result.report.updated.includes(elena.id));
});

test('explicit possessive relationship statements have a local fallback independent of scanner JSON', () => {
    const marris = createNpcRecord('Marris');
    const elena = createNpcRecord('Elena');
    const edges = extractExplicitKeyRelationshipEdges(
        "Narrator: Elena is Marris's older sister. They have not spoken in years.",
        [marris, elena],
        ['Kazuma'],
    );
    assert.equal(edges.length, 1);
    assert.equal(edges[0].aId, marris.id);
    assert.equal(edges[0].bId, elena.id);
    assert.equal(edges[0].aToB, 'older sister');
    assert.equal(edges[0].bToA, 'younger sibling');
});

test('top-level social edges respect manual Key Relationships locks', () => {
    const marris = createNpcRecord('Marris');
    marris.keyRelationships = ['Rook — mentor'];
    marris.manualProfileFields = ['keyRelationships'];
    const state = { npcs: [marris], candidates: [], dismissed: [], turn: 2 };
    const result = mergeScanResult(state, {
        npcs: [],
        keyRelationshipEdges: [{ aId: marris.id, a: 'Marris', b: 'Elena', aToB: 'older sister' }],
    }, { turn: 2 });
    assert.deepEqual(result.state.npcs[0].keyRelationships, ['Rook — mentor']);
});

test('scanner prompt exposes durable Key Relationships and stable profile context', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = ['Elena — older sister | protective but blunt'];
    const prompt = buildScannerPrompt({ transcript: 'Marris and Elena finally reconcile after years apart.', existingNpcs: [npc] });
    assert.match(prompt, /DURABLE PROFILE CHANNEL/i);
    assert.match(prompt, /ALWAYS top-level keyRelationshipEdges/i);
    assert.match(prompt, /new grounded durable profile facts count as changes/i);
    assert.match(prompt, /aId,a,bId,b,aToB,bToA/i);
    assert.match(prompt, /social change[\s\S]*?evolve/i);
    assert.match(prompt, /"keyRelationships":\["Elena — older sister \| protective but blunt"\]/);
});

test('top-level profileUpdates refine manual unlocked durable fields even when npcs is empty', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Cautious and reserved.';
    npc.speech = 'Soft and formal.';
    npc.manualProfileFields = [];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 3 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            evidence: { personality: ['Uses dry humor with trusted companions.'], speech: ['Consistently addresses elders with proper titles.'] },
            personalityState: 'refine',
            personality: 'Cautious and reserved; dryly humorous with trusted companions.',
            speechState: 'refine',
            speech: 'Soft and formal; consistently uses proper titles for elders.',
        }],
    }, { turn: 4 });
    assert.match(result.state.npcs[0].personality, /dryly humorous/i);
    assert.match(result.state.npcs[0].speech, /proper titles/i);
    assert.deepEqual(result.state.npcs[0].profileEvidence.personality, []);
    assert.deepEqual(result.state.npcs[0].profileEvidence.speech, []);
    assert.deepEqual(result.report.profileUpdated, [npc.id]);
    assert.equal(result.report.profileUpdateStats.applied, 1);
});

test('durable profile evidence accumulates across turns without requiring an immediate rewrite', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Cautious and reserved.';
    npc.speech = 'Soft and formal.';
    const first = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{ id: npc.id, evidence: { speech: ['Uses proper titles when addressing elders.'] } }],
    }, { turn: 2 });
    assert.deepEqual(first.state.npcs[0].profileEvidence.speech, ['Uses proper titles when addressing elders.']);
    assert.equal(first.state.npcs[0].speech, 'Soft and formal.');

    const prompt = buildScannerPrompt({
        transcript: 'She again addresses the elderly knight as Sir and frames her request formally.',
        existingNpcs: [first.state.npcs[0]],
    });
    assert.match(prompt, /recentProfileEvidence/);
    assert.match(prompt, /Uses proper titles when addressing elders/);
    assert.match(prompt, /ALWAYS emit one top-level profileUpdates item/i);
});

test('legacy durable summaries semantically compact duplicate concepts during normalization', () => {
    const npc = normalizeNpcRecord({
        name: 'Astra',
        personality: 'Gentle and soft-spoken; She shares a telepathic link with Ryu and can hear her thoughts; She and Ryu communicate through a telepathic channel that carries thoughts; Gentle and soft-spoken around family.',
    });
    assert.equal((npc.personality.match(/telepath/gi) || []).length, 1, npc.personality);
    assert.equal((npc.personality.match(/Gentle and soft-spoken/gi) || []).length, 1, npc.personality);
    assert.ok(npc.personality.length <= DURABLE_PROFILE_LIMITS.personality);
});

test('mannerism normalization collapses paraphrases of the same habit without deleting distinct habits involving the same person', () => {
    const npc = normalizeNpcRecord({
        name: 'Astra',
        mannerisms: [
            'Presses her forehead to Lucien when seeking reassurance.',
            'When anxious, she presses her forehead against Lucien for reassurance.',
            "Smooths Lucien's sleeve when affectionate.",
            "She smooths Lucien's sleeve as an affectionate habit.",
        ],
    });
    assert.equal(npc.mannerisms.length, 2);
    assert.match(npc.mannerisms.join(' '), /forehead/i);
    assert.match(npc.mannerisms.join(' '), /sleeve/i);
});

test('repeated full-summary profile refinements reconcile instead of growing every scan', () => {
    const npc = createNpcRecord('Astra');
    npc.personality = 'Gentle and soft-spoken; shares a telepathic link with Ryu.';
    let state = { npcs: [npc], candidates: [], turn: 1 };
    const incoming = 'Gentle and soft-spoken; communicates with Ryu through a telepathic channel carrying thoughts; gentle and soft-spoken around family.';
    let firstText = '';
    for (let turn = 2; turn <= 5; turn++) {
        const result = mergeScanResult(state, {
            npcs: [],
            profileUpdates: [{ id: npc.id, personalityState: 'refine', personality: incoming }],
        }, { turn });
        state = result.state;
        if (!firstText) firstText = state.npcs[0].personality;
        else assert.equal(state.npcs[0].personality, firstText, `turn ${turn} should not append another paraphrase`);
    }
    assert.equal((firstText.match(/telepath/gi) || []).length, 1, firstText);
    assert.ok(firstText.length <= DURABLE_PROFILE_LIMITS.personality);
});

test('profile evidence and memories semantically dedupe paraphrased observations', () => {
    const npc = normalizeNpcRecord({
        name: 'Myla',
        profileEvidence: { speech: ['Uses proper titles when speaking to elders.', 'Addresses elders with proper titles.'] },
        memories: ['Aris saved Myla from a lethal ambush.', 'Aris rescued Myla from the lethal ambush.'],
    });
    assert.equal(npc.profileEvidence.speech.length, 1);
    assert.match(npc.profileEvidence.speech[0], /titles/i);
    assert.equal(npc.memories.length, 1);
    assert.match(npc.memories[0], /ambush/i);
});

test('Key Relationships keep one compact entry per counterpart', () => {
    const npc = normalizeNpcRecord({
        name: 'Marris',
        keyRelationships: [
            'Elena — older sister | protective',
            'Elena — sister | protective and blunt',
        ],
    });
    assert.equal(npc.keyRelationships.length, 1);
    assert.match(npc.keyRelationships[0], /^Elena\s+—/);
    assert.match(npc.keyRelationships[0], /blunt/i);
});

test('legacy auto-locks migrate to organic baselines while explicit v0.1.57 locks remain authoritative', () => {
    const legacy = normalizeNpcRecord({
        name: 'Marris', personality: 'Reserved.', speech: 'Soft.',
        manualProfileFields: ['personality', 'speech'],
    });
    assert.deepEqual(legacy.manualProfileFields, []);
    assert.equal(legacy.manualProfileLocksExplicit, false);

    const explicit = normalizeNpcRecord({
        name: 'Marris', personality: 'Reserved.',
        manualProfileFields: ['personality'], manualProfileLocksExplicit: true,
    });
    assert.deepEqual(explicit.manualProfileFields, ['personality']);
    assert.equal(explicit.manualProfileLocksExplicit, true);
});

test('pronoun-only current exchange still supplies one recent stable profile for durable evaluation', () => {
    const npc = createNpcRecord('Marris');
    npc.present = true; npc.lastSeenTurn = 8; npc.personality = 'Reserved.'; npc.speech = 'Soft and formal.';
    const prompt = buildScannerPrompt({
        transcript: 'She folds her hands, addresses the elder as Sir, and makes the request with careful courtesy.',
        existingNpcs: [npc],
    });
    assert.match(prompt, /"name":"Marris"/);
    assert.match(prompt, /"speech":"Soft and formal\."/);
});

test('explicit dossier import maps Megumin Inner Circle without manufacturing player relationship scores', () => {
    const npc = createNpcRecord('Luna');
    const prompt = buildDossierImportPrompt({
        targetName: 'Luna',
        existingNpc: npc,
        userName: 'Aris',
        charName: 'Megumin',
        dossierText: `<New_NPC name="Luna">\n**Age:** 24\n**Voice:** clipped and formal\n**Inner Circle:**\n* Mara — younger sister | fiercely protective\n* Dain — old rival | grudging respect\n**Read on the PC:** Wary but curious\n</New_NPC>`,
    });
    assert.match(prompt, /Inner Circle \/ family \/ close allies \/ rivals \/ mentors \/ partners => keyRelationships/i);
    assert.match(prompt, /Never invent numeric Trust\/Affection\/Desire\/Tension/i);
    assert.match(prompt, /Where to Find Them.*NOT current Location/i);
    assert.match(prompt, /relationshipDelta":\{"trust":0,"affection":0,"desire":0,"tension":0\}/);
});

test('scanner prompt defines appearance as durable image-ready detail with refine/change lifecycle', () => {
    const npc = createNpcRecord('Selene');
    npc.appearance = 'Young woman with dark hair.';
    const prompt = buildScannerPrompt({
        transcript: "Later, the narration clearly reveals Selene's amber eyes, olive skin, slim build, and the faint scar under her left eye. Years later, she cuts her hair to her shoulders.",
        existingNpcs: [npc],
    });
    assert.match(prompt, /DURABLE PROFILE CHANNEL/i);
    assert.match(prompt, /matching \*State:"refine"/i);
    assert.match(prompt, /appearance "change"\+reason/i);
    assert.match(prompt, /Ignore transient visual state/i);
    assert.match(prompt, /"appearance":"Young woman with dark hair\."/);
});

test('scanner prompt defines speech and mannerisms as evolving durable identity rather than append-only observations', () => {
    const npc = createNpcRecord('Marris');
    npc.speech = 'Soft-spoken and hesitant.';
    npc.mannerisms = ['Avoids eye contact.', 'Twists her sleeves when nervous.'];
    const prompt = buildScannerPrompt({
        transcript: 'Years later, Marris now gives calm direct orders and consistently holds eye contact when making decisions.',
        existingNpcs: [npc],
    });
    assert.match(prompt, /profileUpdates/i);
    assert.match(prompt, /matching \*State:"refine"/i);
    assert.match(prompt, /personality\/speech\/mannerism "evolve"\+reason/i);
    assert.match(prompt, /mannerisms FULL max4/i);
    assert.match(prompt, /social change[\s\S]*?omission NEVER erases/i);
    assert.match(prompt, /DURABLE PROFILE CHANNEL/i);
    assert.match(prompt, /"speech":"Soft-spoken and hesitant\."/);
    assert.match(prompt, /"mannerisms":\["Avoids eye contact\.","Twists her sleeves when nervous\."\]/);
});

test('scanner prompt defines personality as gradual durable development rather than transient emotion', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Shy and approval-seeking.';
    const prompt = buildScannerPrompt({
        transcript: 'Five years later, Marris is older. She calmly refuses her sister\'s order and makes the decision herself, as she has throughout the past year.',
        existingNpcs: [npc],
    });
    assert.match(prompt, /DURABLE PROFILE CHANNEL/i);
    assert.match(prompt, /profileUpdates/i);
    assert.match(prompt, /matching \*State:"refine"/i);
    assert.match(prompt, /personality\/speech\/mannerism "evolve"\+reason/i);
    assert.match(prompt, /time skip alone invents nothing/i);
        assert.match(prompt, /"personality":"Shy and approval-seeking\."/);
});

test('chronological age is keep-by-default and grounded advancement updates it automatically', () => {
    const npc = createNpcRecord('Marris');
    npc.age = '15';

    const casual = mergeScanResult({ npcs: [npc], turn: 10 }, { npcs: [{
        id: npc.id, name: 'Marris', present: true, age: '18',
    }] }, { turn: 11 });
    assert.equal(casual.state.npcs[0].age, '15', 'unmarked age rewrites must not silently change established chronology');

    const advanced = mergeScanResult(casual.state, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        ageState: 'advance', ageReason: 'Three explicit years have passed since she was established as age 15.', age: '18',
    }] }, { turn: 12 });
    assert.equal(advanced.state.npcs[0].age, '18');

    const backward = mergeScanResult(advanced.state, { npcs: [{
        id: npc.id, name: 'Marris', present: true,
        ageState: 'advance', ageReason: 'Another scene mentions her age.', age: '17',
    }] }, { turn: 13 });
    assert.equal(backward.state.npcs[0].age, '18', 'advance must never decrease an exact chronological age');
});

test('chronological age correction requires evidence and manual age locks remain authoritative', () => {
    const npc = createNpcRecord('Selene');
    npc.age = '24';

    const missingReason = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, ageState: 'correct', age: '23',
    }] }, { turn: 2 });
    assert.equal(missingReason.state.npcs[0].age, '24');

    const corrected = mergeScanResult(missingReason.state, { npcs: [{
        id: npc.id, present: true, ageState: 'correct', ageReason: 'Her birth record explicitly corrects the earlier age.', age: '23',
    }] }, { turn: 3 });
    assert.equal(corrected.state.npcs[0].age, '23');

    corrected.state.npcs[0].manualProfileFields = ['age'];
    const locked = mergeScanResult(corrected.state, { npcs: [{
        id: npc.id, present: true, ageState: 'advance', ageReason: 'A year passes.', age: '24',
    }] }, { turn: 4 });
    assert.equal(locked.state.npcs[0].age, '23', 'manual Age lock must remain authoritative');
});

test('apparent age is keep-by-default and evolves only from grounded visual aging evidence', () => {
    const npc = createNpcRecord('Marris');
    npc.apparentAge = '~15';

    const casual = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, apparentAge: '~18',
    }] }, { turn: 2 });
    assert.equal(casual.state.npcs[0].apparentAge, '~15');

    const evolved = mergeScanResult(casual.state, { npcs: [{
        id: npc.id, present: true,
        apparentAgeState: 'evolve',
        apparentAgeReason: 'After the three-year skip she is explicitly described as visibly older and now looks about eighteen.',
        apparentAge: '~18',
    }] }, { turn: 3 });
    assert.equal(evolved.state.npcs[0].apparentAge, '~18');

    evolved.state.npcs[0].manualProfileFields = ['apparentAge'];
    const locked = mergeScanResult(evolved.state, { npcs: [{
        id: npc.id, present: true, apparentAgeState: 'evolve',
        apparentAgeReason: 'A rejuvenation spell makes her visibly younger.', apparentAge: '~16',
    }] }, { turn: 4 });
    assert.equal(locked.state.npcs[0].apparentAge, '~18', 'manual Apparent Age lock must remain authoritative');
});

test('scanner exposes age for every relevant NPC and defines automatic age/apparent-age evolution contract', () => {
    const myla = createNpcRecord('Myla'); myla.id = 'npc_myla'; myla.age = '20'; myla.apparentAge = '~20';
    const toris = createNpcRecord('Toris'); toris.id = 'npc_toris'; toris.age = '43'; toris.apparentAge = '~45';
    const luna = createNpcRecord('Luna'); luna.id = 'npc_luna'; luna.age = '15'; luna.apparentAge = '~15';
    const prompt = buildScannerPrompt({
        transcript: 'Myla and Toris remember Luna at fifteen. Three years later, Luna returns visibly older and now looks about eighteen.',
        existingNpcs: [myla, toris, luna],
    });
    assert.match(prompt, /Age\/ApparentAge separate/i);
    assert.match(prompt, /ageState:"advance"/i);
    assert.match(prompt, /ageState:"correct"/i);
    assert.match(prompt, /apparentAgeState:"evolve"/i);
    assert.match(prompt, /ageState:"advance"/i);
    assert.match(prompt, /no species-aging inference/i);
    assert.match(prompt, /"age":"15"/);
    assert.match(prompt, /"apparentAge":"~15"/);
    assert.match(prompt, /ageState:"advance"\+reason/i);
    assert.match(prompt, /apparentAgeState:"evolve"\+reason/i);
});

test('unknown age placeholders never erase established chronological or apparent age', () => {
    const npc = createNpcRecord('Selene');
    npc.age = '143';
    npc.apparentAge = 'early thirties';
    const result = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Selene', age: 'Unknown', apparentAge: 'unknown', present: true,
    }] }, { turn: 2 });
    assert.equal(result.state.npcs[0].age, '143');
    assert.match(result.state.npcs[0].apparentAge, /^~3\d$/);
});

test('exact chronological age is not replaced by later qualitative visual age evidence', () => {
    const npc = createNpcRecord('Marris');
    npc.age = '24';
    const result = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Marris', age: 'young', present: true,
    }] }, { turn: 2 });
    assert.equal(result.state.npcs[0].age, '24');
    assert.match(result.state.npcs[0].apparentAge, /^~\d+$/);
});

test('scanner prompt separates chronological/apparent age and requests grounded prompt-ready appearance', () => {
    const npc = createNpcRecord('Yunyun');
    npc.age = '18';
    npc.apparentAge = '~18';
    npc.appearance = 'Young woman with long dark brown hair, crimson eyes, a slim build, and a black-and-red adventurer outfit.';
    const prompt = buildScannerPrompt({ transcript: 'Yunyun changes into a formal crimson dress.', existingNpcs: [npc], userName: 'Kazuma', charName: 'Megumin' });
    assert.match(prompt, /age=chronology only/i);
    assert.match(prompt, /apparentAge=visual cue/i);
    assert.match(prompt, /species literal/i);
    assert.match(prompt, /DURABLE PROFILE CHANNEL/i);
    assert.match(prompt, /vague time skip insufficient/i);
    assert.match(prompt, /Stable profile context/i);
    assert.match(prompt, /"age":"18"/);
    assert.match(prompt, /"apparentAge":"~18"/);
    assert.match(prompt, /long dark brown hair/);
});

test('scanner prompt uses compact identity index, changed-only output, delta relationships, and player tuning', () => {
    const prompt = buildScannerPrompt({
        transcript: 'Yunyun: Hello', existingNpcs: [], userName: 'Kazuma', charName: 'Megumin', maxNpcs: 5,
        relationshipBaseline: { trust: 40, affection: 10, desire: 2, tension: 5 },
        relationshipCaps: { ordinary: 2, meaningful: 6, major: 12, extreme: 20 },
        relationshipCriteria: 'CUSTOM TRUST RULE', impactCriteria: 'CUSTOM IMPACT RULE', memoryCriteria: 'CUSTOM MEMORY RULE',
    });
    assert.match(prompt, /Exclude player \(Kazuma\)/);
    assert.match(prompt, /main speaker \(Megumin\)/);
    assert.match(prompt, /Return ONLY observed\/new\/meaningfully changed NPCs/i);
    assert.match(prompt, /Identity index \(matching only\)/i);
    assert.match(prompt, /include name,identityKind,dossierSignal/i);
    assert.match(prompt, /include name,identityKind,dossierSignal/i);
    assert.match(prompt, /directInteraction affects admission\/relationship only/i);
    assert.match(prompt, /First-seen role_label ALWAYS stays candidate/i);
    assert.match(prompt, /regardless of dossierSignal\/directInteraction/i);
    assert.match(prompt, /sameIndividual=true only when/i);
    assert.match(prompt, /Identity promotion: role\/interim dossier \+ grounded proper name/i);
    assert.match(prompt, /MUST reuse id/i);
    assert.match(prompt, /old label in aliases/i);
    assert.match(prompt, /never duplicate\/downgrade/i);
    assert.match(prompt, /EVERY non-zero axis needs grounded CURRENT-exchange evidence/i);
    assert.match(prompt, /-100\.\.\+100/i);
    assert.match(prompt, /continuation\/aftermath=>0/i);
    assert.match(prompt, /CUSTOM TRUST RULE/);
    assert.match(prompt, /CUSTOM IMPACT RULE/);
    assert.match(prompt, /CUSTOM MEMORY RULE/);
    assert.doesNotMatch(prompt, /"respect"/);
});

test('new dossier-worthy NPCs receive full grounded first-pass enrichment without player interaction', () => {
    const prompt = buildScannerPrompt({
        transcript: 'Captain Selene Voss stands at the eastern gate. The silver-haired elf wears a weathered blue coat over chainmail and watches the missing patrol route with visible worry. World State: Selene Voss | Mood: worried | Agenda: find the missing patrols.',
        admissionMode: 'conservative',
        userName: 'Aris',
        charName: 'Ersveil',
    });
    assert.match(prompt, /NEW dossier-worthy NPCs get a grounded first-pass profile/i);
    assert.match(prompt, /populate every grounded field now/i);
        assert.match(prompt, /NEVER enrichment/i);
    assert.match(prompt, /Incidental role candidates may stay lightweight/i);
    assert.match(prompt, /Use narration, World State, durable Inner Chatter/i);
    assert.match(prompt, /NEW\/CANDIDATE: include name,identityKind/i);
    assert.match(prompt, /directInteraction,present,worldActive/i);
    assert.match(prompt, /populate every grounded field now/i);
    assert.match(prompt, /compact behaviorProfile rules/i);
});

test('non-interacting proper-name NPC creation preserves every supplied grounded dossier field', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 0 }, { npcs: [{
        name: 'Selene Voss',
        identityKind: 'proper_name',
        dossierSignal: 'incidental',
        dossierReason: 'Named individual observed at the gate.',
        directInteraction: false,
        present: true,
        worldActive: false,
        role: 'Gate captain',
        species: 'elf',
        apparentAge: 'early thirties',
        appearance: 'Silver-haired elf in a weathered blue coat over chainmail.',
        personality: 'Watchful and duty-bound.',
        speech: 'Crisp military phrasing.',
        background: 'Commands the eastern gate patrols.',
        mood: 'Worried',
        location: 'Eastern gate',
        goal: 'Find the missing patrols',
        status: 'Monitoring the patrol road.',
        mannerisms: ['Checks the road between conversations.'],
        memories: ['Two patrols failed to return from the eastern road.'],
        lifeState: 'alive',
        lifeStateCertainty: 'explicit',
    }] }, { turn: 1, admissionMode: 'conservative' });
    assert.equal(result.state.npcs.length, 1, 'proper names should be admitted in Conservative mode without PC interaction');
    const npc = result.state.npcs[0];
    assert.equal(npc.name, 'Selene Voss');
    assert.equal(npc.role, 'Gate captain');
    assert.equal(npc.species, 'elf');
    assert.match(npc.apparentAge, /^~3\d$/);
    assert.match(npc.appearance, /Silver-haired elf/);
    assert.equal(npc.personality, 'Watchful and duty-bound.');
    assert.equal(npc.speech, 'Crisp military phrasing.');
    assert.equal(npc.background, 'Commands the eastern gate patrols.');
    assert.equal(npc.mood, 'Worried');
    assert.equal(npc.location, 'Eastern gate');
    assert.equal(npc.goal, 'Find the missing patrols');
    assert.equal(npc.status, 'Monitoring the patrol road.');
    assert.deepEqual(npc.mannerisms, ['Checks the road between conversations.']);
    assert.deepEqual(npc.memories, ['Two patrols failed to return from the eastern road.']);
    assert.equal(npc.present, true);
    assert.equal(npc.lifeState, 'alive');
});

test('important memory criteria are explicit, configurable, and existing memories are supplied for dedupe', () => {
    const npc = createNpcRecord('Myla Fenn');
    npc.id = 'npc_myla';
    npc.memories = [
        'Aris returned the tags of two dead adventurers, forcing Myla to confront the consequences of the guild quota system.',
        'Myla offered unlogged emergency funds to buy Aris\'s silence and avoid arrest.',
    ];
    const prompt = buildScannerPrompt({
        transcript: 'Myla thanks Aris for keeping the tags private and promises to warn future recruits.',
        existingNpcs: [npc],
        memoryCriteria: 'CUSTOM MEMORY: persist promises and consequential discoveries; reject routine greetings.',
    });
    assert.match(prompt, /Memory criteria:/i);
    assert.match(prompt, /CUSTOM MEMORY: persist promises/i);
    assert.match(prompt, /no duplicate\/paraphrased memories/i);
    assert.match(prompt, /Aris returned the tags of two dead adventurers/);
    assert.match(prompt, /cap5/i);
    assert.match(prompt, /memoryRetention/i);
    assert.match(prompt, /consequential\/durable/i);
    assert.match(prompt, /recency=tiebreak only/i);

    const defaultPrompt = buildScannerPrompt({ transcript: 'Marris makes a consequential promise.', memoryCriteria: DEFAULT_MEMORY_CRITERIA });
    assert.match(defaultPrompt, /durable story-relevant events/i);
    assert.match(defaultPrompt, /Reject routine dialogue\/transactions/i);
});

test('important memories cap at five and semantic retention can keep older defining events', () => {
    assert.equal(IMPORTANT_MEMORY_LIMIT, 5);
    const npc = createNpcRecord('Myla Fenn');
    npc.id = 'npc_myla';
    npc.memories = [
        'Aris saved Myla from a lethal ambush.',
        'Myla learned Aris dislikes bitter tea.',
        "Aris kept Myla's secret from the guildmaster.",
        'Myla promised to warn Aris about future quota changes.',
        "Aris returned the dead adventurers' tags to their families.",
    ];
    const result = mergeScanResult({ npcs: [npc], turn: 5 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false,
        memories: ['Myla discovered the guildmaster forged the quota ledger.'],
        memoryRetention: [
            'Aris saved Myla from a lethal ambush.',
            'Myla discovered the guildmaster forged the quota ledger.',
            "Aris kept Myla's secret from the guildmaster.",
            'Myla promised to warn Aris about future quota changes.',
            "Aris returned the dead adventurers' tags to their families.",
        ],
    }] }, { turn: 6 });
    assert.deepEqual(result.state.npcs[0].memories, [
        'Aris saved Myla from a lethal ambush.',
        'Myla discovered the guildmaster forged the quota ledger.',
        "Aris kept Myla's secret from the guildmaster.",
        'Myla promised to warn Aris about future quota changes.',
        "Aris returned the dead adventurers' tags to their families.",
    ]);
    assert.doesNotMatch(result.state.npcs[0].memories.join(' '), /bitter tea/i);
});

test('full important-memory lists admit new memories even if the scanner omits retention', () => {
    const npc = createNpcRecord('Marris');
    npc.id = 'npc_marris';
    npc.memories = ['old-1', 'old-2', 'old-3', 'old-4', 'old-5'];
    const result = mergeScanResult({ npcs: [npc], turn: 3 }, { npcs: [{
        id: 'npc_marris', present: true, worldActive: false, memories: ['new-6'],
    }] }, { turn: 4 });
    assert.deepEqual(result.state.npcs[0].memories, ['old-2', 'old-3', 'old-4', 'old-5', 'new-6']);
});

test('legacy stored memory overflow normalizes to the most recent five', () => {
    const npc = normalizeNpcRecord({ name: 'Luna', memories: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] });
    assert.deepEqual(npc.memories, ['m4', 'm5', 'm6', 'm7', 'm8']);
});

test('generation injection includes the retained Important Memories as high-priority continuity', () => {
    const npc = createNpcRecord('Myla Fenn');
    npc.present = true;
    npc.lastSeenTurn = 10;
    npc.memories = [
        'Aris saved Myla from a lethal ambush.',
        "Aris kept Myla's secret from the guildmaster.",
        'Myla promised to warn Aris about future quota changes.',
        "Aris returned the dead adventurers' tags to their families.",
        'Myla discovered the guildmaster forged the quota ledger.',
    ];
    const injection = buildInjection([npc], 'Myla Fenn enters the room.', 10, 1, 'CUSTOM BEHAVIOR RUBRIC', 1800);
    assert.match(injection, /important memories:/i);
    for (const memory of npc.memories) assert.ok(injection.includes(memory), `missing injected memory: ${memory}`);
});

test('focused relationship pass requires one full four-axis decision per target', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.relationship = { trust: 25, affection: 12, desire: 0, tension: -4 };
    npc.relationshipSummary = 'She trusts the player but remains wary of promises.';
    const prompt = buildRelationshipPassPrompt({
        transcript: 'Aris knowingly betrays Myla to the guildmaster, exposing the secret she trusted him to protect.',
        targets: [npc],
        userName: 'Aris',
        relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 },
    });
    assert.match(prompt, /focused relationship evaluator/i);
    assert.match(prompt, /exactly one result for EACH target id/i);
    assert.match(prompt, /ALL FOUR numeric keys/i);
    assert.match(prompt, /relationshipEvidence is REQUIRED with ALL FOUR string keys/i);
    assert.match(prompt, /actions and consequences, not just dialogue/i);
    assert.match(prompt, /Raw maxima are ordinary 1 \/ meaningful 2 \/ major 5 \/ extreme 10/i);
    assert.match(prompt, /Most events move 0-1 axes/i);
    assert.match(prompt, /relationshipSummary is REQUIRED/i);
    assert.match(prompt, /COPY IT EXACTLY/i);
    assert.match(prompt, /major\/extreme turning point MUST rewrite an old summary/i);
    assert.match(prompt, /durable prose Relationship field/i);
    assert.match(prompt, /"currentRelationship":\{"trust":25,"affection":12,"desire":0,"tension":-4\}/);
    assert.match(prompt, /"relationshipSummary":"She trusts the player but remains wary of promises\."/);
    assert.match(prompt, /Current exchange:/i);
});

test('scanner relationship contract requires independent multi-axis deltas', () => {
    const promptNpc = createNpcRecord('Myla');
    promptNpc.id = 'npc_myla';
    promptNpc.relationship = { trust: 20, affection: 5, desire: 0, tension: 7 };
    const prompt = buildScannerPrompt({
        transcript: 'Myla learns the player protected her, reassures her, and admits caring about her.',
        existingNpcs: [promptNpc],
        relationshipCriteria: undefined,
        impactCriteria: undefined,
    });
    assert.match(prompt, /relationshipDelta\+relationshipEvidence \(all 4 keys\)/i);
    assert.match(prompt, /axis max 1\/2\/3\/4/i);
    assert.match(prompt, /EVERY non-zero axis needs grounded CURRENT-exchange evidence/i);
    assert.match(prompt, /DELTA-ONLY/i);
    assert.match(prompt, /currentRelationship read-only/i);
    assert.match(prompt, /Desire needs explicit attraction/i);
    assert.match(prompt, /"currentRelationship":\{"trust":20,"affection":5,"desire":0,"tension":7\}/);
    assert.match(prompt, /"trust":-2,"affection":0,"desire":0,"tension":2/);

    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    const merged = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false,
        relationshipImpact: 'meaningful',
        relationshipDelta: { trust: 6, affection: 4, desire: 2, tension: -5 },
        relationshipEvidence: { trust: 'The player protected Myla, proving reliable.', affection: 'His care deepened their emotional bond.', desire: 'Myla explicitly admitted romantic attraction.', tension: 'The reassurance eased her fear and tension.' },
        relationshipChangeReason: 'Protection, bonding, explicit attraction, and reduced fear all occur in the same event.',
    }] }, { turn: 2, relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 } });
    assert.deepEqual(merged.state.npcs[0].relationship, { trust: 6, affection: 0, desire: 0, tension: -5 }, 'custom legacy-sized caps remain user-authoritative, but meaningful still affects at most two axes');
    assert.deepEqual(merged.state.npcs[0].lastRelationshipChange.delta, { trust: 6, affection: 0, desire: 0, tension: -5 });
});

test('scanner prompt exposes admission modes while manual backfill uses a dedicated targeted extractor', () => {
    const conservative = buildScannerPrompt({ transcript: 'A guard takes two copper.', admissionMode: 'conservative' });
    assert.match(conservative, /CONSERVATIVE:/);
    assert.match(conservative, /first-seen role_label ALWAYS stays candidate/i);
    assert.match(conservative, /same-person recurrence/i);
    assert.match(conservative, /World State, durable Inner Chatter.*Proper names there MUST be returned/i);
    const balanced = buildScannerPrompt({ transcript: 'The receptionist answers.', admissionMode: 'balanced' });
    assert.match(balanced, /BALANCED:/);
    assert.match(balanced, /direct two-way player interaction/);
    const manual = buildScannerPrompt({ transcript: 'Marris waves.', admissionMode: 'manual_only' });
    assert.match(manual, /MANUAL ONLY:/);

    const existing = createNpcRecord('Toris');
    const backfill = buildBackfillPrompt({
        transcript: 'World State: Toris (Receptionist): working the desk. NPC Inner Chatter: Toris: More forms.',
        targetName: 'Toris',
        existingNpc: existing,
        userName: 'Aris',
        charName: 'Narrator',
        memoryCriteria: 'BACKFILL MEMORY RULE: keep durable promises; reject routine service.',
    });
    assert.match(backfill, /targeted dossier backfill extractor/i);
    assert.match(backfill, /player EXPLICITLY chose to keep one NPC/i);
    assert.match(backfill, /Requested NPC: Toris/);
    assert.match(backfill, /RETURN EXACTLY ONE NPC object/i);
    assert.match(backfill, /PRESENT is current-scene state/i);
    assert.match(backfill, /MOST RECENT ASSISTANT STORY MESSAGE/i);
    assert.match(backfill, /relationshipImpact MUST be "none"/i);
    assert.match(backfill, /Keep the JSON compact enough to finish reliably/i);
    assert.match(backfill, /Finish and close every quoted string/i);
    assert.match(backfill, /Memory criteria:/i);
    assert.match(backfill, /BACKFILL MEMORY RULE/);
    assert.match(backfill, /Important Memories are capped at 5/i);
    assert.match(backfill, /memoryRetention/i);
    assert.match(backfill, /most consequential\/durable/i);
    assert.doesNotMatch(backfill, /CONSERVATIVE:|Impact-tier criteria configured by player/);
});

test('scanner context includes mentioned/recent NPC details but not the whole roster payload', () => {
    const roster = Array.from({ length: 40 }, (_, i) => {
        const npc = createNpcRecord(`NPC ${i + 1}`);
        npc.appearance = `UNIQUE_VISUAL_${i + 1}_` + 'x'.repeat(700);
        npc.lastSeenTurn = i;
        return npc;
    });
    roster[4].name = 'Marris';
    roster[4].appearance = 'MARRIS_VISUAL dark hair and ink-stained apron.';
    const selected = selectScannerContextNpcs(roster, 'Marris hands Aris the registration form.', 6);
    assert.ok(selected.some(npc => npc.name === 'Marris'));
    const prompt = buildScannerPrompt({ transcript: 'Marris hands Aris the registration form.', existingNpcs: roster });
    assert.match(prompt, /MARRIS_VISUAL/);
    assert.doesNotMatch(prompt, /UNIQUE_VISUAL_1_/);
    assert.ok(prompt.length < 11000, `scanner prompt should stay compact, got ${prompt.length} chars`);
});

test('existing scanner deltas may use dossier id without repeating name or unchanged profile fields', () => {
    const npc = createNpcRecord('Myla Fenn');
    npc.id = 'npc_myla';
    npc.appearance = 'Established appearance that must survive a compact delta.';
    npc.importance = 77;
    const result = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false, mood: 'terrified',
        relationshipImpact: 'meaningful', relationshipDelta: { tension: 8 },
        relationshipEvidence: { trust: '', affection: '', desire: '', tension: 'The threat created fear and unresolved tension.' },
        relationshipChangeReason: 'A threat in the current exchange raised Myla\'s tension.',
    }] }, { turn: 5, relationshipCaps: { ordinary: 4, meaningful: 8, major: 15, extreme: 25 } });
    const updated = result.state.npcs[0];
    assert.equal(updated.name, 'Myla Fenn');
    assert.equal(updated.present, true);
    assert.equal(updated.mood, 'terrified');
    assert.equal(updated.appearance, 'Established appearance that must survive a compact delta.');
    assert.equal(updated.importance, 77, 'omitting importance in a delta must preserve the stored value');
    assert.equal(updated.relationship.tension, 8);
});

test('goal lifecycle preserves unchanged goals, replaces new objectives, and explicitly clears completed goals', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.goal = 'Reach the capital';

    const unchanged = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false,
    }] }, { turn: 2 });
    assert.equal(unchanged.state.npcs[0].goal, 'Reach the capital');

    const replaced = mergeScanResult(unchanged.state, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false, goal: 'Find the missing courier',
    }] }, { turn: 3 });
    assert.equal(replaced.state.npcs[0].goal, 'Find the missing courier');

    const cleared = mergeScanResult(replaced.state, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false, goalState: 'clear',
    }] }, { turn: 4 });
    assert.equal(cleared.state.npcs[0].goal, '');
});

test('status lifecycle preserves active status, replaces changed condition, and explicitly clears resolved status', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.status = 'Badly wounded and unable to stand';

    const unchanged = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false,
    }] }, { turn: 2 });
    assert.equal(unchanged.state.npcs[0].status, 'Badly wounded and unable to stand');

    const replaced = mergeScanResult(unchanged.state, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false, status: 'Bandaged and walking with a limp',
    }] }, { turn: 3 });
    assert.equal(replaced.state.npcs[0].status, 'Bandaged and walking with a limp');

    const cleared = mergeScanResult(replaced.state, { npcs: [{
        id: 'npc_myla', present: true, worldActive: false, statusState: 'clear',
    }] }, { turn: 4 });
    assert.equal(cleared.state.npcs[0].status, '');
});

test('mood and location are live fields that replace or explicitly clear when story state changes', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.mood = 'Furious and frightened';
    npc.location = 'Bluewatch Guildhall';

    const unchanged = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, worldActive: false,
    }] }, { turn: 2 });
    assert.equal(unchanged.state.npcs[0].mood, 'Furious and frightened');
    assert.equal(unchanged.state.npcs[0].location, 'Bluewatch Guildhall');

    const replaced = mergeScanResult(unchanged.state, { npcs: [{
        id: npc.id, present: true, worldActive: false, mood: 'Relieved but exhausted', location: 'South Gate infirmary',
    }] }, { turn: 3 });
    assert.equal(replaced.state.npcs[0].mood, 'Relieved but exhausted');
    assert.equal(replaced.state.npcs[0].location, 'South Gate infirmary');

    const cleared = mergeScanResult(replaced.state, { npcs: [{
        id: npc.id, present: false, worldActive: true, moodState: 'clear', locationState: 'clear',
    }] }, { turn: 4 });
    assert.equal(cleared.state.npcs[0].mood, '');
    assert.equal(cleared.state.npcs[0].location, '');
});

test('scanner treats status mood goal and location as actively reassessed live state and exposes stored values beyond profile tier', () => {
    const myla = createNpcRecord('Myla'); myla.id = 'npc_myla'; myla.mood = 'Anxious'; myla.location = 'Guildhall';
    const toris = createNpcRecord('Toris'); toris.id = 'npc_toris'; toris.mood = 'Watchful'; toris.location = 'Front gate';
    const luna = createNpcRecord('Luna'); luna.id = 'npc_luna'; luna.mood = 'Relieved'; luna.location = 'Infirmary';
    const prompt = buildScannerPrompt({
        transcript: 'Myla speaks to Toris while Luna leaves the infirmary for an unknown destination.',
        existingNpcs: [myla, toris, luna],
    });
    assert.match(prompt, /Goal\/status\/mood\/location are LIVE/i);
    assert.match(prompt, /actively reassess each returned EXISTING NPC every scan/i);
    assert.match(prompt, /locationState:"clear"/i);
    assert.match(prompt, /Off-screen\/no evidence alone never clears it/i);
    assert.match(prompt, /"mood":"Relieved"/);
    assert.match(prompt, /"location":"Infirmary"/);
});

test('full-window scanner reconciles history while isolating live state and relationship deltas to current exchange', () => {
    const luna = createNpcRecord('Luna');
    luna.id = 'npc_luna';
    luna.personality = 'Reserved and courteous.';
    luna.speech = 'Soft and formal.';
    const prompt = buildScannerPrompt({
        transcript: 'Earlier: Luna reveals that she is fiercely competitive.\nLater: Luna consistently addresses elders by title.\nCurrent: Luna quietly greets the player.',
        currentTranscript: 'Current: Luna quietly greets the player.',
        existingNpcs: [luna],
        fullScanMode: true,
    });
    assert.match(prompt, /FULL-WINDOW RECONCILIATION/);
    assert.match(prompt, /recover missed durable facts/);
    assert.match(prompt, /Numeric relationshipImpact\/relationshipDelta MUST use only CURRENT exchange/);
    assert.match(prompt, /anywhere in the supplied recent-history window/);
    assert.match(prompt, /CURRENT exchange \(authoritative for presence\/live state and numeric relationship deltas\):\nCurrent: Luna quietly greets the player/);
});

test('scanner exposes stored status for every relevant NPC and provides an explicit status clear contract', () => {
    const myla = createNpcRecord('Myla');
    myla.id = 'npc_myla';
    myla.status = 'Recovering from a broken arm';
    const toris = createNpcRecord('Toris');
    toris.id = 'npc_toris';
    toris.status = 'Keeping watch at the guild door';
    const luna = createNpcRecord('Luna');
    luna.id = 'npc_luna';
    luna.status = 'Waiting for the physician';

    const prompt = buildScannerPrompt({
        transcript: 'Myla greets Toris while Luna says the physician has arrived and she no longer needs to wait.',
        existingNpcs: [myla, toris, luna],
        admissionMode: 'conservative',
    });
    assert.match(prompt, /Goal\/status\/mood\/location are LIVE/i);
    assert.match(prompt, /matching \*State:"clear"/i);
    assert.match(prompt, /"status":"Waiting for the physician"/);
    assert.match(prompt, /status,statusState/i);
    assert.match(prompt, /lifeState unknown\|alive\|deceased/i);
});

test('scanner prompt explicitly evaluates existing goal lifecycle and exposes current goals in live context', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    npc.goal = 'Reach the capital';
    const prompt = buildScannerPrompt({
        transcript: 'Myla steps through the capital gates and says the journey is finally over.',
        existingNpcs: [npc],
        admissionMode: 'conservative',
    });
    assert.match(prompt, /Goal\/status\/mood\/location are LIVE/i);
    assert.match(prompt, /goalState/i);
    assert.match(prompt, /Unchanged -> omit/i);
    assert.match(prompt, /"goal":"Reach the capital"/);
    assert.match(prompt, /Never use "Unknown"/i);
});

test('routine scanner prompt has bounded overhead and delta/profile tiers', () => {
    const toris = createNpcRecord('Toris Vance');
    toris.id = 'npc_toris';
    toris.role = 'Former adventurer / Guild patron';
    toris.appearance = 'Broad grizzled man in worn leather armor with a scar along his neck.';
    toris.background = 'Former adventurer who now watches the Bluewatch guildhall.';
    toris.relationshipSummary = 'Cautiously reassessing the player.';
    toris.relationship.tension = -4;
    const myla = createNpcRecord('Myla Fenn');
    myla.id = 'npc_myla';
    myla.role = 'Adventurer Guild Receptionist';
    myla.appearance = 'Young woman in a faded linen blouse and practical skirt.';
    myla.background = 'Bluewatch guild receptionist under pressure from the Guildmaster.';
    myla.relationshipSummary = 'Terrified and guilt-ridden.';
    myla.relationship.tension = 6;
    const transcript = `Aris: I ask Myla to step into the alley.\nNarrator: ${'Myla trembles and explains the quota system while begging Aris to keep the tags secret. '.repeat(22)} World State: NPCs Present: Myla Fenn, terrified in the alley. Off-Screen: Toris Vance waits by the hearth. NPC Inner Chatter: Myla Fenn fears Aris.`;
    const prompt = buildScannerPrompt({ transcript, existingNpcs: [toris, myla], userName: 'Aris', charName: 'Narrator' });
    const overhead = prompt.length - transcript.length;
    assert.ok(overhead < 7200, `routine scanner overhead should stay below 7200 chars, got ${overhead}`);
    assert.match(prompt, /Return compact JSON deltas/i);
    assert.match(prompt, /Existing relationship delta example/i);
    assert.match(prompt, /Relevant live context \(dynamic fields only\)/i);
    assert.match(prompt, /Stable profile context/i);
    assert.match(prompt, /npc_myla/);
});

test('scanner identity index includes lightweight candidates without full dossier payload', () => {
    const prompt = buildScannerPrompt({
        transcript: 'The same guild boy runs over again.',
        existingNpcs: [],
        candidates: [{ name: 'Guild Boy', identityKind: 'role_label', dossierSignal: 'incidental', role: 'Guild Apprentice', location: 'Side Dock', seenCount: 1, firstSeenTurn: 3, lastSeenTurn: 3 }],
    });
    assert.match(prompt, /\"registryState\":\"candidate\"/);
    assert.match(prompt, /Guild Boy/);
    assert.match(prompt, /"role":"Guild Apprentice"/);
    assert.match(prompt, /"location":"Side Dock"/);
    assert.match(prompt, /"lastSeenTurn":3/);
    assert.match(prompt, /\"seenCount\":1/);
});

test('parses explicit NPC State OOC add/remove commands only', () => {
    assert.deepEqual(parseOocNpcStateCommands('(OOC: NPC State: add Yunyun)'), [{ action: 'add', name: 'Yunyun' }]);
    assert.deepEqual(parseOocNpcStateCommands('[OOC: NPC_STATE: remove bond card for Wiz]'), [{ action: 'remove', name: 'Wiz' }]);
    assert.deepEqual(parseOocNpcStateCommands('(OOC: NPC State: add Yunyun; remove Wiz)'), [
        { action: 'add', name: 'Yunyun' },
        { action: 'remove', name: 'Wiz' },
    ]);
    assert.deepEqual(parseOocNpcStateCommands('(OOC: add more romantic tension)'), []);
});

test('strips NPC State OOC controls from scanner story text', () => {
    const text = 'I enter the guild. (OOC: NPC State: add Yunyun) Yunyun waves awkwardly.';
    assert.equal(stripOocNpcStateControls(text), 'I enter the guild. Yunyun waves awkwardly.');
});

test('ID-targeted remove deletes the exact dossier when duplicate labels exist', () => {
    const first = normalizeNpcRecord({ id: 'npc_same_a', name: 'Stable Hand', aliases: [], role: 'stable hand' });
    const second = normalizeNpcRecord({ id: 'npc_same_b', name: 'Stable Hand', aliases: [], role: 'stable hand' });
    const result = applyNpcStateCommand(
        { npcs: [first, second], candidates: [], dismissed: [], turn: 5 },
        { action: 'remove', name: 'Stable Hand', npcId: 'npc_same_b' },
        { turn: 5 },
    );
    assert.deepEqual(result.state.npcs.map(npc => npc.id), ['npc_same_a']);
    assert.equal(result.report.npcId, 'npc_same_b');
    assert.equal(result.report.status, 'removed');
    assert.ok(result.state.dismissed.includes('stable hand'));
});

test('OOC remove suppresses rediscovery and later add restores the dossier', () => {
    const original = createNpcRecord('Yunyun');
    original.aliases = ['Yun-Yun'];
    let result = applyNpcStateCommand({ npcs: [original], turn: 5, dismissed: [] }, { action: 'remove', name: 'Yunyun' }, { turn: 5 });
    assert.equal(result.state.npcs.length, 0);
    assert.equal(result.report.status, 'removed');
    assert.ok(result.state.dismissed.includes('yunyun'));

    const scan = mergeScanResult(result.state, { npcs: [{ name: 'Yunyun', present: true }] }, {
        maxNpcs: 6,
        excludeNames: result.state.dismissed,
        turn: 6,
    });
    assert.equal(scan.state.npcs.length, 0, 'suppressed NPC should not be recreated by scanner');

    result = applyNpcStateCommand(result.state, { action: 'add', name: 'Yunyun' }, { maxNpcs: 6, turn: 6 });
    assert.equal(result.report.status, 'added');
    assert.equal(result.state.npcs[0].name, 'Yunyun');
    assert.ok(!result.state.dismissed.includes('yunyun'));
});


test('relationship schema is trust affection desire tension and legacy respect is not reinterpreted as desire', () => {
    const migrated = normalizeNpcRecord({ name: 'Yunyun', relationship: { trust: 61, affection: 33, respect: 88, tension: 14 } });
    assert.deepEqual(migrated.relationship, { trust: 61, affection: 33, desire: 0, tension: 14 });
    assert.equal('respect' in migrated.relationship, false);
});


test('relationship delta engine enforces tier caps, score bounds, and normalized cap ordering', () => {
    assert.deepEqual(normalizeRelationshipCaps({ ordinary: 6, meaningful: 2, major: 10, extreme: 9 }), {
        ordinary: 6, meaningful: 6, major: 10, extreme: 10,
    });
    const up = applyRelationshipDelta(
        { trust: 98, affection: 20, desire: 5, tension: 10 },
        { trust: 40, affection: -30, desire: 9, tension: -99 },
        'meaningful',
        { ordinary: 4, meaningful: 8, major: 15, extreme: 25 },
    );
    assert.deepEqual(up.appliedDelta, { trust: 0, affection: 0, desire: 0, tension: -8 }, 'meaningful events affect at most two axes while +98 trust accumulates fractional evidence');
    assert.deepEqual(up.relationship, { trust: 98, affection: 20, desire: 5, tension: 2 });
    assert.equal(up.relationshipProgress.trust, 0.8);
    const none = applyRelationshipDelta({ trust: 50, affection: 20, desire: 0, tension: 10 }, { trust: 50 }, 'none');
    assert.equal(none.relationship.trust, 50);
    assert.equal(none.appliedDelta.trust, 0);
    const down = applyRelationshipDelta(
        { trust: -98, affection: -95, desire: -99, tension: -97 },
        { trust: -40, affection: -40, desire: -40, tension: -40 },
        'meaningful',
        { ordinary: 4, meaningful: 8, major: 15, extreme: 25 },
    );
    assert.deepEqual(down.relationship, { trust: -98, affection: -95, desire: -99, tension: -97 }, 'ambiguous equal-sized excess axes are rejected instead of biased by fixed key order');
});

test('new NPC relationship baseline is neutral zero and legacy audit entries never produce NaN deltas', () => {
    assert.deepEqual(createNpcRecord('Neutral').relationship, { trust: 0, affection: 0, desire: 0, tension: 0 });
    const legacy = normalizeNpcRecord({
        name: 'Legacy',
        relationship: { trust: 50, affection: 20, desire: 0, tension: 10 },
        lastRelationshipChange: { impact: 'ordinary' },
    });
    assert.deepEqual(legacy.relationship, { trust: 50, affection: 20, desire: 0, tension: 10 }, 'legacy live scores should be preserved rather than reinterpreted');
    assert.deepEqual(legacy.lastRelationshipChange.delta, { trust: 0, affection: 0, desire: 0, tension: 0 });
    assert.ok(Object.values(legacy.lastRelationshipChange.delta).every(Number.isFinite));
});

test('negative relationship values produce opposite behavioral meaning instead of low-positive semantics', () => {
    const npc = createNpcRecord('Luna');
    npc.relationship = { trust: -70, affection: -45, desire: -65, tension: -55 };
    const guidance = buildBehaviorGuidance(npc);
    assert.match(guidance, /strong distrust/);
    assert.match(guidance, /dislike|resentment/);
    assert.match(guidance, /aversion to intimate\/romantic closeness/);
    assert.match(guidance, /noticeable ease/);
    assert.match(guidance, /strong distrust/);
});

test('custom relationship baseline is used only when a new NPC record is created', () => {
    const baseline = { trust: 24, affection: 5, desire: 1, tension: 30 };
    const result = mergeScanResult({ npcs: [], turn: 1 }, { npcs: [{
        name: 'Luna', present: true, relationshipImpact: 'ordinary', relationshipDelta: { trust: 2 }, relationshipEvidence: { trust: 'Luna relied on the player and found them dependable.', affection: '', desire: '', tension: '' }, relationshipChangeReason: 'Luna relied on the player during the exchange.',
    }] }, { maxNpcs: 40, turn: 1, relationshipBaseline: baseline });
    assert.deepEqual(result.state.npcs[0].relationship, { trust: 25, affection: 5, desire: 1, tension: 30 });
});

test('presence is reset for off-screen NPCs on each scan while persistent dossier remains', () => {
    const yunyun = createNpcRecord('Yunyun');
    yunyun.present = true;
    yunyun.relationship.desire = 22;
    const wiz = createNpcRecord('Wiz', [yunyun.id]);
    wiz.present = true;
    const result = mergeScanResult({ npcs: [yunyun, wiz], turn: 7 }, { npcs: [
        { id: yunyun.id, name: 'Yunyun', present: true, relationshipImpact: 'ordinary', relationshipDelta: { desire: 3 }, relationshipEvidence: { trust: '', affection: '', desire: 'Yunyun explicitly admitted romantic attraction and wanted intimate closeness.', tension: '' }, relationshipChangeReason: 'Yunyun explicitly admitted romantic attraction to the player.' },
    ] }, { maxNpcs: 40, turn: 8 });
    assert.equal(result.state.npcs.length, 2, 'off-screen NPC should remain persisted');
    assert.equal(result.state.npcs.find(n => n.name === 'Yunyun').present, true);
    assert.equal(result.state.npcs.find(n => n.name === 'Yunyun').relationship.desire, 23);
    assert.equal(result.state.npcs.find(n => n.name === 'Wiz').present, false);
});


test('manual stable profile fields are protected while dynamic state and relationship deltas still evolve', () => {
    const npc = createNpcRecord('Yunyun');
    npc.age = '19';
    npc.appearance = 'User-authored detailed visual profile';
    npc.personality = 'User-authored personality';
    npc.speech = 'User-authored speech';
    npc.mannerisms = ['user-authored habit'];
    npc.manualProfileFields = ['age', 'appearance', 'personality', 'speech', 'mannerisms'];
    const result = mergeScanResult({ npcs: [npc], turn: 3 }, { npcs: [{
        id: npc.id, name: 'Yunyun', present: true, age: '25', appearance: 'scanner visual rewrite', personality: 'scanner rewrite', speech: 'scanner rewrite', mannerisms: ['scanner habit'], mood: 'flustered', relationshipImpact: 'ordinary', relationshipDelta: { trust: 4 }, relationshipEvidence: { trust: 'Yunyun relied on the player and found them dependable.', affection: '', desire: '', tension: '' }, relationshipChangeReason: 'Yunyun relied on the player during the current exchange.',
    }] }, { maxNpcs: 40, turn: 4 });
    const updated = result.state.npcs[0];
    assert.equal(updated.age, '19');
    assert.equal(updated.appearance, 'User-authored detailed visual profile');
    assert.equal(updated.personality, 'User-authored personality');
    assert.equal(updated.speech, 'User-authored speech');
    assert.deepEqual(updated.mannerisms, ['user-authored habit']);
    assert.equal(updated.mood, 'flustered', 'dynamic fields should remain scanner-driven');
    assert.equal(updated.relationship.trust, 1, 'relationship deltas continue from manual/current values but ordinary progression is intentionally slow');
});


test('manual archive preserves dossier, blocks injection, and auto-reactivates on genuine physical return', () => {
    const npc = createNpcRecord('Yunyun');
    npc.present = true;
    npc.background = 'Crimson Demon adventurer.';
    npc.relationship.trust = 64;
    const archived = setNpcArchived(npc, true, { reason: 'manual', sourceMessageId: 12 });
    assert.equal(archived.archived, true);
    assert.equal(archived.archiveReason, 'manual');
    assert.equal(archived.present, false);
    assert.equal(archived.background, 'Crimson Demon adventurer.');
    assert.equal(archived.relationship.trust, 64);
    assert.equal(buildInjection([archived], 'Yunyun is mentioned.', 12, 3), '');

    const returned = mergeScanResult({ npcs: [archived], turn: 13 }, { npcs: [{
        id: archived.id, name: 'Yunyun', present: true, lifeState: 'unknown', mood: 'back in town',
    }] }, { turn: 13, autoReactivateArchived: true });
    const live = returned.state.npcs[0];
    assert.equal(live.archived, false, 'manual archive should lift when the NPC physically returns');
    assert.equal(live.archiveReason, '');
    assert.equal(live.present, true);
});

test('confirmed death archives instead of deleting and requires explicit living return to reactivate', () => {
    const npc = createNpcRecord('Luna');
    npc.present = true;
    const death = mergeScanResult({ npcs: [npc], turn: 4 }, { npcs: [{
        id: npc.id, name: 'Luna', present: true,
        lifeState: 'deceased', lifeStateCertainty: 'explicit', lifeStateReason: 'The healer confirmed there was no pulse.',
        status: 'Deceased',
    }] }, { turn: 4, sourceMessageId: 4, autoArchiveDeaths: true });
    const dead = death.state.npcs[0];
    assert.equal(death.state.npcs.length, 1, 'death must preserve the dossier');
    assert.equal(dead.archived, true);
    assert.equal(dead.archiveReason, 'deceased');
    assert.equal(dead.lifeState, 'deceased');
    assert.equal(dead.present, false, 'death-archived NPC should not create a live presence card');

    const ghost = mergeScanResult(death.state, { npcs: [{
        id: dead.id, name: 'Luna', present: true, lifeState: 'deceased', lifeStateCertainty: 'explicit',
        lifeStateReason: 'Her ghost appeared in the room.',
    }] }, { turn: 5, autoReactivateArchived: true });
    assert.equal(ghost.state.npcs[0].archived, true, 'ghost/continued deceased presence must not revive the NPC');
    assert.equal(ghost.state.npcs[0].present, false);

    const revived = mergeScanResult(ghost.state, { npcs: [{
        id: dead.id, name: 'Luna', present: true, lifeState: 'alive', lifeStateCertainty: 'explicit',
        lifeStateReason: 'Luna was resurrected and spoke in person.',
    }] }, { turn: 6, autoReactivateArchived: true });
    assert.equal(revived.state.npcs[0].archived, false);
    assert.equal(revived.state.npcs[0].lifeState, 'alive');
    assert.equal(revived.state.npcs[0].present, true);
});

test('ambiguous or inferred death never triggers automatic archive', () => {
    const npc = createNpcRecord('Dust');
    const result = mergeScanResult({ npcs: [npc], turn: 2 }, { npcs: [{
        id: npc.id, name: 'Dust', present: true,
        lifeState: 'deceased', lifeStateCertainty: 'inferred', lifeStateReason: 'He was left for dead.',
    }] }, { turn: 2, autoArchiveDeaths: true });
    assert.equal(result.state.npcs[0].archived, false);
    assert.equal(result.state.npcs[0].present, true);
});

test('OOC add restores an archived dossier instead of creating a duplicate', () => {
    const original = setNpcArchived(createNpcRecord('Wiz'), true, { reason: 'manual' });
    const result = applyNpcStateCommand({ npcs: [original], turn: 5, dismissed: [] }, { action: 'add', name: 'Wiz' }, { turn: 5 });
    assert.equal(result.state.npcs.length, 1);
    assert.equal(result.report.status, 'restored');
    assert.equal(result.state.npcs[0].archived, false);
});

test('World State off-screen activity reactivates a manually archived NPC without making them present or injectable', () => {
    const archived = setNpcArchived(createNpcRecord('Yunyun'), true, { reason: 'manual', sourceMessageId: 20 });
    const result = mergeScanResult({ npcs: [archived], turn: 21 }, { npcs: [{
        id: archived.id,
        name: 'Yunyun',
        present: false,
        worldActive: true,
        location: 'Forest outside Axel',
        goal: 'Train with a new party',
        status: 'Training',
    }] }, { turn: 21, autoReactivateArchived: true });
    const npc = result.state.npcs[0];
    assert.equal(npc.archived, false, 'current off-screen activity should restore a manually archived living dossier');
    assert.equal(npc.present, false, 'World State must not imply physical scene presence');
    assert.equal(npc.worldActive, true);
    assert.equal(npc.location, 'Forest outside Axel');
    assert.equal(buildInjection([npc], 'Yunyun is training outside Axel.', 21, 3), '', 'off-screen active NPCs must not be injected');
});

test('death archive ignores off-screen activity until an explicit living return is established', () => {
    const dead = setNpcArchived(createNpcRecord('Beldia'), true, { reason: 'deceased', sourceMessageId: 30 });
    const legacyActivity = mergeScanResult({ npcs: [dead], turn: 31 }, { npcs: [{
        id: dead.id,
        name: 'Beldia',
        present: false,
        worldActive: true,
        lifeState: 'deceased',
        lifeStateCertainty: 'explicit',
        lifeStateReason: 'His ghost continues to haunt the castle.',
    }] }, { turn: 31, autoReactivateArchived: true });
    assert.equal(legacyActivity.state.npcs[0].archived, true);
    assert.equal(legacyActivity.state.npcs[0].worldActive, false, 'archived deceased records cannot become off-screen active from ghost activity');

    const revived = mergeScanResult(legacyActivity.state, { npcs: [{
        id: dead.id,
        name: 'Beldia',
        present: false,
        worldActive: true,
        lifeState: 'alive',
        lifeStateCertainty: 'explicit',
        lifeStateReason: 'Beldia was resurrected and is rebuilding his fortress.',
        location: 'Demon King territory',
    }] }, { turn: 32, autoReactivateArchived: true });
    const npc = revived.state.npcs[0];
    assert.equal(npc.archived, false);
    assert.equal(npc.lifeState, 'alive');
    assert.equal(npc.present, false);
    assert.equal(npc.worldActive, true, 'explicit resurrection may reactivate a dossier off-screen');
});

test('each scanner merge clears stale present and World State activity flags when an NPC is not observed', () => {
    const npc = createNpcRecord('Wiz');
    npc.present = true;
    npc.worldActive = true;
    const result = mergeScanResult({ npcs: [npc], turn: 9 }, { npcs: [] }, { turn: 10 });
    assert.equal(result.state.npcs[0].present, false);
    assert.equal(result.state.npcs[0].worldActive, false);
});

test('compact World State merges may preserve omitted off-screen activity without preserving stale physical presence', () => {
    const npc = createNpcRecord('Wiz');
    npc.present = true;
    npc.worldActive = true;
    const result = mergeScanResult({ npcs: [npc], turn: 9 }, { npcs: [] }, { turn: 10, preserveWorldActive: true });
    assert.equal(result.state.npcs[0].present, false);
    assert.equal(result.state.npcs[0].worldActive, true);
});

test('scanner prompt distinguishes scene presence, World State, and NPC Inner Chatter', () => {
    const prompt = buildScannerPrompt({ transcript: 'World State: Yunyun trains outside Axel. NPC Inner Chatter: Wiz worries about Kazuma.' });
    assert.match(prompt, /worldActive=true only explicit current off-screen activity/i);
    assert.match(prompt, /Inner Chatter supports durable facts/i);
    assert.match(prompt, /not transient monologue/i);
    assert.match(prompt, /World State\/Inner Chatter alone never presence/i);
});



test('species/race is a first-class stable field and legacy thoughts are discarded', () => {
    const normalized = normalizeNpcRecord({
        name: 'Mira',
        race: 'Half-elf',
        thoughts: { current: 'legacy inner monologue', certainty: 'inferred' },
    });
    assert.equal(normalized.species, 'Half-elf');
    assert.equal('thoughts' in normalized, false);

    const npc = createNpcRecord('Brokk');
    npc.species = 'Dwarf';
    npc.manualProfileFields = ['species'];
    const merged = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Brokk', species: 'Elf', present: true,
    }] }, { turn: 2 });
    assert.equal(merged.state.npcs[0].species, 'Dwarf');
});

test('scanner keeps species/race separate from appearance and does not persist Inner Chatter thoughts', () => {
    const prompt = buildScannerPrompt({ transcript: 'Brokk is a dwarf. NPC Inner Chatter: I hope nobody notices.' });
    assert.match(prompt, /species literal/i);
    assert.match(prompt, /Never invent\./i);
    assert.match(prompt, /species literal/i);
    assert.match(prompt, /species-aging inference/i);
    assert.doesNotMatch(prompt, /\"thoughts\"\s*:/i);
});

test('generation injection obeys approximate token budget and keeps identity/current state ahead of secondary relationship context', () => {
    const makeVerbose = (name, score) => {
        const npc = createNpcRecord(name);
        npc.present = true;
        npc.lastSeenTurn = 20;
        npc.importance = score;
        npc.role = 'adventurer '.repeat(30);
        npc.personality = 'proud earnest cautious warm competitive '.repeat(40);
        npc.speech = 'formal when nervous and clipped when defensive '.repeat(35);
        npc.mannerisms = Array.from({ length: 20 }, (_, i) => `habit-${i}-${'x'.repeat(30)}`);
        npc.relationshipSummary = 'long relationship context '.repeat(50);
        npc.goal = 'goal '.repeat(50);
        npc.status = 'status '.repeat(50);
        npc.location = 'location '.repeat(50);
        return npc;
    };
    const npcs = [makeVerbose('Yunyun', 90), makeVerbose('Wiz', 80), makeVerbose('Luna', 70)];
    const budget = 700;
    const injection = buildInjection(npcs, 'Yunyun Wiz Luna are all in the room.', 20, 3, DEFAULT_BEHAVIOR_CRITERIA, budget);
    assert.ok(estimateInjectionTokens(injection) <= budget, `estimated injection should stay <= ${budget} tokens`);
    assert.match(injection, /PLAYER RELATIONSHIP \(secondary modifier\):/);
    assert.match(injection, /Yunyun/);
});

test('very small injection budget drops lower-ranked present NPCs before corrupting top NPC essentials', () => {
    const yunyun = createNpcRecord('Yunyun'); yunyun.present = true; yunyun.lastSeenTurn = 10; yunyun.importance = 100;
    const wiz = createNpcRecord('Wiz'); wiz.present = true; wiz.lastSeenTurn = 1; wiz.importance = 10;
    const injection = buildInjection([yunyun, wiz], 'Yunyun enters. Wiz follows.', 10, 2, DEFAULT_BEHAVIOR_CRITERIA, 512);
    assert.match(injection, /Yunyun/);
    assert.ok(estimateInjectionTokens(injection) <= 512);
});

test('legacy v0.1.16 tilde age migrates to apparentAge but new split records stay stable on reload', () => {
    const legacy = normalizeNpcRecord({ id: 'npc_marris', name: 'Marris', age: '~25' });
    assert.equal(legacy.age, '');
    assert.equal(legacy.apparentAge, '~25');

    const modern = normalizeNpcRecord({ id: 'npc_elaria', name: 'Elaria', age: '~143', apparentAge: '~24' });
    assert.equal(modern.age, '~143');
    assert.equal(modern.apparentAge, '~24');
});
test('targeted Refresh from Chat prompt reconciles one dossier without replaying relationship stats or presence', () => {
    const prompt = buildProfileRefreshPrompt({
        transcript: 'Kazuma: How are you?\nLuna: She answers with careful honorifics and says she now works in the archive.',
        targetNpc: {
            id: 'npc_luna', name: 'Luna', personality: 'Reserved.', speech: 'Formal.',
            relationship: { trust: 14, affection: 5, desire: 0, tension: -2 },
            present: true, manualProfileFields: ['appearance'], memories: ['Old promise.'],
        },
        userName: 'Kazuma', charName: 'Megumin', memoryCriteria: 'Only durable events.',
    });
    assert.match(prompt, /TARGETED REFRESH FROM CHAT/);
    assert.match(prompt, /exactly one EXISTING NPC/i);
    assert.match(prompt, /currentRelationship is READ-ONLY/i);
    assert.match(prompt, /all four relationshipDelta values MUST be 0/i);
    assert.match(prompt, /present\/worldActive.*ignored/i);
    assert.match(prompt, /lockedProfileFields/);
    assert.match(prompt, /profileUpdates/);
    assert.match(prompt, /keyRelationshipEdges/);
    assert.match(prompt, /Latest grounded evidence wins/i);
});



test('portrait prompt builder uses visual dossier fields and excludes nonvisual profile prose', () => {
    const prompts = buildNpcPortraitPrompts({
        name: 'Astra',
        species: 'Silver dragon',
        age: '143',
        apparentAge: '36',
        role: 'Vice Commander',
        appearance: 'Adult woman with hip-length silver hair, amber slit-pupil eyes, swept silver horns, crystalline wings, and a dark officer coat.',
        mood: 'calm and affectionate',
        location: 'Great Kitchen Hall',
        personality: 'Vulnerable, maternal, fiercely loyal.',
        background: 'Raised beyond the northern marches.',
        memories: ['Lucien rescued her during the winter siege.'],
        relationshipSummary: 'Deeply bonded to Lucien.',
    }, {
        stylePositive: 'anime key visual, clean linework',
        styleNegative: 'blurry, watermark',
        composition: 'solo upper-body portrait, face visible',
        format: 'hybrid',
        useMood: true,
        useLocation: false,
    });

    assert.match(prompts.positive, /anime key visual/i);
    assert.match(prompts.positive, /Silver dragon/);
    assert.match(prompts.positive, /apparent age 36/i);
    assert.match(prompts.positive, /Vice Commander/);
    assert.match(prompts.positive, /hip-length silver hair/);
    assert.match(prompts.positive, /calm and affectionate/);
    assert.match(prompts.positive, /solo upper-body portrait/);
    assert.doesNotMatch(prompts.positive, /Great Kitchen Hall/);
    assert.doesNotMatch(prompts.positive, /Vulnerable, maternal/);
    assert.doesNotMatch(prompts.positive, /northern marches/);
    assert.doesNotMatch(prompts.positive, /winter siege/);
    assert.doesNotMatch(prompts.positive, /Deeply bonded/);
    assert.equal(prompts.negative, 'blurry, watermark');
});

test('portrait prompt builder supports optional location, per-NPC overrides, and replacement mode', () => {
    const npc = {
        species: 'Half-elf', apparentAge: '~24', role: 'Knight', appearance: 'Long white hair and grey eyes.',
        mood: 'wary', location: 'Moonlit courtyard',
        portraitPromptPositive: 'black ceremonial ribbon',
        portraitPromptNegative: 'helmet, hood',
    };
    const normal = buildNpcPortraitPrompts(npc, {
        stylePositive: 'fantasy anime', styleNegative: 'low quality', composition: 'portrait',
        useMood: false, useLocation: true, format: 'tags',
    });
    assert.match(normal.positive, /fantasy anime/);
    assert.match(normal.positive, /Moonlit courtyard/);
    assert.match(normal.positive, /black ceremonial ribbon/);
    assert.doesNotMatch(normal.positive, /wary/);
    assert.equal(normal.negative, 'low quality, helmet, hood');

    const replaced = buildNpcPortraitPrompts({ ...npc, portraitPromptReplace: true }, {
        stylePositive: 'ignored style', styleNegative: 'low quality', composition: 'ignored composition',
        format: 'natural', useMood: true, useLocation: true,
    });
    assert.equal(replaced.positive, 'black ceremonial ribbon');
    assert.equal(replaced.negative, 'low quality, helmet, hood');
    assert.equal(replaced.replaceAutomatic, true);
});

test('portrait prompt format normalization is conservative', () => {
    assert.equal(normalizePortraitPromptFormat('tags'), 'tags');
    assert.equal(normalizePortraitPromptFormat('natural'), 'natural');
    assert.equal(normalizePortraitPromptFormat('hybrid'), 'hybrid');
    assert.equal(normalizePortraitPromptFormat('unknown-model-format'), 'hybrid');
});

test('v0.2.5 behavior profile stays compact, labeled, and category-stable', () => {
    const npc = normalizeNpcRecord({
        name: 'Falia',
        behaviorProfile: [
            'Disposition: Kind-hearted and broadly considerate.',
            'Expressiveness: Low; strong feelings show through small changes first.',
            'Disposition: Kind but pragmatic; avoids needless suffering.',
            'Independence: High; affection does not create obedience.',
            'Care: Practical and understated.',
            'Conflict: Controlled and direct.',
            'Cruelty-Social: Low; necessary force is not an excuse for humiliation.',
            'Vulnerability: Private and deliberate.',
        ],
    });
    assert.equal(npc.behaviorProfile.length, 6);
    assert.equal(npc.behaviorProfile.filter(item => /^Disposition:/i.test(item)).length, 1);
    assert.match(npc.behaviorProfile[0], /Kind but pragmatic/i, 'newer same-category rule should replace the older wording');
    assert.ok(npc.behaviorProfile.every(item => item.length <= DURABLE_PROFILE_LIMITS.behaviorProfile));
});

test('v0.2.5 injection keeps identity ahead of high relationship scores and preserves target-general kindness', () => {
    const npc = createNpcRecord('Falia');
    npc.present = true;
    npc.lastSeenTurn = 9;
    npc.personality = 'Kind-hearted, rational, restrained, pragmatic, and independent.';
    npc.speech = 'Soft, measured, courteous, and concise under pressure.';
    npc.mannerisms = ['Makes small economical gestures.', 'Pauses briefly before difficult answers.'];
    npc.behaviorProfile = [
        'Disposition: Broadly considerate; avoids needless suffering.',
        'Expressiveness: Low; emotion alters attention and wording before overt display.',
        'Independence: High; keeps duties, boundaries, and personal judgment.',
        'Care: Practical and understated.',
    ];
    npc.relationship = { trust: 95, affection: 96, desire: 82, tension: 71 };
    const injection = buildInjection([npc], 'Falia', 10, 1, DEFAULT_BEHAVIOR_CRITERIA, 1800);
    assert.match(injection, /IDENTITY FIRST/i);
    assert.match(injection, /Kind-hearted, rational, restrained/i);
    assert.match(injection, /Disposition: Broadly considerate/i);
    assert.match(injection, /cruelty toward others/i);
    assert.match(injection, /tsundere/i);
    assert.ok(injection.indexOf('IDENTITY (authoritative):') < injection.indexOf('PLAYER RELATIONSHIP (secondary modifier):'), 'identity must constrain relationship interpretation, not follow it');
    assert.ok(estimateInjectionTokens(injection) <= 1800);
});

test('v0.2.5 gradual identity evolution requires evidence carried across scans', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Reserved, kind, and reluctant to draw attention.';
    const first = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            evidence: { personality: [
                'outspokenness: initiates a conversation with unfamiliar travelers without prompting.',
                'outspokenness: openly disagrees with a senior officer during one tense council scene.',
            ] },
            personalityState: 'evolve',
            personality: 'Confident, outspoken, kind, and socially proactive.',
            personalityReason: 'Her behavior appears less reserved.',
            developmentScale: 'gradual',
            developmentReason: 'Recent scenes suggest a possible long-term change.',
        }],
    }, { turn: 2 });
    assert.equal(first.state.npcs[0].personality, 'Reserved, kind, and reluctant to draw attention.', 'multiple observations from one scan must not rewrite slow identity');
    assert.ok(first.state.npcs[0].profileEvidence.personality.length >= 1);

    const second = mergeScanResult(first.state, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            evidence: { personality: ['outspokenness: weeks later, independently takes the floor at a public meeting and leads the discussion.'] },
            personalityState: 'evolve',
            personality: 'Confident, outspoken, kind, and socially proactive.',
            personalityReason: 'The less-reserved behavior has become a recurring pattern.',
            developmentScale: 'gradual',
            developmentReason: 'Independent later evidence confirms sustained change.',
        }],
    }, { turn: 3 });
    assert.match(second.state.npcs[0].personality, /Confident, outspoken/i);
    assert.deepEqual(second.state.npcs[0].profileEvidence.personality, []);
});

test('v0.2.5 time passage alone cannot batch-rewrite identity but summarized development can', () => {
    const npc = createNpcRecord('Astra');
    npc.personality = 'Lively, impulsive, and informal.';
    const bareSkip = mergeScanResult({ npcs: [npc], candidates: [], turn: 10 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Gentle, composed, and soft-spoken.',
            personalityReason: 'Time has passed.',
            developmentScale: 'batch',
            developmentReason: 'Three years passed.',
        }],
    }, { turn: 11 });
    assert.equal(bareSkip.state.npcs[0].personality, 'Lively, impulsive, and informal.');

    const developedSkip = mergeScanResult(bareSkip.state, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Gentler, more composed, and deliberately soft-spoken while retaining flashes of liveliness.',
            personalityReason: 'Her consciously practiced gentleness became habitual over the skipped period.',
            developmentScale: 'batch',
            developmentReason: 'Over three years, narration explicitly says she repeatedly practiced Talia\'s gentler manner until it became almost second nature.',
        }],
    }, { turn: 12 });
    assert.match(developedSkip.state.npcs[0].personality, /Gentler, more composed/i);
});

test('v0.2.5 scanner and targeted refresh enforce identity firewall and developmental time-skip semantics', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Kind-hearted, restrained, and pragmatic.';
    npc.behaviorProfile = ['Disposition: Broadly kind; avoids needless suffering.', 'Expressiveness: Low.'];
    const scanner = buildScannerPrompt({ transcript: 'Falia quietly helps a wounded stranger, then speaks privately with the player.', existingNpcs: [npc] });
    assert.match(scanner, /IDENTITY FIREWALL/i);
    assert.match(scanner, /relationship-specific behavior never becomes global/i);
    assert.match(scanner, /Kindness stays general/i);
    assert.match(scanner, /necessary force != cruelty/i);
    assert.match(scanner, /behaviorProfile FULL max6/i);
    assert.match(scanner, /developmentScale=gradual\|explicit\|batch/i);
    assert.match(scanner, /time skip alone invents nothing/i);

    const refresh = buildProfileRefreshPrompt({ transcript: 'Six months pass while Falia remains active in the guard.', targetNpc: npc, userName: 'Aris' });
    assert.match(refresh, /behavior unique to Aris must not become global/i);
    assert.match(refresh, /generally kind NPC remains generally kind toward other people/i);
    assert.match(refresh, /Mere passage of time does nothing/i);
});

test('v0.2.5 ordinary NPC delta path cannot bypass gradual identity evidence gate', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Restrained, kind, and formal.';
    npc.behaviorProfile = ['Expressiveness: Low.', 'Disposition: Broadly kind.'];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 4 }, {
        npcs: [{
            id: npc.id,
            name: 'Falia',
            present: true,
            personalityState: 'evolve',
            personality: 'Highly expressive, impulsive, and informal.',
            personalityReason: 'She became animated in this scene.',
            behaviorProfileState: 'evolve',
            behaviorProfile: ['Expressiveness: Very high.', 'Disposition: Player-focused.'],
            behaviorProfileReason: 'She was openly affectionate with the player.',
            developmentScale: 'gradual',
            developmentReason: 'One emotionally intense scene.',
        }],
    }, { turn: 5 });
    assert.equal(result.state.npcs[0].personality, 'Restrained, kind, and formal.');
    assert.deepEqual(result.state.npcs[0].behaviorProfile, ['Expressiveness: Low.', 'Disposition: Broadly kind.']);
});


test('v0.2.5 recognizes only the untouched v0.2.4 stock behavior rubric for migration', () => {
    const legacy = 'Use relationship stats as a bipolar -100 to +100 signal with 0 neutral. Modulate the NPC\'s TEMPORARY expression toward the player without replacing established personality, speech habits, or mannerisms. Negative values are meaningful opposites, not merely "low" values.\nTrust: negative trust should read as distrustful, suspicious, guarded, withholding, formal, or watchful; values near 0 are neutral/cautious; positive trust permits increasing candor, reliance, vulnerability, relaxed familiarity, and asking for help.\nAffection: negative affection means dislike, resentment, hostility, or emotional aversion; values near 0 are emotionally neutral; positive affection increases warmth, patience, concern, fondness, protectiveness, and willingness to prioritize the player.\nDesire: negative desire means active aversion to romantic/intimate/physical closeness; values near 0 mean no established attraction; positive desire may add attraction cues with strength proportional to the score when context supports them, but never overrides personality, consent, boundaries, or established facts.\nTension: negative tension means ease, safety, relaxation, and low interpersonal pressure; values near 0 are settled/neutral; positive tension adds strain, awkward pressure, rivalry, resentment, fear, jealousy, defensiveness, or charged restraint according to context.\nInterpret combinations rather than each stat in isolation. Positive trust + positive tension can be familiar but strained. Positive affection + negative trust can care while remaining guarded. Positive desire + negative trust can be attracted without feeling safe. Positive affection + positive trust + negative tension tends toward warm ease. Positive desire + positive tension can feel charged, but do not force romance or sexual behavior. Keep reactions proportional and natural.';
    assert.equal(isLegacyStockBehaviorCriteriaV024(legacy), true);
    assert.equal(isLegacyStockBehaviorCriteriaV024(`${legacy}\nCustom: preserve this.`), false);
    assert.equal(isLegacyStockBehaviorCriteriaV024(DEFAULT_BEHAVIOR_CRITERIA), false);
});

test('v0.2.6 minimum injection budget preserves every established identity channel plus agency', () => {
    const npc = createNpcRecord('Falia');
    npc.present = true;
    npc.lastSeenTurn = 20;
    npc.role = 'Hedge knight and scout';
    npc.goal = 'Protect the caravan while honoring her oath.';
    npc.keyRelationships = ['Talia — trusted friend | loyal', 'Rin — younger sister | deeply loved'];
    npc.personality = 'Kind-hearted, restrained, pragmatic, independent, and observant.';
    npc.behaviorProfile = ['Disposition: Broadly kind; avoids needless suffering.', 'Expressiveness: Low.', 'Independence: High.'];
    npc.speech = 'Soft, measured, courteous, and concise under pressure.';
    npc.mannerisms = ['Habitually pauses before difficult answers.', 'Usually makes small economical gestures.'];
    npc.relationship = { trust: 95, affection: 96, desire: 82, tension: 71 };
    const injection = buildInjection([npc], 'Falia', 20, 1, DEFAULT_BEHAVIOR_CRITERIA, 512);
    assert.ok(estimateInjectionTokens(injection) <= 512);
    for (const required of [/personality:/i, /behavioral profile:/i, /established speech:/i, /established mannerisms:/i, /role:/i, /current goal:/i, /key relationships:/i]) {
        assert.match(injection, required);
    }
    assert.ok(injection.indexOf('IDENTITY (authoritative):') < injection.indexOf('PLAYER RELATIONSHIP (secondary modifier):'));
});

test('v0.2.6 minimum injection compacts verbose behavior rules without starving cruelty and agency categories', () => {
    const npc = createNpcRecord('Falia Rendel');
    Object.assign(npc, {
        present: true,
        importance: 100,
        personality: 'Kind-hearted, rational, restrained, pragmatic, observant, independent, and duty-conscious.',
        speech: 'Soft, measured, courteous, and precise even under pressure.',
        mannerisms: ['Uses economical gestures', 'Pauses before difficult answers'],
        role: 'Hedge knight',
        goal: 'Protect the caravan without abandoning her other obligations.',
        keyRelationships: ['Mira: younger sister', 'Talia: trusted companion'],
        behaviorProfile: [
            'Disposition: broadly considerate toward strangers and allies; avoids needless humiliation.',
            'Cruelty: low; necessary force is acceptable, suffering for its own sake is not.',
            'Independence: high; affection does not become obedience or abandonment of duty.',
            'Care: practical and quiet; acts before verbal reassurance.',
            'Expressiveness: low; strong feelings first alter attention and wording.',
            'Conflict: controlled; disagreement remains courteous until force is necessary.',
        ],
        relationship: { trust: 92, affection: 96, desire: 71, tension: 68 },
    });
    const prompt = buildInjection([npc], 'Falia remains beside the player.', 100, 3, undefined, 512);
    assert.ok(estimateInjectionTokens(prompt) <= 512);
    assert.match(prompt, /Disposition:/i);
    assert.match(prompt, /Cruelty: low/i);
    assert.match(prompt, /Independence: high/i);
    assert.match(prompt, /established speech:/i);
    assert.match(prompt, /established mannerisms:/i);
    assert.match(prompt, /current goal:/i);
    assert.match(prompt, /key relationships:/i);
});

test('v0.2.6 omitted developmentScale defaults to gradual and cannot bypass durable evolution', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Kind, restrained, and formal.';
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            evidence: { personality: ['expressiveness: becomes animated during one intimate exchange'] },
            personalityState: 'evolve',
            personality: 'Highly expressive, impulsive, and informal.',
            personalityReason: 'She was animated with the player.',
            developmentReason: 'She was animated with the player.',
        }],
    }, { turn: 2 });
    assert.equal(result.state.npcs[0].personality, 'Kind, restrained, and formal.');
});

test('v0.2.6 unrelated old evidence cannot unlock a different gradual personality change', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Kind, reserved, and cautious.';
    npc.profileEvidence.personality = ['kindness: repeatedly helps injured strangers without reward'];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            evidence: { personality: ['outspokenness: takes the floor at a public meeting'] },
            personalityState: 'evolve',
            personality: 'Kind, outspoken, and socially proactive.',
            personalityReason: 'She appears less reserved.',
            developmentScale: 'gradual',
            developmentReason: 'A possible recurring change.',
        }],
    }, { turn: 3 });
    assert.equal(result.state.npcs[0].personality, 'Kind, reserved, and cautious.');
    assert.ok(result.state.npcs[0].profileEvidence.personality.some(item => /kindness:/i.test(item)));
    assert.ok(result.state.npcs[0].profileEvidence.personality.some(item => /outspokenness:/i.test(item)));
});

test('v0.2.6 refine cannot smuggle cruelty into an established kind disposition', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Kind-hearted, restrained, pragmatic, and independent.';
    npc.behaviorProfile = ['Disposition: Broadly kind; avoids needless suffering.', 'Expressiveness: Low.'];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 4 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'refine',
            personality: 'Kind-hearted, restrained, pragmatic, independent, and cruel toward strangers who inconvenience her.',
            behaviorProfileState: 'refine',
            behaviorProfile: ['Cruelty-Social: Cruel and merciless toward outsiders.'],
        }],
    }, { turn: 5 });
    assert.equal(result.state.npcs[0].personality, 'Kind-hearted, restrained, pragmatic, and independent.');
    assert.deepEqual(result.state.npcs[0].behaviorProfile, ['Disposition: Broadly kind; avoids needless suffering.', 'Expressiveness: Low.']);
});

test('v0.2.6 one-scene gestures do not become mannerisms but explicitly recurring habits may refine', () => {
    const npc = createNpcRecord('Toris');
    npc.mannerisms = ['Habitually scratches his beard before answering.'];
    const oneOff = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, present: true, mannerismState: 'refine', mannerisms: ['Slams his fist on the table in anger.'],
    }] }, { turn: 2 });
    assert.deepEqual(oneOff.state.npcs[0].mannerisms, npc.mannerisms);
    const recurring = mergeScanResult(oneOff.state, { npcs: [{
        id: npc.id, present: true, mannerismState: 'refine', mannerisms: ['Habitually squares his shoulders before delivering bad news.'],
    }] }, { turn: 3 });
    assert.ok(recurring.state.npcs[0].mannerisms.some(item => /Habitually squares/i.test(item)));
});

test('v0.2.6 batch development must be grounded in the actual narrated time-skip context', () => {
    const npc = createNpcRecord('Astra');
    npc.personality = 'Lively, impulsive, and informal.';
    const hallucinated = mergeScanResult({ npcs: [npc], candidates: [], turn: 8 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Gentle, composed, and soft-spoken.',
            personalityReason: 'Her gentleness became habitual.',
            developmentScale: 'batch',
            developmentReason: 'Over three years she repeatedly practiced a gentler manner until it became habitual.',
        }],
    }, { turn: 9, developmentContext: 'Three years passed.' });
    assert.equal(hallucinated.state.npcs[0].personality, 'Lively, impulsive, and informal.');

    const grounded = mergeScanResult(hallucinated.state, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Gentler, more composed, and deliberately soft-spoken while retaining flashes of liveliness.',
            personalityReason: 'Her gentleness became habitual.',
            developmentScale: 'batch',
            developmentReason: 'Over three years she repeatedly practiced a gentler manner until it became habitual.',
        }],
    }, { turn: 10, developmentContext: "Over three years, Astra repeatedly practiced Talia's gentler manner until it became habitual and almost second nature." });
    assert.match(grounded.state.npcs[0].personality, /Gentler, more composed/i);
});

test('v0.2.6 explicit evolution requires an actual lasting-change or correction cue in source narration', () => {
    const npc = createNpcRecord('Selene');
    npc.personality = 'Reserved, skeptical, and emotionally guarded.';
    const oneOff = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Warm, trusting, and openly affectionate.',
            personalityReason: 'She became warmer and more trusting.',
            developmentScale: 'explicit',
            developmentReason: 'Selene became warmer and more trusting.',
        }],
    }, { developmentContext: 'Selene was unexpectedly warm to the wounded courier and trusted his directions.' });
    assert.match(oneOff.state.npcs[0].personality, /Reserved, skeptical/i);

    const explicit = mergeScanResult({ npcs: [npc], candidates: [], turn: 2 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Warmer, more trusting, while still somewhat reserved.',
            personalityReason: 'She had become warmer and more trusting after the ordeal.',
            developmentScale: 'explicit',
            developmentReason: 'After the ordeal Selene had become warmer and more trusting.',
        }],
    }, { developmentContext: 'After the ordeal, Selene had become noticeably warmer and more trusting, though some reserve remained.' });
    assert.match(explicit.state.npcs[0].personality, /Warmer, more trusting/i);
});

test('v0.2.6 batch evolution cannot borrow unrelated present-day evidence from elsewhere in transcript', () => {
    const npc = createNpcRecord('Astra');
    npc.personality = 'Abrupt, energetic, and rough-edged.';
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'evolve',
            personality: 'Gentle, patient, and soft-spoken.',
            personalityReason: 'Over three years she gradually became gentle and patient.',
            developmentScale: 'batch',
            developmentReason: 'Over three years she gradually became gentle and patient.',
        }],
    }, { developmentContext: 'Three years passed. The city changed beyond recognition. Today Astra gently helped a frightened child and patiently waited beside her.' });
    assert.match(result.state.npcs[0].personality, /Abrupt, energetic/i);
});

test('v0.2.6 focused relationship evaluator receives identity, current goals, and non-player bonds', () => {
    const npc = createNpcRecord('Falia');
    npc.id = 'npc_falia';
    npc.personality = 'Kind-hearted, restrained, pragmatic, and independent.';
    npc.behaviorProfile = ['Disposition: Broadly kind.', 'Independence: High.'];
    npc.goal = 'Keep the caravan alive and uphold her oath.';
    npc.keyRelationships = ['Talia — trusted friend | loyal', 'Rin — younger sister | deeply loved'];
    const prompt = buildRelationshipPassPrompt({ transcript: 'The player asks her to abandon the caravan.', targets: [npc], userName: 'Aris' });
    assert.match(prompt, /Kind-hearted, restrained, pragmatic/i);
    assert.match(prompt, /Keep the caravan alive/i);
    assert.match(prompt, /Talia .*trusted friend/i);
    assert.match(prompt, /player is not their only motive or relationship/i);
});

test('v0.2.6 scanner cannot invent habitual frequency from a one-off mannerism when source context is available', () => {
    const npc = createNpcRecord('Toris');
    npc.mannerisms = ['Habitually scratches his beard before answering.'];
    const result = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id,
        present: true,
        mannerismState: 'refine',
        mannerisms: ['Habitually squares his shoulders before delivering bad news.'],
    }] }, {
        turn: 2,
        developmentContext: 'Toris squared his shoulders once, then delivered the bad news to the captain.',
    });
    assert.deepEqual(result.state.npcs[0].mannerisms, npc.mannerisms);
});

test('v0.2.6 transition language cannot disguise personality or speech evolution as refinement', () => {
    const npc = createNpcRecord('Marris');
    npc.personality = 'Reserved, cautious, and kind.';
    npc.speech = 'Soft, formal, and measured.';
    npc.behaviorProfile = ['Expressiveness: Low; feelings are shown subtly.'];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 5 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            personalityState: 'refine',
            personality: 'No longer reserved or cautious; now outspoken, reckless, and kind.',
            speechState: 'refine',
            speech: 'No longer formal; now blunt, loud, and colloquial.',
            behaviorProfileState: 'refine',
            behaviorProfile: ['Expressiveness: No longer low; now highly expressive.'],
        }],
    }, { turn: 6 });
    assert.equal(result.state.npcs[0].personality, 'Reserved, cautious, and kind.');
    assert.equal(result.state.npcs[0].speech, 'Soft, formal, and measured.');
    assert.deepEqual(result.state.npcs[0].behaviorProfile, ['Expressiveness: Low; feelings are shown subtly.']);
});

test('v0.2.6 first-pass behavior profile cannot contradict an established kind personality with generic cruelty', () => {
    const result = mergeScanResult({ npcs: [], candidates: [], turn: 0 }, { npcs: [{
        name: 'Selene Voss',
        identityKind: 'proper_name',
        dossierSignal: 'meaningful',
        present: true,
        personality: 'Kind-hearted, pragmatic, restrained, and compassionate.',
        behaviorProfile: [
            'Disposition: Broadly kind; avoids needless suffering.',
            'Cruelty-Social: Cruel and merciless toward people who are not close to her.',
            'Independence: High; keeps her own judgment.',
        ],
    }] }, { turn: 1 });
    assert.equal(result.state.npcs.length, 1);
    assert.ok(result.state.npcs[0].behaviorProfile.some(item => /Disposition: Broadly kind/i.test(item)));
    assert.ok(result.state.npcs[0].behaviorProfile.some(item => /Independence: High/i.test(item)));
    assert.ok(!result.state.npcs[0].behaviorProfile.some(item => /Cruel and merciless/i.test(item)));
});


test('v0.2.7 scanner boolean coercion treats string false as false instead of JavaScript truthy', () => {
    const existing = createNpcRecord('Marris');
    existing.id = 'npc_marris';
    const result = mergeScanResult({ npcs: [existing], candidates: [], turn: 1 }, { npcs: [{
        id: existing.id,
        present: 'false',
        worldActive: 'false',
        directInteraction: 'false',
        relationshipImpact: 'none',
        relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },
    }] }, { turn: 2 });
    assert.equal(result.state.npcs[0].present, false);
    assert.equal(result.state.npcs[0].worldActive, false);

    const role = createNpcRecord('Gate Clerk');
    role.id = 'npc_gate_clerk';
    role.identityKind = 'role_label';
    const resolved = resolveInterimIdentityPromotions({ npcs: [{
        name: 'May Rill', identityKind: 'proper_name', sameIndividual: 'false',
    }] }, [role], []);
    assert.equal(resolved.npcs[0].sameIndividual, 'false', 'resolver preserves raw scanner payload; normalization owns coercion');
    const fused = mergeScanResult({ npcs: [role], candidates: [], turn: 1 }, resolved, { turn: 2 });
    assert.equal(fused.state.npcs.some(npc => npc.id === role.id && npc.name === 'May Rill'), false, 'string false must not authorize identity fusion');
});

test('v0.2.7 negated cruelty wording does not neutralize established kind-personality protection', () => {
    const npc = createNpcRecord('Falia');
    npc.personality = 'Kind-hearted, pragmatic, restrained, and never cruel.';
    npc.behaviorProfile = ['Disposition: Broadly kind; avoids needless suffering.', 'Cruelty-Social: Not cruel; avoids unnecessary suffering.'];
    const result = mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, {
        npcs: [],
        profileUpdates: [{
            id: npc.id,
            behaviorProfileState: 'refine',
            behaviorProfile: ['Cruelty-Social: Cruel and merciless toward outsiders.'],
        }],
    }, { turn: 2 });
    assert.ok(result.state.npcs[0].behaviorProfile.some(item => /Not cruel|avoids unnecessary suffering/i.test(item)));
    assert.ok(!result.state.npcs[0].behaviorProfile.some(item => /Cruel and merciless/i.test(item)));
});

test('v0.2.7 short NPC names require whole normalized phrase matches for relevance', () => {
    const may = createNpcRecord('May');
    may.lastSeenTurn = 0;
    const falseScore = scoreNpcRelevance(may, 'Maybe the caravan should wait.', 10);
    const exactScore = scoreNpcRelevance(may, 'May tells the caravan to wait.', 10);
    assert.equal(exactScore - falseScore, 8, 'exact canonical name mention should receive the mention bonus');
    assert.equal(scoreNpcRelevance(may, 'Perhaps the caravan should wait.', 10), falseScore, 'substring text must not add any mention bonus');
});

test('v0.2.7 key-relationship evolution updates named counterparts without deleting omitted bonds', () => {
    const npc = createNpcRecord('Marris');
    npc.keyRelationships = [
        'Elena — older sister | close but argumentative',
        'Rook — mentor | trusted adviser',
        'Talia — friend | dependable companion',
    ];
    const result = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id,
        keyRelationshipsState: 'evolve',
        keyRelationshipsReason: 'Marris and Elena permanently reconciled.',
        keyRelationships: ['Elena — older sister | reconciled and mutually protective'],
    }] }, { turn: 2 });
    assert.deepEqual(result.state.npcs[0].keyRelationships, [
        'Elena — older sister | reconciled and mutually protective',
        'Rook — mentor | trusted adviser',
        'Talia — friend | dependable companion',
    ]);
});


test('v0.2.7 quoted false legacy scanner flags do not clear or evolve state', () => {
    const normalized = normalizeScanNpc({
        name: 'Marris',
        clearMood: 'false', clearLocation: 'false', clearGoal: 'false', clearStatus: 'false',
        evolvePersonality: 'false', evolveSpeech: 'false', evolveMannerisms: 'false', evolveKeyRelationships: 'false',
    });
    assert.equal(normalized.moodState, '');
    assert.equal(normalized.locationState, '');
    assert.equal(normalized.goalState, '');
    assert.equal(normalized.statusState, '');
    assert.equal(normalized.personalityState, 'keep');
    assert.equal(normalized.speechState, 'keep');
    assert.equal(normalized.mannerismState, 'keep');
    assert.equal(normalized.keyRelationshipsState, 'keep');
});

test('v0.2.7 malformed relationship scores and caps fall back safely instead of becoming negative extremes', () => {
    assert.deepEqual(normalizeRelationshipBaseline({ trust: 'high', affection: null, desire: 'NaN', tension: undefined }), {
        trust: 0, affection: 0, desire: 0, tension: 0,
    });
    assert.deepEqual(normalizeRelationshipCaps({ ordinary: 'many', meaningful: NaN, major: 'huge', extreme: null }), {
        ordinary: 1, meaningful: 2, major: 5, extreme: 10,
    });

    const stored = normalizeNpcRecord({ name: 'Falia', relationship: { trust: 'high' }, importance: 'important' });
    assert.equal(stored.relationship.trust, 0);
    assert.equal(stored.importance, 50);

    const existing = createNpcRecord('Falia');
    existing.importance = 77;
    const merged = mergeScanResult({ npcs: [existing], turn: 1 }, { npcs: [{ id: existing.id, importance: 'important' }] }, { turn: 2 });
    assert.equal(merged.state.npcs[0].importance, 77, 'invalid optional scanner importance must be ignored');
});

test('v0.2.7 blank durable identity fields require grounded source narration before first seed', () => {
    const npc = createNpcRecord('Mira');
    npc.manual = false;
    npc.present = true;
    npc.seenCount = 3;
    const state = { turn: 3, npcs: [npc], candidates: [] };

    const inferred = mergeScanResult(state, { npcs: [{
        id: npc.id,
        name: 'Mira',
        present: true,
        personality: 'kind and playful',
        speech: 'soft and teasing',
    }] }, {
        turn: 4,
        developmentContext: 'Mira smiled at the player, handed them a cup, and made a joke about the rain.',
    }).state.npcs[0];

    assert.equal(inferred.personality, '');
    assert.equal(inferred.speech, '');

    const grounded = mergeScanResult({ turn: 4, npcs: [inferred], candidates: [] }, { npcs: [{
        id: npc.id,
        name: 'Mira',
        present: true,
        personality: 'kind and reserved',
        speech: 'soft and measured',
    }] }, {
        turn: 5,
        developmentContext: 'Mira is kind and reserved by nature. Her speech is soft and measured even when annoyed.',
    }).state.npcs[0];

    assert.match(grounded.personality, /kind/i);
    assert.match(grounded.personality, /reserved/i);
    assert.match(grounded.speech, /soft/i);
    assert.match(grounded.speech, /measured/i);
});

test('v0.2.7 a first one-off gesture cannot seed mannerisms but explicit recurrence can', () => {
    const npc = createNpcRecord('Nera');
    npc.manual = false;
    npc.seenCount = 2;
    const once = mergeScanResult({ turn: 2, npcs: [npc], candidates: [] }, { npcs: [{
        id: npc.id,
        name: 'Nera',
        present: true,
        mannerisms: ['taps two fingers against her bracer before answering'],
        mannerismState: 'refine',
    }] }, {
        turn: 3,
        developmentContext: 'Nera tapped two fingers against her bracer before answering the question.',
    }).state.npcs[0];
    assert.deepEqual(once.mannerisms, []);

    const recurring = mergeScanResult({ turn: 3, npcs: [once], candidates: [] }, { npcs: [{
        id: npc.id,
        name: 'Nera',
        present: true,
        mannerisms: ['taps two fingers against her bracer before answering'],
        mannerismState: 'refine',
    }] }, {
        turn: 4,
        developmentContext: 'Nera habitually taps two fingers against her bracer before answering difficult questions.',
    }).state.npcs[0];
    assert.equal(recurring.mannerisms.length, 1);
    assert.match(recurring.mannerisms[0], /two fingers/i);
});

test('v0.2.7 repeated evidence can seed an empty trait only when it supports the proposed trait', () => {
    const npc = createNpcRecord('Iria');
    npc.manual = false;
    npc.seenCount = 4;
    const base = { turn: 4, npcs: [npc], candidates: [] };
    const first = mergeScanResult(base, { npcs: [{ id: npc.id, name: 'Iria', present: true }], profileUpdates: [{
        id: npc.id,
        evidence: { personality: ['Kindness: treats a frightened stranger gently'] },
        personalityState: 'refine',
        personality: 'kind',
    }] }, { turn: 5, developmentContext: 'Iria gave the frightened stranger water and tended his scraped hands.' }).state.npcs[0];
    assert.equal(first.personality, '');

    const mismatch = mergeScanResult({ turn: 5, npcs: [first], candidates: [] }, { npcs: [{ id: npc.id, name: 'Iria', present: true }], profileUpdates: [{
        id: npc.id,
        evidence: { personality: ['Kindness: spares an exhausted opponent who surrendered'] },
        personalityState: 'refine',
        personality: 'sadistic',
    }] }, { turn: 6, developmentContext: 'Iria lowered her weapon after the exhausted opponent surrendered and let him leave.' }).state.npcs[0];
    assert.equal(mismatch.personality, '', 'related evidence labels must not authorize an unrelated proposed personality');

    const supported = mergeScanResult({ turn: 6, npcs: [mismatch], candidates: [] }, { npcs: [{ id: npc.id, name: 'Iria', present: true }], profileUpdates: [{
        id: npc.id,
        evidence: { personality: ['Kindness: helps an injured traveler without demanding payment'] },
        personalityState: 'refine',
        personality: 'kind',
    }] }, { turn: 7, developmentContext: 'Iria bound the traveler\'s wound and refused payment.' }).state.npcs[0];
    assert.equal(supported.personality, 'kind');
});

test('v0.2.8 apparent-age canon normalizes word numbers and decade prose to stable ~N', () => {
    assert.equal(normalizeApparentAge('around six', 'Liza'), '~6');
    assert.equal(normalizeApparentAge('about six', 'Liza'), '~6');
    assert.equal(normalizeApparentAge('six years old', 'Liza'), '~6');
    const twenties = normalizeApparentAge('Twenties', 'Brina Hael');
    assert.match(twenties, /^~2\d$/);
    assert.equal(normalizeApparentAge('around twenties', 'Brina Hael'), twenties, 'equivalent decade prose must keep the same seeded estimate');
    assert.match(normalizeApparentAge('early twenties', 'Brina Hael'), /^~2[0-3]$/);
    assert.match(normalizeApparentAge('mid thirties', 'Brina Hael'), /^~3[4-6]$/);
    assert.match(normalizeApparentAge('late thirties', 'Brina Hael'), /^~3[7-9]$/);
    assert.equal(normalizeApparentAge('around nonsense', 'Brina Hael'), '', 'unknown prose must not leak into the compact field');
});

test('v0.2.8 Appearance removes redundant explicit age while Apparent Age stays authoritative', () => {
    const npc = normalizeNpcRecord({
        name: 'Liza Hael',
        apparentAge: 'around six',
        appearance: 'A five-year-old human girl with shoulder-length brown curls, brown eyes, and a small build.',
    });
    assert.equal(npc.apparentAge, '~6');
    assert.equal(npc.appearance, 'A human girl with shoulder-length brown curls, brown eyes, and a small build.');
    assert.doesNotMatch(npc.appearance, /five-year-old|\bage\s*6\b/i);
});

test('v0.2.8 Noctis-style relationship summary is calibrated and unexplained audit deltas are discarded', () => {
    const npc = normalizeNpcRecord({
        name: 'Brina Hael',
        relationship: { trust: 18, affection: 14, desire: 16, tension: -1 },
        relationshipSummary: 'Views Lucien as an indispensable source of physical comfort and survival.',
        lastRelationshipChange: { impact: 'ordinary', delta: { trust: 2, affection: 1, desire: 0, tension: 2 }, reason: '' },
    });
    assert.doesNotMatch(npc.relationshipSummary, /indispensable/i);
    assert.match(npc.relationshipSummary, /growing source of practical support and comfort/i);
    assert.deepEqual(npc.lastRelationshipChange.delta, { trust: 0, affection: 0, desire: 0, tension: 0 });
    assert.equal(npc.lastRelationshipChange.impact, 'none');
});

test('v0.2.8 scanner relationship deltas require a reason grounded in the scanned story when context is available', () => {
    const npc = createNpcRecord('Brina');
    const unrelated = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Brina', present: true,
        relationshipImpact: 'ordinary', relationshipDelta: { trust: 4 },
        relationshipEvidence: { trust: 'Lucien proved dependable by giving Brina food and shelter.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'Lucien gave Brina food and shelter.',
    }] }, { turn: 2, developmentContext: 'Rain struck the shutters while Brina counted her remaining thread.' });
    assert.equal(unrelated.state.npcs[0].relationship.trust, 0);

    const grounded = mergeScanResult({ npcs: [npc], turn: 1 }, { npcs: [{
        id: npc.id, name: 'Brina', present: true,
        relationshipImpact: 'ordinary', relationshipDelta: { trust: 4 },
        relationshipEvidence: { trust: 'Lucien proved dependable by giving Brina food and shelter.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'Lucien gave Brina food and shelter.',
    }] }, { turn: 2, developmentContext: 'Lucien gave Brina food and shelter after learning her household had run short.' });
    assert.equal(grounded.state.npcs[0].relationship.trust, 1);
    assert.match(grounded.state.npcs[0].lastRelationshipChange.reason, /food and shelter/i);
});

test('v0.2.8 player-specific or intimacy-specific incidents cannot become global Behavioral Profile canon', () => {
    const npc = normalizeNpcRecord({
        name: 'Brina Hael',
        personality: 'Pragmatic, composed, and maternal.',
        behaviorProfile: [
            'Family First: Sacrifices personal pride and works tirelessly to feed, shelter, and clothe her twin daughters.',
            'Frontier Pragmatism: Treats business and private intimacy with Lucien transactionally when it benefits her household.',
        ],
    });
    assert.equal(npc.behaviorProfile.length, 1);
    assert.match(npc.behaviorProfile[0], /Family First/i);
    assert.doesNotMatch(npc.behaviorProfile.join(' '), /intimacy|Lucien/i);
});

test('v0.2.8 Behavioral Profile compacts overlapping conflict rules into one reusable pattern', () => {
    const npc = normalizeNpcRecord({
        name: 'Maren Rost',
        behaviorProfile: [
            'Conflict: controlled and restrained.',
            'Anger: remains composed rather than explosive.',
            'Composure: becomes quieter and firmer when irritated.',
        ],
    });
    assert.equal(npc.behaviorProfile.length, 1);
    assert.match(npc.behaviorProfile[0], /controlled/i);
    assert.match(npc.behaviorProfile[0], /quieter and firmer/i);
});

test('v0.2.8 Noctis-style paperwork gestures compact into one mannerism pattern', () => {
    const npc = normalizeNpcRecord({
        name: 'Maren Rost',
        mannerisms: [
            'Thrusts quills and parchment at people.',
            'Slaps contract notices onto counters.',
            'Flicks seal-stamps across desks.',
        ],
    });
    assert.deepEqual(npc.mannerisms, ['Handles paperwork with brisk, emphatic physical gestures.']);
});

test('v0.2.8 ambiguous deceased Key Relationship wording is rewritten with an explicit subject', () => {
    const jonas = normalizeNpcRecord({
        name: 'Jonas Hael',
        keyRelationships: ['Brina Hael — Widow and mother of his daughters (deceased).'],
    });
    assert.deepEqual(jonas.keyRelationships, ['Brina Hael — Surviving widow and mother of his daughters']);

    const living = normalizeNpcRecord({ name: 'Marris', keyRelationships: ['Rook — mentor (deceased)'] });
    assert.deepEqual(living.keyRelationships, ['Rook — mentor; deceased']);
});

test('v0.2.8 scanner cannot rewrite manual Importance and new scanned dossiers keep neutral default importance', () => {
    const existing = createNpcRecord('Iria');
    existing.importance = 77;
    const updated = mergeScanResult({ npcs: [existing], turn: 1 }, { npcs: [{
        id: existing.id, name: 'Iria', present: true, importance: 100,
    }] }, { turn: 2 });
    assert.equal(updated.state.npcs[0].importance, 77);

    const created = mergeScanResult({ npcs: [], turn: 0 }, { npcs: [{
        name: 'Newa', identityKind: 'proper_name', dossierSignal: 'meaningful', present: true, importance: 100,
    }] }, { turn: 1 });
    assert.equal(created.state.npcs[0].importance, 50);
});

test('v0.2.8 runtime salience favors current story relevance instead of manual Importance', () => {
    const remote = createNpcRecord('Remote Queen');
    remote.importance = 100;
    remote.lastSeenTurn = 0;
    const mira = createNpcRecord('Mira');
    mira.importance = 0;
    mira.lastSeenTurn = 0;
    const picked = selectRelevantNpcs([remote, mira], 'Mira enters and takes the empty chair.', 10, 1);
    assert.deepEqual(picked.map(npc => npc.name), ['Mira']);
    assert.ok(scoreNpcRelevance(mira, 'Mira enters and takes the empty chair.', 10) > scoreNpcRelevance(remote, 'Mira enters and takes the empty chair.', 10));
});

test('v0.2.8 manual relationship audit remains valid even without a generated evidence reason', () => {
    const npc = normalizeNpcRecord({
        name: 'Iria',
        lastRelationshipChange: { impact: 'manual', delta: { trust: 5 }, reason: '' },
    });
    assert.equal(npc.lastRelationshipChange.impact, 'manual');
    assert.equal(npc.lastRelationshipChange.delta.trust, 5);
});


test('v0.2.10 stock relationship progression uses 1/2/5/10 raw weights and axis limits', () => {
    assert.deepEqual(DEFAULT_RELATIONSHIP_CAPS, { ordinary: 1, meaningful: 2, major: 5, extreme: 10 });
    assert.deepEqual(normalizeRelationshipCaps({}), { ordinary: 1, meaningful: 2, major: 5, extreme: 10 });

    const ordinary = applyRelationshipDelta(
        { trust: 0, affection: 0, desire: 0, tension: 0 },
        { trust: 100, affection: 99, desire: 99, tension: 99 },
        'ordinary',
    );
    assert.deepEqual(ordinary.appliedDelta, { trust: 1, affection: 0, desire: 0, tension: 0 }, 'ordinary affects at most one axis');

    const meaningful = applyRelationshipDelta(
        { trust: 0, affection: 0, desire: 0, tension: 0 },
        { trust: 9, affection: 8, desire: 7, tension: 6 },
        'meaningful',
    );
    assert.deepEqual(meaningful.appliedDelta, { trust: 2, affection: 2, desire: 0, tension: 0 }, 'meaningful affects at most two axes');
});

test('v0.2.10 relationship weight accumulates fractionally and makes extremes progressively harder', () => {
    let relationship = { trust: 85, affection: 0, desire: 0, tension: 0 };
    let progress = normalizeRelationshipProgress();
    for (let i = 0; i < 4; i += 1) {
        const step = applyRelationshipDelta(relationship, { trust: 1 }, 'ordinary', DEFAULT_RELATIONSHIP_CAPS, progress);
        relationship = step.relationship;
        progress = step.relationshipProgress;
        assert.equal(step.appliedDelta.trust, 0, 'high-score ordinary evidence should accumulate without forcing a visible point');
    }
    const fifth = applyRelationshipDelta(relationship, { trust: 1 }, 'ordinary', DEFAULT_RELATIONSHIP_CAPS, progress);
    assert.equal(fifth.appliedDelta.trust, 1, 'five valid +1 beats at 85 should finally produce one visible point');
    assert.equal(fifth.relationship.trust, 86);

    const extreme = applyRelationshipDelta(
        { trust: 90, affection: 0, desire: 0, tension: 0 },
        { trust: 10 },
        'extreme',
    );
    assert.equal(extreme.appliedDelta.trust, 2, 'extreme +10 is raw evidence before high-score resistance');

    const minorSetback = applyRelationshipDelta(
        { trust: 90, affection: 0, desire: 0, tension: 0 },
        { trust: -1 },
        'ordinary',
    );
    assert.equal(minorSetback.appliedDelta.trust, 0, 'a minor setback should not instantly shave a point from very high trust');
    assert.equal(minorSetback.relationshipProgress.trust, -0.4);

    const catastrophic = applyRelationshipDelta(
        { trust: 90, affection: 0, desire: 0, tension: 0 },
        { trust: -10 },
        'extreme',
    );
    assert.equal(catastrophic.appliedDelta.trust, -10, 'extreme contrary evidence can punch through established resilience');
});

test('v0.2.11 directional relationship milestones gate deeper bands instead of allowing repetition to grind through', () => {
    const locked25 = applyRelationshipDelta(
        { trust: 25, affection: 0, desire: 0, tension: 0 },
        { trust: 1 },
        'ordinary',
        DEFAULT_RELATIONSHIP_CAPS,
        { trust: 0.8 },
        [],
    );
    assert.equal(locked25.relationship.trust, 25);
    assert.equal(locked25.relationshipProgress.trust, 0, 'outward hidden progress cannot bank behind a locked checkpoint');
    assert.deepEqual(locked25.milestoneBlocks.map(item => item.threshold), [25]);

    const opened25 = applyRelationshipDelta(
        { trust: 25, affection: 0, desire: 0, tension: 0 },
        { trust: 1 },
        'meaningful',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [],
    );
    assert.equal(opened25.relationship.trust, 26);
    assert.ok(opened25.milestoneCrossings.some(item => item.axis === 'trust' && item.polarity === 1 && item.threshold === 25));

    const locked50 = applyRelationshipDelta(
        { trust: 50, affection: 0, desire: 0, tension: 0 },
        { trust: 2 },
        'meaningful',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [{ axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier trust breakthrough.' }],
    );
    assert.equal(locked50.relationship.trust, 50);
    assert.equal(locked50.relationshipProgress.trust, 0);
    assert.ok(locked50.milestoneBlocks.some(item => item.threshold === 50 && item.requiredImpact === 'major'));

    const opened50 = applyRelationshipDelta(
        { trust: 50, affection: 0, desire: 0, tension: 0 },
        { trust: 5 },
        'major',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [{ axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier trust breakthrough.' }],
    );
    assert.ok(opened50.relationship.trust > 50);
    assert.ok(opened50.milestoneCrossings.some(item => item.threshold === 50));

    const locked75 = applyRelationshipDelta(
        { trust: 75, affection: 0, desire: 0, tension: 0 },
        { trust: 5 },
        'major',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [
            { axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 50, reason: 'Earlier.' },
        ],
    );
    assert.equal(locked75.relationship.trust, 75);
    assert.ok(locked75.milestoneBlocks.some(item => item.threshold === 75 && item.requiredImpact === 'extreme'));

    const opened75 = applyRelationshipDelta(
        { trust: 75, affection: 0, desire: 0, tension: 0 },
        { trust: 10 },
        'extreme',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [
            { axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 50, reason: 'Earlier.' },
        ],
    );
    assert.ok(opened75.relationship.trust > 75);
    assert.ok(opened75.milestoneCrossings.some(item => item.threshold === 75));

    const locked90 = applyRelationshipDelta(
        { trust: 90, affection: 0, desire: 0, tension: 0 },
        { trust: 5 },
        'major',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [
            { axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 50, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 75, reason: 'Earlier.' },
        ],
    );
    assert.equal(locked90.relationship.trust, 90);
    assert.ok(locked90.milestoneBlocks.some(item => item.threshold === 90 && item.requiredImpact === 'extreme'));

    const mislabeledTinyExtreme = applyRelationshipDelta(
        { trust: 90, affection: 0, desire: 0, tension: 0 },
        { trust: 1 },
        'extreme',
        DEFAULT_RELATIONSHIP_CAPS,
        normalizeRelationshipProgress(),
        [
            { axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 50, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 75, reason: 'Earlier.' },
        ],
    );
    assert.equal(mislabeledTinyExtreme.relationship.trust, 90);
    assert.equal(mislabeledTinyExtreme.milestoneCrossings.length, 0, 'an extreme label alone cannot unlock 90 with trivial raw evidence');
    assert.ok(mislabeledTinyExtreme.milestoneBlocks.some(item => item.threshold === 90 && item.requiredRaw === 8));
});

test('v0.2.11 milestone history is directional and legacy depth infers only thresholds already passed', () => {
    const legacy = normalizeRelationshipMilestones(undefined, { trust: 63, affection: 0, desire: 0, tension: 0 });
    assert.equal(relationshipMilestoneUnlocked(legacy, 'trust', 1, 25), true);
    assert.equal(relationshipMilestoneUnlocked(legacy, 'trust', 1, 50), true);
    assert.equal(relationshipMilestoneUnlocked(legacy, 'trust', 1, 75), false);
    assert.equal(relationshipMilestoneUnlocked(legacy, 'trust', -1, 25), false, 'deep trust never unlocks deep distrust');

    const manual = inferManualRelationshipMilestones([], { trust: -75, affection: 0, desire: 0, tension: 0 });
    assert.equal(relationshipMilestoneUnlocked(manual, 'trust', -1, 25), true);
    assert.equal(relationshipMilestoneUnlocked(manual, 'trust', -1, 50), true);
    assert.equal(relationshipMilestoneUnlocked(manual, 'trust', -1, 75), true, 'manual authority may establish the checkpoint itself');
    assert.equal(relationshipMilestoneUnlocked(manual, 'trust', 1, 25), false);
});

test('v0.2.11 movement toward neutral is never milestone-blocked and opposing evidence cancels hidden progress first', () => {
    const setback = applyRelationshipDelta(
        { trust: 75, affection: 0, desire: 0, tension: 0 },
        { trust: -2 },
        'meaningful',
        DEFAULT_RELATIONSHIP_CAPS,
        { trust: 0.7 },
        [
            { axis: 'trust', polarity: 1, threshold: 25, reason: 'Earlier.' },
            { axis: 'trust', polarity: 1, threshold: 50, reason: 'Earlier.' },
        ],
    );
    assert.equal(setback.milestoneBlocks.length, 0);
    assert.ok(setback.relationship.trust <= 75);
    assert.ok(setback.relationshipProgress.trust <= 0.7, 'contrary evidence consumes the old outward remainder before building the opposite direction');
});

test('v0.2.11 checkpoint-blocked evidence is retained for dedupe without replacing the last actual relationship change', () => {
    const npc = createNpcRecord('Myla');
    npc.relationship.trust = 25;
    npc.relationshipProgress.trust = 0;
    npc.relationshipMilestones = [];
    npc.lastRelationshipChange = {
        impact: 'meaningful',
        delta: { trust: 2, affection: 0, desire: 0, tension: 0 },
        evidence: { trust: 'Myla deliberately entrusted the player with her medicine.', affection: '', desire: '', tension: '' },
        reason: 'Myla entrusted the player with her medicine after he kept his earlier promise.',
        sourceMessageId: 8,
        turn: 4,
    };
    const previousLastChange = structuredClone(npc.lastRelationshipChange);
    const result = mergeScanResult({ npcs: [npc], turn: 5 }, { npcs: [{
        id: npc.id,
        name: 'Myla',
        present: true,
        relationshipImpact: 'ordinary',
        relationshipDelta: { trust: 1, affection: 0, desire: 0, tension: 0 },
        relationshipEvidence: { trust: 'The player again arrived exactly when promised.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'The player again arrived exactly when promised.',
        relationshipSummary: 'Myla now treats the player as unquestionably central to her deepest trust.',
    }] }, {
        turn: 6,
        sourceMessageId: 12,
        developmentContext: 'The player again arrived exactly when promised, and Myla acknowledged his punctuality.',
    });
    const merged = result.state.npcs[0];
    assert.equal(merged.relationship.trust, 25);
    assert.equal(merged.relationshipProgress.trust, 0, 'blocked outward evidence must not bank behind the milestone');
    assert.deepEqual(merged.lastRelationshipChange, previousLastChange, 'blocked evidence is not an actual relationship change');
    assert.equal(merged.relationshipEventHistory.length, 1, 'blocked but valid evidence is still retained for replay dedupe');
    assert.match(merged.relationshipEventHistory[0].reason, /arrived exactly when promised/i);
    assert.doesNotMatch(merged.relationshipSummary, /unquestionably central|deepest trust/i, 'blocked evidence cannot advance relationship prose');
});

test('v0.2.10 recent relationship event history rejects duplicate awards beyond only the last event', () => {
    const previous = {
        impact: 'meaningful',
        delta: { trust: 3, affection: 2, desire: 0, tension: 0 },
        evidence: { trust: 'The rescue proved the player reliable.', affection: '', desire: '', tension: '' },
        reason: 'The player rescued Myla from the collapsing bridge.',
        sourceMessageId: 20,
        turn: 10,
    };
    assert.equal(relationshipChangeLooksDuplicate(previous, 'The player rescued Myla from the collapsing bridge.', { sourceMessageId: 22, turn: 11 }), true);
    assert.equal(relationshipChangeLooksDuplicate(previous, 'The player kept a new promise weeks later.', { sourceMessageId: 40, turn: 25 }), false);

    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla';
    const first = mergeScanResult({ npcs: [npc], turn: 9 }, { npcs: [{
        id: npc.id, present: true, relationshipImpact: 'ordinary', relationshipDelta: { trust: 1 },
        relationshipEvidence: { trust: 'Returning the medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'The player returned Myla\'s lost medicine.',
    }] }, { turn: 10, sourceMessageId: 20, developmentContext: 'The player returned Myla\'s lost medicine.' });
    const second = mergeScanResult(first.state, { npcs: [{
        id: npc.id, present: true, relationshipImpact: 'ordinary', relationshipDelta: { trust: 1 },
        relationshipEvidence: { trust: 'Returning the medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'The player returned Myla\'s lost medicine.',
    }] }, { turn: 11, sourceMessageId: 22, developmentContext: 'Myla continues thanking the player for returning her lost medicine.' });
    assert.equal(second.state.npcs[0].relationship.trust, 1, 'the same event must not be re-awarded on its immediate aftermath');
});

test('v0.2.9 runtime injection makes identity and live state dominant over high relationship scores', () => {
    const npc = createNpcRecord('Falia Rendel');
    Object.assign(npc, {
        present: true,
        personality: 'Reserved, duty-bound, kind-hearted, pragmatic, and independent.',
        speech: 'Measured, formal, and concise.',
        behaviorProfile: ['Disposition: broadly kind.', 'Independence: high.', 'Conflict: controlled.'],
        mannerisms: ['Habitually pauses before difficult answers.'],
        goal: 'Protect the caravan even when doing so conflicts with personal wishes.',
        keyRelationships: ['Rin — younger sister | deeply loved'],
        mood: 'furious',
        status: 'wounded but functional',
        relationship: { trust: 95, affection: 96, desire: 82, tension: 71 },
    });
    const injection = buildInjection([npc], 'Falia refuses to leave the caravan.', 20, 1, DEFAULT_BEHAVIOR_CRITERIA, 900);
    assert.match(injection, /IDENTITY FIRST \/ DOMINATES/i);
    assert.match(injection, /Reserved, duty-bound, kind-hearted/i);
    assert.match(injection, /current goal: Protect the caravan/i);
    assert.match(injection, /CURRENT STATE: mood: furious; status: wounded but functional/i);
    assert.match(injection, /PLAYER RELATIONSHIP \(secondary modifier\)/i);
    assert.ok(injection.indexOf('IDENTITY (authoritative):') < injection.indexOf('PLAYER RELATIONSHIP (secondary modifier):'));
    assert.ok(injection.indexOf('CURRENT STATE:') < injection.indexOf('PLAYER RELATIONSHIP (secondary modifier):'));
    assert.match(injection, /High scores never mean.*jealousy.*tsundere/i);
    assert.doesNotMatch(buildBehaviorGuidance(npc), /blush|stammer|possessive|tsundere/i);
});

test('v0.2.9 low relationship values do not occupy runtime space with four neutral axis explanations', () => {
    const npc = createNpcRecord('Marris Vale');
    npc.present = true;
    npc.personality = 'Quiet and observant.';
    npc.relationship = { trust: 12, affection: 8, desire: 0, tension: -5 };
    const injection = buildInjection([npc], 'Marris watches the road.', 5, 1, DEFAULT_BEHAVIOR_CRITERIA, 700);
    assert.match(injection, /mostly neutral or unsettled/i);
    assert.doesNotMatch(injection, /trust \+12|affection \+8|desire 0|tension -5/i);
});

test('v0.2.9 relevance recognizes a grounded first-name reference without restoring relationship-score salience', () => {
    const falia = createNpcRecord('Falia Rendel');
    falia.present = true;
    falia.lastSeenTurn = 1;
    falia.relationship = { trust: 0, affection: 0, desire: 0, tension: 0 };
    const selected = selectRelevantNpcs([falia], 'Falia steps between the caravan and the roadblock.', 100, 1);
    assert.equal(selected[0]?.id, falia.id);
});

test('v0.2.10 Desire requires attraction evidence in both axis explanation and narration', () => {
    const rescueEvidence = 'Myla felt sexually attracted to the player after the rescue.';
    assert.equal(
        relationshipAxisEvidenceGrounded('desire', rescueEvidence, 'The player pulled Myla from the river and saved her life.'),
        false,
        'a model cannot manufacture Desire by adding attraction words to a non-romantic rescue',
    );
    assert.equal(
        relationshipAxisEvidenceGrounded('desire', 'Myla explicitly admitted romantic attraction and wanted intimate closeness.', 'Myla admitted she was romantically attracted to the player and asked to kiss them.'),
        true,
        'explicit attraction in the narration can ground Desire',
    );
});

test('v0.2.10 event history catches A-B-A replay instead of remembering only the last award', () => {
    const history = [
        {
            impact: 'ordinary', reason: 'The player returned Myla\'s lost medicine.',
            evidence: { trust: 'Returning the medicine proved the player dependable.', affection: '', desire: '', tension: '' },
            sourceMessageId: 20, turn: 10,
        },
        {
            impact: 'ordinary', reason: 'The player later respected Myla\'s request for privacy.',
            evidence: { trust: 'Respecting the boundary reinforced that the player was reliable.', affection: '', desire: '', tension: '' },
            sourceMessageId: 22, turn: 11,
        },
    ];
    assert.equal(relationshipHistoryLooksDuplicate(
        history,
        'The player returned Myla\'s lost medicine.',
        { sourceMessageId: 24, turn: 12, evidence: { trust: 'Returning the medicine proved the player dependable.' } },
    ), true);
});

test('v0.2.10 a rejected duplicate relationship event cannot rewrite durable relationship prose', () => {
    const npc = createNpcRecord('Myla');
    npc.id = 'npc_myla_summary_gate';
    npc.relationship = { trust: 35, affection: 15, desire: 0, tension: 0 };
    npc.relationshipSummary = 'She cautiously appreciates the player as a dependable ally.';
    npc.relationshipEventHistory = [{
        impact: 'meaningful', reason: 'The player returned Myla\'s stolen medicine.',
        evidence: { trust: 'Returning the stolen medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        sourceMessageId: 30, turn: 20,
    }];
    const result = mergeScanResult({ npcs: [npc], turn: 20 }, { npcs: [{
        id: npc.id,
        present: true,
        relationshipImpact: 'meaningful',
        relationshipDelta: { trust: 2, affection: 0, desire: 0, tension: 0 },
        relationshipEvidence: { trust: 'Returning the stolen medicine proved the player dependable.', affection: '', desire: '', tension: '' },
        relationshipChangeReason: 'The player returned Myla\'s stolen medicine.',
        relationshipSummary: 'She now regards the player as one of her closest and most trusted companions.',
    }] }, {
        turn: 21,
        sourceMessageId: 32,
        developmentContext: 'Myla again thanks the player for returning her stolen medicine earlier.',
    });
    assert.equal(result.state.npcs[0].relationshipSummary, npc.relationshipSummary);
    assert.equal(result.state.npcs[0].relationship.trust, 35);
});

test('v0.2.10 relationship summaries reject unsupported romance and possessive archetype claims', () => {
    const poisoned = 'She is madly in love, sexually attracted, possessive, and would kill anyone who threatens the player.';
    assert.equal(relationshipSummaryConsistent(poisoned, { trust: 20, affection: 20, desire: 0, tension: 0 }), false);
    assert.equal(relationshipSummaryConsistent('She increasingly trusts the player as a dependable ally.', { trust: 35, affection: 10, desire: 0, tension: 0 }), true);
});

test('v0.2.10 RP injection exposes one qualitative relationship lens and no raw meter numbers', () => {
    const npc = createNpcRecord('Falia Rendel');
    Object.assign(npc, {
        present: true,
        personality: 'Reserved, duty-bound, kind, and independent.',
        goal: 'Protect the caravan.',
        relationship: { trust: 92, affection: 90, desire: 72, tension: 35 },
        relationshipSummary: 'She cares deeply for the player but remains restrained and duty-bound.',
    });
    const injection = buildInjection([npc], 'Falia watches the caravan road.', 20, 1, DEFAULT_BEHAVIOR_CRITERIA, 900);
    assert.doesNotMatch(injection, /trust\s*[+-]?\d+|affection\s*[+-]?\d+|desire\s*[+-]?\d+|tension\s*[+-]?\d+/i);
    assert.equal((injection.match(/She cares deeply for the player but remains restrained and duty-bound\./g) || []).length, 1);
});

test('v0.2.10 the 95+ band needs ten ordinary evidence beats for one visible point', () => {
    let relationship = { trust: 95, affection: 0, desire: 0, tension: 0 };
    let progress = normalizeRelationshipProgress();
    for (let i = 0; i < 9; i += 1) {
        const step = applyRelationshipDelta(relationship, { trust: 1 }, 'ordinary', DEFAULT_RELATIONSHIP_CAPS, progress);
        relationship = step.relationship;
        progress = step.relationshipProgress;
        assert.equal(step.appliedDelta.trust, 0);
    }
    const tenth = applyRelationshipDelta(relationship, { trust: 1 }, 'ordinary', DEFAULT_RELATIONSHIP_CAPS, progress);
    assert.equal(tenth.appliedDelta.trust, 1);
    assert.equal(tenth.relationship.trust, 96);
});

test('v0.2.10 ambiguous equal multi-axis overflow is rejected instead of favoring Trust and Affection', () => {
    const result = applyRelationshipDelta(
        { trust: 0, affection: 0, desire: 0, tension: 0 },
        { trust: 2, affection: 2, desire: 2, tension: 0 },
        'meaningful',
    );
    assert.deepEqual(result.appliedDelta, { trust: 0, affection: 0, desire: 0, tension: 0 });
    assert.deepEqual(result.evidenceDelta, { trust: 0, affection: 0, desire: 0, tension: 0 });
});

test('v0.2.10 relationship event history is bounded to six recent evidence events', () => {
    const history = Array.from({ length: 9 }, (_, i) => ({
        impact: 'ordinary',
        reason: `Distinct relationship event ${i}`,
        evidence: { trust: `Trust evidence event ${i}`, affection: '', desire: '', tension: '' },
        sourceMessageId: i,
        turn: i,
    }));
    const normalized = normalizeNpcRecord({ name: 'Myla', relationshipEventHistory: history }).relationshipEventHistory;
    assert.equal(normalized.length, 6);
    assert.match(normalized[0].reason, /event 3$/);
    assert.match(normalized[5].reason, /event 8$/);
});
