/* NPC State v0.3.0 - clean runtime bootstrap */
const editorResponsiveHref = new URL('./v03/editor-responsive.css', import.meta.url).href;
if (!document.querySelector('link[data-npc-state-editor-responsive]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = editorResponsiveHref;
    link.dataset.npcStateEditorResponsive = '1';
    document.head.appendChild(link);
}
await import('./v03/index.js');
