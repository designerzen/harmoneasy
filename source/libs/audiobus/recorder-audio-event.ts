import { NOTE_OFF, NOTE_ON } from "../../commands.ts"
import AudioEvent from "./audio-event.ts"

export class RecorderAudioEvent {
    
    events:AudioEvent[] = []
    
    constructor(){
        this.events = []
    }

    addEvents( events:AudioEvent[] ){
        this.events.push(...events)
        return this.events
    }

    addEvent( event:AudioEvent){
        this.events.push(event)
    }

    clear(){
        this.events.length = 0
    }

    // we need to add the end times to all of the AudioEvents :(
    exportData():AudioEvent[]{

        const allEvents = this.events.slice()
        const quantity = allEvents.length -1
        const currentlyPlaying = new Map()

        for (let i=quantity; i > 0 ; --i)
        {
            // find all note off events and find their assoc
            const event = allEvents[i]
            // console.info( "Event", event, {allEvents} )
            switch( event.type )
            {
                case NOTE_ON :

                    const hasNoteOn = currentlyPlaying.has( event.noteNumber )
                    if (hasNoteOn)
                    {
                        const noteOffCommand = currentlyPlaying.get( event.noteNumber )
                        const duration:number = noteOffCommand.startAt - event.startAt

                        // set the end at to the start at time of the note off
                        event.endAt = noteOffCommand.startAt

                        // and update the note offs
                        // noteOffCommand.startAt = event.startAt
                        // noteOffCommand.time = event.startAt
                        noteOffCommand.endAt = noteOffCommand.startAt

                        if (isNaN(duration))
                        {
                            console.info("BAD DURATION NOTE ON Reorganised data", event,event.duration, duration, { playing: currentlyPlaying })
                        }else{
                            // console.info("FOUND NOTE ON Reorganised data", event,event.duration, duration, { playing: currentlyPlaying })
                        }

                    }else{
                        // console.info("ORPHAN NOTE ON Reorganised data", event, {playing: currentlyPlaying })
                    }

                    currentlyPlaying.delete( event.noteNumber )
                    break

                case NOTE_OFF :
                    currentlyPlaying.set( event.noteNumber, event )
                    // console.info("NOTE OFF Reorganised data", event, {playing: currentlyPlaying } )
                    break
            }
           
        }
        console.info("Note events", allEvents)
        return allEvents
    }
}
