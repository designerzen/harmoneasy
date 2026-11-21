# Ensemble Transformer: evidence and current design

Reviewed: 2026-11-21. See [next experiments](ensemble-next-experiments.md) for proposed work.

## Goal and interaction contract

A room of people should be able to perform a complete song together, each using one QWERTY key or equivalent accessible input for an assigned part. The system chooses pitches, retains song structure, and manages synchronization. Players must still hear a clear connection between their gestures and their own contribution.

The original activity gate let a press enable several beats of automatic playback. That made a melodic part behave like a phrase launcher. Shortening the gate alone would exchange unwanted phrases for missing notes; it would not establish an understandable instrument.

The revised interaction separates two responsibilities:

- **Notes:** a new press requests one score onset, including a simultaneous chord. Each part retains its own ordered note cursor. Holding does not request subsequent onsets.
- **Grooves:** a press starts a repeating rhythmic part on the shared bar phase. Later taps accent it; an explicit stop ends it at an available bar boundary.

Tempo, position within a bar, arrangement position, and a player's next unplayed onset are separate state. Perfectly preserving every late note and staying exactly at the current arrangement position can conflict. The recovery policy must make that tradeoff explicit.

## How to interpret the evidence

**Research findings** below describe the task and population studied. **Software precedents** show established mechanisms, not controlled proof of their suitability here. **Harmoneasy implications** are engineering interpretations. No cited study tests this exact combination of novice group, one-key parts, MIDI repertoire, and recovery rules.

The review used proceedings papers, publisher or institutional records, author-hosted material, and official software documentation. Where only an abstract, record, or selected passage was accessible, that limitation is stated. This is a targeted design review, not a systematic literature review.

## Foundations used in the implementation

### R1. Métapiano and MidifilePerformer: gestures control score events

Chabassier, Desainte-Catherine, Haury, Pobel, and Serpette (2021), *MidifilePerformer: a case study for chronologies*, FARM 2021. [Official proceedings abstract](https://sigplan.github.io/OpenTOC/farm21.html); [publication DOI](https://doi.org/10.1145/3471872.3472968). Related [SCRIME project description](https://scrime.u-bordeaux.fr/projets-de-recherche/performance-et-meta-instruments).

The proceedings abstract describes associating MIDI or alphanumeric keyboard commands with score notes so a performer can control pace and accentuation. The Métapiano project describes advancing a score by a note or chord through simple gestures. This is a close conceptual match to simplifying pitch selection while retaining performance agency.

**Implication:** one accepted gesture should have an identifiable musical consequence. It should not silently authorize a whole melodic phrase. The sources do not solve synchronization between many independently advancing novice players. The abstract and project description informed this review; the implementation is not a port of the paper's algorithms.

### R2. Antescofo: local time and explicit synchronization policies

Cont (2008), *Antescofo: Anticipatory Synchronization and Control of Interactive Parameters in Computer Music*, ICMC, pp. 33–40. [Institutional paper record/PDF](https://inria.hal.science/hal-00694803v1/document). IRCAM's [Synchronization Strategies documentation](https://antescofo-doc.ircam.fr/Reference/time_synchro/) provides the directly inspected technical detail.

Antescofo distinguishes tempo-oriented loose synchronization, position-oriented tight synchronization, and target strategies that converge toward selected future landmarks or a moving horizon. Position and tempo are distinct, and different concurrent sequences can use different synchronization policies.

**Implication:** melodic progress need not be identical to the accompaniment clock. A bar or phrase boundary can provide a recovery landmark. Harmoneasy's two-bar recovery rule and modest late-duration compression are heuristics inspired by this distinction; they do not implement Antescofo's continuous target-tempo algorithm or its audio score follower. The older support.ircam.fr documentation URL can fail; the current documentation URL above was accessible during this review.

### R3. Error handling belongs in the musical model

Cont, Echeveste, Giavitto, and Jacquemard (2012), *Correct Automatic Accompaniment Despite Machine Listening or Human Errors in Antescofo*, ICMC. [Institutional bibliography and paper link](https://radar.inria.fr/rapportsactivite/RA2014/mutant/bibliography.html); [IRCAM presentation](https://medias.ircam.fr/en/media/xd4435b_produire-un-accompagnement-correct-dans-an).

The institutional material identifies explicit handling of recognition and performance errors as part of accompaniment behaviour, rather than treating all missing events as equivalent.

**Implication:** distinguish a written rest, an unplayed note, a late join, and an intentional stop. Never repair a large gap by emitting every missed attack at once. Bibliographic information and the presentation description were checked; a detailed independent reproduction of the paper's formal semantics was not performed.

### R4. B-Keeper: synchronize accompaniment to a performer

Robertson and Plumbley (2007), *B-Keeper: A Beat-Tracker for Live Performance*, NIME, pp. 234–237. [Proceedings paper](https://nime.org/proceedings/2007/nime2007_234.pdf).

B-Keeper maintains coordination between a live drummer and an electronic sequencer using performance information, with an implementation involving Ableton Live. It is a precedent for accompaniment following a human rhythmic reference instead of always requiring the human to follow a fixed machine clock.

**Implication:** an optional conductor can influence the pulse while other parts remain phase aligned. A melodic key press does not necessarily represent one beat, so estimating tempo from every inter-press interval as if it were a quarter note is inappropriate. This interpretation needs a score-aware estimator and confidence rules; the current note/groove mode does not implement B-Keeper.

### R5. Ableton Link: separate tempo, beat phase, and arrangement position

Ableton, [official Link documentation](https://ableton.github.io/link/), accessed 2026-11-21.

Link explains independent timelines with shared tempo and beat alignment. A quantum establishes phase relationships between loops or bars; quantized launches align entry points. The documentation also describes optional arrangement synchronization separately from phase alignment.

**Implication:** joining a groove should retain shared phase rather than restart its pattern at the moment of the tap. Staying at the same point in a song requires additional arrangement policy. Harmoneasy uses these timing concepts locally; it has not integrated the Link library or thereby obtained cross-device synchronization.

### R6. Ableton Live: launching and transitioning between loops

Ableton, [*Launching Clips*, Live reference manual](https://www.ableton.com/en/manual/launching-clips/), accessed 2026-11-21.

Clip launch quantization, legato behaviour, and Follow Actions demonstrate ways to preserve timing while starting, repeating, and transitioning between musical material. These are useful product precedents for persistent grooves and deliberate structural changes.

**Implication:** a groove should have explicit running, queued, and stopping states. Repeating a pattern and advancing a song are different operations. A launch mechanism alone cannot decide which bass pattern is harmonically valid for a new section.

## Additional research and software

### R7. GEM: moderate group adaptation and audible feedback

Fink, Alexander, and Janata (2022), *The Groove Enhancement Machine (GEM): A Multi-Person Adaptive Metronome to Manipulate Sensorimotor Synchronization and Subjective Enjoyment*, Frontiers in Human Neuroscience 16:916551. [Publisher full text](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.916551/full).

Across five experiments, including groups of four tappers, 25–50% metronome adaptivity improved synchronization relative to no adaptation. Outcomes at stronger adaptation depended on auditory feedback; enjoyment did not simply improve with stronger correction.

**Implication:** experiment with gentle, bounded adaptation and clear feedback before trying aggressive group following. The reported percentages are experimental correction gains, not recommended BPM changes or ready-made application defaults. Regular tapping tasks differ from score parts with rests, chords, and unequal note densities. The system is called GEM; ADAM refers to other adaptive-metronome work discussed in this literature.

### R8. Rhythmic correction can make late input worse

Lee (2007), *A Semantic Time Framework for Interactive Media Systems*, doctoral dissertation, RWTH Aachen. [Institutional PDF](https://hci.rwth-aachen.de/materials/publications/lee2007e.pdf), §3.2, particularly printed p. 70.

The inspected passage discusses why pushing a late percussive gesture to the next quantization point can worsen its timing and perceptible delay. It motivates selective correction rather than quantizing every input identically. The passage's account of Jam-O-Drum is a discussion of earlier work, not an independently re-read original study here.

**Implication:** separate early input that can wait briefly for a known onset from late input that needs prompt feedback. An already elapsed sound cannot be scheduled retroactively. The full dissertation was too large for the web reader; this conclusion is limited to the indexed passage and checked institutional metadata.

### R9. Measure action-to-sound latency and jitter

McPherson, Jack, and Moro (2016), *Action-Sound Latency: Are Our Tools Fast Enough?*, NIME. [Proceedings paper](https://nime.org/proceedings/2016/nime2016_paper0005.pdf).

Measurements across instrument-building configurations show that apparently suitable components can still introduce appreciable latency and variability. Measuring the complete interaction path matters more than assuming a fast timer makes an instrument responsive.

**Implication:** collect input-to-acceptance, acceptance-to-scheduled-audio, and actual acoustic timing separately. The commonly discussed 10 ms target is not a universal perceptual boundary or a measured Harmoneasy result. Scheduling ahead protects automated groove timing but cannot remove physical input or audio-output latency from a newly requested note.

### R10. Polymetros: individual agency within novice collaboration

Bengler and Bryan-Kinns (2013), *Designing collaborative musical experiences for broad audiences*, Creativity & Cognition, pp. 234–242. [Institutional abstract](https://ualresearchonline.arts.ac.uk/id/eprint/23502/); [QMUL project](https://sid.eecs.qmul.ac.uk/projects/polymetros/polymetros.html).

Polymetros addresses walk-up collaborative music-making with individual instruments and was evaluated with a public exhibition audience. Its design problem includes giving novices individual control within a group.

**Implication:** evaluate whether people understand their contribution and one another's activity, not just whether MIDI events align. These project and abstract records do not establish that its interface or evaluation results transfer to a one-key song performance.

### R11. Assistance should preserve a visible human role

Martin, Gardner, Swift, and Martin (2016), *Intelligent Agents and Networked Buttons Improve Free-Improvised Ensemble Music-Making on Touch-Screens*, CHI, pp. 2295–2306. [Institutional abstract and DOI](https://researchportalplus.anu.edu.au/en/publications/intelligent-agents-and-networked-buttons-improve-free-improvised-/).

Two controlled studies compared performer-triggered interface changes, agent interventions, and mixed approaches. The abstract reports different effects on preference and performance length, with a preference advantage for the follow-up mixed-initiative condition over the earlier always-on combination.

**Implication:** test optional, understandable assistance instead of equating more automation with a better experience. This was free improvisation with touchscreens, not individual note triggering in a fixed song. The abstract was reviewed, so detailed effect sizes are not claimed.

### R12. Beat-based virtual time can coordinate sound and guidance

Liang, Xia, and Dannenberg (2011), *A Framework for Coordination and Synchronization of Media*, NIME, pp. 167–172. [Author-hosted proceedings paper](https://www.cs.cmu.edu/~rbd/papers/Framework-NIME-2011.pdf).

The paper presents beat-based virtual time and coordination at beats, measures, and cues, including an interactive notation display. This supports treating visual guidance and playback as views of musical time rather than independent timers.

**Implication:** derive cue cards, next-entry indicators, and section transitions from the same transport that schedules sound. This architectural precedent does not prescribe a particular novice interface or guarantee better synchronization.

### R13. Separate musical content from expressive delivery

Gillick and Bamman (2021), *What to Play and How to Play it: Guiding Generative Music Models with Multiple Demonstrations*, NIME. [Paper and DOI](https://nime.pubpub.org/pub/s3x60926/release/1).

The work separates score-like information from demonstrations of timing and dynamics when controlling generated drum performances.

**Implication:** players could shape accents or bounded timing without needing to select pitches or rewrite the song. The useful design distinction does not require adopting a neural model. The experiments concern generated short loops, not recovery or long-song synchronization.

### R14. Network delay changes the musical interaction

Cockos, [official NINJAM explanation](https://cockos.com/ninjam/index.php), accessed 2026-11-21.

NINJAM exchanges synchronized intervals: participants hear earlier intervals from other players while contributing their current interval. This makes delayed collaboration musically structured, but it is not everyone hearing the same live gesture at the same instant.

**Implication:** an interval-based remote jam could be a separate mode. It should not replace the immediate shared-song behaviour expected in one room. Network capability must be evaluated independently of local timing.

### R15. Show how delayed contributions become music

Liloia and Dannenberg (2025), *Exploiting Latency In The Design Of A Networked Music Performance System For Percussive Collective Improvisation*, NIME. [Proceedings paper](https://nime.org/proceedings/2025/nime2025_69.pdf).

The authors describe a web prototype using musical and visual strategies to accommodate substantial delay, with informal testing and records of individual contributions.

**Implication:** distinguish accepting a gesture from hearing its scheduled result, and expose useful provenance in recordings. Informal prototype tests are exploratory evidence, not proof of usability for a classroom ensemble or a reason to add intentional delay locally.

### R16. Timing roles matter

*Temporal Coordination in Piano Duet Networked Music Performance (NMP): Interactions Between Acoustic Transmission Latency and Musical Role Asymmetries* (2021), Frontiers in Psychology. [Publisher full text](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.707090/full), DOI 10.3389/fpsyg.2021.707090.

The duet study examines transmission delay alongside musical role asymmetry and discusses emergent leadership and complementary roles in temporal stability.

**Implication:** compare a designated conductor with symmetric group following. Do not assume every participant should have equal instantaneous control over tempo. Skilled piano-duet behaviour under network delay does not directly predict a large novice group's needs.

## Mapping to the current implementation

The following is a code snapshot reviewed on 2026-11-21, not a claim that every research mechanism above is implemented.

| Behaviour | Location | Evidence relationship |
| --- | --- | --- |
| A press requests one onset; a hold cannot unlock a phrase | [`EnsemblePerformance.press`](../../packages/audiobus/io/ensemble-performance.ts) | Gesture/event separation, R1 |
| Per-channel note cursors and one outstanding early request | Same module | Harmoneasy policy built on R1 and R2 |
| Recovery at the current bar after `recoveryBars` (default 2) | Same module | Landmark inspiration from R2; threshold is unvalidated |
| Late gestures sound promptly; early requests retain score timing | Same module | Compatible with R8; not a published correction algorithm |
| Late note durations can compress to 75% of their original beat length | `sound` in the same module | Application heuristic, not Antescofo target synchronization |
| Percussion on channel 10 defaults to Groove; other parts default to Notes | `role` in the same module | Conservative MIDI convention, not musical role inference |
| Groove entries and explicit stops align to bar boundaries | Same module | R5 and R6 timing precedents |
| Percussion repeats through empty bars, adopts new written patterns, and respects section markers | Same module | Application arrangement policy; gaps and fills remain ambiguous |
| Pitched grooves preserve written rests | Same module | Protects score structure; not inferred harmonic analysis |
| Notes/Groove overrides, status, saved-setup migration | [`TransformerEnsemble`](../../packages/audiobus/io/transformers/transformer-ensemble.ts) | Product interaction and compatibility work |

The wrapper is [`EnsembleSession`](../../packages/audiobus/io/ensemble-session.ts). Behaviour and integration checks are in [`ensemble-performance.test.ts`](../../app/harmoneasy/tests/ensemble-performance.test.ts), [`ensemble.test.ts`](../../app/harmoneasy/tests/ensemble.test.ts), and [`ensemble-presets.test.ts`](../../app/harmoneasy/tests/ensemble-presets.test.ts).

## Current limits and unresolved decisions

- Duration compression alone does not continuously pull a player's onset timeline into agreement with the group. There is no full Antescofo-style target controller.
- Existing Together step and Group conductor modes retain different semantics. The new note/groove interaction should not be confused with those modes.
- Onsets group exactly simultaneous score events. Slightly staggered notes in an expressive MIDI chord may still need several presses.
- A repeated drum bar can be an unwanted fill. Unmarked rests and section changes cannot always be inferred reliably.
- An output cannot necessarily cancel commands already sent ahead. A groove stop therefore uses an unscheduled boundary, which can be later than the visually nearest bar.
- Local scheduling does not establish distributed clock synchronization, compensate for speaker separation, or resolve keyboard rollover limits.
- Automated tests, a successful build, and correct event timestamps do not establish acoustic responsiveness, intelligibility, enjoyment, or accessibility in a real group.

The most useful next step is a small observed group trial paired with timing measurements. The [experiment plan](ensemble-next-experiments.md) identifies changes worth testing before increasing automation.
