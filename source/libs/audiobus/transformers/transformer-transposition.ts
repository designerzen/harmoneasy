import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"

export const ID_TRANSPOSITION = "transposition"

export class TransformerQuantise extends Transformer<{}>{

    id = ID_TRANSPOSITION

    constructor(config: {}) {
        super(config)
    }

    transform(commands:AudioCommandInterface[]):AudioCommandInterface[] {
        return commands
    }
}