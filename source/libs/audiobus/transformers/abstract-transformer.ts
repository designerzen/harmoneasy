import type AudioCommand from "../audio-command"

export interface TransformerConfig {

}

export abstract class Transformer<Config = TransformerConfig> {
    protected config: Config
    constructor(config: Config) {
        this.config = config
    }

    abstract transform(command: AudioCommand): AudioCommand
}