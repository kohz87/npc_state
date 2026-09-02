import {
    reconcileSocialState,
    remapSocialGraphNpcId,
    canonicalizeNpcKeyRelationships,
    socialGraphLabelsForNpc,
} from './social.js';

export const NPC_STATE_VERSION = '0.2.18';

export const NPC_LIFE_STATES = Object.freeze(['unknown', 'alive', 'deceased']);
export const NPC_ARCHIVE_REASONS = Object.freeze(['', 'manual', 'deceased', 'stale']);
export const NPC_ADMISSION_MODES = Object.freeze(['conservative', 'balanced', 'manual_only']);
export const IMPORTANT_MEMORY_LIMIT = 5;
export const KEY_RELATIONSHIP_LIMIT = 5;
export const PROFILE_EVIDENCE_LIMIT = 4;
export const BEHAVIOR_PROFILE_LIMIT = 6;
export const DURABLE_PROFILE_LIMITS = Object.freeze({
    personality: 320,
    speech: 280,
    appearance: 800,
    background: 420,
    relationshipSummary: 320,
    mannerism: 160,
    behaviorProfile: 180,
    keyRelationship: 220,
    memory: 220,
    evidence: 160,
});

export const DEFAULT_PORTRAIT_STYLE_POSITIVE = 'fantasy anime character illustration, refined clean linework, soft cel shading, detailed expressive eyes, elegant character design, cinematic soft lighting';
export const DEFAULT_PORTRAIT_STYLE_NEGATIVE = 'low quality, blurry, pixelated, bad anatomy, malformed hands, extra limbs, duplicate character, multiple heads, cropped face, obscured eyes, text, watermark, logo, photorealistic, 3d render';
export const DEFAULT_PORTRAIT_COMPOSITION = 'solo character portrait, upper body, centered composition, face clearly visible, portrait orientation';
export const PORTRAIT_PROMPT_FORMATS = Object.freeze(['hybrid', 'tags', 'natural']);

export function normalizePortraitPromptFormat(value) {
    const mode = String(value ?? '').trim().toLowerCase();
    return PORTRAIT_PROMPT_FORMATS.includes(mode) ? mode : 'hybrid';
}

export function normalizeNpcAdmissionMode(value) {
    const mode = String(value ?? '').trim().toLowerCase();
    return NPC_ADMISSION_MODES.includes(mode) ? mode : 'conservative';
}

export const DEFAULT_RELATIONSHIP = Object.freeze({
    trust: 0,
    affection: 0,
    desire: 0,
    tension: 0,
});

export const RELATIONSHIP_KEYS = Object.freeze(['trust', 'affection', 'desire', 'tension']);
export const RELATIONSHIP_IMPACT_LEVELS = Object.freeze(['none', 'ordinary', 'meaningful', 'major', 'extreme']);
export const DEFAULT_RELATIONSHIP_CAPS = Object.freeze({
    ordinary: 1,
    meaningful: 2,
    major: 5,
    extreme: 10,
});
export const RELATIONSHIP_EVENT_HISTORY_LIMIT = 6;
export const DEFAULT_RELATIONSHIP_PROGRESS = Object.freeze({
    trust: 0,
    affection: 0,
    desire: 0,
    tension: 0,
});
export const RELATIONSHIP_MILESTONE_THRESHOLDS = Object.freeze([25, 50, 75, 90]);
export const RELATIONSHIP_MILESTONE_REQUIREMENTS = Object.freeze({
    25: 'meaningful',
    50: 'major',
    75: 'extreme',
    90: 'extreme',
});
export const RELATIONSHIP_MILESTONE_MIN_RAW = Object.freeze({
    25: 1,
    50: 3,
    75: 5,
    90: 8,
});
export const RELATIONSHIP_MILESTONE_LIMIT = RELATIONSHIP_KEYS.length * 2 * RELATIONSHIP_MILESTONE_THRESHOLDS.length;
export const DEFAULT_RELATIONSHIP_CRITERIA = `All relationship stats use a bipolar -100 to +100 scale with 0 as neutral. Positive and negative values are durable relationship states, not percentages or per-turn rewards. Routine continuation of an established dynamic normally causes NO numeric movement; score only genuinely new evidence.
Trust: confidence, reliance, safety, and willingness to be vulnerable. Increase for newly demonstrated dependability, kept promises, costly protection, honest support, entrusted vulnerability, or comparable trust evidence. Decrease for betrayal, deception, abandonment, unreliability, violated confidence, or comparable distrust evidence. Trust is not obedience.
Affection: fondness, attachment, warmth, and personal care. Increase for newly meaningful kindness, companionship, shared vulnerability, comfort, bonding, or comparable emotional attachment. Decrease for supported dislike, resentment, cruelty, rejection, humiliation, neglect, or emotional injury. Affection is not devotion, clinginess, jealousy, or self-erasure.
Desire: attraction or pull toward romantic/intimate/physical closeness. Positive Desire REQUIRES explicit attraction/romantic/intimate/physical evidence in the current exchange. Friendliness, gratitude, admiration, rescue, affection, proximity, repeated contact, or trust alone are never Desire evidence. Negative Desire means explicit aversion to that kind of closeness, not mere absence of attraction.
Tension: unresolved interpersonal pressure, conflict, fear, suspicion, awkward pressure, rivalry, resentment, or exceptional ease/release when negative. Change only when the current exchange actually changes that pressure.
RELATIONSHIP WEIGHT: the farther an established score is from 0, the harder it becomes to deepen further. New evidence accumulates fractionally behind the integer display. Near-extreme scores therefore require repeated fresh evidence even when each event is valid. Minor contrary evidence also meets some established-relationship resistance; major/extreme betrayal, reconciliation, or comparable turning points can overcome more of it.
Most ordinary events affect zero or one axis. Meaningful events may affect two axes only with separate evidence. Major events may affect up to three; four axes are reserved for extreme events with distinct support for every moved axis. Every non-zero axis must carry its own grounded evidence.`;
export const DEFAULT_IMPACT_CRITERIA = `none: no NEW relationship-relevant evidence, insufficient evidence, routine continuation, or aftermath of an already-scored event; all deltas must be 0.
ordinary: a new modest relationship-relevant beat. Maximum raw weight 1 on one axis. Routine conversation, expected companionship, ordinary joking/care, normal transactions, or repeated consequences are usually none.
meaningful: clearly new evidence with noticeable emotional weight. Maximum raw weight 2 per supported axis, at most two axes.
major: an important turning point with lasting consequences such as serious betrayal, costly rescue, explicit romantic advance/rejection, major reconciliation, or deep personal revelation. Maximum raw weight 5 per supported axis, at most three axes.
extreme: a rare relationship-defining event such as catastrophic betrayal, self-sacrifice, irreversible loss, or explicit decisive commitment. Maximum raw weight 10 per supported axis. Extreme is still raw evidence before score resistance, so a near-extreme relationship does not automatically jump ten visible points.`;
export const DEFAULT_MEMORY_CRITERIA = `Store only durable, story-relevant events the NPC would reasonably recall in a later scene and that could affect future decisions, attitude, relationship, goals, obligations, fears, knowledge, or circumstances. Prefer concrete events such as promises, betrayals, rescues, confessions, consequential discoveries, major conflicts, meaningful gifts or favors, losses, or commitments. Do not store routine dialogue, ordinary transactions, repeated summaries of existing dossier facts, transient emotions, moment-to-moment NPC Inner Chatter, or trivial scene details. A memory should say what happened and why it matters in one short grounded sentence. Avoid duplicates or near-duplicates of memories already stored for that NPC.`;
export const DEFAULT_BEHAVIOR_CRITERIA = `IDENTITY DOMINANCE: First determine behavior from personality, values, morality, speech, mannerisms, goals, duties, current mood/status, independence, and other bonds. Only then let the player relationship make a secondary adjustment. Relationship scores are a tint on established behavior, never the character's main personality.
RELATIONSHIP SCOPE: Scores modify how the NPC weighs and responds to the player only; they do not replace the person, make the player a universal priority, reduce kindness/empathy toward others, or need to surface in every scene.
Trust: confidence, safety, reliance, and willingness to expose vulnerability. Trust can permit candor or reliance when context calls for it; it is not obedience.
Affection: emotional importance, fondness, attachment, and care. Affection may bias attention, patience, interpretation, or willingness to accept some inconvenience through the NPC's established care style. It is not devotion, clinginess, jealousy, softness, or self-erasure.
Desire: attraction or pull toward romantic/intimate/physical closeness when established. Desire does not prescribe flirting, blushing, stammering, possessiveness, sexual behavior, or constant romantic attention; expression passes through personality, expressiveness, consent, and context.
Tension: unresolved interpersonal pressure. It may be conflict, awkwardness, fear, rivalry, uncertainty, resentment, or charged restraint only when context supports that form. Never infer jealousy, embarrassment, hostility, or tsundere-style denial from tension alone.
Strong feelings should usually alter small choices, interpretation, openness, attention, or willingness before altering voice or overt behavior. A duty-bound, reserved, kind, blunt, proud, or independent NPC remains recognizably so at every relationship score. Runtime narration receives only a compact qualitative relationship lens; raw meter numbers are bookkeeping, not characterization instructions.`;

const LEGACY_V028_RELATIONSHIP_CAPS = Object.freeze({ ordinary: 4, meaningful: 8, major: 15, extreme: 25 });
const LEGACY_V028_RELATIONSHIP_CRITERIA = `All relationship stats use a bipolar -100 to +100 scale with 0 as neutral. Positive and negative values are meaningful states, not percentages. Do not move a stat away from 0 without story evidence, and do not treat the mere absence of a positive feeling as a negative feeling.
Trust: 0 is neutral/undetermined. Positive values mean growing confidence, reliance, safety, and willingness to be vulnerable with the player. Negative values mean active distrust, suspicion, guardedness, or expectation of harm/deception. Increase for dependable help, kept promises, protection, honest support, or entrusted vulnerability. Decrease below 0 only when the story supports distrust, betrayal, deception, abandonment, unreliability, or violated confidence.
Affection: 0 is emotionally neutral. Positive values mean fondness, attachment, warmth, and personal care. Negative values mean active dislike, resentment, hostility, or emotional aversion. Increase for meaningful kindness, companionship, shared vulnerability, comfort, or bonding. Decrease below 0 only for supported dislike/resentment such as cruelty, rejection, humiliation, neglect, or emotional injury.
Desire: 0 means no established attraction or desire. Positive values mean wanting the player's closeness, attention, intimacy, romance, or physical/sexual contact when the story supports it. Negative values mean active aversion to that kind of closeness or attraction, not merely lack of interest. Do not infer positive desire from friendliness, gratitude, admiration, or affection alone, and do not infer negative desire merely because attraction is absent.
Tension: 0 is neutral/settled. Positive values mean interpersonal strain, conflict, fear, suspicion, awkward pressure, rivalry, resentment, or unresolved charged friction. Negative values mean unusually strong ease, safety, comfort, or release of interpersonal pressure. Increase for arguments, threats, distrust, jealousy, embarrassment under pressure, hostility, or unresolved conflict. Decrease below 0 only when the story specifically establishes exceptional ease, reassurance, reconciliation, safety, or relaxed comfort.`;
const LEGACY_V028_IMPACT_CRITERIA = `none: no relationship-relevant event or insufficient evidence; all deltas must be 0.
ordinary: routine interaction or small emotional beat; subtle movement only.
meaningful: clearly relationship-relevant event with noticeable emotional weight, such as meaningful help, a sincere confession, a real argument, or a personal boundary being respected/violated.
major: important turning point with lasting relationship consequences, such as serious betrayal, rescue at substantial cost, explicit romantic advance/rejection, major reconciliation, or a deeply personal revelation.
extreme: rare life-changing or relationship-defining event. Reserve for extraordinary cases such as catastrophic betrayal, self-sacrifice, irreversible loss, or an explicit decisive commitment. Do not use extreme merely because a scene is dramatic.`;
const LEGACY_V028_BEHAVIOR_CRITERIA = `RELATIONSHIP SCOPE: Identity, values, morality, ordinary regard for other people, speech, mannerisms, goals, duties, and boundaries remain authoritative. Relationship scores modify how the NPC weighs and responds to the player; they do not replace the person, make the player a universal priority, or reduce kindness/empathy toward everyone else.
Trust: measures confidence, safety, reliance, and willingness to expose vulnerability. Positive trust may permit candor or reliance; negative trust supports suspicion and guardedness. Trust is not obedience.
Affection: measures emotional importance, fondness, attachment, and care. Positive affection may increase attention, patience, concern, voluntary companionship, or willingness to accept some inconvenience through the NPC's established care style. Affection is not devotion, clinginess, jealousy, softness, or self-erasure.
Desire: measures attraction or pull toward romantic/intimate/physical closeness when established. It does not prescribe flirting, blushing, stammering, possessiveness, or sexual behavior; expression must pass through personality, expressiveness, consent, and context.
Tension: measures unresolved interpersonal pressure. Positive tension may be conflict, awkwardness, fear, rivalry, uncertainty, resentment, or charged restraint only when context supports that form. Never infer jealousy, embarrassment, hostility, or tsundere-style denial from tension alone.
Interpret combinations rather than each stat in isolation. Strong feelings should usually change attention, openness, willingness, interpretation, and small choices before they change voice or identity. Relationship-specific behavior stays relationship-specific unless narration independently establishes a broader lasting character change.`;

export function isLegacyStockRelationshipCapsV028(value) {
    const caps = normalizeRelationshipCaps(value || {});
    return Object.keys(LEGACY_V028_RELATIONSHIP_CAPS).every(key => caps[key] === LEGACY_V028_RELATIONSHIP_CAPS[key]);
}

export function isLegacyStockRelationshipCriteriaV028(value) {
    return String(value ?? '').trim() === String(LEGACY_V028_RELATIONSHIP_CRITERIA).trim();
}

export function isLegacyStockImpactCriteriaV028(value) {
    return String(value ?? '').trim() === String(LEGACY_V028_IMPACT_CRITERIA).trim();
}

export function isLegacyStockBehaviorCriteriaV028(value) {
    return String(value ?? '').trim() === String(LEGACY_V028_BEHAVIOR_CRITERIA).trim();
}

const LEGACY_V029_RELATIONSHIP_CAPS = Object.freeze({ ordinary: 1, meaningful: 3, major: 8, extreme: 20 });
const LEGACY_V029_RELATIONSHIP_CRITERIA = `All relationship stats use a bipolar -100 to +100 scale with 0 as neutral. Positive and negative values are durable relationship states, not percentages or per-turn rewards. Routine continuation of an already-established dynamic normally causes NO numeric movement; change scores only when the current exchange adds genuinely new relationship evidence.
Trust: 0 is neutral/undetermined. Positive values mean growing confidence, reliance, safety, and willingness to be vulnerable with the player. Negative values mean active distrust, suspicion, guardedness, or expectation of harm/deception. Increase for newly demonstrated dependability, kept promises, costly protection, honest support, or entrusted vulnerability. Decrease below 0 only for supported distrust, betrayal, deception, abandonment, unreliability, or violated confidence. Repeating expected help does not automatically keep raising Trust.
Affection: 0 is emotionally neutral. Positive values mean fondness, attachment, warmth, and personal care. Negative values mean active dislike, resentment, hostility, or emotional aversion. Increase for newly meaningful kindness, companionship, shared vulnerability, comfort, or bonding. Decrease below 0 only for supported dislike/resentment such as cruelty, rejection, humiliation, neglect, or emotional injury. Familiar warmth that merely continues the existing bond is usually no change.
Desire: 0 means no established attraction or desire. Positive values mean wanting the player's closeness, attention, intimacy, romance, or physical/sexual contact when the story supports it. Negative values mean active aversion to that kind of closeness or attraction, not merely lack of interest. Do not infer positive desire from friendliness, gratitude, admiration, affection, proximity, or repeated contact alone; do not infer negative desire merely because attraction is absent.
Tension: 0 is neutral/settled. Positive values mean interpersonal strain, conflict, fear, suspicion, awkward pressure, rivalry, resentment, or unresolved charged friction. Negative values mean unusually strong ease, safety, comfort, or release of interpersonal pressure. Change Tension only when the current exchange actually changes unresolved pressure; simply continuing an already-tense or already-comfortable interaction is normally no change.
Most ordinary events affect zero or one axis. A meaningful event may affect two axes when each has separate evidence. Three or four axes should be rare and reserved for major/extreme events with distinct support for every moved axis.`;
const LEGACY_V029_IMPACT_CRITERIA = `none: no NEW relationship-relevant evidence, insufficient evidence, or routine continuation of an already-established dynamic; all deltas must be 0.
ordinary: a new but modest relationship-relevant beat that changes one aspect of the relationship slightly. Routine conversation, expected companionship, ordinary joking, repeated care, normal transactions, or consequences of an already-scored event are usually none.
meaningful: clearly new relationship evidence with noticeable emotional weight, such as consequential help, a sincere confession, a real argument, or a personal boundary being respected/violated. Usually one axis, sometimes two with separate evidence.
major: important turning point with lasting relationship consequences, such as serious betrayal, rescue at substantial cost, explicit romantic advance/rejection, major reconciliation, or a deeply personal revelation. Multiple axes may move when separately supported.
extreme: rare life-changing or relationship-defining event. Reserve for extraordinary cases such as catastrophic betrayal, self-sacrifice, irreversible loss, or an explicit decisive commitment. Do not use extreme merely because a scene is dramatic.`;
const LEGACY_V029_BEHAVIOR_CRITERIA = `IDENTITY DOMINANCE: First determine behavior from personality, values, morality, speech, mannerisms, goals, duties, current mood/status, independence, and other bonds. Only then let the player relationship make a secondary adjustment. Relationship scores are a tint on established behavior, never the character's main personality.
RELATIONSHIP SCOPE: Scores modify how the NPC weighs and responds to the player only; they do not replace the person, make the player a universal priority, reduce kindness/empathy toward others, or need to surface in every scene.
Trust: confidence, safety, reliance, and willingness to expose vulnerability. Trust can permit candor or reliance when context calls for it; it is not obedience.
Affection: emotional importance, fondness, attachment, and care. Affection may bias attention, patience, interpretation, or willingness to accept some inconvenience through the NPC's established care style. It is not devotion, clinginess, jealousy, softness, or self-erasure.
Desire: attraction or pull toward romantic/intimate/physical closeness when established. Desire does not prescribe flirting, blushing, stammering, possessiveness, sexual behavior, or constant romantic attention; expression passes through personality, expressiveness, consent, and context.
Tension: unresolved interpersonal pressure. It may be conflict, awkwardness, fear, rivalry, uncertainty, resentment, or charged restraint only when context supports that form. Never infer jealousy, embarrassment, hostility, or tsundere-style denial from tension alone.
Strong feelings should usually alter small choices, interpretation, openness, attention, or willingness before altering voice or overt behavior. A duty-bound, reserved, kind, blunt, proud, or independent NPC remains recognizably so at every relationship score.`;

export function isLegacyStockRelationshipCapsV029(value) {
    const caps = normalizeRelationshipCaps(value || {});
    return Object.keys(LEGACY_V029_RELATIONSHIP_CAPS).every(key => caps[key] === LEGACY_V029_RELATIONSHIP_CAPS[key]);
}

export function isLegacyStockRelationshipCriteriaV029(value) {
    return String(value ?? '').trim() === String(LEGACY_V029_RELATIONSHIP_CRITERIA).trim();
}

export function isLegacyStockImpactCriteriaV029(value) {
    return String(value ?? '').trim() === String(LEGACY_V029_IMPACT_CRITERIA).trim();
}

export function isLegacyStockBehaviorCriteriaV029(value) {
    return String(value ?? '').trim() === String(LEGACY_V029_BEHAVIOR_CRITERIA).trim();
}

export function isLegacyStockBehaviorCriteriaV024(value) {
    const text = String(value ?? '').trim();
    return text.length === 1841
        && text.startsWith('Use relationship stats as a bipolar -100 to +100 signal with 0 neutral. Modulate')
        && text.includes('willingness to prioritize the player')
        && text.endsWith('Keep reactions proportional and natural.');
}

export function normalizeLifeState(value) {
    const state = String(value ?? '').trim().toLowerCase();
    return NPC_LIFE_STATES.includes(state) ? state : 'unknown';
}

function normalizeLifeStateCertainty(value) {
    const certainty = String(value ?? '').trim().toLowerCase();
    return ['explicit', 'inferred'].includes(certainty) ? certainty : '';
}

export function setNpcArchived(npc, archived, { reason = 'manual', sourceMessageId = null, lifeState = null } = {}) {
    const next = normalizeNpcRecord(npc || {});
    next.archived = Boolean(archived);
    if (next.archived) {
        next.archiveReason = reason === 'deceased' ? 'deceased' : (reason === 'stale' ? 'stale' : 'manual');
        next.archivedAt = Date.now();
        next.archiveSourceMessageId = Number.isInteger(sourceMessageId) ? sourceMessageId : null;
        next.present = false;
        next.worldActive = false;
        if (next.archiveReason === 'deceased') {
            next.lifeState = 'deceased';
            next.lifeStateCertainty = 'explicit';
        }
    } else {
        const wasDeceased = next.archiveReason === 'deceased' || next.lifeState === 'deceased';
        next.archiveReason = '';
        next.archivedAt = null;
        next.archiveSourceMessageId = null;
        if (lifeState !== null) next.lifeState = normalizeLifeState(lifeState);
        else if (wasDeceased) next.lifeState = 'alive';
        if (next.lifeState === 'alive') next.lifeStateCertainty = 'explicit';
    }
    next.updatedAt = Date.now();
    return next;
}

export function normalizeRelationshipBaseline(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => {
        const number = Number(source[key]);
        const safe = Number.isFinite(number) ? number : DEFAULT_RELATIONSHIP[key];
        return [key, Math.round(clamp(safe, -100, 100))];
    }));
}

export function normalizeRelationshipCaps(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const finiteOr = (raw, fallback) => {
        if (raw === undefined || raw === null || raw === '') return fallback;
        const number = Number(raw);
        return Number.isFinite(number) ? number : fallback;
    };
    const ordinary = Math.round(clamp(finiteOr(source.ordinary, DEFAULT_RELATIONSHIP_CAPS.ordinary), 0, 25));
    const meaningful = Math.max(ordinary, Math.round(clamp(finiteOr(source.meaningful, DEFAULT_RELATIONSHIP_CAPS.meaningful), 0, 35)));
    const major = Math.max(meaningful, Math.round(clamp(finiteOr(source.major, DEFAULT_RELATIONSHIP_CAPS.major), 0, 50)));
    const extreme = Math.max(major, Math.round(clamp(finiteOr(source.extreme, DEFAULT_RELATIONSHIP_CAPS.extreme), 0, 100)));
    return { ordinary, meaningful, major, extreme };
}

function normalizeRelationshipImpact(value, hasDelta = false) {
    const impact = String(value ?? '').trim().toLowerCase();
    if (RELATIONSHIP_IMPACT_LEVELS.includes(impact)) return impact;
    return hasDelta ? 'ordinary' : 'none';
}

function normalizeScannerRelationshipImpact(value, hasDelta = false) {
    const impact = normalizeRelationshipImpact(value, hasDelta);
    // Scanner payloads that pair a concrete non-zero delta with `none` are contradictory.
    // Keep the low-level engine's `none` semantics intact, but recover scanner mistakes
    // to the smallest non-zero tier instead of silently swallowing the delta.
    return hasDelta && impact === 'none' ? 'ordinary' : impact;
}

function normalizeRelationshipDelta(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => {
        const raw = Number(source[key]);
        return [key, Number.isFinite(raw) ? Math.round(clamp(raw, -100, 100)) : 0];
    }));
}

function normalizeRelationshipAbsolutePatch(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const patch = {};
    for (const key of RELATIONSHIP_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const raw = Number(source[key]);
        if (!Number.isFinite(raw)) continue;
        patch[key] = Math.round(clamp(raw, -100, 100));
    }
    return patch;
}

function normalizeRelationshipAuditDelta(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => {
        const raw = Number(source[key]);
        return [key, Number.isFinite(raw) ? Math.round(clamp(raw, -200, 200)) : 0];
    }));
}

export function normalizeRelationshipProgress(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => {
        const raw = Number(source[key]);
        if (!Number.isFinite(raw)) return [key, 0];
        const bounded = Math.max(-0.999999, Math.min(0.999999, raw));
        return [key, Math.abs(bounded) < 0.000001 ? 0 : Number(bounded.toFixed(6))];
    }));
}

function normalizeMilestonePolarity(value) {
    const number = Number(value);
    if (number > 0) return 1;
    if (number < 0) return -1;
    const text = String(value ?? '').trim().toLowerCase();
    if (['positive', 'pos', '+', 'plus'].includes(text)) return 1;
    if (['negative', 'neg', '-', 'minus'].includes(text)) return -1;
    return 0;
}

function relationshipImpactRank(value) {
    return { none: 0, ordinary: 1, meaningful: 2, major: 3, extreme: 4 }[normalizeRelationshipImpact(value, false)] || 0;
}

function relationshipMilestoneRequirement(threshold) {
    return RELATIONSHIP_MILESTONE_REQUIREMENTS[Number(threshold)] || 'extreme';
}

function relationshipMilestoneImpactQualifies(impact, threshold) {
    return relationshipImpactRank(impact) >= relationshipImpactRank(relationshipMilestoneRequirement(threshold));
}

function relationshipMilestoneRawRequirement(threshold, tierCap) {
    const configuredCap = Math.max(0, Number(tierCap) || 0);
    const stockMinimum = Math.max(1, Number(RELATIONSHIP_MILESTONE_MIN_RAW[Number(threshold)]) || 1);
    return configuredCap > 0 ? Math.min(configuredCap, stockMinimum) : stockMinimum;
}

function relationshipMilestoneEventQualifies(impact, threshold, rawWeight, tierCap) {
    return relationshipMilestoneImpactQualifies(impact, threshold)
        && Math.abs(Number(rawWeight) || 0) >= relationshipMilestoneRawRequirement(threshold, tierCap);
}

function milestoneIdentity(entry) {
    return `${entry.axis}:${entry.polarity}:${entry.threshold}`;
}

function inferredMilestoneEntries(relationship = DEFAULT_RELATIONSHIP, { includeBoundary = false, reason = 'Existing relationship depth predates milestone tracking.' } = {}) {
    const rel = normalizeRelationshipBaseline(relationship || DEFAULT_RELATIONSHIP);
    const out = [];
    for (const axis of RELATIONSHIP_KEYS) {
        const score = rel[axis];
        const polarity = Math.sign(score);
        if (!polarity) continue;
        const magnitude = Math.abs(score);
        for (const threshold of RELATIONSHIP_MILESTONE_THRESHOLDS) {
            const established = includeBoundary ? magnitude >= threshold : magnitude > threshold;
            if (!established) continue;
            out.push({
                axis,
                polarity,
                threshold,
                reason,
                sourceMessageId: null,
                turn: null,
                inferred: true,
            });
        }
    }
    return out;
}

export function normalizeRelationshipMilestones(value, relationship = DEFAULT_RELATIONSHIP, { inferFromRelationship = true } = {}) {
    const source = Array.isArray(value) ? value : [];
    const map = new Map();
    for (const raw of source) {
        if (!raw || typeof raw !== 'object') continue;
        const axis = RELATIONSHIP_KEYS.includes(String(raw.axis || '').trim().toLowerCase()) ? String(raw.axis).trim().toLowerCase() : '';
        const polarity = normalizeMilestonePolarity(raw.polarity);
        const threshold = Number(raw.threshold);
        if (!axis || !polarity || !RELATIONSHIP_MILESTONE_THRESHOLDS.includes(threshold)) continue;
        const entry = {
            axis,
            polarity,
            threshold,
            reason: cleanText(raw.reason, 300) || 'Relationship depth established.',
            sourceMessageId: Number.isInteger(raw.sourceMessageId) ? raw.sourceMessageId : null,
            turn: Number.isFinite(Number(raw.turn)) ? Number(raw.turn) : null,
            inferred: Boolean(raw.inferred),
        };
        map.set(milestoneIdentity(entry), entry);
    }
    if (inferFromRelationship) {
        for (const entry of inferredMilestoneEntries(relationship)) {
            const key = milestoneIdentity(entry);
            if (!map.has(key)) map.set(key, entry);
        }
    }
    return [...map.values()]
        .sort((a, b) => RELATIONSHIP_KEYS.indexOf(a.axis) - RELATIONSHIP_KEYS.indexOf(b.axis)
            || a.polarity - b.polarity
            || a.threshold - b.threshold)
        .slice(0, RELATIONSHIP_MILESTONE_LIMIT);
}

export function relationshipMilestoneUnlocked(milestones, axis, polarity, threshold) {
    const normalized = normalizeRelationshipMilestones(milestones, DEFAULT_RELATIONSHIP, { inferFromRelationship: false });
    const key = String(axis || '').trim().toLowerCase();
    const sign = normalizeMilestonePolarity(polarity);
    const point = Number(threshold);
    return normalized.some(entry => entry.axis === key && entry.polarity === sign && entry.threshold === point);
}

export function inferManualRelationshipMilestones(milestones, relationship, reason = 'Manual dossier adjustment established this relationship depth.', sourceMessageId = null, turn = null) {
    const map = new Map(normalizeRelationshipMilestones(milestones, relationship).map(entry => [milestoneIdentity(entry), entry]));
    for (const entry of inferredMilestoneEntries(relationship, { includeBoundary: true, reason })) {
        entry.inferred = false;
        entry.sourceMessageId = Number.isInteger(sourceMessageId) ? sourceMessageId : null;
        entry.turn = Number.isFinite(Number(turn)) ? Number(turn) : null;
        map.set(milestoneIdentity(entry), entry);
    }
    return normalizeRelationshipMilestones([...map.values()], relationship, { inferFromRelationship: false });
}

export function applyRelationshipMilestoneCrossings(milestones, crossings = [], { reason = '', sourceMessageId = null, turn = null } = {}) {
    const map = new Map(normalizeRelationshipMilestones(milestones, DEFAULT_RELATIONSHIP, { inferFromRelationship: false }).map(entry => [milestoneIdentity(entry), entry]));
    for (const raw of Array.isArray(crossings) ? crossings : []) {
        const axis = RELATIONSHIP_KEYS.includes(String(raw?.axis || '').trim().toLowerCase()) ? String(raw.axis).trim().toLowerCase() : '';
        const polarity = normalizeMilestonePolarity(raw?.polarity);
        const threshold = Number(raw?.threshold);
        if (!axis || !polarity || !RELATIONSHIP_MILESTONE_THRESHOLDS.includes(threshold)) continue;
        const entry = {
            axis,
            polarity,
            threshold,
            reason: cleanText(reason || raw.reason, 300) || `Relationship crossed the ${polarity > 0 ? '+' : '-'}${threshold} ${axis} milestone.`,
            sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
            turn: Number.isFinite(Number(turn)) ? Number(turn) : null,
            inferred: false,
        };
        map.set(milestoneIdentity(entry), entry);
    }
    return normalizeRelationshipMilestones([...map.values()], DEFAULT_RELATIONSHIP, { inferFromRelationship: false });
}

function relationshipInertiaFactor(currentValue, proposedDelta, impact = 'ordinary') {
    const current = Number(currentValue) || 0;
    const delta = Number(proposedDelta) || 0;
    if (!delta) return 0;
    const magnitude = Math.abs(current);
    const deepening = current === 0 || Math.sign(current) === Math.sign(delta);
    if (deepening) {
        if (magnitude < 30) return 1;
        if (magnitude < 50) return 0.75;
        if (magnitude < 70) return 0.5;
        if (magnitude < 85) return 0.35;
        if (magnitude < 95) return 0.2;
        return 0.1;
    }
    // Established relationships have some resilience to small contrary beats. The more
    // decisive the event, the more of that resistance it can overcome. Extreme evidence
    // is allowed to hit at full raw tier strength, but never exceeds the tier cap.
    if (impact === 'extreme') return 1;
    if (impact === 'major') {
        if (magnitude < 30) return 1;
        if (magnitude < 50) return 1;
        if (magnitude < 70) return 0.9;
        if (magnitude < 85) return 0.8;
        if (magnitude < 95) return 0.7;
        return 0.6;
    }
    if (impact === 'meaningful') {
        if (magnitude < 30) return 1;
        if (magnitude < 50) return 0.9;
        if (magnitude < 70) return 0.8;
        if (magnitude < 85) return 0.65;
        if (magnitude < 95) return 0.5;
        return 0.4;
    }
    if (magnitude < 30) return 1;
    if (magnitude < 50) return 0.85;
    if (magnitude < 70) return 0.7;
    if (magnitude < 85) return 0.55;
    if (magnitude < 95) return 0.4;
    return 0.3;
}

function relationshipAxisLimit(impact) {
    if (impact === 'ordinary') return 1;
    if (impact === 'meaningful') return 2;
    if (impact === 'major') return 3;
    if (impact === 'extreme') return 4;
    return 0;
}

function selectRelationshipAxes(delta, axisLimit) {
    const ranked = RELATIONSHIP_KEYS
        .filter(key => delta[key] !== 0)
        .map(key => ({ key, magnitude: Math.abs(delta[key]) }))
        .sort((a, b) => b.magnitude - a.magnitude || RELATIONSHIP_KEYS.indexOf(a.key) - RELATIONSHIP_KEYS.indexOf(b.key));
    if (!axisLimit || !ranked.length) return new Set();
    if (ranked.length <= axisLimit) return new Set(ranked.map(item => item.key));
    const cutoff = ranked[axisLimit - 1]?.magnitude ?? Infinity;
    const above = ranked.filter(item => item.magnitude > cutoff);
    const tied = ranked.filter(item => item.magnitude === cutoff);
    const slots = Math.max(0, axisLimit - above.length);
    // If more axes tie for the remaining slots than can legally move, selecting by fixed key
    // order would bias Trust/Affection. Reject the ambiguous tied group instead.
    const acceptedTied = tied.length <= slots ? tied : [];
    return new Set([...above, ...acceptedTied].map(item => item.key));
}

export function applyRelationshipDelta(current, proposedDelta, impact, caps = DEFAULT_RELATIONSHIP_CAPS, progress = DEFAULT_RELATIONSHIP_PROGRESS, milestones = []) {
    const baseline = normalizeRelationshipBaseline(current || DEFAULT_RELATIONSHIP);
    const priorProgress = normalizeRelationshipProgress(progress);
    const establishedMilestones = normalizeRelationshipMilestones(milestones, baseline);
    const delta = normalizeRelationshipDelta(proposedDelta);
    const hasDelta = RELATIONSHIP_KEYS.some(key => delta[key] !== 0);
    const level = normalizeRelationshipImpact(impact, hasDelta);
    const limits = normalizeRelationshipCaps(caps);
    const cap = level === 'none' ? 0 : Number(limits[level] || 0);
    const axisLimit = relationshipAxisLimit(level);
    const allowedAxes = selectRelationshipAxes(delta, axisLimit);
    const appliedDelta = {};
    const evidenceDelta = {};
    const relationship = {};
    const relationshipProgress = {};
    const milestoneCrossings = [];
    const milestoneBlocks = [];

    for (const key of RELATIONSHIP_KEYS) {
        const capped = allowedAxes.has(key) ? Math.max(-cap, Math.min(cap, delta[key])) : 0;
        const factor = relationshipInertiaFactor(baseline[key], capped, level);
        const weighted = capped * factor;
        let accumulated = priorProgress[key] + weighted;
        const baselineValue = baseline[key];
        const proposedPolarity = Math.sign(capped);
        const baselinePolarity = Math.sign(baselineValue);
        const deepeningSamePolarity = Boolean(capped)
            && (baselinePolarity === 0 || baselinePolarity === proposedPolarity)
            && Math.abs(baselineValue + accumulated) >= Math.abs(baselineValue);

        // Sitting exactly on a locked checkpoint never banks outward fractional evidence.
        // A qualifying event may cross it immediately; otherwise the attempted outward
        // evidence is acknowledged but cannot accumulate behind the gate.
        if (deepeningSamePolarity && baselinePolarity === proposedPolarity) {
            const lockedBoundary = RELATIONSHIP_MILESTONE_THRESHOLDS.find(threshold =>
                Math.abs(baselineValue) === threshold
                && !relationshipMilestoneUnlocked(establishedMilestones, key, proposedPolarity, threshold));
            if (lockedBoundary) {
                if (!relationshipMilestoneEventQualifies(level, lockedBoundary, capped, cap)) {
                    accumulated = 0;
                    milestoneBlocks.push({
                        axis: key,
                        polarity: proposedPolarity,
                        threshold: lockedBoundary,
                        requiredImpact: relationshipMilestoneRequirement(lockedBoundary),
                        requiredRaw: relationshipMilestoneRawRequirement(lockedBoundary, cap),
                    });
                } else if (!milestoneCrossings.some(entry => entry.axis === key && entry.polarity === proposedPolarity && entry.threshold === lockedBoundary)) {
                    // The qualifying event itself opens a checkpoint even when inertia leaves
                    // less than one whole visible point on this turn.
                    milestoneCrossings.push({ axis: key, polarity: proposedPolarity, threshold: lockedBoundary, requiredImpact: relationshipMilestoneRequirement(lockedBoundary) });
                }
            }
        }

        let whole = Math.trunc(accumulated);
        let nextValue = Math.round(clamp(baselineValue + whole, -100, 100));
        let blockedAt = null;

        if (capped && Math.abs(nextValue) >= Math.abs(baselineValue)) {
            const movementPolarity = Math.sign(nextValue) || proposedPolarity;
            const baselineMagnitude = baselinePolarity === movementPolarity ? Math.abs(baselineValue) : 0;
            const reachedMagnitude = Math.abs(nextValue);
            for (const threshold of RELATIONSHIP_MILESTONE_THRESHOLDS) {
                if (!(baselineMagnitude < threshold && reachedMagnitude === threshold)) continue;
                if (relationshipMilestoneUnlocked(establishedMilestones, key, movementPolarity, threshold)) continue;
                if (!relationshipMilestoneEventQualifies(level, threshold, capped, cap)) continue;
                if (!milestoneCrossings.some(entry => entry.axis === key && entry.polarity === movementPolarity && entry.threshold === threshold)) {
                    milestoneCrossings.push({ axis: key, polarity: movementPolarity, threshold, requiredImpact: relationshipMilestoneRequirement(threshold) });
                }
            }
        }

        if (capped && Math.abs(nextValue) > Math.abs(baselineValue)) {
            const movementPolarity = Math.sign(nextValue) || proposedPolarity;
            const lowMagnitude = baselinePolarity === movementPolarity ? Math.abs(baselineValue) : 0;
            const highMagnitude = Math.abs(nextValue);
            for (const threshold of RELATIONSHIP_MILESTONE_THRESHOLDS) {
                if (!(lowMagnitude <= threshold && highMagnitude > threshold)) continue;
                if (relationshipMilestoneUnlocked(establishedMilestones, key, movementPolarity, threshold)) continue;
                if (relationshipMilestoneEventQualifies(level, threshold, capped, cap)) {
                    milestoneCrossings.push({ axis: key, polarity: movementPolarity, threshold, requiredImpact: relationshipMilestoneRequirement(threshold) });
                    continue;
                }
                blockedAt = threshold;
                milestoneBlocks.push({
                    axis: key,
                    polarity: movementPolarity,
                    threshold,
                    requiredImpact: relationshipMilestoneRequirement(threshold),
                    requiredRaw: relationshipMilestoneRawRequirement(threshold, cap),
                });
                nextValue = movementPolarity * threshold;
                break;
            }
        }

        whole = nextValue - baselineValue;
        let remainder = accumulated - whole;
        const finalPolarity = Math.sign(nextValue);
        const finalMagnitude = Math.abs(nextValue);
        const lockedFinalBoundary = finalPolarity && RELATIONSHIP_MILESTONE_THRESHOLDS.find(threshold =>
            finalMagnitude === threshold
            && !relationshipMilestoneUnlocked(establishedMilestones, key, finalPolarity, threshold)
            && !milestoneCrossings.some(entry => entry.axis === key && entry.polarity === finalPolarity && entry.threshold === threshold));
        if (blockedAt || (lockedFinalBoundary && Math.sign(remainder) === finalPolarity)) remainder = 0;
        if ((nextValue >= 100 && remainder > 0) || (nextValue <= -100 && remainder < 0)) remainder = 0;
        if (Math.abs(remainder) < 0.000001) remainder = 0;

        appliedDelta[key] = whole;
        evidenceDelta[key] = Number(weighted.toFixed(6));
        relationship[key] = nextValue;
        relationshipProgress[key] = Number(Math.max(-0.999999, Math.min(0.999999, remainder)).toFixed(6));
    }

    const evidenceAccepted = RELATIONSHIP_KEYS.some(key => evidenceDelta[key] !== 0);
    const progressChanged = RELATIONSHIP_KEYS.some(key => relationshipProgress[key] !== priorProgress[key]);
    return {
        relationship,
        relationshipProgress,
        appliedDelta,
        evidenceDelta,
        evidenceAccepted,
        progressChanged,
        milestoneCrossings,
        milestoneBlocks,
        impact: level,
        cap,
        axisLimit,
    };
}

function relationshipReasonSimilarity(a, b) {
    const left = cleanText(a, 500);
    const right = cleanText(b, 500);
    if (!left || !right) return 0;
    if (normalizeName(left) === normalizeName(right)) return 1;
    return durableSemanticSimilarity(left, right);
}

export function normalizeRelationshipEvidence(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(RELATIONSHIP_KEYS.map(key => [key, cleanText(source[key], 300)]));
}

const RELATIONSHIP_AXIS_CUES = Object.freeze({
    trust: /\b(trust(?:s|ed|ing)?|rely|relies|relied|relying|reliance|reliable|dependable|promise(?:s|d)?|confidence|confide(?:s|d)?|vulnerab|safe|safety|protect(?:s|ed|ing)?|rescu|betray|betrayed|deceiv|deception|lied|lying|honest|secret|abandon|unreliable|faith)\b/i,
    affection: /\b(affection|fond|fondness|care(?:s|d|ing)?|warmth|kindness|comfort|bond(?:s|ed|ing)?|companionship|companion|attached|attachment|love(?:s|d)?|like(?:s|d)?|resent|resentment|dislike|hate(?:s|d)?|hurt|reject(?:s|ed|ion)?|humiliat|neglect|cherish)\b/i,
    desire: /\b(desire|desired|attract|attraction|romantic|romance|intimacy|intimate|kiss|kissed|kissing|sexual|sexually|lust|longing|yearn|flirt|date|lover|physical closeness|physical contact|wanted? (?:him|her|them|the player)|drawn to)\b/i,
    tension: /\b(tension|tense|awkward|fear|afraid|suspicion|suspicious|argument|argued|threat|threaten|pressure|rival|rivalry|resent|conflict|hostil|unease|uneasy|reconcil|relief|relaxed|ease|eased|reassur|strain|friction)\b/i,
});

export function relationshipAxisEvidenceGrounded(key, evidence, context = '') {
    if (!RELATIONSHIP_KEYS.includes(key)) return false;
    const explanation = cleanText(evidence, 300);
    if (!explanation || !RELATIONSHIP_AXIS_CUES[key].test(explanation)) return false;
    const source = String(context || '').trim();
    if (!source) return true;
    if (!relationshipChangeReasonGrounded(explanation, source)) return false;
    // Desire has the strictest firewall: the narration itself must contain an attraction/
    // romantic/intimate/physical cue. A model cannot turn a grounded rescue into Desire merely
    // by appending the word "attracted" to its explanation.
    if (key === 'desire' && !RELATIONSHIP_AXIS_CUES.desire.test(source)) return false;
    return true;
}

function relationshipEvidenceValidForDelta(delta, evidence, context = '') {
    const normalized = normalizeRelationshipEvidence(evidence);
    return RELATIONSHIP_KEYS.every(key => delta[key] === 0 || relationshipAxisEvidenceGrounded(key, normalized[key], context));
}

export function normalizeRelationshipEventHistory(value = []) {
    const source = Array.isArray(value) ? value : [];
    const out = [];
    for (const raw of source.slice(-RELATIONSHIP_EVENT_HISTORY_LIMIT * 2)) {
        if (!raw || typeof raw !== 'object') continue;
        const reason = cleanText(raw.reason, 500);
        const evidence = normalizeRelationshipEvidence(raw.evidence);
        if (!reason && !RELATIONSHIP_KEYS.some(key => evidence[key])) continue;
        out.push({
            impact: normalizeRelationshipImpact(raw.impact, true),
            reason,
            evidence,
            sourceMessageId: Number.isInteger(raw.sourceMessageId) ? raw.sourceMessageId : null,
            ...(Number.isFinite(Number(raw.turn)) ? { turn: Number(raw.turn) } : {}),
        });
    }
    return out.slice(-RELATIONSHIP_EVENT_HISTORY_LIMIT);
}

function relationshipEventText(event) {
    const evidence = normalizeRelationshipEvidence(event?.evidence);
    return [cleanText(event?.reason, 500), ...RELATIONSHIP_KEYS.map(key => evidence[key])].filter(Boolean).join(' ');
}

export function relationshipChangeLooksDuplicate(previousChange, reason, { sourceMessageId = null, turn = null, evidence = null } = {}) {
    const previous = previousChange && typeof previousChange === 'object' ? previousChange : {};
    if (String(previous.impact || '').toLowerCase() === 'manual') return false;
    const currentText = [cleanText(reason, 500), ...RELATIONSHIP_KEYS.map(key => cleanText(evidence?.[key], 300))].filter(Boolean).join(' ');
    const priorText = relationshipEventText(previous) || cleanText(previous.reason, 500);
    if (!currentText || !priorText) return false;
    const priorTurn = Number(previous.turn);
    const currentTurn = Number(turn);
    const recentByTurn = Number.isFinite(priorTurn) && Number.isFinite(currentTurn) && Math.abs(currentTurn - priorTurn) <= 8;
    const recentByMessage = Number.isInteger(sourceMessageId) && Number.isInteger(previous.sourceMessageId)
        && Math.abs(sourceMessageId - previous.sourceMessageId) <= 10;
    if (!recentByTurn && !recentByMessage) return false;
    return relationshipReasonSimilarity(priorText, currentText) >= 0.68;
}

export function relationshipHistoryLooksDuplicate(history, reason, options = {}) {
    return normalizeRelationshipEventHistory(history).some(event => relationshipChangeLooksDuplicate(event, reason, options));
}

export function appendRelationshipEvent(history, event) {
    const normalized = normalizeRelationshipEventHistory([...(Array.isArray(history) ? history : []), event]);
    return normalized.slice(-RELATIONSHIP_EVENT_HISTORY_LIMIT);
}


export function relationshipChangeReasonGrounded(reason, context = '') {
    const explanation = cleanText(reason, 500);
    if (!explanation) return false;
    const source = String(context || '').trim();
    if (!source) return true;
    return durableSeedGrounded(explanation, source);
}

function relationshipSummaryHasUnsupportedClaims(value, relationship = DEFAULT_RELATIONSHIP, milestones = null) {
    const text = String(value || '').trim();
    if (!text) return false;
    const rel = normalizeRelationshipBaseline(relationship || DEFAULT_RELATIONSHIP);
    const positiveStrength = Math.max(0, rel.trust, rel.affection, rel.desire);
    const milestoneState = normalizeRelationshipMilestones(
        milestones,
        rel,
        { inferFromRelationship: milestones == null },
    );
    const unlocked = (axis, polarity, threshold) => relationshipMilestoneUnlocked(milestoneState, axis, polarity, threshold);
    const desireClaims = /\b(madly in love|in love|romantic|romance|sexually|sexual attraction|lust|desire[sd]?|intimate attraction|physically attracted|yearns? for|wants? (?:him|her|them|the player) physically)\b/i;
    const tropeClaims = /\b(possessive|jealous|obsessive|obsessed|would kill|kill anyone|belongs to (?:him|her|them|the player)|cannot bear (?:him|her|them|the player) with|unconditionally devoted|utterly devoted)\b/i;
    const absoluteClaims = /\b(indispensable|everything to (?:her|him|them)|cannot live without|can't live without|completely dependent|utterly dependent)\b/i;
    const deepTrustClaims = /\b(deep(?:est)? trust|deeply trusts?|profound trust|unwavering trust|unquestion(?:ing|ed) trust|complete trust|implicit trust|central to (?:her|his|their) (?:deepest )?trust)\b/i;
    const exceptionalTrustClaims = /\b(absolute trust|unbreakable trust|trusts? (?:him|her|them|the player) with (?:her|his|their) life|trusts? (?:him|her|them|the player) without reservation)\b/i;
    const deepAffectionClaims = /\b(deep affection|deeply attached|profound attachment|central to (?:her|his|their) life|one of (?:her|his|their) most important people)\b/i;
    const exceptionalAffectionClaims = /\b(inseparable|irreplaceable|life-defining bond|devoted to (?:him|her|them|the player))\b/i;
    const deepDistrustClaims = /\b(deep distrust|profound distrust|deeply distrusts?|cannot trust (?:him|her|them|the player) at all)\b/i;
    const deepDislikeClaims = /\b(deep hatred|profound hatred|deep resentment|utterly hates?)\b/i;
    if (rel.desire < 30 && desireClaims.test(text)) return true;
    if (tropeClaims.test(text)) return true;
    if (positiveStrength < 70 && absoluteClaims.test(text)) return true;
    if (deepTrustClaims.test(text) && !unlocked('trust', 1, 50)) return true;
    if (exceptionalTrustClaims.test(text) && !unlocked('trust', 1, 75)) return true;
    if (deepAffectionClaims.test(text) && !unlocked('affection', 1, 50)) return true;
    if (exceptionalAffectionClaims.test(text) && !unlocked('affection', 1, 75)) return true;
    if (deepDistrustClaims.test(text) && !unlocked('trust', -1, 50)) return true;
    if (deepDislikeClaims.test(text) && !unlocked('affection', -1, 50)) return true;
    return false;
}

export function relationshipSummaryConsistent(value, relationship = DEFAULT_RELATIONSHIP, context = '', milestones = null) {
    const summary = compactDurableText(value, DURABLE_PROFILE_LIMITS.relationshipSummary, 6);
    if (!summary || relationshipSummaryHasUnsupportedClaims(summary, relationship, milestones)) return false;
    const source = String(context || '').trim();
    if (!source) return true;
    return durableSeedGrounded(summary, source) || durableSemanticSimilarity(summary, source) >= 0.24;
}

export function calibrateRelationshipSummary(value, relationship = DEFAULT_RELATIONSHIP) {
    let summary = compactDurableText(value, DURABLE_PROFILE_LIMITS.relationshipSummary, 6);
    if (!summary) return '';
    const rel = normalizeRelationshipBaseline(relationship || DEFAULT_RELATIONSHIP);
    const positiveStrength = Math.max(0, rel.trust, rel.affection, rel.desire);
    if (positiveStrength < 70) {
        summary = summary
            .replace(/\bindispensable\b/gi, 'important')
            .replace(/\butterly\s+dependent\s+on\b/gi, 'increasingly reliant on')
            .replace(/\bcompletely\s+dependent\s+on\b/gi, 'strongly reliant on')
            .replace(/\b(?:cannot|can['’]?t)\s+live\s+without\b/gi, 'relies deeply on')
            .replace(/\bwould\s+do\s+anything\s+for\b/gi, 'cares deeply for')
            .replace(/\beverything\s+to\s+(her|him|them)\b/gi, 'deeply important to $1');
    }
    if (positiveStrength < 45) {
        summary = summary
            .replace(/\ban important source of physical comfort and survival\b/gi, 'a growing source of practical support and comfort')
            .replace(/\ban important source of survival and physical comfort\b/gi, 'a growing source of practical support and comfort')
            .replace(/\ban important source of (?:her|his|their) survival\b/gi, 'an important source of practical support')
            .replace(/\butterly\s+devoted\s+to\b/gi, 'attached to')
            .replace(/\bunconditionally\s+devoted\s+to\b/gi, 'attached to');
    }
    return compactDurableText(summary, DURABLE_PROFILE_LIMITS.relationshipSummary, 6);
}


const TEXT_FIELDS = [
    'role', 'species', 'age', 'apparentAge', 'appearance', 'personality', 'speech', 'background',
    'relationshipSummary', 'mood', 'location', 'goal', 'status',
];

export function clamp(value, min = 0, max = 100) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1', 'on'].includes(text)) return true;
        if (['false', 'no', 'n', '0', 'off', ''].includes(text)) return false;
    }
    return Boolean(fallback);
}

export function normalizeName(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export const NPC_CANDIDATE_TTL_TURNS = 15;
export const NPC_CANDIDATE_LIMIT = 60;

const ROLE_LABEL_WORDS = new Set([
    'adventurer', 'apprentice', 'assistant', 'bartender', 'blacksmith', 'boy', 'captain', 'child', 'clerk', 'cook',
    'courier', 'drifter', 'elder', 'female', 'gate', 'girl', 'guard', 'guild', 'guildmaster', 'healer', 'innkeeper',
    'keeper', 'laborer', 'man', 'merchant', 'messenger', 'novice', 'officer', 'priest', 'priestess', 'receptionist',
    'refugee', 'runner', 'servant', 'soldier', 'stablehand', 'stable', 'hand', 'student', 'traveler', 'vendor', 'waiter', 'waitress',
    'watchman', 'woman', 'worker', 'butcher', 'baker', 'farmer', 'fisher', 'fisherman', 'fishmonger', 'carpenter', 'tailor',
    'cobbler', 'shopkeeper', 'storekeeper', 'grocer', 'porter', 'maid', 'hostler', 'groom', 'rancher', 'shepherd', 'herder',
    'miner', 'miller', 'brewer', 'tanner', 'scribe', 'librarian', 'teacher', 'doctor', 'nurse', 'midwife', 'barber',
    'young', 'old', 'older', 'elderly', 'masked', 'hooded', 'mysterious', 'local',
    'village', 'town', 'city', 'guildhall', 'human', 'elf', 'elven', 'dwarf', 'dwarven', 'half', 'halfelf', 'dwelf',
    'tiefling', 'orc', 'orcish', 'goblin', 'halfling', 'gnome', 'male', 'warrior', 'mage', 'wizard', 'witch', 'knight',
]);

export function inferNpcIdentityKind(name, explicit = '') {
    const stated = String(explicit ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const tokens = normalizeName(name).split(/\s+/).filter(Boolean);
    if (!tokens.length) return 'unknown';
    const roleLike = tokens.every(token => ROLE_LABEL_WORDS.has(token) || /^\d+$/.test(token));
    const inferred = roleLike ? 'role_label' : 'proper_name';
    // A model occasionally labels an obvious personal name as role_label. The deterministic
    // name heuristic wins in that direction so Conservative mode cannot strand names such as
    // Myla/Toris as candidates. Explicit proper_name remains authoritative.
    if (stated === 'proper_name') return 'proper_name';
    if (stated === 'role_label') {
        const clearlyPersonal = (tokens.length === 1 && !ROLE_LABEL_WORDS.has(tokens[0]))
            || (tokens.length > 1 && tokens.every(token => !ROLE_LABEL_WORDS.has(token) && !/^\d+$/.test(token)));
        return clearlyPersonal ? 'proper_name' : 'role_label';
    }
    return inferred;
}

const INTERIM_IDENTITY_WORDS = new Set([
    'unknown', 'unnamed', 'unidentified', 'anonymous', 'stranger', 'figure', 'person', 'npc',
    'man', 'woman', 'boy', 'girl', 'child', 'guard', 'receptionist', 'bartender', 'innkeeper',
    'merchant', 'vendor', 'clerk', 'waiter', 'waitress', 'soldier', 'officer', 'watchman', 'sentry',
    'sentinel', 'stablehand', 'blacksmith', 'healer', 'priest', 'priestess', 'servant', 'maid',
    'attendant', 'worker', 'laborer', 'courier', 'messenger', 'shopkeeper', 'keeper', 'owner',
    'proprietor', 'captain', 'chief', 'leader', 'elder', 'student', 'apprentice', 'assistant',
    'human', 'elf', 'dwarf', 'orc', 'goblin', 'halfling', 'gnome', 'tiefling', 'traveler', 'drifter',
]);

function isInterimNpcLabel(name, explicit = '') {
    const text = normalizeName(name);
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    if (inferNpcIdentityKind(name, explicit) === 'role_label') return true;
    // Catch descriptive placeholders such as "red haired woman" or "masked elf" that
    // contain free-form adjectives and therefore are not caught by the all-role-word heuristic.
    const finalToken = tokens[tokens.length - 1];
    const hasPlaceholderMarker = tokens.some(token => ['unknown', 'unnamed', 'unidentified', 'anonymous', 'mysterious', 'masked', 'hooded'].includes(token));
    return tokens.length <= 6 && (hasPlaceholderMarker || INTERIM_IDENTITY_WORDS.has(finalToken));
}

function identityLabelsRelated(a, b) {
    const left = normalizeName(a);
    const right = normalizeName(b);
    if (!left || !right) return false;
    return left === right || (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)));
}

function findInterimIdentityPromotionIndex(records, incoming) {
    if (!Array.isArray(records)) return -1;
    const incomingName = cleanText(incoming?.name, 120);
    if (!incomingName || inferNpcIdentityKind(incomingName, incoming?.identityKind) !== 'proper_name') return -1;

    // An explicit sameIndividual:false is authoritative unless the model also supplied the
    // old interim label as an alias. Omitted sameIndividual is NOT treated as a veto: models
    // frequently reveal a proper name while forgetting the continuity flag.
    const incomingAliases = cleanList(incoming?.aliases, 8, 120).map(normalizeName).filter(Boolean);
    const incomingRole = cleanText(incoming?.role, 180);
    const incomingLocation = normalizeName(incoming?.location);
    const matches = [];
    for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (!record || !isInterimNpcLabel(record.name, record.identityKind)) continue;
        const oldLabels = [record.name, ...(record.aliases || [])].map(normalizeName).filter(Boolean);
        const aliasClaim = oldLabels.some(label => incomingAliases.includes(label));
        if (incoming?.sameIndividualProvided && !incoming.sameIndividual && !aliasClaim) continue;

        const roleMatch = incomingRole
            ? identityLabelsRelated(record.role, incomingRole) || identityLabelsRelated(record.name, incomingRole)
            : false;
        const recordLocation = normalizeName(record.location);
        const locationConflict = incomingLocation && recordLocation && incomingLocation !== recordLocation;
        if (locationConflict) continue;
        const locationMatch = Boolean(incomingLocation && recordLocation && incomingLocation === recordLocation);

        // Strong continuity can be established by any one of: explicit old-label alias,
        // unique role continuity, or sameIndividual plus a non-conflicting scene/location.
        // Requiring uniqueness below prevents fusing two generic guards/receptionists.
        const samePersonSignal = Boolean(incoming?.sameIndividual);
        if (!aliasClaim && !roleMatch && !(samePersonSignal && (locationMatch || !incomingRole))) continue;
        matches.push(i);
    }
    return matches.length === 1 ? matches[0] : -1;
}

export function normalizeDossierSignal(value) {
    const signal = String(value ?? '').trim().toLowerCase();
    return ['incidental', 'meaningful', 'persistent'].includes(signal) ? signal : 'incidental';
}

export function slugify(value) {
    const slug = normalizeName(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'npc';
}

export function makeNpcId(name, existingIds = []) {
    const base = `npc_${slugify(name)}`;
    if (!existingIds.includes(base)) return base;
    let i = 2;
    while (existingIds.includes(`${base}_${i}`)) i += 1;
    return `${base}_${i}`;
}

function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value ?? '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function stableAgeInRange(min, max, seed) {
    const low = Math.max(0, Math.round(Number(min) || 0));
    const high = Math.max(low, Math.round(Number(max) || low));
    const span = high - low + 1;
    return low + (stableHash(seed) % span);
}

function ageSpecificity(value) {
    const age = String(value ?? '').trim();
    if (/^\d{1,3}$/.test(age)) return 3;
    if (/^~\d{1,3}$/.test(age)) return 2;
    return age ? 1 : 0;
}

function normalizedAgeText(value) {
    return cleanText(value, 80).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

const AGE_ONES = Object.freeze({
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
});
const AGE_TENS = Object.freeze({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });
const AGE_DECADES = Object.freeze({ twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80, nineties: 90 });
const AGE_NUMBER_WORD_RE = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|sixty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|seventy(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|eighty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ninety(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one hundred(?: and)?(?:[- ](?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|sixty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|seventy(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|eighty(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|ninety(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))))?)';

function parseEnglishAgeNumber(value) {
    let text = normalizedAgeText(value).replace(/-/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (/^\d{1,3}$/.test(text)) {
        const number = Number(text);
        return number >= 0 && number <= 200 ? number : null;
    }
    if (Object.prototype.hasOwnProperty.call(AGE_ONES, text)) return AGE_ONES[text];
    const parts = text.split(' ').filter(Boolean);
    let total = 0;
    let used = false;
    for (const part of parts) {
        if (part === 'hundred') {
            if (!used || total < 1 || total > 9) return null;
            total *= 100;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(AGE_ONES, part)) {
            total += AGE_ONES[part]; used = true; continue;
        }
        if (Object.prototype.hasOwnProperty.call(AGE_TENS, part)) {
            total += AGE_TENS[part]; used = true; continue;
        }
        return null;
    }
    return used && total >= 0 && total <= 200 ? total : null;
}

function decadeWordRange(value) {
    const decade = AGE_DECADES[normalizedAgeText(value)];
    return Number.isFinite(decade) ? [decade, decade + 9] : null;
}

function hasQualitativeAgeCue(value) {
    const lower = normalizedAgeText(value);
    return /\b(newborn|infant|toddler|child|pre[- ]?teen|adolescent|teen(?:ager)?|young adult|young|middle[- ]aged|older adult|elderly|senior|adult)\b/i.test(lower)
        || /^(?:looks?|appears?|apparent(?:ly)?)/i.test(lower)
        || /^(?:(?:about|around|approx(?:\.|imately)?)\s+)?(?:early|mid|middle|late)\s+(?:\d{2,3}s|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)$/i.test(lower)
        || /^(?:(?:about|around|approx(?:\.|imately)?)\s+)?(?:twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)$/i.test(lower)
        || /^\d{1,3}\s*(?:-|to)\s*\d{1,3}$/i.test(lower);
}

function isUnknownAgePlaceholder(value) {
    const lower = normalizedAgeText(value);
    return !lower || /^(?:unknown|unk|n\/?a|none|unspecified|not\s+(?:known|established|specified|stated)|unclear|not\s+available)$/i.test(lower);
}

/**
 * Chronological age. This field is for actual story age only, never visual-age adjectives.
 * Exact numbers are normalized; otherwise grounded chronological wording is preserved.
 */
export function normalizeAge(value) {
    const cleaned = cleanText(value, 80);
    if (!cleaned || isUnknownAgePlaceholder(cleaned)) return '';
    const lower = normalizedAgeText(cleaned);
    let match = lower.match(/^(?:age\s*[:=]?\s*)?(\d{1,3})(?:\s*(?:years?|yrs?)\s*(?:old)?)?$/i);
    if (match) {
        const number = Number(match[1]);
        if (Number.isFinite(number) && number >= 0 && number <= 999) return String(Math.round(number));
    }
    const wordMatch = lower.match(new RegExp(`^(?:age\\s*[:=]?\\s*)?(${AGE_NUMBER_WORD_RE})(?:\\s*(?:years?|yrs?)\\s*(?:old)?)?$`, 'i'));
    if (wordMatch) {
        const number = parseEnglishAgeNumber(wordMatch[1]);
        if (Number.isFinite(number)) return String(number);
    }
    // A qualitative visual cue belongs in apparentAge, not chronological age.
    if (hasQualitativeAgeCue(lower)) return '';
    return cleaned;
}

/**
 * Visual/apparent age for portrait prompting. Descriptor/range evidence becomes a stable ~N.
 * The estimate is seeded by NPC identity + evidence so repeated scans do not reroll it.
 */
export function normalizeApparentAge(value, seed = '') {
    const cleaned = cleanText(value, 80);
    if (!cleaned || isUnknownAgePlaceholder(cleaned)) return '';
    let lower = normalizedAgeText(cleaned);

    // Normalize the common prose wrappers first so the stored field remains compact.
    lower = lower
        .replace(/^(?:looks?|appears?)\s+(?:to\s+be\s+)?/i, '')
        .replace(/^apparent(?:ly)?(?:\s+age)?\s*[:=]?\s*/i, '')
        .replace(/^(?:about|around|approx(?:\.|imately)?)\s+/i, '')
        .replace(/^in\s+(?:his|her|their)\s+/i, '')
        .trim();

    let match = lower.match(/^~?(\d{1,3})(?:\s*(?:years?|yrs?)\s*(?:old)?)?$/i);
    if (match) {
        const number = Number(match[1]);
        if (Number.isFinite(number) && number >= 0 && number <= 200) return `~${Math.round(number)}`;
    }

    match = lower.match(new RegExp(`^(${AGE_NUMBER_WORD_RE})(?:\\s*(?:years?|yrs?)\\s*(?:old)?)?$`, 'i'));
    if (match) {
        const number = parseEnglishAgeNumber(match[1]);
        if (Number.isFinite(number)) return `~${number}`;
    }

    match = lower.match(/^(\d{1,3})\s*(?:-|to)\s*(\d{1,3})(?:\s*(?:years?|yrs?)\s*(?:old)?)?$/i);
    if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        if ([a, b].every(Number.isFinite) && a >= 0 && b >= 0 && a <= 200 && b <= 200) {
            const min = Math.min(a, b);
            const max = Math.max(a, b);
            return `~${stableAgeInRange(min, max, `${seed}|${lower}`)}`;
        }
    }

    match = lower.match(/^(early|mid|middle|late)\s+(\d{2,3})s$/i);
    if (match) {
        const decade = Number(match[2]);
        if (Number.isFinite(decade) && decade >= 10 && decade <= 190) {
            const band = match[1] === 'early' ? [decade, decade + 3]
                : (match[1] === 'late' ? [decade + 7, decade + 9] : [decade + 4, decade + 6]);
            return `~${stableAgeInRange(band[0], band[1], `${seed}|${lower}`)}`;
        }
    }

    match = lower.match(/^(early|mid|middle|late)\s+(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)$/i);
    if (match) {
        const range = decadeWordRange(match[2]);
        if (range) {
            const decade = range[0];
            const band = match[1] === 'early' ? [decade, decade + 3]
                : (match[1] === 'late' ? [decade + 7, decade + 9] : [decade + 4, decade + 6]);
            return `~${stableAgeInRange(band[0], band[1], `${seed}|${lower}`)}`;
        }
    }

    const decadeRange = decadeWordRange(lower);
    if (decadeRange) return `~${stableAgeInRange(decadeRange[0], decadeRange[1], `${seed}|${lower}`)}`;

    const qualitativeRanges = [
        [/\bnewborn\b|\binfant\b/i, 0, 2],
        [/\btoddler\b/i, 2, 4],
        [/\bpre[- ]?teen\b/i, 10, 12],
        [/\badolescent\b/i, 13, 17],
        [/\bteen(?:ager)?\b/i, 13, 19],
        [/\byoung adult\b/i, 18, 29],
        [/\byoung\b/i, 18, 29],
        [/\bmiddle[- ]aged\b/i, 40, 59],
        [/\bolder adult\b/i, 55, 74],
        [/\belderly\b|\bsenior\b/i, 65, 85],
        [/\bchild\b/i, 6, 11],
        [/\badult\b/i, 25, 44],
    ];
    for (const [pattern, min, max] of qualitativeRanges) {
        if (pattern.test(lower)) return `~${stableAgeInRange(min, max, `${seed}|${lower}`)}`;
    }

    // Apparent Age is a compact visual estimate, not a prose field. Unknown wording is
    // intentionally rejected rather than allowed to drift into "around twenties"-style text.
    return '';
}

function normalizeAppearanceCanon(value) {
    let text = compactDurableText(value, DURABLE_PROFILE_LIMITS.appearance, 10);
    if (!text) return '';
    const ageToken = `(?:\\d{1,3}|${AGE_NUMBER_WORD_RE})`;
    const articlePattern = new RegExp(`^(\\s*(?:a|an)\\s+)${ageToken}(?:[-\\s]+years?[-\\s]+old)\\s+`, 'i');
    const barePattern = new RegExp(`^\\s*${ageToken}(?:[-\\s]+years?[-\\s]+old)\\s+`, 'i');
    text = text.replace(articlePattern, '$1').replace(barePattern, '');
    text = text.replace(new RegExp(`^\\s*(?:aged|age)\\s+${ageToken}\\s*[,;:-]?\\s*`, 'i'), '');
    text = text.replace(/\s+/g, ' ').trim();
    if (text && /^[a-z]/.test(text)) text = text.charAt(0).toUpperCase() + text.slice(1);
    return cleanText(text, DURABLE_PROFILE_LIMITS.appearance);
}

function normalizeAgeFields(raw = {}) {
    const seed = raw.name || raw.id || raw.species || raw.race || '';
    const rawAge = cleanText(raw.age, 80);
    const rawApparent = cleanText(raw.apparentAge ?? raw.apparent_age, 80);
    let age = normalizeAge(rawAge);
    let apparentAge = normalizeApparentAge(rawApparent, seed);

    // Defensive scanner compatibility: qualitative cues accidentally returned in age are visual age.
    if (rawAge && !age && !apparentAge) apparentAge = normalizeApparentAge(rawAge, seed);
    return { age, apparentAge };
}

function normalizeStoredAgeFields(raw = {}) {
    const seed = raw.name || raw.id || raw.species || raw.race || '';
    const rawAge = cleanText(raw.age, 80);
    const hasApparentField = Object.prototype.hasOwnProperty.call(raw, 'apparentAge') || Object.prototype.hasOwnProperty.call(raw, 'apparent_age');
    const explicitApparent = cleanText(raw.apparentAge ?? raw.apparent_age, 80);
    let age = normalizeAge(rawAge);
    let apparentAge = normalizeApparentAge(explicitApparent, seed);

    // v0.1.16 stored descriptor-derived visual estimates in age as ~N. On load, move those
    // legacy estimates to apparentAge. Exact numeric ages remain chronological. Once a v0.1.17
    // record explicitly has an apparentAge field, do not reinterpret its chronological age.
    if (!hasApparentField && rawAge && (/^~\d{1,3}$/.test(rawAge) || hasQualitativeAgeCue(rawAge))) {
        apparentAge = normalizeApparentAge(rawAge, seed);
        age = '';
    } else if (rawAge && !age && !apparentAge) {
        apparentAge = normalizeApparentAge(rawAge, seed);
    }
    return { age, apparentAge };
}

function plainUiEvidence(value) {
    return String(value || '')
        .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, ' ')
        .replace(/<\/?details\b[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function collectTaggedBodies(source, tag) {
    const out = [];
    const escaped = String(tag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return out;
    const complete = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi');
    for (const match of String(source || '').matchAll(complete)) {
        const body = plainUiEvidence(match[1]);
        if (body) out.push(body);
    }
    return out;
}

function meguminBlockEvidence(blockBody) {
    const parts = [];
    for (const body of collectTaggedBodies(blockBody, 'World_State')) parts.push(`World State: ${body}`);
    for (const body of collectTaggedBodies(blockBody, 'NPC_Inner_Chatter')) parts.push(`NPC Inner Chatter: ${body}`);

    // A cut-off reply can leave the final useful block without a closing tag. Megumin's own
    // renderer keeps such partial blocks visible; preserve the same evidence boundary here,
    // but only when that useful tag is the last opened child in the envelope.
    for (const [tag, label] of [['World_State', 'World State'], ['NPC_Inner_Chatter', 'NPC Inner Chatter']]) {
        const open = new RegExp(`<${tag}\\b[^>]*>`, 'ig');
        const matches = [...String(blockBody || '').matchAll(open)];
        if (!matches.length) continue;
        const last = matches[matches.length - 1];
        const tail = String(blockBody || '').slice(last.index + last[0].length);
        if (new RegExp(`<\\/${tag}\\s*>`, 'i').test(tail)) continue;
        if (/<[A-Za-z][A-Za-z0-9_:-]*\b[^>]*>/.test(tail)) continue;
        const body = plainUiEvidence(tail);
        if (body) parts.push(`${label}: ${body}`);
    }
    return parts.join(' ');
}

function replaceMeguminMasterBlocks(source) {
    let text = String(source || '');
    text = text.replace(/<Blocks\b[^>]*>([\s\S]*?)<\/Blocks\s*>/gi, (_whole, body) => {
        const evidence = meguminBlockEvidence(body);
        return evidence ? ` ${evidence} ` : ' ';
    });
    // Truncated master envelope at end of message.
    text = text.replace(/<Blocks\b[^>]*>([\s\S]*)$/gi, (_whole, body) => {
        const evidence = meguminBlockEvidence(body);
        return evidence ? ` ${evidence} ` : ' ';
    });
    return text;
}

function replaceStandaloneMeguminEvidence(source) {
    let text = String(source || '');
    for (const [tag, label] of [['World_State', 'World State'], ['NPC_Inner_Chatter', 'NPC Inner Chatter']]) {
        const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
        text = text.replace(re, (_whole, body) => {
            const evidence = plainUiEvidence(body);
            return evidence ? ` ${label}: ${evidence} ` : ' ';
        });
    }
    // These are model/UI control surfaces, not story evidence. Normally they are inside the
    // master <Blocks> envelope and are removed above; stripping standalone copies keeps custom
    // or partially migrated Megumin prompts from contaminating dossier scans.
    for (const tag of ['Story_Tracker', 'CYOA', 'Bonds', 'Character_Sheet', 'New_NPC', 'NPC_Update']) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
        text = text.replace(re, ' ');
    }
    return text;
}

export function hasCompactMeguminWorldState(text) {
    const source = String(text || '');
    const bodies = [];
    for (const body of collectTaggedBodies(source, 'World_State')) bodies.push(body);
    for (const details of source.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)) {
        const inner = String(details[1] || '');
        const summary = String(inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || '')
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (/\bworld\s*state\b/i.test(summary)) bodies.push(plainUiEvidence(inner));
    }
    return bodies.some(body => /\bTime\s*&\s*Loc\s*:/i.test(body) && /\bNPCs\s+Present\s*:/i.test(body));
}

export function stripUiNoise(text) {
    let source = String(text ?? '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

    // Megumin Suite beta (2026-08-18+) emits one <Blocks> envelope. Preserve only the two
    // sections NPC State intentionally treats as story evidence; discard CYOA, Bonds, sheets,
    // NPC Bank dossiers/updates, Story Tracker, and unknown/custom children by removing the
    // entire envelope after extracting World State + NPC Inner Chatter.
    source = replaceMeguminMasterBlocks(source);
    source = replaceStandaloneMeguminEvidence(source);

    // Legacy Megumin versions place high-value identity/state evidence inside <details> blocks.
    // Keep backward compatibility while dropping unrelated collapsible UI.
    const withRelevantDetails = source.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, (_whole, inner) => {
        const summaryMatch = String(inner).match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
        const summary = String(summaryMatch?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const isWorldState = /\bworld\s*state\b/i.test(summary);
        const isInnerChatter = /\bnpc\s*inner\s*chatter\b/i.test(summary);
        if (!isWorldState && !isInnerChatter) return ' ';
        const body = plainUiEvidence(inner);
        const label = isWorldState ? 'World State' : 'NPC Inner Chatter';
        return body ? ` ${label}: ${body} ` : ' ';
    });

    return withRelevantDetails
        .replace(/<[^>]+>/g, ' ')
        .replace(/```[\s\S]*?```/g, match => match.replace(/```\w*/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}



export function stripOocNpcStateControls(text) {
    return String(text ?? '')
        .replace(/(?:\(|\[)\s*OOC\s*:\s*[^\)\]]*\bnpc[\s_-]*state\b[^\)\]]*(?:\)|\])/gi, ' ')
        .replace(/^\s*OOC\s*:\s*.*\bnpc[\s_-]*state\b.*$/gim, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseOocNpcStateCommands(text) {
    const source = String(text ?? '');
    const blocks = [];
    const wrapped = /(?:\(|\[)\s*OOC\s*:\s*([\s\S]*?)(?:\)|\])/gi;
    for (const match of source.matchAll(wrapped)) blocks.push(match[1]);
    const line = /^\s*OOC\s*:\s*(.+)$/gim;
    for (const match of source.matchAll(line)) blocks.push(match[1]);

    const commands = [];
    for (const block of blocks) {
        if (!/\bnpc[\s_-]*state\b/i.test(block)) continue;
        const scoped = block.replace(/^\s*npc[\s_-]*state\s*:?\s*/i, '');
        const parts = scoped.split(/[;\n]+/).map(x => x.trim()).filter(Boolean);
        for (let part of parts) {
            part = part.replace(/^\s*npc[\s_-]*state\s*:?\s*/i, '');
            const match = part.match(/^\s*(add|remove|delete)\s*:?\s*(.+?)\s*$/i);
            if (!match) continue;
            let name = match[2]
                .replace(/^\s*(?:the\s+)?(?:bond\s+card|dossier|npc\s+card)\s+(?:for\s+)?/i, '')
                .replace(/\s+(?:from\s+)?(?:the\s+)?(?:bond\s+card|dossier|npc\s+card)\s*$/i, '')
                .replace(/^['\"“”‘’]+|['\"“”‘’.,!?]+$/g, '')
                .trim();
            if (!name) continue;
            commands.push({ action: /^add$/i.test(match[1]) ? 'add' : 'remove', name });
        }
    }
    return commands;
}

export function npcMatchesLabel(npc, label) {
    const key = normalizeName(label);
    if (!key || !npc) return false;
    return [npc.name, ...(npc.aliases || [])].some(value => normalizeName(value) === key);
}

export function applyNpcStateCommand(state, command, options = {}) {
    const next = {
        ...(state || {}),
        npcs: Array.isArray(state?.npcs) ? state.npcs.map(n => ({ ...n, aliases: [...(n.aliases || [])] })) : [],
        candidates: Array.isArray(state?.candidates) ? state.candidates.map(c => ({ ...c, aliases: [...(c.aliases || [])] })) : [],
        dismissed: Array.isArray(state?.dismissed) ? [...state.dismissed] : [],
    };
    const action = command?.action === 'remove' ? 'remove' : command?.action === 'add' ? 'add' : '';
    const name = cleanText(command?.name, 120);
    const key = normalizeName(name);
    const report = { action, name, status: 'ignored', npcId: null };
    if (!action || !key) return { state: next, report };

    const excluded = new Set((options.excludeNames || []).map(normalizeName).filter(Boolean));
    const maxNpcs = Math.max(1, Math.min(100, Number(options.maxNpcs) || 40));
    const turn = Number(options.turn ?? state?.turn ?? 0);
    const targetNpcId = cleanText(command?.npcId, 160);
    const existingIndex = targetNpcId
        ? next.npcs.findIndex(npc => String(npc?.id || '') === targetNpcId)
        : next.npcs.findIndex(npc => npcMatchesLabel(npc, name));

    if (action === 'remove') {
        const labels = new Set([key]);
        if (existingIndex >= 0) {
            const npc = next.npcs[existingIndex];
            for (const label of [npc.name, ...(npc.aliases || [])]) {
                const normalized = normalizeName(label);
                if (normalized) labels.add(normalized);
            }
            report.npcId = npc.id;
            report.name = npc.name;
            report.status = 'removed';
            next.npcs.splice(existingIndex, 1);
        } else {
            report.status = 'suppressed';
        }
        next.candidates = next.candidates.filter(candidate => !candidateRecordMatches(candidate, { name, aliases: [] }));
        next.dismissed = [...new Set([...next.dismissed.map(normalizeName).filter(Boolean), ...labels])];
        return { state: next, report };
    }

    if (excluded.has(key)) {
        report.status = 'excluded';
        return { state: next, report };
    }
    next.dismissed = next.dismissed.filter(label => normalizeName(label) !== key);
    const promotedCandidate = next.candidates.find(candidate => candidateRecordMatches(candidate, { name, aliases: [] })) || null;
    next.candidates = next.candidates.filter(candidate => !candidateRecordMatches(candidate, { name, aliases: [] }));
    if (existingIndex >= 0) {
        let npc = next.npcs[existingIndex];
        const wasArchived = Boolean(npc.archived);
        if (wasArchived) {
            npc = setNpcArchived(npc, false);
            next.npcs[existingIndex] = npc;
        }
        if (promotedCandidate) {
            npc.aliases = cleanList([...(npc.aliases || []), promotedCandidate.name, ...(promotedCandidate.aliases || [])], 8, 120)
                .filter(alias => normalizeName(alias) !== normalizeName(npc.name));
            if (!npc.role && promotedCandidate.role) npc.role = promotedCandidate.role;
            if (!npc.location && promotedCandidate.location) npc.location = promotedCandidate.location;
        }
        npc.manual = true;
        npc.lastSeenTurn = Math.max(Number(npc.lastSeenTurn || 0), turn);
        npc.updatedAt = Date.now();
        report.npcId = npc.id;
        report.name = npc.name;
        report.status = wasArchived ? 'restored' : 'exists';
        return { state: next, report };
    }
    if (next.npcs.filter(npc => !npc?.archived).length >= maxNpcs) {
        report.status = 'full';
        return { state: next, report };
    }
    const record = createNpcRecord(name, next.npcs.map(n => n.id), options.relationshipBaseline || DEFAULT_RELATIONSHIP);
    if (promotedCandidate) {
        record.aliases = cleanList([promotedCandidate.name, ...(promotedCandidate.aliases || [])], 8, 120)
            .filter(alias => normalizeName(alias) !== normalizeName(record.name));
        record.role = promotedCandidate.role || '';
        record.location = promotedCandidate.location || '';
        record.importance = promotedCandidate.importance || 0;
    }
    record.lastSeenTurn = turn;
    record.manual = true;
    next.npcs.push(record);
    report.npcId = record.id;
    report.name = record.name;
    report.status = 'added';
    return { state: next, report };
}

function stripTrailingJsonCommas(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; out += ch; continue; }
        if (ch === ',') {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j])) j += 1;
            if (text[j] === '}' || text[j] === ']') continue;
        }
        out += ch;
    }
    return out;
}

function quoteBareJsonKeys(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    let expectingKey = false;
    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (inString) {
            out += ch;
            i += 1;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; out += ch; i += 1; expectingKey = false; continue; }
        if (ch === '{' || ch === ',') {
            out += ch; i += 1; expectingKey = true; continue;
        }
        if (expectingKey && /\s/.test(ch)) { out += ch; i += 1; continue; }
        if (expectingKey && /[A-Za-z_$]/.test(ch)) {
            let j = i + 1;
            while (j < text.length && /[A-Za-z0-9_$-]/.test(text[j])) j += 1;
            let k = j;
            while (k < text.length && /\s/.test(text[k])) k += 1;
            if (text[k] === ':') {
                out += `"${text.slice(i, j)}"`;
                i = j;
                expectingKey = false;
                continue;
            }
        }
        if (!/\s/.test(ch)) expectingKey = false;
        out += ch; i += 1;
    }
    return out;
}

function repairScannerJsonText(text) {
    return quoteBareJsonKeys(stripTrailingJsonCommas(text));
}

function jsonParseErrorPosition(error) {
    const match = String(error?.message || '').match(/position\s+(\d+)/i);
    return match ? Number(match[1]) : -1;
}

function isInsideJsonStringAt(text, index) {
    let inString = false;
    let escaped = false;
    for (let i = 0; i < index && i < text.length; i += 1) {
        const ch = text[i];
        if (!inString) {
            if (ch === '"') inString = true;
            continue;
        }
        if (escaped) {
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (ch === '"') {
            inString = false;
        }
    }
    return inString;
}

function repairMissingJsonSeparator(text, error) {
    const message = String(error?.message || '');
    const arraySeparator = /expected ',' or '\]' after array element/i.test(message);
    const objectSeparator = /expected ',' or '\}' after property value/i.test(message);
    if (!arraySeparator && !objectSeparator) return text;

    let position = jsonParseErrorPosition(error);
    if (!Number.isInteger(position) || position < 0 || position > text.length) return text;
    while (position < text.length && /\s/.test(text[position])) position += 1;
    if (position >= text.length || isInsideJsonStringAt(text, position)) return text;

    let previous = position - 1;
    while (previous >= 0 && /\s/.test(text[previous])) previous -= 1;
    if (previous < 0) return text;

    const previousChar = text[previous];
    const nextChar = text[position];
    const canEndValue = /["}\]0-9el]/i.test(previousChar);
    const canStartArrayValue = /["{\[0-9tfn-]/i.test(nextChar);
    const canStartObjectKey = nextChar === '"';
    if (!canEndValue) return text;
    if (arraySeparator && !canStartArrayValue) return text;
    if (objectSeparator && !canStartObjectKey) return text;

    return `${text.slice(0, position)},${text.slice(position)}`;
}

function parseWithScannerRepairs(text, firstError) {
    let candidate = repairScannerJsonText(text);
    let lastError = firstError;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            return JSON.parse(candidate);
        } catch (error) {
            lastError = error;
            const repaired = repairMissingJsonSeparator(candidate, error);
            if (repaired === candidate) break;
            candidate = repaired;
        }
    }
    const error = new Error(`Scanner returned malformed JSON: ${lastError.message}`);
    error.cause = firstError;
    throw error;
}

export function parseScanJson(raw) {
    if (raw && typeof raw === 'object') return raw;
    let text = String(raw ?? '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) text = text.slice(first, last + 1);

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (firstError) {
        parsed = parseWithScannerRepairs(text, firstError);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Scanner response is not a JSON object.');
    }
    if (!Array.isArray(parsed.npcs)) parsed.npcs = [];
    return parsed;
}

function cleanText(value, max = 1200) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(value, maxItems = 8, maxChars = 240) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        const cleaned = cleanText(item, maxChars);
        const key = normalizeName(cleaned);
        if (!cleaned || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(cleaned);
        if (out.length >= maxItems) break;
    }
    return out;
}

const DURABLE_REFINEMENT_STOPWORDS = new Set([
    'and', 'the', 'with', 'that', 'this', 'their', 'they', 'them', 'when', 'while', 'from', 'into', 'over', 'under',
    'very', 'more', 'less', 'than', 'then', 'but', 'for', 'her', 'his', 'its', 'she', 'him', 'who', 'has', 'have', 'had',
    'uses', 'use', 'often', 'usually', 'still', 'also', 'only', 'toward', 'towards', 'around', 'becomes', 'become', 'being',
    'a', 'an', 'of', 'to', 'in', 'on', 'at', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'by', 'or', 'it', 'he',
]);

const DURABLE_CONCEPT_ALIASES = Object.freeze({
    telepathy: 'telepath', telepathic: 'telepath', telepathically: 'telepath',
    connection: 'link', connections: 'link', connected: 'link', channel: 'link', channels: 'link', linked: 'link',
    thoughts: 'mind', thought: 'mind', minds: 'mind', mental: 'mind',
    siblings: 'sibling', sisters: 'sister', brothers: 'brother',
    courteous: 'courtesy', courteously: 'courtesy', politeness: 'polite', politely: 'polite',
    kindness: 'kind', kindhearted: 'kind', compassionate: 'compassion', compassion: 'compassion',
    reserved: 'reserve', restraint: 'restrain', restrained: 'restrain',
    gentleness: 'gentle', gently: 'gentle', motherly: 'maternal',
    speaks: 'speak', speaking: 'speak', spoken: 'speak', says: 'say', saying: 'say',
    gestures: 'gesture', gesturing: 'gesture', movements: 'movement',
    bonded: 'bond', bonding: 'bond', bonds: 'bond',
});

function durableConceptToken(token) {
    let word = String(token || '').toLowerCase();
    if (!word) return '';
    if (DURABLE_CONCEPT_ALIASES[word]) return DURABLE_CONCEPT_ALIASES[word];
    if (word.length > 5 && word.endsWith('ies')) word = `${word.slice(0, -3)}y`;
    else if (word.length > 6 && word.endsWith('ing')) word = word.slice(0, -3);
    else if (word.length > 5 && word.endsWith('ed')) word = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith('es')) word = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith('s')) word = word.slice(0, -1);
    return DURABLE_CONCEPT_ALIASES[word] || word;
}

function durableRefinementTokens(value) {
    return normalizeName(value).split(/\s+/)
        .filter(token => (token.length >= 2 || /^\d+$/.test(token)) && !DURABLE_REFINEMENT_STOPWORDS.has(token))
        .map(durableConceptToken)
        .filter(token => (token.length >= 2 || /^\d+$/.test(token)) && !DURABLE_REFINEMENT_STOPWORDS.has(token));
}

function durableTokenCoverage(existing, incoming) {
    const oldTokens = [...new Set(durableRefinementTokens(existing))];
    if (!oldTokens.length) return 0;
    const newTokens = new Set(durableRefinementTokens(incoming));
    return oldTokens.filter(token => newTokens.has(token)).length / oldTokens.length;
}

function durableSeedGrounded(value, context = '') {
    const source = String(context || '').trim();
    if (!source) return true; // structured import/API compatibility when no source narration is available.
    const proposed = [...new Set(durableRefinementTokens(value))]
        .filter(token => token.length >= 3 && !/^\d+$/.test(token));
    if (!proposed.length) return false;
    const sourceTokens = new Set(durableRefinementTokens(source));
    const overlap = proposed.filter(token => sourceTokens.has(token));
    // One distinctive directly stated concept is enough for a tiny field; larger summaries
    // need at least two grounded concepts so one observed act cannot mint a whole personality.
    const required = proposed.length <= 2 ? 1 : 2;
    return overlap.length >= required;
}

function durableEvidenceGroundsValue(value, evidenceItems = []) {
    const proposed = [...new Set(durableRefinementTokens(value))]
        .filter(token => token.length >= 3 && !/^\d+$/.test(token));
    if (!proposed.length) return false;
    const evidenceTokens = new Set(durableRefinementTokens((Array.isArray(evidenceItems) ? evidenceItems : []).join(' ')));
    const overlap = proposed.filter(token => evidenceTokens.has(token)).length;
    const required = proposed.length <= 2 ? proposed.length : Math.ceil(proposed.length * 0.6);
    return overlap >= required;
}

function durableSemanticSimilarity(a, b) {
    const left = new Set(durableRefinementTokens(a));
    const right = new Set(durableRefinementTokens(b));
    if (!left.size || !right.size) return normalizeName(a) === normalizeName(b) ? 1 : 0;
    if (Math.min(left.size, right.size) < 2) return normalizeName(a) === normalizeName(b) ? 1 : 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap += 1;
    const containment = overlap / Math.min(left.size, right.size);
    const jaccard = overlap / (left.size + right.size - overlap);
    const conceptCluster = overlap >= 3 && containment >= 0.4 ? 0.62 : 0;
    return Math.max(jaccard, containment * 0.86, conceptCluster);
}

function chooseCompactEquivalent(existing, incoming) {
    const oldText = cleanText(existing, 1200);
    const newText = cleanText(incoming, 1200);
    if (!oldText) return newText;
    if (!newText) return oldText;
    const oldCount = new Set(durableRefinementTokens(oldText)).size;
    const newCount = new Set(durableRefinementTokens(newText)).size;
    if (newCount >= oldCount + 2) return newText;
    if (oldCount >= newCount + 2) return oldText;
    return newText.length <= oldText.length * 1.15 ? newText : oldText;
}

function splitDurableClauses(value) {
    const source = String(value ?? '')
        .replace(/\r/g, '\n')
        .replace(/[•●▪◦]+/g, ';')
        .replace(/\s+[·]\s+/g, '; ');
    return source.split(/\n+|\s*;\s*|(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map(part => cleanText(part, 520))
        .filter(Boolean);
}

function semanticDedupeItems(items, { maxItems = 8, maxChars = 320, similarity = 0.62 } = {}) {
    const out = [];
    for (const raw of Array.isArray(items) ? items : []) {
        const item = cleanText(raw, maxChars);
        if (!item) continue;
        const exact = normalizeName(item);
        let match = out.findIndex(existing => normalizeName(existing) === exact || durableSemanticSimilarity(existing, item) >= similarity);
        if (match >= 0) out[match] = chooseCompactEquivalent(out[match], item);
        else out.push(item);
        if (out.length > maxItems * 2) out.splice(0, out.length - maxItems * 2);
    }
    return out.slice(-maxItems);
}

function compactDurableText(value, maxChars, maxClauses = 8) {
    let clauses = semanticDedupeItems(splitDurableClauses(value), {
        maxItems: 64, maxChars: Math.min(520, maxChars), similarity: 0.60,
    });
    if (clauses.length > maxClauses) {
        // Preserve both the established core and the newest distinct refinements when a
        // legacy append-only field has more concepts than the compact summary can carry.
        const headCount = Math.ceil(maxClauses / 2);
        clauses = [...clauses.slice(0, headCount), ...clauses.slice(-(maxClauses - headCount))];
    }
    if (!clauses.length) return '';
    const out = [];
    let used = 0;
    for (const clause of clauses) {
        const separator = out.length ? '; ' : '';
        const available = maxChars - used - separator.length;
        if (available <= 0) break;
        if (clause.length <= available) {
            out.push(clause);
            used += separator.length + clause.length;
            continue;
        }
        if (!out.length) out.push(cleanText(clause, maxChars));
        break;
    }
    return out.join('; ');
}

function identityMoralityMarkers(value) {
    const text = normalizeName(value);
    // Negated descriptors must not flip polarity merely because the keyword is present.
    // This is intentionally lexical and conservative: it protects common dossier wording
    // such as "kind-hearted and never cruel" without trying to solve general sentiment.
    const kindText = text
        .replace(/\b(?:not|never|hardly|rarely)\s+(?:kind|kindhearted|kind hearted|compassionate|empathetic|considerate|merciful|humane|gentle)\b/g, ' ')
        .replace(/\b(?:without|lacking)\s+(?:kindness|compassion|empathy|mercy|gentleness)\b/g, ' ');
    const cruelText = text
        .replace(/\b(?:not|never|hardly|rarely)\s+(?:cruel|sadistic|callous|merciless|inhumane)\b/g, ' ')
        .replace(/\b(?:without|avoids?|rejects?)\s+(?:cruelty|sadism|callousness)\b/g, ' ')
        .replace(/\b(?:no|zero)\s+(?:cruelty|sadism|callousness)\b/g, ' ');
    const kind = /\b(kind|kindhearted|kind hearted|compassionate|empathetic|considerate|merciful|humane|gentle)\b/.test(kindText)
        || /avoid(?:s|ing)? (?:needless|unnecessary) (?:harm|suffering|cruelty)/.test(text);
    const cruel = /\b(cruel|sadistic|callous|merciless|inhumane)\b/.test(cruelText)
        || /enjoy(?:s|ing)? (?:pain|suffering|cruelty)/.test(text)
        || /gratuitous (?:harm|suffering|cruelty)/.test(text);
    return { kind, cruel };
}

function identityMoralityConflict(existing, incoming) {
    const old = identityMoralityMarkers(existing);
    const next = identityMoralityMarkers(incoming);
    return (old.kind && next.cruel) || (old.cruel && next.kind);
}

function containsEvolutionLanguage(value) {
    const text = normalizeName(value);
    return /\b(no longer|formerly|used to|ceased|stopped being|replaced by|rather than|instead of|became|has become|have become|grown more|grown less|increasingly|decreasingly)\b/.test(text);
}

function isSafeIdentityTextRefinement(existing, incoming) {
    return !containsEvolutionLanguage(incoming)
        && !identityMoralityConflict(existing, incoming)
        && isSafeUnmarkedDurableRefinement(existing, incoming);
}

function isSafeSpeechRefinement(existing, incoming) {
    return !containsEvolutionLanguage(incoming) && isSafeUnmarkedDurableRefinement(existing, incoming);
}

function isSafeUnmarkedDurableRefinement(existing, incoming) {
    const oldText = compactDurableText(existing, DURABLE_PROFILE_LIMITS.appearance, 10);
    const newText = compactDurableText(incoming, DURABLE_PROFILE_LIMITS.appearance, 10);
    if (!oldText || !newText || normalizeName(oldText) === normalizeName(newText)) return false;
    const oldTokens = new Set(durableRefinementTokens(oldText));
    const newTokens = new Set(durableRefinementTokens(newText));
    const addsGroundedDetail = [...newTokens].some(token => !oldTokens.has(token));
    return addsGroundedDetail && (durableTokenCoverage(oldText, newText) >= 0.62 || durableSemanticSimilarity(oldText, newText) >= 0.58);
}

function mergeDurableTextRefinement(existing, incoming, maxChars) {
    const clauseCap = maxChars <= DURABLE_PROFILE_LIMITS.speech ? 5
        : (maxChars <= DURABLE_PROFILE_LIMITS.personality ? 6 : 10);
    const oldText = compactDurableText(existing, maxChars, clauseCap);
    const newText = compactDurableText(incoming, maxChars, clauseCap);
    if (!oldText) return newText;
    if (!newText || normalizeName(oldText) === normalizeName(newText)) return oldText;

    // Reconciliation is summary-based, never append-only. Prefer the scanner's current
    // compact field, then restore only established clauses it genuinely omitted.
    const incomingClauses = splitDurableClauses(newText);
    const oldClauses = splitDurableClauses(oldText);
    return compactDurableText([...incomingClauses, ...oldClauses].join('; '), maxChars, clauseCap);
}

function mannerismPatternFamily(value) {
    const text = normalizeName(value);
    if (!text) return '';
    const paperwork = /\b(?:paperwork|paper|parchment|contract|notice|notices|document|documents|quill|quills|stamp|stamps|seal|seals|inkpad)\b/.test(text);
    const emphaticHandling = /\b(?:thrust|thrusts|slap|slaps|flick|flicks|shove|shoves|push|pushes|hand|hands|gesture|gestures|brisk|briskly|snap|snaps)\b/.test(text);
    if (paperwork && emphaticHandling) return 'paperwork_handling';
    return '';
}

function generalizedMannerismForFamily(family) {
    if (family === 'paperwork_handling') return 'Handles paperwork with brisk, emphatic physical gestures.';
    return '';
}

function mannerismSimilarity(a, b) {
    const familyA = mannerismPatternFamily(a);
    const familyB = mannerismPatternFamily(b);
    if (familyA && familyA === familyB) return 0.95;
    return durableSemanticSimilarity(a, b);
}

function normalizeMannerisms(value) {
    const items = cleanList(value, 16, DURABLE_PROFILE_LIMITS.mannerism);
    const out = [];
    const familyCounts = new Map();
    for (const item of items) {
        const family = mannerismPatternFamily(item);
        if (family) familyCounts.set(family, Number(familyCounts.get(family) || 0) + 1);
        let bestIndex = -1;
        let bestScore = 0;
        for (let i = 0; i < out.length; i += 1) {
            const score = mannerismSimilarity(out[i], item);
            if (score > bestScore) { bestScore = score; bestIndex = i; }
        }
        if (bestIndex >= 0 && bestScore >= 0.55) {
            const existingFamily = mannerismPatternFamily(out[bestIndex]);
            if (family && existingFamily === family && Number(familyCounts.get(family) || 0) >= 2) {
                out[bestIndex] = generalizedMannerismForFamily(family) || chooseCompactEquivalent(out[bestIndex], item);
            } else {
                out[bestIndex] = chooseCompactEquivalent(out[bestIndex], item);
            }
        } else if (out.length < 4) {
            out.push(item);
        }
    }
    return out.slice(0, 4);
}

function hasRecurrenceMarker(value) {
    const text = normalizeName(value);
    return /\b(habitual|habitually|always|usually|consistently|routinely|regularly|repeatedly|whenever)\b/.test(text)
        || /\btends to\b/.test(text)
        || /\beach time\b/.test(text)
        || /\bevery time\b/.test(text);
}

function isExplicitRecurringMannerism(value, context = '') {
    const entry = cleanText(value, DURABLE_PROFILE_LIMITS.mannerism);
    const source = String(context || '').trim();
    if (!source) return hasRecurrenceMarker(entry);
    if (!hasRecurrenceMarker(source)) return false;
    const entryTokens = [...new Set(durableRefinementTokens(entry))];
    const sourceTokens = new Set(durableRefinementTokens(source));
    const overlap = entryTokens.filter(token => sourceTokens.has(token));
    return overlap.length >= Math.min(2, Math.max(1, entryTokens.length));
}

function filterSafeMannerismRefinements(existing, incoming, allowNewPattern = false, context = '') {
    const current = normalizeMannerisms(existing);
    return normalizeMannerisms(incoming).filter(entry => {
        const related = current.some(item => mannerismSimilarity(item, entry) >= 0.55);
        return related || allowNewPattern || isExplicitRecurringMannerism(entry, context);
    });
}

function mergeMannerismRefinements(existing, incoming) {
    const current = normalizeMannerisms(existing);
    const updates = normalizeMannerisms(incoming);
    for (const entry of updates) {
        let bestIndex = -1;
        let bestScore = 0;
        for (let i = 0; i < current.length; i++) {
            const score = mannerismSimilarity(current[i], entry);
            if (score > bestScore) { bestScore = score; bestIndex = i; }
        }
        if (bestIndex >= 0 && bestScore >= 0.55) {
            const family = mannerismPatternFamily(entry);
            current[bestIndex] = family && mannerismPatternFamily(current[bestIndex]) === family
                ? (generalizedMannerismForFamily(family) || chooseCompactEquivalent(current[bestIndex], entry))
                : chooseCompactEquivalent(current[bestIndex], entry);
        } else if (current.length < 4) current.push(entry);
    }
    return normalizeMannerisms(current);
}

function behaviorProfileKey(value) {
    const text = cleanText(value, DURABLE_PROFILE_LIMITS.behaviorProfile);
    if (!text) return '';
    const match = text.match(/^([\p{L}][\p{L}\p{N} _\-/]{1,36})\s*:/u);
    return normalizeName(match ? match[1] : text);
}

function behaviorProfileFamily(value) {
    const key = behaviorProfileKey(value);
    if (!key) return '';
    if (/^(?:disposition|kindness|empathy|morality|social baseline)$/.test(key)) return 'disposition';
    if (/cruelty|mercy|harm/.test(key)) return 'cruelty';
    if (/independence|agency|boundar/.test(key)) return 'independence';
    if (/^(?:care|affection|care style)$/.test(key)) return 'care';
    if (/express/.test(key)) return 'expressiveness';
    if (/conflict|anger|composure|restraint/.test(key)) return 'conflict';
    return '';
}

function behaviorProfileBody(value) {
    const text = cleanText(value, DURABLE_PROFILE_LIMITS.behaviorProfile);
    const index = text.indexOf(':');
    return index >= 0 ? cleanText(text.slice(index + 1), DURABLE_PROFILE_LIMITS.behaviorProfile) : text;
}

function behaviorProfileTargetSpecific(value) {
    const raw = cleanText(value, DURABLE_PROFILE_LIMITS.behaviorProfile);
    if (!raw) return true;
    const lower = raw.toLowerCase();
    if (/\b(?:with|toward|towards|around)\s+(?:the\s+)?(?:player|pc|\{\{user\}\})\b/.test(lower)) return true;
    if (/\b(?:when|while)\s+(?:alone|intimate)\s+(?:with|around)\b/.test(lower)) return true;
    if (/\b(?:during|after)\s+(?:private\s+)?intimacy\b/.test(lower)) return true;
    if (/\bprivate\s+intimacy\b/.test(lower)) return true;
    if (/\b(?:toward|towards|with|around|jealous of|possessive of)\s+[A-Z][\p{L}\p{M}'’.-]+(?:\s+[A-Z][\p{L}\p{M}'’.-]+)?\b/u.test(raw)) return true;
    if (/\b(?:this|that)\s+(?:incident|scene|night|argument|kiss|encounter)\b/.test(lower)) return true;
    return false;
}

const BEHAVIOR_FAMILY_LABEL = Object.freeze({
    disposition: 'Disposition', cruelty: 'Cruelty', independence: 'Independence', care: 'Care', expressiveness: 'Expressiveness', conflict: 'Conflict',
});

function mergeBehaviorFamilyEntries(existing, incoming, family) {
    const label = BEHAVIOR_FAMILY_LABEL[family] || cleanText(existing, 40).split(':')[0] || 'Behavior';
    const cleanBody = value => behaviorProfileBody(value).replace(/[.;:,]+\s*$/g, '').trim();
    const body = compactDurableText(`${cleanBody(existing)}; ${cleanBody(incoming)}`, Math.max(80, DURABLE_PROFILE_LIMITS.behaviorProfile - label.length - 2), 3)
        .replace(/\.\s*;/g, ';');
    return cleanText(`${label}: ${body}`, DURABLE_PROFILE_LIMITS.behaviorProfile);
}

function normalizeBehaviorProfile(value) {
    const items = cleanList(value, BEHAVIOR_PROFILE_LIMIT * 3, DURABLE_PROFILE_LIMITS.behaviorProfile)
        .filter(item => !behaviorProfileTargetSpecific(item));
    const out = [];
    for (const item of items) {
        const key = behaviorProfileKey(item);
        if (!key) continue;
        let index = out.findIndex(existing => behaviorProfileKey(existing) === key);
        if (index >= 0) {
            // Same labeled category is a current-summary replacement. Exact semantic
            // equivalents keep the established wording to avoid churn; real refinements use the newer rule.
            out[index] = normalizeName(out[index]) === normalizeName(item) ? out[index] : item;
            continue;
        }
        const family = behaviorProfileFamily(item);
        if (family) index = out.findIndex(existing => behaviorProfileFamily(existing) === family);
        if (index >= 0) out[index] = mergeBehaviorFamilyEntries(out[index], item, family);
        else out.push(item);
    }
    return out.slice(0, BEHAVIOR_PROFILE_LIMIT);
}

function groundedBehaviorProfile(value, personality = '', context = '', evidenceItems = []) {
    const source = String(context || '').trim();
    const evidence = Array.isArray(evidenceItems) ? evidenceItems : [];
    return normalizeBehaviorProfile(value).filter(entry => {
        if (behaviorProfileTargetSpecific(entry)) return false;
        if (!source) return true; // structured import/manual compatibility
        const body = behaviorProfileBody(entry);
        const identity = cleanText(personality, DURABLE_PROFILE_LIMITS.personality);
        const personalityGrounded = identity && (
            durableSemanticSimilarity(body, identity) >= 0.34
            || durableSemanticSimilarity(entry, identity) >= 0.34
        );
        return Boolean(personalityGrounded || durableSeedGrounded(body, source) || durableEvidenceGroundsValue(body, evidence));
    });
}

function behaviorProfilePriority(value) {
    const key = behaviorProfileKey(value);
    if (/^(disposition|kindness|empathy|morality|social baseline)$/.test(key)) return 0;
    if (/cruelty/.test(key)) return 1;
    if (/independence|agency|boundary/.test(key)) return 2;
    if (/care|affection/.test(key)) return 3;
    if (/express/.test(key)) return 4;
    if (/conflict/.test(key)) return 5;
    return 6;
}

function orderedBehaviorProfile(value) {
    return normalizeBehaviorProfile(value)
        .map((item, index) => ({ item, index, priority: behaviorProfilePriority(item) }))
        .sort((a, b) => a.priority - b.priority || a.index - b.index)
        .map(entry => entry.item);
}

function behaviorProfileMoralityRelevant(value) {
    const key = behaviorProfileKey(value);
    return /disposition|cruelty|empathy|kindness|morality|social baseline|care/.test(key);
}

function reconcileBehaviorProfileWithPersonality(profile, personality) {
    const markers = identityMoralityMarkers(personality);
    const personalityPolarity = markers.kind && !markers.cruel ? 1 : markers.cruel && !markers.kind ? -1 : 0;
    if (!personalityPolarity) return normalizeBehaviorProfile(profile);
    return normalizeBehaviorProfile(profile).filter(entry => {
        if (!behaviorProfileMoralityRelevant(entry)) return true;
        const polarity = moralityPolarity(entry);
        return !polarity || polarity === personalityPolarity;
    });
}

function moralityPolarity(value) {
    const { kind, cruel } = identityMoralityMarkers(behaviorProfileBody(value));
    return kind && !cruel ? 1 : cruel && !kind ? -1 : 0;
}

function isSafeBehaviorProfileRefinement(existing, incoming) {
    const oldText = cleanText(existing, DURABLE_PROFILE_LIMITS.behaviorProfile);
    const newText = cleanText(incoming, DURABLE_PROFILE_LIMITS.behaviorProfile);
    if (!oldText || !newText || behaviorProfileTargetSpecific(newText)) return false;
    const sameKey = behaviorProfileKey(oldText) === behaviorProfileKey(newText);
    const sameFamily = behaviorProfileFamily(oldText) && behaviorProfileFamily(oldText) === behaviorProfileFamily(newText);
    if (!sameKey && !sameFamily) return false;
    if (containsEvolutionLanguage(behaviorProfileBody(newText))) return false;
    if (behaviorProfileMoralityRelevant(oldText)) {
        const oldPolarity = moralityPolarity(oldText);
        const newPolarity = moralityPolarity(newText);
        if (oldPolarity && newPolarity && oldPolarity !== newPolarity) return false;
    }
    if (normalizeName(oldText) === normalizeName(newText)) return true;
    return isSafeUnmarkedDurableRefinement(oldText, newText)
        || durableSemanticSimilarity(behaviorProfileBody(oldText), behaviorProfileBody(newText)) >= 0.55;
}

function mergeBehaviorProfileRefinements(existing, incoming) {
    const current = normalizeBehaviorProfile(existing);
    for (const entry of normalizeBehaviorProfile(incoming)) {
        const key = behaviorProfileKey(entry);
        const family = behaviorProfileFamily(entry);
        let index = current.findIndex(item => behaviorProfileKey(item) === key);
        if (index < 0 && family) index = current.findIndex(item => behaviorProfileFamily(item) === family);
        if (index >= 0) {
            if (isSafeBehaviorProfileRefinement(current[index], entry)) {
                current[index] = family ? mergeBehaviorFamilyEntries(current[index], entry, family) : entry;
            }
        } else if (current.length < BEHAVIOR_PROFILE_LIMIT) {
            const incomingPolarity = behaviorProfileMoralityRelevant(entry) ? moralityPolarity(entry) : 0;
            const conflicts = incomingPolarity && current.some(item => {
                if (!behaviorProfileMoralityRelevant(item)) return false;
                const existingPolarity = moralityPolarity(item);
                return existingPolarity && existingPolarity !== incomingPolarity;
            });
            if (!conflicts) current.push(entry);
        }
    }
    return normalizeBehaviorProfile(current);
}

const PROFILE_EVIDENCE_FIELDS = Object.freeze(['personality', 'speech', 'appearance', 'mannerisms', 'behaviorProfile']);

function emptyProfileEvidence() {
    return { personality: [], speech: [], appearance: [], mannerisms: [], behaviorProfile: [] };
}

function normalizeProfileEvidence(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalize = list => semanticDedupeItems(cleanList(list, PROFILE_EVIDENCE_LIMIT * 2, DURABLE_PROFILE_LIMITS.evidence), {
        maxItems: PROFILE_EVIDENCE_LIMIT,
        maxChars: DURABLE_PROFILE_LIMITS.evidence,
        similarity: 0.56,
    });
    return {
        personality: normalize(source.personality),
        speech: normalize(source.speech),
        appearance: normalize(source.appearance),
        mannerisms: normalize(source.mannerisms),
        behaviorProfile: normalize(source.behaviorProfile ?? source.behavior_profile),
    };
}

function mergeRecentProfileEvidence(existing = [], incoming = []) {
    return semanticDedupeItems([
        ...cleanList(existing, PROFILE_EVIDENCE_LIMIT * 2, DURABLE_PROFILE_LIMITS.evidence),
        ...cleanList(incoming, PROFILE_EVIDENCE_LIMIT * 2, DURABLE_PROFILE_LIMITS.evidence),
    ], {
        maxItems: PROFILE_EVIDENCE_LIMIT,
        maxChars: DURABLE_PROFILE_LIMITS.evidence,
        similarity: 0.56,
    });
}

function mergeProfileEvidence(existing = {}, incoming = {}) {
    const before = normalizeProfileEvidence(existing);
    const added = normalizeProfileEvidence(incoming);
    return Object.fromEntries(PROFILE_EVIDENCE_FIELDS.map(field => [
        field, mergeRecentProfileEvidence(before[field], added[field]),
    ]));
}

function profileEvidenceCount(value = {}) {
    const normalized = normalizeProfileEvidence(value);
    return PROFILE_EVIDENCE_FIELDS.reduce((sum, field) => sum + normalized[field].length, 0);
}

function profileEvidenceConcept(value) {
    const text = cleanText(value, DURABLE_PROFILE_LIMITS.evidence);
    const match = text.match(/^([\p{L}\p{N}][\p{L}\p{N} _\-/]{1,48})\s*:\s*(.+)$/u);
    return match ? normalizeName(match[1]) : '';
}

function profileEvidenceRelated(a, b) {
    const aTag = profileEvidenceConcept(a);
    const bTag = profileEvidenceConcept(b);
    if (aTag && bTag) return aTag === bTag || durableSemanticSimilarity(aTag, bTag) >= 0.72;
    return durableSemanticSimilarity(a, b) >= 0.48;
}

function newProfileEvidence(prior = [], incoming = []) {
    const before = cleanList(prior, PROFILE_EVIDENCE_LIMIT * 2, DURABLE_PROFILE_LIMITS.evidence);
    return cleanList(incoming, PROFILE_EVIDENCE_LIMIT * 2, DURABLE_PROFILE_LIMITS.evidence).filter(item =>
        !before.some(old => normalizeName(old) === normalizeName(item) || durableSemanticSimilarity(old, item) >= 0.56));
}

function gradualProfileEvolutionReady(field, beforeEvidence, incomingEvidence) {
    const prior = beforeEvidence[field] || [];
    const fresh = newProfileEvidence(prior, incomingEvidence[field] || []);
    if (!prior.length || !fresh.length) return false;
    return fresh.some(now => prior.some(old => profileEvidenceRelated(old, now)));
}

function compactKeyRelationshipEntry(value) {
    const text = cleanText(value, DURABLE_PROFILE_LIMITS.keyRelationship);
    if (!text) return '';
    const match = text.match(/^(.+?)(?:\s+[—–-]\s+|\s*\|\s*|\s*:\s+)([\s\S]*)$/);
    if (!match) return compactDurableText(text, DURABLE_PROFILE_LIMITS.keyRelationship, 3);
    const subject = cleanText(match[1], 120);
    let rest = compactDurableText(match[2], Math.max(80, DURABLE_PROFILE_LIMITS.keyRelationship - subject.length - 3), 3);
    const ambiguousDeath = /\s*\((?:deceased|dead)\)\.?\s*$/i.test(rest);
    if (ambiguousDeath) {
        rest = rest.replace(/\s*\((?:deceased|dead)\)\.?\s*$/i, '').trim();
        if (/^widow\b/i.test(rest)) rest = rest.replace(/^widow\b/i, 'Surviving widow');
        else if (/^widower\b/i.test(rest)) rest = rest.replace(/^widower\b/i, 'Surviving widower');
        else rest = cleanText(`${rest}; deceased`, Math.max(80, DURABLE_PROFILE_LIMITS.keyRelationship - subject.length - 3));
    }
    return cleanText(`${subject} — ${rest}`, DURABLE_PROFILE_LIMITS.keyRelationship);
}

function keyRelationshipSubject(value) {
    const text = compactKeyRelationshipEntry(value);
    if (!text) return '';
    const match = text.match(/^(.+?)(?:\s+[—–-]\s+|\s*\|\s*|\s*:\s+)/);
    const head = cleanText(match ? match[1] : text, 160);
    return normalizeName(head);
}

function keyRelationshipSubjectsEquivalent(a, b) {
    const left = keyRelationshipSubject(a);
    const right = keyRelationshipSubject(b);
    if (!left || !right) return false;
    if (left === right) return true;
    const leftTokens = left.split(/\s+/).filter(Boolean);
    const rightTokens = right.split(/\s+/).filter(Boolean);
    if (Math.min(leftTokens.length, rightTokens.length) < 1) return false;
    const short = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const long = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
    return short.length >= 1 && short.every(token => long.includes(token)) && short.join(' ').length >= 4;
}

function mergeKeyRelationshipUpdates(existing, incoming) {
    const current = cleanList(existing, KEY_RELATIONSHIP_LIMIT * 2, DURABLE_PROFILE_LIMITS.keyRelationship)
        .map(compactKeyRelationshipEntry).filter(Boolean).slice(0, KEY_RELATIONSHIP_LIMIT);
    const updates = cleanList(incoming, KEY_RELATIONSHIP_LIMIT * 2, DURABLE_PROFILE_LIMITS.keyRelationship)
        .map(compactKeyRelationshipEntry).filter(Boolean);
    for (const entry of updates) {
        const exact = normalizeName(entry);
        let index = current.findIndex(item => keyRelationshipSubjectsEquivalent(item, entry));
        if (index < 0 && exact) index = current.findIndex(item => normalizeName(item) === exact);
        if (index >= 0) current[index] = entry;
        else if (current.length < KEY_RELATIONSHIP_LIMIT) current.push(entry);
    }
    return current.slice(0, KEY_RELATIONSHIP_LIMIT);
}


function normalizeKeyRelationshipEdge(raw = {}) {
    const aId = cleanText(raw.aId ?? raw.a_id ?? raw.fromId ?? raw.from_id ?? raw.sourceId ?? raw.source_id, 100);
    const bId = cleanText(raw.bId ?? raw.b_id ?? raw.toId ?? raw.to_id ?? raw.targetId ?? raw.target_id, 100);
    const a = cleanText(raw.a ?? raw.from ?? raw.source ?? raw.personA ?? raw.person_a, 120);
    const b = cleanText(raw.b ?? raw.to ?? raw.target ?? raw.personB ?? raw.person_b, 120);
    const aToB = cleanText(raw.aToB ?? raw.a_to_b ?? raw.fromTo ?? raw.from_to ?? raw.relation ?? raw.relationship, 180);
    const bToA = cleanText(raw.bToA ?? raw.b_to_a ?? raw.toFrom ?? raw.to_from ?? raw.reverseRelation ?? raw.reverse_relation, 180);
    const aDynamic = cleanText(raw.aDynamic ?? raw.a_dynamic ?? raw.fromDynamic ?? raw.from_dynamic ?? raw.dynamic, 220);
    const bDynamic = cleanText(raw.bDynamic ?? raw.b_dynamic ?? raw.toDynamic ?? raw.to_dynamic, 220);
    const reason = cleanText(raw.reason ?? raw.evidence, 300);
    if ((!a && !aId) || (!b && !bId) || (!aToB && !bToA)) return null;
    return { aId, a, bId, b, aToB, bToA, aDynamic, bDynamic, reason };
}

export function normalizeKeyRelationshipEdges(scanResult = {}) {
    const raw = scanResult?.keyRelationshipEdges
        ?? scanResult?.key_relationship_edges
        ?? scanResult?.socialRelationships
        ?? scanResult?.social_relationships
        ?? [];
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
        const edge = normalizeKeyRelationshipEdge(item);
        if (!edge) continue;
        const key = [edge.aId || normalizeName(edge.a), edge.bId || normalizeName(edge.b), normalizeName(edge.aToB), normalizeName(edge.bToA)].join('|');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(edge);
        if (out.length >= 12) break;
    }
    return out;
}

function relationshipEdgeNpc(npcs, id, label) {
    const list = Array.isArray(npcs) ? npcs : [];
    const cleanId = cleanText(id, 100);
    if (cleanId) {
        const byId = list.find(npc => String(npc?.id || '') === cleanId);
        if (byId) return byId;
    }
    const key = normalizeName(label);
    if (!key) return null;
    return list.find(npc => [npc?.name, ...(npc?.aliases || [])].some(value => normalizeName(value) === key)) || null;
}

function relationshipEdgeEntry(counterpart, relation, dynamic = '') {
    const who = cleanText(counterpart, 120);
    const rel = cleanText(relation, 180);
    const current = cleanText(dynamic, 220);
    if (!who || !rel) return '';
    return `${who} — ${rel}${current ? ` | ${current}` : ''}`;
}

function applyKeyRelationshipEdges(next, scanResult, excludeNames, report) {
    const edges = normalizeKeyRelationshipEdges(scanResult);
    if (!edges.length) return;
    const excluded = excludeNames instanceof Set ? excludeNames : new Set();
    const applyOne = (owner, counterpart, relation, dynamic) => {
        if (!owner || !counterpart || !relation) return;
        if (excluded.has(normalizeName(counterpart))) return;
        if ((owner.manualProfileFields || []).includes('keyRelationships')) return;
        const entry = relationshipEdgeEntry(counterpart, relation, dynamic);
        if (!entry) return;
        const before = JSON.stringify(owner.keyRelationships || []);
        owner.keyRelationships = mergeKeyRelationshipUpdates(owner.keyRelationships, [entry]);
        if (JSON.stringify(owner.keyRelationships || []) !== before && !report.updated.includes(owner.id)) report.updated.push(owner.id);
    };
    for (const edge of edges) {
        const aNpc = relationshipEdgeNpc(next.npcs, edge.aId, edge.a);
        const bNpc = relationshipEdgeNpc(next.npcs, edge.bId, edge.b);
        const aName = cleanText(aNpc?.name || edge.a, 120);
        const bName = cleanText(bNpc?.name || edge.b, 120);
        if (aNpc && bName && edge.aToB) applyOne(aNpc, bName, edge.aToB, edge.aDynamic);
        if (bNpc && aName && edge.bToA) applyOne(bNpc, aName, edge.bToA, edge.bDynamic);
    }
}

function escapeRegexLiteral(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EXPLICIT_SOCIAL_RELATION = String.raw`(?:older\s+|younger\s+|elder\s+|adoptive\s+|biological\s+|step[- ]?|half[- ]?|former\s+|ex[- ]?|best\s+|close\s+|childhood\s+)?(?:sister|brother|sibling|mother|father|parent|daughter|son|child|wife|husband|spouse|fianc(?:e|ee|é|ée)|girlfriend|boyfriend|partner|lover|friend|rival|mentor|student|apprentice|prot(?:e|é)g(?:e|é)|teacher|guardian|ward|cousin|aunt|uncle|niece|nephew|grandmother|grandfather|grandparent)`;
const SYMMETRIC_SOCIAL_RELATIONS = new Set(['friend', 'best friend', 'close friend', 'childhood friend', 'rival', 'cousin', 'partner', 'lover', 'spouse', 'sibling', 'sister', 'brother']);

function inverseExplicitSocialRelation(relation) {
    const rel = cleanText(relation, 180).toLowerCase().replace(/\s+/g, ' ');
    if (!rel) return '';
    if (SYMMETRIC_SOCIAL_RELATIONS.has(rel)) return rel;
    if (/^(?:older|elder)\s+(?:sister|brother|sibling)$/.test(rel)) return 'younger sibling';
    if (/^younger\s+(?:sister|brother|sibling)$/.test(rel)) return 'older sibling';
    if (/^(?:mother|father|parent)$/.test(rel)) return 'child';
    if (/^(?:daughter|son|child)$/.test(rel)) return 'parent';
    if (/^(?:wife|husband|spouse)$/.test(rel)) return 'spouse';
    if (/^(?:girlfriend|boyfriend|partner|lover|fianc(?:e|ee|é|ée))$/.test(rel)) return 'partner';
    if (/^(?:mentor|teacher)$/.test(rel)) return 'student';
    if (/^(?:student|apprentice|prot(?:e|é)g(?:e|é))$/.test(rel)) return 'mentor';
    if (rel === 'guardian') return 'ward';
    if (rel === 'ward') return 'guardian';
    if (/^(?:aunt|uncle)$/.test(rel)) return 'niece/nephew';
    if (/^(?:niece|nephew)$/.test(rel)) return 'aunt/uncle';
    if (/^(?:grandmother|grandfather|grandparent)$/.test(rel)) return 'grandchild';
    return '';
}

export function extractExplicitKeyRelationshipEdges(transcript, existingNpcs = [], excludeNames = []) {
    const text = String(transcript || '').replace(/[\r\n]+/g, ' ');
    if (!text.trim()) return [];
    const excluded = new Set((excludeNames || []).map(normalizeName).filter(Boolean));
    const proper = String.raw`([\p{Lu}][\p{L}\p{M}'’.-]*(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]*){0,2})`;
    const out = [];
    const seen = new Set();
    const push = (owner, counterpart, relation) => {
        const ownerNpc = relationshipEdgeNpc(existingNpcs, owner?.id, owner?.name);
        const ownerName = cleanText(ownerNpc?.name || owner?.name, 120);
        const other = cleanText(counterpart, 120).replace(/^["'“”‘’]+|["'“”‘’.,;:!?]+$/g, '');
        const rel = cleanText(relation, 180).toLowerCase();
        if (!ownerNpc || !ownerName || !other || !rel) return;
        if (normalizeName(other) === normalizeName(ownerName) || excluded.has(normalizeName(other))) return;
        const otherNpc = relationshipEdgeNpc(existingNpcs, '', other);
        const canonicalOther = cleanText(otherNpc?.name || other, 120);
        const inverse = inverseExplicitSocialRelation(rel);
        const key = `${ownerNpc.id}|${normalizeName(canonicalOther)}|${normalizeName(rel)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
            aId: ownerNpc.id,
            a: ownerName,
            bId: otherNpc?.id || '',
            b: canonicalOther,
            aToB: rel,
            bToA: otherNpc ? inverse : '',
            reason: 'explicit relationship statement in current exchange',
        });
    };
    for (const npc of Array.isArray(existingNpcs) ? existingNpcs : []) {
        const labels = [npc?.name, ...(npc?.aliases || [])].map(value => cleanText(value, 120)).filter(Boolean).slice(0, 6);
        for (const label of labels) {
            const owner = escapeRegexLiteral(label);
            const possessive = `${owner}(?:['’]s|['’])`;
            const patterns = [
                new RegExp(`${proper}\\s+(?:is|was|remains)\\s+${possessive}\\s+(${EXPLICIT_SOCIAL_RELATION})\\b`, 'giu'),
                new RegExp(`${proper}\\s*,\\s*${possessive}\\s+(${EXPLICIT_SOCIAL_RELATION})\\b`, 'giu'),
                new RegExp(`${possessive}\\s+(${EXPLICIT_SOCIAL_RELATION})\\s+(?:is|was|remains)\\s+${proper}`, 'giu'),
            ];
            for (let pi = 0; pi < patterns.length; pi += 1) {
                for (const match of text.matchAll(patterns[pi])) {
                    if (pi < 2) push(npc, match[1], match[2]);
                    else push(npc, match[2], match[1]);
                }
            }
            const symmetric = new RegExp(`${owner}\\s+and\\s+${proper}\\s+(?:are|were|remain)\\s+((?:best\\s+|close\\s+|childhood\\s+)?friends?|rivals?|siblings?|sisters?|brothers?|partners?|lovers?|cousins?)\\b`, 'giu');
            for (const match of text.matchAll(symmetric)) {
                let rel = cleanText(match[2], 120).toLowerCase();
                rel = rel.replace(/friends$/, 'friend').replace(/rivals$/, 'rival').replace(/siblings$/, 'sibling').replace(/sisters$/, 'sister').replace(/brothers$/, 'brother').replace(/partners$/, 'partner').replace(/lovers$/, 'lover').replace(/cousins$/, 'cousin');
                push(npc, match[1], rel);
            }
        }
    }
    return out.slice(0, 12);
}

function normalizeStoredMemories(value) {
    const cleaned = semanticDedupeItems(cleanList(value, 64, DURABLE_PROFILE_LIMITS.memory), {
        maxItems: 64,
        maxChars: DURABLE_PROFILE_LIMITS.memory,
        similarity: 0.58,
    });
    if (cleaned.length <= IMPORTANT_MEMORY_LIMIT) return cleaned;
    // Legacy records do not carry per-memory significance. After semantic dedupe,
    // recency is the safest deterministic tiebreaker until a future scan curates them.
    return cleaned.slice(-IMPORTANT_MEMORY_LIMIT);
}

export function normalizeScanNpc(raw = {}) {
    const relationshipDeltaProvided = Object.prototype.hasOwnProperty.call(raw, 'relationshipDelta')
        || Object.prototype.hasOwnProperty.call(raw, 'relationship_delta');
    const proposedDelta = raw.relationshipDelta ?? raw.relationship_delta ?? {};
    const relationshipDelta = normalizeRelationshipDelta(proposedDelta);
    const hasRelationshipDelta = RELATIONSHIP_KEYS.some(key => relationshipDelta[key] !== 0);
    // Compatibility recovery for models that ignore the compact delta contract and
    // return absolute scores under `relationship`. The merge layer converts only
    // explicitly supplied axes back into deltas relative to the stored scores.
    const relationshipAbsolutePatch = normalizeRelationshipAbsolutePatch(raw.relationship);
    const ageFields = normalizeAgeFields(raw);
    const npc = {
        id: cleanText(raw.id, 100),
        name: cleanText(raw.name, 120),
        aliases: cleanList(raw.aliases, 8, 120),
        role: cleanText(raw.role, 300),
        species: cleanText(raw.species ?? raw.race ?? raw.ancestry ?? raw.speciesRace ?? raw.species_race, 160),
        age: ageFields.age,
        ageState: (() => {
            const state = String(raw.ageState ?? raw.age_state ?? '').trim().toLowerCase();
            return state === 'advance' || state === 'correct' ? state : 'keep';
        })(),
        ageReason: cleanText(raw.ageReason ?? raw.age_reason, 500),
        apparentAge: ageFields.apparentAge,
        apparentAgeState: (() => {
            const state = String(raw.apparentAgeState ?? raw.apparent_age_state ?? '').trim().toLowerCase();
            return state === 'evolve' || state === 'change' ? 'evolve' : 'keep';
        })(),
        apparentAgeReason: cleanText(raw.apparentAgeReason ?? raw.apparent_age_reason, 500),
        appearance: normalizeAppearanceCanon(raw.appearance),
        appearanceState: (() => {
            const state = String(raw.appearanceState ?? raw.appearance_state ?? '').trim().toLowerCase();
            if (state === 'change' || state === 'evolve') return 'change';
            if (['refine', 'update', 'learn', 'establish'].includes(state)) return 'refine';
            return 'keep';
        })(),
        appearanceReason: cleanText(raw.appearanceReason ?? raw.appearance_reason, 500),
        personality: compactDurableText(raw.personality, DURABLE_PROFILE_LIMITS.personality, 6),
        personalityState: (() => {
            const state = String(raw.personalityState ?? raw.personality_state ?? (normalizeBoolean(raw.evolvePersonality ?? raw.evolve_personality) ? 'evolve' : '')).trim().toLowerCase();
            if (state === 'evolve' || state === 'change') return 'evolve';
            if (['refine', 'update', 'learn', 'establish'].includes(state)) return 'refine';
            return 'keep';
        })(),
        personalityReason: cleanText(raw.personalityReason ?? raw.personality_reason, 500),
        speech: compactDurableText(raw.speech, DURABLE_PROFILE_LIMITS.speech, 5),
        speechState: (() => {
            const state = String(raw.speechState ?? raw.speech_state ?? (normalizeBoolean(raw.evolveSpeech ?? raw.evolve_speech) ? 'evolve' : '')).trim().toLowerCase();
            if (state === 'evolve' || state === 'change') return 'evolve';
            if (['refine', 'update', 'learn', 'establish'].includes(state)) return 'refine';
            return 'keep';
        })(),
        speechReason: cleanText(raw.speechReason ?? raw.speech_reason, 500),
        background: compactDurableText(raw.background, DURABLE_PROFILE_LIMITS.background, 8),
        keyRelationships: mergeKeyRelationshipUpdates([], raw.keyRelationships ?? raw.key_relationships ?? raw.innerCircle ?? raw.inner_circle ?? raw.family),
        keyRelationshipsProvided: Object.prototype.hasOwnProperty.call(raw, 'keyRelationships') || Object.prototype.hasOwnProperty.call(raw, 'key_relationships') || Object.prototype.hasOwnProperty.call(raw, 'innerCircle') || Object.prototype.hasOwnProperty.call(raw, 'inner_circle') || Object.prototype.hasOwnProperty.call(raw, 'family'),
        keyRelationshipsState: (() => {
            const state = String(raw.keyRelationshipsState ?? raw.key_relationships_state ?? raw.innerCircleState ?? raw.inner_circle_state ?? (normalizeBoolean(raw.evolveKeyRelationships ?? raw.evolve_key_relationships) ? 'evolve' : '')).trim().toLowerCase();
            if (state === 'evolve' || state === 'change') return 'evolve';
            if (['update', 'refine', 'learn', 'establish'].includes(state)) return 'update';
            return 'keep';
        })(),
        keyRelationshipsReason: cleanText(raw.keyRelationshipsReason ?? raw.key_relationships_reason ?? raw.innerCircleReason ?? raw.inner_circle_reason, 500),
        relationshipSummary: compactDurableText(raw.relationshipSummary, DURABLE_PROFILE_LIMITS.relationshipSummary, 6),
        mood: cleanText(raw.mood, 300),
        moodState: String(raw.moodState ?? raw.mood_state ?? (normalizeBoolean(raw.clearMood ?? raw.clear_mood) ? 'clear' : '')).trim().toLowerCase() === 'clear' ? 'clear' : '',
        location: cleanText(raw.location, 300),
        locationState: String(raw.locationState ?? raw.location_state ?? (normalizeBoolean(raw.clearLocation ?? raw.clear_location) ? 'clear' : '')).trim().toLowerCase() === 'clear' ? 'clear' : '',
        goal: cleanText(raw.goal, 500),
        goalState: String(raw.goalState ?? raw.goal_state ?? (normalizeBoolean(raw.clearGoal ?? raw.clear_goal) ? 'clear' : '')).trim().toLowerCase() === 'clear' ? 'clear' : '',
        status: cleanText(raw.status, 500),
        statusState: String(raw.statusState ?? raw.status_state ?? (normalizeBoolean(raw.clearStatus ?? raw.clear_status) ? 'clear' : '')).trim().toLowerCase() === 'clear' ? 'clear' : '',
        memories: semanticDedupeItems(cleanList(raw.memories, 6, DURABLE_PROFILE_LIMITS.memory), { maxItems: 3, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58 }),
        memoryRetention: semanticDedupeItems(cleanList(raw.memoryRetention ?? raw.memory_retention, IMPORTANT_MEMORY_LIMIT * 2, DURABLE_PROFILE_LIMITS.memory), { maxItems: IMPORTANT_MEMORY_LIMIT, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58 }),
        mannerisms: normalizeMannerisms(raw.mannerisms),
        mannerismsProvided: Object.prototype.hasOwnProperty.call(raw, 'mannerisms'),
        mannerismState: (() => {
            const state = String(raw.mannerismState ?? raw.mannerism_state ?? (normalizeBoolean(raw.evolveMannerisms ?? raw.evolve_mannerisms) ? 'evolve' : '')).trim().toLowerCase();
            if (state === 'evolve' || state === 'change') return 'evolve';
            if (['refine', 'update', 'learn', 'establish'].includes(state)) return 'refine';
            return 'keep';
        })(),
        mannerismReason: cleanText(raw.mannerismReason ?? raw.mannerism_reason, 500),
        behaviorProfile: normalizeBehaviorProfile(raw.behaviorProfile ?? raw.behavior_profile ?? raw.behaviorBreakdown ?? raw.behavior_breakdown),
        behaviorProfileProvided: Object.prototype.hasOwnProperty.call(raw, 'behaviorProfile')
            || Object.prototype.hasOwnProperty.call(raw, 'behavior_profile')
            || Object.prototype.hasOwnProperty.call(raw, 'behaviorBreakdown')
            || Object.prototype.hasOwnProperty.call(raw, 'behavior_breakdown'),
        behaviorProfileState: (() => {
            const state = String(raw.behaviorProfileState ?? raw.behavior_profile_state ?? raw.behaviorBreakdownState ?? raw.behavior_breakdown_state ?? '').trim().toLowerCase();
            if (state === 'evolve' || state === 'change') return 'evolve';
            if (['refine', 'update', 'learn', 'establish'].includes(state)) return 'refine';
            return 'keep';
        })(),
        behaviorProfileReason: cleanText(raw.behaviorProfileReason ?? raw.behavior_profile_reason ?? raw.behaviorBreakdownReason ?? raw.behavior_breakdown_reason, 500),
        developmentScale: (() => {
            const scale = String(raw.developmentScale ?? raw.development_scale ?? '').trim().toLowerCase();
            return ['gradual', 'explicit', 'batch'].includes(scale) ? scale : '';
        })(),
        developmentReason: cleanText(raw.developmentReason ?? raw.development_reason, 500),
        present: normalizeBoolean(raw.present),
        worldActive: normalizeBoolean(raw.worldActive ?? raw.world_active ?? raw.activeOffscreen ?? raw.active_offscreen) && !normalizeBoolean(raw.present),
        lifeState: normalizeLifeState(raw.lifeState ?? raw.life_status ?? raw.lifeStatus),
        lifeStateCertainty: normalizeLifeStateCertainty(raw.lifeStateCertainty ?? raw.life_status_certainty ?? raw.lifeStatusCertainty),
        lifeStateReason: cleanText(raw.lifeStateReason ?? raw.lifeStatusReason, 500),
        importance: (() => { const number = Number(raw.importance); return raw.importance === undefined || raw.importance === null || raw.importance === '' || !Number.isFinite(number) ? null : clamp(number); })(),
        identityKind: inferNpcIdentityKind(raw.name, raw.identityKind ?? raw.identity_kind),
        dossierSignal: normalizeDossierSignal(raw.dossierSignal ?? raw.dossier_signal ?? raw.persistenceSignal ?? raw.persistence_signal),
        dossierReason: cleanText(raw.dossierReason ?? raw.dossier_reason, 360),
        sameIndividual: normalizeBoolean(raw.sameIndividual ?? raw.same_individual),
        sameIndividualProvided: Object.prototype.hasOwnProperty.call(raw, 'sameIndividual') || Object.prototype.hasOwnProperty.call(raw, 'same_individual'),
        directInteraction: normalizeBoolean(raw.directInteraction ?? raw.direct_interaction ?? raw.interactedDirectly ?? raw.interacted_directly),
        relationshipDelta,
        relationshipDeltaProvided,
        relationshipAbsolutePatch,
        relationshipImpact: normalizeScannerRelationshipImpact(raw.relationshipImpact ?? raw.impactLevel ?? raw.relationshipImpactLevel, hasRelationshipDelta),
        relationshipEvidence: normalizeRelationshipEvidence(raw.relationshipEvidence ?? raw.relationship_evidence),
        relationshipChangeReason: cleanText(raw.relationshipChangeReason ?? raw.relationshipReason, 500),
    };
    return npc;
}


export function normalizeNpcCandidate(raw = {}) {
    const name = cleanText(raw.name ?? raw.label, 120);
    if (!name) return null;
    return {
        id: cleanText(raw.id, 100) || `candidate_${slugify(name)}`,
        name,
        aliases: cleanList(raw.aliases, 6, 120),
        identityKind: inferNpcIdentityKind(name, raw.identityKind),
        dossierSignal: normalizeDossierSignal(raw.dossierSignal),
        dossierReason: cleanText(raw.dossierReason, 360),
        role: cleanText(raw.role, 180),
        location: cleanText(raw.location, 220),
        seenCount: Math.max(1, Math.min(99, Math.round(Number(raw.seenCount) || 1))),
        firstSeenTurn: Math.max(0, Math.round(Number(raw.firstSeenTurn) || 0)),
        lastSeenTurn: Math.max(0, Math.round(Number(raw.lastSeenTurn) || 0)),
        importance: clamp(raw.importance ?? 0),
    };
}

function candidateRecordMatches(candidate, incoming) {
    if (!candidate || !incoming) return false;
    const incomingNames = new Set([incoming.name, ...(incoming.aliases || [])].map(normalizeName).filter(Boolean));
    return [candidate.name, ...(candidate.aliases || [])].map(normalizeName).filter(Boolean).some(name => incomingNames.has(name));
}

function makeNpcCandidate(incoming, turn, existingIds = []) {
    const base = `candidate_${slugify(incoming.name)}`;
    let id = base;
    let suffix = 2;
    while (existingIds.includes(id)) id = `${base}_${suffix++}`;
    return {
        id,
        name: incoming.name,
        aliases: [...(incoming.aliases || [])].slice(0, 6),
        identityKind: incoming.identityKind || inferNpcIdentityKind(incoming.name),
        dossierSignal: incoming.dossierSignal || 'incidental',
        dossierReason: incoming.dossierReason || '',
        role: cleanText(incoming.role, 180),
        location: cleanText(incoming.location, 220),
        seenCount: 1,
        firstSeenTurn: turn,
        lastSeenTurn: turn,
        importance: clamp(incoming.importance ?? 0),
    };
}

function shouldCreateDossierImmediately(incoming, admissionMode = 'conservative') {
    const mode = normalizeNpcAdmissionMode(admissionMode);
    if (mode === 'manual_only') return false;
    if (incoming.identityKind === 'proper_name') return true;
    if (mode === 'balanced' && (incoming.dossierSignal === 'meaningful' || incoming.dossierSignal === 'persistent' || incoming.directInteraction)) return true;
    // Conservative intentionally ignores model-assigned relevance for a first-seen role label.
    // Role NPCs must earn promotion through confirmed recurrence or an explicit manual/OOC add.
    return false;
}

function shouldPromoteCandidate(candidate, incoming, admissionMode = 'conservative') {
    const mode = normalizeNpcAdmissionMode(admissionMode);
    if (shouldCreateDossierImmediately(incoming, mode)) return true;
    if (mode === 'manual_only') return false;
    return Boolean(incoming.sameIndividual) && Number(candidate?.seenCount || 0) >= 2;
}

export function buildNpcPortraitPrompts(rawNpc = {}, options = {}) {
    const npc = rawNpc && typeof rawNpc === 'object' ? rawNpc : {};
    const format = normalizePortraitPromptFormat(options.format);
    const stylePositive = cleanText(options.stylePositive ?? DEFAULT_PORTRAIT_STYLE_POSITIVE, 1800);
    const styleNegative = cleanText(options.styleNegative ?? DEFAULT_PORTRAIT_STYLE_NEGATIVE, 1800);
    const composition = cleanText(options.composition ?? DEFAULT_PORTRAIT_COMPOSITION, 800);
    const useMood = options.useMood !== false;
    const useLocation = options.useLocation === true;
    const extraPositive = cleanText(npc.portraitPromptPositive ?? npc.portrait_prompt_positive, 1800);
    const extraNegative = cleanText(npc.portraitPromptNegative ?? npc.portrait_prompt_negative, 1800);
    const replaceAutomatic = Boolean(npc.portraitPromptReplace ?? npc.portrait_prompt_replace);

    const visualAge = cleanText(npc.apparentAge, 80) || cleanText(npc.age, 80);
    const species = cleanText(npc.species ?? npc.race, 160);
    const role = cleanText(npc.role, 240);
    const appearance = cleanText(npc.appearance, 1800);
    const mood = useMood ? cleanText(npc.mood, 240) : '';
    const location = useLocation ? cleanText(npc.location, 300) : '';

    const subjectTags = [
        species,
        visualAge ? `apparent age ${visualAge}` : '',
        role ? `role: ${role}` : '',
        appearance,
        mood ? `expression / bearing: ${mood}` : '',
        location ? `background / location: ${location}` : '',
    ].filter(Boolean);

    let positive = '';
    if (replaceAutomatic && extraPositive) {
        positive = extraPositive;
    } else if (format === 'natural') {
        const sentences = [];
        if (stylePositive) sentences.push(`Visual style: ${stylePositive}.`);
        if (species || visualAge || role) {
            const identity = [species, visualAge ? `appearing ${visualAge}` : '', role].filter(Boolean).join(', ');
            if (identity) sentences.push(`Subject: ${identity}.`);
        }
        if (appearance) sentences.push(`Appearance: ${appearance}.`);
        if (mood) sentences.push(`Expression and bearing: ${mood}.`);
        if (location) sentences.push(`Background: ${location}.`);
        if (composition) sentences.push(`Composition: ${composition}.`);
        if (extraPositive) sentences.push(`Additional character instructions: ${extraPositive}.`);
        positive = sentences.join(' ');
    } else {
        const parts = [stylePositive, ...subjectTags, composition, extraPositive].filter(Boolean);
        positive = parts.join(format === 'tags' ? ', ' : '; ');
    }

    const negative = [styleNegative, extraNegative].filter(Boolean).join(', ');
    return {
        positive: cleanText(positive, 6000),
        negative: cleanText(negative, 4000),
        format,
        replaceAutomatic,
    };
}

export function normalizeNpcRecord(raw = {}) {
    const npc = { ...raw };
    // Manual profile locks block scanner rewrites. Data hygiene still normalizes whitespace,
    // but semantic compaction is skipped for explicitly locked stable fields.
    npc.manualProfileLocksExplicit = normalizeBoolean(raw.manualProfileLocksExplicit ?? raw.manual_profile_locks_explicit);
    npc.manualProfileFields = npc.manualProfileLocksExplicit && Array.isArray(raw.manualProfileFields)
        ? [...new Set(raw.manualProfileFields.map(value => String(value || '').trim()).filter(Boolean))]
        : [];
    const locked = new Set(npc.manualProfileFields);

    npc.name = cleanText(raw.name, 120) || 'Unnamed NPC';
    npc.identityKind = inferNpcIdentityKind(npc.name, raw.identityKind ?? raw.identity_kind);
    npc.role = cleanText(raw.role, 300);
    npc.species = cleanText(raw.species ?? raw.race ?? raw.ancestry ?? raw.speciesRace ?? raw.species_race, 160);
    const ageFields = normalizeStoredAgeFields(raw);
    npc.age = ageFields.age;
    npc.apparentAge = ageFields.apparentAge;
    npc.personality = locked.has('personality')
        ? cleanText(raw.personality, 900)
        : compactDurableText(raw.personality, DURABLE_PROFILE_LIMITS.personality, 6);
    npc.speech = locked.has('speech')
        ? cleanText(raw.speech, 600)
        : compactDurableText(raw.speech, DURABLE_PROFILE_LIMITS.speech, 5);
    npc.appearance = locked.has('appearance')
        ? cleanText(raw.appearance, 1800)
        : normalizeAppearanceCanon(raw.appearance);
    npc.background = locked.has('background')
        ? cleanText(raw.background, 1200)
        : compactDurableText(raw.background, DURABLE_PROFILE_LIMITS.background, 8);
    npc.relationshipSummary = compactDurableText(raw.relationshipSummary, DURABLE_PROFILE_LIMITS.relationshipSummary, 6);
    npc.mood = cleanText(raw.mood, 300);
    npc.location = cleanText(raw.location, 300);
    npc.goal = cleanText(raw.goal, 500);
    npc.status = cleanText(raw.status, 500);
    npc.portraitPromptPositive = cleanText(raw.portraitPromptPositive ?? raw.portrait_prompt_positive, 1800);
    npc.portraitPromptNegative = cleanText(raw.portraitPromptNegative ?? raw.portrait_prompt_negative, 1800);
    npc.portraitPromptReplace = normalizeBoolean(raw.portraitPromptReplace ?? raw.portrait_prompt_replace);
    npc.aliases = cleanList(raw.aliases, 8, 120);
    npc.memories = normalizeStoredMemories(raw.memories);
    npc.mannerisms = locked.has('mannerisms')
        ? cleanList(raw.mannerisms, 8, 320)
        : normalizeMannerisms(raw.mannerisms);
    npc.behaviorProfile = locked.has('behaviorProfile')
        ? cleanList(raw.behaviorProfile ?? raw.behavior_profile, BEHAVIOR_PROFILE_LIMIT, 320)
        : normalizeBehaviorProfile(raw.behaviorProfile ?? raw.behavior_profile);
    npc.keyRelationships = locked.has('keyRelationships')
        ? cleanList(raw.keyRelationships ?? raw.key_relationships ?? raw.innerCircle ?? raw.inner_circle ?? raw.family, KEY_RELATIONSHIP_LIMIT, 420)
        : mergeKeyRelationshipUpdates([], raw.keyRelationships ?? raw.key_relationships ?? raw.innerCircle ?? raw.inner_circle ?? raw.family);
    npc.profileEvidence = normalizeProfileEvidence(raw.profileEvidence ?? raw.profile_evidence);
    // v0.1.15: legacy Current Thoughts are intentionally discarded. NPC Inner Chatter is the ephemeral source of internal voice.
    delete npc.thoughts;
    const relationship = raw.relationship && typeof raw.relationship === 'object' ? raw.relationship : {};
    npc.relationship = normalizeRelationshipBaseline(relationship);
    npc.relationshipProgress = normalizeRelationshipProgress(raw.relationshipProgress ?? raw.relationship_progress);
    npc.relationshipMilestones = normalizeRelationshipMilestones(raw.relationshipMilestones ?? raw.relationship_milestones, npc.relationship);
    npc.relationshipEventHistory = normalizeRelationshipEventHistory(raw.relationshipEventHistory ?? raw.relationship_event_history);
    npc.relationshipSummary = calibrateRelationshipSummary(npc.relationshipSummary, npc.relationship);
    const lastChange = raw.lastRelationshipChange && typeof raw.lastRelationshipChange === 'object' ? raw.lastRelationshipChange : {};
    const legacyDelta = lastChange.delta ?? lastChange.appliedDelta ?? lastChange.relationshipDelta ?? {};
    const normalizedAuditDelta = normalizeRelationshipAuditDelta(legacyDelta);
    const auditHasDelta = RELATIONSHIP_KEYS.some(key => normalizedAuditDelta[key] !== 0);
    const auditEvidence = normalizeRelationshipEvidence(lastChange.evidence ?? lastChange.relationshipEvidence);
    const auditHasEvidence = RELATIONSHIP_KEYS.some(key => auditEvidence[key]);
    const auditReason = cleanText(lastChange.reason ?? lastChange.relationshipChangeReason, 500);
    const auditIsManual = String(lastChange.impact || '').toLowerCase() === 'manual';
    npc.lastRelationshipChange = (auditHasDelta || auditHasEvidence) && !auditReason && !auditIsManual
        ? {
            impact: 'none',
            delta: { trust: 0, affection: 0, desire: 0, tension: 0 },
            evidence: normalizeRelationshipEvidence(),
            reason: '',
            sourceMessageId: null,
        }
        : {
            impact: auditIsManual ? 'manual' : normalizeRelationshipImpact(lastChange.impact, auditHasDelta || auditHasEvidence),
            delta: normalizedAuditDelta,
            evidence: auditEvidence,
            reason: auditReason,
            sourceMessageId: Number.isInteger(lastChange.sourceMessageId) ? lastChange.sourceMessageId : null,
            ...(Number.isFinite(Number(lastChange.turn)) ? { turn: Number(lastChange.turn) } : {}),
        };
    if (!npc.relationshipEventHistory.length
        && npc.lastRelationshipChange.impact !== 'none'
        && npc.lastRelationshipChange.impact !== 'manual'
        && npc.lastRelationshipChange.reason) {
        npc.relationshipEventHistory = appendRelationshipEvent([], npc.lastRelationshipChange);
    }
    npc.present = normalizeBoolean(raw.present);
    npc.worldActive = normalizeBoolean(raw.worldActive) && !npc.present;
    npc.lifeState = normalizeLifeState(raw.lifeState);
    npc.lifeStateCertainty = normalizeLifeStateCertainty(raw.lifeStateCertainty);
    npc.lifeStateReason = cleanText(raw.lifeStateReason, 500);
    npc.archived = normalizeBoolean(raw.archived);
    npc.archiveReason = raw.archiveReason === 'deceased' ? 'deceased' : (raw.archiveReason === 'stale' ? 'stale' : (raw.archiveReason === 'manual' ? 'manual' : ''));
    npc.minor = normalizeBoolean(raw.minor ?? raw.isMinor ?? raw.is_minor ?? raw.hideFromGallery ?? raw.hide_from_gallery);
    npc.archivedAt = Number.isFinite(Number(raw.archivedAt)) ? Number(raw.archivedAt) : null;
    npc.archiveSourceMessageId = Number.isInteger(raw.archiveSourceMessageId) ? raw.archiveSourceMessageId : null;
    npc.retentionProtected = normalizeBoolean(raw.retentionProtected ?? raw.retention_protected ?? raw.keepFromStaleCleanup ?? raw.keep_from_stale_cleanup);
    npc.lastSeenTurn = Math.max(0, Math.round(Number(raw.lastSeenTurn) || 0));
    npc.lastWorldActiveTurn = Math.max(0, Math.round(Number(raw.lastWorldActiveTurn) || 0));
    npc.seenCount = Math.max(0, Math.round(Number(raw.seenCount) || 0));
    { const number = Number(raw.importance); npc.importance = Number.isFinite(number) ? clamp(number) : 50; }
    npc.createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now();
    npc.updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : npc.createdAt;
    npc.manual = normalizeBoolean(raw.manual, false);
    if (npc.archived) { npc.present = false; npc.worldActive = false; }
    return npc;
}

export function createNpcRecord(name, existingIds = [], baseline = DEFAULT_RELATIONSHIP) {
    return {
        id: makeNpcId(name, existingIds),
        name: cleanText(name, 120) || 'Unnamed NPC',
        identityKind: inferNpcIdentityKind(name),
        aliases: [],
        role: '',
        species: '',
        age: '',
        apparentAge: '',
        appearance: '',
        personality: '',
        speech: '',
        background: '',
        relationshipSummary: '',
        mood: '',
        location: '',
        goal: '',
        status: '',
        memories: [],
        mannerisms: [],
        behaviorProfile: [],
        keyRelationships: [],
        profileEvidence: emptyProfileEvidence(),
        importance: 50,
        present: false,
        worldActive: false,
        lastWorldActiveTurn: 0,
        lifeState: 'unknown',
        lifeStateCertainty: '',
        lifeStateReason: '',
        archived: false,
        archiveReason: '',
        archivedAt: null,
        archiveSourceMessageId: null,
        relationship: normalizeRelationshipBaseline(baseline),
        relationshipProgress: normalizeRelationshipProgress(),
        relationshipMilestones: [],
        relationshipEventHistory: [],
        lastRelationshipChange: { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: normalizeRelationshipEvidence(), reason: '', sourceMessageId: null },
        portrait: null,
        portraitPromptPositive: '',
        portraitPromptNegative: '',
        portraitPromptReplace: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSeenTurn: 0,
        seenCount: 0,
        manual: true,
        manualProfileFields: [],
        manualProfileLocksExplicit: false,
        retentionProtected: false,
        minor: false,
    };
}

export function pruneStaleNpcState(state = {}, options = {}) {
    const turn = Math.max(0, Math.round(Number(options.turn ?? state?.turn ?? 0) || 0));
    const threshold = Math.max(1, Math.round(Number(options.threshold) || 50));
    const protectedIds = new Set((options.protectedIds || []).map(value => String(value || '').trim()).filter(Boolean));
    const includeArchived = options.includeArchived === true;
    const next = { ...state };
    const removed = [];
    const removedIds = new Set();
    next.npcs = (Array.isArray(state?.npcs) ? state.npcs : []).filter(raw => {
        const npc = normalizeNpcRecord(raw);
        if ((!includeArchived && npc.archived) || npc.present || npc.worldActive || npc.retentionProtected || protectedIds.has(npc.id)) return true;
        const activityTurn = Math.max(Number(npc.lastSeenTurn || 0), Number(npc.lastWorldActiveTurn || 0));
        const age = Math.max(0, turn - activityTurn);
        if (age < threshold) return true;
        removed.push({ id: npc.id, name: npc.name, age, activityTurn });
        removedIds.add(npc.id);
        return false;
    });
    if (!removedIds.size) return { state: next, removed };

    if (Array.isArray(state?.pendingBackfills)) {
        next.pendingBackfills = state.pendingBackfills.filter(item => !removedIds.has(String(item?.npcId || '')));
    }
    if (Array.isArray(state?.inlineCards)) {
        next.inlineCards = state.inlineCards.map(entry => ({
            ...entry,
            cards: Array.isArray(entry?.cards) ? entry.cards.filter(card => !removedIds.has(String(card?.id || ''))) : [],
        })).filter(entry => Array.isArray(entry.cards) && entry.cards.length > 0);
    }
    if (state?.portraitAssets && typeof state.portraitAssets === 'object') {
        next.portraitAssets = { ...state.portraitAssets };
        for (const id of removedIds) delete next.portraitAssets[id];
    }
    // Deliberately do not add auto-pruned names to dismissed/suppressed. If they return
    // later, normal admission may build a fresh dossier again.
    return { state: next, removed };
}


export function applyStaleNpcLifecycle(state = {}, options = {}) {
    const turn = Math.max(0, Math.round(Number(options.turn ?? state?.turn ?? 0) || 0));
    const archiveAfter = Math.max(1, Math.round(Number(options.archiveAfter) || 30));
    const deleteAfter = Math.max(archiveAfter + 1, Math.round(Number(options.deleteAfter) || 50));
    const protectedIds = new Set((options.protectedIds || []).map(value => String(value || '').trim()).filter(Boolean));
    const next = { ...state };
    const archived = [];
    const removed = [];
    const removedIds = new Set();
    next.npcs = [];

    for (const raw of (Array.isArray(state?.npcs) ? state.npcs : [])) {
        let npc = normalizeNpcRecord(raw);
        if (npc.present || npc.worldActive || npc.retentionProtected || protectedIds.has(npc.id)) {
            next.npcs.push(npc);
            continue;
        }
        const activityTurn = Math.max(Number(npc.lastSeenTurn || 0), Number(npc.lastWorldActiveTurn || 0));
        const age = Math.max(0, turn - activityTurn);

        // Only stale-auto-archives participate in timed deletion. Manual and death archives are
        // durable records and remain until the player explicitly removes them.
        if (npc.archived) {
            if (npc.archiveReason === 'stale' && age >= deleteAfter) {
                removed.push({ id: npc.id, name: npc.name, age, activityTurn, archiveReason: 'stale' });
                removedIds.add(npc.id);
                continue;
            }
            next.npcs.push(npc);
            continue;
        }

        if (age >= deleteAfter) {
            // On upgrades or very long gaps, a dossier may already be beyond both thresholds.
            // Delete it directly rather than creating a one-scan zombie archive.
            removed.push({ id: npc.id, name: npc.name, age, activityTurn, archiveReason: 'stale' });
            removedIds.add(npc.id);
            continue;
        }
        if (age >= archiveAfter) {
            npc = setNpcArchived(npc, true, { reason: 'stale' });
            archived.push({ id: npc.id, name: npc.name, age, activityTurn });
        }
        next.npcs.push(npc);
    }

    if (removedIds.size) {
        if (Array.isArray(state?.pendingBackfills)) {
            next.pendingBackfills = state.pendingBackfills.filter(item => !removedIds.has(String(item?.npcId || '')));
        }
        if (Array.isArray(state?.inlineCards)) {
            next.inlineCards = state.inlineCards.map(entry => ({
                ...entry,
                cards: Array.isArray(entry?.cards) ? entry.cards.filter(card => !removedIds.has(String(card?.id || ''))) : [],
            })).filter(entry => Array.isArray(entry.cards) && entry.cards.length > 0);
        }
        if (state?.portraitAssets && typeof state.portraitAssets === 'object') {
            next.portraitAssets = { ...state.portraitAssets };
            for (const id of removedIds) delete next.portraitAssets[id];
        }
    }

    // Auto lifecycle never suppresses names. A stale NPC can return naturally and receive a new
    // dossier after timed deletion.
    return { state: next, archived, removed };
}

function candidateMatches(existing, incoming) {
    if (incoming.id && incoming.id === existing.id) return true;
    const incomingNames = new Set([incoming.name, ...(incoming.aliases || [])].map(normalizeName).filter(Boolean));
    const existingNames = [existing.name, ...(existing.aliases || [])].map(normalizeName).filter(Boolean);
    return existingNames.some(name => incomingNames.has(name));
}

function mergeLists(oldList, newList, limit = 8) {
    const result = [];
    const seen = new Set();
    for (const item of [...(oldList || []), ...(newList || [])]) {
        const key = normalizeName(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}

function mergeImportantMemories(oldList, newList, retentionList = []) {
    const existing = semanticDedupeItems(cleanList(oldList, 64, DURABLE_PROFILE_LIMITS.memory), {
        maxItems: 64, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,
    });
    const incoming = semanticDedupeItems(cleanList(newList, 6, DURABLE_PROFILE_LIMITS.memory), {
        maxItems: 3, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,
    });
    const pool = semanticDedupeItems([...existing, ...incoming], {
        maxItems: 64, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,
    });
    if (pool.length <= IMPORTANT_MEMORY_LIMIT) return pool;

    const requested = semanticDedupeItems(cleanList(retentionList, IMPORTANT_MEMORY_LIMIT * 2, DURABLE_PROFILE_LIMITS.memory), {
        maxItems: IMPORTANT_MEMORY_LIMIT, maxChars: DURABLE_PROFILE_LIMITS.memory, similarity: 0.58,
    });
    const selected = [];
    const selectCanonical = request => {
        let best = null;
        let bestScore = 0;
        for (const candidate of pool) {
            const score = normalizeName(candidate) === normalizeName(request) ? 1 : durableSemanticSimilarity(candidate, request);
            if (score > bestScore) { best = candidate; bestScore = score; }
        }
        return bestScore >= 0.56 ? best : null;
    };
    for (const item of requested) {
        const canonical = selectCanonical(item);
        if (!canonical || selected.some(value => durableSemanticSimilarity(value, canonical) >= 0.58)) continue;
        selected.push(canonical);
    }

    if (selected.length) {
        // A partial/malformed model selection must not re-lock the list. Fill any
        // missing slots with newest semantically distinct memories first.
        for (const item of [...incoming, ...existing].reverse()) {
            if (selected.some(value => durableSemanticSimilarity(value, item) >= 0.58)) continue;
            selected.push(item);
            if (selected.length >= IMPORTANT_MEMORY_LIMIT) break;
        }
        return selected.slice(0, IMPORTANT_MEMORY_LIMIT);
    }

    // Scanner omitted semantic retention. Prefer the newest five distinct events.
    return pool.slice(-IMPORTANT_MEMORY_LIMIT);
}

function applyIncoming(existing, incoming, turn, relationshipCaps = DEFAULT_RELATIONSHIP_CAPS, sourceMessageId = null, lifecycleOptions = {}) {
    const merged = { ...existing };
    const manualFields = new Set(Array.isArray(existing.manualProfileFields) ? existing.manualProfileFields : []);
    const directEvolutionReady = () => {
        // Existing durable identity must not leap merely because a weaker scanner omitted
        // developmentScale. Gradual evolution is evidence-gated through profileUpdates.
        const scale = incoming.developmentScale || 'gradual';
        if (scale === 'gradual') return false;
        return developmentScaleReady(scale, incoming.developmentReason, lifecycleOptions.developmentContext);
    };
    const existingName = cleanText(existing.name, 120);
    const incomingName = cleanText(incoming.name, 120);
    const incomingAliases = Array.isArray(incoming.aliases) ? incoming.aliases : [];
    const existingKind = inferNpcIdentityKind(existingName, existing.identityKind);
    const incomingKind = inferNpcIdentityKind(incomingName, incoming.identityKind);
    const incomingClaimsOldLabel = incomingAliases.some(alias => normalizeName(alias) === normalizeName(existingName));
    const exactIdContinuity = Boolean(incoming.id && existing.id && String(incoming.id) === String(existing.id));
    const roleContinuity = Boolean(incoming.role && (identityLabelsRelated(existing.role, incoming.role) || identityLabelsRelated(existingName, incoming.role)));
    const interimIdentity = isInterimNpcLabel(existingName, existing.identityKind);
    const canPromoteIdentity = incomingKind === 'proper_name' && interimIdentity
        && (exactIdContinuity || incomingClaimsOldLabel || incoming.sameIndividual || roleContinuity);
    let promotedFromName = '';

    if (incomingName && normalizeName(incomingName) !== normalizeName(existingName)) {
        // A manual lock protects a real established name, but it must not strand a dossier under
        // a placeholder/job title after the story reveals a grounded proper name. The old label is
        // retained as an alias and the existing dossier id/history remains authoritative.
        if (canPromoteIdentity || (!manualFields.has('name') && incomingKind === 'proper_name' && incomingClaimsOldLabel)) {
            merged.name = incomingName;
            merged.identityKind = 'proper_name';
            promotedFromName = existingName;
        }
    }
    if (!merged.name) merged.name = incomingName || existingName || 'Unnamed NPC';
    if (!merged.identityKind) merged.identityKind = inferNpcIdentityKind(merged.name, existingKind);

    for (const field of TEXT_FIELDS) {
        const value = incoming[field];
        if (manualFields.has(field)) continue;
        if (field === 'relationshipSummary') continue; // gated after relationship evidence is accepted
        if (typeof value !== 'string' || !value.trim()) continue;
        if (['personality', 'speech', 'appearance'].includes(field)
            && !String(existing[field] || '').trim()
            && !durableSeedGrounded(value, lifecycleOptions.developmentContext)) {
            continue;
        }
        if (field === 'appearance' && String(existing.appearance || '').trim()) {
            // Unlocked established Appearance can organically REFINE as new durable visual facts
            // become known. A lasting visual change remains stricter and needs a grounded reason.
            // A clearly additive unmarked description is accepted as a recovery path so a manual
            // baseline does not behave like a hidden lock when the scanner forgets the marker.
            const mode = String(incoming.appearanceState || 'keep');
            if (mode === 'change') {
                if (!String(incoming.appearanceReason || '').trim() || !directEvolutionReady()) continue;
            } else if (mode !== 'refine' && !isSafeUnmarkedDurableRefinement(existing.appearance, value)) {
                continue;
            }
            if (mode === 'refine') {
                if (!isSafeUnmarkedDurableRefinement(existing.appearance, value)) continue;
                merged.appearance = mergeDurableTextRefinement(existing.appearance, value, DURABLE_PROFILE_LIMITS.appearance);
                continue;
            }
        }
        if (field === 'personality' && String(existing.personality || '').trim()) {
            // Newly established/clarified stable traits are refinement, not character evolution.
            // Evolution still requires an explicit reason; refinement may enrich a manually entered
            // unlocked baseline, and a clearly additive unmarked result is recovered conservatively.
            const mode = String(incoming.personalityState || 'keep');
            if (mode === 'evolve') {
                if (!String(incoming.personalityReason || '').trim() || !directEvolutionReady()) continue;
            } else if (mode !== 'refine' && !isSafeUnmarkedDurableRefinement(existing.personality, value)) {
                continue;
            }
            if (mode === 'refine') {
                if (!isSafeIdentityTextRefinement(existing.personality, value)) continue;
                merged.personality = mergeDurableTextRefinement(existing.personality, value, DURABLE_PROFILE_LIMITS.personality);
                continue;
            }
        }
        if (field === 'speech' && String(existing.speech || '').trim()) {
            // Speech may refine as recurring vocabulary, formality, cadence, accent, or verbal
            // habits become established. Enduring register change remains evolution + reason.
            const mode = String(incoming.speechState || 'keep');
            if (mode === 'evolve') {
                if (!String(incoming.speechReason || '').trim() || !directEvolutionReady()) continue;
            } else if (mode !== 'refine' && !isSafeUnmarkedDurableRefinement(existing.speech, value)) {
                continue;
            }
            if (mode === 'refine') {
                if (!isSafeSpeechRefinement(existing.speech, value)) continue;
                merged.speech = mergeDurableTextRefinement(existing.speech, value, DURABLE_PROFILE_LIMITS.speech);
                continue;
            }
        }
        if (field === 'age' && String(existing.age || '').trim()) {
            // Chronological age is keep-by-default once established. It may advance from
            // explicit elapsed chronology/birthdays or be corrected by stronger story evidence.
            // An advance may never move an exact numeric age backward or sideways.
            const state = String(incoming.ageState || 'keep');
            if ((state !== 'advance' && state !== 'correct') || !String(incoming.ageReason || '').trim()) continue;
            const oldExact = /^\d{1,3}$/.test(String(existing.age || '').trim()) ? Number(existing.age) : null;
            const newExact = /^\d{1,3}$/.test(String(value || '').trim()) ? Number(value) : null;
            if (state === 'advance' && oldExact !== null && newExact !== null && newExact <= oldExact) continue;
        }
        if (field === 'apparentAge' && String(existing.apparentAge || '').trim()) {
            // Apparent age is also keep-by-default. Visual aging, growth, rejuvenation,
            // transformation, or a grounded correction must be explicitly marked as evolution.
            if (incoming.apparentAgeState !== 'evolve' || !String(incoming.apparentAgeReason || '').trim()) continue;
        }
        if (field === 'age' || field === 'apparentAge') {
            // Even a lifecycle update cannot downgrade stronger age evidence to a weaker estimate.
            if (ageSpecificity(existing[field]) > ageSpecificity(value)) continue;
        }
        if (field === 'appearance' && String(existing.appearance || '').trim() && incoming.appearanceState === 'keep') {
            merged.appearance = mergeDurableTextRefinement(existing.appearance, value, DURABLE_PROFILE_LIMITS.appearance);
            continue;
        }
        if (field === 'personality' && String(existing.personality || '').trim() && incoming.personalityState === 'keep') {
            merged.personality = mergeDurableTextRefinement(existing.personality, value, DURABLE_PROFILE_LIMITS.personality);
            continue;
        }
        if (field === 'speech' && String(existing.speech || '').trim() && incoming.speechState === 'keep') {
            merged.speech = mergeDurableTextRefinement(existing.speech, value, DURABLE_PROFILE_LIMITS.speech);
            continue;
        }
        merged[field] = value.trim();
    }
    if (!manualFields.has('goal') && incoming.goalState === 'clear' && !String(incoming.goal || '').trim()) {
        merged.goal = '';
    }
    if (!manualFields.has('status') && incoming.statusState === 'clear' && !String(incoming.status || '').trim()) {
        merged.status = '';
    }
    if (!manualFields.has('mood') && incoming.moodState === 'clear' && !String(incoming.mood || '').trim()) {
        merged.mood = '';
    }
    if (!manualFields.has('location') && incoming.locationState === 'clear' && !String(incoming.location || '').trim()) {
        merged.location = '';
    }
    merged.aliases = mergeLists([...(existing.aliases || []), ...(promotedFromName ? [promotedFromName] : [])], incomingAliases, 8)
        .filter(alias => normalizeName(alias) !== normalizeName(merged.name));
    if (normalizeName(incomingName) === normalizeName(merged.name) && incoming.identityKind) {
        merged.identityKind = inferNpcIdentityKind(merged.name, incoming.identityKind);
    }
    merged.memories = mergeImportantMemories(existing.memories, incoming.memories, incoming.memoryRetention);
    if (manualFields.has('mannerisms')) {
        merged.mannerisms = [...(existing.mannerisms || [])];
    } else if ((existing.mannerisms || []).length) {
        // Refinement learns/clarifies durable habits without deleting the established current set.
        // Evolution is reserved for a real long-term habit change and replaces the full set so
        // obsolete tells can retire. Manual locks remain authoritative above.
        if (incoming.mannerismState === 'evolve'
            && String(incoming.mannerismReason || '').trim()
            && directEvolutionReady()
            && incoming.mannerismsProvided) {
            merged.mannerisms = normalizeMannerisms(incoming.mannerisms || []);
        } else if (incoming.mannerismState === 'refine' && incoming.mannerismsProvided) {
            const safe = filterSafeMannerismRefinements(existing.mannerisms, incoming.mannerisms, false, lifecycleOptions.developmentContext);
            merged.mannerisms = mergeMannerismRefinements(existing.mannerisms, safe);
        } else {
            merged.mannerisms = [...(existing.mannerisms || [])];
        }
    } else {
        // A first observed gesture is not yet a mannerism. With source narration available,
        // seed only habits whose recurrence is actually established; structured imports with no
        // narration keep backward-compatible direct population.
        const seed = String(lifecycleOptions.developmentContext || '').trim()
            ? (incoming.mannerisms || []).filter(entry => isExplicitRecurringMannerism(entry, lifecycleOptions.developmentContext))
            : (incoming.mannerisms || []);
        merged.mannerisms = normalizeMannerisms(seed);
    }
    if (manualFields.has('behaviorProfile')) {
        merged.behaviorProfile = [...(existing.behaviorProfile || [])];
    } else if ((existing.behaviorProfile || []).length) {
        if (incoming.behaviorProfileState === 'evolve'
            && String(incoming.behaviorProfileReason || '').trim()
            && directEvolutionReady()
            && incoming.behaviorProfileProvided) {
            merged.behaviorProfile = reconcileBehaviorProfileWithPersonality(incoming.behaviorProfile, merged.personality || existing.personality);
        } else if (incoming.behaviorProfileState === 'refine' && incoming.behaviorProfileProvided) {
            merged.behaviorProfile = mergeBehaviorProfileRefinements(existing.behaviorProfile, incoming.behaviorProfile);
        } else {
            merged.behaviorProfile = [...(existing.behaviorProfile || [])];
        }
    } else {
        const grounded = groundedBehaviorProfile(
            incoming.behaviorProfile,
            merged.personality || existing.personality,
            lifecycleOptions.developmentContext,
            incoming.profileEvidence?.behaviorProfile || [],
        );
        merged.behaviorProfile = reconcileBehaviorProfileWithPersonality(grounded, merged.personality || existing.personality);
    }
    if (manualFields.has('keyRelationships')) {
        merged.keyRelationships = [...(existing.keyRelationships || [])];
    } else if ((existing.keyRelationships || []).length) {
        // Key Relationships are durable social continuity, not a running contact log.
        // Scanner omission is never evidence that another important bond vanished. Even
        // during an evolution, update named counterparts in place and preserve unrelated
        // bonds; estrangement/death should change that counterpart's entry rather than
        // silently deleting everyone the model did not mention this turn.
        if (incoming.keyRelationshipsState === 'evolve'
            && String(incoming.keyRelationshipsReason || '').trim()
            && incoming.keyRelationshipsProvided) {
            merged.keyRelationships = mergeKeyRelationshipUpdates(existing.keyRelationships, incoming.keyRelationships || []);
        } else if (incoming.keyRelationshipsState === 'update'
            && incoming.keyRelationshipsProvided) {
            // Discovery/clarification is not social evolution. A model that correctly
            // marks an update may omit the audit reason, so the explicit lifecycle state
            // plus grounded entries is sufficient to merge by counterpart.
            merged.keyRelationships = mergeKeyRelationshipUpdates(existing.keyRelationships, incoming.keyRelationships);
        } else if (incoming.keyRelationshipsProvided && (incoming.keyRelationships || []).length) {
            // Recovery for models that extract an explicit newly revealed tie but omit
            // the lifecycle marker entirely. Only NEW counterparts are admitted here;
            // an unmarked rewrite of an already-known person's dynamic is still rejected.
            const knownSubjects = new Set((existing.keyRelationships || []).map(keyRelationshipSubject).filter(Boolean));
            const newlyEstablished = (incoming.keyRelationships || []).filter(entry => {
                const subject = keyRelationshipSubject(entry);
                return subject && !knownSubjects.has(subject);
            });
            merged.keyRelationships = newlyEstablished.length
                ? mergeKeyRelationshipUpdates(existing.keyRelationships, newlyEstablished)
                : [...(existing.keyRelationships || [])];
        } else {
            merged.keyRelationships = [...(existing.keyRelationships || [])];
        }
    } else {
        merged.keyRelationships = mergeKeyRelationshipUpdates([], incoming.keyRelationships || []);
    }
    merged.importance = Number.isFinite(Number(existing.importance)) ? clamp(existing.importance) : 50;
    let relationshipEventAccepted = false;
    let relationshipNarrativeAdvance = false;
    if (!lifecycleOptions.skipRelationshipUpdate) {
        let proposedRelationshipDelta = incoming.relationshipDelta;
        let proposedRelationshipImpact = incoming.relationshipImpact;
        const proposedEvidence = normalizeRelationshipEvidence(incoming.relationshipEvidence);

        if (!incoming.relationshipDeltaProvided && Object.keys(incoming.relationshipAbsolutePatch || {}).length) {
            const currentRelationship = normalizeRelationshipBaseline(existing.relationship || DEFAULT_RELATIONSHIP);
            proposedRelationshipDelta = Object.fromEntries(RELATIONSHIP_KEYS.map(key => {
                if (!Object.prototype.hasOwnProperty.call(incoming.relationshipAbsolutePatch, key)) return [key, 0];
                return [key, incoming.relationshipAbsolutePatch[key] - currentRelationship[key]];
            }));
            const hasRecoveredDelta = RELATIONSHIP_KEYS.some(key => proposedRelationshipDelta[key] !== 0);
            proposedRelationshipImpact = normalizeScannerRelationshipImpact(proposedRelationshipImpact, hasRecoveredDelta);
        }

        const proposedHasDelta = RELATIONSHIP_KEYS.some(key => Number(proposedRelationshipDelta?.[key] || 0) !== 0);
        const duplicateAward = proposedHasDelta && relationshipHistoryLooksDuplicate(
            existing.relationshipEventHistory,
            incoming.relationshipChangeReason,
            { sourceMessageId, turn, evidence: proposedEvidence },
        );
        const validAxisEvidence = !proposedHasDelta || relationshipEvidenceValidForDelta(
            normalizeRelationshipDelta(proposedRelationshipDelta),
            proposedEvidence,
            lifecycleOptions.developmentContext,
        );
        if (proposedHasDelta && (!relationshipChangeReasonGrounded(incoming.relationshipChangeReason, lifecycleOptions.developmentContext) || !validAxisEvidence || duplicateAward)) {
            proposedRelationshipDelta = { trust: 0, affection: 0, desire: 0, tension: 0 };
            proposedRelationshipImpact = 'none';
        }
        const relationshipUpdate = applyRelationshipDelta(
            existing.relationship || DEFAULT_RELATIONSHIP,
            proposedRelationshipDelta,
            proposedRelationshipImpact,
            relationshipCaps,
            existing.relationshipProgress || DEFAULT_RELATIONSHIP_PROGRESS,
            existing.relationshipMilestones || [],
        );
        merged.relationship = relationshipUpdate.relationship;
        merged.relationshipProgress = relationshipUpdate.relationshipProgress;
        merged.relationshipMilestones = applyRelationshipMilestoneCrossings(
            existing.relationshipMilestones,
            relationshipUpdate.milestoneCrossings,
            {
                reason: incoming.relationshipChangeReason || '',
                sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
                turn: Number.isFinite(Number(turn)) ? Number(turn) : null,
            },
        );
        relationshipEventAccepted = relationshipUpdate.evidenceAccepted;
        const relationshipActuallyChanged = RELATIONSHIP_KEYS.some(key => relationshipUpdate.appliedDelta[key] !== 0);
        const relationshipStateAdvanced = relationshipActuallyChanged
            || relationshipUpdate.progressChanged
            || relationshipUpdate.milestoneCrossings.length > 0;
        relationshipNarrativeAdvance = relationshipEventAccepted && (
            relationshipStateAdvanced
            || relationshipUpdate.milestoneBlocks.length === 0
        );
        if (relationshipEventAccepted) {
            const event = {
                impact: relationshipUpdate.impact,
                delta: relationshipUpdate.appliedDelta,
                evidence: proposedEvidence,
                reason: incoming.relationshipChangeReason || '',
                sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
                turn: Number.isFinite(Number(turn)) ? Number(turn) : null,
            };
            merged.relationshipEventHistory = appendRelationshipEvent(existing.relationshipEventHistory, event);
            merged.lastRelationshipChange = relationshipStateAdvanced
                ? event
                : structuredClone(existing.lastRelationshipChange || { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: normalizeRelationshipEvidence(), reason: '', sourceMessageId: null });
        } else {
            merged.lastRelationshipChange = structuredClone(existing.lastRelationshipChange || { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: normalizeRelationshipEvidence(), reason: '', sourceMessageId: null });
            merged.relationshipEventHistory = normalizeRelationshipEventHistory(existing.relationshipEventHistory);
        }
        if (!relationshipActuallyChanged && relationshipUpdate.progressChanged) merged.updatedAt = Date.now();
    } else {
        merged.relationship = normalizeRelationshipBaseline(existing.relationship || DEFAULT_RELATIONSHIP);
        merged.relationshipProgress = normalizeRelationshipProgress(existing.relationshipProgress);
        merged.relationshipMilestones = normalizeRelationshipMilestones(existing.relationshipMilestones, merged.relationship);
        merged.relationshipEventHistory = normalizeRelationshipEventHistory(existing.relationshipEventHistory);
        merged.lastRelationshipChange = structuredClone(existing.lastRelationshipChange || { impact: 'none', delta: { trust: 0, affection: 0, desire: 0, tension: 0 }, evidence: normalizeRelationshipEvidence(), reason: '', sourceMessageId: null });
    }

    // Relationship prose may initialize an empty field from grounded story evidence, but an
    // established summary only changes when a NEW relationship event actually survives the
    // reason/evidence/dedup gates. Rejected duplicate events cannot advance prose by themselves.
    if (!manualFields.has('relationshipSummary')) {
        const proposedSummary = cleanText(incoming.relationshipSummary, DURABLE_PROFILE_LIMITS.relationshipSummary);
        const mayInitialize = !String(existing.relationshipSummary || '').trim()
            && proposedSummary
            && relationshipSummaryConsistent(proposedSummary, merged.relationship, lifecycleOptions.developmentContext, merged.relationshipMilestones);
        const mayUpdate = relationshipNarrativeAdvance
            && proposedSummary
            && relationshipSummaryConsistent(proposedSummary, merged.relationship, lifecycleOptions.developmentContext, merged.relationshipMilestones);
        if (mayInitialize || mayUpdate) merged.relationshipSummary = calibrateRelationshipSummary(proposedSummary, merged.relationship);
        else merged.relationshipSummary = calibrateRelationshipSummary(existing.relationshipSummary || merged.relationshipSummary, merged.relationship);
    } else {
        merged.relationshipSummary = calibrateRelationshipSummary(existing.relationshipSummary, merged.relationship);
    }
    const autoArchiveDeaths = lifecycleOptions.autoArchiveDeaths !== false;
    const autoReactivateArchived = lifecycleOptions.autoReactivateArchived !== false;
    const confirmedDeath = incoming.lifeState === 'deceased' && incoming.lifeStateCertainty === 'explicit';
    const explicitlyAlive = incoming.lifeState === 'alive' && incoming.lifeStateCertainty === 'explicit';

    if (incoming.lifeState !== 'unknown') {
        merged.lifeState = incoming.lifeState;
        merged.lifeStateCertainty = incoming.lifeStateCertainty;
        merged.lifeStateReason = incoming.lifeStateReason || merged.lifeStateReason || '';
    }

    if (confirmedDeath && autoArchiveDeaths) {
        merged.archived = true;
        merged.archiveReason = 'deceased';
        merged.archivedAt = Date.now();
        merged.archiveSourceMessageId = Number.isInteger(sourceMessageId) ? sourceMessageId : null;
    } else if (existing.archived && autoReactivateArchived && (incoming.present || incoming.worldActive)) {
        const recoverableReturn = existing.archiveReason === 'manual' || existing.archiveReason === 'stale';
        const deceasedReturn = existing.archiveReason === 'deceased' && explicitlyAlive;
        if (recoverableReturn || deceasedReturn) {
            merged.archived = false;
            merged.archiveReason = '';
            merged.archivedAt = null;
            merged.archiveSourceMessageId = null;
            if (deceasedReturn) {
                merged.lifeState = 'alive';
                merged.lifeStateCertainty = 'explicit';
            }
        }
    }

    merged.present = Boolean(incoming.present) && !merged.archived;
    merged.worldActive = Boolean(incoming.worldActive) && !merged.present && !merged.archived;
    merged.updatedAt = Date.now();
    if (merged.present) {
        merged.lastSeenTurn = turn;
        merged.seenCount = Number(existing.seenCount || 0) + 1;
    }
    if (merged.worldActive) merged.lastWorldActiveTurn = turn;
    // A scanner update must never erase a portrait or user/manual metadata.
    merged.portrait = existing.portrait || null;
    merged.manual = Boolean(existing.manual);
    merged.manualProfileFields = [...manualFields];
    merged.manualProfileLocksExplicit = existing.manualProfileLocksExplicit === true;
    return merged;
}

export function buildRelationshipPassPrompt({
    transcript,
    targets = [],
    userName = 'User',
    relationshipCriteria = DEFAULT_RELATIONSHIP_CRITERIA,
    impactCriteria = DEFAULT_IMPACT_CRITERIA,
    relationshipCaps = DEFAULT_RELATIONSHIP_CAPS,
}) {
    const caps = normalizeRelationshipCaps(relationshipCaps);
    const compactTargets = (Array.isArray(targets) ? targets : []).slice(0, 4).map(npc => ({
        id: cleanText(npc?.id, 100),
        name: cleanText(npc?.name, 120),
        currentRelationship: normalizeRelationshipBaseline(npc?.relationship || DEFAULT_RELATIONSHIP),
        relationshipSummary: cleanText(npc?.relationshipSummary, 220),
        personality: cleanText(npc?.personality, 180),
        behaviorProfile: orderedBehaviorProfile(npc?.behaviorProfile).slice(0, 4).map(item => cleanText(item, 120)),
        speech: cleanText(npc?.speech, 120),
        mannerisms: cleanList(npc?.mannerisms, 2, 100),
        goal: cleanText(npc?.goal, 140),
        keyRelationships: cleanList(npc?.keyRelationships, 3, 140),
        recentRelationshipEvents: normalizeRelationshipEventHistory(npc?.relationshipEventHistory).slice(-4).map(event => ({
            impact: cleanText(event.impact, 20),
            reason: cleanText(event.reason, 180),
            evidence: normalizeRelationshipEvidence(event.evidence),
            sourceMessageId: Number.isInteger(event.sourceMessageId) ? event.sourceMessageId : null,
        })),
    })).filter(npc => npc.id);
    const relationshipRubric = compactRelationshipRubric(relationshipCriteria);
    const impactRubric = compactImpactRubric(impactCriteria);
    return `You are NPC State's focused relationship evaluator. Assess ONLY how each target NPC's relationship toward ${userName} changes because of the supplied CURRENT exchange.

Rules:
1. Return exactly one result for EACH target id. Never omit a target.
2. currentRelationship is read-only. Output signed DELTAS, never absolute scores.
3. relationshipDelta is REQUIRED with ALL FOUR numeric keys: trust, affection, desire, tension. relationshipEvidence is REQUIRED with ALL FOUR string keys; every non-zero axis needs its own short CURRENT-exchange evidence, while zero axes use an empty string.
4. Count actions and consequences, not just dialogue, but score NEW relationship evidence only. Routine continuation, expected friendliness/care, ordinary companionship, or ongoing aftermath of recentRelationshipEvents are normally ZERO. Do not reward the same rescue, confession, bargain, intimacy, argument, or favor again just because later messages continue it.
5. Use relationshipImpact none|ordinary|meaningful|major|extreme. none requires four zeros. Raw maxima are ordinary 1 / meaningful 2 / major 5 / extreme 10 per supported axis. Most events move 0-1 axes; meaningful max2, major max3, extreme max4, each with distinct evidence. These are evidence weights before score resistance, not guaranteed visible points.
6. IDENTITY FIRST: personality/behaviorProfile/speech/mannerisms/goal/other bonds remain the person; the player is not their only motive or relationship. Trust is not obedience; Affection is not devotion; Desire is not implied by affection; Tension is not automatically jealousy/embarrassment. High scores are secondary and need not surface every scene.
7. relationshipSummary is REQUIRED: durable prose Relationship field toward ${userName}, not event log/personality replacement. If still accurate, COPY IT EXACTLY; otherwise rewrite concisely. Keep intensity proportional to current scores/evidence; avoid absolute devotion/dependence language unless truly established. major/extreme turning point MUST rewrite an old summary.
8. Keep deltas within cap. Every non-zero axis needs grounded relationshipEvidence from CURRENT exchange and the overall event needs one short relationshipChangeReason. Desire requires explicit attraction/romantic/intimate/physical evidence; rescue, gratitude, affection, trust, or proximity alone never supports Desire. If evidence is insufficient, zero that axis; if all axes zero use impact none and empty reason.
9. JSON only, no markdown: {"npcs":[{"id":"...","relationshipImpact":"major","relationshipDelta":{"trust":-5,"affection":-2,"desire":0,"tension":5},"relationshipEvidence":{"trust":"the player exposed her private confidence","affection":"the betrayal hurt her attachment","desire":"","tension":"the confrontation created unresolved strain"},"relationshipSummary":"She feels betrayed and guarded toward the player, while former warmth leaves the conflict emotionally complicated.","relationshipChangeReason":"The player publicly exposed her private confidence."}]}

Relationship rubric: ${relationshipRubric || '(none)'}
Impact rubric: ${impactRubric || '(none)'}
Caps: ordinary ${caps.ordinary}; meaningful ${caps.meaningful}; major ${caps.major}; extreme ${caps.extreme}.
Targets: ${JSON.stringify(compactTargets)}
Current exchange:
${String(transcript || '').trim()}`;
}

function normalizeProfileUpdateEvidence(raw = {}) {
    return normalizeProfileEvidence(raw.evidence ?? raw.profileEvidence ?? raw.profile_evidence ?? raw.observations ?? {});
}

function isBareTimePassageDevelopmentReason(value) {
    const text = normalizeName(value);
    if (!text) return true;
    if (/^(?:time|some time|a while|several years) (?:passed|elapsed)$/.test(text)) return true;
    return /^(?:(?:after|over|during) )?(?:the )?(?:next )?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|many|few|\d+) (?:day|days|week|weeks|month|months|year|years|decade|decades)(?: later| passed| elapsed)?$/.test(text);
}

const DEVELOPMENT_TIME_TOKENS = new Set([
    'time', 'day', 'week', 'month', 'year', 'decade', 'later', 'pass', 'elapse', 'next', 'during', 'after', 'over',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'several', 'many', 'few',
]);

function hasNarratedTimeSkip(value) {
    const text = normalizeName(value);
    if (!text) return false;
    return /\b(?:day|week|month|year|decade)s?\b[^.!?\n]{0,48}\b(?:pass|passed|elapse|elapsed|later|afterward|afterwards)\b/.test(text)
        || /\b(?:after|over|during)\s+(?:the\s+)?(?:next\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|many|few|\d+)\s+(?:day|week|month|year|decade)s?\b/.test(text)
        || /\b(?:months|years|weeks|days)\s+later\b/.test(text);
}

function developmentContentTokens(value) {
    return [...new Set(durableRefinementTokens(value))]
        .filter(token => !DEVELOPMENT_TIME_TOKENS.has(token) && !/^\d+$/.test(token));
}

function developmentReasonGrounded(reason, context) {
    const why = cleanText(reason, 500);
    const source = String(context || '').trim();
    if (!why) return false;
    if (!source) return true; // library/API compatibility; runtime supplies source context.
    const sourceTokens = new Set(durableRefinementTokens(source));
    const reasonTokens = developmentContentTokens(why);
    if (!reasonTokens.length) return false;
    return reasonTokens.some(token => sourceTokens.has(token));
}

const EXPLICIT_DEVELOPMENT_CUE_RE = /\b(?:no longer|formerly|used to|ceased|stopped being|became|become|grown|grew|increasingly|decreasingly|changed|from then on|henceforth|ever since|second nature|true nature|habitual|habitually|permanent|permanently|lasting|now (?:always|usually|routinely|consistently|more|less)|contrary to|actually|in fact|has always|had always|never was|never had been|mistaken|misunderstood)\b/;
const BATCH_DEVELOPMENT_CUE_RE = /\b(?:gradually|repeatedly|consistently|routinely|throughout|eventually|over time|during that time|by then|became|become|grown|grew|learned|practiced|practised|habitual|second nature|true nature|changed)\b/;

function developmentContextSegments(value) {
    return String(value || '').replace(/\r/g, '\n').split(/\n+|(?<=[.!?])\s+/)
        .map(part => cleanText(part, 1200)).filter(Boolean);
}

function contextWindowGroundsReason(reason, value) {
    const reasonTokens = developmentContentTokens(reason);
    if (!reasonTokens.length) return false;
    const sourceTokens = new Set(durableRefinementTokens(value));
    return reasonTokens.some(token => sourceTokens.has(token));
}

function explicitDevelopmentContextGrounded(reason, context) {
    const source = String(context || '').trim();
    if (!source) return true;
    return developmentContextSegments(source).some(segment => EXPLICIT_DEVELOPMENT_CUE_RE.test(normalizeName(segment))
        && contextWindowGroundsReason(reason, segment));
}

function batchDevelopmentContextGrounded(reason, context) {
    const source = String(context || '').trim();
    if (!source) return true;
    const segments = developmentContextSegments(source);
    for (let i = 0; i < segments.length; i += 1) {
        if (!hasNarratedTimeSkip(segments[i])) continue;
        // Development may be summarized in the time-skip sentence itself or the immediately
        // following sentence ("Three years passed. During that time, she..."). Do not let an
        // unrelated present-day sentence elsewhere in the transcript authorize the batch jump.
        const window = [segments[i], segments[i + 1]].filter(Boolean).join(' ');
        if (!BATCH_DEVELOPMENT_CUE_RE.test(normalizeName(window))) continue;
        if (contextWindowGroundsReason(reason, window)) return true;
    }
    return false;
}

function developmentScaleReady(scale, reason, context) {
    const mode = ['gradual', 'explicit', 'batch'].includes(String(scale || '')) ? String(scale) : 'gradual';
    if (mode === 'gradual') return false;
    if (!developmentReasonGrounded(reason, context)) return false;
    const source = String(context || '').trim();
    if (mode === 'explicit' && source && !explicitDevelopmentContextGrounded(reason, source)) return false;
    if (mode === 'batch') {
        if (isBareTimePassageDevelopmentReason(reason)) return false;
        if (source && (!hasNarratedTimeSkip(source) || !batchDevelopmentContextGrounded(reason, source))) return false;
    }
    return true;
}

function applyDurableProfileUpdate(npc, raw = {}, options = {}) {
    const incoming = normalizeScanNpc(raw);
    const manualFields = new Set(Array.isArray(npc.manualProfileFields) ? npc.manualProfileFields : []);
    const beforeEvidence = normalizeProfileEvidence(npc.profileEvidence);
    const incomingEvidence = normalizeProfileUpdateEvidence(raw);
    let evidence = mergeProfileEvidence(beforeEvidence, Object.fromEntries(PROFILE_EVIDENCE_FIELDS.map(field => [
        field, manualFields.has(field) ? [] : incomingEvidence[field],
    ])));
    let changed = false;

    const evolutionReady = field => {
        const scale = incoming.developmentScale || 'gradual';
        if (scale === 'gradual') return gradualProfileEvolutionReady(field, beforeEvidence, incomingEvidence);
        return developmentScaleReady(scale, incoming.developmentReason, options.developmentContext);
    };

    const applyText = (field, stateField, reasonField, refineState, evolveState, maxChars) => {
        if (manualFields.has(field)) return;
        const value = cleanText(incoming[field], maxChars);
        if (!value) return;
        const current = cleanText(npc[field], maxChars);
        const state = String(incoming[stateField] || 'keep');
        if (!current) {
            const repeatedEvidence = gradualProfileEvolutionReady(field, beforeEvidence, incomingEvidence)
                && durableEvidenceGroundsValue(value, [...(beforeEvidence[field] || []), ...(incomingEvidence[field] || [])]);
            const seedReady = durableSeedGrounded(value, options.developmentContext) || repeatedEvidence;
            if (!seedReady) {
                evidence[field] = mergeRecentProfileEvidence(evidence[field], incomingEvidence[field] || []);
                return;
            }
            npc[field] = value;
            evidence[field] = [];
            changed = true;
            return;
        }
        if (state === evolveState) {
            if (!String(incoming[reasonField] || '').trim()) return;
            if (!evolutionReady(field)) return;
            if (normalizeName(current) !== normalizeName(value)) { npc[field] = value; changed = true; }
            evidence[field] = [];
            return;
        }
        const safeRefinement = field === 'personality' ? isSafeIdentityTextRefinement(current, value) : (field === 'speech' ? isSafeSpeechRefinement(current, value) : isSafeUnmarkedDurableRefinement(current, value));
        if ((state === refineState && safeRefinement) || (state !== evolveState && safeRefinement)) {
            const merged = mergeDurableTextRefinement(current, value, maxChars);
            if (normalizeName(merged) !== normalizeName(current)) { npc[field] = merged; changed = true; }
            // Preserve older pending change evidence, but consume evidence used only to justify
            // this harmless refinement so it cannot later unlock an unrelated evolution.
            evidence[field] = [...(beforeEvidence[field] || [])];
        }
    };

    applyText('personality', 'personalityState', 'personalityReason', 'refine', 'evolve', DURABLE_PROFILE_LIMITS.personality);
    applyText('speech', 'speechState', 'speechReason', 'refine', 'evolve', DURABLE_PROFILE_LIMITS.speech);
    applyText('appearance', 'appearanceState', 'appearanceReason', 'refine', 'change', DURABLE_PROFILE_LIMITS.appearance);

    if (!manualFields.has('mannerisms') && incoming.mannerismsProvided) {
        const current = normalizeMannerisms(npc.mannerisms || []);
        if (!current.length) {
            const source = String(options.developmentContext || '').trim();
            const gradualSeedReady = gradualProfileEvolutionReady('mannerisms', beforeEvidence, incomingEvidence);
            const mannerEvidence = [...(beforeEvidence.mannerisms || []), ...(incomingEvidence.mannerisms || [])];
            const seed = source
                ? (incoming.mannerisms || []).filter(entry => isExplicitRecurringMannerism(entry, source)
                    || (gradualSeedReady && durableEvidenceGroundsValue(entry, mannerEvidence)))
                : (incoming.mannerisms || []);
            npc.mannerisms = normalizeMannerisms(seed);
            if (npc.mannerisms.length) evidence.mannerisms = [];
            changed = npc.mannerisms.length > 0 || changed;
        } else if (incoming.mannerismState === 'evolve' && String(incoming.mannerismReason || '').trim() && evolutionReady('mannerisms')) {
            const replacement = normalizeMannerisms(incoming.mannerisms || []);
            if (JSON.stringify(replacement) !== JSON.stringify(current)) { npc.mannerisms = replacement; changed = true; }
            evidence.mannerisms = [];
        } else if (incoming.mannerismState === 'refine') {
            const allowNewPattern = gradualProfileEvolutionReady('mannerisms', beforeEvidence, incomingEvidence)
                || developmentScaleReady(incoming.developmentScale, incoming.developmentReason, options.developmentContext);
            const safe = filterSafeMannerismRefinements(current, incoming.mannerisms, allowNewPattern, options.developmentContext);
            const refined = mergeMannerismRefinements(current, safe);
            if (JSON.stringify(refined) !== JSON.stringify(current)) { npc.mannerisms = refined; changed = true; }
            evidence.mannerisms = [...(beforeEvidence.mannerisms || [])];
        }
    }

    if (!manualFields.has('behaviorProfile') && incoming.behaviorProfileProvided) {
        const current = normalizeBehaviorProfile(npc.behaviorProfile || []);
        if (!current.length) {
            const behaviorEvidence = [...(beforeEvidence.behaviorProfile || []), ...(incomingEvidence.behaviorProfile || [])];
            const grounded = groundedBehaviorProfile(incoming.behaviorProfile || [], npc.personality, options.developmentContext, behaviorEvidence);
            npc.behaviorProfile = reconcileBehaviorProfileWithPersonality(grounded, npc.personality);
            if (npc.behaviorProfile.length) evidence.behaviorProfile = [];
            else evidence.behaviorProfile = mergeRecentProfileEvidence(evidence.behaviorProfile, incomingEvidence.behaviorProfile || []);
            changed = npc.behaviorProfile.length > 0 || changed;
        } else if (incoming.behaviorProfileState === 'evolve' && String(incoming.behaviorProfileReason || '').trim() && evolutionReady('behaviorProfile')) {
            const replacement = reconcileBehaviorProfileWithPersonality(incoming.behaviorProfile || [], npc.personality);
            if (JSON.stringify(replacement) !== JSON.stringify(current)) { npc.behaviorProfile = replacement; changed = true; }
            evidence.behaviorProfile = [];
        } else if (incoming.behaviorProfileState === 'refine') {
            const refined = mergeBehaviorProfileRefinements(current, incoming.behaviorProfile);
            if (JSON.stringify(refined) !== JSON.stringify(current)) { npc.behaviorProfile = refined; changed = true; }
            evidence.behaviorProfile = [...(beforeEvidence.behaviorProfile || [])];
        }
    }

    const evidenceChanged = JSON.stringify(beforeEvidence) !== JSON.stringify(evidence);
    npc.profileEvidence = evidence;
    if (changed || evidenceChanged) npc.updatedAt = Date.now();
    return { changed, evidenceAdded: Math.max(0, profileEvidenceCount(evidence) - profileEvidenceCount(beforeEvidence)) };
}

function applyDurableProfileUpdates(state, scanResult, excludeNames, report, options = {}) {
    const rawUpdates = Array.isArray(scanResult?.profileUpdates) ? scanResult.profileUpdates
        : (Array.isArray(scanResult?.profile_updates) ? scanResult.profile_updates : []);
    let applied = 0;
    let evidenceAdded = 0;
    for (const raw of rawUpdates) {
        if (!raw || typeof raw !== 'object') continue;
        const id = cleanText(raw.id, 100);
        const name = cleanText(raw.name, 120);
        let index = id ? state.npcs.findIndex(npc => String(npc.id || '') === id) : -1;
        if (index < 0 && name) index = state.npcs.findIndex(npc => npcMatchesLabel(npc, name));
        if (index < 0) continue;
        const npc = state.npcs[index];
        if (excludeNames.has(normalizeName(npc.name))) continue;
        const result = applyDurableProfileUpdate(npc, raw, options);
        evidenceAdded += result.evidenceAdded;
        if (result.changed) {
            applied += 1;
            if (!report.updated.includes(npc.id)) report.updated.push(npc.id);
            if (!report.profileUpdated.includes(npc.id)) report.profileUpdated.push(npc.id);
        }
    }
    return { provided: rawUpdates.length, applied, evidenceAdded };
}

export function resolveInterimIdentityPromotions(scanResult, existingNpcs = [], candidates = []) {
    const clone = {
        ...(scanResult || {}),
        npcs: Array.isArray(scanResult?.npcs) ? scanResult.npcs.map(raw => ({ ...(raw || {}) })) : [],
    };
    const records = [
        ...(Array.isArray(existingNpcs) ? existingNpcs : []),
        ...(Array.isArray(candidates) ? candidates : []),
    ];
    for (const raw of clone.npcs) {
        const incoming = normalizeScanNpc(raw);
        if (!incoming.name || inferNpcIdentityKind(incoming.name, incoming.identityKind) !== 'proper_name') continue;
        const alreadyMatches = (Array.isArray(existingNpcs) ? existingNpcs : []).some(record =>
            (incoming.id && String(record?.id || '') === String(incoming.id))
            || npcMatchesLabel(record, incoming.name)
            || incoming.aliases.some(alias => npcMatchesLabel(record, alias)));
        if (alreadyMatches) continue;
        const matchIndex = findInterimIdentityPromotionIndex(records, incoming);
        if (matchIndex < 0) continue;
        const matched = records[matchIndex];
        // Candidate ids are intentionally not copied into dossier ids. Carry their old label as
        // an alias and let the normal candidate-promotion path create the dossier when appropriate.
        const isExistingDossier = (Array.isArray(existingNpcs) ? existingNpcs : []).some(record => record?.id === matched?.id);
        if (isExistingDossier) raw.id = matched.id;
        raw.aliases = mergeLists([matched.name, ...(matched.aliases || [])], raw.aliases, 8)
            .filter(alias => normalizeName(alias) !== normalizeName(incoming.name));
        raw.identityKind = 'proper_name';
        raw.sameIndividual = true;
    }
    return clone;
}


function explicitAliasLink(a, b) {
    if (!a || !b || a.id === b.id) return false;
    const aName = normalizeName(a.name);
    const bName = normalizeName(b.name);
    if (!aName || !bName) return false;
    const aAliases = new Set((a.aliases || []).map(normalizeName).filter(Boolean));
    const bAliases = new Set((b.aliases || []).map(normalizeName).filter(Boolean));
    return aAliases.has(bName) || bAliases.has(aName);
}

function duplicateRelationshipWeight(npc) {
    const rel = normalizeRelationshipBaseline(npc?.relationship || DEFAULT_RELATIONSHIP);
    return (npc?.relationshipEventHistory?.length || 0) * 20
        + RELATIONSHIP_KEYS.reduce((sum, key) => sum + Math.abs(Number(rel[key] || 0)), 0)
        + Number(npc?.seenCount || 0);
}

function chooseDuplicateCanonicalName(a, b) {
    const aName = normalizeName(a?.name);
    const bName = normalizeName(b?.name);
    const aClaimsB = (a?.aliases || []).some(alias => normalizeName(alias) === bName);
    const bClaimsA = (b?.aliases || []).some(alias => normalizeName(alias) === aName);
    // A record that explicitly carries the other record's label as its alias is the
    // strongest deterministic signal that its own name is the later canonical identity.
    if (aClaimsB !== bClaimsA) return aClaimsB ? a.name : b.name;
    const aInterim = isInterimNpcLabel(a?.name, a?.identityKind);
    const bInterim = isInterimNpcLabel(b?.name, b?.identityKind);
    if (aInterim !== bInterim) return aInterim ? b.name : a.name;
    const aUpdated = Number(a?.updatedAt || 0);
    const bUpdated = Number(b?.updatedAt || 0);
    return bUpdated > aUpdated ? b.name : a.name;
}

function mergeAliasLinkedNpcPair(a, b) {
    const canonicalName = cleanText(chooseDuplicateCanonicalName(a, b), 120) || a.name || b.name;
    const older = Number(a?.createdAt || Infinity) <= Number(b?.createdAt || Infinity) ? a : b;
    const newer = older === a ? b : a;
    const relationshipSource = duplicateRelationshipWeight(a) >= duplicateRelationshipWeight(b) ? a : b;
    const merged = structuredClone(older);
    merged.name = canonicalName;
    merged.identityKind = inferNpcIdentityKind(canonicalName, 'proper_name');
    merged.aliases = mergeLists(
        [a.name, ...(a.aliases || []), b.name, ...(b.aliases || [])],
        [], 8,
    ).filter(alias => normalizeName(alias) !== normalizeName(canonicalName));
    for (const field of ['role','species','age','apparentAge','personality','speech','appearance','background','relationshipSummary','mood','location','goal','status','lifeStateReason']) {
        const av = cleanText(a?.[field], field === 'appearance' ? 1800 : 1200);
        const bv = cleanText(b?.[field], field === 'appearance' ? 1800 : 1200);
        merged[field] = bv.length > av.length ? bv : av;
    }
    merged.memories = normalizeStoredMemories([...(a.memories || []), ...(b.memories || [])]);
    merged.mannerisms = normalizeMannerisms([...(a.mannerisms || []), ...(b.mannerisms || [])]);
    merged.behaviorProfile = normalizeBehaviorProfile([...(a.behaviorProfile || []), ...(b.behaviorProfile || [])]);
    merged.keyRelationships = mergeKeyRelationshipUpdates(a.keyRelationships || [], b.keyRelationships || []);
    merged.profileEvidence = normalizeProfileEvidence({
        personality: [...(a.profileEvidence?.personality || []), ...(b.profileEvidence?.personality || [])],
        speech: [...(a.profileEvidence?.speech || []), ...(b.profileEvidence?.speech || [])],
        appearance: [...(a.profileEvidence?.appearance || []), ...(b.profileEvidence?.appearance || [])],
        mannerisms: [...(a.profileEvidence?.mannerisms || []), ...(b.profileEvidence?.mannerisms || [])],
        behaviorProfile: [...(a.profileEvidence?.behaviorProfile || []), ...(b.profileEvidence?.behaviorProfile || [])],
    });
    merged.relationship = structuredClone(relationshipSource.relationship || DEFAULT_RELATIONSHIP);
    merged.relationshipProgress = structuredClone(relationshipSource.relationshipProgress || DEFAULT_RELATIONSHIP_PROGRESS);
    merged.relationshipMilestones = structuredClone(relationshipSource.relationshipMilestones || []);
    merged.relationshipEventHistory = structuredClone(relationshipSource.relationshipEventHistory || []);
    merged.lastRelationshipChange = structuredClone(relationshipSource.lastRelationshipChange || merged.lastRelationshipChange);
    const lifecycleSource = Number(a?.updatedAt || 0) >= Number(b?.updatedAt || 0) ? a : b;
    for (const field of ['present','worldActive','lifeState','lifeStateCertainty','archived','archiveReason','archivedAt','archiveSourceMessageId']) merged[field] = structuredClone(lifecycleSource?.[field]);
    merged.portrait = a?.portrait?.dataUrl ? structuredClone(a.portrait) : (b?.portrait?.dataUrl ? structuredClone(b.portrait) : (a?.portrait || b?.portrait || null));
    merged.portraitPromptPositive = cleanText(newer?.portraitPromptPositive || older?.portraitPromptPositive, 1800);
    merged.portraitPromptNegative = cleanText(newer?.portraitPromptNegative || older?.portraitPromptNegative, 1800);
    merged.portraitPromptReplace = Boolean(newer?.portraitPromptReplace || older?.portraitPromptReplace);
    merged.importance = Math.max(Number(a?.importance || 0), Number(b?.importance || 0));
    merged.seenCount = Math.max(Number(a?.seenCount || 0), Number(b?.seenCount || 0));
    merged.lastSeenTurn = Math.max(Number(a?.lastSeenTurn || 0), Number(b?.lastSeenTurn || 0));
    merged.lastWorldActiveTurn = Math.max(Number(a?.lastWorldActiveTurn || 0), Number(b?.lastWorldActiveTurn || 0));
    merged.createdAt = Math.min(Number(a?.createdAt || Date.now()), Number(b?.createdAt || Date.now()));
    merged.updatedAt = Math.max(Number(a?.updatedAt || 0), Number(b?.updatedAt || 0), Date.now());
    merged.manual = Boolean(a?.manual || b?.manual);
    merged.manualProfileLocksExplicit = Boolean(a?.manualProfileLocksExplicit || b?.manualProfileLocksExplicit);
    merged.manualProfileFields = [...new Set([...(a?.manualProfileFields || []), ...(b?.manualProfileFields || [])])];
    merged.retentionProtected = Boolean(a?.retentionProtected || b?.retentionProtected);
    merged.minor = Boolean(a?.minor && b?.minor);
    return normalizeNpcRecord(merged);
}

function consolidateAliasLinkedNpcDuplicates(next, report) {
    if (!Array.isArray(next?.npcs) || next.npcs.length < 2) return;
    if (!Array.isArray(report.deduplicated)) report.deduplicated = [];
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < next.npcs.length; i += 1) {
            for (let j = i + 1; j < next.npcs.length; j += 1) {
                const a = next.npcs[i]; const b = next.npcs[j];
                if (!explicitAliasLink(a, b)) continue;
                const aKind = inferNpcIdentityKind(a.name, a.identityKind);
                const bKind = inferNpcIdentityKind(b.name, b.identityKind);
                if (aKind === 'proper_name' && bKind === 'proper_name'
                    && !((a.aliases || []).some(alias => normalizeName(alias) === normalizeName(b.name))
                        || (b.aliases || []).some(alias => normalizeName(alias) === normalizeName(a.name)))) continue;
                const survivor = Number(a?.createdAt || Infinity) <= Number(b?.createdAt || Infinity) ? a : b;
                const removed = survivor === a ? b : a;
                const merged = mergeAliasLinkedNpcPair(a, b);
                merged.id = survivor.id;
                next.socialGraph = remapSocialGraphNpcId(next.socialGraph, removed.id, survivor.id);
                next.npcs[i] = merged;
                next.npcs.splice(j, 1);
                report.deduplicated.push({ keptId: survivor.id, removedId: removed.id, name: merged.name });
                if (!report.updated.includes(survivor.id)) report.updated.push(survivor.id);
                changed = true;
                break outer;
            }
        }
    }
}

export function mergeScanResult(state, scanResult, options = {}) {
    const maxNpcs = Math.max(1, Math.min(100, Number(options.maxNpcs) || 40));
    const excludeNames = new Set((options.excludeNames || []).map(normalizeName).filter(Boolean));
    const turn = Number(options.turn ?? state.turn ?? 0);
    const relationshipCaps = normalizeRelationshipCaps(options.relationshipCaps || DEFAULT_RELATIONSHIP_CAPS);
    const relationshipBaseline = normalizeRelationshipBaseline(options.relationshipBaseline || DEFAULT_RELATIONSHIP);
    const admissionMode = normalizeNpcAdmissionMode(options.admissionMode);
    const preservePresence = Boolean(options.preservePresence);
    const preserveWorldActive = preservePresence || Boolean(options.preserveWorldActive);
    const sourceMessageId = Number.isInteger(options.sourceMessageId) ? options.sourceMessageId : null;
    const lifecycleOptions = {
        autoArchiveDeaths: options.autoArchiveDeaths !== false,
        autoReactivateArchived: options.autoReactivateArchived !== false,
        skipRelationshipUpdate: Boolean(options.skipRelationshipUpdate),
        developmentContext: String(options.developmentContext || ''),
    };
    const incomingList = Array.isArray(scanResult?.npcs) ? scanResult.npcs : [];
    const normalizedCandidates = (Array.isArray(state?.candidates) ? state.candidates : [])
        .map(normalizeNpcCandidate)
        .filter(Boolean);
    const expiredCandidates = normalizedCandidates.filter(candidate => turn - Number(candidate.lastSeenTurn || 0) > NPC_CANDIDATE_TTL_TURNS);
    const next = {
        ...state,
        npcs: Array.isArray(state?.npcs) ? state.npcs.map(n => ({
            ...n,
            present: preservePresence ? Boolean(n.present) : false,
            worldActive: preserveWorldActive ? Boolean(n.worldActive) : false,
        })) : [],
        candidates: normalizedCandidates.filter(candidate => turn - Number(candidate.lastSeenTurn || 0) <= NPC_CANDIDATE_TTL_TURNS),
        socialGraph: state?.socialGraph && typeof state.socialGraph === 'object' ? structuredClone(state.socialGraph) : { version: 1, edges: [], unresolved: [] },
    };
    const report = { created: [], updated: [], profileUpdated: [], renamed: [], deduplicated: [], candidates: [], promoted: [], expired: expiredCandidates.map(c => c.name), skipped: [], profileUpdateStats: { provided: 0, applied: 0, evidenceAdded: 0 } };

    const createFromIncoming = incoming => {
        if (next.npcs.filter(npc => !npc?.archived).length >= maxNpcs) {
            report.skipped.push(incoming.name);
            return null;
        }
        const ids = next.npcs.map(n => n.id);
        const record = createNpcRecord(incoming.name, ids, relationshipBaseline);
        record.manual = false;
        const merged = applyIncoming(record, incoming, turn, relationshipCaps, sourceMessageId, lifecycleOptions);
        next.npcs.push(merged);
        report.created.push(merged.id);
        return merged;
    };

    for (const raw of incomingList) {
        const incoming = normalizeScanNpc(raw);
        let existingIndex = incoming.id ? next.npcs.findIndex(existing => existing.id === incoming.id) : -1;
        if (existingIndex >= 0 && !incoming.name) incoming.name = next.npcs[existingIndex].name;
        const key = normalizeName(incoming.name);
        if (!key || excludeNames.has(key)) {
            report.skipped.push(incoming.name || incoming.id || '(unnamed)');
            continue;
        }

        if (existingIndex < 0) existingIndex = next.npcs.findIndex(existing => candidateMatches(existing, incoming));
        if (existingIndex < 0) existingIndex = findInterimIdentityPromotionIndex(next.npcs, incoming);
        if (existingIndex >= 0) {
            const previousName = next.npcs[existingIndex].name;
            next.npcs[existingIndex] = applyIncoming(next.npcs[existingIndex], incoming, turn, relationshipCaps, sourceMessageId, lifecycleOptions);
            report.updated.push(next.npcs[existingIndex].id);
            if (normalizeName(previousName) !== normalizeName(next.npcs[existingIndex].name)) {
                report.renamed.push({ id: next.npcs[existingIndex].id, from: previousName, to: next.npcs[existingIndex].name });
            }
            next.candidates = next.candidates.filter(candidate => !candidateRecordMatches(candidate, incoming));
            continue;
        }

        let candidateIndex = next.candidates.findIndex(candidate => candidateRecordMatches(candidate, incoming));
        if (candidateIndex < 0) candidateIndex = findInterimIdentityPromotionIndex(next.candidates, incoming);
        if (shouldCreateDossierImmediately(incoming, admissionMode)) {
            if (candidateIndex >= 0) {
                const priorCandidate = next.candidates[candidateIndex];
                if (incoming.sameIndividual && inferNpcIdentityKind(incoming.name, incoming.identityKind) === 'proper_name'
                    && normalizeName(priorCandidate?.name) !== normalizeName(incoming.name)) {
                    incoming.aliases = mergeLists([priorCandidate.name, ...(priorCandidate.aliases || [])], incoming.aliases, 8)
                        .filter(alias => normalizeName(alias) !== normalizeName(incoming.name));
                }
                next.candidates.splice(candidateIndex, 1);
            }
            const created = createFromIncoming(incoming);
            if (created && candidateIndex >= 0) report.promoted.push(created.id);
            continue;
        }

        if (candidateIndex >= 0) {
            const candidate = next.candidates[candidateIndex];
            if (incoming.sameIndividual) {
                candidate.aliases = mergeLists(candidate.aliases, incoming.aliases, 6);
                candidate.identityKind = incoming.identityKind || candidate.identityKind;
                candidate.dossierSignal = incoming.dossierSignal || candidate.dossierSignal;
                candidate.dossierReason = incoming.dossierReason || candidate.dossierReason;
                candidate.role = cleanText(incoming.role || candidate.role, 180);
                candidate.location = cleanText(incoming.location || candidate.location, 220);
                candidate.seenCount = Math.min(99, Number(candidate.seenCount || 1) + 1);
                candidate.lastSeenTurn = turn;
                candidate.importance = Math.max(Number(candidate.importance || 0), Number(incoming.importance || 0));
                if (shouldPromoteCandidate(candidate, incoming, admissionMode)) {
                    next.candidates.splice(candidateIndex, 1);
                    const created = createFromIncoming(incoming);
                    if (created) report.promoted.push(created.id);
                    continue;
                }
            }
            report.candidates.push(candidate.id);
            continue;
        }

        if (next.candidates.length >= NPC_CANDIDATE_LIMIT) {
            report.skipped.push(incoming.name);
            continue;
        }
        const candidate = makeNpcCandidate(incoming, turn, next.candidates.map(c => c.id));
        next.candidates.push(candidate);
        report.candidates.push(candidate.id);
    }

    // Durable-profile decisions are independent of ordinary NPC delta admission. This lets
    // Personality/Speech/Appearance/Mannerisms accumulate evidence and refine even when the
    // scanner had no live-state delta worth returning for that NPC.
    report.profileUpdateStats = applyDurableProfileUpdates(next, scanResult, excludeNames, report, { developmentContext: options.developmentContext || '' });

    // Social edges are independent of NPC delta admission. This lets an explicit relationship
    // reveal update a stored dossier even when the scanner returned no ordinary NPC object.
    applyKeyRelationshipEdges(next, scanResult, excludeNames, report);

    // Canonical identity promotion is global: once an interim label becomes a proper name,
    // structured references in neighboring dossiers and the hidden social graph must follow
    // the stable NPC id rather than fossilizing both labels as separate people.
    consolidateAliasLinkedNpcDuplicates(next, report);
    for (const id of canonicalizeNpcKeyRelationships(next.npcs)) if (!report.updated.includes(id)) report.updated.push(id);
    const social = reconcileSocialState(next, {
        scanResult,
        transcript: options.developmentContext || '',
        provenance: 'scanner',
        confidence: 'explicit',
        sourceMessageId,
        turn,
    });
    next.socialGraph = social.socialGraph;
    next.npcs = social.state.npcs;
    for (const id of social.updatedIds || []) if (!report.updated.includes(id)) report.updated.push(id);

    // Final canonicalization is a hard guard against append-only drift from either
    // normal NPC deltas or the independent profile/social channels.
    next.npcs = next.npcs.map(npc => {
        const current = { ...npc };
        // By merge time runtime state has already passed legacy-lock migration. Any
        // remaining manualProfileFields therefore represent current explicit intent.
        if (Array.isArray(current.manualProfileFields) && current.manualProfileFields.length) current.manualProfileLocksExplicit = true;
        return normalizeNpcRecord(current);
    });

    next.npcs.sort((a, b) => {
        const seen = Number(b.lastSeenTurn || 0) - Number(a.lastSeenTurn || 0);
        if (seen !== 0) return seen;
        return Number(b.importance || 0) - Number(a.importance || 0);
    });
    next.candidates.sort((a, b) => Number(b.lastSeenTurn || 0) - Number(a.lastSeenTurn || 0));
    return { state: next, report };
}

function relationshipBand(value) {
    const n = Math.round(clamp(value, -100, 100));
    if (n <= -70) return 'strongly negative';
    if (n <= -30) return 'negative';
    if (n < 30) return 'neutral/unsettled';
    if (n < 70) return 'positive';
    return 'strongly positive';
}

function signedScore(value) {
    const n = Math.round(clamp(value, -100, 100));
    return n > 0 ? `+${n}` : String(n);
}

export function buildBehaviorGuidance(npc) {
    const rel = normalizeRelationshipBaseline(npc?.relationship || DEFAULT_RELATIONSHIP);
    const material = RELATIONSHIP_KEYS
        .map(key => ({ key, value: rel[key], magnitude: Math.abs(rel[key]) }))
        .filter(item => item.magnitude >= 30)
        .sort((a, b) => b.magnitude - a.magnitude || RELATIONSHIP_KEYS.indexOf(a.key) - RELATIONSHIP_KEYS.indexOf(b.key));
    if (!material.length) return 'relationship remains mostly neutral or unsettled; let identity, goals, and current state drive behavior';

    const cues = [];
    for (const { key, value } of material) {
        if (key === 'trust') {
            if (value <= -70) cues.push('strong distrust: protect self and verify claims');
            else if (value <= -30) cues.push('distrust: remain guarded about reliance');
            else if (value < 70) cues.push('trust: some extra candor/reliance is plausible');
            else cues.push('strong trust: vulnerability/reliance is permitted when identity and context allow');
        } else if (key === 'affection') {
            if (value <= -70) cues.push('strong resentment/dislike may cool treatment');
            else if (value <= -30) cues.push('dislike/resentment is established');
            else if (value < 70) cues.push('affection: modest extra concern/attention may appear through established care style');
            else cues.push('strong affection: high emotional importance, not devotion or self-erasure');
        } else if (key === 'desire') {
            if (value <= -70) cues.push('strong aversion to intimate/romantic closeness');
            else if (value <= -30) cues.push('aversion to intimate/romantic closeness is established');
            else if (value < 70) cues.push('attraction may subtly color attention only when context supports it');
            else cues.push('strong desire may affect attention/proximity only through established expressiveness and consent');
        } else if (key === 'tension') {
            if (value <= -70) cues.push('exceptional ease/safety may lower interpersonal pressure');
            else if (value <= -30) cues.push('noticeable ease/reduced pressure is established');
            else if (value < 70) cues.push('unresolved pressure may affect delivery only in the form the scene supports');
            else cues.push('strong unresolved pressure matters, but does not imply jealousy, embarrassment, hostility, or denial');
        }
    }
    const combinations = [];
    if (rel.trust >= 70 && rel.tension >= 70) combinations.push('familiarity and strain coexist');
    if (rel.affection >= 70 && rel.trust <= -30) combinations.push('care does not erase distrust');
    if (rel.desire >= 70 && rel.trust <= -30) combinations.push('attraction does not imply safety or trust');
    return [...combinations, ...cues].join('; ');
}

export function scoreNpcRelevance(npc, text, turn = 0, socialGraph = null, allNpcs = []) {
    const haystack = normalizeName(text);
    let score = 0;
    for (const label of [npc.name, ...(npc.aliases || [])]) {
        const needle = normalizeName(label);
        if (needle && countNormalizedPhrase(haystack, needle) > 0) score += label === npc.name ? 8 : 5;
    }
    const canonicalTokens = normalizeName(npc.name).split(/\s+/).filter(Boolean);
    if (canonicalTokens.length > 1 && canonicalTokens[0].length >= 4 && countNormalizedPhrase(haystack, canonicalTokens[0]) > 0) score += 6;
    const role = normalizeName(npc.role);
    if (role && countNormalizedPhrase(haystack, role) > 0) score += 3;
    for (const entry of cleanList(npc.keyRelationships, KEY_RELATIONSHIP_LIMIT, DURABLE_PROFILE_LIMITS.keyRelationship)) {
        const subject = keyRelationshipSubject(entry);
        if (subject && countNormalizedPhrase(haystack, subject) > 0) score += 2;
    }
    for (const label of socialGraphLabelsForNpc(socialGraph, npc.id, allNpcs)) {
        const subject = normalizeName(label);
        if (subject && countNormalizedPhrase(haystack, subject) > 0) score += 2;
    }
    const goalSimilarity = npc.goal ? durableSemanticSimilarity(npc.goal, text) : 0;
    if (goalSimilarity >= 0.35) score += Math.max(1, Math.round(goalSimilarity * 4));
    const memoryMatch = cleanList(npc.memories, IMPORTANT_MEMORY_LIMIT, DURABLE_PROFILE_LIMITS.memory)
        .some(memory => durableSemanticSimilarity(memory, text) >= 0.42);
    if (memoryMatch) score += 1;
    const age = Math.max(0, Number(turn) - Number(npc.lastSeenTurn || 0));
    score += Math.max(0, 4 - age);
    // Importance remains durable/manual metadata. Runtime prompt-space selection uses
    // calculated salience from the current story context instead of mutating or scoring by it.
    return score;
}

export function selectRelevantNpcs(npcs, text, turn = 0, limit = 3, socialGraph = null, graphRegistry = null) {
    const all = [...(npcs || [])];
    const registry = Array.isArray(graphRegistry) ? graphRegistry : all;
    return all
        .map(npc => ({ npc, score: scoreNpcRelevance(npc, text, turn, socialGraph, registry) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, limit))
        .map(item => item.npc);
}

export const DEFAULT_INJECTION_BUDGET_TOKENS = 1800;
export const MIN_INJECTION_BUDGET_TOKENS = 512;
export const MAX_INJECTION_BUDGET_TOKENS = 6000;
const APPROX_CHARS_PER_TOKEN = 4;

export function normalizeInjectionBudgetTokens(value) {
    return Math.max(MIN_INJECTION_BUDGET_TOKENS, Math.min(MAX_INJECTION_BUDGET_TOKENS, Math.round(Number(value) || DEFAULT_INJECTION_BUDGET_TOKENS)));
}

export function estimateInjectionTokens(text) {
    return Math.ceil(String(text || '').length / APPROX_CHARS_PER_TOKEN);
}

function truncateInjectionText(value, maxChars) {
    const text = String(value || '').trim();
    const cap = Math.max(0, Math.floor(maxChars));
    if (!text || cap <= 0) return '';
    if (text.length <= cap) return text;
    if (cap <= 1) return text.slice(0, cap);
    return `${text.slice(0, cap - 1).trimEnd()}…`;
}

function fairInjectionParts(parts, maxChars) {
    const entries = (Array.isArray(parts) ? parts : []).map(value => String(value || '').trim()).filter(Boolean);
    const cap = Math.max(0, Math.floor(maxChars));
    if (!entries.length || cap <= 0) return '';
    if (entries.length === 1) return truncateInjectionText(entries[0], cap);
    const separators = (entries.length - 1) * 2;
    const usable = Math.max(entries.length * 20, cap - separators);
    const share = Math.max(20, Math.floor(usable / entries.length));
    const itemCaps = entries.map(() => share);
    let rendered = entries.map((entry, i) => truncateInjectionText(entry, itemCaps[i]));
    let used = rendered.join('; ').length;
    let remaining = Math.max(0, cap - used);
    // Redistribute unused room to the fields that were actually truncated, so short fields
    // do not waste the budget while every established identity channel still gets a seat.
    for (let rounds = 0; rounds < entries.length * 3 && remaining > 0; rounds += 1) {
        let best = -1;
        let bestNeed = 0;
        for (let i = 0; i < entries.length; i += 1) {
            const need = entries[i].length - rendered[i].length;
            if (need > bestNeed) { bestNeed = need; best = i; }
        }
        if (best < 0 || bestNeed <= 0) break;
        const add = Math.min(bestNeed, remaining, 80);
        itemCaps[best] += add;
        rendered[best] = truncateInjectionText(entries[best], itemCaps[best]);
        used = rendered.join('; ').length;
        remaining = Math.max(0, cap - used);
    }
    return truncateInjectionText(rendered.join('; '), cap);
}

function compactBehaviorProfileForInjection(value, maxChars = 180) {
    const entries = orderedBehaviorProfile(value);
    if (!entries.length) return '';
    const compact = entries.map(item => {
        const match = item.match(/^([\p{L}][\p{L}\p{N} _\-/]{1,36})\s*:\s*(.*)$/u);
        if (!match) return truncateInjectionText(item, 28);
        const label = match[1].trim();
        const body = match[2].trim();
        const firstClause = body.split(/[.;]/, 1)[0].trim();
        const words = firstClause.split(/\s+/).filter(Boolean);
        const head = truncateInjectionText(words.slice(0, 3).join(' ') || body, 26);
        return head ? `${label}: ${head}` : label;
    });
    return truncateInjectionText(compact.join(' | '), maxChars);
}

function injectionIdentityCore(npc, identityCap = 540) {
    const parts = [
        npc.personality && `personality: ${npc.personality}`,
        npc.behaviorProfile?.length && `behavioral profile: ${compactBehaviorProfileForInjection(npc.behaviorProfile, 220)}`,
        npc.speech && `established speech: ${npc.speech}`,
        npc.mannerisms?.length && `established mannerisms: ${npc.mannerisms.join(', ')}`,
    ].filter(Boolean);
    return fairInjectionParts(parts, identityCap) || 'not yet established; do not invent an archetype to fill the gap';
}

function injectionAgencyCore(npc, agencyCap = 260) {
    const bonds = cleanList(npc.keyRelationships, Math.min(3, KEY_RELATIONSHIP_LIMIT), 150);
    const parts = [
        npc.role && `role: ${npc.role}`,
        npc.goal && `current goal: ${npc.goal}`,
        bonds.length && `key relationships: ${bonds.join(' | ')}`,
    ].filter(Boolean);
    return fairInjectionParts(parts, agencyCap) || 'no additional agency facts established';
}

function injectionCurrentStateCore(npc, stateCap = 180) {
    const parts = [
        npc.mood && `mood: ${npc.mood}`,
        npc.status && `status: ${npc.status}`,
    ].filter(Boolean);
    return fairInjectionParts(parts, stateCap) || 'no overriding live emotional/condition state established';
}

function compactRelationshipModifier(npc, behaviorCap = 160) {
    const rel = normalizeRelationshipBaseline(npc?.relationship || DEFAULT_RELATIONSHIP);
    const summary = calibrateRelationshipSummary(npc?.relationshipSummary, rel);
    if (summary && relationshipSummaryConsistent(summary, rel)) return truncateInjectionText(summary, behaviorCap);
    return truncateInjectionText(buildBehaviorGuidance(npc), behaviorCap);
}

function injectionEssentialBlock(npc, behaviorCap = 160, identityCap = 620, agencyCap = 300, stateCap = 180) {
    const identity = injectionIdentityCore(npc, identityCap);
    const agency = injectionAgencyCore(npc, agencyCap);
    const currentState = injectionCurrentStateCore(npc, stateCap);
    const relationship = compactRelationshipModifier(npc, behaviorCap);
    return `- ${npc.name}: IDENTITY (authoritative): ${identity}; AGENCY/OTHER BONDS: ${agency}; CURRENT STATE: ${currentState}; PLAYER RELATIONSHIP (secondary modifier): ${relationship}`;
}

function injectionOptionalFields(npc) {
    const importantMemories = cleanList(npc.memories, IMPORTANT_MEMORY_LIMIT, 220);
    return [
        importantMemories.length && `important memories: ${importantMemories.join(' | ')}`,
        npc.species && `species/race: ${npc.species}`,
        npc.age && `chronological age: ${npc.age}`,
        npc.apparentAge && `apparent age: ${npc.apparentAge}`,
        npc.location && `location: ${npc.location}`,
    ].filter(Boolean);
}

function compactInjectionBehaviorRubric(criteria, maxChars) {
    const raw = String(criteria || '').trim();
    if (!raw) return '';
    if (raw === DEFAULT_BEHAVIOR_CRITERIA) {
        return truncateInjectionText('Identity/current state decide behavior first. Relationship only biases player-directed weighting; it need not surface every scene and never implies obedience, devotion, romance tropes, or reduced empathy toward others.', maxChars);
    }
    return truncateInjectionText(raw, maxChars);
}

export function buildInjection(npcs, text, turn = 0, limit = 3, behaviorCriteria = DEFAULT_BEHAVIOR_CRITERIA, budgetTokens = DEFAULT_INJECTION_BUDGET_TOKENS, socialGraph = null) {
    const present = (npcs || []).filter(npc => Boolean(npc?.present) && !npc?.archived);
    let relevant = selectRelevantNpcs(present, text, turn, limit, socialGraph, npcs || []);
    if (!relevant.length) return '';

    const budget = normalizeInjectionBudgetTokens(budgetTokens);
    const budgetChars = budget * APPROX_CHARS_PER_TOKEN;
    const header = [
        'NPC STATE DOSSIER. Only confirmed-present NPCs are included. Treat these as established story facts; never mention the dossier or numeric values.',
        'IDENTITY FIRST / DOMINATES: personality, behavioral profile, speech, mannerisms, goals, duties, morality, independence, other bonds, and CURRENT mood/status determine behavior first.',
        'PLAYER RELATIONSHIP IS SECONDARY: it may bias attention, interpretation, openness, tolerance, or willingness toward the player, but need not surface every scene. High scores never mean obedience, universal prioritization, clinginess, jealousy, tsundere behavior, or cruelty toward others.',
        'Temporary mood, stress, intimacy, or player-specific behavior is not global identity. Durable identity changes gradually unless narration explicitly establishes lasting development or a developmental time skip.',
    ].join('\n');

    // Identity and agency are structural, not optional enrichment. Drop lower-ranked NPCs before
    // sacrificing the top NPC's personality/voice/mannerisms or non-player goals and bonds.
    let behaviorCap = 160;
    let identityCap = 620;
    let agencyCap = 300;
    let stateCap = 180;
    const renderEssentials = () => relevant.map(npc => injectionEssentialBlock(npc, behaviorCap, identityCap, agencyCap, stateCap));
    while (relevant.length > 1 && (header.length + 1 + renderEssentials().join('\n').length) > budgetChars) {
        relevant = relevant.slice(0, -1);
    }
    let essentialBlocks = renderEssentials();
    while ((header.length + 1 + essentialBlocks.join('\n').length) > budgetChars
        && (behaviorCap > 80 || identityCap > 260 || agencyCap > 140 || stateCap > 100)) {
        behaviorCap = Math.max(80, behaviorCap - 20);
        identityCap = Math.max(260, identityCap - 50);
        agencyCap = Math.max(140, agencyCap - 30);
        stateCap = Math.max(100, stateCap - 20);
        essentialBlocks = renderEssentials();
    }

    let lines = [header, ...essentialBlocks];
    let currentLength = lines.join('\n').length;
    if (currentLength > budgetChars) {
        // The minimum-budget last resort keeps the priority order: header -> identity/agency ->
        // relationship expression. Because every identity field is compacted independently,
        // this no longer silently starves Speech/Mannerisms behind a long Personality field.
        return truncateInjectionText(lines.join('\n'), budgetChars);
    }

    // Relationship rubric is useful, but subordinate to the actual NPC. Stock wording is compiled
    // to a tiny semantic rubric; custom user criteria are retained only as space permits.
    const rubricAllowance = Math.min(600, Math.max(100, Math.floor(budgetChars * 0.08)));
    const rubricText = compactInjectionBehaviorRubric(behaviorCriteria, rubricAllowance);
    if (rubricText) {
        const fullRubric = `RELATIONSHIP-TO-BEHAVIOR RUBRIC: ${rubricText}`;
        const room = budgetChars - currentLength - 1;
        if (room >= 90) {
            lines.push(truncateInjectionText(fullRubric, room));
            currentLength = lines.join('\n').length;
        }
    }

    // Optional continuity then fills remaining room round-robin so one verbose dossier cannot
    // starve another. Relationship summary is deliberately late: live identity/state already won priority.
    const optionalByNpc = relevant.map(injectionOptionalFields);
    const enriched = essentialBlocks.slice();
    const maxPriority = Math.max(0, ...optionalByNpc.map(fields => fields.length));
    for (let priority = 0; priority < maxPriority; priority++) {
        for (let i = 0; i < relevant.length; i++) {
            const field = optionalByNpc[i][priority];
            if (!field) continue;
            const addition = `; ${field}`;
            if ((currentLength + addition.length) <= budgetChars) {
                enriched[i] += addition;
                currentLength += addition.length;
            }
        }
    }

    // Rebuild with enriched NPC lines while preserving rubric placement.
    const rubricLine = lines.find(line => line.startsWith('RELATIONSHIP-TO-BEHAVIOR RUBRIC:')) || '';
    const finalLines = [header, ...enriched, rubricLine].filter(Boolean);
    return truncateInjectionText(finalLines.join('\n'), budgetChars);
}

export function selectScannerContextNpcs(existingNpcs = [], transcript = '', limit = 4) {
    const cap = Math.max(1, Math.min(8, Number(limit) || 4));
    const list = Array.isArray(existingNpcs) ? existingNpcs : [];
    const scored = list.map((npc, index) => ({
        npc,
        index,
        mentionScore: scannerNpcMentionScore(npc, transcript),
    }));
    const mentioned = scored
        .filter(item => item.mentionScore > 0)
        .sort((a, b) => b.mentionScore - a.mentionScore
            || Number(b.npc?.lastSeenTurn || 0) - Number(a.npc?.lastSeenTurn || 0)
            || a.index - b.index);
    const selected = mentioned.slice(0, cap);

    // Role-only prose may not contain the proper name. Keep one recent dossier as a
    // continuity hint when nothing can be matched lexically, but never pad every scan
    // with two unrelated full dossiers as older releases did.
    if (!selected.length) {
        const recent = scored
            .filter(item => !item.npc?.archived)
            .sort((a, b) => Number(b.npc?.lastSeenTurn || 0) - Number(a.npc?.lastSeenTurn || 0)
                || Number(b.npc?.seenCount || 0) - Number(a.npc?.seenCount || 0));
        if (recent.length) selected.push(recent[0]);
    }
    return selected.slice(0, cap).map(item => item.npc);
}

function selectScannerProfileContextNpcs(existingNpcs = [], transcript = '', limit = 2) {
    const cap = Math.max(1, Math.min(3, Number(limit) || 2));
    const scored = (Array.isArray(existingNpcs) ? existingNpcs : [])
        .map((npc, index) => ({ npc, index, score: scannerNpcMentionScore(npc, transcript) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);
    if (!scored.length) {
        const fallback = [...(Array.isArray(existingNpcs) ? existingNpcs : [])]
            .filter(npc => !npc?.archived)
            .sort((a, b) => Number(Boolean(b?.present)) - Number(Boolean(a?.present))
                || Number(Boolean(b?.worldActive)) - Number(Boolean(a?.worldActive))
                || Number(b?.lastSeenTurn || 0) - Number(a?.lastSeenTurn || 0));
        return fallback.length ? [fallback[0]] : [];
    }
    const result = [scored[0]];
    const secondThreshold = Math.max(8, scored[0].score * 0.45);
    for (const item of scored.slice(1)) {
        if (result.length >= cap) break;
        if (item.score >= secondThreshold) result.push(item);
    }
    return result.map(item => item.npc);
}

function compactScannerWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compactRelationshipRubric(value) {
    const configured = compactScannerWhitespace(value);
    const stock = compactScannerWhitespace(DEFAULT_RELATIONSHIP_CRITERIA);
    if (!configured || configured === stock) {
        return 'Axes independent; 0 neutral; unsupported axes stay 0. Trust=reliance/safety, Affection=care, Desire=established attraction, Tension=pressure. Routine continuation is no change.';
    }
    return configured;
}

function compactImpactRubric(value) {
    const configured = compactScannerWhitespace(value);
    const stock = compactScannerWhitespace(DEFAULT_IMPACT_CRITERIA);
    if (!configured || configured === stock) {
        return 'none=no new evidence/continuation; ordinary=new modest beat; meaningful=clear new event; major=lasting turning point; extreme=rare defining event.';
    }
    return configured;
}

function compactMemoryRubric(value) {
    const configured = compactScannerWhitespace(value);
    const stock = compactScannerWhitespace(DEFAULT_MEMORY_CRITERIA);
    if (!configured || configured === stock) {
        return 'Store durable story-relevant events affecting later decisions/relationships/goals/obligations/fears/knowledge. Favor promises, betrayals, rescues, confessions, major discoveries/conflicts/losses/commitments. Reject routine dialogue/transactions, transient/repeated facts/raw Inner Chatter/trivia/duplicates.';
    }
    return configured;
}

function countNormalizedPhrase(haystack, phrase) {
    if (!haystack || !phrase) return 0;
    const needle = ` ${phrase} `;
    let count = 0;
    let offset = 0;
    const padded = ` ${haystack} `;
    while ((offset = padded.indexOf(needle, offset)) !== -1) {
        count += 1;
        offset += Math.max(1, needle.length - 1);
    }
    return count;
}

function scannerNpcMentionScore(npc, transcript) {
    const raw = String(transcript || '');
    const mainRaw = raw.split(/\b(?:World State|NPC Inner Chatter)\s*:/i)[0] || raw;
    const whole = normalizeName(raw);
    const main = normalizeName(mainRaw);
    const canonicalName = cleanText(npc?.name, 120);
    const shortName = canonicalName.split(/\s+/).filter(Boolean)[0] || '';
    const labels = [canonicalName, shortName, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]
        .map(normalizeName)
        .filter(Boolean)
        .filter((label, index, array) => array.indexOf(label) === index);
    let score = 0;
    for (const label of labels) {
        const mainCount = countNormalizedPhrase(main, label);
        const wholeCount = countNormalizedPhrase(whole, label);
        score += (mainCount * 6) + Math.max(0, wholeCount - mainCount) * 2;
    }
    const role = normalizeName(npc?.role);
    if (role) {
        const roleMain = countNormalizedPhrase(main, role);
        const roleWhole = countNormalizedPhrase(whole, role);
        score += (roleMain * 3) + Math.max(0, roleWhole - roleMain);
    }
    return score;
}


export function buildBackfillPrompt({
    transcript,
    targetName = '',
    existingNpc = null,
    userName = 'User',
    charName = 'Character',
    memoryCriteria = DEFAULT_MEMORY_CRITERIA,
}) {
    const target = cleanText(targetName, 120);
    const existing = existingNpc ? {
        id: cleanText(existingNpc.id, 100),
        name: cleanText(existingNpc.name, 120),
        aliases: cleanList(existingNpc.aliases, 8, 120),
        role: cleanText(existingNpc.role, 300),
        species: cleanText(existingNpc.species, 160),
        age: cleanText(existingNpc.age, 80),
        apparentAge: cleanText(existingNpc.apparentAge, 80),
        appearance: cleanText(existingNpc.appearance, 500),
        personality: cleanText(existingNpc.personality, 280),
        speech: cleanText(existingNpc.speech, 240),
        behaviorProfile: normalizeBehaviorProfile(existingNpc.behaviorProfile),
        background: cleanText(existingNpc.background, 320),
        keyRelationships: cleanList(existingNpc.keyRelationships, KEY_RELATIONSHIP_LIMIT, 180),
        relationshipSummary: cleanText(existingNpc.relationshipSummary, 280),
        location: cleanText(existingNpc.location, 300),
        goal: cleanText(existingNpc.goal, 500),
        status: cleanText(existingNpc.status, 500),
        memories: cleanList(existingNpc.memories, IMPORTANT_MEMORY_LIMIT, 180),
    } : null;
    const memoryRubric = compactMemoryRubric(memoryCriteria);

    return `You are NPC State's targeted dossier backfill extractor. The player EXPLICITLY chose to keep one NPC. Do not decide whether the NPC is important or dossier-worthy. Your only task is to find that requested individual in the supplied recent story history and recover grounded dossier facts.

Requested NPC: ${target || '(missing target)'}
Player/main character to exclude: ${userName}
Main card speaker to exclude: ${charName}
Existing partial dossier (identity hint only): ${JSON.stringify(existing)}

Rules:
1. Search the ENTIRE supplied history for the requested NPC. Match the requested personal name, an expanded full name, a known alias, or an unmistakable role reference tied to that same individual.
2. World State and NPC Inner Chatter are valid identity/evidence sections. A proper name established there can link nearby prose that calls the same person only by role, such as receptionist, guard, merchant, or clerk.
3. If the requested NPC is found, RETURN EXACTLY ONE NPC object. Do not return other NPCs. If the target genuinely does not occur and cannot be linked to a role/alias in this history, return {"npcs":[]}.
4. Preserve literal Species / Race. AGE is chronology only. APPARENT AGE is visual presentation and should be a compact approximate number like ~6 or ~24 when inferable; never prose such as "around six/twenties". Never infer fantasy lifespan from species.
5. Appearance contains grounded visible facts only and must not repeat an explicit numeric/word-form age; Apparent Age owns visual age. Do not invent missing face, hair, eyes, body, outfit, or other traits.
6. Recover CURRENT COMPACT SUMMARIES, not notes. Important Memories are capped at 5. Key relationships=max5, ONE unambiguous entry/counterpart; never use dangling "(deceased)" that could modify the wrong person. Mannerisms=max4 DISTINCT recurring patterns, not separate animations of the same habit. behaviorProfile=max6 target-general rules; route player-specific patterns to relationshipSummary, one-off states to live fields, and consequential incidents to Memories. Do not fill labels without evidence. Memories=max5 distinct events; if crowded return memoryRetention=top5 most consequential/durable.
7. NPC Inner Chatter may support durable personality, goals, attitude, or relationship-summary evidence, but do not store the moment-to-moment internal monologue itself.
8. PRESENT is current-scene state, not historical presence. Set present=true only if the requested NPC physically appears or actively participates in the MOST RECENT ASSISTANT STORY MESSAGE contained in this history. An older appearance does not count. A World State mention alone does not establish presence. Set worldActive=true only for explicit current off-screen activity in the latest World State; present and worldActive are mutually exclusive.
9. This is historical backfill. relationshipImpact MUST be "none" and every relationshipDelta value MUST be 0. Do not numerically replay old relationship events.
10. Do not create a dossier for ${userName} or ${charName}.
11. Keep the JSON compact enough to finish reliably: appearance<=500; personality<=280; speech<=240; background<=320; relationshipSummary<=280; mannerism<=140; behaviorProfile max6/180; keyRelationship/memory<=180. Merge overlaps rather than append. Unknown facts may be empty. Importance is manual metadata; do not infer/change it.
12. Output JSON only. No markdown, no code fence, no commentary. Finish and close every quoted string, array, and object before stopping.

Memory criteria:
${memoryRubric || '(none configured; store only clearly durable story-relevant events)'}

Return this shape:
{"npcs":[{"id":"existing id if supplied","name":"canonical personal name or stable requested label","aliases":["known alias or requested label when name expands"],"identityKind":"proper_name|role_label","dossierSignal":"incidental|meaningful|persistent","dossierReason":"brief grounded note","sameIndividual":true,"directInteraction":false,"role":"occupation/story role","species":"literal species/race","age":"chronological age only or empty","apparentAge":"visual age cue or empty","appearance":"grounded prompt-ready visual description","personality":"established traits","speech":"established speech habits","behaviorProfile":["Disposition: grounded target-general behavior"],"background":"established background","keyRelationships":["Name — relationship | durable current dynamic"],"relationshipSummary":"brief durable stance toward ${userName}","mood":"current/last established mood","location":"current/last known location","goal":"current/last established goal","status":"condition/immediate state","lifeState":"unknown|alive|deceased","lifeStateCertainty":"explicit|inferred|","lifeStateReason":"brief grounded reason","relationshipImpact":"none","relationshipDelta":{"trust":0,"affection":0,"desire":0,"tension":0},"relationshipEvidence":{"trust":"","affection":"","desire":"","tension":""},"relationshipChangeReason":"","mannerisms":["established habit"],"memories":["important established event"],"importance":0,"present":false,"worldActive":false}]}

Recent story history:
${String(transcript || '').trim()}`;
}


export function buildDossierImportPrompt({
    dossierText,
    targetName = '',
    existingNpc = null,
    userName = 'User',
    charName = 'Character',
}) {
    const target = cleanText(targetName, 120);
    const existing = existingNpc ? {
        id: cleanText(existingNpc.id, 100), name: cleanText(existingNpc.name, 120),
        aliases: cleanList(existingNpc.aliases, 8, 120), role: cleanText(existingNpc.role, 240),
        species: cleanText(existingNpc.species, 160), age: cleanText(existingNpc.age, 80),
        apparentAge: cleanText(existingNpc.apparentAge, 80), appearance: cleanText(existingNpc.appearance, 500),
        personality: cleanText(existingNpc.personality, 280), speech: cleanText(existingNpc.speech, 240),
        behaviorProfile: normalizeBehaviorProfile(existingNpc.behaviorProfile),
        background: cleanText(existingNpc.background, 320), keyRelationships: cleanList(existingNpc.keyRelationships, KEY_RELATIONSHIP_LIMIT, 180),
        relationshipSummary: cleanText(existingNpc.relationshipSummary, 280), mannerisms: cleanList(existingNpc.mannerisms, 4, 140),
    } : null;
    return `NPC State explicit DOSSIER IMPORT. The player deliberately asked to populate one existing NPC from the supplied structured dossier text. Use ONLY that dossier text, not outside knowledge. Return exactly one compact NPC object for the requested person, or {"npcs":[]} if it is clearly a different person.

Requested NPC: ${target}
Player (exclude from Key Relationships): ${userName}
Main card speaker: ${charName}
Existing NPC State record: ${JSON.stringify(existing)}

Mapping/rules:
1. Inner Circle / family / close allies / rivals / mentors / partners => keyRelationships, max ${KEY_RELATIONSHIP_LIMIT}, one concise unambiguous "Name — relation | durable dynamic" entry each. Never dangling "(deceased)"; state who is late/surviving. Never put ${userName} there; player stance belongs relationshipSummary.
2. Voice=>speech; Personality=>personality; Appearance=>appearance; Background=>background; Role=>role; explicit chronological Age=>age. Apparent Age should be compact ~N when inferable; Appearance must not duplicate an explicit age. behaviorProfile may translate EXPLICIT stable identity into max6 target-general rules (Disposition/Expressiveness/Independence/Care/Conflict/Cruelty); player-specific/one-scene behavior does not belong there. Do not infer species/age from stereotypes.
3. Read on the PC/current stance toward ${userName} may initialize relationshipSummary, but relationshipImpact="none" and every relationshipDelta key MUST be 0. Never invent numeric Trust/Affection/Desire/Tension from prose.
4. Agenda may initialize goal only when the dossier presents it as the NPC's current ongoing agenda. "Where to Find Them" is NOT current Location; do not map home/work/hangout into live location unless the dossier explicitly says they are there now. Do not invent Mood/Status/current presence.
5. A durable Tell may become a mannerism. One-scene/emotional/stress/player-specific behavior does not. Merge multiple animations of one recurring pattern into one mannerism. Important memories only from explicit consequential past events, max3 new.
6. Existing unlocked durable fields may refine from established facts. Empty != permission to guess from one act: seed only direct description, recurrence, or stable cross-context evidence. Return FULL CURRENT COMPACT fields; merge duplicate concepts first. personality/speech/appearance use refine; behaviorProfile refine/evolve; lasting change uses evolve/change+reason. behaviorProfile must be target-general; route player-specific behavior to relationshipSummary. Social update/evolve merges named counterparts; omission never erases others.
7. KeyRelationships update/evolve merge by named counterpart and never erase unrelated ties by omission. Estrangement, death, reconciliation, or rivalry changes that counterpart entry; otherwise omit unchanged fields.
8. JSON only. Compact limits: appearance<=500; personality<=280; speech<=240; behaviorProfile max6/180 each; background<=320; relationshipSummary<=280; keyRelationships max5/180 each; mannerisms max4/140 each. Never repeat a fact just to preserve wording.

Return shape:
{"npcs":[{"id":"existing id","name":"canonical name","aliases":[],"role":"","species":"","age":"","apparentAge":"","appearance":"","personality":"","speech":"","behaviorProfile":["Disposition: compact grounded behavior"],"background":"","keyRelationships":["Name — relation | durable current dynamic"],"relationshipSummary":"","goal":"","mannerisms":[],"memories":[],"relationshipImpact":"none","relationshipDelta":{"trust":0,"affection":0,"desire":0,"tension":0},"present":false,"worldActive":false}]}

Structured dossier text:
${String(dossierText || '').trim()}`;
}

export function buildProfileRefreshPrompt({
    transcript,
    targetNpc = null,
    userName = 'User',
    charName = 'Character',
    memoryCriteria = DEFAULT_MEMORY_CRITERIA,
}) {
    const npc = normalizeNpcRecord(targetNpc || {});
    const locked = Array.isArray(npc.manualProfileFields) ? npc.manualProfileFields : [];
    const existing = {
        id: cleanText(npc.id, 100),
        name: cleanText(npc.name, 120),
        aliases: cleanList(npc.aliases, 8, 120),
        role: cleanText(npc.role, 240),
        species: cleanText(npc.species, 160),
        age: cleanText(npc.age, 80),
        apparentAge: cleanText(npc.apparentAge, 80),
        appearance: cleanText(npc.appearance, 900),
        personality: cleanText(npc.personality, 600),
        speech: cleanText(npc.speech, 500),
        behaviorProfile: normalizeBehaviorProfile(npc.behaviorProfile),
        background: cleanText(npc.background, 800),
        keyRelationships: cleanList(npc.keyRelationships, KEY_RELATIONSHIP_LIMIT, 260),
        relationshipSummary: cleanText(npc.relationshipSummary, 500),
        mood: cleanText(npc.mood, 220),
        location: cleanText(npc.location, 260),
        goal: cleanText(npc.goal, 420),
        status: cleanText(npc.status, 260),
        lifeState: normalizeLifeState(npc.lifeState),
        mannerisms: cleanList(npc.mannerisms, 4, 240),
        memories: cleanList(npc.memories, IMPORTANT_MEMORY_LIMIT, 260),
        importance: Math.round(clamp(npc.importance ?? 0, 0, 100)),
        currentRelationship: normalizeRelationshipBaseline(npc.relationship || DEFAULT_RELATIONSHIP),
        recentProfileEvidence: normalizeProfileEvidence(npc.profileEvidence),
        lockedProfileFields: locked,
    };
    const memoryRubric = compactMemoryRubric(memoryCriteria);
    return `NPC State TARGETED REFRESH FROM CHAT. Reconcile exactly one EXISTING NPC dossier against the supplied recent-story window. This is a deliberate user action, so inspect the whole window carefully instead of requiring a current-turn admission signal.

Target NPC: ${existing.name} (${existing.id})
Player: ${userName}
Main card speaker: ${charName}
Existing dossier: ${JSON.stringify(existing)}

Rules:
1. Return ONLY the target NPC. Use only the supplied story window and existing dossier. Latest grounded evidence wins when facts conflict. Never invent missing facts.
2. This is reconciliation, NOT event replay. currentRelationship is READ-ONLY: relationshipImpact MUST be "none" and all four relationshipDelta values MUST be 0. Never re-award Trust/Affection/Desire/Tension from old scenes.
3. Presence/recency are owned by the live scanner. present/worldActive in your JSON are ignored. Do not infer current physical presence merely because the NPC appeared earlier in this history window.
4. LOCKS: never rewrite fields listed in lockedProfileFields. Omit them from profileUpdates and ordinary dossier changes.
5. DURABLE PROFILE: CURRENT COMPACT SUMMARY only. Personality/Speech/Appearance mention each durable concept once; Appearance does not repeat explicit age. behaviorProfile=max6 target-general rules translating identity, not a second essay; player-specific patterns belong relationshipSummary. refine returns FULL field; lasting personality/speech/mannerism/behaviorProfile change uses evolve+reason, Appearance uses change+reason. Mannerisms=max4 DISTINCT recurring patterns, not separate animations. One transient beat is not durable.
6. IDENTITY FIREWALL: temporary mood, fear, stress, intoxication, intimacy, or behavior unique to ${userName} must not become global Personality, Speech, Mannerisms, or behaviorProfile. A generally kind NPC remains generally kind toward other people unless narration establishes a broader change. Necessary force is not cruelty by itself.
7. DEVELOPMENT SPEED: ordinary continuity changes durable identity gradually across separate scans. For gradual evidence prefix a stable concept label, e.g. "reserve: initiates public discussion", so later evidence can confirm the SAME pattern. Use developmentScale:"gradual"; "explicit" only for a direct lasting-change statement; "batch" only when a time skip explicitly summarizes sustained development. Mere passage of time does nothing. Include developmentReason for evolve/change.
8. ROLE/SPECIES/BACKGROUND may update when this window establishes or clarifies them. Species is literal only. Background is durable history, not current mood/status.
9. AGE=chronology only. Birthday/exact elapsed years=>advance+reason; correction=>correct+reason. apparentAge=visual and should be compact ~N, not prose; visual aging/growth/rejuvenation=>evolve+reason. No species-lifespan inference.
10. KEY RELATIONSHIPS: one unambiguous entry/non-player counterpart. Merge relation+durable dynamic; use "late husband"/"surviving widow" rather than dangling "(deceased)". update/keyRelationshipEdges for discovery; evolve+reason for lasting social change. Omission NEVER erases unrelated ties. Never put ${userName} there.
11. RELATIONSHIP SUMMARY toward ${userName}: replace only when clearly stale/incomplete; keep intensity proportional to evidence/currentRelationship and avoid absolute devotion/dependence language unless truly established. This prose reconciliation does NOT change numeric stats.
12. LIVE FIELDS Mood/Goal/Status/Location: use the latest reliable evidence in the window. Replace when changed. Use matching *State:"clear" only when the old state/place/goal is explicitly ended or obsolete and no replacement is known. Absence alone never clears Location.
13. LIFE STATE: change only from explicit/dependable evidence. Death requires lifeState:"deceased", lifeStateCertainty:"explicit". Do not infer death from disappearance.
14. MEMORIES: return only NEW consequential events not already represented; max3 new/max5 stored. Treat paraphrases as the same memory. If curation is needed, memoryRetention contains five DISTINCT events.
15. Importance is manual metadata: do not infer/change it. Before JSON compact: appearance<=500; personality<=280; speech<=240; behaviorProfile max6/180; background<=320; relationshipSummary<=280; mannerism<=140; keyRelationship/memory<=180. JSON only.

Memory criteria: ${memoryRubric || '(none configured; store only clearly durable story-relevant events)'}

Return shape:
{"npcs":[{"id":"${existing.id}","name":"${existing.name}","aliases":[],"role":"","species":"","age":"","ageState":"keep|advance|correct","ageReason":"","apparentAge":"","apparentAgeState":"keep|evolve","apparentAgeReason":"","background":"","keyRelationships":[],"keyRelationshipsState":"keep|update|evolve","keyRelationshipsReason":"","relationshipSummary":"","mood":"","moodState":"keep|clear","location":"","locationState":"keep|clear","goal":"","goalState":"keep|clear","status":"","statusState":"keep|clear","lifeState":"unknown|alive|deceased","lifeStateCertainty":"explicit|inferred|","lifeStateReason":"","memories":[],"memoryRetention":[],"importance":0,"relationshipImpact":"none","relationshipDelta":{"trust":0,"affection":0,"desire":0,"tension":0},"relationshipEvidence":{"trust":"","affection":"","desire":"","tension":""},"relationshipChangeReason":"","present":false,"worldActive":false}],"profileUpdates":[{"id":"${existing.id}","evidence":{"personality":[],"speech":[],"appearance":[],"mannerisms":[],"behaviorProfile":[]},"personalityState":"refine|evolve","personality":"","personalityReason":"","speechState":"refine|evolve","speech":"","speechReason":"","appearanceState":"refine|change","appearance":"","appearanceReason":"","mannerismState":"refine|evolve","mannerisms":[],"mannerismReason":"","behaviorProfileState":"refine|evolve","behaviorProfile":[],"behaviorProfileReason":"","developmentScale":"gradual|explicit|batch","developmentReason":""}],"keyRelationshipEdges":[]}

Recent story window:
${String(transcript || '').trim()}`;
}

export function buildScannerPrompt({
    transcript,
    existingNpcs = [],
    candidates = [],
    userName = 'User',
    charName = 'Character',
    maxNpcs = 40,
    relationshipBaseline = DEFAULT_RELATIONSHIP,
    relationshipCaps = DEFAULT_RELATIONSHIP_CAPS,
    relationshipCriteria = DEFAULT_RELATIONSHIP_CRITERIA,
    impactCriteria = DEFAULT_IMPACT_CRITERIA,
    memoryCriteria = DEFAULT_MEMORY_CRITERIA,
    detailLimit = 4,
    admissionMode = 'conservative',
    focusNpcName = '',
    backfillMode = false,
    currentTranscript = '',
    fullScanMode = false,
}) {
    const baseline = normalizeRelationshipBaseline(relationshipBaseline);
    const caps = normalizeRelationshipCaps(relationshipCaps);
    const admission = normalizeNpcAdmissionMode(admissionMode);
    const focusName = cleanText(focusNpcName, 120);
    const admissionPolicy = admission === 'manual_only'
        ? 'MANUAL ONLY: new people stay candidates until OOC/manual add; existing dossiers still update.'
        : admission === 'balanced'
            ? 'BALANCED: admit proper names, meaningful/persistent roles, and roles with direct two-way player interaction.'
            : 'CONSERVATIVE: proper names admit. First-seen role_label ALWAYS stays candidate regardless of dossierSignal/directInteraction; promote on confirmed same-person recurrence or manual/OOC add.';
    const focusRule = focusName
        ? `\nOOC BACKFILL MODE: return only "${focusName}" or {"npcs":[]}; reuse its dossier id, recover grounded facts, and force relationship deltas to 0.`
        : '';
    const identityIndex = [
        ...existingNpcs.map(npc => ({
            id: npc.id,
            name: npc.name,
            aliases: (npc.aliases || []).slice(0, 8),
            registryState: 'dossier',
            ...(isInterimNpcLabel(npc.name, npc.identityKind) ? {
                identityKind: 'role_label',
                role: cleanText(npc.role, 120),
                location: cleanText(npc.location, 120),
            } : {}),
        })),
        ...(Array.isArray(candidates) ? candidates : []).map(normalizeNpcCandidate).filter(Boolean).map(candidate => ({
            id: '',
            name: candidate.name,
            aliases: (candidate.aliases || []).slice(0, 6),
            registryState: 'candidate',
            seenCount: candidate.seenCount,
            role: candidate.role || '',
            location: candidate.location || '',
            lastSeenTurn: candidate.lastSeenTurn || 0,
        })),
    ];

    const relevantLimit = fullScanMode ? 8 : Math.min(4, Number(detailLimit) || 4);
    const profileLimit = fullScanMode ? Math.min(6, relevantLimit) : 3;
    const relevantExisting = selectScannerContextNpcs(existingNpcs, transcript, relevantLimit);
    const profileIds = new Set(selectScannerProfileContextNpcs(relevantExisting, transcript, profileLimit).map(npc => npc.id));
    const runtimeExisting = relevantExisting.map(npc => {
        const stronglyRelevant = profileIds.has(npc.id);
        const aliases = (npc.aliases || []).slice(0, 6);
        const role = cleanText(npc.role, 180);
        const lifeState = normalizeLifeState(npc.lifeState);
        const lifeStateCertainty = normalizeLifeStateCertainty(npc.lifeStateCertainty);
        const age = cleanText(npc.age, 60);
        const apparentAge = cleanText(npc.apparentAge, 60);
        const goal = cleanText(npc.goal, 180);
        const status = cleanText(npc.status, 220);
        const relationshipSummary = cleanText(npc.relationshipSummary, 260);
        const mood = cleanText(npc.mood, 160);
        const location = cleanText(npc.location, 180);
        return {
            id: npc.id,
            name: npc.name,
            ...(aliases.length ? { aliases } : {}),
            ...(role ? { role } : {}),
            currentRelationship: npc.relationship || baseline,
            present: Boolean(npc.present),
            worldActive: Boolean(npc.worldActive),
            ...(lifeState !== 'unknown' ? { lifeState } : {}),
            ...(lifeStateCertainty ? { lifeStateCertainty } : {}),
            ...(npc.archived ? { archived: true, archiveReason: npc.archiveReason || '' } : {}),
            ...(age ? { age } : {}),
            ...(apparentAge ? { apparentAge } : {}),
            ...(goal ? { goal } : {}),
            ...(status ? { status } : {}),
            ...(stronglyRelevant && relationshipSummary ? { relationshipSummary } : {}),
            ...(mood ? { mood } : {}),
            ...(location ? { location } : {}),
        };
    });
    const profileExisting = relevantExisting
        .filter(npc => profileIds.has(npc.id))
        .map(npc => {
            const species = cleanText(npc.species, 120);
            const appearance = cleanText(npc.appearance, 500);
            const personality = cleanText(npc.personality, 280);
            const speech = cleanText(npc.speech, 240);
            const behaviorProfile = normalizeBehaviorProfile(npc.behaviorProfile);
            const background = cleanText(npc.background, 320);
            const mannerisms = (npc.mannerisms || []).slice(0, 4).map(item => cleanText(item, 140)).filter(Boolean);
            const keyRelationships = cleanList(npc.keyRelationships, KEY_RELATIONSHIP_LIMIT, 180);
            const memories = cleanList(npc.memories, IMPORTANT_MEMORY_LIMIT, 180);
            const profileEvidence = normalizeProfileEvidence(npc.profileEvidence);
            const locked = (npc.manualProfileFields || []).filter(field => PROFILE_EVIDENCE_FIELDS.includes(field));
            return {
                id: npc.id,
                name: npc.name,
                ...(species ? { species } : {}),
                ...(appearance ? { appearance } : {}),
                ...(personality ? { personality } : {}),
                ...(speech ? { speech } : {}),
                ...(behaviorProfile.length ? { behaviorProfile } : {}),
                ...(background ? { background } : {}),
                ...(mannerisms.length ? { mannerisms } : {}),
                ...(keyRelationships.length ? { keyRelationships } : {}),
                ...(profileEvidenceCount(profileEvidence) ? { recentProfileEvidence: profileEvidence } : {}),
                ...(locked.length ? { lockedProfileFields: locked } : {}),
                ...(memories.length ? { memories } : {}),
            };
        });

    const relationshipRubric = compactRelationshipRubric(relationshipCriteria);
    const impactRubric = compactImpactRubric(impactCriteria);
    const memoryRubric = compactMemoryRubric(memoryCriteria);
    const currentExchange = String(currentTranscript || transcript || '').trim();
    const fullScanRule = fullScanMode
        ? `\nFULL-WINDOW RECONCILIATION: Story context contains the configured recent-history window. Use durable evidence anywhere in the supplied recent-history window to recover missed durable facts (identity, role/species/age, profile, background, social ties, memories). Earlier turns are context, NOT new events. For present/worldActive and LIVE mood/location/goal/status, use only the newest CURRENT exchange below; older states must never overwrite newer/established live state. Numeric relationshipImpact/relationshipDelta MUST use only CURRENT exchange, never older window events. Do not replay old deltas.`
        : '';

    return `Private NPC dossier scanner. NEW dossier-worthy NPCs get a grounded first-pass profile.
Admission: ${admissionPolicy}${focusRule}${fullScanRule}
Rules:
1. Exclude player (${userName}), main speaker (${charName}), extras.
2. EXISTING: match id/name/alias/role. Return compact JSON deltas: changed fields only; omitted persist. Identity promotion: role/interim dossier + grounded proper name => MUST reuse id; old label in aliases; identityKind:"proper_name"; never duplicate/downgrade.
3. NEW/CANDIDATE: include name,identityKind,dossierSignal,dossierReason,sameIndividual,directInteraction,present,worldActive. Dossier-worthy NEW: populate every grounded field now; personality/values may become compact behaviorProfile rules. directInteraction affects admission/relationship only, NEVER enrichment. Incidental role candidates may stay lightweight.
4. Candidates are not dossiers. sameIndividual=true only when proven. Use narration, World State, durable Inner Chatter; proper names there MUST be returned even when prose uses role.
5. Return ONLY observed/new/meaningfully changed NPCs; new grounded durable profile facts count as changes. present=true only latest-scene physical presence; World State/Inner Chatter alone never presence. worldActive=true only explicit current off-screen activity. Inner Chatter supports durable facts, not transient monologue.
6. Goal/status/mood/location are LIVE: output goal,goalState,status,statusState,mood,moodState,location,locationState as needed; actively reassess each returned EXISTING NPC every scan. Unchanged -> omit; changed -> replace; ended mood/goal/status -> matching *State:"clear". Location=current/last reliable; locationState:"clear" only when old place explicitly obsolete and replacement unknown. Off-screen/no evidence alone never clears it. Never use "Unknown".
7. DURABLE PROFILE CHANNEL: ALWAYS emit one top-level profileUpdates item for durable facts even without npc delta. COMPACT duplicates. Empty != infer: seed only direct/recurring stable evidence. matching *State:"refine" returns FULL field; lasting personality/speech/mannerism "evolve"+reason; appearance "change"+reason. behaviorProfile FULL max6 target-general; Mannerisms FULL max4 DISTINCT patterns. PC/one-scene behavior -> relationshipSummary/live state/Memory. lockedProfileFields never rewrite.
8. IDENTITY FIREWALL: Ignore transient visual state. mood/stress/intimacy/injury/relationship-specific behavior never becomes global Personality/Speech/Mannerisms/behaviorProfile. Player-specific durable stance -> relationshipSummary. Kindness stays general unless broader change established; necessary force != cruelty. High scores alone never imply jealousy/clinginess/blushing/stammering/possessiveness/tsundere denial.
9. DEVELOPMENT SPEED: ordinary identity change is gradual across separate scans. Gradual evidence uses stable concept labels reused later. developmentScale=gradual|explicit|batch; explicit=direct lasting change; batch=time skip explicitly summarizing sustained development. Mere passage changes nothing; time skip alone invents nothing. Include developmentReason.
10. SOCIAL: grounded non-player kin/friend/rival/mentor/partner => ALWAYS top-level keyRelationshipEdges {aId,a,bId,b,aToB,bToA,reason}; one clear counterpart entry. Use late/surviving, never dangling "(deceased)". Social change may evolve+reason; omission NEVER erases other bonds.
11. Age/ApparentAge separate: age=chronology only; apparentAge=visual cue, compact ~N, never prose; species literal; no species-aging inference. Birthday/exact elapsed=>ageState:"advance"+reason; correction=>ageState:"correct"+reason; visual aging/growth/rejuvenation=>apparentAgeState:"evolve"+reason. Appearance must not repeat explicit age. Vague time skip insufficient.
12. RELATIONSHIP -100..+100 DELTA-ONLY; currentRelationship read-only. Return relationshipDelta+relationshipEvidence (all 4 keys). NEW only; continuation/aftermath=>0. Raw max 1/2/5/10; axis max 1/2/3/4. EVERY non-zero axis needs grounded CURRENT-exchange evidence. Desire needs explicit attraction/intimacy narration; rescue/gratitude/affection/trust/proximity=>0. Secondary to identity. Trust!=obedience; Affection!=devotion; Tension!=jealousy.
13. lifeState unknown|alive|deceased; deceased+explicit=death; explicit alive=reactivate.
14. Memories: max3 NEW, cap5 stored; no duplicate/paraphrased memories. If crowded use memoryRetention=top5 consequential/durable; recency=tiebreak only. CAPS appearance500/personality280/speech240/behaviorProfile 6x180/background320/relationshipSummary280/mannerism140/keyRelationship-memory180. Importance manual; do not infer/change. COMPACT; never invent.
15. JSON only: {"npcs":[...],"profileUpdates":[...],"keyRelationshipEdges":[...]}. profileUpdates example: {"id":"npc_myla","evidence":{"speech":["uses honorifics"]},"speechState":"refine","speech":"Soft, formal; uses honorifics."}. Existing relationship delta example: {"id":"npc_myla","relationshipImpact":"meaningful","relationshipDelta":{"trust":-2,"affection":0,"desire":0,"tension":2},"relationshipEvidence":{"trust":"caught player lying","affection":"","desire":"","tension":"lie caused unresolved conflict"},"relationshipChangeReason":"Player lied to her now."}.

Relationship rubric: ${relationshipRubric || '(none)'}
Impact rubric: ${impactRubric || '(none)'}
Memory criteria: ${memoryRubric || '(none configured; store only clearly durable story-relevant events)'}
Delta caps: ordinary ${caps.ordinary}; meaningful ${caps.meaningful}; major ${caps.major}; extreme ${caps.extreme}. New-NPC baseline: ${JSON.stringify(baseline)}

Identity index (matching only):
${JSON.stringify(identityIndex)}

Relevant live context (dynamic fields only):
${JSON.stringify(runtimeExisting)}

Stable profile context (strongly relevant existing only):
${JSON.stringify(profileExisting)}

Story context:
${String(transcript || '').trim()}${fullScanMode ? `\n\nCURRENT exchange (authoritative for presence/live state and numeric relationship deltas):\n${currentExchange}` : ''}`;
}
