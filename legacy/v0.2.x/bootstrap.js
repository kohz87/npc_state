/* NPC State v0.2.21 - lifecycle and durability hardening wrapper */
import { prepareNpcStateHardening } from './hardening.js';

await prepareNpcStateHardening();
await import('./index.js');
try {
    await import('./enhancements.js');
} catch (error) {
    console.error('[NPC State] optional full-cast/library enhancements failed to load', error);
}
