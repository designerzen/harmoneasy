/*
edo.mjs - Equal division of the octave (EDO)
Copyright (C) 2025 Rob McKinnon
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// import { register, pure, noteToMidi, isNote, tokenizeNote } from '@strudel/core';
import { EdoScale } from './edoscale.mjs';
import { Intervals } from './intervals.mjs';
import { Pitches } from './pitches.mjs';
import { keyMappings } from './keyMappings.mjs';


/**
 * Turns numbers into notes in the given EDO scale (zero indexed).
 *
 * An EDO scale definition looks like this:
 *
 * e.g. C:LLsLLLs:2:1 <- this is the C major scale, 12 EDO
 *
 * e.g. C:LLsLLL:3:1 <- this is the Gorgo 6 note scale, 16 EDO
 *
 * An EDO scale, e.g. C:LLsLLLs:2:1, consists of a root note (e.g. C)
 * followed by semicolon (':')
 * and then a [Large/small step notation sequence](https://en.xen.wiki/w/MOS_scale)
 * (e.g. LLsLLLs)
 * followed by semicolon, then the large step size (e.g. 2)
 * followed by semicolon, then the small step size (e.g. 1).
 *
 * The number of divisions of the octave is calculated as the sum
 * of the steps in the EDO scale definition.
 *
 * e.g. C:LLsLLLs:2:1 is 2+2+1+2+2+2+1 = 12 EDO, 7 note scale
 *
 * e.g. C:LLsLLL:3:1 is 3+3+1+3+3+3 = 16 EDO, 6 note scale
 *
 * The root note defaults to octave 3, if no octave number is given.
 *
 * @name edoScale
 * @param {integer} baseNoteMidi MIDI number base note.
 * @param {integer} rootOctave octave number.
 * @param {string} sequence Ls notation for scale.
 * @param {integer} large Large 'L' step size.
 * @param {integer} small Small 's' step size.
 * @returns array of 12 offsets in cents from the 12 EDO notes, starting from `C`
 * @example
 * edoScaleMicroTuningOctave(60, 3, "LLsLLLs", 2, 1)
 * @example
 * edoScaleMicroTuningOctave(60, 2, "LLsLLL", 3, 1)
 */
const pitchesCache = new Map()
export const edoScaleMicroTuningOctave = function (baseNoteMidi, rootOctave, sequence, large, small) {

  const key = [baseNoteMidi, rootOctave, sequence, large, small].join(':')
  if (pitchesCache.has(key)) {
    return pitchesCache.get(key)
  }
  // console.log({ key });
  // const root_octave = tokenizeNote(base_note)[2] || 3;
  // console.log({ root_octave });
  const scale = new EdoScale(large, small, sequence)
  const intervals = new Intervals(scale)
  const pitches = new Pitches(scale, intervals, 440, baseNoteMidi, rootOctave, keyMappings)
  pitchesCache.set(key, pitches)

  // console.log({ base_note: noteToMidi(base_note) });
  // console.log({ sequence });
  // console.log({ edivisions: scale.edivisions });
  // console.log({ intervals });
  // console.log({ pat });
  // console.log({ pitches: pitches });
  return pitches

  //   return pat
  //     .fmap((value) => {
  //       const isObject = typeof value === 'object';
  //       const n = isObject ? value.n : value;
  //       if (isObject) {
  //         delete value.n; // remove n so it won't cause trouble
  //       }
  //       if (isNote(n)) {
  //         // legacy..
  //         return pure(n);
  //       }
  //       const deg = (typeof n === 'string' ? parseInt(n, 10) : Number.isInteger(n) ? n : Math.round(n)) + 1;

  //       const [oct, degree] = pitches.octdeg(deg);
  //       const freq = pitches.octdegfreq(oct, degree);
  //       const note = pitches.octdegmidi(oct, degree);
  //       const edo = pitches.scale.edivisions;
  //       const root = pitches.base_freq;
  //       const degreeIndexes = pitches.scale.divisions;
  //       const intLabels = pitches.intervals.intLabels;
  //       // const color = 'red';
  //       value = pure(isObject ? { ...value, degree, degreeIndexes, intLabels, root, freq, edo } : note);
  //       // value = pure(isObject ? { ...value, key } : note);
  //       // value = pure(isObject ? { ...value, edo } : note);
  //       // console.log({ value });
  //       return value;
  //     })
  //     .outerJoin()
  //     .withHap((hap) => hap.setContext({ ...hap.context, scaleDefinition }));
  // },
  // true,
  // true, // preserve tactus
}
