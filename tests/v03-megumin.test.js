import test from 'node:test';
import assert from 'node:assert/strict';
import { meguminBlockReady, meguminIntegrationKey, messageIdForElement } from '../v03/megumin.js';

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

test('Megumin adapter mounts only when both native tab and panel hosts exist', () => {
    const readyCard = {
        querySelector(selector) {
            if (selector === '.meg-blocks-tabs') return {};
            if (selector === '.meg-blocks-panel') return {};
            return null;
        },
    };
    const partialCard = {
        querySelector(selector) {
            return selector === '.meg-blocks-tabs' ? {} : null;
        },
    };
    const message = card => ({ querySelector: selector => selector === '.meg-blocks' ? card : null });
    assert.equal(meguminBlockReady(message(readyCard)), true);
    assert.equal(meguminBlockReady(message(partialCard)), false);
    assert.equal(meguminBlockReady(message(null)), false);
});
