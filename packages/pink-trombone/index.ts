/**
 * @harmoneasy/pink-trombone
 * Pink Trombone speech synthesis integration for HarmonEasy
 */

export {
  PinkTrombone,
  PinkTromboneConfig,
} from './pink-trombone.js'

export {
  PinkTromboneWorkletProcessor,
} from './pink-trombone-worklet-processor.js'

export {
  PinkTromboneOutput,
} from './pink-trombone-output.ts'

export {
  createPinkTrombone,
  initializePinkTrombone,
} from './pink-trombone-factory.ts'

export type {
  VibratoParams,
  VocalTractParams,
  VowelParams,
  BreathingParams,
  Position,
  AutomationParams,
} from './pink-trombone-types.ts'
