import type AudioCommand from "../audio-command.ts"
import { Transformer } from "./abstract-transofrmer.ts"

export class QuantiseTransformer extends Transformer<{}> {
    transform(command: AudioCommand): AudioCommand {
        // TODO: Implement
        return command
    }
}