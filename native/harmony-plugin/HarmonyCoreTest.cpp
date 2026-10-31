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
}
