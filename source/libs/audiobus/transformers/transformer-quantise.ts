import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"

export const ID_QUANTISE = "quantise"

export class TransformerQuantise extends Transformer<{ step: number }>{

    id = ID_QUANTISE

    constructor(config = { step: 4 }) {
        super(config)
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        return commands
    }

    get name(): string {
        return 'Quantise'
    }

    setConfig(c: string, val: unknown) {
        this.config[c] = val
    }

    get fields() {
        return [
            { name: 'step', type: 'select', values: [1, 4, 8, 12] }
        ]
    }
}