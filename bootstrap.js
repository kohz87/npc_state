/* NPC State v0.3.0 - clean runtime bootstrap */
if (!document.getElementById('npc_state_v3_editor_flex_fix')) {
    const style = document.createElement('style');
    style.id = 'npc_state_v3_editor_flex_fix';
    style.textContent = `
.npc-state-v3-editor-grid{min-height:0}
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
await import('./v03/index.js');
