import type AudioCommand from "../audiobus/audio-command";
import { Transformer } from "./abstract";

export class QuantiseTransformer extends Transformer<{}> {
    transform(command: AudioCommand): AudioCommand {
        // TODO: Implement
        return command
    }
}