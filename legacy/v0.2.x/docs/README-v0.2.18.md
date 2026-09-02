# NPC State v0.2.18

NPC State is a standalone SillyTavern extension that maintains persistent, branch-aware NPC dossiers for roleplay. It tracks identity, durable characterization, live state, player relationships, important memories, portraits, and present-scene visibility without depending on Megumin Suite's NPC Bank.

## Install

The ZIP contains exactly one top-level folder:

```text
npc_state/
  manifest.json
  index.js
  core.js
  branch.js
  bundle.js
  social.js
  storage.js
  identity.js
  style.css
  CHANGELOG.md
  CODE-REVIEW.md
  TEST-REPORT.md
```

Extract `npc_state/` directly into your SillyTavern extension directory, then restart SillyTavern:

```text
data/<user-handle>/extensions/npc_state/
```

A global/development installation may instead use:

```text
public/scripts/extensions/third-party/npc_state/
```

Do not leave an extra wrapper directory around `npc_state/`.

## What it tracks

Each dossier can contain:

- canonical name and aliases
- role, Species/Race, chronological Age, and Apparent Age
- Appearance, Personality, compact Behavioral Profile, Speech, Background, and Mannerisms
- current Mood, Goal, Status, Location, presence, and explicit off-screen activity
- Key Relationships with other people
- relationship summary with the player
- Trust, Affection, Desire, and Tension on a bipolar `-100..+100` scale
- up to five curated Important Memories
- portrait image and per-NPC portrait prompt overrides
- archive, stale-retention, Minor NPC, and manual-lock state

## Normal workflow

1. Enable **Auto scan**.
2. Continue the roleplay normally.
3. NPC State scans the latest exchange and updates relevant dossiers.
4. Present non-minor NPCs appear as portrait cards in the NPC State gallery.
5. Tap a portrait to open the focused dossier viewer.

The viewer uses:

- a large persistent portrait rail on desktop/tablet landscape
- a cinematic portrait hero on tablet portrait and phones
- a fixed close button and bottom action bar
- a scrollable dossier document with Current, Profile, Relationships, Background, and Important Memories sections

## Quick scan and Full scan every turn

**Quick scan** is the default. It scans the current exchange and keeps routine token/latency costs low.

**Full scan every turn** uses the configured recent-history window after every assistant reply. It is useful when subtle profile details are frequently missed, but it is heavier. Numeric relationship deltas are still evaluated from the newest exchange only, preventing old events in the rolling window from being scored repeatedly.

The **Full/manual scan context** setting controls the recent-history window used by:

- Full scan every turn
- manual **Scan dossier now**
- per-NPC **Refresh from Chat**

## Edit Dossier actions

### Scan dossier

For a newly created or sparse NPC, **Scan dossier** first looks for matching Megumin `<New_NPC>` and `<NPC_Update>` blocks. When none exist, it falls back to targeted recent-story backfill.

Structured dossier import can populate profile fields and Key Relationships, but it does not manufacture or replay numeric player-relationship deltas.

### Refresh from Chat

**Refresh from Chat** re-reads the configured history window for one existing NPC and reconciles grounded unlocked fields. It preserves live presence/recency and current relationship numbers.

### Protect edited stable profile fields

When enabled, manually protected stable fields cannot be overwritten automatically. When disabled, manually entered values become the established baseline and may organically refine or evolve from later story evidence.

## Durable and live field lifecycles

### Durable but evolving

- Personality
- Behavioral Profile
- Speech
- Appearance
- Mannerisms
- Background
- Key Relationships

These remain stable by default. New grounded details may refine them; sustained development may evolve them; explicit corrections may replace inaccurate facts. Personality, Speech, Mannerisms, and Behavioral Profile evolve gradually during ordinary continuity. An explicit lasting change may update directly, while a time skip receives batch-update authority only when narration actually summarizes sustained development during the skipped period. Mere passage of time changes nothing.
At tight injection budgets, Behavioral Profile rules are reduced to short category heads so high-priority social/morality cues such as Disposition, Cruelty, and Independence remain visible rather than being crowded out by one verbose rule.

### Live state

- Mood
- Goal
- Status
- Location
- `present`
- `worldActive`

These are reconsidered from the newest scene. Compact Megumin World State omission does not falsely terminate an established off-screen activity.

### Age

Chronological Age advances only from explicit chronology, birthdays, or exact elapsed time. Apparent Age evolves independently when visual aging, growth, rejuvenation, illness, or transformation is established.

## Key Relationships

Key Relationships track important non-player ties separately from the NPC's relationship with the player.

Example:

```text
Mara — younger sister | fiercely protective
Dain — former mentor | respected despite estrangement
```

Explicit social statements may be captured through both model output and a conservative local edge extractor. Newly learned ties merge into the current set; actual social changes such as marriage, betrayal, estrangement, reconciliation, or death can replace the affected relationship state.

## Identity-first behavior

v0.2.5 makes durable identity authoritative over relationship scores. Personality, Behavioral Profile, Speech, and Mannerisms are injected before Trust/Affection/Desire/Tension. Relationship numbers modify player-specific expression; they do not create obedience, clinginess, jealousy, tsundere behavior, universal player priority, or cruelty toward unrelated NPCs.

**Behavioral Profile** is a compact point-form translation of established identity for smaller/non-frontier models. It holds up to six labeled cues such as `Disposition`, `Expressiveness`, `Independence`, `Care`, `Conflict`, or `Cruelty-Social`. It is deliberately bounded and shares the existing injection budget rather than becoming a second prose dossier.

Kindness/empathy are target-general by default. A kind NPC may still use necessary lethal force, refuse the player, prioritize another duty, or dislike a particular person without becoming generically cruel. Relationship-specific behavior is kept relationship-specific instead of being learned back into global Personality/Speech/Mannerisms.

## v0.2.12 Social Graph and canonical identity resolution

NPC State now keeps a hidden ID-backed Social Graph beneath the visible `Key Relationships` list. Names are labels, not identity keys: when an interim identity is formally resolved (`Thunderbird -> Mina`), the dossier keeps the same stable identity, `Thunderbird` remains an alias for recognition, and structured relationships elsewhere display only the current canonical name. Existing alias/canonical duplicates are collapsed conservatively, while ordinary memories/background prose is never globally search-and-replaced.

Unnamed family members can remain useful before they receive names. Explicit facts such as `Brina has two daughters`, `Brina has a daughter`, `Brina has twin daughters`, or `Brina is the mother of two daughters` create hidden unresolved family slots rather than fake NPC names. A later explicit daughter edge resolves a slot into that NPC id; one named daughter leaves the other unresolved, and a proper name appearing without family evidence does not get guessed into the family. Twin/shared-parent relationships can infer sibling continuity without inventing older/younger birth order, biological status, or other unstated details.

The graph can retain more durable social edges than the max-five Key Relationships projection. Runtime salience may notice an off-screen relative mentioned in the scene even when that bond is not currently visible in the five-entry dossier list, but generation still receives only confirmed-present NPC dossiers and never sees unresolved slots, graph ids, confidence/provenance, or instructions to force a family introduction.

Social Graph state is branch-specific and follows the v0.2.11 exact-swipe model. A family name resolved in Swipe A does not leak into Swipe B. Sidecar reloads, bundles/imports, branch roots, archive/death, manual edits, permanent deletion suppression, and identity migration all preserve or clean graph state deterministically.

## v0.2.11 relationship milestones and exact swipe branches

v0.2.11 adds story-significance gates at relationship depth `25`, `50`, `75`, and `90` without turning the relationship meter into a story director. Hidden fractional progress still measures sub-integer evidence inside an unlocked band, but outward progress cannot accumulate through a locked checkpoint. Under stock settings, crossing 25 requires meaningful evidence, 50 requires a major event, 75 requires an extreme event, and 90 requires an extreme relationship-defining event with substantial raw evidence. Milestones are directional per axis, so deep trust and deep distrust have separate histories. Movement back toward neutral is never checkpoint-blocked.

Milestone state is hidden from the RP-generation prompt. The extension stores the axis, polarity, threshold, reason, source message, and turn for an unlocked checkpoint so the relationship can be audited and restored exactly after a swipe. Previously crossed checkpoints stay historically unlocked if the score later falls and rebuilds. Manual relationship edits and imported established scores infer already-passed milestones rather than rescaling or trapping existing relationships.

Swipe handling now preserves exact sibling narrative states instead of keeping only one checkpoint per message. Branch identity uses stable content-lineage fingerprints rather than `swipe_id`, so deleting an alternate and renumbering SillyTavern swipe indices does not invalidate surviving snapshots. Revisiting a previously scanned swipe restores its exact dossier state with no LLM rescan; a never-before-seen swipe restores its parent/root state, scans once, then becomes its own sibling snapshot. First-message/greeting swipes use a pre-message root anchor so the previous alternate cannot leak into a new opening swipe.

Inline NPC cards follow the same lineage-specific sibling state. In-flight scans capture branch identity and state revision before generation and are discarded if the user swipes or edits state before the response lands. Branch history remains bounded; old unreachable sibling snapshots may eventually be evicted, in which case revisiting that very old swipe safely falls back to parent/root restoration plus one rescan. Portraits and user-managed dossier metadata are preserved across narrative restoration. Manual UI deletion suppression is kept outside narrative snapshots so revisiting an older sibling cannot resurrect a dossier the user explicitly deleted; an explicit Add/import can lift that suppression.

## v0.2.10 relationship weighting and evidence accumulation

v0.2.10 turns relationship change from a per-scene score bump into accumulated evidence. Stock raw event weights are now `ordinary 1`, `meaningful 2`, `major 5`, and `extreme 10`. These are evidence weights before resistance, not guaranteed visible points.

Each relationship axis keeps a hidden fractional evidence remainder. Deepening an established polarity becomes progressively harder: below 30 uses full weight, 30-49 uses 75%, 50-69 uses 50%, 70-84 uses 35%, 85-94 uses 20%, and 95+ uses 10%. At Trust 95, ten distinct valid ordinary +1 beats are therefore required to earn one visible point. An extreme +10 at roughly 90 normally produces only about +2 visible points.

Minor contrary evidence also meets resilience from an established relationship instead of instantly shaving visible points, while extreme betrayal/reconciliation can still punch through at full raw tier strength. The visible -100..+100 meter stays integer; fractional progress is internal bookkeeping and survives sidecar reloads, bundle import/export, and branch rollback.

Every non-zero axis now requires its own grounded evidence. Desire has a strict narration firewall: rescue, gratitude, affection, trust, or proximity cannot become Desire unless the actual story contains attraction/romantic/intimate/physical evidence. Ambiguous equal-sized over-limit multi-axis proposals are rejected instead of silently favoring Trust/Affection.

The extension keeps the six most recent scored relationship events for semantic deduplication, so `event A -> event B -> aftermath of A` cannot reward A again. A rejected/duplicate event also cannot rewrite the durable Relationship Summary. Unsupported romance, possessiveness, obsession, or absolute-dependency claims are rejected when the corresponding relationship state does not support them.

Generation receives no raw relationship meter numbers. It gets one compact qualitative player-relationship lens after Identity, Agency/other bonds, and Current State, preventing the relationship layer from echoing itself or overpowering characterization.

## v0.2.9 relationship inertia and identity dominance

v0.2.9 makes the runtime relationship layer deliberately quieter. Stock relationship caps are now `ordinary 1`, `meaningful 3`, `major 8`, and `extreme 20`. Routine continuation of an existing dynamic normally scores zero; ordinary events affect at most one axis and meaningful events at most two. Major/extreme turning points can still move several axes when each has separate evidence.

Deepening an already-high positive or negative score now meets increasing inertia, so moving from 80 toward 100 is much harder than moving from 0 toward 20. Contrary evidence is not similarly muffled: betrayal, rejection, reassurance, or reconciliation can still pull an established score back toward neutral at the full allowed tier strength. Recent semantically duplicate event reasons are also suppressed so the same rescue, confession, bargain, intimate encounter, argument, or favor is not re-awarded merely because its aftermath spans several messages.

Generation injection now follows `Identity -> Agency/other bonds -> Current state -> Player relationship`. Relationship context is explicitly secondary, receives a smaller budget, and low-score neutral axes are not individually explained. Mood/Status are essential current-state context, Relationship Summary is optional/later continuity, and relationship magnitude no longer raises runtime NPC salience. A reserved, duty-bound, kind, blunt, proud, or independent NPC should therefore remain recognizably that person even at very high Trust/Affection/Desire/Tension.

The default behavior thresholds are also wider: relationship scores remain mostly neutral/unsettled inside roughly `-29..+29`, become materially positive/negative around `±30`, and become strongly positive/negative around `±70`. These bands guide expression only; the raw scores remain continuous `-100..+100` state.

## v0.2.8 canon hygiene and semantic consistency

v0.2.8 keeps the v0.2.7 schema and identity-first architecture, but adds a final canon-hygiene layer before scanner output becomes durable dossier state. Apparent Age is canonicalized to compact `~N` form even when weaker models return word forms such as `around six`, `Twenties`, or `mid thirties`; equivalent decade wording uses a stable seeded estimate. Unlocked Appearance text drops redundant leading explicit-age phrases so Apparent Age remains the visual-age authority.

Relationship prose is calibrated against current relationship strength so modest scores cannot casually produce absolute dependency language such as `indispensable`. Scanner/focused-pass numeric relationship deltas now require a grounded reason; unsupported changes are discarded instead of accumulating silent drift. Manual relationship edits remain authoritative. Behavioral Profile rules are kept target-general, PC/intimacy-specific incident rules are rejected from global identity, overlapping profile categories are merged, and repeated physical animations such as paperwork thrusting/slapping/flicking compact into one mannerism pattern.

Key Relationships normalize ambiguous death grammar into explicit `late`, `surviving`, or `; deceased` wording. Scanner output can no longer rewrite manual Importance; prompt-space ranking uses calculated current salience instead. Sparse fields remain sparse when evidence is weak, and the existing gradual-development, kindness/cruelty, social-bond, and weak-model safeguards remain in force.

## v0.2.7 final hard-pass hardening

v0.2.7 closes persistence, malformed-model-output, social-continuity, and blank-profile edge cases found in a second adversarial review. Model booleans are explicitly coerced so quoted values such as `"false"` cannot become truthy presence/evolution flags, and malformed relationship numbers fall back to neutral/configured defaults instead of becoming negative extremes.

High-resolution portrait bytes are persisted only once in the sidecar asset table rather than duplicated inside every NPC record; the live NPC portrait wins if an old asset copy disagrees. Bundle import now counts only non-archived dossiers against the active roster cap. Short NPC names use whole normalized phrase matching, avoiding relevance collisions such as `May` inside `maybe`.

Key Relationship evolution updates the named counterpart without deleting omitted family/friend/mentor bonds. Blank Personality, Speech, and Appearance fields now require direct source grounding or repeated related evidence before first durable population, and a one-off gesture cannot seed Mannerisms. Repeated evidence may initialize a trait only when the evidence actually supports the proposed trait, preventing a model from using repeated `Kindness` evidence to seed an unrelated personality. Runtime scans also carry a dossier-state revision guard so an older in-flight scan cannot overwrite a manual/import edit made while generation was pending.

## v0.2.6 hard-pass hardening

v0.2.6 keeps the v0.2.5 identity-first design but closes several adversarial/weak-model bypasses found during a full hard pass. Minimum-budget injection now preserves a fair slice of Personality, Behavioral Profile, Speech, Mannerisms, current Goal, Role, and Key Relationships before relationship prose or optional metadata. The stock relationship rubric is compiled to a compact semantic form so these identity/agency facts fit without raising the configured injection budget.

Durable evolution is stricter: missing `developmentScale` defaults to gradual instead of immediate; gradual changes require fresh evidence for the same labeled developing pattern across separate scans; unrelated old evidence cannot unlock a new trait; explicit/batch development is checked against the actual supplied narration; and batch change additionally requires a real narrated time skip. Refinement cannot smuggle transition language such as `no longer`, `formerly`, `became`, or `increasingly` through the cheaper refinement path.

Kindness/cruelty consistency is checked in code as well as in prompts. A generic cruel Behavioral Profile rule cannot be introduced as a refinement when it contradicts an established broadly kind disposition, and a contradictory first-pass rule is discarded rather than teaching the NPC to be kind only to the player. One-off gestures are also prevented from becoming durable mannerisms unless recurrence is established or cross-scan evidence confirms the pattern.

The focused relationship evaluator now receives compact Personality, Behavioral Profile, current Goal, and non-player Key Relationships, reducing PC-gravity in relationship summaries. Sidecar loading validates the embedded chat key and new sidecar filenames use a wider two-part fingerprint to reduce accidental cross-chat collisions.

## Relationship engine

The four player-facing axes are:

- Trust
- Affection
- Desire
- Tension

The scanner proposes deltas. NPC State applies deterministic tier caps, axis-count limits, and relationship inertia in code:

- none: `0`
- ordinary: stock cap `1`, at most 1 axis
- meaningful: stock cap `3`, at most 2 axes
- major: stock cap `8`, at most 3 axes
- extreme: stock cap `20`, at most 4 axes

Routine continuation is normally `none`. High-score inertia slows further deepening toward ±100; contrary evidence can still move toward neutral at full tier strength. Customized caps remain supported. A focused relationship repair pass runs only when the primary scan is incomplete or a major/extreme change lacks required relationship prose. Full-window scans never replay historical numeric deltas.

## Important Memories

Each dossier keeps at most five durable memories. When the list overflows, the scanner selects the five most consequential and persistent items from the combined old/new set. Routine dialogue, transient emotion, raw Inner Chatter, and duplicate paraphrases are excluded by default.

## Present gallery and Minor NPCs

Only currently present, non-minor NPCs receive portrait cards.

Enable **Minor NPC · hide portrait card** for people who should remain tracked but should not flood the visible gallery, such as court nobles, clerks, retainers, or temporary officials. Minor NPCs still receive scans, memories, relationship updates, injection, persistence, and editing.

## Stale lifecycle

Default stale lifecycle:

```text
30 assistant replies without presence/off-screen activity → auto-archive
50 assistant replies without activity                    → delete stale auto-archive
```

Archived NPCs do not consume the active roster limit. Manual archives, confirmed-death archives, and dossiers marked **Keep from automatic stale cleanup** are preserved. Automatically deleted stale NPCs are not blacklisted and may be rediscovered if they return.

## Megumin Suite Beta integration

NPC State understands the August 18 master-block format:

```text
<Blocks>
  <World_State>...</World_State>
  <NPC_Inner_Chatter>...</NPC_Inner_Chatter>
  ...
</Blocks>
```

Evidence policy:

- `<World_State>` may update live/off-screen state but does not alone establish physical presence.
- `<NPC_Inner_Chatter>` may support durable goals, attitudes, and relationships but does not establish presence/activity by itself.
- CYOA, Bonds, Character Sheet, Story Tracker, New NPC, NPC Update, and custom blocks are excluded from ordinary story scanning.
- New NPC/NPC Update blocks are available only through deliberate **Scan dossier** import.

When Megumin's `.meg-blocks` card exists, NPC State adds one in-card tab. It never rewrites `message.mes`. Without Megumin, the same gallery renders as a standalone inline panel.

## Portrait generation

NPC State v0.2 includes a review-before-apply portrait generator built on SillyTavern Image Generation.

Workflow:

1. Configure Image Generation in SillyTavern, including provider, model/checkpoint, dimensions, sampler, steps, CFG, and credentials.
2. Open an NPC dossier.
3. Choose **More → Generate portrait**.
4. Review/edit the generated Positive and Negative prompts.
5. Generate through native `/imagine quiet=true`.
6. Regenerate as needed.
7. Choose **Use as Portrait** only when satisfied.

NPC State supplies visual content and style. SillyTavern remains authoritative for backend configuration.

### Portrait theme

Global settings include:

- theme preset
- positive style/theme
- global negative prompt
- composition
- prompt format: Structured hybrid, Comma tags, or Natural language
- optional current Mood and Location
- optional SillyTavern gallery saving

Built-in themes:

- Fantasy Anime
- Anime Key Visual
- Painterly Fantasy
- Dark Medieval
- Semi-Realistic
- Custom

The automatic character prompt uses visual fields such as Species/Race, Apparent Age, Role, Appearance, optional Mood/Location, theme, and composition. It does not dump Personality, Memories, Background, Key Relationships, or relationship numbers into the image prompt.

## Admission modes

### Conservative

- proper names can create dossiers immediately
- first-seen role labels remain lightweight candidates
- role labels promote on grounded same-person recurrence or manual add

### Balanced

Also admits meaningful/persistent role NPCs and direct two-way interactions more readily.

### Manual only

New observations remain candidates until explicitly added.

## Storage and branches

NPC State stores each chat in an extension-owned JSON sidecar referenced by `extension_settings.npc_state.dataFiles`:

```text
data/<user-handle>/user/files/npc-state-<hash>.json
```

The sidecar stores dossiers, candidates, portraits, inline snapshots, branch checkpoints, and lifecycle state. Writes are versioned and serialized so edits made while an upload is in flight receive a follow-up snapshot rather than being falsely marked saved.

From v0.2.17 onward, durable chat identity includes both the SillyTavern owner and the chat filename. Character chats are scoped by character avatar identity and group chats by group id, so two different cards/groups may safely use the same chat filename. Older unqualified sidecars are claimed lazily only when their stored narrative lineage proves they belong to the active owner; ambiguous legacy data is preserved rather than guessed.

Long-session storage is bounded in two additional ways: dormant hydrated chats are evicted from the in-memory cache after active work settles, and branch checkpoint snapshots are adaptively compacted under a serialized-size budget while retaining safe rollback anchors and recent sibling state. Unreachable portrait assets are garbage-collected during sidecar compaction.

Branch behavior:

- each visited swipe lineage can keep an exact sibling snapshot instead of competing for one checkpoint per message ID
- revisiting a known sibling restores its exact dossier/relationship/memory state without an LLM rescan
- unseen siblings restore the nearest parent or pre-message root anchor, scan once, then become independently restorable
- content-lineage identity remains stable when SillyTavern renumbers swipe indices after deleting an alternate
- stale asynchronous scans are discarded when branch lineage or dossier revision changes mid-request
- portrait assets and user-managed dossier metadata survive narrative rollback when the same NPC survives
- branch history is bounded and pruned while protecting the active lineage and recent sibling heads
- chat deletion waits for in-flight persistence before removing the sidecar
- chat rename settles and transfers state before refreshing the file payload

## Import and export

Use **Export dossier** to create a portable `.npcstate` binary bundle containing dossier metadata and compressed portrait bytes. Import merges dossiers into the current chat, restores portraits, and lifts matching suppression entries.

## OOC controls

```text
(OOC: NPC State: add Luna)
(OOC: NPC State: remove Luna)
```

Multiple commands may be separated with semicolons. OOC add creates/promotes a dossier and queues targeted backfill. OOC remove hard-deletes and suppresses automatic rediscovery until deliberately re-added.

## Debug surface

Available in the browser console:

```javascript
NPCState.version
NPCState.scan()
NPCState.scanDossier('Luna')
NPCState.refreshFromChat('Luna')
NPCState.portraitPrompts('Luna')
NPCState.generatePortraitUrl('Luna')
NPCState.openPortraitGenerator('Luna')
NPCState.openViewer('Luna')
NPCState.openEditor('Luna')
NPCState.scanMetrics()
NPCState.uiStatus()
NPCState.getState()
NPCState.flush()
NPCState.dataFile()
```

## Durable dossier compaction

v0.2.4 treats durable fields as **current summaries**, not running observation logs. Equivalent/paraphrased traits are collapsed, Mannerisms stay at four distinct habits, Key Relationships keep one entry per counterpart, and Important Memories/profile evidence semantically deduplicate repeated events or observations.

Auto-managed durable fields are bounded before storage and receive tighter bounds again when supplied to the scanner. Explicit manual profile locks remain authoritative and are not semantically rewritten.

## Upgrade notes for v0.2.9

Settings schema is now v24. Existing visible Trust/Affection/Desire/Tension scores are preserved exactly and are never rescaled. Untouched v0.2.8 `4/8/15/25` or v0.2.9 `1/3/8/20` stock caps still migrate to the current `1/2/5/10` weighting, while customized caps and customized relationship/impact/behavior rubrics remain authoritative. Existing v0.2.10 scores infer directional milestones strictly below their established magnitude (`Trust +63` infers positive 25/50, while 75 remains locked) so upgrades do not retroactively erase earned depth. Legacy v0.2.10 swipe checkpoints are converted only when their entire stored old-fingerprint prefix still matches the loaded chat; stale/edited legacy history is discarded rather than falsely marked exact.

## Upgrade notes for v0.2.5

Existing dossiers remain compatible. Behavioral Profile starts empty on legacy NPCs and can be established organically by new grounded scans or immediately reconciled with **Refresh from Chat** for an important existing NPC. The schema migrates to v19 without changing relationship scores, portraits, manual locks, branch history, or existing durable profile text.

If the saved Relationship-to-behavior rubric is exactly the untouched v0.2.4 stock rubric, NPC State upgrades it to the new identity-first default automatically. Any customized rubric is preserved.

## Upgrade notes for v0.2.4

On first load of an older sidecar, NPC State performs a one-time durable-profile compaction and writes the canonical result back to the same data file. Live dossiers, visible snapshots, and branch checkpoints are all normalized so an old rollback cannot reintroduce duplicate prose. Relationship scores, portraits, identities, archives, manual locks, and branch history remain intact.

v0.2.2's persistence/performance review remains documented in `CODE-REVIEW.md` and the changelog.

## Compatibility target

The package is tested against the SillyTavern 1.18 extension contract with mocked runtime, migration, persistence, branch, Megumin, mobile/tablet viewer, and native portrait-generation coverage. A deployment test in the user's actual browser/backend remains the final integration check.
