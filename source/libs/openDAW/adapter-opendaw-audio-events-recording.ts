import { RecorderAudioEvent } from "../audiobus/recorder-audio-event.js"
import type AudioEvent from "../audiobus/audio-event.js"
import type Timer from "../audiobus/timing/timer.js"
import { NOTE_ON } from "../../commands.js"

/**
 * Produces an array of notes from the 
 * @param data 
 * @returns 
 */
const createOpenDAWNotesScript = (data:AudioEvent[]) => {
    const output:string[] = []
    data.forEach((command, index) => {
        switch( command.type )
        {
            case NOTE_ON :
                output.push( JSON.stringify({
                    position: command.startAt,
                    pitch: command.noteNumber,
                    velocity: 127,
                    duration: command.duration
                }))
                break
        }
    })
    return output
}

/**
 *
 * @param recording
 */
export const createOpenDAWProjectFromAudioEventRecording = async (recording:RecorderAudioEvent, timer:Timer ) => {

    const BPM:number = timer.BPM
    const data:AudioEvent[] = recording.exportData()

    // openDAW script editor (very early preview - under heavy construction)
    const script:string = `const project = openDAW.newProject(${recording.name})
    project.bpm = ${BPM}
    project.output.volume = -6.0

    const notes = [${ createOpenDAWNotesScript(data).join(",") }]
       
    project
        .addInstrumentUnit("Vaporisateur")
        .addNoteTrack()
        .addRegion({duration: PPQN.Bar * 4, loopDuration: PPQN.Bar})
        .addEvents(notes)

    project.openInStudio()`

    return script
}