from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one occurrence, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex replacement, found {count}: {pattern}')
    write(path, updated)


# Release metadata.
manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['version'] = '0.3.2'
manifest_path.write_text(json.dumps(manifest, indent=4) + '\n', encoding='utf-8')

replace_once('v03/schema.js', "export const NPC_STATE_VERSION = '0.3.1';", "export const NPC_STATE_VERSION = '0.3.2';")
replace_once('bootstrap.js', '/* NPC State v0.3.1 - clean runtime bootstrap */', '/* NPC State v0.3.2 - clean runtime bootstrap */')
replace_once('v03/index.js', '/* NPC State v0.3.1 - clean runtime */', '/* NPC State v0.3.2 - clean runtime */')
replace_once('v03/settings-layout.js', '/* NPC State v0.3.1 responsive settings layout coordinator.', '/* NPC State v0.3.2 responsive settings layout coordinator.')
replace_once('v03/ui.js', '<span class="npc-state-version">v0.3.1</span>', '<span class="npc-state-version">v0.3.2</span>')
replace_once('v03/engine.js', "const SYSTEM_PROMPT = 'Return only valid JSON for the NPC State v0.3.1 structured scanner. Obey the supplied schema and evidence rules exactly.';", "const SYSTEM_PROMPT = 'Return only valid JSON for the NPC State v0.3.2 structured scanner. Obey the supplied schema and evidence rules exactly.';")

# Schema understands the new recoverable branch state while normalizing old v0.3.1 unsafe saves forward.
replace_once(
    'v03/schema.js',
    "        branchSafety: { status: 'safe', reason: '' },",
    "        branchSafety: { status: 'safe', kind: '', reason: '' },",
)
replace_once(
    'v03/schema.js',
    "    const rawSafety = input.branchSafety && typeof input.branchSafety === 'object' ? input.branchSafety : {};\n    const branchSafetyStatus = ['safe', 'prebaseline-diverged'].includes(String(rawSafety.status)) ? String(rawSafety.status) : 'safe';",
    "    const rawSafety = input.branchSafety && typeof input.branchSafety === 'object' ? input.branchSafety : {};\n    const rawSafetyStatus = String(rawSafety.status || 'safe');\n    const branchSafetyStatus = rawSafetyStatus === 'prebaseline-diverged'\n        ? 'rebase-required'\n        : (['safe', 'rebase-required'].includes(rawSafetyStatus) ? rawSafetyStatus : 'safe');\n    const rawSafetyKind = String(rawSafety.kind || '');\n    const branchSafetyKind = ['prebaseline-truncation', 'prebaseline-rewrite', 'legacy-prebaseline-divergence'].includes(rawSafetyKind)\n        ? rawSafetyKind\n        : (rawSafetyStatus === 'prebaseline-diverged' ? 'legacy-prebaseline-divergence' : '');",
)
replace_once(
    'v03/schema.js',
    "        branchSafety: {\n            status: branchSafetyStatus,\n            reason: text(rawSafety.reason, 500),\n        },",
    "        branchSafety: {\n            status: branchSafetyStatus,\n            kind: branchSafetyStatus === 'safe' ? '' : branchSafetyKind,\n            reason: text(rawSafety.reason, 500),\n        },",
)

# Branch model: classify the incompatible change and provide an explicit durable-state rebase.
replace_once(
    'v03/branches.js',
    "export function lineageIsPrefix(prefix = [], current = []) {\n    if (prefix.length > current.length) return false;\n    for (let i = 0; i < prefix.length; i += 1) if (prefix[i] !== current[i]) return false;\n    return true;\n}\n",
    "export function lineageIsPrefix(prefix = [], current = []) {\n    if (prefix.length > current.length) return false;\n    for (let i = 0; i < prefix.length; i += 1) if (prefix[i] !== current[i]) return false;\n    return true;\n}\n\nexport function branchDivergenceKind(state = {}, chat = []) {\n    const currentLineage = chatLineage(chat);\n    const previousLineage = Array.isArray(state?.branchHeadLineage) ? state.branchHeadLineage : [];\n    return lineageIsPrefix(currentLineage, previousLineage) ? 'prebaseline-truncation' : 'prebaseline-rewrite';\n}\n\nfunction narrativeTurnFromLineage(lineage = []) {\n    return (Array.isArray(lineage) ? lineage : []).reduce((count, value) => count + (String(value || '').startsWith('a:') ? 1 : 0), 0);\n}\n\nfunction latestKnownNarrativeTurn(state = {}) {\n    const turns = [narrativeTurnFromLineage(state?.branchHeadLineage || []), narrativeTurnFromLineage(state?.branchBase?.lineage || [])];\n    for (const checkpoint of state?.checkpoints || []) turns.push(narrativeTurnFromLineage(checkpoint?.lineage || []));\n    return Math.max(0, ...turns);\n}\n\nexport function rebaseToCurrentChat(state, chat = []) {\n    const source = normalizeState(state, state?.chatKey || '');\n    const currentLineage = chatLineage(chat);\n    const currentTurn = narrativeTurnFromLineage(currentLineage);\n    const sourceTurn = latestKnownNarrativeTurn(source);\n    const next = normalizeState(source, source.chatKey);\n\n    next.npcs = next.npcs.map(npc => {\n        const rebased = structuredClone(npc);\n        rebased.present = false;\n        rebased.worldActive = false;\n        rebased.firstSeenMessageId = null;\n        rebased.lastSeenMessageId = null;\n        rebased.lastInteractionMessageId = null;\n        rebased.lastActivityMessageId = null;\n        if (Number.isInteger(rebased.lastActivityTurn)) {\n            const inactiveAge = Math.max(0, sourceTurn - rebased.lastActivityTurn);\n            rebased.lastActivityTurn = Math.max(0, currentTurn - inactiveAge);\n        } else {\n            rebased.lastActivityTurn = currentTurn;\n        }\n        if (rebased.lastRelationshipChange) rebased.lastRelationshipChange = { ...rebased.lastRelationshipChange, sourceMessageId: null };\n        rebased.relationshipHistory = (rebased.relationshipHistory || []).map(event => ({ ...event, sourceMessageId: null }));\n        return rebased;\n    });\n    next.socialGraph = (next.socialGraph || []).map(edge => ({ ...edge, sourceMessageId: null }));\n    next.lastObservation = {\n        messageId: null,\n        exchangeActiveNpcIds: [],\n        finalPresentNpcIds: [],\n        worldActiveNpcIds: [],\n        targetNpcIds: [],\n    };\n    next.lastScannedMessageId = null;\n    next.checkpoints = [];\n    next.branchBase = null;\n    next.branchHeadLineage = [];\n    next.branchSafety = { status: 'safe', kind: '', reason: '' };\n    next.updatedAt = Date.now();\n    return ensureBranchBase(normalizeState(next, source.chatKey), chat);\n}\n",
)
replace_once(
    'v03/branches.js',
    "function failClosedPrebaselineDivergence(state, chat) {\n    const next = normalizeState(state, state?.chatKey || '');",
    "function failClosedPrebaselineDivergence(state, chat) {\n    const next = normalizeState(state, state?.chatKey || '');\n    const kind = next.branchSafety?.kind || branchDivergenceKind(next, chat);",
)
replace_once(
    'v03/branches.js',
    "    next.branchSafety = {\n        status: 'prebaseline-diverged',\n        reason: 'The current chat diverges before the first v0.3 branch baseline. Legacy branch history was intentionally not imported, so live NPC injection is paused rather than trusting stale timeline state.',\n    };",
    "    next.branchSafety = {\n        status: 'rebase-required',\n        kind,\n        reason: kind === 'prebaseline-truncation'\n            ? 'The chat was truncated before NPC State\\'s oldest recoverable checkpoint. Durable dossiers remain intact, but the current timeline must be explicitly rebased before live scanning resumes.'\n            : 'The chat was rewritten before NPC State\\'s oldest recoverable checkpoint. Durable dossiers remain intact, but the current timeline must be explicitly rebased before live scanning resumes.',\n    };",
)
replace_once(
    'v03/branches.js',
    "    restored.branchSafety = { status: 'safe', reason: '' };",
    "    restored.branchSafety = { status: 'safe', kind: '', reason: '' };",
)

# Engine supports an explicit rebase transaction and treats every non-safe branch state uniformly.
replace_once(
    'v03/engine.js',
    "import { bestCheckpoint, ensureBranchBase, fingerprintMessage, reconcileToCurrentBranch, recordCheckpoint } from './branches.js';",
    "import { bestCheckpoint, ensureBranchBase, fingerprintMessage, rebaseToCurrentChat, reconcileToCurrentBranch, recordCheckpoint } from './branches.js';",
)
engine = read('v03/engine.js')
count = engine.count("state.branchSafety?.status === 'prebaseline-diverged'")
if count != 3:
    raise RuntimeError(f'v03/engine.js: expected 3 legacy unsafe checks, found {count}')
engine = engine.replace("state.branchSafety?.status === 'prebaseline-diverged'", "state.branchSafety?.status !== 'safe'")
write('v03/engine.js', engine)

regex_once(
    'v03/engine.js',
    r"    async function reconcileBranch\(\{ rescan = false \} = \{\}\) \{.*?\n    \}\n\n    return Object\.freeze\(\{",
    """    async function reconcileBranch({ rescan = false, rebase = false } = {}) {
        const chatKey = getChatKey();
        if (!chatKey || chatKey === 'no-chat') return { ok: false, reason: 'no-chat' };
        invalidate(chatKey);
        let result;
        await exclusive(chatKey, async () => {
            const state = await loadChat(chatKey);
            const chat = getContext().chat || [];
            if (rebase) {
                const rebased = rebaseToCurrentChat(state, chat);
                const persisted = await persist(chatKey, rebased);
                result = {
                    ok: true,
                    changed: true,
                    rebased: true,
                    unsafeDivergence: false,
                    checkpoint: persisted.branchBase || null,
                    state: structuredClone(persisted),
                };
                return;
            }
            const reconciled = reconcileToCurrentBranch(state, chat);
            if (!reconciled.changed) {
                result = { ok: true, changed: false, unsafeDivergence: false, checkpoint: bestCheckpoint(state, chat) };
                return;
            }
            const persisted = await persist(chatKey, reconciled.state);
            result = { ok: true, changed: true, unsafeDivergence: reconciled.unsafeDivergence === true, checkpoint: reconciled.checkpoint, state: structuredClone(persisted) };
        });
        if (result?.unsafeDivergence) return result;
        if (rescan && (rebase || getSettings().branchRescan !== false)) {
            const id = latestAssistantMessageId(getContext().chat || []);
            if (id >= 0) result.rescan = await scan(id, { manual: rebase === true, force: true });
        }
        return result;
    }

    return Object.freeze({""",
    flags=re.S,
)

# Friendly user-facing branch recovery language.
replace_once(
    'v03/ui.js',
    "            else if (!result.discarded) notify('warning', `NPC State scan did not commit: ${result.reason || 'unknown reason'}.`);",
    "            else if (!result.discarded && result.reason === 'branch-unsafe') notify('warning', 'NPC State: timeline rebase required. Open NPC State settings and choose Rebase to current chat.');\n            else if (!result.discarded) notify('warning', `NPC State scan did not commit: ${result.reason || 'unknown reason'}.`);",
)
replace_once(
    'v03/ui.js',
    "            notify(result.ok ? 'success' : 'warning', result.ok ? 'NPC State: dossier reconciled from recent chat without replaying relationship deltas.' : `NPC State: dossier scan did not commit (${result.reason || 'unknown'}).`);",
    "            notify(result.ok ? 'success' : 'warning', result.ok ? 'NPC State: dossier reconciled from recent chat without replaying relationship deltas.' : (result.reason === 'branch-unsafe' ? 'NPC State: timeline rebase required. Open NPC State settings and choose Rebase to current chat.' : `NPC State: dossier scan did not commit (${result.reason || 'unknown'}).`));",
)
index_text = read('v03/index.js')
index_text = index_text.replace(
    "if (result?.unsafeDivergence) notify('warning', 'branch change predates the v0.3 baseline; live injection and model scans are paused rather than trusting stale legacy timeline data.');",
    "if (result?.unsafeDivergence) notify('warning', 'timeline rebase required. Durable dossiers are intact; open NPC State settings and choose Rebase to current chat to accept the surviving timeline.');",
)
index_text = index_text.replace(
    "if (branch?.unsafeDivergence) notify('warning', 'this chat diverged before its first v0.3 branch baseline. Live injection and model scans are paused because v0.2 branch checkpoints are intentionally not imported. Return to the original baseline branch to restore safe tracking.');",
    "if (branch?.unsafeDivergence) notify('warning', 'timeline rebase required. Durable dossiers are intact; accept the current surviving timeline from NPC State settings or return to the original baseline branch.');",
)
write('v03/index.js', index_text)

# Conditional Tracking-card recovery UI.
write('v03/branch-recovery-ui.js', r'''const PANEL_ID = 'npc_state_settings';
const BANNER_ID = 'npc_state_v3_branch_recovery';
let started = false;
let observer = null;
let scheduled = false;
let running = false;

function state() {
    try { return globalThis.NPCState?.getState?.() || null; }
    catch { return null; }
}

export function branchRecoveryRequired(value = state()) {
    return Boolean(value?.branchSafety && value.branchSafety.status !== 'safe');
}

function messageForKind(kind = '') {
    if (kind === 'prebaseline-truncation') return 'The chat was shortened beyond NPC State\'s oldest recoverable checkpoint.';
    if (kind === 'prebaseline-rewrite') return 'The chat was rewritten before NPC State\'s oldest recoverable checkpoint.';
    return 'The current chat is outside NPC State\'s oldest recoverable checkpoint.';
}

function ensureStyles() {
    if (globalThis.document?.getElementById?.('npc_state_v3_branch_recovery_style')) return;
    const style = globalThis.document?.createElement?.('style');
    if (!style) return;
    style.id = 'npc_state_v3_branch_recovery_style';
    style.textContent = `
#${BANNER_ID}{margin:0 0 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--SmartThemeQuoteColor,#d59a32) 58%,transparent);border-radius:10px;background:color-mix(in srgb,var(--SmartThemeQuoteColor,#d59a32) 9%,transparent);display:grid;gap:7px}
#${BANNER_ID} b{font-size:.95em}#${BANNER_ID} small{line-height:1.35;opacity:.82}#${BANNER_ID} .npc-state-v3-branch-recovery-actions{display:flex;gap:8px;flex-wrap:wrap}
#${BANNER_ID} button{margin:0}#${BANNER_ID}[data-running="1"] button{opacity:.65;pointer-events:none}`;
    globalThis.document.head?.appendChild?.(style);
}

function hostForBanner() {
    const panel = globalThis.document?.getElementById?.(PANEL_ID);
    return panel?.querySelector?.('.npc-state-v3-tracking-section') || panel?.querySelector?.('.npc-state-drawer') || null;
}

async function rebaseCurrentChat() {
    if (running) return;
    const current = state();
    if (!branchRecoveryRequired(current)) return render();
    const accepted = globalThis.confirm?.(
        'Rebase NPC State to the current chat timeline?\n\n' +
        'This preserves durable dossiers, portraits, relationships, memories, manual locks, archives, social ties, and deletion tombstones. It clears live presence, chat-local message references, and incompatible branch checkpoints, then scans the latest surviving assistant exchange.\n\n' +
        'Facts learned only from deleted messages may remain until later scans revise them or you edit the dossier manually.'
    );
    if (!accepted) return;
    running = true;
    render();
    const toast = globalThis.toastr?.info?.('NPC State: rebasing to the current chat timeline...', '', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const result = await globalThis.NPCState?.reconcile?.({ rebase: true, rescan: true });
        if (!result?.ok) throw new Error(result?.reason || 'rebase failed');
        if (result.rescan?.ok) globalThis.toastr?.success?.('NPC State: timeline rebased and the latest surviving exchange was scanned.');
        else globalThis.toastr?.success?.('NPC State: timeline rebased. No surviving assistant exchange needed a scan.');
    } catch (error) {
        console.error('[NPC State v0.3.2] timeline rebase failed safely', error);
        globalThis.toastr?.error?.(`NPC State: timeline rebase failed without replacing your durable dossiers. ${error?.message || error}`);
    } finally {
        running = false;
        if (toast && globalThis.toastr?.clear) globalThis.toastr.clear(toast);
        render();
    }
}

export function renderBranchRecoveryUi() {
    ensureStyles();
    const host = hostForBanner();
    const current = state();
    const existing = globalThis.document?.getElementById?.(BANNER_ID);
    if (!host || !branchRecoveryRequired(current)) {
        existing?.remove?.();
        return false;
    }
    const kind = String(current.branchSafety?.kind || '');
    let banner = existing;
    if (!banner) {
        banner = globalThis.document.createElement('div');
        banner.id = BANNER_ID;
        const heading = host.querySelector?.('.npc-state-v3-settings-card-title');
        if (heading?.nextSibling) host.insertBefore(banner, heading.nextSibling);
        else host.prepend?.(banner);
    }
    banner.dataset.running = running ? '1' : '0';
    banner.innerHTML = `<b>Timeline rebase required</b><small>${messageForKind(kind)} Durable dossiers are intact. Rebase only if the remaining chat is now the canon you want to keep.</small><div class="npc-state-v3-branch-recovery-actions"><button type="button" class="menu_button npc-state-v3-rebase-current"><i class="fa-solid fa-code-branch"></i> ${running ? 'Rebasing...' : 'Rebase to current chat'}</button></div>`;
    banner.querySelector('.npc-state-v3-rebase-current')?.addEventListener('click', rebaseCurrentChat);
    return true;
}

function render() { return renderBranchRecoveryUi(); }

function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
    schedule(() => { scheduled = false; render(); });
}

function touchesPanel(records = []) {
    const panel = globalThis.document?.getElementById?.(PANEL_ID);
    for (const record of records) {
        if (panel && (record.target === panel || panel.contains?.(record.target))) return true;
        for (const node of record.addedNodes || []) if (node?.id === PANEL_ID || node?.querySelector?.(`#${PANEL_ID}`)) return true;
    }
    return false;
}

export function startBranchRecoveryUi() {
    if (started || !globalThis.document?.addEventListener) return false;
    started = true;
    scheduleRender();
    if (typeof globalThis.MutationObserver === 'function' && globalThis.document.body) {
        observer = new globalThis.MutationObserver(records => { if (touchesPanel(records)) scheduleRender(); });
        observer.observe(globalThis.document.body, { childList: true, subtree: true });
    }
    return true;
}

export function stopBranchRecoveryUi() {
    observer?.disconnect?.();
    observer = null;
    started = false;
    scheduled = false;
    return true;
}
''')

replace_once(
    'bootstrap.js',
    "const { startRelationshipHistoryUi } = await import('./v03/relationship-history-ui.js');\nstartRelationshipHistoryUi();\nconst { startManualOperationFeedback } = await import('./v03/manual-operation-feedback.js');",
    "const { startRelationshipHistoryUi } = await import('./v03/relationship-history-ui.js');\nstartRelationshipHistoryUi();\nconst { startBranchRecoveryUi } = await import('./v03/branch-recovery-ui.js');\nstartBranchRecoveryUi();\nconst { startManualOperationFeedback } = await import('./v03/manual-operation-feedback.js');",
)

# Existing branch regression now expects the recoverable v0.3.2 state.
replace_once(
    'tests/v03-branch.test.js',
    "    assert.equal(reconciled.state.branchSafety.status, 'prebaseline-diverged');",
    "    assert.equal(reconciled.state.branchSafety.status, 'rebase-required');",
)

write('tests/v03-branch-rebase.test.js', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chatLineage, recordCheckpoint, reconcileToCurrentBranch, rebaseToCurrentChat } from '../v03/branches.js';
import { createEmptyState, normalizeNpc } from '../v03/schema.js';

function originalChat() {
    return [
        { is_user: true, mes: 'u1' }, { is_user: false, mes: 'a1' },
        { is_user: true, mes: 'u2' }, { is_user: false, mes: 'a2' },
    ];
}

function unsafeState() {
    const chat = originalChat();
    let state = createEmptyState('chat:test:rebase');
    state.npcs = [normalizeNpc({
        id: 'astra', name: 'Astra', present: true, worldActive: true,
        memories: ['The player kept a promise.'],
        relationship: { trust: 18, affection: 7, desire: 0, tension: 1 },
        relationshipHistory: [{ impact: 'meaningful', delta: { trust: 2 }, sourceMessageId: 3, turn: 2, at: 10 }],
        lastRelationshipChange: { impact: 'meaningful', delta: { trust: 2 }, sourceMessageId: 3, turn: 2, at: 10 },
        firstSeenMessageId: 1, lastSeenMessageId: 3, lastInteractionMessageId: 3,
        lastActivityTurn: 1, lastActivityMessageId: 3, retentionProtected: true,
        manualProfileFields: ['personality'], portrait: { path: 'astra.png' },
    })];
    state.deletedNpcIds = ['npc-deleted'];
    state.socialGraph = [{ fromId: 'astra', toId: 'other', relation: 'friend', summary: '', updatedAt: 1, sourceMessageId: 3 }];
    state = recordCheckpoint(state, chat, 3, 'v3-start');
    state.checkpoints = [];
    return state;
}

test('prebaseline tail deletion is classified as recoverable truncation', () => {
    const state = unsafeState();
    const surviving = originalChat().slice(0, 2);
    const result = reconcileToCurrentBranch(state, surviving);
    assert.equal(result.unsafeDivergence, true);
    assert.equal(result.state.branchSafety.status, 'rebase-required');
    assert.equal(result.state.branchSafety.kind, 'prebaseline-truncation');
});

test('prebaseline rewritten history is classified separately', () => {
    const state = unsafeState();
    const rewritten = [{ is_user: true, mes: 'different user' }, { is_user: false, mes: 'different assistant' }];
    const result = reconcileToCurrentBranch(state, rewritten);
    assert.equal(result.unsafeDivergence, true);
    assert.equal(result.state.branchSafety.status, 'rebase-required');
    assert.equal(result.state.branchSafety.kind, 'prebaseline-rewrite');
});

test('explicit rebase preserves durable dossiers while resetting timeline-local state', () => {
    const surviving = originalChat().slice(0, 2);
    const unsafe = reconcileToCurrentBranch(unsafeState(), surviving).state;
    const rebased = rebaseToCurrentChat(unsafe, surviving);
    const astra = rebased.npcs.find(npc => npc.id === 'astra');

    assert.equal(rebased.branchSafety.status, 'safe');
    assert.equal(rebased.branchSafety.kind, '');
    assert.equal(rebased.checkpoints.length, 0);
    assert.ok(rebased.branchBase?.snapshot);
    assert.deepEqual(rebased.branchHeadLineage, chatLineage(surviving));
    assert.deepEqual(rebased.branchBase.lineage, chatLineage(surviving));
    assert.equal(rebased.lastScannedMessageId, null);
    assert.deepEqual(rebased.lastObservation.finalPresentNpcIds, []);

    assert.ok(astra);
    assert.equal(astra.relationship.trust, 18);
    assert.deepEqual(astra.memories, ['The player kept a promise.']);
    assert.equal(astra.retentionProtected, true);
    assert.ok(astra.manualProfileFields.includes('personality'));
    assert.deepEqual(astra.portrait, { path: 'astra.png' });
    assert.ok(rebased.deletedNpcIds.includes('npc-deleted'));

    assert.equal(astra.present, false);
    assert.equal(astra.worldActive, false);
    assert.equal(astra.firstSeenMessageId, null);
    assert.equal(astra.lastSeenMessageId, null);
    assert.equal(astra.lastInteractionMessageId, null);
    assert.equal(astra.lastActivityMessageId, null);
    assert.equal(astra.relationshipHistory[0].sourceMessageId, null);
    assert.equal(astra.lastRelationshipChange.sourceMessageId, null);
    assert.equal(rebased.socialGraph[0].sourceMessageId, null);
    assert.equal(astra.lastActivityTurn, 0, 'one turn of prior inactivity is preserved on the shorter surviving timeline');
});

test('engine and recovery UI wire an explicit rebase plus forced manual rescan', () => {
    const engine = fs.readFileSync(new URL('../v03/engine.js', import.meta.url), 'utf8');
    const ui = fs.readFileSync(new URL('../v03/branch-recovery-ui.js', import.meta.url), 'utf8');
    assert.match(engine, /reconcileBranch\(\{ rescan = false, rebase = false \}/);
    assert.match(engine, /rebaseToCurrentChat\(state, chat\)/);
    assert.match(engine, /manual: rebase === true, force: true/);
    assert.match(ui, /reconcile\?\.\(\{ rebase: true, rescan: true \}\)/);
    assert.match(ui, /Facts learned only from deleted messages may remain/);
});
''')

# Documentation and changelog.
readme = read('README.md')
readme = readme.replace('# NPC State v0.3.1', '# NPC State v0.3.2', 1)
readme = readme.replace('`manifest.json` (`0.3.1`)', '`manifest.json` (`0.3.2`)', 1)
readme = readme.replace('The v0.3.1 rewrite now covers', 'The v0.3.2 rewrite now covers', 1)
old_branch = "If a chat is changed to a branch that diverges **before** that first v0.3 baseline, v0.3 cannot truthfully reconstruct the missing v0.2 branch history because those old checkpoints are intentionally not imported. It therefore fails closed: strict live presence is cleared and model scanning/injection are paused instead of trusting potentially stale timeline data. Returning to the original baseline branch restores normal v0.3 tracking."
new_branch = "If a chat is changed or truncated **before** the oldest recoverable v0.3 checkpoint, NPC State cannot truthfully reconstruct the removed timeline. v0.3.2 therefore pauses strict live presence, scanning, and injection but keeps durable dossiers intact and marks the chat **Timeline rebase required**. Returning to a compatible branch restores checkpoint recovery automatically. If the surviving chat is intentionally the new canon, **Rebase to current chat** preserves durable dossiers, portraits, relationships, memories, manual locks, archives, social ties, tombstones, and relative stale age while clearing chat-local message references, live presence, and incompatible branch checkpoints before establishing a fresh baseline and force-scanning the latest surviving assistant exchange. Facts learned only from deleted messages may remain until later scans revise them or they are edited manually."
if old_branch not in readme:
    raise RuntimeError('README branch-boundary paragraph changed unexpectedly')
readme = readme.replace(old_branch, new_branch, 1)
write('README.md', readme)

changelog = read('CHANGELOG.md')
entry = """## v0.3.2

- Added explicit **Rebase to current chat** recovery when edits or deletions cross NPC State's oldest recoverable v0.3 checkpoint.
- Replaced the dead-end `prebaseline-diverged` UX with a recoverable **Timeline rebase required** state that distinguishes pure prebaseline truncation from an incompatible rewrite.
- Rebasing preserves durable dossiers, portraits, relationship state/history, memories, manual profile locks, archives, retention flags, social ties, suppression data, and deletion tombstones while clearing strict presence, off-screen activity, latest observation, chat-local message references, and incompatible branch checkpoints.
- Relative stale inactivity age is rebased to the surviving chat instead of being blindly reset, and social/relationship source message IDs are cleared because deletion can shift chat indices.
- A successful rebase establishes the surviving chat as a fresh branch baseline and force-scans its latest assistant exchange even when automatic scanning is disabled.
- Added a conditional recovery card inside Tracking plus clearer scan/refresh warnings so `branch-unsafe` is no longer exposed as an unexplained internal status.

"""
if not changelog.startswith('# Changelog\n\n'):
    raise RuntimeError('Unexpected CHANGELOG header')
changelog = '# Changelog\n\n' + entry + changelog[len('# Changelog\n\n'):]
write('CHANGELOG.md', changelog)

print('Applied NPC State v0.3.2 branch recovery patch.')
