export interface IAudioOutput{
	get uuid(): string
	get name():string
	get description():string
	get isConnected():boolean
	get isHidden():boolean
	
	noteOn(note: number, velocity: number): void
	noteOff(note: number): void
	allNotesOff(): void

	// TODO: implement pitchBend etc

	// optional
	connect?():Promise<Function>|Function
	disconnect?():Promise<void>|Function
	createGui?():Promise<HTMLElement>
	destroyGui?():Promise<void>

	// has a button element and a method to call on click
	// getControls():Object

	hasMidiOutput?(): boolean
	hasAudioOutput?(): boolean
	hasAutomationOutput?(): boolean
	hasMpeOutput?(): boolean
	hasOscOutput?(): boolean
	hasSysexOutput?(): boolean
}