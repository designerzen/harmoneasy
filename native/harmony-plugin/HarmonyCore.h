#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <cstddef>

namespace harmoneasy {
inline int quantise(int note, int mask) noexcept {
    for (int distance = 0; distance < 128; ++distance) {
        const auto low = note - distance, high = note + distance;
        if (low >= 0 && (mask & (1 << (low % 12))) != 0) return low;
        if (high <= 127 && (mask & (1 << (high % 12))) != 0) return high;
    }
    return -1;
}
// Each input pitch has a bounded FIFO of attacks; releases keep their original mapping.
struct MidiHarmony {
    struct Held {
        std::array<int, 16> targets {};
        int head = 0, size = 0;
    };
    std::array<std::array<Held, 128>, 16> held {};
    std::array<std::array<int, 128>, 16> references {};
    void reset() noexcept { held = {}; references = {}; }
    // -2 means an attack collided with a held target; no retrigger is emitted.
    int attack(int channel, int note, int mask) noexcept {
        auto& queue = held[static_cast<size_t>(channel)][static_cast<size_t>(note)];
        if (queue.size == 16) return -3; // Caller panics rather than losing release ownership.
        const int target = quantise(note, mask);
        queue.targets[static_cast<size_t>((queue.head + queue.size) % 16)] = target;
        ++queue.size;
        if (target < 0) return -1;
        auto& count = references[static_cast<size_t>(channel)][static_cast<size_t>(target)];
        return count++ == 0 ? target : -2;
    }
    int release(int channel, int note) noexcept {
        auto& queue = held[static_cast<size_t>(channel)][static_cast<size_t>(note)];
        if (queue.size == 0) return -1;
        const int target = queue.targets[static_cast<size_t>(queue.head)];
        queue.head = (queue.head + 1) % 16;
        --queue.size;
        if (target < 0) return -1;
        auto& count = references[static_cast<size_t>(channel)][static_cast<size_t>(target)];
        return --count == 0 ? target : -1;
    }
};
enum class ClockEvent { start, resume, stop, pulse };
// Host transport as MIDI clock: 24 pulses per quarter note, the first on the start position.
struct TransportClock {
    bool playing = false;
    double next = 0; // Next pulse, in 24ths of a quarter note.
    void reset() noexcept { playing = false; next = 0; }
    template <typename Emit> void advance(bool isPlaying, double ppq, double ppqEnd, Emit&& emit) {
        if (!isPlaying) {
            if (playing) { playing = false; emit(ClockEvent::stop); }
            return;
        }
        const double start = ppq * 24, end = ppqEnd * 24;
        if (!playing) {
            playing = true;
            emit(ppq < 1e-6 ? ClockEvent::start : ClockEvent::resume);
            next = std::ceil(start - 1e-6);
        } else if (start < next - 1.5 || start > next + 24) {
            next = std::ceil(start - 1e-6); // Loop or jump: re-anchor without a burst of pulses.
        }
        for (int guard = 0; next < end - 1e-6 && guard < 256; ++guard) { emit(ClockEvent::pulse); next += 1; }
    }
};
}
