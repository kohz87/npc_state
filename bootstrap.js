/* NPC State v0.3.1 - clean runtime bootstrap */
if (!document.getElementById('npc_state_v3_editor_flex_fix')) {
    const style = document.createElement('style');
    style.id = 'npc_state_v3_editor_flex_fix';
    style.textContent = `
.npc-state-v3-editor-grid{min-height:0}
.npc-state-v3-editor-overlay[popover]{
  margin:0!important;
  border:0!important;
  width:auto!important;
  height:auto!important;
  max-width:none!important;
  max-height:none!important;
}
@media(max-width:1180px),(hover:none) and (pointer:coarse){
  .npc-state-v3-editor-overlay{
    align-items:flex-start!important;
    overflow-y:auto!important;
    overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
    padding:12px 2vw 16px!important;
  }
  .npc-state-v3-editor-shell{
    height:auto!important;
    max-height:none!important;
    min-height:0;
  }
  .npc-state-v3-editor-grid{
    flex:0 0 auto!important;
    overflow:visible!important;
  }
}`;
    document.head.appendChild(style);
}
const settingsResponsiveHref = new URL('./v03/settings-responsive.css', import.meta.url).href;
if (!document.querySelector('link[data-npc-state-settings-responsive]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = settingsResponsiveHref;
    link.dataset.npcStateSettingsResponsive = '1';
    document.head.appendChild(link);
}
await import('./v03/index.js');
const { startSettingsLayoutCoordinator } = await import('./v03/settings-layout.js');
startSettingsLayoutCoordinator();
const { startManualOperationFeedback } = await import('./v03/manual-operation-feedback.js');
startManualOperationFeedback();
const { startEditorTopLayerBridge } = await import('./v03/editor-top-layer.js');
startEditorTopLayerBridge();
const { startPortraitAttachmentBridge } = await import('./v03/portrait-attachment.js');
startPortraitAttachmentBridge();
