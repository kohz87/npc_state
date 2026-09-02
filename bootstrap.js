/* NPC State v0.2.21 - lifecycle and durability hardening wrapper */
import { prepareNpcStateHardening } from './hardening.js';

await prepareNpcStateHardening();
await import('./index.js');
