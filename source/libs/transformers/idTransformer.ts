import type AudioCommand from "../audiobus/audio-command";
import { Transformer } from "./abstract";

export class IdentityTransformer extends Transformer<{}> {
    transform(command: AudioCommand): AudioCommand {
        return command
    }
}