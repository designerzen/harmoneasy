<<<<<<< HEAD
import type AudioCommand from "../audio-command"
=======
>>>>>>> c5160fc304026aa7bff62c92756c4a445d9b4444
import type { AudioCommandInterface } from "../audio-command-interface"

export interface TransformerConfig {

}

export abstract class Transformer<Config = TransformerConfig> {
    protected config: Config
    constructor(config: Config) {
        this.config = config
    }

<<<<<<< HEAD
    abstract transform(command: AudioCommandInterface): AudioCommandInterface
=======
    abstract transform(command: AudioCommandInterface[]): AudioCommandInterface[]
>>>>>>> c5160fc304026aa7bff62c92756c4a445d9b4444
}