# NPC State v0.2.13 Test Report

Target: SillyTavern 1.18.0 extension contract.

## Result

**PASS**

The reviewed working tree completed:

- **320/320 Node tests passed**
- SillyTavern 1.18 compatibility/import/event contract passed
- Megumin Suite isolation and master-block integration checks passed
- Mocked browser/runtime smoke passed
- Schema-v24 settings/sidecar migration smoke passed
- One-level extension package-layout check passed

The bounded routine scanner fixture measured **7,115 non-story prompt characters**, below the existing 7,200-character ceiling.


## v0.2.12 Social Graph / identity-resolution coverage

- `Thunderbird -> Mina` rewrites neighboring structured family references to Mina, retains Thunderbird as an alias, and produces one ID-backed graph edge instead of duplicate relationship fossils.
- Multi-hop canonical rename (`Thunderbird -> Mina -> Mina Vale`) keeps historical aliases while structured display uses only the newest canonical name and richer relationship wording survives dedupe.
- Already-split interim/proper dossiers merge only with explicit alias evidence; the older stable id and relationship history survive, and graph endpoints remap. Ambiguous shared aliases remain unresolved.
- `two daughters`, `a daughter`, `twin daughters`, and explicit parent-of phrasing produce bounded unresolved slots. Partial naming consumes only the proven slot; unrelated proper names do not guess membership.
- Locally grounded older/younger descriptors guide partial resolution; descriptor words in another sentence cannot contaminate the family group. Twin resolution infers `twin sibling` and never invents birth order.
- Deceased/archived relatives remain graph-connected and project explicit deceased wording. Hard deletion, OOC removal, stale pruning, and permanent swipe-restored dismissal cannot leave dangling graph ids or stale structured counterpart references.
- Exact sibling swipes restore Social Graph edges and unresolved slots independently. Sidecars and bundles round-trip graph state; bundle merge remaps imported graph ids onto an existing stable dossier id.
- Hidden graph counterparts contribute runtime salience even when outside the visible top-five Key Relationships. RP injection never exposes graph ids, unresolved slots, group ids, provenance, or other backend machinery.
- Large-family inferred sibling expansion is bounded and cannot crowd an explicit social edge out of the graph.

## v0.2.11 milestone / exact-swipe coverage

- Directional `25/50/75/90` relationship milestones are tested independently for positive and negative polarity; movement toward neutral never hits a milestone gate.
- Hidden fractional progress operates only inside unlocked bands. Non-qualifying outward evidence cannot bank behind a locked boundary, while an eligible breakthrough unlocks the checkpoint without releasing a stored jump.
- Milestone qualification requires both the semantic impact tier and minimum raw evidence weight; a tiny `+1` labeled extreme cannot unlock 90.
- Legacy established scores infer only already-passed directional milestones, and manual relationship edits infer milestones through the explicitly entered depth without rescaling the score.
- Checkpoint-blocked evidence remains available for semantic dedupe but does not replace Last Relationship Change when score/progress/milestones are unchanged. Relationship Summary cannot claim depth beyond the unlocked milestone state.
- Two different swipes at the same assistant message preserve independent exact sibling checkpoints, and A -> B -> A restores the original A snapshot rather than rescanning it.
- First-message/greeting swipes restore from a pre-message root anchor. Deleted-swipe index renumbering does not break sibling identity because branch keys depend on content lineage, not `swipe_id`.
- Actual v0.2.10 swipe-index fingerprints migrate only when their entire legacy prefix matches the loaded chat; edited/stale legacy prefixes are rejected.
- Scan-due assistant turns are not marked exact before their asynchronous scan completes, preventing stale pre-scan state from suppressing a required rescan.
- Lineage-specific inline cards, bounded sibling-history pruning, and two-lane branch fingerprints are covered.
- Permanent manual UI deletion suppression survives exact sibling restoration; explicit re-add can lift the matching alias group.
- Sidecar and bundle tests preserve branch root/sibling state, fractional relationship progress, milestone audit reasons, recent relationship evidence, and user deletion suppression.
- Schema-v23 migration preserves visible relationship scores/custom tuning while inferring already-passed milestones and retaining v0.2.8/v0.2.9 stock-cap migration behavior.

## v0.2.10 relationship-weighting coverage

- Stock raw relationship weights validate at `1/2/5/10`; 10 is the stock single-event ceiling before resistance.
- Fractional accumulation proves four ordinary +1 events at score 90 do not move the visible meter; the fifth does. At 95+, ten ordinary +1 events are required for one visible point.
- Extreme +10 at score 90 is weighted to roughly +2 while extreme contrary -10 can still punch through established resilience.
- Minor contrary evidence at high Trust accumulates fractionally rather than immediately removing a visible point.
- Per-axis evidence is mandatory for every moved axis; Desire fails on rescue-only narration and succeeds only with explicit attraction/intimacy narration.
- A-B-A replay is caught by the six-event history, and duplicate/rejected events cannot rewrite Relationship Summary.
- Unsupported `madly in love`, sexual-attraction, possessive, obsessive, and would-kill style summary claims are rejected when state/evidence do not support them.
- Equal-sized multi-axis overflow is rejected instead of deterministically favoring Trust/Affection.
- RP injection contains no raw Trust/Affection/Desire/Tension numbers and emits the qualitative relationship context only once, after Identity/Agency/Current State.
- Bundle/import and branch rollback preserve fractional relationship progress plus recent evidence history.
- v0.2.9 stock migration moves to schema v22 `1/2/5/10`; custom caps and even stock-prefix custom rubrics remain untouched.
- Natural evidence inflections such as `trusts` are accepted without loosening Desire or other axis-specific grounding.

## v0.2.9 relationship-inertia coverage

- Stock relationship caps validate at `1/3/8/20`; customized legacy-sized caps remain supported.
- Ordinary events are limited to one axis and meaningful events to two axes even when a model proposes movement on all four.
- Deepening Trust at +85 is strongly inertial, while equally strong contrary evidence moves back toward neutral at full tier strength; major events bypass much of the inertia.
- Recent semantically duplicate relationship reasons are rejected across immediate aftermath scans, while distinct later events remain eligible.
- Same source-message ID does not by itself suppress a genuinely different relationship event, preserving update/swipe semantics.
- High Trust/Affection/Desire/Tension injection keeps Personality, Behavioral Profile, Speech, Mannerisms, Goal, non-player bonds, Mood, and Status ahead of the relationship modifier.
- Low relationship scores inject one compact neutral/unsettled cue instead of four neutral-axis explanations.
- Full-name NPCs remain selectable from grounded first-name narration without adding relationship magnitude back into salience.
- Runtime focused relationship repair still handles drastic betrayal under custom caps and updates the durable Relationship Summary.
- Legacy migration advances to schema v21 and adopts the new stock caps while preserving existing live relationship scores.

## v0.2.8 canon-hygiene coverage

- Word-form and decade Apparent Age values normalize to stable `~N`; equivalent `Twenties` / `around twenties` wording does not reroll the same NPC.
- Unknown Apparent Age prose is rejected instead of persisted.
- Redundant explicit age in unlocked Appearance is removed while structured Apparent Age remains authoritative.
- Noctis-style low/moderate relationship summaries cannot retain `indispensable` dependency wording; Brina's fixture is reframed to `a growing source of practical support and comfort`.
- Generated relationship deltas with missing or story-ungrounded reasons are rejected; grounded reasons apply normally; manual audit deltas remain valid.
- PC/intimacy-specific Behavioral Profile rules do not become global identity canon.
- Overlapping Conflict/Anger/Composure profile rules compact into one reusable behavioral rule.
- Repeated paperwork gesture variants compact into one Mannerism.
- Ambiguous `(deceased)` Key Relationship wording is rewritten with an explicit surviving/deceased subject.
- Scanner importance cannot change durable Importance; new scanned dossiers keep neutral 50 while contextual salience controls prompt selection.
- Runtime smoke fixtures now require narrated evidence for relationship changes rather than silently accepting ungrounded deltas.
- v0.2.8 canon-hygiene behavior remains covered under the current v0.2.11 / schema v23 package.

## v0.2.7 final hard-pass coverage

- Quoted scanner booleans (`"false"`) cannot mark presence, world activity, identity continuity, clearing, or evolution as true.
- Malformed relationship scores/caps fall back safely rather than normalizing to negative extremes.
- Negated morality wording such as `never cruel` preserves the established kindness guard.
- Short NPC names receive whole-phrase relevance only.
- Key Relationship evolution changes named counterparts without deleting omitted bonds.
- Sidecar portrait compaction stores high-resolution portrait bytes once and prefers the live NPC copy over a stale asset entry.
- Bundle roster caps count active dossiers while preserving archives.
- Blank durable Personality/Speech/Appearance cannot be seeded by an ungrounded first impression.
- First Mannerisms require recurrence or repeated cross-scan evidence.
- Repeated evidence can seed an empty trait only when it supports the proposed trait.
- Runtime smoke covers stale in-flight scan discard after dossier state mutation.
- Historical v0.2.7 migration/persistence contracts remain covered; current package version is v0.2.11 with schema v23.

## v0.2.6 hard-pass coverage

- Minimum 512-token injection preserves all established identity channels plus Role, current Goal, and Key Relationships.
- Minimum-budget Behavioral Profile compaction preserves high-priority categories such as Disposition, Cruelty, and Independence even when individual rules are verbose.
- Missing `developmentScale` cannot authorize immediate evolution.
- Gradual evolution requires the same labeled pattern across separate scans; unrelated evidence is rejected.
- Personality/Speech/Behavioral Profile transition-language smuggling through `refine` is rejected.
- Generic cruelty cannot be added to a broadly kind personality through refinement or contradictory first-pass behavior extraction.
- One-off gestures cannot become recurring mannerisms when source narration does not establish recurrence.
- Batch development is rejected when the model invents development over bare elapsed time, and accepted when the actual time-skip narration establishes the change.
- Explicit evolution requires a nearby lasting-change/correction cue in source narration; shared vocabulary from a one-off act is insufficient. Batch evolution cannot borrow unrelated present-day evidence from elsewhere in the transcript.
- Focused relationship prompts include identity, goals, and non-player bonds.
- Sidecar reads reject valid NPC State payloads belonging to a different chat.
- Behavioral Profile category parsing accepts Unicode labels.

## v0.2.5 identity/evolution coverage

- Identity core is injected before relationship stats and includes the compact Behavioral Profile when available.
- High Trust/Affection/Desire/Tension cannot silently replace identity with generic romance/tsundere behavior.
- General kindness/empathy survives high player affection; necessary force is explicitly separated from gratuitous cruelty.
- Behavioral Profile category dedupe and six-item cap are enforced.
- Gradual durable evolution requires evidence carried across scans; one scan cannot self-supply enough evidence to rewrite identity.
- A bare time skip cannot batch-rewrite Personality, while an explicit skipped-period development summary can.
- The ordinary NPC-delta merge path cannot bypass the gradual evidence gate.
- Untouched v0.2.4 stock behavior-rubric detection is exact enough to preserve customized user rubrics.

## v0.2.4 semantic-compaction coverage

### Durable dossier reconciliation

- Duplicate telepathic-link descriptions collapse to one durable concept during normalization.
- Paraphrases of the same mannerism collapse while distinct habits involving the same counterpart remain separate.
- Repeating the same full-summary refinement across multiple scans produces a stable result instead of growing the field each turn.
- Rolling profile evidence and Important Memories semantically deduplicate paraphrased observations/events.
- Key Relationships keep one compact entry per counterpart.
- Existing pre-v0.2.4 sidecars are compacted once, assigned a durable-compaction version, and rewritten through the normal race-safe sidecar writer.
- Inline cards and branch-checkpoint NPC snapshots are normalized so rollback cannot restore old bloat.

### Prompt and storage bounds

- Auto-managed durable fields have canonical hard caps before persistence.
- Stable-profile scanner context applies tighter per-field slices than storage, preventing an oversized legacy/manual dossier from consuming the full scan prompt.
- Scanner/backfill/refresh contracts require CURRENT COMPACT SUMMARY output with one concept, counterpart, and event represented once.

## Retained v0.2.2 review coverage

### Sidecar durability

- Delays the first sidecar upload, mutates the same NPC while that upload is pending, and verifies a second immutable snapshot persists the final state.
- Deletes a chat while an upload is blocked, then verifies the completed old upload cannot recreate its pointer or sidecar.
- Exercises rename transfer after pending state has been loaded and settled.

### Settings write isolation

- Migrating an older settings schema performs one consolidated settings save rather than one save per historical schema step.
- Checkbox, number, and text settings controls use settings-only persistence and do not dirty/rewrite the current chat sidecar.
- Dossier, portrait, branch, archive, and relationship mutations continue to use the state-persistence path.

### Bounded work on long chats

- Recent transcript extraction walks backward and stops after the configured number of meaningful messages rather than cleaning every message in the chat.
- Megumin dossier lookup searches newest-first and stops at the latest matching `<New_NPC>` base while retaining relevant later updates.
- Recurring inline reconciliation is scoped to the chat root instead of the whole document.
- Portrait-gallery rendering uses one current-NPC lookup map per pass.

### Contract and compaction guards

- `NPC_ARCHIVE_REASONS` includes the runtime-supported `stale` reason.
- Removed helpers and retired CSS generations are asserted absent.
- Current portrait gallery, responsive dossier viewer, Portrait Generator layering, Megumin tab integration, mobile touch isolation, and bounded tablet cards remain covered.
- Package tests require the current README, changelog, code-review report, and test report at the extension root.

## Retained functional coverage

The suite continues to cover:

- NPC admission, identity promotion, aliases, Minor NPC visibility, active roster limits, and stale archive/delete lifecycle
- Personality, Speech, Appearance, Mannerisms, Age/Apparent Age, Status, Mood, Goal, Location, Background, Important Memories, and Key Relationships
- Trust/Affection/Desire/Tension deltas, relationship prose synchronization, replay prevention, focused repair, and branch rollback
- quick scans, full scans, targeted dossier import, Refresh from Chat, durable-profile evidence accumulation, and malformed-JSON recovery
- present versus off-screen semantics for narration, World State, and NPC Inner Chatter
- Megumin August 18 `<Blocks>` parsing, in-card tab mounting, redraw reattachment, native tab handoff, and standalone fallback
- native SillyTavern `/imagine quiet=true` portrait generation, Positive/Negative prompt building, preview, regeneration, and use-as-portrait confirmation
- portrait compression/assets, `.npcstate` import/export, corrupt-bundle rejection, sidecar migration, archive/reactivation, chat rename/delete, swipes, edits, and inherited branches

## Review boundary

The automated environment mocks SillyTavern's browser, file API, slash-command bridge, and image-generation responses. It does not exercise the user's exact theme, mobile browser gesture stack, Stable Horde queue behavior, checkpoint availability, or third-party extension combination. Those remain deployment checks in the real installation.
