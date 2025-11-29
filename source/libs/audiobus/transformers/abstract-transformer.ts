import type AudioCommand from "../audio-command"
import type { AudioCommandInterface } from "../audio-command-interface"

export interface TransformerConfig {

}

export abstract class Transformer<Config = TransformerConfig> {
    protected config: Config
    constructor(config: Config) {
        this.config = config
    }

    abstract transform(command: AudioCommandInterface): AudioCommandInterface
}