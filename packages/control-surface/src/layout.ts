export interface LayoutWidget {
	span?: number
	height?: number
	column?: number
	sourceId?: string
	group?: string
	widget?: string
	/** Default sizes may compact to avoid an unnecessary page; explicit sizes stay preferred. */
	flexible?: boolean
}
const GAP = 11
type Interval = { start: number; end: number }
type Rect = { x: number; y: number; width: number; height: number }
type Minimums = ReadonlyMap<Rect, { width: number; height: number }>

/** Dynamic programming finds feasible row/column cuts; spare area is shared by weight. */
function partitionSpace(items: Rect[], bounds: Rect, gap: number, minimums: Minimums): boolean {
	let best: Rect[] | undefined,
		bestScore = Infinity
	for (const axis of ["y", "x"] as const) {
		const size = axis === "y" ? "height" : "width"
		const cross = axis === "y" ? "x" : "y"
		const crossSize = axis === "y" ? "width" : "height"
		for (const order of [
			items,
			[...items].sort((a, b) => a[axis] - b[axis] || a[cross] - b[cross])
		]) {
			const cost = Array<number>(order.length + 1).fill(Infinity)
			const previous = Array<number>(order.length + 1).fill(-1)
			cost[0] = 0
			for (let end = 1; end <= order.length; end++) {
				let across = 0,
					along = 0
				for (let start = end - 1; start >= 0; start--) {
					const minimum = minimums.get(order[start])!
					across += minimum[crossSize] + (start === end - 1 ? 0 : gap)
					if (across > bounds[crossSize] + 0.001) {
						break
					}
					along = Math.max(along, minimum[size])
					const next = cost[start] + along + (start ? gap : 0)
					if (next < cost[end]) {
						cost[end] = next
						previous[end] = start
					}
				}
			}
			if (cost[order.length] > bounds[size] + 0.001) {
				continue
			}
			const groups: Rect[][] = []
			for (let end = order.length; end > 0; ) {
				const start = previous[end]
				groups.unshift(order.slice(start, end))
				end = start
			}
			const allocate = (length: number, minimum: number[], weight: number[]) => {
				const spare = Math.max(
					0,
					length - gap * (minimum.length - 1) - minimum.reduce((sum, n) => sum + n, 0)
				)
				const total = weight.reduce((sum, n) => sum + n, 0)
				return minimum.map((n, i) => n + (spare * weight[i]) / total)
			}
			const extents = allocate(
				bounds[size],
				groups.map((group) => Math.max(...group.map((item) => minimums.get(item)![size]))),
				groups.map((group) => Math.max(...group.map((item) => item[size])))
			)
			const result = new Map<Rect, Rect>()
			let position = bounds[axis]
			groups.forEach((group, i) => {
				const sizes = allocate(
					bounds[crossSize],
					group.map((item) => minimums.get(item)![crossSize]),
					group.map((item) => item[crossSize])
				)
				let across = bounds[cross]
				group.forEach((item, j) => {
					result.set(item, {
						...bounds,
						[axis]: position,
						[size]: extents[i],
						[cross]: across,
						[crossSize]: sizes[j]
					})
					across += sizes[j] + gap
				})
				position += extents[i] + gap
			})
			const rectangles = items.map((item) => result.get(item)!)
			const score = rectangles.reduce(
				(sum, rect, i) =>
					sum +
					Math.log(rect.width / rect.height / (items[i].width / items[i].height)) ** 2,
				0
			)
			if (score < bestScore) {
				bestScore = score
				best = rectangles
			}
		}
	}
	if (!best) {
		return false
	}
	items.forEach((item, i) => Object.assign(item, best![i]))
	return true
}

/** One target needs 44 physical pixels; compound controls also reserve their rows and gaps. */
export function minimumWidgetHeight(widget = "", scale = 1): number {
	return Math.max(
		44 / scale,
		["piano-roll", "guitar-tab"].includes(widget)
			? 46 + 99 / scale
			: ["xy", "range", "relative-keys", "strum"].includes(widget)
				? 80 + 99 / scale
				: widget === "radio"
					? 132
					: 44 / scale
	)
}

/** Stretch independent rows/columns while keeping gutters fixed, rather than scaling the gaps. */
function fillSpace(
	items: Rect[],
	bounds: Rect,
	gap: number,
	handGutter: number,
	minimums: Minimums
): boolean {
	if (items.length === 1) {
		const minimum = minimums.get(items[0])!
		if (bounds.width + 0.000001 < minimum.width || bounds.height + 0.000001 < minimum.height) {
			return false
		}
		Object.assign(items[0], bounds)
		return true
	}
	for (const axis of ["y", "x"] as const) {
		const size = axis === "x" ? "width" : "height"
		const sorted = [...items].sort((a, b) => a[axis] - b[axis])
		const groups: { items: Rect[]; start: number; end: number }[] = []
		for (const item of sorted) {
			const last = groups.at(-1)
			if (!last || item[axis] >= last.end - 0.001) {
				groups.push({ items: [item], start: item[axis], end: item[axis] + item[size] })
			} else {
				last.items.push(item)
				last.end = Math.max(last.end, item[axis] + item[size])
			}
		}
		if (groups.length < 2) {
			continue
		}
		const distribute = (parts: typeof groups, start: number, length: number) => {
			const weight = parts.reduce((sum, group) => sum + group.end - group.start, 0)
			const room = length - gap * (parts.length - 1)
			let position = start
			for (const group of parts) {
				const extent = (room * (group.end - group.start)) / weight
				if (
					!fillSpace(
						group.items,
						{ ...bounds, [axis]: position, [size]: extent },
						gap,
						axis === "y" ? handGutter : 0,
						minimums
					)
				) {
					return false
				}
				position += extent + gap
			}
			return true
		}
		if (axis === "x" && handGutter > 0) {
			// Keep two reachable hand zones when both groups can fit without shrinking.
			const half = (bounds.width - handGutter) / 2
			let split = 0,
				best = Infinity
			for (let i = 1; i < groups.length; i++) {
				const left =
					groups.slice(0, i).reduce((sum, group) => sum + group.end - group.start, 0) +
					gap * (i - 1)
				const right =
					groups.slice(i).reduce((sum, group) => sum + group.end - group.start, 0) +
					gap * (groups.length - i - 1)
				if (
					left <= half + 0.001 &&
					right <= half + 0.001 &&
					Math.abs(left - right) < best
				) {
					split = i
					best = Math.abs(left - right)
				}
			}
			if (split) {
				return (
					(distribute(groups.slice(0, split), bounds.x, half) &&
						distribute(groups.slice(split), bounds.x + half + handGutter, half)) ||
					partitionSpace(items, bounds, gap, minimums)
				)
			}
		}
		return (
			distribute(groups, bounds[axis], bounds[size]) ||
			partitionSpace(items, bounds, gap, minimums)
		)
	}
	// An interlocked floorplan needs new cuts, not growth around its central hole.
	return partitionSpace(items, bounds, gap, minimums)
}

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
): { items: (Rect & { page: number })[]; pages: number; height: number } {
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
				minimumWidgetHeight(widget.widget, Math.max(0.01, scale)),
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
	let pageCount = pages.length
	if (Number.isFinite(limit) && items.length) {
		if (pages.length > 1 && widgets.some((widget) => widget.flexible)) {
			const compact = layoutWidgets(
				widgets.map((widget) => ({
					...widget,
					height: widget.flexible
						? minimumWidgetHeight(widget.widget, scale)
						: widget.height,
					flexible: false
				})),
				width,
				screenWidth,
				limit,
				scale
			)
			if (compact.pages < pages.length) {
				return compact
			}
		}
		const minimums = new Map(
			items.map((item, i) => [
				item,
				{
					width: item.width,
					height: Math.min(limit, minimumWidgetHeight(widgets[i].widget, scale))
				}
			])
		)
		const bounds = { x: 0, y: 0, width, height: limit }
		for (let page = 0; page < pages.length; page++) {
			const group = items.filter((item) => item.page === page)
			if (
				!fillSpace(
					group,
					bounds,
					gap,
					profile.hands === 2 ? Math.max(gap, profile.gutter) : 0,
					minimums
				)
			) {
				// If the target minima cannot form a slicing floorplan on this page,
				// paginate rather than leave holes or shrink an interactive target.
				group.forEach((item, i) =>
					Object.assign(item, bounds, { page: i ? pageCount++ : page })
				)
			}
		}
	}
	return {
		items,
		pages: pageCount,
		height:
			Number.isFinite(limit) && items.length
				? limit
				: Math.min(
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