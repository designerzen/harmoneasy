/**
 * An Audio Event is an Audio Command that has 
 * completed or been "triggered". This is useful
 * for simplifying the connection between request
 * and response.
 * 
 */
import type { AudioCommandInterface } from "./audio-command-interface.ts"
import AudioCommand from "./audio-command.ts"

export default class AudioEvent extends AudioCommand implements AudioCommandInterface { 

	get duration():number{
		return this.endAt - this.startAt
	}

    constructor( audioCommand:AudioCommand, timer ) {
        super()
        this.copyAllParametersFromCommand( audioCommand )
        this.trigger( timer.now )
        console.info("AudioEvent Created", this)
    }

    /**
     * Make this Audio Command make music in a Audio Device    
     * 
     */
    trigger( timestamp:number ){
        this.startAt = timestamp
    }
}