#include "HarmonyCore.h"
#include <cstdlib>
static void check(bool value) { if (!value) std::abort(); }
int main() {
    using namespace harmoneasy;
    MidiHarmony midi;
    check(quantise(61, 145) == 60);
    check(quantise(127, 1) == 120);
    check(quantise(60, 0) == -1);
    check(midi.attack(0, 60, 145) == 60);
    check(midi.attack(0, 61, 145) == -2);
    check(midi.release(0, 60) == -1);
    check(midi.release(0, 61) == 60);
    check(midi.attack(0, 61, 145) == 60);
    check(midi.attack(0, 61, 580) == 62);
    check(midi.release(0, 61) == 60);
    check(midi.release(0, 61) == 62);
    check(midi.attack(1, 60, 0) == -1);
    check(midi.release(1, 60) == -1);
    TransportClock clock;
    int starts = 0, resumes = 0, stops = 0, pulses = 0;
    auto count = [&](ClockEvent event) {
        if (event == ClockEvent::start) ++starts;
        else if (event == ClockEvent::resume) ++resumes;
        else if (event == ClockEvent::stop) ++stops;
        else ++pulses;
    };
    clock.advance(true, 0, 0.5, count); // The downbeat pulse plus 11 more in half a beat.
    check(starts == 1 && pulses == 12);
    clock.advance(true, 0.5, 1, count);
    check(pulses == 24);
    clock.advance(true, 0, 0.1, count); // A loop back re-anchors rather than bursting.
    check(pulses == 27 && starts == 1);
    clock.advance(false, 0.1, 0.1, count);
    clock.advance(false, 0.1, 0.1, count);
    check(stops == 1);
    clock.advance(true, 8, 8.01, count);
    check(resumes == 1 && pulses == 28);
}
