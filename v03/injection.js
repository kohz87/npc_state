function line(label, value) {
    const text = String(value || '').trim();
    return text ? `${label}: ${text}` : '';
}

function npcBlock(npc) {
    const rel = npc.relationship || {};
    const parts = [
        `NPC: ${npc.name}${npc.role ? ` | ${npc.role}` : ''}${npc.species ? ` | ${npc.species}` : ''}`,
        line('Personality', npc.personality),
        npc.behaviorProfile?.length ? `Behavior: ${npc.behaviorProfile.join(' | ')}` : '',
        line('Speech', npc.speech),
        line('Appearance', npc.appearance),
        npc.mannerisms?.length ? `Mannerisms: ${npc.mannerisms.join(' | ')}` : '',
        line('Mood', npc.mood),
        line('Location', npc.location),
        line('Goal', npc.goal),
        line('Status', npc.status),
        `Relationship with player: trust ${Number(rel.trust) || 0}, affection ${Number(rel.affection) || 0}, desire ${Number(rel.desire) || 0}, tension ${Number(rel.tension) || 0}`,
        line('Relationship summary', npc.relationshipSummary),
        npc.keyRelationships?.length ? `Key relationships: ${npc.keyRelationships.join(' | ')}` : '',
        npc.memories?.length ? `Important memories: ${npc.memories.join(' | ')}` : '',
    ].filter(Boolean);
    return parts.join('\n');
}

export function buildInjection(state, settings = {}) {
    if (state?.branchSafety?.status && state.branchSafety.status !== 'safe') return '';
    if (settings.enabled === false || settings.inject === false) return '';
    const limit = Math.max(1, Math.min(20, Math.round(Number(settings.injectLimit) || 6)));
    const budgetTokens = Math.max(256, Math.min(8000, Math.round(Number(settings.injectBudgetTokens) || 1800)));
    const maxChars = budgetTokens * 4;
    const present = (state?.npcs || [])
        .filter(npc => npc.present && !npc.archived)
        .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0) || Number(b.lastInteractionMessageId || -1) - Number(a.lastInteractionMessageId || -1))
        .slice(0, limit);
    if (!present.length) return '';
    const header = [
        '[NPC STATE v0.3 | PRESENT CAST]',
        'The following dossiers describe NPCs physically present at the end of the latest scanned scene.',
        'Treat identity/personality/speech as continuity constraints. Relationship values modify player-specific behavior but do not override identity, goals, agency, or boundaries.',
    ].join('\n');
    let output = header;
    for (const npc of present) {
        const block = `\n\n${npcBlock(npc)}`;
        if ((output + block).length > maxChars) break;
        output += block;
    }
    return output;
}
