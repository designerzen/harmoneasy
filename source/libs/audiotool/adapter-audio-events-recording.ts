import { RecorderAudioEvent } from "../audiobus/recorder-audio-event"
import { createAudiotoolClient } from "@audiotool/nexus"
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"
import { STORAGE_KEYS } from '../audiotool/audio-tool-settings.js'


export const createAudioToolProjectFromAudioEventRecording = async (recording:RecorderAudioEvent) => {
    const data = recording.exportData()

    // Create synced document
    const nexus = await client.createSyncedDocument({
      mode: "online",
      project: projectUrl
    })

    const devices = nexus.queryEntities.ofTypes("tonematrix").get();

    if (devices.length === 0) {
      throw Error('No devices found. Create a tonematrix first!')
    }

    
    const result = await nexus.modify((t) => {
      // Create a note track
      const noteTrack = t.create("noteTrack", {
        orderAmongTracks: 0,
        player: device.location,
      })

      // Add a note region
      const noteRegion = t.create("noteRegion", {
        track: noteTrack.location,
        region: {
          positionTicks: 15360, // One 1/4 note in a 4/4 bar
          durationTicks: 15360 * 4,
        }
      })

    // create notes
    const note = await nexus.modify((t) => {
      return t.create("note", {
        noteCollection: noteCollection.location,
        pitch: 60 + Math.floor(Math.random() * 24), // C4 to B5
        positionTicks: Math.floor(Math.random() * 15360 * 4), // Random position in 4 bars
        durationTicks: 960, // Quarter note
        velocity: 0.7,
        slide: false
      });
    });
}