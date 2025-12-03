import { RecorderAudioEvent } from "../audiobus/recorder-audio-event.js"
import type AudioEvent from "../audiobus/audio-event.js"
import type Timer from "../audiobus/timing/timer.js"
import { NOTE_ON } from "../../commands.js"

/**
 * Produces an array of notes from the 
 * @param data 
 * @returns 
 */
const createOpenDAWNotesScript = (data:AudioEvent[], timer:Timer ) => {
    const output:string[] = []
    data.forEach((command) => {
        switch( command.type )
        {
            case NOTE_ON :
                output.push( `{
                    position:${timer.secondsToTicks(command.startAt)},
                    pitch:${command.noteNumber},
                    velocity:${(command.velocity ?? 1)/127},
                    duration:${timer.secondsToTicks(command.duration)}
                }`)
                break
        }
    })
    return output
}

/**
 *  @param recording
 *  @param timer
 */
export const createOpenDAWProjectFromAudioEventRecording = async (recording:RecorderAudioEvent, timer:Timer ) => {

    const BPM:number = timer.BPM
    const duration:number = timer.secondsToTicks( recording.duration )
    const data:AudioEvent[] = recording.exportData()

    // openDAW script editor (very early preview - under heavy construction)
    const script:string = `
    // Paste into https://opendaw.studio/scripting
    
    const project = openDAW.newProject("${recording.name ?? "New Harmoneasy Project" }")
    project.bpm = ${BPM}
    project.output.volume = -6.0

    const notes = [${ createOpenDAWNotesScript(data, timer).join(",") }]
       
    project
        .addInstrumentUnit("Vaporisateur")
        .addNoteTrack()
        .addRegion({duration:${duration}, loopDuration: PPQN.Bar})
        .addEvents(notes)

    project.openInStudio()
    `

    return script
}