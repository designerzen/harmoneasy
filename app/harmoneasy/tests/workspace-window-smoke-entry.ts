import "../source/assets/style/index.scss"
import "../source/assets/style/harmony.scss"
import IOChain from "audiobus/io/IO-chain"
import IOChainManager from "audiobus/io/IO-chain-manager"
import type { Timer } from "netronome"
import NoteTimelineVisualiser from "audiobus/ui/note-timeline-visualiser"
import { createGraph } from "../source/components/transformers-graph"

const context = new AudioContext()
const timer = { now: 0, BPM: 100, isRunning: true, divisions: 24 } as Timer
const manager = new IOChainManager({
	timer,
	audioContext: context,
	outputMixer: context.createGain()
})
manager.addChain(new IOChain(timer, { name: "Lead" }), "one")
manager.addChain(new IOChain(timer, { name: "Drums" }), "two")
const workspace = createGraph("graph", manager)
const timeline = new NoteTimelineVisualiser(
	document.getElementById("smoke-timeline") as HTMLCanvasElement
)
Object.assign(window, {
	windowSmoke: { manager, workspace, timeline, originalTrigger: manager.triggerHandler }
})