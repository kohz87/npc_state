# NPC State v0.2.8 Code Review

## v0.2.8 canon-hygiene findings

### High: structurally valid scanner text could still be semantically overcommitted

**Previous risk:** v0.2.7 correctly protected established identity from large rewrites, but accepted wording could still overstate a modest relationship (`indispensable` at low scores), seed unexplained relationship drift, or place a PC-specific incident into target-general Behavioral Profile prose.

**Resolution:** generated non-zero relationship changes require a grounded reason; relationship summaries are intensity-calibrated; target-specific/global scope is checked before Behavioral Profile persistence; manual edits remain authoritative.

### Medium: Apparent Age formatting could drift into free-form prose

**Previous behavior:** digit forms normalized reliably, but weaker-model output such as `around six`, `Twenties`, or `mid thirties` could remain prose or vary in presentation.

**Resolution:** English number words and decade language normalize to deterministic `~N`; equivalent wording shares a stable seeded estimate. Unlocked Appearance removes redundant leading explicit-age phrases.

### Medium: repeated animations inflated Mannerisms and profile categories

**Resolution:** known repeated gesture families compact to one behavioral pattern, while Behavioral Profile families such as Conflict/Anger/Composure merge into one concise rule. Six Behavioral Profile entries remain a cap, not a fill target.

### Medium: social-graph grammar could misidentify who was deceased

**Resolution:** trailing `(deceased)` syntax is rewritten into explicit `Surviving widow/widower` or `; deceased` forms, eliminating ambiguous attachment.

### Medium: durable Importance and runtime relevance were conflated

**Resolution:** scanner output cannot rewrite stored Importance. Runtime selection scores contextual salience from mentions, role/goal/memory relevance, relationship magnitude, and recency instead of manual Importance.

### Actual Noctis export verification

The supplied `.npcstate` fixture was decoded and normalized with v0.2.8. Observed corrections include Brina `Twenties -> ~24`, Liza/Tessa retained at `~6` with redundant `five-year-old` appearance wording removed, Brina's unsupported `indispensable source of physical comfort and survival` wording reframed as `a growing source of practical support and comfort` and the blank-reason audit cleared, intimacy-specific global Behavioral Profile text removed, Maren's three paperwork gestures compacted to one pattern, Toran `Thirties -> ~31`, and Jonas's ambiguous widow/death phrase made explicit.

## v0.2.7 final hard-pass findings

### High: blank durable fields were easier to poison than populated identity

**Previous risk:** a weak scanner could fail to rewrite an established Personality yet seed a previously empty Personality/Speech/Appearance or first Mannerism from one relationship-heavy scene, effectively making a first impression permanent canon.

**Resolution:** with source narration available, blank durable text fields require direct lexical grounding or repeated related evidence before first population. A first Mannerism requires explicit recurrence or repeated evidence. Repeated evidence must also support the proposed value, so concept-matched evidence cannot authorize an unrelated trait.

### High: string booleans could invert scanner intent

**Previous behavior:** JavaScript truthiness treated values such as `present:"false"`, `sameIndividual:"false"`, or `clearMood:"false"` as true in several compatibility paths.

**Resolution:** scanner, stored-state, and legacy shorthand booleans use explicit coercion for boolean/number/common string forms.

### High: stale async scans could race newer dossier edits

**Previous risk:** chat-lineage checks prevented stale story scans, but a manual/import dossier edit made while model generation was pending could still be overwritten by output generated against the older state.

**Resolution:** scan start captures a per-chat dossier-state revision; both primary and focused relationship results are discarded if that revision changes before commit.

### Medium: high-resolution portraits were duplicated in sidecar JSON

**Resolution:** persisted NPC records omit portrait bytes when the portrait asset table contains them. Live NPC portrait data refreshes the asset copy before compaction, preventing stale image resurrection.

### Medium: archived dossiers incorrectly consumed bundle-import capacity

**Resolution:** import caps count active dossiers only; archived history is preserved independently.

### Medium: social evolution could erase unrelated bonds

**Resolution:** Key Relationship updates replace/merge the named counterpart only; omission is not interpreted as deletion. Scanner/import/refresh prompt wording now uses the same contract.

### Medium: malformed numeric relationship data could become an extreme

**Resolution:** invalid baseline scores resolve to neutral defaults, invalid caps resolve to configured defaults, and invalid incoming importance is treated as absent.

### Medium: short names received substring relevance false positives

**Resolution:** relevance matching uses normalized phrase boundaries, so names such as `May` do not match `maybe`.

## v0.2.6 hard-pass findings

### High: minimum-budget Behavioral Profile could be order-starved

**Previous risk:** the identity block protected the Behavioral Profile as a field, but a verbose first rule could consume that field's compact share before later Cruelty or Independence categories appeared.

**Resolution:** essential injection now reduces every Behavioral Profile rule to a short semantic head in priority order, so Disposition, Cruelty, and Independence remain visible under the tightest supported budget instead of depending on rule length.

### High: tight injection budgets could still starve Speech/Mannerisms and agency

**Previous behavior:** the identity core was concatenated then truncated from the tail. A long Personality/Behavioral Profile could therefore erase Speech/Mannerisms, while Goal and Key Relationships remained optional.

**Resolution:** established identity fields are compacted independently and fairly, and Role/Goal/Key Relationships are an essential agency core. Lower-relevance NPCs are dropped before the top NPC's identity/agency is sacrificed.

### High: omitted developmentScale bypassed gradual evolution

**Previous behavior:** an `evolve` result without `developmentScale` fell through a compatibility branch and was accepted immediately.

**Resolution:** missing/unknown scale defaults to gradual. Gradual evolution needs fresh evidence related to prior evidence for the same labeled candidate trait across separate scans.

### High: `refine` could disguise actual personality/morality change

**Previous behavior:** a full-summary refinement containing old tokens could append contradictory traits, including generic cruelty, or use negated old traits (`no longer reserved`) while bypassing evolution gating.

**Resolution:** refinements now require semantic continuity, reject morality-polarity conflicts, and reject transition language. Behavioral Profile category replacement uses the same protection; generic cruelty cannot contradict an established kind personality on first pass or refinement.

### High: explicit/batch development trusted token overlap too much

**Previous behavior:** the code grounded development reasons by shared content words. A weak model could therefore turn one kind act into an invented explicit personality change, or combine a bare time skip with unrelated present-day behavior to fabricate skipped-period development.

**Resolution:** runtime merge calls provide the source narration. Explicit evolution now requires a nearby lasting-change/correction cue tied to the same content. Batch evolution requires the time-skip sentence (or its immediately following summary sentence) to contain the grounded developmental pattern.

### Medium: one-off gestures could become permanent mannerisms

**Resolution:** newly added mannerisms require recurring/frequency evidence grounded in context or cross-scan confirmation. Existing similar habits can still refine normally.

### Medium: focused relationship summaries lacked competing identity/agency context

**Resolution:** the relationship evaluator now receives compact Personality, prioritized Behavioral Profile, Goal, and non-player Key Relationships.

### Medium: sidecar pointer mix-up lacked chat-key validation

**Resolution:** sidecar reads validate the embedded chat key and new filenames use two independent 32-bit fingerprints. Existing pointer paths remain valid.

## v0.2.5 characterization review

### High: relationship context could outrank identity

**Previous behavior:** relationship behavior was essential injection while Personality/Speech/Mannerisms were optional enrichment, so tight budgets could leave high affection/tension instructions without the identity that should constrain them.

**Resolution:** stable identity is now essential and injected first. Relationship values are narrow player-specific modifiers, with explicit anti-obedience, anti-jealousy, anti-tsundere, and target-general kindness safeguards.

### High: temporary or player-specific behavior could become durable identity

**Previous risk:** repeated affectionate/stressed behavior could be learned back into global Personality/Speech/Mannerisms, amplifying an accidental archetype over later scans.

**Resolution:** scanner and targeted-refresh contracts now include an identity firewall. Gradual evolution is additionally code-gated by evidence carried across scans; ordinary NPC-delta output cannot bypass that gate.

### Medium: time skips needed controlled acceleration

**Resolution:** durable changes use gradual/explicit/batch development scales. Bare elapsed time is rejected as a batch-development reason, while explicit long-term summarized development can update directly.

### Medium: weaker models needed executable characterization without prompt bloat

**Resolution:** added a bounded six-item Behavioral Profile with compact labeled rules. It participates in persistence, editing, locking, import/backfill/refresh, viewer display, branch snapshots, and identity-first injection while remaining under existing prompt-budget tests.

## Scope

Reviewed the v0.2.4 extension source, runtime integration, persistence path, scan-context construction, Megumin dossier import, portrait-gallery rendering, settings listeners, CSS, tests, and shipped documentation.

## Resolved findings

### High: older sidecar snapshot could overwrite a newer in-memory edit

**Previous behavior:** `flushStateFile()` captured an early snapshot but, after upload, set `persistedVersions` to the latest live version. An edit made while the upload was pending could therefore be falsely considered durable, causing the follow-up flush to skip.

**Resolution:** one writer now owns each chat key, persists an immutable snapshot/version pair, and loops until the durable version catches the current version. Runtime coverage delays the first upload, mutates the NPC during the delay, and verifies a second upload contains the final state.

### High: chat deletion could race an in-flight write

**Previous behavior:** deletion cleared timers and removed the pointer without waiting for the active upload. The finishing upload could then restore a pointer after deletion.

**Resolution:** deletion settles active writes before deleting file/pointer/cache/version state. Runtime coverage deletes a chat while upload is intentionally blocked and verifies no pointer/file survives.

### Medium: rename bookkeeping was incomplete

**Previous behavior:** rename moved selected cache/pointer entries but did not consistently settle active writes or clear/transfer all write/version bookkeeping.

**Resolution:** rename loads and flushes the old key, settles destination activity, transfers state, clears old maps, and writes the transferred state under the new logical key.

### Medium: settings migration caused write amplification

**Previous behavior:** an old install could call `saveSettingsDebounced()` once for each historical schema block during a single `getSettings()` call.

**Resolution:** defaults, migrations, and canonicalization use a dirty flag and one final settings save.

### Medium: settings-only changes rewrote chat sidecars

**Previous behavior:** UI setting changes called `persist()`, which also marked the chat state dirty and queued a JSON sidecar upload.

**Resolution:** settings controls now use settings-only persistence. Sidecars are written only for dossier/branch/portrait state changes.

### Medium: long chats paid full-history cleanup costs repeatedly

**Previous behavior:** recent transcript building cleaned every message before slicing the last configured N meaningful messages.

**Resolution:** newest-first bounded collection stops as soon as N meaningful lines are found.

### Medium: dossier import scanned beyond the latest base

**Previous behavior:** matching Megumin dossier lookup scanned the whole chat, then discarded entries older than the latest New NPC block.

**Resolution:** lookup scans newest-first and stops at the latest matching base, retaining only relevant later updates.

### Low: repeated global DOM and roster lookups

**Resolution:** watchdog reconciliation queries are scoped to `#chat`; portrait gallery rendering builds one current-NPC map per render.

### Low: public/archive contract drift and retired code

**Resolution:** `NPC_ARCHIVE_REASONS` now includes `stale`; unused helper and obsolete CSS generations were removed; repetitive debug and settings-listener code was consolidated.

## Deferred, non-blocking observations

- `scanNow()` and `applyIncoming()` remain large orchestration functions. They are well covered by regression tests, but future feature work would benefit from separating model invocation, merge policy, lifecycle cleanup, and UI commit into smaller modules.
- UI rendering is still template-string based. A future major version could introduce small view helpers/components, but changing the rendering architecture during a maintenance release would add more risk than value.
- Browser/backend behavior is mocked in CI. A real SillyTavern deployment remains necessary to validate theme-specific CSS, provider latency, and image-generation backend quirks.

## Result

No unresolved critical or high-severity issue identified after the fixes and regression pass. The release remains data-compatible with v0.2.7 and older supported sidecars; settings schema remains v20.
