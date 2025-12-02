import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"
import type { TransformerInterface } from "./transformer-interface.ts"
import { Transformer } from "./abstract-transformer.ts"

export class IdentityTransformer extends Transformer<{}> implements TransformerInterface{
    get name(): string {
        return 'Identity Transformer'
    }
    transform(command: AudioCommand[], timer:Timer): AudioCommand[] {
        return command
    }
}