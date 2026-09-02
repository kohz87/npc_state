function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function text(value, fallback = 'Unknown') {
    const clean = String(value ?? '').trim();
    return escapeHtml(clean || fallback);
}

function portraitSource(npc = {}) {
    const portrait = npc?.portrait && typeof npc.portrait === 'object' ? npc.portrait : {};
    return String(portrait.dataUrl || portrait.url || portrait.src || '').trim();
}

export function dossierStatusLabel(npc = {}) {
    if (npc.archived) return npc.archiveReason === 'deceased' ? 'Archived · deceased' : 'Archived';
    if (npc.present) return 'Present';
    if (npc.worldActive) return 'Active off-screen';
    return 'Off-screen';
}

export function dossierStatusClass(npc = {}) {
    if (npc.archived) return 'archived';
    if (npc.present) return 'present';
    if (npc.worldActive) return 'world-active';
    return 'off-screen';
}

export function sortDossierNpcs(npcs = []) {
    return [...(Array.isArray(npcs) ? npcs : [])].sort((a, b) => (
        Number(Boolean(b?.present)) - Number(Boolean(a?.present))
        || Number(Boolean(b?.worldActive)) - Number(Boolean(a?.worldActive))
        || Number(Boolean(a?.archived)) - Number(Boolean(b?.archived))
        || String(a?.name || '').localeCompare(String(b?.name || ''))
    ));
}

export function filterDossierNpcs(npcs = [], query = '') {
    const rows = sortDossierNpcs(npcs);
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter(npc => [
        npc?.name,
        npc?.role,
        npc?.species,
        dossierStatusLabel(npc),
        ...(Array.isArray(npc?.aliases) ? npc.aliases : []),
    ].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
}

function portraitHtml(npc, className, { decorative = false } = {}) {
    const src = portraitSource(npc);
    if (src) {
        return `<img class="${className}" src="${escapeHtml(src)}" alt="${decorative ? '' : `${escapeHtml(npc?.name || 'NPC')} portrait`}">`;
    }
    const initial = escapeHtml(String(npc?.name || '?').charAt(0).toUpperCase() || '?');
    return `<div class="${className} npc-state-v3-portrait-placeholder" aria-hidden="${decorative ? 'true' : 'false'}"><span>${initial}</span></div>`;
}

function listHtml(items, empty = 'None established.') {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    return rows.length
        ? `<ul class="npc-state-v3-block-list">${rows.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p class="npc-state-muted">${escapeHtml(empty)}</p>`;
}

function paragraphHtml(value, empty = 'Unknown') {
    const clean = String(value || '').trim();
    return `<p${clean ? '' : ' class="npc-state-muted"'}>${escapeHtml(clean || empty)}</p>`;
}

function identityText(npc = {}) {
    return [
        npc.species,
        npc.role,
        npc.age ? `Age ${npc.age}` : '',
        npc.apparentAge ? `Looks ${npc.apparentAge}` : '',
    ].filter(Boolean).join(' · ');
}

function currentFact(label, value) {
    return `<div class="npc-state-v3-current-card"><b>${escapeHtml(label)}</b><span>${text(value)}</span></div>`;
}

function relationshipAxis(label, value, axis) {
    const score = Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
    const position = Math.max(0, Math.min(100, (score + 100) / 2));
    return `<div class="npc-state-v3-rel-axis npc-state-v3-rel-${escapeHtml(axis)}">
      <div class="npc-state-v3-rel-label"><span>${escapeHtml(label)}</span><b>${score}</b></div>
      <div class="npc-state-v3-rel-track" aria-hidden="true"><span class="npc-state-v3-rel-zero"></span><i style="left:${position}%"></i></div>
    </div>`;
}

function relationshipHistoryHtml(npc = {}) {
    const rows = Array.isArray(npc.relationshipHistory) ? npc.relationshipHistory.slice(-8).reverse() : [];
    if (!rows.length) return '<p class="npc-state-muted">No relationship change history yet.</p>';
    return `<ol class="npc-state-v3-history-list">${rows.map(event => {
        const delta = Object.entries(event?.delta || {})
            .filter(([, value]) => Number(value))
            .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${Number(value)}`)
            .join(', ');
        const impact = escapeHtml(event?.impact || 'ordinary');
        const reason = String(event?.reason || '').trim();
        return `<li><div><b>${impact}</b><span>${escapeHtml(delta || 'no score change')}</span></div>${reason ? `<p>${escapeHtml(reason)}</p>` : ''}</li>`;
    }).join('')}</ol>`;
}

function block(title, body, className = '') {
    return `<section class="npc-state-v3-dossier-block ${className}"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

export function dossierHtml(npc) {
    if (!npc) return '<div class="npc-state-v3-empty">Select a dossier.</div>';
    const rel = npc.relationship || {};
    const identity = identityText(npc) || 'Identity not fully established';
    const status = dossierStatusLabel(npc);
    const statusClass = dossierStatusClass(npc);
    const lifeState = npc.lifeState === 'dead' ? 'Dead' : (npc.lifeState === 'alive' ? 'Alive' : 'Life state unknown');
    const flags = [
        npc.retentionProtected ? '<span><i class="fa-solid fa-shield-halved"></i> Protected</span>' : '',
        npc.manualProfileFields?.length ? '<span><i class="fa-solid fa-lock"></i> Profile locked</span>' : '',
        npc.minor ? '<span>Minor NPC</span>' : '',
    ].filter(Boolean).join('');

    return `<article class="npc-state-v3-dossier" data-npc-id="${escapeHtml(npc.id)}">
      <aside class="npc-state-v3-dossier-hero">
        <div class="npc-state-v3-hero-media">
          ${portraitHtml(npc, 'npc-state-v3-hero-portrait')}
          <div class="npc-state-v3-hero-caption">
            <h2>${escapeHtml(npc.name)}</h2>
            <p>${escapeHtml(identity)}</p>
            <div class="npc-state-v3-hero-badges"><span class="npc-state-v3-status-badge is-${statusClass}"><i></i>${escapeHtml(status)}</span><span>${escapeHtml(lifeState)}</span>${flags}</div>
          </div>
        </div>
        <footer class="npc-state-v3-dossier-actions">
          <button class="menu_button npc-state-v3-edit" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-pen"></i><span>Edit</span></button>
          <button class="menu_button npc-state-v3-refresh" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-arrows-rotate"></i><span>Refresh</span></button>
          <details class="npc-state-v3-dossier-more"><summary><i class="fa-solid fa-ellipsis"></i><span>More</span></summary><div>
            <button class="menu_button npc-state-v3-archive" data-npc-id="${escapeHtml(npc.id)}">${npc.archived ? '<i class="fa-solid fa-box-open"></i> Restore' : '<i class="fa-solid fa-box-archive"></i> Archive'}</button>
            <button class="menu_button redWarningBG npc-state-v3-delete" data-npc-id="${escapeHtml(npc.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
          </div></details>
        </footer>
      </aside>
      <main class="npc-state-v3-dossier-document">
        <section class="npc-state-v3-dossier-group npc-state-v3-current-group">
          <h3 class="npc-state-v3-group-title">Current</h3>
          <div class="npc-state-v3-current-grid">
            ${currentFact('Mood', npc.mood)}
            ${currentFact('Location', npc.location)}
            ${currentFact('Goal', npc.goal)}
            ${currentFact('Status', npc.status)}
          </div>
        </section>

        <section class="npc-state-v3-dossier-group">
          <h3 class="npc-state-v3-group-title">Relationship with player</h3>
          <div class="npc-state-v3-relationship-panel">
            <div class="npc-state-v3-rel-grid">
              ${relationshipAxis('Trust', rel.trust, 'trust')}
              ${relationshipAxis('Affection', rel.affection, 'affection')}
              ${relationshipAxis('Desire', rel.desire, 'desire')}
              ${relationshipAxis('Tension', rel.tension, 'tension')}
            </div>
            <div class="npc-state-v3-relationship-summary"><b>Current dynamic</b>${paragraphHtml(npc.relationshipSummary, 'No established relationship summary.')}</div>
          </div>
        </section>

        <section class="npc-state-v3-dossier-group">
          <h3 class="npc-state-v3-group-title">Profile</h3>
          <div class="npc-state-v3-block-grid">
            ${block('Personality', paragraphHtml(npc.personality))}
            ${block('Appearance', paragraphHtml(npc.appearance))}
            ${block('Behavioral profile', listHtml(npc.behaviorProfile))}
            ${block('Speech', paragraphHtml(npc.speech))}
            ${block('Mannerisms', listHtml(npc.mannerisms))}
            ${block('Key relationships', listHtml(npc.keyRelationships))}
            ${block('Important memories', listHtml(npc.memories, 'No persistent memories recorded yet.'), 'npc-state-v3-block-wide')}
            ${block('Background', paragraphHtml(npc.background), 'npc-state-v3-block-wide')}
            ${block('Recent relationship changes', relationshipHistoryHtml(npc), 'npc-state-v3-block-wide')}
          </div>
        </section>
      </main>
    </article>`;
}

export function castRailHtml(npcs = [], selectedId = '') {
    const rows = Array.isArray(npcs) ? npcs : [];
    if (!rows.length) return '<div class="npc-state-v3-cast-empty">No dossiers match this search.</div>';
    const selected = String(selectedId || '');
    return rows.map(npc => {
        const active = String(npc?.id || '') === selected;
        const status = dossierStatusLabel(npc);
        const statusClass = dossierStatusClass(npc);
        return `<button type="button" class="npc-state-v3-cast-card${active ? ' active' : ''}" data-npc-id="${escapeHtml(npc.id)}" aria-pressed="${active ? 'true' : 'false'}" title="${escapeHtml(`${npc.name} · ${npc.role || npc.species || 'NPC'} · ${status}`)}">
          <span class="npc-state-v3-cast-portrait">${portraitHtml(npc, 'npc-state-v3-cast-image', { decorative: true })}</span>
          <span class="npc-state-v3-cast-overlay"><b>${escapeHtml(npc.name)}</b><small>${escapeHtml(npc.role || npc.species || 'NPC')}</small><em class="is-${statusClass}"><i></i>${escapeHtml(status)}</em></span>
        </button>`;
    }).join('');
}
