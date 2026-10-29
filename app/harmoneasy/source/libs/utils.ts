/**
 * Get from the linear function of points a and b,
 * the value of the parameter at time t.
 * @param a
 * @param b
 * @param t
 * @returns
 */
export const getXFromY = (
	a: { value: number; time: number },
	b: { value: number; time: number },
	t: number
) => {
	const gradient = (b.value - a.value) / (b.time - a.time)
	const intercept = b.value - gradient * b.time
	return gradient * t + intercept
}

/**
 *
 * @param points
 * @param _minValue
 * @param _maxValue
 * @param defValue
 * @param duration
 * @param step
 * @returns
 */
export const normalizePoints = (
	points: any[],
	_minValue: any,
	_maxValue: any,
	defValue: any,
	duration: number,
	step: number
) => {
	// If there is no point defined by the users.
	if (points.length === 0) {
		points.push({ value: defValue, time: 0 })
	}
	const firstPoint = points[0]
	const lastPoint = points[points.length - 1]

	// If the first user point isn't set at the beginning of the audio.
	if (firstPoint.time !== 0) {
		points.unshift({ value: defValue, time: 0 })
	}
	// If the last user point isn't set at the end of the audio.
	if (lastPoint.time !== duration) {
		points.push({ value: lastPoint.value, time: duration })
	}

	const normalizedPoints = []
	let pointIndex = 0
	for (let t = 0; t < duration; t += step) {
		if (t > points[pointIndex + 1].time) {
			pointIndex++
		}
		let valueAtT = getXFromY(points[pointIndex], points[pointIndex + 1], t)
		// If the current point is at the same time that the previous value, set to the previous value...
		if (isNaN(valueAtT)) {
			valueAtT = normalizedPoints[normalizedPoints.length - 1].value
		}
		normalizedPoints.push({ value: valueAtT, time: t })
	}
	// Add the last point.
	normalizedPoints.push(points[pointIndex + 1])
	return normalizedPoints
}