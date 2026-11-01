export interface LayoutWidget {
	span?: number
	height?: number
	column?: number
	sourceId?: string
	group?: string
	widget?: string
}
const GAP = 11
type Interval = { start: number; end: number }

export function playingLayout(availableWidth: number, screenWidth = availableWidth) {
	const visible = Math.max(1, Math.min(availableWidth, screenWidth))
	const hands = visible >= 640 ? 2 : 1
	const columns = hands === 2 ? (visible >= 1080 ? 6 : 4) : visible >= 340 ? 2 : 1
	return {
		hands,
		columns,
		zoneColumns: hands === 2 ? columns / 2 : columns,
		gutter: hands === 2 ? 24 : 0
	}
}

/** Merge touching reservations so long columns remain cheap to search. */
function occupy(occupied: Interval[], start: number, end: number): void {
	const last = occupied.at(-1)
	if (!last || last.end < start) {
		occupied.push({ start, end })
		return
	}
	if (last.end === start) {
		last.end = end
		return
	}
	let low = 0,
		high = occupied.length
	while (low < high) {
		const middle = (low + high) >>> 1
		if (occupied[middle].end < start) {
			low = middle + 1
		} else {
			high = middle
		}
	}
	const first = low
	while (low < occupied.length && occupied[low].start <= end) {
		start = Math.min(start, occupied[low].start)
		end = Math.max(end, occupied[low].end)
		low++
	}
	occupied.splice(first, low - first, { start, end })
}

/** Find the first common free vertical interval; smaller gadgets can fill earlier holes. */
function fit(columns: Interval[][], column: number, span: number, height: number): number {
	const cursors = Array(span).fill(0)
	let y = 0
	for (;;) {
		let next = y
		for (let offset = 0; offset < span; offset++) {
			const occupied = columns[column + offset]
			while (cursors[offset] < occupied.length && occupied[cursors[offset]].end <= y) {
				cursors[offset]++
			}
			const interval = occupied[cursors[offset]]
			if (interval && interval.start < y + height) {
				next = Math.max(next, interval.end)
			}
		}
		if (next === y) {
			return y
		}
		y = next
	}
}

/** Deterministic column packing. Every footprint is reserved before the next gadget is placed. */
export function layoutWidgets(
	widgets: LayoutWidget[],
	availableWidth: number,
	screenWidth = availableWidth,
	pageHeight = Infinity,
	scale = 1
) {
	const gap = GAP / Math.max(0.01, Math.min(1, scale))
	const width = Number.isFinite(availableWidth) ? Math.max(1, availableWidth) : 640
	const profile = playingLayout(width, screenWidth),
		count = profile.columns,
		cell = (width - profile.gutter) / count
	const limit = Number.isFinite(pageHeight) ? Math.max(1, pageHeight) : Infinity
	const pages: Interval[][][] = [Array.from({ length: count }, () => [])]
	const items = widgets.map((widget) => {
		const span = Math.max(1, Math.min(count, Math.round(widget.span ?? 1)))
		const height = Math.min(
			limit,
			Math.max(
				132,
				44 / Math.max(0.01, scale),
				["piano-roll", "guitar-tab"].includes(widget.widget ?? "")
					? 46 + 99 / scale
					: ["xy", "range", "relative-keys", "strum"].includes(widget.widget ?? "")
						? 80 + 99 / scale
						: 132,
				Math.min(720, widget.height ?? 172)
			)
		)
		let column = 0,
			y = Infinity
		const preferred =
			widget.column === undefined
				? undefined
				: Math.max(0, Math.min(count - span, Math.round(widget.column)))
		let page = 0
		for (;;) {
			const columns = pages[page] ?? (pages[page] = Array.from({ length: count }, () => []))
			y = Infinity
			for (let candidate = 0; candidate <= count - span; candidate++) {
				if (preferred !== undefined && candidate !== preferred) {
					continue
				}
				if (
					preferred === undefined &&
					profile.hands === 2 &&
					span <= profile.zoneColumns &&
					candidate < profile.zoneColumns &&
					candidate + span > profile.zoneColumns
				) {
					continue
				}
				const top = fit(columns, candidate, span, height + gap)
				if (top < y) {
					y = top
					column = candidate
				}
			}
			if (y + height <= limit) {
				break
			}
			page++
		}
		const columns = pages[page]
		for (let offset = 0; offset < span; offset++) {
			occupy(columns[column + offset], y, y + height + gap)
		}
		return {
			page,
			x:
				column * cell +
				(profile.hands === 2 && column >= profile.zoneColumns ? profile.gutter : 0),
			y,
			width: Math.max(
				1,
				cell * span +
					(profile.hands === 2 &&
					column < profile.zoneColumns &&
					column + span > profile.zoneColumns
						? profile.gutter
						: 0) -
					Math.min(gap, width / 2)
			),
			height
		}
	})
	return {
		items,
		pages: pages.length,
		height: Math.min(
			limit,
			widgets.length
				? Math.max(
						...pages.flatMap((columns) =>
							columns.map((column) => column.at(-1)?.end ?? 0)
						)
					)
				: 120
		)
	}
}

/** Compare compactness, distance between related controls, and reach to musical playing zones. */
export function ergonomicOrder(
	widgets: LayoutWidget[],
	width: number,
	screenWidth = width,
	pageHeight = Infinity
): number[] {
	const profile = playingLayout(width, screenWidth)
	const indices = widgets.map((_, index) => index)
	const groups = new Map<string, number>()
	const group = (index: number) =>
		`${widgets[index].sourceId ?? ""}\u0000${widgets[index].group ?? ""}`
	indices.forEach((index) => {
		const id = group(index)
		if (!groups.has(id)) {
			groups.set(id, groups.size)
		}
	})
	const area = (index: number) => (widgets[index].span ?? 1) * (widgets[index].height ?? 172)
	const candidates = [
		indices,
		[...indices].sort((a, b) => groups.get(group(a))! - groups.get(group(b))! || a - b),
		[...indices].sort(
			(a, b) => groups.get(group(a))! - groups.get(group(b))! || area(b) - area(a) || a - b
		),
		[...indices].sort((a, b) => area(b) - area(a) || a - b),
		[...indices].sort(
			(a, b) =>
				(widgets[b].span ?? 1) - (widgets[a].span ?? 1) ||
				(widgets[b].height ?? 172) - (widgets[a].height ?? 172) ||
				a - b
		)
	]
	const score = (order: number[]) => {
		const layout = layoutWidgets(
			order.map((index) => ({ ...widgets[index], column: undefined })),
			width,
			screenWidth,
			pageHeight
		)
		const bounds = new Map<
			string,
			{ left: number; top: number; right: number; bottom: number }
		>()
		let reach = 0,
			playable = 0
		order.forEach((index, i) => {
			const rect = layout.items[i],
				id = group(index),
				previous = bounds.get(id)
			bounds.set(id, {
				left: Math.min(previous?.left ?? Infinity, rect.x),
				top: Math.min(previous?.top ?? Infinity, rect.y),
				right: Math.max(previous?.right ?? 0, rect.x + rect.width),
				bottom: Math.max(previous?.bottom ?? 0, rect.y + rect.height)
			})
			if (
				["piano-roll", "guitar-tab", "relative-keys", "strum", "pad", "xy"].includes(
					widgets[index].widget ?? ""
				)
			) {
				reach +=
					(profile.hands === 2
						? Math.min(
								Math.abs(rect.x + rect.width / 2 - width * 0.25),
								Math.abs(rect.x + rect.width / 2 - width * 0.75)
							)
						: Math.abs(rect.x + rect.width / 2 - width / 2)) +
					layout.height -
					rect.y -
					rect.height / 2
				playable++
			}
		})
		const spread =
			Array.from(bounds.values()).reduce(
				(sum, box) => sum + box.right - box.left + box.bottom - box.top,
				0
			) / Math.max(1, bounds.size)
		return {
			height: layout.pages * (Number.isFinite(pageHeight) ? pageHeight : 0) + layout.height,
			travel: spread * 0.15 + (reach / Math.max(1, playable)) * 0.08
		}
	}
	let best = indices,
		bestScore = score(indices)
	for (const candidate of candidates.slice(1)) {
		const next = score(candidate)
		if (
			next.height < bestScore.height ||
			(next.height === bestScore.height && next.travel < bestScore.travel)
		) {
			best = candidate
			bestScore = next
		}
	}
	return best
}