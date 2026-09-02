import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dossierHtml } from '../v03/dossier-view.js';
import { compressPortrait } from '../v03/portrait-attachment.js';
import { normalizeNpc } from '../v03/schema.js';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const attachmentSource = readFileSync(new URL('../v03/portrait-attachment.js', import.meta.url), 'utf8');

function npc(patch = {}) {
    return normalizeNpc({ id: 'npc-astra', name: 'Astra', ...patch });
}

test('More menu offers Attach portrait when the dossier has no image', () => {
    const html = dossierHtml(npc());
    assert.match(html, /class="npc-state-v3-portrait-file"[^>]*type="file"[^>]*accept="image\/\*"[^>]*hidden/);
    assert.match(html, /npc-state-v3-attach-portrait/);
    assert.match(html, /Attach portrait<\/label>/);
    assert.doesNotMatch(html, /npc-state-v3-remove-portrait/);
});

test('More menu switches to Change portrait and exposes Remove portrait when an image exists', () => {
    const html = dossierHtml(npc({ portrait: { dataUrl: 'data:image/webp;base64,abc' } }));
    assert.match(html, /Change portrait<\/label>/);
    assert.match(html, /class="menu_button npc-state-v3-remove-portrait" data-npc-id="npc-astra"/);
    assert.match(html, /Remove portrait<\/button>/);
});

test('portrait attachment bridge is loaded after the main runtime and keeps stable-chat protection', () => {
    const runtimeImport = bootstrap.indexOf("await import('./v03/index.js')");
    const attachmentImport = bootstrap.indexOf("await import('./v03/portrait-attachment.js')");
    assert.ok(runtimeImport >= 0);
    assert.ok(attachmentImport > runtimeImport);
    assert.match(bootstrap, /startPortraitAttachmentBridge\(\);/);
    assert.match(attachmentSource, /currentState\?\.chatKey/);
    assert.match(attachmentSource, /api\.updateNpc\(id, \{ portrait \}\)/);
    assert.match(attachmentSource, /api\.updateNpc\(id, \{ portrait: null \}\)/);
});

test('portrait compressor rejects non-image files before touching browser APIs', async () => {
    await assert.rejects(() => compressPortrait({ type: 'text/plain', name: 'notes.txt' }), /Choose an image file/);
});

test('portrait compressor preserves high-resolution detail up to 1536 px', async () => {
    const PreviousReader = globalThis.FileReader;
    const PreviousImage = globalThis.Image;
    class FakeReader {
        readAsDataURL() {
            this.result = 'data:image/png;base64,source';
            this.onload?.();
        }
    }
    class FakeImage {
        constructor() {
            this.width = 2000;
            this.height = 1000;
        }
        set src(_value) { this.onload?.(); }
    }
    const canvas = {
        width: 0,
        height: 0,
        getContext() {
            return {
                imageSmoothingEnabled: false,
                imageSmoothingQuality: 'low',
                drawImage() {},
            };
        },
        toDataURL(type) {
            return `${type === 'image/webp' ? 'data:image/webp' : 'data:image/jpeg'};base64,abc`;
        },
    };
    globalThis.FileReader = FakeReader;
    globalThis.Image = FakeImage;
    try {
        const portrait = await compressPortrait(
            { type: 'image/png', name: 'astra.png' },
            { createElement: tag => tag === 'canvas' ? canvas : null },
        );
        assert.equal(portrait.width, 1536);
        assert.equal(portrait.height, 768);
        assert.equal(portrait.mime, 'image/webp');
        assert.equal(portrait.sourceName, 'astra.png');
    } finally {
        if (PreviousReader === undefined) delete globalThis.FileReader;
        else globalThis.FileReader = PreviousReader;
        if (PreviousImage === undefined) delete globalThis.Image;
        else globalThis.Image = PreviousImage;
    }
});
