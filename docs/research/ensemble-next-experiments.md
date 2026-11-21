# Ensemble: next experiments

Updated: 2026-11-21. These are proposals, not additional implemented features. Source identifiers refer to the [annotated evidence review](ensemble-transformer.md).

## Recommended order

| Priority | Experiment | Question |
| --- | --- | --- |
| 1 | Immediate acceptance feedback and entry guidance | Can each person explain what their key just did and when to press again? |
| 1 | Latency measurement and selective timing correction | Does assistance improve timing without making the instrument feel disconnected? |
| 2 | Musical recovery landmarks and chord grouping | Can missed material be handled with fewer surprises? |
| 2 | Authored groove regions and safe pattern suggestions | Does looping support the song without repeating fills or erasing breaks? |
| 3 | Gentle, score-aware group tempo following | Can the system follow people without becoming unstable? |
| 3 | Optional expressive control and accessible stopping | Can a single control feel expressive while remaining predictable? |

## 1. Show acceptance separately from playback

**Basis:** novice agency in Polymetros (R10), mixed initiative (R11), coordinated visual time (R12), and visible contributions in the network prototype (R15).

**Hypothesis:** people will understand delayed entries better if they see an immediate confirmation and a separate musical cue. Try a large labelled key tile with four states: ready, accepted/queued, sounding, and stopped. Show an approaching beat and a short “your part enters in…” countdown during written rests. Make these readable without notation, colour discrimination, or sound alone.

For grooves, distinguish “tap to start”, “queued for bar 12”, “looping”, and “stopping at bar 14”. Show the actual scheduled boundary. Avoid calling a queued groove “playing” merely because its start request exists.

**Test:** ask players to predict the next consequence of a tap and identify their own contribution. Compare a plain status line with the cue tile. Measure comprehension and unwanted repeated presses; do not assume that a more animated display helps.

## 2. Selective correction with a measured delay budget

**Basis:** the quantization caution in R8 and end-to-end measurements in R9.

**Hypothesis:** a small asymmetric acceptance window will feel better than always delaying a late gesture to the next grid point. Early requests may wait briefly for the intended onset; slightly late requests should sound promptly. A very early press during a long rest needs an explicit queued indication. A past beat cannot be recovered by backdating an audio timestamp.

Prototype immediate timing, the current score-aligned early queue, and a small bounded correction window. Treat every numeric window as an experimental parameter. Measure device input, browser receipt, accepted request, scheduled attack, and acoustic onset where equipment permits; distinguish intended musical waiting from technical delay. Report distributions and high percentiles, not only averages.

**Test:** keyboard, gamepad, and MIDI inputs; low and dense arrangements; realistic CPU load; uneven callbacks. Reject a correction rule if it reduces timestamp error while worsening perceived control.

## 3. Recover at understandable musical landmarks

**Basis:** explicit synchronization and error policies in R2–R3.

**Hypothesis:** a visible phrase-entry cue will be less confusing than an unexplained jump to the current bar. Prefer authored MIDI markers or rehearsal points; use a bar boundary when no better landmark exists. Preserve local note order for modest delays. Only skip unplayed material after the configured recovery threshold, on an explicit recovery request, or in a separately selected practice policy.

Offer an optional rehearsal mode that repeats an authored section while players learn it. Keep the whole-song mode moving independently so one absent player cannot indefinitely block everyone.

**Test:** lost one note, lost half a bar, absent for several bars, late entry after a long written rest, and return across a harmony change. Track wrong-section entries, skipped onsets, recovery time, and whether players understood the recovery. Do not treat every silence as a mistake.

## 4. Treat humanized chords as one gesture when appropriate

**Basis:** note/chord gesture control in R1. The grouping algorithm below is a new proposal.

Cluster near-simultaneous notes using a short, tempo-aware window measured from the first onset, rather than repeatedly extending the cluster from each subsequent note. Retain each note's original duration and small internal timing offset. Use track/voice and score information to avoid merging a trill, arpeggio, or grace note into a chord. Let an arranger override grouping.

**Test:** exactly simultaneous chords, humanized chord spreads, ornamented melodies, fast repeated notes, and several tracks sharing one MIDI channel. Compare required gestures with a musically annotated reference. A fixed millisecond window is not automatically correct across all repertoire and tempi.

## 5. Author groove regions before attempting clever inference

**Basis:** clip transitions in R6 and beat/measure/cue coordination in R12.

Add optional arrangement annotations for loop start/end, section, break, fill, and allowed transition boundaries. A two- or four-bar repeating groove can preserve a pattern that a one-bar repetition loses. Use repeated onset/pitch patterns only to suggest regions for review; avoid automatically latching a one-off fill.

Keep pitched accompaniment tied to the current harmony. A loop that is rhythmically aligned can still be musically wrong. Written rests and marked breaks should have explicit policies, with an arranger able to say whether a gap is intentional.

**Test:** verse/chorus transitions, fills before a chorus, dropouts, pickups, meter changes, and repeating bass figures over changing chords. Compare current last-bar repetition with authored regions before considering learned segmentation.

## 6. Follow the group gently, using the score rhythm

**Basis:** human-led accompaniment in R4, group adaptivity and feedback in R7, and role asymmetry in R16.

Associate a tap with its requested score onset. Estimate tempo from elapsed performed time relative to elapsed score beats, rather than assuming every tap is one quarter note. Ignore unreliable intervals across rests, repeated accidental presses, and recovery jumps. Aggregate bounded contributions per player so a dense part cannot dominate solely through note count. Confidence weighting and robust aggregation are proposed engineering choices, not findings of GEM.

Compare a fixed clock, a designated conductor, and modest group following. Separate phase correction from tempo correction, cap changes, and hold the current tempo when confidence falls. Begin with laboratory gains around the moderate range investigated in GEM, but do not equate those gains with a percentage change in BPM or assume they transfer unchanged to songs.

**Test:** one player slows down, a fast repeated-note part joins, players drop out, a conductor changes, and two players disagree. Measure tempo drift, oscillation, phase error, and enjoyment. Stronger adaptation should have to demonstrate a benefit.

## 7. Give the one key an expressive job

**Basis:** content/delivery separation in R13 and performer control in R1.

Keep QWERTY taps sufficient for the default interaction. Optional MIDI velocity or accessible pressure sensors could shape dynamics; a configurable hold could shape the current note's articulation without triggering later notes. Groove taps can influence accents without restarting phase. Preserve existing automatic note lengths unless a player explicitly chooses articulation control.

Provide an accessible explicit groove-stop control. A remappable hold-to-stop or separate switch may help some people, but it must be taught and opt-in: neither rapid tapping nor ordinary key release should secretly mean stop. Assistance should disclose when it is playing; it should not make assigned melody notes sound automatically in the default mode.

**Test:** compare clarity, fatigue, and control with people who use different inputs. Do not assume every player can hold a key, double-tap reliably, read a moving display, or operate a mouse while performing.

## 8. Keep remote interval jamming a separate option

**Basis:** NINJAM (R14) and the exploratory network system (R15).

A remote mode could exchange completed musical intervals or schedule shared arrangement events sufficiently ahead. It needs an explicit delay model, clock agreement, and clear feedback about whose earlier contribution is playing. It cannot promise the same action-to-sound experience as local one-key ensemble play.

Evaluate this only after local behaviour is understandable. A single shared audio output remains a useful local baseline; adding multiple speakers or remote audio adds physical and network delays that note-cursor logic does not fix.

## Evaluation plan

Run a small formative study before making claims about effectiveness. A practical first session could use four to eight novices, a facilitator, a simple tune, and a denser pop arrangement. Those group sizes are a proposal for manageable observation, not a power calculation. Include accessibility needs in recruitment and configuration; validate larger room sizes separately.

Compare the previous phrase gate, current Notes/Groove mode, and one experimental change at a time. Counterbalance ordering and use comparable passages to reduce learning effects. Include joining late, missing several notes, resting intentionally, stopping a groove, changing sections, and restarting.

Collect:

- Accepted presses, requested onsets, scheduled attacks/releases, recovery decisions, and transport position.
- Acoustic latency/jitter where measurable; note preservation and rejoin accuracy from event logs.
- Whether players can explain their key's behaviour, hear their contribution, and predict their next entry.
- Perceived control, enjoyment, fatigue, and facilitator interventions.
- Keyboard rollover/ghosting and stuck-key behaviour with the actual shared keyboard; software timing cannot recover keys the hardware never reports.

Keep study logging local by default and obtain consent before recording people or their performances. Report numerical timing results separately from observation and self-report. Simulation and regression tests remain necessary, but they are not substitutes for hearing and observing an actual group.

## Further reading to verify

- [*I Got Rhythm, So Follow Me More: Modeling Score-Dependent…*, SMC 2024](https://smcnetwork.org/smc2024/papers/SMC2024_paper_id136.pdf): potentially relevant to score-aware following. Search metadata was found, but the paper endpoint returned an error during this review; no claimed result above depends on it.
- Original Jam-O-Drum rhythmic-correction studies discussed by Lee: read the original studies before attributing the dissertation's account directly to their experimental findings.
- Full methods and algorithms for MidifilePerformer, Polymetros, and the CHI 2016 mixed-initiative study: the current review uses their official abstracts or project records and should not be treated as a replication specification.
