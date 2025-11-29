import type { AudioCommandInterface } from "../audio-command-interface";
import { Transformer } from "./abstract-transformer"

export class TransformerQuantise extends Transformer<{}>{

    constructor(config: {}) {
        super(config)
    }

    transform(command:AudioCommandInterface[]):AudioCommandInterface[] {
        return command
    }
}