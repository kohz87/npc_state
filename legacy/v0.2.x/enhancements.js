/* NPC State optional full-cast scan and dossier library */
import { extension_settings, getContext } from '../../../extensions.js';

const EXTENSION_NAME = 'npc_state';
const FULL_CAST_KEY = 'fullCastScanEveryTurn';
const CONTROL_ID = 'npc_state_full_cast_scan';
const SCAN_BUTTON_ID = 'npc_state_full_cast_scan_now';
const LIBRARY_BUTTON_ID = 'npc_state_dossier_library';
const LIBRARY_ID = 'npc_state_dossier_library_overlay';
const WAIT_LIMIT_MS = 120000;
let initialized = false;
let sequence = 0;
let library = null;
let libraryNpcId = '';
let libraryQuery = '';
let userSnapshot = null;
let userSnapshotChatKey = '';
let guardInstalled = false;
const guardedToasts = new Map();

const api = () => globalThis.NPCState || null;
const cfg = () => {
    const root = extension_settings[EXTENSION_NAME] ||= {};
    if (root[FULL_CAST_KEY] === undefined) root[FULL_CAST_KEY] = false;
    return root;
};
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const hasPhrase = (text, phrase) => {
    const needle = norm(phrase);
    return Boolean(needle && ` ${norm(text)} `.includes(` ${needle} `));
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function saveSettings() {
    try { getContext().saveSettingsDebounced?.(); } catch {}
}
function latestAssistantId() {
    const chat = getContext()?.chat || [];
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        if (chat[i] && !chat[i].is_system && !chat[i].is_user && String(chat[i].mes || '').trim()) return i;
    }
    return -1;
}
function currentExchange(messageId = null) {
    const chat = getContext()?.chat || [];
    let assistantId = Number.isInteger(messageId) ? messageId : latestAssistantId();
    while (assistantId >= 0 && (chat[assistantId]?.is_system || chat[assistantId]?.is_user)) assistantId -= 1;
    if (assistantId < 0) return { assistantId: -1, text: '' };
    let userId = -1;
    for (let i = assistantId - 1; i >= 0; i -= 1) {
        if (chat[i]?.is_system) continue;
        if (chat[i]?.is_user) userId = i;
        break;
    }
    return {
        assistantId,
        text: [userId >= 0 ? chat[userId]?.mes : '', chat[assistantId]?.mes].filter(Boolean).join('\n'),
    };
}
function fingerprint(npc) {
    try {
        return JSON.stringify({
            present:!!npc.present, worldActive:!!npc.worldActive, archived:!!npc.archived,
            role:npc.role||'', species:npc.species||'', age:npc.age||'', apparentAge:npc.apparentAge||'',
            personality:npc.personality||'', speech:npc.speech||'', appearance:npc.appearance||'', background:npc.background||'',
            behaviorProfile:npc.behaviorProfile||[], keyRelationships:npc.keyRelationships||[], relationshipSummary:npc.relationshipSummary||'',
            relationship:npc.relationship||{}, memories:npc.memories||[], mood:npc.mood||'', location:npc.location||'', goal:npc.goal||'',
            status:npc.status||'', lifeState:npc.lifeState||'unknown',
        });
    } catch { return ''; }
}
function snapshot() {
    try {
        return new Map((api()?.getState?.()?.npcs || []).map(npc => [npc.id, fingerprint(npc)]));
    } catch { return new Map(); }
}
function uniqueFirstNames(npcs) {
    const counts = new Map();
    for (const npc of npcs || []) {
        for (const label of [npc?.name, ...(npc?.aliases || [])].filter(Boolean)) {
            const first = norm(label).split(' ')[0] || '';
            if (first.length >= 3) counts.set(first, (counts.get(first) || 0) + 1);
        }
    }
    return new Set([...counts].filter(([,count]) => count === 1).map(([name]) => name));
}
function participantLabels(npc, npcs) {
    const uniqueFirst = uniqueFirstNames(npcs);
    const labels = new Set();
    for (const raw of [npc?.name, ...(npc?.aliases || [])]) {
        const label = norm(raw);
        if (!label) continue;
        labels.add(label);
        const first = label.split(' ')[0] || '';
        if (uniqueFirst.has(first)) labels.add(first);
    }
    const role = norm(npc?.role || '');
    if (role.length >= 5) labels.add(role);
    return [...labels];
}
function fullCastTargets(state, exchangeText, before = null) {
    const npcs = state?.npcs || [];
    const ids = new Set();
    for (const npc of npcs) {
        if (!npc?.id || npc.archived) continue;
        if (npc.present) ids.add(npc.id);
        if (participantLabels(npc, npcs).some(label => hasPhrase(exchangeText, label))) ids.add(npc.id);
        if (before?.has(npc.id) && before.get(npc.id) !== fingerprint(npc)) ids.add(npc.id);
    }
    return [...ids];
}
async function waitIdle(chatKey, token) {
    const started = Date.now();
    let idleAt = 0;
    while (Date.now() - started < WAIT_LIMIT_MS) {
        if (token !== sequence) return false;
        const status = api()?.uiStatus?.() || {};
        if (status.chatKey !== chatKey) return false;
        if (!status.scanBusyForChat && String(status.swipeState || 'none') === 'none') {
            idleAt ||= Date.now();
            if (Date.now() - idleAt >= 250) return true;
        } else idleAt = 0;
        await sleep(100);
    }
    console.warn('[NPC State] full cast scan timed out waiting for scanner idle.');
    return false;
}
async function runFullCastScan(messageId = null, before = null, { manual = false } = {}) {
    const npcApi = api();
    const initial = npcApi?.uiStatus?.() || {};
    if (!npcApi || !initial.chatKey || initial.chatKey === 'no-chat' || initial.hydrationStatus !== 'ready') return false;
    const exchange = currentExchange(messageId);
    if (exchange.assistantId < 0) return false;
    const chatKey = initial.chatKey;
    const token = ++sequence;
    if (!await waitIdle(chatKey, token)) return false;
    if (latestAssistantId() !== exchange.assistantId || api()?.uiStatus?.().chatKey !== chatKey) return false;
    let state = npcApi.getState();
    if (Number(state.lastScannedMessageId) !== exchange.assistantId) {
        await npcApi.scan();
        if (!await waitIdle(chatKey, token)) return false;
        if (latestAssistantId() !== exchange.assistantId || api()?.uiStatus?.().chatKey !== chatKey) return false;
        state = npcApi.getState();
    }
    const targets = fullCastTargets(state, exchange.text, before);
    let refreshed = 0;
    for (const id of targets) {
        if (token !== sequence || api()?.uiStatus?.().chatKey !== chatKey || latestAssistantId() !== exchange.assistantId) return false;
        if (!await waitIdle(chatKey, token)) return false;
        if (await npcApi.refreshFromChat(id)) refreshed += 1;
    }
    if (library) renderLibrary();
    console.info('[NPC State] full exchange/present cast scan complete', { targets: targets.length, refreshed });
    if (manual) globalThis.toastr?.success?.(`NPC State: full-scanned ${targets.length} exchange/present dossier${targets.length === 1 ? '' : 's'}.`);
    return true;
}

/* v0.2.23 compatibility: deepSweep/silent are dropped by pending-backfill normalization.
   Unrelated automatic sweep requests are answered locally so they cost no model call. */
function installBackfillGuard() {
    if (guardInstalled) return true;
    const ctx = getContext();
    if (typeof ctx?.generateRaw !== 'function') return false;
    const original = ctx.generateRaw.bind(ctx);
    ctx.generateRaw = async (...args) => {
        const prompt = String(args?.[0]?.prompt || '');
        if (/targeted dossier backfill extractor/i.test(prompt)) {
            const target = String(prompt.match(/^Requested NPC:\s*(.+)$/im)?.[1] || '').trim();
            const state = api()?.getState?.() || { npcs: [] };
            const query = norm(target);
            const npc = state.npcs.find(row => [row?.name, ...(row?.aliases || [])].some(label => norm(label) === query));
            const exchange = currentExchange();
            const relevant = npc && (npc.present || participantLabels(npc, state.npcs).some(label => hasPhrase(exchange.text, label)));
            if (npc && !relevant && npc.manual !== true) {
                guardedToasts.set(norm(npc.name), Date.now() + 10000);
                return JSON.stringify({ npcs: [{
                    id:npc.id, name:npc.name, relationshipImpact:'none',
                    relationshipDelta:{trust:0,affection:0,desire:0,tension:0},
                    relationshipEvidence:{trust:'',affection:'',desire:'',tension:''}, relationshipChangeReason:'',
                }] });
            }
        }
        return original(...args);
    };
    const toast = globalThis.toastr;
    if (toast?.success && !toast.success.__npcStateFullCastGuard) {
        const originalSuccess = toast.success.bind(toast);
        const guarded = (...args) => {
            const text = String(args[0] || '');
            const name = text.match(/^NPC State:\s*backfilled\s+(.+?)\s+from recent story context\.?$/i)?.[1] || '';
            const key = norm(name), until = guardedToasts.get(key) || 0;
            if (until > Date.now()) { guardedToasts.delete(key); return undefined; }
            return originalSuccess(...args);
        };
        guarded.__npcStateFullCastGuard = true;
        toast.success = guarded;
    }
    guardInstalled = true;
    return true;
}

function lifecycle(npc) {
    if (npc.archived) return npc.archiveReason === 'deceased' ? 'Archived · deceased' : 'Archived';
    if (npc.present) return 'Present';
    if (npc.worldActive) return 'Active off-screen';
    return 'Off-screen';
}
function listHtml(items, empty = 'None established.') {
    return items?.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : `<p class="npc-state-library-muted">${esc(empty)}</p>`;
}
function detailHtml(npc) {
    if (!npc) return '<div class="npc-state-library-empty">Select a dossier.</div>';
    const rel = npc.relationship || {};
    const facts = [
        ['Mood',npc.mood],['Location',npc.location],['Goal',npc.goal],['Status',npc.status],
        ['Species / Race',npc.species],['Age',npc.age],['Apparent age',npc.apparentAge],['Role',npc.role],
    ];
    return `<div class="npc-state-library-detail-head"><div><span class="npc-state-library-kicker">FULL DOSSIER</span><h2>${esc(npc.name || 'NPC')}</h2><p>${esc([npc.role,npc.species].filter(Boolean).join(' · ') || 'Tracked NPC')}</p></div><b class="npc-state-library-state">${esc(lifecycle(npc))}</b></div>
      <div class="npc-state-library-actions"><button class="menu_button npc-state-library-refresh" data-npc-id="${esc(npc.id)}"><i class="fa-solid fa-arrows-rotate"></i> Refresh from Chat</button><button class="menu_button npc-state-library-scan" data-npc-id="${esc(npc.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> Scan dossier</button><button class="menu_button npc-state-library-edit" data-npc-id="${esc(npc.id)}"><i class="fa-solid fa-pen-to-square"></i> Edit dossier</button></div>
      <section><h3>Current / Identity</h3><div class="npc-state-library-facts">${facts.map(([k,v]) => `<div><b>${esc(k)}</b><span>${esc(v || 'Unknown')}</span></div>`).join('')}</div></section>
      <section><h3>Personality</h3><p>${esc(npc.personality || 'Unknown')}</p><h3>Behavioral profile</h3>${listHtml(npc.behaviorProfile)}</section>
      <section><h3>Speech</h3><p>${esc(npc.speech || 'Unknown')}</p><h3>Appearance</h3><p>${esc(npc.appearance || 'Unknown')}</p><h3>Mannerisms</h3>${listHtml(npc.mannerisms)}</section>
      <section><h3>Relationship with player</h3><p>${esc(npc.relationshipSummary || 'No relationship summary established.')}</p><div class="npc-state-library-rel"><span>Trust <b>${Number(rel.trust)||0}</b></span><span>Affection <b>${Number(rel.affection)||0}</b></span><span>Desire <b>${Number(rel.desire)||0}</b></span><span>Tension <b>${Number(rel.tension)||0}</b></span></div><h3>Key relationships</h3>${listHtml(npc.keyRelationships)}</section>
      <section><h3>Background</h3><p>${esc(npc.background || 'Unknown')}</p><h3>Important memories</h3>${listHtml(npc.memories,'No persistent memories recorded.')}</section>
      <footer>Updated ${npc.updatedAt ? esc(new Date(npc.updatedAt).toLocaleString()) : 'unknown'} · Seen ${Math.max(0,Number(npc.seenCount)||0)} time${Number(npc.seenCount)===1?'':'s'}</footer>`;
}
function renderLibrary() {
    if (!library) return;
    const state = api()?.getState?.() || { npcs: [] };
    const all = [...(state.npcs || [])].sort((a,b) => Number(!!b.present)-Number(!!a.present) || Number(!!a.archived)-Number(!!b.archived) || String(a.name||'').localeCompare(String(b.name||'')));
    const query = norm(libraryQuery);
    const rows = all.filter(npc => !query || [npc.name,npc.role,npc.species,...(npc.aliases||[])].some(value => norm(value).includes(query)));
    if (!libraryNpcId || !all.some(npc => npc.id === libraryNpcId)) libraryNpcId = rows[0]?.id || all[0]?.id || '';
    const list = library.querySelector('.npc-state-library-list');
    const detail = library.querySelector('.npc-state-library-detail');
    if (list) list.innerHTML = rows.length ? rows.map(npc => `<button type="button" class="npc-state-library-row ${npc.id===libraryNpcId?'selected':''}" data-npc-id="${esc(npc.id)}"><span><b>${esc(npc.name||'NPC')}</b><small>${esc(npc.role||npc.species||'No role')}</small></span><em>${esc(lifecycle(npc))}</em></button>`).join('') : '<div class="npc-state-library-empty">No matching dossiers.</div>';
    if (detail) detail.innerHTML = detailHtml(all.find(npc => npc.id === libraryNpcId));
    const count = library.querySelector('.npc-state-library-count');
    if (count) count.textContent = `${all.length} stored dossier${all.length===1?'':'s'}, including off-screen and archived NPCs`;
}
function closeLibrary() {
    library?.remove?.(); library = null; libraryNpcId = ''; libraryQuery = '';
    document.body?.classList?.remove?.('npc-state-library-open');
}
function openLibrary() {
    if (!api()?.getState || api()?.uiStatus?.().hydrationStatus !== 'ready') return false;
    closeLibrary();
    const overlay = document.createElement('div');
    overlay.id = LIBRARY_ID; overlay.className = 'npc-state-library-overlay';
    overlay.innerHTML = `<div class="npc-state-library-dialog"><header class="npc-state-library-head"><div><span class="npc-state-library-kicker">NPC STATE</span><h2>Dossier Library</h2><small class="npc-state-library-count"></small></div><button type="button" class="npc-state-library-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header><div class="npc-state-library-body"><aside><input id="npc_state_library_search" class="text_pole" type="search" placeholder="Search dossiers..."><div class="npc-state-library-list"></div></aside><main class="npc-state-library-detail"></main></div></div>`;
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest?.('.npc-state-library-close')) return closeLibrary();
        const row = event.target.closest?.('.npc-state-library-row');
        if (row?.dataset?.npcId) { libraryNpcId = row.dataset.npcId; return renderLibrary(); }
        const refresh = event.target.closest?.('.npc-state-library-refresh');
        if (refresh?.dataset?.npcId) return void (async()=>{ await api().refreshFromChat(refresh.dataset.npcId); renderLibrary(); })();
        const scan = event.target.closest?.('.npc-state-library-scan');
        if (scan?.dataset?.npcId) return void (async()=>{ await api().scanDossier(scan.dataset.npcId); renderLibrary(); })();
        const edit = event.target.closest?.('.npc-state-library-edit');
        if (edit?.dataset?.npcId) api().openEditor(edit.dataset.npcId);
    });
    overlay.addEventListener('input', event => { if (event.target?.id === 'npc_state_library_search') { libraryQuery = event.target.value; renderLibrary(); } });
    document.body.appendChild(overlay); document.body.classList.add('npc-state-library-open'); library = overlay; renderLibrary();
    requestAnimationFrame?.(()=>overlay.querySelector('#npc_state_library_search')?.focus?.());
    return true;
}
function injectStyles() {
    if (document.getElementById('npc_state_library_styles')) return;
    const style = document.createElement('style'); style.id = 'npc_state_library_styles';
    style.textContent = `.npc-state-library-overlay{position:fixed;inset:0;z-index:2147483550;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}.npc-state-library-dialog{width:min(1180px,100%);height:min(88vh,900px);background:var(--SmartThemeBlurTintColor,#18191d);color:var(--SmartThemeBodyColor,#eee);border:1px solid #8885;border-radius:14px;display:flex;flex-direction:column;overflow:hidden}.npc-state-library-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #8884}.npc-state-library-head h2,.npc-state-library-detail h2{margin:.1rem 0}.npc-state-library-head small,.npc-state-library-muted{opacity:.7}.npc-state-library-kicker{font-size:.7rem;letter-spacing:.13em;opacity:.65}.npc-state-library-close{background:none;border:0;color:inherit;font-size:1.2rem;padding:8px}.npc-state-library-body{display:grid;grid-template-columns:minmax(250px,34%) 1fr;min-height:0;flex:1}.npc-state-library-body>aside{padding:14px;border-right:1px solid #8884;display:flex;flex-direction:column;min-height:0}.npc-state-library-list{margin-top:10px;display:flex;flex-direction:column;gap:5px;overflow:auto}.npc-state-library-row{display:flex;justify-content:space-between;gap:8px;text-align:left;color:inherit;background:transparent;border:1px solid transparent;border-radius:8px;padding:9px;cursor:pointer}.npc-state-library-row:hover,.npc-state-library-row.selected{background:#8882;border-color:#8884}.npc-state-library-row b,.npc-state-library-row small{display:block}.npc-state-library-row small,.npc-state-library-row em{opacity:.65}.npc-state-library-row em{font-style:normal;font-size:.72rem;white-space:nowrap}.npc-state-library-detail{overflow:auto;padding:20px 24px}.npc-state-library-detail-head{display:flex;justify-content:space-between;gap:16px}.npc-state-library-state{font-size:.78rem;border:1px solid #8885;border-radius:999px;padding:5px 9px;height:max-content}.npc-state-library-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.npc-state-library-detail section{padding:14px 0;border-top:1px solid #8883}.npc-state-library-detail h3{font-size:.82rem;text-transform:uppercase;letter-spacing:.07em;opacity:.72;margin:10px 0 7px}.npc-state-library-detail p{white-space:pre-wrap;line-height:1.5}.npc-state-library-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.npc-state-library-facts div,.npc-state-library-rel span{padding:8px;border-radius:7px;background:#8881}.npc-state-library-facts b,.npc-state-library-facts span{display:block}.npc-state-library-rel{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.npc-state-library-rel span{text-align:center}.npc-state-library-detail footer{opacity:.55;font-size:.76rem;padding-top:12px}.npc-state-library-empty{opacity:.65;padding:18px;text-align:center}@media(max-width:760px){.npc-state-library-overlay{padding:0}.npc-state-library-dialog{height:100dvh;border-radius:0}.npc-state-library-body{grid-template-columns:1fr}.npc-state-library-body>aside{max-height:36vh;border-right:0;border-bottom:1px solid #8884}.npc-state-library-detail{padding:15px}.npc-state-library-rel{grid-template-columns:repeat(2,1fr)}}`;
    document.head?.appendChild(style);
}
function mountControls() {
    injectStyles();
    const panel = document.querySelector?.('#npc_state_settings');
    if (!panel) return false;
    if (!document.getElementById(CONTROL_ID)) {
        const anchor = panel.querySelector('#npc_state_full_scan_every_turn')?.closest?.('.npc-state-setting-row');
        anchor?.insertAdjacentHTML?.('afterend', `<label class="npc-state-setting-row" for="${CONTROL_ID}"><span><b>Full cast scan</b><small>Optional expensive mode. After each assistant reply, fully refresh every tracked NPC who participated anywhere in the current user/assistant exchange plus every NPC physically present at the end. Physical presence itself is not changed by this extra pass.</small></span><input id="${CONTROL_ID}" type="checkbox"></label>`);
    }
    const control = document.getElementById(CONTROL_ID);
    if (control && control.dataset.npcStateBound !== '1') {
        control.checked = cfg()[FULL_CAST_KEY] === true; control.dataset.npcStateBound = '1';
        control.addEventListener('change',()=>{ cfg()[FULL_CAST_KEY] = !!control.checked; saveSettings(); });
    }
    const actions = panel.querySelector('.npc-state-actions');
    if (actions && !document.getElementById(LIBRARY_BUTTON_ID)) {
        const button = document.createElement('div'); button.id = LIBRARY_BUTTON_ID; button.className = 'menu_button'; button.innerHTML = '<i class="fa-solid fa-address-book"></i> Dossier Library'; button.addEventListener('click',openLibrary); actions.appendChild(button);
    }
    if (actions && !document.getElementById(SCAN_BUTTON_ID)) {
        const button = document.createElement('div'); button.id = SCAN_BUTTON_ID; button.className = 'menu_button'; button.innerHTML = '<i class="fa-solid fa-users-viewfinder"></i> Full scan current cast'; button.addEventListener('click',()=>void runFullCastScan(latestAssistantId(),snapshot(),{manual:true})); actions.appendChild(button);
    }
    return true;
}
function registerEvents() {
    const ctx = getContext(), source = ctx?.eventSource, events = ctx?.eventTypes || ctx?.event_types || {};
    if (!source?.on) return;
    if (events.MESSAGE_SENT) source.on(events.MESSAGE_SENT,()=>{ userSnapshotChatKey = api()?.uiStatus?.().chatKey || ''; userSnapshot = snapshot(); });
    if (events.MESSAGE_RECEIVED) source.on(events.MESSAGE_RECEIVED,messageId=>{
        if (cfg()[FULL_CAST_KEY] !== true) return;
        const chatKey = api()?.uiStatus?.().chatKey || '';
        const before = userSnapshotChatKey === chatKey ? userSnapshot : snapshot();
        void runFullCastScan(Number.isInteger(messageId)?messageId:latestAssistantId(),before);
    });
    if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED,()=>{ sequence += 1; userSnapshot=null; userSnapshotChatKey=''; closeLibrary(); setTimeout(mountControls,50); });
    for (const name of ['CHAT_LOADED','APP_READY','EXTENSION_SETTINGS_LOADED']) if (events[name]) source.on(events[name],()=>setTimeout(mountControls,50));
}
function init() {
    if (initialized) return void mountControls();
    initialized = true; cfg(); installBackfillGuard(); registerEvents(); mountControls();
    let attempts = 0; const timer = setInterval(()=>{ attempts += 1; installBackfillGuard(); if (mountControls() || attempts >= 40) clearInterval(timer); },250);
}
if (typeof globalThis.$ === 'function') globalThis.$(init);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();

export const NPC_STATE_ENHANCEMENTS = Object.freeze({ runFullCastScan, openLibrary, closeLibrary });
