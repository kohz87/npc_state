from pathlib import Path
import re
import json

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, value):
    (ROOT / path).write_text(value, encoding='utf-8')


def replace_once(value, old, new, label):
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return value.replace(old, new, 1)


def regex_once(value, pattern, repl, label):
    out, count = re.subn(pattern, repl, value, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return out


index = read('index.js')
index = replace_once(index,
    '/* NPC State v0.2.22 - standalone SillyTavern extension */',
    '/* NPC State v0.2.23 - standalone SillyTavern extension */',
    'index version banner')
index = replace_once(index,
    'let portraitGenerationBusy = false;\nlet lastViewerActivation',
    'let portraitGenerationBusy = false;\nlet portraitSettingsDirty = false;\nlet portraitSettingsSaveBusy = false;\nlet lastViewerActivation',
    'portrait settings state vars')
index = replace_once(index, '    schemaVersion: 28,', '    schemaVersion: 29,', 'schema version')

index = replace_once(index,
'''    state.pendingBackfills.push({
        npcId: String(npcId).slice(0, 100),
        label: cleanLabel,
        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,
        preserveLiveState: options?.preserveLiveState === true,
        requestedAt: Date.now(),
        attempts: 0,
        lastAttemptAt: 0,
    });
    if (state.pendingBackfills.length > 8) state.pendingBackfills.splice(0, state.pendingBackfills.length - 8);''',
'''    state.pendingBackfills.push({
        npcId: String(npcId).slice(0, 100),
        label: cleanLabel,
        requestedMessageId: Number.isInteger(requestedMessageId) ? requestedMessageId : null,
        preserveLiveState: options?.preserveLiveState === true,
        deepSweep: options?.deepSweep === true,
        silent: options?.silent === true,
        requestedAt: Date.now(),
        attempts: 0,
        lastAttemptAt: 0,
    });
    if (state.pendingBackfills.length > 100) state.pendingBackfills.splice(0, state.pendingBackfills.length - 100);''',
    'backfill queue metadata/cap')

index = replace_once(index,
'''function transcriptMentionsBackfillTarget(transcript, label) {
    const target = normalizeName(label);
    const haystack = normalizeName(transcript);
    if (!target || !haystack) return false;
    return (` ${haystack} `).includes(` ${target} `);
}


function dossierLabelsMatch''',
'''function transcriptMentionsBackfillTarget(transcript, label) {
    const target = normalizeName(label);
    const haystack = normalizeName(transcript);
    if (!target || !haystack) return false;
    return (` ${haystack} `).includes(` ${target} `);
}

function transcriptMentionsNpcRecord(transcript, npc) {
    const haystack = ` ${normalizeName(transcript)} `;
    if (!haystack.trim() || !npc) return false;
    const labels = [npc.name, ...(npc.aliases || [])]
        .map(normalizeName)
        .filter(label => label.length >= 2);
    return labels.some(label => haystack.includes(` ${label} `));
}

function currentExchangeRelationshipRelevant(npc, transcript, raw = null, { currentExchangeOnly = false } = {}) {
    if (!npc || npc.archived) return false;
    if (transcriptMentionsNpcRecord(transcript, npc)) return true;
    if (npc.present || npc.worldActive) return true;
    return !currentExchangeOnly && Boolean(raw);
}


function dossierLabelsMatch''',
    'participant mention helpers')

index = replace_once(index,
'''    const transcript = recentTranscript(settings.scanDepth);
    if (!transcript) return false;
    const scanLineage = chatLineage(ctx.chat || []);''',
'''    const transcript = recentTranscript(settings.scanDepth);
    if (!transcript) return false;
    // Cast-wide deep sweeps consider every active dossier, but an NPC with no name/alias
    // anywhere in the configured history window has no evidence that this pass can safely
    // reconcile. Treat it as a clean no-op rather than spending a model call or creating a retry.
    if (request.deepSweep === true && !transcriptMentionsNpcRecord(transcript, existing)) return true;
    const scanLineage = chatLineage(ctx.chat || []);''',
    'deep sweep evidence no-op')
index = replace_once(index,
'''            console.warn('[NPC State] targeted backfill returned no accepted NPC', { target: request.label, literalMention, returnedCount: returned.length });
            globalThis.toastr?.warning?.(`NPC State: ${request.label} was added, but the backfill model returned no matching dossier details from the last ${settings.scanDepth} messages.`);
            return false;''',
'''            console.warn('[NPC State] targeted backfill returned no accepted NPC', { target: request.label, literalMention, returnedCount: returned.length });
            if (!request.silent) globalThis.toastr?.warning?.(`NPC State: ${request.label} was added, but the backfill model returned no matching dossier details from the last ${settings.scanDepth} messages.`);
            return false;''',
    'silent backfill miss')
index = replace_once(index,
'''        globalThis.toastr?.success?.(`NPC State: backfilled ${savedNpc?.name || request.label} from recent story context.`);
        return true;
    } catch (error) {
        console.error('[NPC State] dossier backfill failed', error);
        globalThis.toastr?.warning?.(`NPC State backfill failed for ${request.label}: ${error?.message || error}`);''',
'''        if (!request.silent) globalThis.toastr?.success?.(`NPC State: backfilled ${savedNpc?.name || request.label} from recent story context.`);
        return true;
    } catch (error) {
        console.error('[NPC State] dossier backfill failed', error);
        if (!request.silent) globalThis.toastr?.warning?.(`NPC State backfill failed for ${request.label}: ${error?.message || error}`);''',
    'silent backfill result toasts')

new_process = r'''async function processPendingBackfills(messageId = null) {
    const chatKey = getChatKey();
    if (chatKey === 'no-chat' || !requireReadyChatMutation('process queued dossier backfills', chatKey, { notify: false }) || isScanBusy(chatKey) || isHostSwipeActive()) return 0;
    let processed = 0;
    const attemptedNpcIds = new Set();
    while (getChatKey() === chatKey && !isScanBusy(chatKey)) {
        const state = getChatState(chatKey);
        if (!Array.isArray(state.pendingBackfills) || !state.pendingBackfills.length) break;
        const request = state.pendingBackfills.find(item => item?.npcId && !attemptedNpcIds.has(item.npcId));
        if (!request) break;
        attemptedNpcIds.add(request.npcId);
        const attempts = Math.max(0, Math.round(Number(request.attempts) || 0));
        if (attempts >= BACKFILL_MAX_ATTEMPTS) {
            state.pendingBackfills = state.pendingBackfills.filter(item => item.npcId !== request.npcId);
            persist();
            if (!request.silent) globalThis.toastr?.warning?.(`NPC State: stopped automatic backfill retries for ${request.label} after ${BACKFILL_MAX_ATTEMPTS} failed attempts. The bare dossier is preserved; use Scan dossier to retry manually.`);
            continue;
        }
        const lastAttemptAt = Math.max(0, Number(request.lastAttemptAt || 0) || 0);
        if (attempts > 0 && lastAttemptAt && Date.now() - lastAttemptAt < BACKFILL_RETRY_COOLDOWN_MS) continue;

        const succeeded = await backfillNpcFromHistory(request, messageId);
        const latest = getChatState(chatKey);
        if (!succeeded) {
            const queued = (latest.pendingBackfills || []).find(item => item.npcId === request.npcId);
            if (queued) {
                queued.attempts = attempts + 1;
                queued.lastAttemptAt = Date.now();
                if (queued.attempts >= BACKFILL_MAX_ATTEMPTS) {
                    latest.pendingBackfills = latest.pendingBackfills.filter(item => item.npcId !== request.npcId);
                    if (!queued.silent) globalThis.toastr?.warning?.(`NPC State: automatic backfill for ${queued.label} failed ${BACKFILL_MAX_ATTEMPTS} times and was removed from the retry queue. The dossier itself was not deleted.`);
                }
            }
            persist();
            // One failed dossier must not starve the rest of a cast reconciliation sweep.
            continue;
        }
        latest.pendingBackfills = (latest.pendingBackfills || []).filter(item => item.npcId !== request.npcId);
        persist();
        processed += 1;
    }
    return processed;
}'''
index = regex_once(index,
    r'async function processPendingBackfills\(messageId = null\) \{.*?\n\}\n\nfunction rawScanMatchesExisting',
    new_process + '\n\nfunction rawScanMatchesExisting',
    'pending backfill processor')

new_relationship = r'''async function runFocusedRelationshipPass(ctx, parsed, existingNpcs, transcript, settings, options = {}) {
    const returned = Array.isArray(parsed?.npcs) ? parsed.npcs : [];
    // Relationship reconciliation is keyed to the CURRENT exchange, not to whether the broad
    // dossier scanner happened to return a row. This prevents an NPC who acts early in a long
    // response from being skipped merely because the response ends with another cast/location.
    const targets = (Array.isArray(existingNpcs) ? existingNpcs : [])
        .filter(npc => !npc?.archived)
        .filter(npc => {
            const raw = returned.find(item => rawScanMatchesExisting(item, npc));
            if (!currentExchangeRelationshipRelevant(npc, transcript, raw, options)) return false;
            return !raw || !hasCompletePrimaryRelationshipDecision(raw, transcript);
        });
    if (!targets.length) return { decisions: new Map(), used: false, responseChars: 0, retried: false, targetCount: 0 };

    const decisions = new Map();
    let responseChars = 0;
    let retried = false;
    let failed = false;
    for (let offset = 0; offset < targets.length; offset += 4) {
        const batch = targets.slice(offset, offset + 4);
        try {
            const relationshipPrompt = buildRelationshipPassPrompt({
                transcript,
                targets: batch,
                userName: ctx.name1 || 'User',
                relationshipCriteria: settings.relationshipCriteria,
                impactCriteria: settings.relationshipImpactCriteria,
                relationshipCaps: settings.relationshipCaps,
            });
            const { parsed: relationshipParsed, raw, retried: batchRetried } = await generateParsedNpcJson(ctx, {
                systemPrompt: "You are NPC State's isolated relationship evaluator. Use only the supplied targets and current exchange. Return only the requested JSON object.",
                prompt: relationshipPrompt,
                responseLength: RELATIONSHIP_RESPONSE_LENGTH,
                label: `relationship pass ${Math.floor(offset / 4) + 1}`,
            });
            responseChars += String(raw ?? '').length;
            retried ||= Boolean(batchRetried);
            for (const target of batch) {
                const rawDecision = (relationshipParsed.npcs || []).find(item => String(item?.id || '') === String(target.id) || (item?.name && npcMatchesLabel(target, item.name)));
                if (!rawDecision) continue;
                const deltaSource = rawDecision.relationshipDelta ?? rawDecision.relationship_delta;
                const hasFullDelta = deltaSource && typeof deltaSource === 'object'
                    && ['trust', 'affection', 'desire', 'tension'].every(key => Number.isFinite(Number(deltaSource[key])));
                if (!hasFullDelta) continue;
                const normalized = normalizeScanNpc(rawDecision);
                const requestedHasDelta = Object.values(normalized.relationshipDelta).some(value => value !== 0);
                const reasonPresent = Boolean(String(normalized.relationshipChangeReason || '').trim());
                const relationshipDelta = requestedHasDelta && reasonPresent
                    ? filterRelationshipDeltaByEvidence(normalized.relationshipDelta, normalized.relationshipEvidence, transcript)
                    : { trust: 0, affection: 0, desire: 0, tension: 0 };
                const hasNonZeroNormalizedDelta = Object.values(relationshipDelta).some(value => value !== 0);
                const relationshipImpact = hasNonZeroNormalizedDelta ? normalized.relationshipImpact : 'none';
                const rawSummary = rawDecision.relationshipSummary ?? rawDecision.relationship_summary;
                const explicitSummaryProvided = typeof rawSummary === 'string';
                const explicitSummary = explicitSummaryProvided ? String(rawSummary).trim().slice(0, 700) : '';
                const hasNonZeroDelta = Object.values(relationshipDelta).some(value => value !== 0);
                const needsTurningPointSummary = hasNonZeroDelta && ['major', 'extreme'].includes(relationshipImpact);
                const fallbackSummary = needsTurningPointSummary && !explicitSummary && normalized.relationshipChangeReason
                    ? `${target.name || 'This NPC'}'s relationship with the player changed ${normalized.relationshipImpact === 'extreme' ? 'fundamentally' : 'substantially'}: ${normalized.relationshipChangeReason}`.slice(0, 700)
                    : '';
                const relationshipSummary = explicitSummary || fallbackSummary;
                const relationshipSummaryDecisionProvided = explicitSummaryProvided || Boolean(fallbackSummary);
                decisions.set(target.id, {
                    relationshipDelta,
                    relationshipImpact,
                    relationshipEvidence: normalized.relationshipEvidence,
                    relationshipChangeReason: normalized.relationshipChangeReason,
                    relationshipSummary,
                    relationshipSummaryDecisionProvided,
                });
            }
            const missing = batch.filter(target => !decisions.has(target.id));
            if (missing.length) {
                console.warn('[NPC State] focused relationship pass omitted or malformed one or more target decisions.', {
                    targets: batch.map(npc => npc.id),
                    decided: batch.filter(npc => decisions.has(npc.id)).map(npc => npc.id),
                });
            }
        } catch (error) {
            failed = true;
            console.warn('[NPC State] focused relationship batch failed; retaining safe zero/primary output for that batch.', error);
        }
    }
    return { decisions, used: true, responseChars, retried, targetCount: targets.length, failed };
}'''
index = regex_once(index,
    r'async function runFocusedRelationshipPass\(ctx, parsed, existingNpcs, transcript, settings\) \{.*?\n\}\n\nfunction prepareFullWindowRelationshipEvaluation',
    new_relationship + '\n\nfunction prepareFullWindowRelationshipEvaluation',
    'focused relationship pass')

index = replace_once(index,
'''        const relationshipPass = await runFocusedRelationshipPass(ctx, fullWindowRelationship.evaluation, state.npcs, currentTranscript || transcript, settings);''',
'''        const relationshipPass = await runFocusedRelationshipPass(
            ctx,
            fullWindowRelationship.evaluation,
            state.npcs,
            currentTranscript || transcript,
            settings,
            { currentExchangeOnly: fullWindowScan },
        );''',
    'existing relationship pass options')
index = replace_once(index,
'''                        currentTranscript || transcript,
                        settings,
                    );''',
'''                        currentTranscript || transcript,
                        settings,
                        { currentExchangeOnly: true },
                    );''',
    'new NPC relationship pass options')

index = replace_once(index,
'''        if (!manual && newlyAdmittedIds.length) {
            for (const id of newlyAdmittedIds) {
                const npc = nextState.npcs.find(item => item.id === id && !item.archived);
                if (npc) queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId, { preserveLiveState: true });
            }
        }''',
'''        if (!manual) {
            // If the broad scanner omitted an NPC explicitly involved anywhere in the current
            // exchange, schedule a silent targeted continuity repair so memories/profile changes
            // get the same second chance as relationship scoring.
            const touchedIds = new Set([...(merged.report?.updated || []), ...newlyAdmittedIds]);
            for (const npc of nextState.npcs || []) {
                if (npc.archived || touchedIds.has(npc.id) || !transcriptMentionsNpcRecord(currentTranscript || '', npc)) continue;
                queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId, {
                    preserveLiveState: true,
                    silent: true,
                });
            }

            // A cast topology change is a natural checkpoint for a deeper continuity sweep.
            // Consider every active dossier; the backfill worker turns dossiers with no evidence
            // in the configured history window into clean no-ops instead of spending model calls.
            if (newlyAdmittedIds.length) {
                for (const npc of nextState.npcs || []) {
                    if (npc.archived) continue;
                    queueNpcBackfillInState(nextState, npc.id, npc.name, targetMessageId, {
                        preserveLiveState: true,
                        deepSweep: true,
                        silent: true,
                    });
                }
            }
        }''',
    'participant repair and cast sweep queueing')

# Portrait settings become an explicit draft + Save transaction.
index = replace_once(index,
'''              <div class="npc-state-actions npc-state-tuning-actions"><div id="npc_state_reset_portrait_theme" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset Fantasy Anime theme</div></div>''',
'''              <div class="npc-state-actions npc-state-tuning-actions">
                <div id="npc_state_reset_portrait_theme" class="menu_button"><i class="fa-solid fa-rotate-left"></i> Reset Fantasy Anime theme</div>
                <div id="npc_state_save_portrait_settings" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> Save Portrait Settings</div>
                <small id="npc_state_portrait_settings_status" class="npc-state-muted">Saved</small>
              </div>''',
    'portrait save UI')

portrait_sync_old = '''    $('#npc_state_portrait_generation_enabled').prop('checked', s.portraitGenerationEnabled !== false);
    $('#npc_state_portrait_theme_preset').val(s.portraitThemePreset);
    $('#npc_state_portrait_style_positive').val(s.portraitStylePositive);
    $('#npc_state_portrait_style_negative').val(s.portraitStyleNegative);
    $('#npc_state_portrait_composition').val(s.portraitComposition);
    $('#npc_state_portrait_prompt_format').val(s.portraitPromptFormat);
    $('#npc_state_portrait_use_mood').prop('checked', s.portraitUseMood !== false);
    $('#npc_state_portrait_use_location').prop('checked', s.portraitUseLocation === true);
    $('#npc_state_portrait_save_gallery').prop('checked', s.portraitSaveToGallery === true);'''
portrait_sync_new = '''    if (!portraitSettingsDirty) {
        $('#npc_state_portrait_generation_enabled').prop('checked', s.portraitGenerationEnabled !== false);
        $('#npc_state_portrait_theme_preset').val(s.portraitThemePreset);
        $('#npc_state_portrait_style_positive').val(s.portraitStylePositive);
        $('#npc_state_portrait_style_negative').val(s.portraitStyleNegative);
        $('#npc_state_portrait_composition').val(s.portraitComposition);
        $('#npc_state_portrait_prompt_format').val(s.portraitPromptFormat);
        $('#npc_state_portrait_use_mood').prop('checked', s.portraitUseMood !== false);
        $('#npc_state_portrait_use_location').prop('checked', s.portraitUseLocation === true);
        $('#npc_state_portrait_save_gallery').prop('checked', s.portraitSaveToGallery === true);
    }
    updatePortraitSettingsSaveUi();'''
index = replace_once(index, portrait_sync_old, portrait_sync_new, 'portrait sync dirty guard')

portrait_helpers = r'''
function portraitSettingsSnapshot(source = getSettings()) {
    return {
        portraitGenerationEnabled: source.portraitGenerationEnabled !== false,
        portraitThemePreset: PORTRAIT_THEME_PRESETS[source.portraitThemePreset] ? source.portraitThemePreset : 'custom',
        portraitStylePositive: String(source.portraitStylePositive ?? DEFAULT_PORTRAIT_STYLE_POSITIVE).slice(0, 2400),
        portraitStyleNegative: String(source.portraitStyleNegative ?? DEFAULT_PORTRAIT_STYLE_NEGATIVE).slice(0, 2400),
        portraitComposition: String(source.portraitComposition ?? DEFAULT_PORTRAIT_COMPOSITION).slice(0, 1200),
        portraitPromptFormat: normalizePortraitPromptFormat(source.portraitPromptFormat),
        portraitUseMood: source.portraitUseMood !== false,
        portraitUseLocation: source.portraitUseLocation === true,
        portraitSaveToGallery: source.portraitSaveToGallery === true,
    };
}

function normalizePortraitSettingsDraft(raw = {}) {
    const current = portraitSettingsSnapshot(getSettings());
    const key = PORTRAIT_THEME_PRESETS[raw.portraitThemePreset] ? raw.portraitThemePreset : (raw.portraitThemePreset === 'custom' ? 'custom' : current.portraitThemePreset);
    const preset = PORTRAIT_THEME_PRESETS[key];
    const next = {
        portraitGenerationEnabled: raw.portraitGenerationEnabled !== undefined ? Boolean(raw.portraitGenerationEnabled) : current.portraitGenerationEnabled,
        portraitThemePreset: key,
        portraitStylePositive: String(raw.portraitStylePositive ?? current.portraitStylePositive).slice(0, 2400),
        portraitStyleNegative: String(raw.portraitStyleNegative ?? current.portraitStyleNegative).slice(0, 2400),
        portraitComposition: String(raw.portraitComposition ?? current.portraitComposition).slice(0, 1200),
        portraitPromptFormat: normalizePortraitPromptFormat(raw.portraitPromptFormat ?? current.portraitPromptFormat),
        portraitUseMood: raw.portraitUseMood !== undefined ? Boolean(raw.portraitUseMood) : current.portraitUseMood,
        portraitUseLocation: raw.portraitUseLocation !== undefined ? Boolean(raw.portraitUseLocation) : current.portraitUseLocation,
        portraitSaveToGallery: raw.portraitSaveToGallery !== undefined ? Boolean(raw.portraitSaveToGallery) : current.portraitSaveToGallery,
    };
    if (key !== 'custom' && preset) {
        next.portraitStylePositive = preset.positive;
        next.portraitStyleNegative = preset.negative;
    }
    return next;
}

function portraitSettingsDraftFromUi() {
    return normalizePortraitSettingsDraft({
        portraitGenerationEnabled: $('#npc_state_portrait_generation_enabled').prop('checked'),
        portraitThemePreset: String($('#npc_state_portrait_theme_preset').val() || 'custom'),
        portraitStylePositive: String($('#npc_state_portrait_style_positive').val() || ''),
        portraitStyleNegative: String($('#npc_state_portrait_style_negative').val() || ''),
        portraitComposition: String($('#npc_state_portrait_composition').val() || ''),
        portraitPromptFormat: String($('#npc_state_portrait_prompt_format').val() || 'hybrid'),
        portraitUseMood: $('#npc_state_portrait_use_mood').prop('checked'),
        portraitUseLocation: $('#npc_state_portrait_use_location').prop('checked'),
        portraitSaveToGallery: $('#npc_state_portrait_save_gallery').prop('checked'),
    });
}

function writePortraitSettingsDraftToUi(draft) {
    const next = normalizePortraitSettingsDraft(draft);
    $('#npc_state_portrait_generation_enabled').prop('checked', next.portraitGenerationEnabled);
    $('#npc_state_portrait_theme_preset').val(next.portraitThemePreset);
    $('#npc_state_portrait_style_positive').val(next.portraitStylePositive);
    $('#npc_state_portrait_style_negative').val(next.portraitStyleNegative);
    $('#npc_state_portrait_composition').val(next.portraitComposition);
    $('#npc_state_portrait_prompt_format').val(next.portraitPromptFormat);
    $('#npc_state_portrait_use_mood').prop('checked', next.portraitUseMood);
    $('#npc_state_portrait_use_location').prop('checked', next.portraitUseLocation);
    $('#npc_state_portrait_save_gallery').prop('checked', next.portraitSaveToGallery);
    return next;
}

function updatePortraitSettingsSaveUi() {
    const button = $('#npc_state_save_portrait_settings');
    const status = $('#npc_state_portrait_settings_status');
    button.toggleClass?.('npc-state-busy', portraitSettingsSaveBusy);
    button.prop?.('disabled', portraitSettingsSaveBusy);
    if (portraitSettingsSaveBusy) status.text?.('Saving…');
    else if (portraitSettingsDirty) status.text?.('Unsaved changes');
    else status.text?.('Saved');
}

function markPortraitSettingsDirty() {
    portraitSettingsDirty = true;
    updatePortraitSettingsSaveUi();
}

async function savePortraitSettingsDraft(explicitDraft = null) {
    if (portraitSettingsSaveBusy) return false;
    const settings = getSettings();
    const before = portraitSettingsSnapshot(settings);
    const next = normalizePortraitSettingsDraft(explicitDraft || portraitSettingsDraftFromUi());
    Object.assign(settings, next);
    portraitSettingsSaveBusy = true;
    updatePortraitSettingsSaveUi();
    try {
        await saveHostSettings();
        portraitSettingsDirty = false;
        portraitSettingsSaveBusy = false;
        syncSettingsControls();
        refreshNpcViewer();
        globalThis.toastr?.success?.('NPC State: portrait settings saved.');
        return true;
    } catch (error) {
        Object.assign(settings, before);
        portraitSettingsSaveBusy = false;
        portraitSettingsDirty = true;
        updatePortraitSettingsSaveUi();
        console.error('[NPC State] portrait settings save failed', error);
        globalThis.toastr?.error?.(`NPC State portrait settings were not saved: ${error?.message || error}`);
        return false;
    }
}
'''
index = replace_once(index,
    '\nfunction bindSettingsCheckbox(selector, key, after = null) {',
    portrait_helpers + '\nfunction bindSettingsCheckbox(selector, key, after = null) {',
    'portrait draft helpers')

portrait_bind_pattern = r'''    bindSettingsCheckbox\('#npc_state_portrait_generation_enabled', 'portraitGenerationEnabled', refreshNpcViewer\);.*?    \$\(document\)\.on\('click\.npcState', '#npc_state_reset_portrait_theme', \(\) => \{.*?\n    \}\);\n    bindSettingsNumber\('#npc_state_scan_every' '''
portrait_bind_replacement = r'''    $(document).on('change.npcState', '#npc_state_portrait_theme_preset', function () {
        const key = PORTRAIT_THEME_PRESETS[this.value] ? this.value : 'custom';
        const preset = PORTRAIT_THEME_PRESETS[key];
        if (key !== 'custom' && preset) {
            $('#npc_state_portrait_style_positive').val(preset.positive);
            $('#npc_state_portrait_style_negative').val(preset.negative);
        }
        markPortraitSettingsDirty();
    });
    $(document).on('input.npcState', '#npc_state_portrait_style_positive, #npc_state_portrait_style_negative, #npc_state_portrait_composition', function () {
        if (this.id === 'npc_state_portrait_style_positive' || this.id === 'npc_state_portrait_style_negative') {
            $('#npc_state_portrait_theme_preset').val('custom');
        }
        markPortraitSettingsDirty();
    });
    $(document).on('change.npcState', '#npc_state_portrait_generation_enabled, #npc_state_portrait_prompt_format, #npc_state_portrait_use_mood, #npc_state_portrait_use_location, #npc_state_portrait_save_gallery', () => {
        markPortraitSettingsDirty();
    });
    $(document).on('click.npcState', '#npc_state_reset_portrait_theme', () => {
        writePortraitSettingsDraftToUi({
            portraitGenerationEnabled: true,
            portraitThemePreset: 'fantasy_anime',
            portraitStylePositive: DEFAULT_PORTRAIT_STYLE_POSITIVE,
            portraitStyleNegative: DEFAULT_PORTRAIT_STYLE_NEGATIVE,
            portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
            portraitPromptFormat: 'hybrid',
            portraitUseMood: true,
            portraitUseLocation: false,
            portraitSaveToGallery: false,
        });
        markPortraitSettingsDirty();
        globalThis.toastr?.info?.('NPC State: Fantasy Anime defaults loaded as an unsaved portrait-settings draft.');
    });
    $(document).on('click.npcState', '#npc_state_save_portrait_settings', () => { void savePortraitSettingsDraft(); });
    bindSettingsNumber('#npc_state_scan_every' '''
index = regex_once(index, portrait_bind_pattern, portrait_bind_replacement, 'portrait UI binding transaction')

index = replace_once(index,
'''    openPortraitGenerator: value => { const npc = findNpcByIdOrName(value); return npc ? openPortraitGenerator(npc.id) : false; },
    render: renderDossier,''',
'''    openPortraitGenerator: value => { const npc = findNpcByIdOrName(value); return npc ? openPortraitGenerator(npc.id) : false; },
    portraitSettings: () => portraitSettingsSnapshot(getSettings()),
    portraitSettingsDirty: () => portraitSettingsDirty,
    savePortraitSettings: draft => savePortraitSettingsDraft(draft),
    render: renderDossier,''',
    'portrait debug/test surface')

write('index.js', index)

core = read('core.js')
core = replace_once(core, "export const NPC_STATE_VERSION = '0.2.22';", "export const NPC_STATE_VERSION = '0.2.23';", 'core public version')
write('core.js', core)

manifest = json.loads(read('manifest.json'))
manifest['version'] = '0.2.23'
write('manifest.json', json.dumps(manifest, indent=4) + '\n')

readme = read('README.md')
readme = replace_once(readme, '# NPC State v0.2.22', '# NPC State v0.2.23', 'README heading')
write('README.md', readme)

changelog = read('CHANGELOG.md')
entry = '''# Changelog\n\n## v0.2.23 — Cast reconciliation and portrait-settings persistence\n\n- When automatic scanning creates or promotes an NPC, every active dossier is considered for a deep recent-history reconciliation sweep; evidence-free dossiers become cheap no-ops while relevant dossiers receive the existing targeted five-memory/profile backfill.\n- Current-exchange relationship targeting no longer depends on the broad scanner returning that NPC. An existing NPC who acts early in a response is still evaluated even when the response later moves to another location/cast.\n- Existing relationship targets are processed in bounded batches of four until every relevant target is covered instead of truncating at four total.\n- Existing NPCs explicitly mentioned in the current exchange but omitted by the broad scanner receive a silent targeted continuity repair so memories and durable dossier changes are not lost.\n- One failed queued backfill no longer starves the rest of a cast sweep; each queued dossier gets one bounded attempt per processing cycle.\n- Portrait generation settings now use an explicit Save Portrait Settings transaction. Draft edits and Reset remain unsaved until Save succeeds, and Save uses SillyTavern's immediate host settings persistence rather than a debounce-only write.\n- Added regression coverage for scene-transition relationship targeting, cast-wide new-NPC reconciliation, important-memory recovery, and portrait-settings host persistence.\n\n'''
if not changelog.startswith('# Changelog\n'):
    raise SystemExit('CHANGELOG heading mismatch')
changelog = entry + changelog[len('# Changelog\n\n'):]
write('CHANGELOG.md', changelog)

package = read('tests/package.test.js')
package = replace_once(package, "assert.equal(manifest.version, '0.2.22');", "assert.equal(manifest.version, '0.2.23');", 'package version test')
write('tests/package.test.js', package)

runtime = read('tests/runtime-smoke.mjs')
runtime = replace_once(runtime,
    "    hostChatsByAvatar: new Map(),\n};",
    "    hostChatsByAvatar: new Map(),\n    saveSettingsCalls: 0,\n};",
    'runtime settings save counter')
runtime = replace_once(runtime,
    'export async function saveSettings() {}',
    'export async function saveSettings() { globalThis.__npcMock.saveSettingsCalls += 1; }',
    'runtime host save mock')
runtime = replace_once(runtime,
    "assert.equal(globalThis.NPCState?.version, '0.2.22');",
    "assert.equal(globalThis.NPCState?.version, '0.2.23');",
    'runtime version assertion')

portrait_runtime_anchor = '''    assert.equal(globalThis.NPCState.uiStatus().viewerOpen, false, 'focused viewer should close without affecting the chat state');\n\n'''
portrait_runtime_extra = '''    // v0.2.23: portrait settings are an explicit transaction. A custom draft must not rely on\n    // saveSettingsDebounced; Save calls the host persistence API and retains every parameter.\n    const originalPortraitSettings = globalThis.NPCState.portraitSettings();\n    const hostSavesBeforePortrait = mockState.saveSettingsCalls;\n    assert.equal(await globalThis.NPCState.savePortraitSettings({\n        portraitGenerationEnabled: true,\n        portraitThemePreset: 'custom',\n        portraitStylePositive: 'custom violet key visual, luminous eyes',\n        portraitStyleNegative: 'watermark, text, malformed hands',\n        portraitComposition: 'solo waist-up portrait, centered',\n        portraitPromptFormat: 'tags',\n        portraitUseMood: false,\n        portraitUseLocation: true,\n        portraitSaveToGallery: true,\n    }), true);\n    assert.equal(mockState.saveSettingsCalls, hostSavesBeforePortrait + 1, 'portrait Save must call the immediate host settings persistence API exactly once');\n    const savedPortraitSettings = globalThis.NPCState.portraitSettings();\n    assert.equal(savedPortraitSettings.portraitThemePreset, 'custom');\n    assert.match(savedPortraitSettings.portraitStylePositive, /custom violet key visual/);\n    assert.match(savedPortraitSettings.portraitStyleNegative, /malformed hands/);\n    assert.equal(savedPortraitSettings.portraitComposition, 'solo waist-up portrait, centered');\n    assert.equal(savedPortraitSettings.portraitPromptFormat, 'tags');\n    assert.equal(savedPortraitSettings.portraitUseMood, false);\n    assert.equal(savedPortraitSettings.portraitUseLocation, true);\n    assert.equal(savedPortraitSettings.portraitSaveToGallery, true);\n    assert.deepEqual(mockState.extensionSettings.npc_state.portraitStylePositive, savedPortraitSettings.portraitStylePositive);\n    await globalThis.NPCState.savePortraitSettings(originalPortraitSettings);\n\n'''
runtime = replace_once(runtime, portrait_runtime_anchor, portrait_runtime_anchor + portrait_runtime_extra, 'runtime portrait save regression')

cast_runtime_anchor = '''    mockState.extensionSettings.npc_state.relationshipBaseline = savedMiraBaseline;\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = savedMiraFullScan;\n\n'''
cast_runtime_extra = '''    // v0.2.23: an NPC involved at the beginning of a response must still reconcile when the\n    // broad full-window scan returns only a newcomer from the ending scene. Relationship uses\n    // the complete current exchange; the omitted existing NPC also gets a targeted memory repair.\n    const savedCastFullScan = mockState.extensionSettings.npc_state.fullScanEveryTurn;\n    const savedCastDepth = mockState.extensionSettings.npc_state.scanDepth;\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = true;\n    mockState.extensionSettings.npc_state.scanDepth = 2;\n    const yunyunBeforeCast = structuredClone(globalThis.NPCState.getState().npcs.find(n => n.name === 'Yunyun'));\n    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'I help Yunyun gather her scattered spell notes, then head across town to the apothecary.' });\n    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Megumin', swipe_id: 0, mes: 'Yunyun accepts the recovered notes with visible relief and thanks Kazuma for taking the time to help. Later, at the apothecary, a new clerk named Neri introduces herself and points out the herb shelves.' });\n    const castSweepMessageId = mockState.context.chat.length - 1;\n    let castBroadCalls = 0;\n    let castRelationshipCalls = 0;\n    let yunyunContinuityCalls = 0;\n    let neriBackfillCalls = 0;\n    mockState.quietResponder = async (args = {}) => {\n        const prompt = String(args.prompt || '');\n        if (/private NPC dossier scanner/i.test(prompt) && /Neri/i.test(prompt)) {\n            castBroadCalls += 1;\n            // Deliberately omit Yunyun to reproduce the old failure mode.\n            return JSON.stringify({ npcs: [{\n                name: 'Neri', identityKind: 'proper_name', dossierSignal: 'meaningful', role: 'Apothecary clerk', present: true,\n                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },\n            }] });\n        }\n        if (/focused relationship evaluator/i.test(prompt)) {\n            castRelationshipCalls += 1;\n            const live = globalThis.NPCState.getState();\n            const rows = [];\n            for (const npc of live.npcs) {\n                if (!prompt.includes(npc.name)) continue;\n                const isYunyun = npc.name === 'Yunyun';\n                rows.push({\n                    id: npc.id, name: npc.name, relationshipImpact: isYunyun ? 'ordinary' : 'none',\n                    relationshipDelta: { trust: isYunyun ? 1 : 0, affection: 0, desire: 0, tension: 0 },\n                    relationshipEvidence: { trust: isYunyun ? 'Kazuma helped Yunyun gather her scattered spell notes.' : '', affection: '', desire: '', tension: '' },\n                    relationshipChangeReason: isYunyun ? 'Kazuma helped Yunyun gather her scattered spell notes.' : '',\n                    relationshipSummary: isYunyun ? 'Yunyun has another small reason to rely on Kazuma.' : '',\n                });\n            }\n            return JSON.stringify({ npcs: rows });\n        }\n        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Yunyun/i.test(prompt)) {\n            yunyunContinuityCalls += 1;\n            const id = globalThis.NPCState.getState().npcs.find(n => n.name === 'Yunyun')?.id;\n            return JSON.stringify({ npcs: [{\n                id, name: 'Yunyun', memories: ['Kazuma helped recover her scattered spell notes before leaving for the apothecary.'],\n                memoryRetention: ['Kazuma helped recover her scattered spell notes before leaving for the apothecary.'],\n                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },\n            }] });\n        }\n        if (/targeted dossier backfill extractor/i.test(prompt) && /Requested NPC: Neri/i.test(prompt)) {\n            neriBackfillCalls += 1;\n            const id = globalThis.NPCState.getState().npcs.find(n => n.name === 'Neri')?.id;\n            return JSON.stringify({ npcs: [{\n                id, name: 'Neri', role: 'Apothecary clerk', personality: 'Attentive and practical.', speech: 'Short professional explanations.',\n                memories: ['First met Kazuma while showing him the apothecary herb shelves.'],\n                memoryRetention: ['First met Kazuma while showing him the apothecary herb shelves.'],\n                relationshipImpact: 'none', relationshipDelta: { trust: 0, affection: 0, desire: 0, tension: 0 },\n            }] });\n        }\n        return '{"npcs":[]}';\n    };\n    eventSource.emit('message_received', castSweepMessageId);\n    await sleep(520);\n    state = globalThis.NPCState.getState();\n    const yunyunAfterCast = state.npcs.find(n => n.name === 'Yunyun');\n    const neri = state.npcs.find(n => n.name === 'Neri');\n    assert.ok(neri, 'new ending-scene NPC should be admitted');\n    assert.equal(castBroadCalls, 1, 'one full-window broad scan should discover the newcomer');\n    assert.ok(castRelationshipCalls >= 1, 'current-exchange relationship reconciliation should run even though the broad scanner omitted Yunyun');\n    assert.equal(yunyunAfterCast.relationship.trust, yunyunBeforeCast.relationship.trust + 1, 'Yunyun should gain the current-exchange trust point despite appearing before the scene transition');\n    assert.ok(yunyunAfterCast.memories.some(item => /scattered spell notes/i.test(item)), 'omitted current participant should receive targeted important-memory repair');\n    assert.equal(yunyunContinuityCalls, 1, 'cast sweep/participant repair should reconcile Yunyun exactly once');\n    assert.equal(neriBackfillCalls, 1, 'new NPC should receive one targeted deep reconciliation');\n    assert.equal(state.pendingBackfills.length, 0, 'successful cast sweep should drain its queue');\n    mockState.extensionSettings.npc_state.fullScanEveryTurn = savedCastFullScan;\n    mockState.extensionSettings.npc_state.scanDepth = savedCastDepth;\n\n'''
runtime = replace_once(runtime, cast_runtime_anchor, cast_runtime_anchor + cast_runtime_extra, 'runtime cast sweep regression')
write('tests/runtime-smoke.mjs', runtime)

hardening = '''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('v0.2.23 relationship repair targets current-exchange NPCs even when broad scan omits them', () => {
    assert.match(source, /currentExchangeRelationshipRelevant/);
    assert.match(source, /transcriptMentionsNpcRecord\(transcript, npc\)/);
    assert.match(source, /return !raw \|\| !hasCompletePrimaryRelationshipDecision\(raw, transcript\)/);
    assert.match(source, /for \(let offset = 0; offset < targets\.length; offset \+= 4\)/);
    assert.doesNotMatch(source, /\.slice\(0, 4\);\n\s*if \(!targets\.length\)/);
});

test('v0.2.23 new NPC admission queues a deep active-cast reconciliation and omitted participants get continuity repair', () => {
    assert.match(source, /deepSweep: true/);
    assert.match(source, /state\.pendingBackfills\.length > 100/);
    assert.match(source, /touchedIds = new Set/);
    assert.match(source, /!transcriptMentionsNpcRecord\(currentTranscript \|\| '', npc\)/);
    assert.match(source, /One failed dossier must not starve the rest of a cast reconciliation sweep/);
});

test('v0.2.23 portrait settings use explicit transactional Save', () => {
    assert.match(source, /id="npc_state_save_portrait_settings"/);
    assert.match(source, /async function savePortraitSettingsDraft/);
    assert.match(source, /await saveHostSettings\(\)/);
    assert.match(source, /Object\.assign\(settings, before\)/);
    assert.match(source, /Unsaved changes/);
    assert.match(source, /Fantasy Anime defaults loaded as an unsaved portrait-settings draft/);
});
'''
write('tests/hardening-v0223.test.js', hardening)

print('v0.2.23 patch applied')
