/*
edoscale.mjs - EdoScale defines equal division of the octave (EDO) scale in Ls notation
             - Port of pitfalls/lib/Scale.lua - see <https://github.com/robmckinnon/pitfalls/blob/main/lib/Scale.lua>
Copyright (C) 2025 Rob McKinnon
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
const M:number = 2
const L:number = 1
const S:number = 0

const LABELS = ['s', 'L', 'M']

export default class EdoScale {

    #tonic:number = 1
    #mode:number = 1
    #maxSteps:number = 12
    #minSteps:number = 3
    #length:number = -1

    #large:number
    #medium:number
    #small:number

    #step:number[] = []
    stepbackup:number[] = [L, L, S, L, L, L, S, L, L, L, S, L, L, L, S, L]

    #sequence:string = null

    divisions:number[] = []
    edivisions:number = 0

    get tonic():number{
        return this.#tonic
    }

    get length(){
        return this.#length
    }

    get step():number[] {
        return this.#step
    }

    get hasMedium():boolean {
        return this.#step.some((_, i) => this.#step[this.getOffset(i)] === M)
    }

    get sequence():string {
        return this.#sequence
        //return this.#step.map((_, i) => this.getStepSize(i)).join('')
    }

    set sequence( sequenceValues:string ){
        if (this.sequence !== sequenceValues) 
        {
            this.#sequence = sequenceValues
            this.#length = sequenceValues.length
            this.#step = []
            for (let i = 0; i < sequenceValues.length; i++) {
                const char = sequenceValues[i]
                this.#step[i] = char === 'L' ? L : char === 'M' ? M : S
            }
            this.updateEdo()
        }
    }

    set mode(modeValue:number) {
        this.#mode = modeValue
    }

    set tonic(tonicValue:number) {
        this.#tonic = tonicValue
    }
    
    set minSteps(minValue:number) {
        this.#minSteps = minValue
    }

    set maxSteps(maxValue:number) {
        this.#maxSteps = maxValue
    }

    set small(s:number) {
        if (this.#small !== s) {
            this.#small = s
            this.updateEdo()
        }
    }

    set medium(m:number) {
        if (this.#medium !== m) {
            this.#medium = m
            this.updateEdo()
        }
    }

    set large(l:number) {
        if (this.#large !== l) 
        {
            this.#large = l
            this.updateEdo()
        }
    }

    /**
     * 
     * @param large 
     * @param small 
     * @param sequence 
     * @param medium 
     */
    constructor(large:number, small:number, sequence:string, medium:number|undefined=undefined) {
        this.#large = large
        this.#medium = medium || large
        this.#small = small
        this.sequence = sequence
    }

    getStepSize(i: number): string {
         return LABELS[this.#step[this.getOffset(i)]]
     }

     getStepValue(i: number): number {
         const step = this.#step[this.getOffset(i)];
         return step === L ? this.#large : step === M ? this.#medium : this.#small;
     }

     getOffset(i: number): number {
         if (this.#mode === 1) {
             return i
         } else {
             const offset = (this.#mode - 1 + i) % this.#length
             return offset === 0 ? this.#length : offset
         }
     }
     
     setLength(d: number): boolean {
        const orig:number = this.#length
        if (d === 1) {
            this.#length = Math.min(this.#length + 1, this.#maxSteps)
        } else if (d === -1) {
            this.#length = Math.max(this.#length - 1, this.#minSteps)
        }

        const changed:boolean = this.#length !== orig
        if (changed) {
            this.#mode = 1
            if (d === 1) {
                this.#step[this.#length] = this.stepbackup[this.#length] || L
            } else if (d === -1 && this.#length >= this.#minSteps) {
                this.#step.pop()
            }
            this.updateEdo()
        }
        return changed
    }

    setMode(d: number): boolean {
        const orig = this.#mode
        this.#mode = Math.max(1, Math.min(orig + d, this.#length))
        return orig !== this.#mode
    }

    setTonic(d: number): boolean {
        const orig = this.#tonic
        this.#tonic = Math.max(1, Math.min(orig + d, this.edivisions))
        return orig !== this.#tonic
    }

    setStep(d: number, i: number): boolean {
        const index = this.getOffset(i)
        const orig = this.#step[index]
        this.#step[index] = Math.max(S, Math.min(this.#step[index] + d, M))
        this.stepbackup[index] = this.#step[index]
        const changed = orig !== this.#step[index]
        if (changed) {
            this.updateEdo()
        }
        return changed
    }

    setLarge(d: number): boolean {
        const orig = this.#large
        this.large = Math.max(this.#small + 1, Math.min(this.#large + d, this.#large + 1))
        const changed = this.#large !== orig
        if (changed) {
            if (this.#large <= this.#medium) {
                this.medium = (Math.max(this.#small + 1, Math.min(this.#large - 1, this.#large)))
            }
            this.updateEdo()
        }
        return changed
    }

    setMedium(d: number): boolean {
        const orig = this.#medium
        this.medium = (Math.max(this.#small + 1, Math.min(this.#medium + d, this.#large - 1)))
        const changed = this.#medium !== orig
        if (changed) {
            this.updateEdo()
        }
        return changed
    }

    setSmall(d: number): boolean {
        const orig = this.#small
        const value = this.#small + d

        if (this.hasMedium) {
            this.small = Math.max(1, Math.min(value, this.#medium - 1))
        } else {
            this.small = Math.max(1, Math.min(value, this.#large - 1))
        }

        const changed = this.#small !== orig
        if (changed) {
            if (this.#small >= this.#medium) {
                this.medium = Math.max(this.#small + 1, Math.min(this.#large))
            }
            this.updateEdo()
        }
        return changed
    }
        
    /**
     * Update EDO divisions
     * @returns boolean - true if divisions changed
     */
    updateEdo(): boolean {
        const orig = this.edivisions
        this.edivisions = this.#step.reduce((sum: number, _: number, i: number) => {
            this.divisions[i] = sum
            return sum + this.getStepValue(i)
        }, 0)
        // console.log(this.divisions)
        const changed = orig !== this.edivisions
        if (changed) {
            this.#tonic = Math.max(1, Math.min(this.#tonic, this.edivisions))
        }
        return changed
    }
}
