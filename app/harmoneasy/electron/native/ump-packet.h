#pragma once
#include <cstddef>
#include <cstdint>
// UMP message size is encoded by the message-type nibble, including reserved types.
constexpr size_t umpWordCount(uint32_t firstWord) {
    constexpr uint8_t counts[16] = {1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4};
    return counts[firstWord >> 28];
}
