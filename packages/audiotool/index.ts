/**
 * audiotool
 * AudioTool SDK integration for HarmonEasy
 */

// TODO: Implement AudioToolIntegration and AudioToolConfig
// export {
//   AudioToolIntegration,
//   AudioToolConfig,
// } from './audio-tool-connect.ts'

// TODO: Implement AudioToolIO and AudioToolIOConfig
// export {
//   AudioToolIO,
//   AudioToolIOConfig,
// } from './audio-tool-io.ts'

// TODO: Implement AudioToolSettings and AudioToolSettingsConfig
// export {
//   AudioToolSettings,
//   AudioToolSettingsConfig,
// } from './audio-tool-settings.ts'

export {
  createAudioToolProjectFromAudioEventRecording,
  lazyLoadAutioToolSDK,
  checkAudioToolUserStatus,
  connectAndAuthoriseAudioTool,
} from './adapter-audiotool-audio-events-recording.ts'

// TODO: Create audiotool-types.ts with AudioToolProject, AudioToolTrack, AudioToolEvent
// export type {
//   AudioToolProject,
//   AudioToolTrack,
//   AudioToolEvent,
// } from './audiotool-types.ts'

