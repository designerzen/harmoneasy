export interface AudioCommandInterface {
    
    // Handy places to store information about this command
	id:number
	
    type:string
	subtype:string
    number:number

    	// velocity / amplitude value
    velocity:number
    startAt:number
    endAt:number

	// pitch value from MIDI is 0 -> 16383
	value:number
	pitchBend:number

	// UNOFFICAl: Uint8Array
	raw:Uint8Array
	// data:

	time:number
    timeCode:number

	text:string
}
