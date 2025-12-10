import type AudioCommand from "../audio-command.ts"
import type Timer from "../timing/timer.ts"
import type { TransformerInterface } from "./interface-transformer.ts"
import { Transformer } from "./abstract-transformer.ts"

export const ID_IDENTITY = 'identity'

export class IdentityTransformer extends Transformer<{}> implements TransformerInterface{
    
	protected type = ID_IDENTITY

	get name(): string {
        return 'Identity Transformer'
    }
    transform(command: AudioCommand[], timer:Timer): AudioCommand[] {
        return command
    }
}