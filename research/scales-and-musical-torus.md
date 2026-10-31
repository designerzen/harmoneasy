# Scales, pitch sets and the musical torus

Research accessed 30 October 2026. These references describe different equivalence rules within twelve-tone equal temperament and octave equivalence. Their counts should not be treated as competing estimates of one quantity.

## Ian Ring: rooted scales and their properties

Source: [A Study of Scales](https://ianring.com/musictheory/scales/).

Ring encodes pitch collections as twelve-bit integers: bit 0 is the tonic, with successive bits ascending by semitone. The complete space has 4,096 sets, including the empty set. Major is 2741; whole tone is 1365; chromatic is 4095. Requiring the tonic leaves 2,048 sets. His additional maximum-gap rule of four semitones leaves 1,490 scales; his preface cautions that this restriction obscures some patterns.

Modes arise by cyclically rotating the pitch pattern to another included pitch. Reflection and rotation reveal related families and symmetry. Forte and Rahn prime-form conventions differ, so catalogue labels require explicit conventions.

The essay also covers limited transposition and Messiaen truncations; reflective symmetry and chirality; balance, evenness, deep scales, Myhill's property, propriety and maximal area; interval content, hemitonia, tritonia, cohemitonia, proximity and imperfection. These are useful future analysis dimensions, rather than reasons to prohibit a pitch collection.

## Studio Devil: the 223 classes

Source: [The 223 Scales, Marc Gallo](https://studiodevil.com/scales/).

The catalogue starts with 4,095 nonempty pitch sets. Identifying transpositions/modal rotations leaves 351 classes; additionally identifying reflections leaves 223. Consequently a class can contain musically different named scales, such as harmonic minor and harmonic major.

The page provides pitch circles, staff notation, guitar TAB, auditioning and downloadable MIDI, plus filtering by cardinality and names. It identifies 166 classes as lacking common names and distinguishes familiar displayed forms from the original MIDI representatives. Its prime-form notation uses Rahn's method and `t`/`e` for ten/eleven.

Complementation pairs cardinalities k and 12−k. Symmetry creates modes of limited transposition. Six-note collections have 50 classes, while seven-note collections have 38. The empty set is excluded; adding it would give 224 classes. A representative's decimal ID is not its Forte number.

## Andrew Duncan: combinatorial structure and the torus

Source: [Combinatorial Music Theory](https://andrewduncan.net/cmt/), Journal of the Audio Engineering Society 39, 427–448 (June 1991), especially sections 9–17. Retrieved with certificate checking bypassed as requested after the web fetch failed.

Duncan relates interval content to cyclic autocorrelation. The tritone count needs halving when converting directed matches into unordered interval pairs. Interval content is invariant under transposition, but does not uniquely identify a collection. His binary convention places note zero at the highest bit, the reverse of Ring's convention.

His normalized fingerboard moves +1 semitone to the right and +5 upward. Reducing pitches modulo twelve makes both directions periodic. Joining opposite boundaries forms a 12×12 torus, containing twelve occurrences of each pitch class. Its pitch label is `(x + 5y) mod 12`. Identifying equal pitches further produces the twelve-vertex graph H₁₂, with chromatic and fourths/fifths Hamiltonian cycles. These are distinct representations, not 144 independent notes.

Reflection acts as `−p mod 12`; multiplication by five interchanges chromatic and harmonic motion. These transformations support experiments with pattern structure rather than only named scales.

## Implementation decisions

The new **Scale Explorer Input** and **Scale Explorer Transformer** share a pitch-set model. They supplement the existing scale selectors without changing global tuning. All 4,096 masks are valid, including even IDs, large gaps, single notes and silence; the editor does not enforce Ring's narrower scale definition. This is a twelve-tone experiment, not a microtonal tuning system or a complete model of culturally specific performance practices.

The class menu is generated from mathematics, without copying either site's named catalogue, recordings, notation, prose or images. Each representative is the minimum integer across all twelve transpositions and their reflections. The class menu contains 223 nonempty representatives, sorted by note count and ID; the ID is deliberately labelled as a class representative rather than a Forte number or asserted musicological name. A small set of conventional named patterns supplies familiar starting points.

The effective set is evaluated in this order: choose the collection or custom ID; apply original/reflection/complement/multiplication by five or seven; apply mode rotation; transpose to the tonic. Mode 0 preserves the set exactly, even when it excludes the tonic. Mode 1 rebases on the second selected pitch; higher modes wrap by cardinality. The Input displays the resulting ID, pitches, cyclic steps, interval-class vector and class ID. Its six-component vector counts unordered intervals 1–6, with tritones counted once.

The Input follows the shared transport with ascending eighth notes, configurable octave, velocity, channel and gate. It skips missed steps after a stalled clock and releases notes on stop, disconnect, configuration changes and destruction. **Audition chord** plays a short chord independently of transport. Input options and Transformer configuration serialize through the existing device mechanisms.

The musical torus uses 144 interactive surface facets covering the full 12×12 periodic fingerboard. Optional **3D mode** adds a shaded perspective surface with depth sorting. Drag with a mouse, pen or one finger to rotate yaw and pitch through full turns; Shift-drag adjusts roll. Separate yaw, pitch and roll controls provide precise angles, and **Reset view** restores the initial orientation. Pointer capture keeps rotation working outside the view; movement past the drag threshold suppresses note activation. Switching 3D off restores the fixed-angle projection. Each facet owns one lattice pitch; pressing any facet triggers audition or editing, with no circular note overlays.

Closed curves include both seams. Large-ring movement is chromatic; movement around the tube is by fourths. Included pitches are highlighted everywhere they occur; labels are transposed by the tonic. This is the periodic fingerboard torus, not a purported embedding of the reduced H₁₂ graph.

In **Audition notes** mode, pressing a torus facet plays its pitch, including notes outside the set. Arrow keys navigate a single focus position with wrapping; Enter or Space activates it. Right/left changes pitch by ±1; up/down changes pitch by ±5. **Edit pitch set** toggles every occurrence of the chosen pitch. Editing materializes the current effective set as a custom mask and resets operation/mode so the displayed result remains the edited collection. The separate twelve pitch buttons edit the base collection before operations.

The Transformer offers nearest, upward, downward and membership-filter modes across MIDI 0–127. Nearest ties go downward; directional searches drop notes if no valid pitch remains in that direction. Empty sets suppress attacks. Releases use the target recorded at attack time, even after edits. Controller messages pass through. It reuses the existing performance lifecycle for transport reset, bypass and panic handling.

## Trying it

1. Add **Scale Explorer** under Inputs and connect a sound output. Start transport, or use **Audition chord**.
2. Choose a named pattern or any class, then vary tonic, mode and set operation. Choose **Custom pitch-set ID** to enter an ID or toggle the twelve base pitches. ID 0 produces silence.
3. Rotate the torus view, select **Audition notes**, press surface facets, and compare arrow-key movements. Switch to **Edit pitch set** to change the highlighted collection.
4. Add **Scale Explorer** under Transformers to an existing keyboard/controller chain. Set the same collection and choose nearest/up/down/filter to hear how it constrains a performance.

## Scope and follow-up research

This implements a complete twelve-tone set space and the toroidal fingerboard, not every analytical metric discussed by the references. Future work could add the reduced H₁₂ graph, autocorrelation overlays, symmetry axes and periods, Z-related collections, proximity browsing, notation and enharmonic spelling, MIDI export, and the remaining Ring metrics. Names should retain provenance and distinguish a pitch collection from the musical tradition in which it occurs.

Verification covers all masks, class counts and cardinalities; inversion/rotation identities; interval/tritone conventions; MIDI boundaries; stored note releases across edits; silent sets and velocity-zero releases; factory registration; transport gating and stalls; configuration restoration; and torus seam, keyboard, audition and editing behavior.
