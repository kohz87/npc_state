const FILE_SELECTOR = '.npc-state-v3-portrait-file';
const REMOVE_SELECTOR = '.npc-state-v3-remove-portrait';
let started = false;

function notify(kind, message) {
    const fn = globalThis.toastr?.[kind];
    if (typeof fn === 'function') fn(`NPC State: ${message}`);
}

function npcStateApi() {
    return globalThis.NPCState && typeof globalThis.NPCState === 'object' ? globalThis.NPCState : null;
}

function readImageSource(file) {
    return new Promise((resolve, reject) => {
        const Reader = globalThis.FileReader;
        if (typeof Reader !== 'function') return reject(new Error('This browser cannot read local image files.'));
        const reader = new Reader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
    });
}

function decodeImage(source) {
    return new Promise((resolve, reject) => {
        const ImageCtor = globalThis.Image;
        if (typeof ImageCtor !== 'function') return reject(new Error('This browser cannot decode the selected image.'));
        const image = new ImageCtor();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode image.'));
        image.src = source;
    });
}

/**
 * Compress a manually selected portrait using the same bounded high-resolution
 * policy as the mature v0.2 attachment workflow.
 */
export async function compressPortrait(file, doc = globalThis.document) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.');
    if (!doc?.createElement) throw new Error('Portrait compression requires a browser document.');

    const source = await readImageSource(file);
    const image = await decodeImage(source);
    const maxSide = 1536;
    const maxDataUrlLength = 1_600_000;
    const scale = Math.min(1, maxSide / Math.max(Number(image.width) || 1, Number(image.height) || 1));
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round((Number(image.width) || 1) * scale));
    canvas.height = Math.max(1, Math.round((Number(image.height) || 1) * scale));
    const context = canvas.getContext?.('2d', { alpha: false });
    if (!context) throw new Error('Could not prepare the portrait image.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const encode = quality => {
        let value = canvas.toDataURL('image/webp', quality);
        if (!String(value || '').startsWith('data:image/webp')) value = canvas.toDataURL('image/jpeg', quality);
        return String(value || '');
    };

    let dataUrl = encode(0.88);
    for (const quality of [0.84, 0.80, 0.76, 0.72, 0.68]) {
        if (dataUrl.length <= maxDataUrlLength) break;
        dataUrl = encode(quality);
    }
    if (dataUrl.length > maxDataUrlLength) {
        throw new Error('Portrait is still too large after high-resolution compression. Try a smaller image.');
    }

    return {
        dataUrl,
        mime: dataUrl.slice(5, dataUrl.indexOf(';')),
        sourceName: String(file.name || ''),
        width: canvas.width,
        height: canvas.height,
        updatedAt: Date.now(),
    };
}

function liveNpc(api, id) {
    return api?.getState?.()?.npcs?.find?.(npc => npc?.id === id) || null;
}

async function attachPortrait(input) {
    const api = npcStateApi();
    const id = String(input?.dataset?.npcId || '');
    const file = input?.files?.[0] || null;
    if (input) input.value = '';
    if (!api?.updateNpc || !id || !file) return false;

    const originState = api.getState?.();
    const originChatKey = String(originState?.chatKey || '');
    if (!originChatKey || !originState?.npcs?.some?.(npc => npc?.id === id)) return false;

    try {
        input.disabled = true;
        const portrait = await compressPortrait(file);
        const currentState = api.getState?.();
        if (String(currentState?.chatKey || '') !== originChatKey || !liveNpc(api, id)) {
            notify('warning', 'portrait attachment was cancelled because the active chat changed.');
            return false;
        }
        const result = await api.updateNpc(id, { portrait });
        if (!result?.ok) throw new Error(`portrait update was rejected (${result?.reason || 'unknown reason'}).`);
        notify('success', `portrait ${liveNpc(api, id)?.portrait?.dataUrl ? 'attached' : 'updated'}.`);
        return true;
    } catch (error) {
        console.error('[NPC State v0.3] portrait attachment failed safely', error);
        notify('error', error?.message || String(error));
        return false;
    } finally {
        input.disabled = false;
        input.closest?.('details')?.removeAttribute?.('open');
    }
}

async function removePortrait(button) {
    const api = npcStateApi();
    const id = String(button?.dataset?.npcId || '');
    if (!api?.updateNpc || !id || !liveNpc(api, id)) return false;
    try {
        button.disabled = true;
        const result = await api.updateNpc(id, { portrait: null });
        if (!result?.ok) throw new Error(`portrait removal was rejected (${result?.reason || 'unknown reason'}).`);
        notify('success', 'portrait removed.');
        return true;
    } catch (error) {
        console.error('[NPC State v0.3] portrait removal failed safely', error);
        notify('error', error?.message || String(error));
        return false;
    } finally {
        button.disabled = false;
        button.closest?.('details')?.removeAttribute?.('open');
    }
}

/**
 * Delegated bridge so dossier rerenders do not require rebinding attachment UI.
 * It never intercepts the More-menu label click or the file picker itself.
 */
export function startPortraitAttachmentBridge(doc = globalThis.document) {
    if (started || !doc?.addEventListener) return false;
    started = true;

    doc.addEventListener('change', event => {
        const input = event.target?.closest?.(FILE_SELECTOR);
        if (!input) return;
        void attachPortrait(input);
    });

    doc.addEventListener('click', event => {
        const button = event.target?.closest?.(REMOVE_SELECTOR);
        if (!button) return;
        void removePortrait(button);
    });

    return true;
}
