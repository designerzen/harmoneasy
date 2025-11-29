/*
pitches.mjs - defines Pitches for equal division of the octave (EDO) scale
            - Port of pitfalls/lib/Pitches.lua - see <https://github.com/robmckinnon/pitfalls/blob/main/lib/Pitches.lua>
Copyright (C) 2025 Rob McKinnon
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

function ratio(division, edivisions) {
  return division === 0 ? 1 : Math.pow(2, division / edivisions);
}

// This function gets frequency based on index, edo, octave, and base frequency
function get_freq(base_freq, edo, index, oct, base_octave) {
  let f = base_freq * ratio(index - 1, edo);
  if (oct < base_octave) {
    f /= Math.pow(2, base_octave - oct);
  } else if (oct > base_octave) {
    f *= Math.pow(2, oct - base_octave);
  }
  return f;
}

// Convert MIDI number to Hz using a given tuning multiplier
function midi_to_hz(n, tuning) {
  return tuning * Math.pow(2, (n - 69) / 12.0);
}

const denom = Math.log(2);
function hz_to_midi(freq, tuning) {
  return 12.0 * (Math.log(freq / tuning) / denom) + 69;
}

export class Pitches {
  constructor(scale, intervals, tuning, midi_start, root_octave, key_mappings) {
    this.scale = scale;
    this.scaleLength = scale.length;
    this.keyMappings = key_mappings.get(this.scaleLength);
    this.intervals = intervals;
    this.base_freq = midi_to_hz(midi_start, tuning);
    this.root_octave = root_octave;
    this.freqs = {};
    this.midis = {};
    this.degrees = {};
    this.octdegfreqs = {};
    this.octdegmidis = {};
    this.midiMappings = {};
    // array of offsets in cents for each 12 notes in octave C is first offset
    this.tuningOctaveOffsets = [];
    let index = 0;
    let f = null;

    for (let oct = 0; oct <= 8; oct++) {
      this.octdegfreqs[oct] = {};
      this.octdegmidis[oct] = {};
      f = get_freq(this.base_freq, scale.edivisions, scale.tonic, oct, this.root_octave);
      for (let deg = 0; deg < scale.length; deg++) {
        index = index + 1;
        this.freqs[index] = parseFloat((f * intervals.ratio(deg)).toFixed(3));
        this.midis[index] = parseFloat(hz_to_midi(f * intervals.ratio(deg), tuning).toFixed(4));
        this.degrees[index] = deg;
        this.octdegfreqs[oct][deg + 1] = this.freqs[index];
        this.octdegmidis[oct][deg + 1] = this.midis[index];
      }
    }
    // first value MIDI note
    // 2nd value cents offset 0-100
    this.octaveTuning = new Map([
      [60, 0],
      [61, 0],
      [62, 0],
      [63, 0],
      [64, 0],
      [65, 0],
      [66, 0],
      [67, 0],
      [68, 0],
      [69, 0],
      [70, 0],
      [71, 0]
    ]);

    this.midiMappings = Object.values(this.octdegmidis[3]).map((midi) => {
      const integerPart = Math.floor(midi);
      const fractionalPart = midi - integerPart;
      const cents = Math.min(100, Math.round(fractionalPart * 100));
      this.octaveTuning.set(integerPart, cents);
      return [integerPart, cents];
    });

    
      
    this.base_freq = parseFloat(this.base_freq).toFixed(4);
  }

  base_freq() {
    return this.base_freq;
  }

  degree(index) {
    return this.degrees[index];
  }

  freq(index) {
    return this.freqs[index];
  }

  octdeg(deg) {
    const higherOcatve = deg > this.scale.length;
    const octave = this.root_octave + (higherOcatve ? Math.floor((deg - 1) / this.scale.length) : 0);
    const degree = higherOcatve ? (deg % this.scale.length === 0 ? this.scale.length : deg % this.scale.length) : deg;
    // console.log([octave, degree]);
    return [octave, degree];
  }

  octdegfreq(oct, deg) {
    if (this.octdegfreqs[oct]) {
      return this.octdegfreqs[oct][deg];
    } else {
      return null;
    }
  }

  octdegmidi(oct, deg) {
    if (this.octdegmidis[oct]) {
      return this.octdegmidis[oct][deg];
    } else {
      return null;
    }
  }
}
