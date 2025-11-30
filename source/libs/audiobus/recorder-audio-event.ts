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
            console.info( "Event", event, {allEvents} )
            switch( event.type )
            {
                case NOTE_ON :

                    const hasNoteOn = currentlyPlaying.has( event.noteNumber )
                    if (hasNoteOn)
                    {
                        const relatedCommand = currentlyPlaying.get( event.noteNumber )
                        const duration:number = relatedCommand.startAt - event.startAt
                        event.endAt = relatedCommand.startAt
                        event.endAt = relatedCommand.startAt
                        console.info("FOUND NOTE ON Reorganised data", event,event.duration, duration, { playing: currentlyPlaying })
                    }else{
                        console.info("ORPHAN NOTE ON Reorganised data", event, {playing: currentlyPlaying })
                    }

                    currentlyPlaying.delete( event.noteNumber )
                    break

                case NOTE_OFF :
                    currentlyPlaying.set( event.noteNumber, event )
                    console.info("NOTE OFF Reorganised data", event, {playing: currentlyPlaying } )
                    break
            }
           
        }

        return allEvents
    }
}
