import { afterEach, expect, it, vi } from "vitest"
import TransformerManager from "../../../packages/audiobus/io/transformer-manager-worker"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

afterEach(() => vi.unstubAllGlobals())

it("transforms live notes in arrival order without waiting for idle time", async () => {
	const idle = vi.fn()
	vi.stubGlobal("requestIdleCallback", idle)
	const manager = new TransformerManager([])
	const seen: string[] = []
	manager.setTransformers([
		{
			type: "test",
			transform: (commands) => {
				seen.push(commands[0].type)
				return commands.map((command) => ({ ...command, number: command.number + 12 }))
			},
			destroy() {}
		}
	] as any)
	const on = manager.transform([{ type: NOTE_ON, number: 60 }] as any, {} as any)
	const off = manager.transform([{ type: NOTE_OFF, number: 60 }] as any, {} as any)
	expect(seen).toEqual([NOTE_ON, NOTE_OFF])
	expect(idle).not.toHaveBeenCalled()
	expect((await on)[0].number).toBe(72)
	expect((await off)[0].number).toBe(72)
	manager.destroy()
})