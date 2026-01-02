/**
 * A single stream of data from the inputManager
 * through the transformerManager
 * into the outputManager
 */
import InputManager from "./inputs/input-manager"
import OutputManager from "./outputs/output-manager"
import TransformerManager, { EVENT_TRANSFORMERS_UPDATED } from "./transformers/transformer-manager"
import TransformerManagerWorker from "./transformers/transformer-manager-worker"

import { INPUT_EVENT, NOTE_OFF, NOTE_ON, OUTPUT_EVENT } from "../../commands"
import AudioEvent from "./audio-event"

import type { IAudioCommand } from "./audio-command-interface"
import type Timer from "./timing/timer"
import type AbstractInput from "./inputs/abstract-input"
import type InputAudioEvent from "./inputs/input-audio-event"
import type { IAudioOutput } from "./outputs/output-interface"
import type OutputAudioEvent from "./outputs/output-audio-event"
import type { ITransformer } from "./transformers/robots/interface-transformer"

const DEFAULT_OPTIONS = {

}

export default class IOChain extends EventTarget{

	static convertAudioCommandsToAudioEvents(commands: IAudioCommand[], timestamp:number=0 ): AudioEvent[]{
		return (commands ?? []).map((command: IAudioCommand) => new AudioEvent(command, timestamp ))
	}

	#audioCommandQueue:IAudioCommand[] = []
	#transformerManager:TransformerManagerWorker
	#inputManager:InputManager
	#outputManager:OutputManager
	#abortController:AbortController

	#pausedQueue: number = 0

	#options:object = {}

	get options():object{
		return this.#options
	}
	get transformerManager():TransformerManagerWorker{ 
		return this.#transformerManager 
	}
	get inputManager():InputManager{ 
		return this.#inputManager 
	}
	get inputs():AbstractInput[] {
		return this.#inputManager.inputs
	}
	get outputManager():OutputManager{ 
		return this.#outputManager 
	}
	get outputs():IAudioOutput[]{ 
		return this.#outputManager.outputs
	}
	get transformerQuantity():number{ 
		return this.#transformerManager.quantity 
	}

	constructor( options=DEFAULT_OPTIONS ){
		super()

		this.onTransformersChanged = this.onTransformersChanged.bind(this)
		this.onInputEvent = this.onInputEvent.bind(this)
		this.onOutputEvent = this.onOutputEvent.bind(this)
		
		this.#options = { ...DEFAULT_OPTIONS, ...options }

		this.#transformerManager = new TransformerManagerWorker()
		this.#inputManager = new InputManager()
		this.#outputManager = new OutputManager()

		this.#abortController = new AbortController()

		this.#transformerManager.addEventListener( EVENT_TRANSFORMERS_UPDATED, this.onTransformersChanged, { signal: this.#abortController.signal } )
		this.#inputManager.addEventListener( INPUT_EVENT, this.onInputEvent, { signal: this.#abortController.signal } )
		this.#outputManager.addEventListener( OUTPUT_EVENT, this.onOutputEvent, { signal: this.#abortController.signal } )
	}

	// Transformers ---------------------------------------
	appendTransformer( transformer:Transformer ){
		this.#transformerManager.appendTransformer( transformer )
	}

	removeTransformer( transformer:Transformer ){
		this.#transformerManager.removeTransformer( transformer )
	}

	setTransformers( transformers:Transformer[] ){
		this.#transformerManager.setTransformers( transformers )
	}

	/**
	 * Transform commands
	 * @param audioCommands 
	 * @param timer 
	 * @returns 
	 */
	transform( audioCommands:IAudioCommand[], timer:Timer ){
		return this.#transformerManager.transform( audioCommands, timer )
				.then((transformedAudioCommands: IAudioCommand[]) => {
					this.#audioCommandQueue.push(...transformedAudioCommands)
				})
				.catch((error) => {
					console.error('Transform failed:', error)
					// this.#audioCommandQueue.push(audioCommand)
				})
	}

	// Commands -------------------------------------------

	/**
	 * Add a single command
	 * @param command 
	 */
	addCommand( command:IAudioCommand ){
		this.#audioCommandQueue.push(command)
	}

	/**
	 * Add multiple commands
	 * @param commands 
	 */
	addCommands( commands:IAudioCommand[] ){
		this.#audioCommandQueue.push(...commands)
	}

	/**
	 * Remove all note on and note off commands
	 * (leave all other commands)
	 * cancel any scheduled commands
	 * cancel any playing sounds
	 */
	clearNoteCommands():void{
		this.#audioCommandQueue = this.#audioCommandQueue.filter(cmd =>
			cmd.type !== NOTE_ON && cmd.type !== NOTE_OFF
		)
		this.outputManager.allNotesOff()	
	}

	/**
	 * Process the queue.
	 * Actions every single Command with a startAt set in the past
	 * and returns the commands in order of creation that are in the
	 * future or not yet set to trigger
	 * @param queue
	 */
	executeQueueAndClearComplete( now:number, accumulatorLimit:number=24*12 ):IAudioCommand[]{

		const queue: IAudioCommand[] = this.#audioCommandQueue

		if (!queue || queue.length === 0) {
			return []
		}

		// only trigger commands started in the past
		// queue = queue.filter(audioCommand => audioCommand.startAt <= now)
		const activeCommands: IAudioCommand[] = []
		const remainingCommands: IAudioCommand[] = []

		// act on all data in the buffer...
		let unplayedAccumulator = 0
		const quantity = queue.length
		for (let i = 0; i < quantity && unplayedAccumulator < accumulatorLimit; i++) {
			const audioCommand: IAudioCommand = queue[i]
			const shouldTrigger = audioCommand.startAt <= now
			if (shouldTrigger) {
				activeCommands.push(audioCommand)
				// Transformations already applied at input time, just execute
				// const events = convertAudioCommandsToAudioEvents([audioCommand])
				// recorder.addEvents(events)
				// const triggers = triggerAudioCommandsOnDevice(events)
				// console.info("AudioCommand triggered in time domain", {audioCommand, triggers, timer} )
			} else {
				// ignore this command as it is not yet ready
				unplayedAccumulator++
				remainingCommands.push(audioCommand)
			}
		}

		// update remaining queue
		this.#audioCommandQueue = remainingCommands

		return activeCommands
	}
	
	/**
	 * Check queue for Commands in the past
	 * @param now 
	 * @param divisionsElapsed 
	 * @param state 
	 * @returns IAudioCommand[]
	 */
	updateTimeForCommandQueue( now:number, divisionsElapsed:number, state:State ):IAudioCommand[]{
		let activeCommands:IAudioCommand[]

		// Always process the queue, with or without quantisation
		if (this.transformerManager.isQuantised) 
		{
			//console.info("TICK:QUANTISED", {divisionsElapsed, quantisationFidelity:chain.transformerManager.quantiseFidelity})
			// When quantised, only trigger events on the grid
			const gridSize = this.transformerManager.quantiseFidelity
			if ((this.#pausedQueue === 0) && (divisionsElapsed % gridSize) === 0) 
			{
				activeCommands = this.executeQueueAndClearComplete( now )

				// if grid is set to true in options, we can only ever play one
				// note at a time on this grid point
				this.#pausedQueue = state && state.get("grid") ? gridSize - 1 : 0
				// console.info( pausedQueue, "TICK:QUANTISED", {buffer: audioCommandQueue, divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
			} else {
				// reset duplicator
				this.#pausedQueue = Math.max(0, this.#pausedQueue - 1)
				activeCommands = []
				// console.info( pausedQueue, "TICK:IGNORED", {buffer: audioCommandQueue, divisionsElapsed, quantisationFidelity:transformerManager.quantiseFidelity})
			}

		} else {

			//console.info("TICK:IMMEDIATE", {buffer: audioCommandQueue, divisionsElapsed})
			// When not quantised, process queue immediately on every tick
			activeCommands = this.executeQueueAndClearComplete( now )
		}

		return activeCommands
	}

	/**
	 * Schedule a series of commands to trigger in the 
	 * future using NOW as the registration time
	 * @param commands 
	 * @param timer 
	 * @param transform 
	 * @param startDelay 
	 * @returns IAudioCommand[]
	 */
	addCommandToFuture(commands: IAudioCommand[], timer:Timer, transform:boolean=false, startDelay:number=3):IAudioCommand[]{
		
		commands.forEach(command => {
			// shift it into the future
			command.startAt += timer.now + startDelay
			// inject into the queue...
			if (!transform){
				this.addCommand(command)
			}
		})

		if (transform)
		{
			// Transform is now async - queue the promise
			this.transformerManager.transform(commands, timer)
				.then((transformedAudioCommands: IAudioCommand[]) => {
					this.addCommands(transformedAudioCommands)
				})
				.catch((error) => {
					console.error('Transform failed:', error)
					// Fallback: add untransformed commands
					this.addCommands(commands)
				})
		}
	
		return commands
	}
	
	/**
	 * OutputManager - trigger commands
	 * @param commands 
	 * @returns 
	*/
	triggerAudioCommandsOnDevice(commands: IAudioCommand[]){
		return this.outputManager.triggerAudioCommandsOnOutputs(commands)
	}
	
	// Inputs -------------------------------------------
	addInput( input:AbstractInput ){
		this.#inputManager.add(input)
	}
	addInputs( inputs:AbstractInput[] ){
		inputs.forEach(input => this.#inputManager.add(input))
	}
	removeInput( input:AbstractInput ){
		this.#inputManager.remove(input)
	}

	// fetch a specific input by ID
	getInput(name:string):AbstractInput{
		return this.#inputManager.getInput(name)
	}

	// Outputs -------------------------------------------
	addOutput( output:IAudioOutput ){
		this.#outputManager.add(output)
	}
	addOutputs( outputs:IAudioOutput[] ){
		outputs.forEach(output => this.addOutput(output))
	}
	removeOutput( output:IAudioOutput ){
		this.#outputManager.remove(output)
	}

	/**
	 * Kill this and clean up
	 */
	destroy():void{
		this.#abortController.abort()
	}

	// EVENTS -----------------------------------------------

	/**
	 * User has inputted something
	 * Now we have received these commands
	 * we can decide how to react
	 * either we cache them for scheduling later
	 * or we trigger them immediately
	 * but we always add them to our queue
	 * @param inputEvent 
	 */
	onInputEvent( inputEvent:InputAudioEvent ){
		// extract command and add to queue for consumption later
		const command:IAudioCommand = inputEvent.command
		this.addCommand(command)

		// redispatch event (do not update UI yet)
		inputEvent.preventDefault()
		this.dispatchEvent( inputEvent.clone() )

		// now handle this input through the transformerManager
		console.info( "IOChain:onInputEvent", {command, inputEvent} )
	}

	/**
	 * Transformer has moved, been added or removed
	 * @param transformerEvent 
	 */
	onTransformersChanged(transformerEvent:CustomEvent):void{
		transformerEvent.preventDefault()
		this.dispatchEvent( new CustomEvent(transformerEvent.type, {detail:transformerEvent.detail}) )
		console.info( "IOChain:onInputEvent", {transformerEvent} )	
	}

	/**
	 * An Output event has occurred
	 * @param outputEvent 
	 */
	onOutputEvent( outputEvent:OutputAudioEvent ):void{
		const command:IAudioCommand = outputEvent.command
		outputEvent.preventDefault()
		this.dispatchEvent( outputEvent.clone() )
		console.info( "IOChain:onOutputEvent", {command, outputEvent} )	
	}
}