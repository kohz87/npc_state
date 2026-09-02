import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createMeguminBlockIntegration,
    meguminBlockReady,
    meguminIntegrationKey,
    messageIdForElement,
} from '../v03/megumin.js';

test('Megumin adapter resolves SillyTavern message ids from supported message attributes', () => {
    assert.equal(messageIdForElement({ getAttribute: name => name === 'mesid' ? '14' : null, dataset: {} }), 14);
    assert.equal(messageIdForElement({ getAttribute: name => name === 'data-message-id' ? '21' : null, dataset: {} }), 21);
    assert.equal(messageIdForElement({ getAttribute: () => null, dataset: { mesid: '7' } }), 7);
    assert.equal(messageIdForElement({ getAttribute: () => null, dataset: { messageId: '9' } }), 9);
    assert.equal(messageIdForElement({ getAttribute: () => null, dataset: { mesid: 'nope' } }), null);
});

test('Megumin integration keys remain deterministic and message scoped', () => {
    assert.equal(meguminIntegrationKey(12), 'npc-state:12');
    assert.equal(meguminIntegrationKey('12'), 'npc-state:12');
    assert.equal(meguminIntegrationKey(null), 'npc-state:current');
});

function readyCard(ready = true) {
    return {
        querySelector(selector) {
            if (selector === '.meg-blocks-tabs') return ready ? {} : null;
            if (selector === '.meg-blocks-panel') return ready ? {} : null;
            return null;
        },
    };
}

function message({ native = null, inventory = null } = {}) {
    return {
        querySelector(selector) {
            if (selector === '.meg-blocks') return native;
            if (selector === '.inventory-block-card') return inventory;
            return null;
        },
    };
}

test('Megumin adapter accepts a complete native host and rejects an incomplete one', () => {
    assert.equal(meguminBlockReady(message({ native: readyCard(true) })), true);
    assert.equal(meguminBlockReady(message({ native: readyCard(false) })), false);
    assert.equal(meguminBlockReady(message()), false);
});

test('Inventory Block standalone shell is a compatible fallback tab host', () => {
    assert.equal(meguminBlockReady(message({ inventory: readyCard(true) })), true);
    assert.equal(meguminBlockReady(message({ native: readyCard(false), inventory: readyCard(true) })), true);
    assert.equal(meguminBlockReady(message({ inventory: readyCard(false) })), false);
});

test('repair asks the UI to recreate a missing Present NPC holder after host rebuilds', () => {
    let renders = 0;
    const root = { querySelectorAll: () => [] };
    const integration = createMeguminBlockIntegration({
        getRoot: () => root,
        renderInline: () => { renders += 1; },
    });
    const result = integration.repair();
    assert.equal(renders, 1);
    assert.equal(result.recovered, true);
    assert.equal(result.mounted, 0);
});
