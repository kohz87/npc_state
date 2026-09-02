/* NPC State v0.3.0 - clean runtime bootstrap */
if (!document.getElementById('npc_state_v3_editor_flex_fix')) {
    const style = document.createElement('style');
    style.id = 'npc_state_v3_editor_flex_fix';
    style.textContent = '.npc-state-v3-editor-grid{min-height:0}';
    document.head.appendChild(style);
}
await import('./v03/index.js');
