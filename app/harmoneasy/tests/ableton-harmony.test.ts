import { expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"

it("updates Live scale and tempo, retains held chord notes across tempo updates and handles custom scales", () => {
	const set = vi.fn(),
		outlet = vi.fn()
	const context = createContext({
		LiveAPI: function () {
			return { set }
		},
		outlet,
		arrayfromargs: (args: IArguments) => Array.from(args),
		messagename: "/harmoneasy/state"
	})
	runInContext(
		readFileSync(
			new URL("../../../native/ableton/harmoneasy-live.js", import.meta.url),
			"utf8"
		),
		context
	)
	runInContext("anything(2, 2774, 580, 130)", context)
	expect(set).toHaveBeenCalledWith("root_note", 2)
	expect(set).toHaveBeenCalledWith("scale_name", "Major")
	expect(set).toHaveBeenCalledWith("scale_mode", 1)
	expect(set).toHaveBeenCalledWith("tempo", 130)
	expect(outlet.mock.calls.filter(([port]) => port === 0)).toHaveLength(3)
	outlet.mockClear()
	runInContext("anything(2, 2774, 580, 131)", context)
	expect(outlet.mock.calls.filter(([port]) => port === 0)).toHaveLength(0)
	runInContext("anything(0, 3, 145, 120)", context)
	expect(set).toHaveBeenLastCalledWith("tempo", 120)
	expect(set).toHaveBeenCalledWith("scale_mode", 0)
	runInContext("release()", context)
	expect(outlet.mock.calls.filter(([port, note]) => port === 0 && note[1] === 0)).toHaveLength(6)
})