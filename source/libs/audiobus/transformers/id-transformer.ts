import type AudioCommand from "../audio-command.ts"
import { Transformer } from "./abstract-transformer.ts"

export class IdentityTransformer extends Transformer<{}> {
    transform(command: AudioCommand[], timer?: any): AudioCommand[] {
        return command
    }

    get name(): string {
        return 'Identity Transformer'
    }
}