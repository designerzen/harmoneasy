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

    exportData():AudioEvent[]{
        return this.events
    }
}
