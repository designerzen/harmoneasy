/*
intervals.mjs - defines Intervals for equal division of the octave (EDO) scale
              - Port of pitfalls/lib/Intervals.lua - see <https://github.com/robmckinnon/pitfalls/blob/main/lib/Intervals.lua>
Copyright (C) 2025 Rob McKinnon and Strudel contributors
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import type EdoScale from './edo-scale.ts'
import ratiointervals from './ratios.ts'
import { getRatio } from './utils.ts'

const BLANK = '';

export default class Intervals {

    #scale:EdoScale

    intLabels = []
    intNoms = []
    intRatios = []
    uniqLabels = []
    intErrors = []

    #ratios:Number[] = []

    get scale():EdoScale{
        return this.#scale
    }

    constructor(scale:EdoScale) {

        this.#scale = scale
    
        const labToErr = {}
        const labToInd = {}

        let division = 0

        // set first ratio to 1
        this.#ratios[0] = 1

        // loop through scale
        for (let i = 0; i < scale.length; i++) {

            division += scale.getStepValue(i)

            this.#ratios[i + 1] = getRatio(division, scale.edivisions)

            const nearest = ratiointervals.getNearestInterval(this.#ratios[i + 1])
            const closeness = nearest[0]
            const ratio = nearest[1]

            if ( nearest === null || closeness == null || ratio === null )
            {
                throw Error("Intervals failed to find nearest interval")
            }

            const intLabel = ratiointervals.getKey(ratio)

            this.intLabels[i + 1] = intLabel
            this.intErrors[i + 1] = closeness
            this.intNoms[i + 1] = ratio ? ratiointervals.nom(ratio) : 0
            this.intRatios[i + 1] = ratio ? `${ratiointervals.nom(ratio)}/${ratiointervals.denom(ratio)}` : ''
            
            this.uniqLabels[i + 1] = BLANK

            if (intLabel && intLabel !== 'P1' && intLabel !== 'P8') {
                if (!labToErr[intLabel]) {
                    
                    this.uniqLabels[i + 1] = intLabel
                    labToInd[intLabel] = i + 1
                    labToErr[intLabel] = closeness

                } else if (closeness < labToErr[intLabel]) {

                    this.uniqLabels[labToInd[intLabel]] = BLANK
                    this.uniqLabels[i + 1] = intLabel
                    labToInd[intLabel] = i + 1
                    labToErr[intLabel] = closeness

                }
            }
        }
    }

  getRatioAtIndex(i:Number) {
    return this.#ratios[i]
  }

  intervalLabel(i:Number) {
    return this.intLabels[i]
  }

  intervalNominator(i:Number) {
    return this.intNoms[i]
  }

  intervalRatio(i:Number) {
    return this.intRatios[i]
  }

  uniqIntervalLabel(i:Number) {
    return this.uniqLabels[i]
  }

  intervalError(i:Number) {
    return this.intErrors[i]
  }

  getNearestDegreeTo(r:Number, threshold:Number) {
    let min:Number = 1
    let degree = null

    for (const [i, v] of Object.entries(this.#ratios)) {
      const diff:Number = Math.abs((r - v) / r)
      if (diff < min) {
        min = diff
        degree = parseInt(i, 10)
      }
    }

    if (threshold == null) {
      return degree
    } else {
      return min < threshold ? degree : 1
    }
  }
}
