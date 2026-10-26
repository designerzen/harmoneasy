import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { expect, it } from 'vitest'

const source = resolve(import.meta.dirname, '../source')
function files(path: string): string[] {
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? files(resolve(path, entry.name))
			: /\.[cm]?[jt]sx?$/.test(entry.name)
				? [resolve(path, entry.name)]
				: [],
	)
}
it('restricts React imports to graph rendering and its node integration', () => {
	const allowed = new Set([
		'components/transformers-graph.tsx',
		'components/graph/Graph.tsx',
		'components/graph/GraphControls.tsx',
		'components/graph/ChainContext.tsx',
		'components/graph/GraphDialogs.tsx',
		'components/graph/AnimatedSVGEdge.tsx',
		'components/graph/DeviceGui.tsx',
		'components/graph/DeviceTitleBar.tsx',
		'components/graph/ElementIcon.tsx',
		'components/graph/MinimiseButton.tsx',
		'components/graph/NodeHeader.tsx',
		'components/graph/Widgets.tsx',
		'components/graph/layout.ts',
		'components/graph/nodes/AddTransformerNode.tsx',
		'components/graph/nodes/EndNode.tsx',
		'components/graph/nodes/InputNode.tsx',
		'components/graph/nodes/OutputNode.tsx',
		'components/graph/nodes/StartNode.tsx',
		'components/graph/nodes/TransformerNode.tsx',
	])
	const violations = files(source)
		.filter((file) =>
			/(?:from\s*|import\s*\(|import\s*)['"](?:react(?:-dom)?(?:\/[^'"]*)?|@xyflow\/react(?:\/[^'"]*)?)['"]/.test(
				readFileSync(file, 'utf8'),
			),
		)
		.map((file) => relative(source, file).replaceAll('\\', '/'))
		.filter((file) => !allowed.has(file))
	expect(violations).toEqual([])
})