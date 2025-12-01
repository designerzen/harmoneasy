/**
 * Create a MIDI Device per connection
 * then pass in all note on and note off data
 * in realtime and this will update and mediate
 * the timing and the quantisation via the update 
 * method that should be run at 24 ticks per quarternote 
 */
import type NoteModel from '../note-model.ts'
import MIDIRequestedCommand from './midi-requested-command.ts'

export default class MIDIDevice{

    #name = "Unknown Device"

    // future scheduled events
    requestedCommands:Map = new Map()

    // currently active notes triggered by this class
    activeNotes:Map = new Map()

    quantise:boolean = true

    get name(){
        return this.#name
    }

    constructor( deviceName:string ){
        if (deviceName)
        {
            this.#name = deviceName
        }
        console.info("Quanitsable MIDI Device Created!", this )
    }

    /**
     * Note ON - create a Command and store for later use
     * @param {Note} noteEvent 
     * @returns Whether or not the note was already playing
     */
    noteOn( noteEvent:NoteModel, timestamp:number, velocity:number=1 ){
       
        const isPlaying = this.activeNotes.get( noteEvent.noteNumber )
        if (isPlaying)
        {
            return false
        }
        
        this.activeNotes.set( noteEvent.noteNumber, noteEvent )

        if (this.quantise)
        {
            // defer
            this.scheduleNoteOn( noteEvent, timestamp, velocity )
        }else{
            // immediately handle
            
        }
        return true
    }

    /**
     * Schedule a Note ON
     * 
     * @param noteEvent 
     * @param timestamp 
     * @param velocity 
     * @returns 
     */
    scheduleNoteOn( noteEvent:NoteModel, timestamp:number, velocity:number=1 ){
        // see if one exists and re-use or create a new one
        let command 
        if (this.requestedCommands.has(noteEvent.number))
        {
            // the same note has been requested so we overwrite the 
            // original note with this new note
            command = this.requestedCommands.get(noteEvent.number)
            // this.requestedCommands.set( noteEvent.number, command )
        }else{
            command = new MIDIRequestedCommand( noteEvent, velocity )
        }
        // overwrite the command
        command.noteOn( noteEvent.number, velocity, timestamp)
        this.requestedCommands.set( noteEvent.number, command )
        // console.info(this.name + " MIDI Device Note ON", noteEvent.number, {noteEvent, command}, this.requestedCommands )
        return command
    }

    /**
     * Schedule a Note OFF
     * 
     * Note OFF - Find the related command and utilise
     * @param {Note} noteEvent 
     */
    noteOff( noteEvent:NoteModel, timestamp:number ){
        if (this.quantise)
        {
            // defer
            this.scheduleNoteOff( noteEvent, timestamp )
        }else{
            // immediately handle
            this.activeNotes.delete( noteEvent.noteNumber )
        }
    }

    /**
     * 
     * @param noteEvent 
     * @param timestamp 
     */
    scheduleNoteOff(noteEvent:NoteModel, timestamp:number ){
        // don't delete the command!
        // just update the end time
        if (this.requestedCommands.has(noteEvent.number))
        {
            // the same note has been requested so we overwrite the 
            // original note with this new note
            const command = this.requestedCommands.get(noteEvent.number)
            // overwrite the command
            command.noteOff( noteEvent.number, timestamp )

            // console.info( this.name + " MIDI Device Note OFF", noteEvent.number, {noteEvent, command}, this.requestedCommands )
        }else{
            // console.info( this.name + "MIDI Device requested note off but note not playing", noteEvent)
        }
        // this.requestedCommands.delete( noteEvent.number )  
    }

    /**
     * Loop through all future commands and see if they are now
     * ready to be triggered then trigger them and remove them from the buffer
     * 
     * @returns all commands that have been triggered
     */
    update( timestamp:number, division:number=0 ):Array{

        const output = []
        // console.info("MIDI Device",this, timestamp, this.requestedCommands)

        this.requestedCommands.forEach( command => {
            // console.info("MIDI Device",this, time, this.requestedCommands)
            // trigger commands if now is their time!
            const updated = command.update(timestamp, division)
            // if the command is ready to be triggered, trigger it!
            if (updated)
            {
                output.push( command )
                this.requestedCommands.delete( command.number )
                // console.info(this.name + "Quanitsable MIDI Device Command Triggered",timestamp, {command, updated} )
            }else{
                // console.info(this.name + "Quanitsable MIDI Device Tested Command and ignored",timestamp, {command, updated} )
            }
        })
        return output
    }
}