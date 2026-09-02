const INLINE_ID = 'npc_state_v3_inline';
const TAB_CLASS = 'npc-state-megumin-tab';
const PANE_CLASS = 'npc-state-megumin-pane';

function parseMessageId(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

export function messageIdForElement(message) {
    if (!message) return null;
    const candidates = [
        message.getAttribute?.('mesid'),
        message.dataset?.mesid,
        message.getAttribute?.('data-mesid'),
        message.dataset?.messageId,
        message.getAttribute?.('data-message-id'),
    ];
    for (const candidate of candidates) {
        const id = parseMessageId(candidate);
        if (id !== null) return id;
    }
    return null;
}

export function meguminIntegrationKey(messageId) {
    const id = parseMessageId(messageId);
    return id === null ? 'npc-state:current' : `npc-state:${id}`;
}

function compatibleBlockCard(message) {
    const nativeCard = message?.querySelector?.('.meg-blocks') || null;
    if (nativeCard?.querySelector?.('.meg-blocks-tabs') && nativeCard?.querySelector?.('.meg-blocks-panel')) return nativeCard;

    const inventoryCard = message?.querySelector?.('.inventory-block-card') || null;
    if (inventoryCard?.querySelector?.('.meg-blocks-tabs') && inventoryCard?.querySelector?.('.meg-blocks-panel')) return inventoryCard;
    return null;
}

export function meguminBlockReady(message) {
    return Boolean(compatibleBlockCard(message));
}

function setClassActive(node, active) {
    if (!node) return;
    if (node.classList?.toggle) {
        node.classList.toggle('active', Boolean(active));
        return;
    }
    const names = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
    if (active) names.add('active');
    else names.delete('active');
    node.className = [...names].join(' ');
}

function closeNpcStatePane(card) {
    if (!card?.querySelectorAll) return;
    for (const pane of [...(card.querySelectorAll(`.${PANE_CLASS}`) || [])]) {
        if (pane?.style) pane.style.display = 'none';
    }
    for (const tab of [...(card.querySelectorAll(`.${TAB_CLASS}`) || [])]) {
        setClassActive(tab, false);
        tab.setAttribute?.('aria-expanded', 'false');
    }
}

function findByKey(card, className, key) {
    return [...(card?.querySelectorAll?.(`.${className}`) || [])].find(node => node?.dataset?.key === key) || null;
}

function removeIntegration(card, key) {
    findByKey(card, PANE_CLASS, key)?.remove?.();
    findByKey(card, TAB_CLASS, key)?.remove?.();
}

function bindNativeDismissBridge(card, button) {
    for (const control of [...(card?.querySelectorAll?.('.meg-blocks-tab, .meg-blocks-collapse') || [])]) {
        if (control === button || control?.dataset?.npcStateDismissBound === '1') continue;
        if (control?.dataset) control.dataset.npcStateDismissBound = '1';
        control?.addEventListener?.('click', () => closeNpcStatePane(card));
    }
}

function mountHolder(holder) {
    if (!holder?.closest) return false;
    const message = holder.closest('.mes');
    const card = compatibleBlockCard(message);
    if (!card?.querySelector) return false;
    const tabs = card.querySelector('.meg-blocks-tabs');
    const panel = card.querySelector('.meg-blocks-panel');
    if (!tabs || !panel) return false;

    const messageId = messageIdForElement(message);
    const key = meguminIntegrationKey(messageId);

    for (const stale of [...(card.querySelectorAll?.(`.${TAB_CLASS}, .${PANE_CLASS}`) || [])]) {
        if (stale?.dataset?.key !== key) stale.remove?.();
    }

    let pane = findByKey(card, PANE_CLASS, key);
    let button = findByKey(card, TAB_CLASS, key);

    if (!button) {
        button = globalThis.document?.createElement?.('button');
        if (!button) return false;
        button.type = 'button';
        button.className = `meg-blocks-tab ${TAB_CLASS}`;
        button.dataset.key = key;
        if (messageId !== null) button.dataset.npcStateMessageId = String(messageId);
        button.title = 'NPC State';
        button.setAttribute?.('aria-expanded', 'false');
        button.innerHTML = '<span class="meg-blocks-tab-emoji">👥</span><span class="meg-blocks-tab-label">NPC State</span>';
        button.addEventListener?.('click', event => {
            if (event?.defaultPrevented) return;
            event?.stopPropagation?.();

            const isOpen = button.classList?.contains?.('active')
                && pane?.style?.display !== 'none'
                && !card.classList?.contains?.('meg-blocks-shut');
            if (isOpen) {
                closeNpcStatePane(card);
                card.classList?.add?.('meg-blocks-shut');
                return;
            }

            const collapse = tabs.querySelector?.('.meg-blocks-collapse');
            if (typeof collapse?.click === 'function') {
                collapse.click();
                if (!card.classList?.contains?.('meg-blocks-shut')) collapse.click();
            }

            for (const nativePane of [...(card.querySelectorAll?.('.meg-block-body') || [])]) {
                if (nativePane?.style) nativePane.style.display = nativePane === pane ? '' : 'none';
            }
            for (const tab of [...(card.querySelectorAll?.('.meg-blocks-tab') || [])]) setClassActive(tab, tab === button);
            if (panel?.style) panel.style.display = '';
            card.classList?.remove?.('meg-blocks-shut');
            button.setAttribute?.('aria-expanded', 'true');
        });
        const collapse = tabs.querySelector?.('.meg-blocks-collapse');
        if (collapse?.before) collapse.before(button);
        else tabs.appendChild?.(button);
    }

    if (!pane) {
        pane = globalThis.document?.createElement?.('div');
        if (!pane) return false;
        pane.className = `meg-block-body ${PANE_CLASS}`;
        pane.dataset.key = key;
        if (messageId !== null) pane.dataset.npcStateMessageId = String(messageId);
        if (pane.style) pane.style.display = 'none';
        panel.appendChild?.(pane);
    }

    if (holder.parentElement !== pane) pane.appendChild?.(holder);
    bindNativeDismissBridge(card, button);
    return true;
}

function cleanupEmptyIntegrations(root) {
    let removed = 0;
    for (const pane of [...(root?.querySelectorAll?.(`.${PANE_CLASS}`) || [])]) {
        if (pane.querySelector?.(`#${INLINE_ID}`)) continue;
        const card = pane.closest?.('.meg-blocks, .inventory-block-card');
        const key = pane.dataset?.key || '';
        if (card && key) removeIntegration(card, key);
        else pane.remove?.();
        removed += 1;
    }
    return removed;
}

export function createMeguminBlockIntegration(options = {}) {
    const getRoot = typeof options.getRoot === 'function'
        ? options.getRoot
        : () => globalThis.document;
    const renderInline = typeof options.renderInline === 'function' ? options.renderInline : null;
    const intervalMs = Math.max(750, Number(options.intervalMs) || 2200);
    let observer = null;
    let timer = null;
    let repairTimer = null;
    let started = false;

    function repair() {
        const root = getRoot();
        if (!root?.querySelectorAll) return { mounted: 0, removed: 0, recovered: false };

        let holders = [...(root.querySelectorAll(`#${INLINE_ID}`) || [])];
        let recovered = false;
        if (!holders.length && renderInline) {
            try {
                renderInline();
                recovered = true;
                holders = [...(root.querySelectorAll(`#${INLINE_ID}`) || [])];
            } catch (error) {
                console.debug('[NPC State v0.3] Megumin inline recovery skipped', error);
            }
        }

        let mounted = 0;
        for (const holder of holders) {
            if (mountHolder(holder)) mounted += 1;
        }
        return { mounted, removed: cleanupEmptyIntegrations(root), recovered };
    }

    function queueRepair(delay = 0) {
        if (repairTimer) return;
        repairTimer = setTimeout(() => {
            repairTimer = null;
            repair();
        }, Math.max(0, Number(delay) || 0));
        repairTimer?.unref?.();
    }

    function start() {
        if (started) {
            queueRepair();
            return false;
        }
        started = true;
        const root = getRoot();
        const target = root?.querySelector?.('#chat') || root?.body || root;
        const MutationObserverCtor = globalThis.MutationObserver;
        if (typeof MutationObserverCtor === 'function' && target?.nodeType) {
            observer = new MutationObserverCtor(() => queueRepair(25));
            try { observer.observe(target, { childList: true, subtree: true }); }
            catch (error) {
                console.debug('[NPC State v0.3] Megumin MutationObserver could not attach', error);
                observer = null;
            }
        }
        timer = setInterval(() => repair(), intervalMs);
        timer?.unref?.();
        queueRepair();
        return true;
    }

    function stop() {
        observer?.disconnect?.();
        observer = null;
        if (timer) clearInterval(timer);
        if (repairTimer) clearTimeout(repairTimer);
        timer = null;
        repairTimer = null;
        started = false;
    }

    return Object.freeze({ start, stop, repair, get started() { return started; } });
}
