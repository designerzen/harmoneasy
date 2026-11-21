import React, { useEffect, useRef } from "react"
import { mountDeviceGui } from "./device-gui-views"

export function DeviceGui({ device, expanded = false }: { device: any; expanded?: boolean }) {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(
		() => (ref.current ? mountDeviceGui(device, ref.current, expanded) : undefined),
		[device, expanded]
	)
	return <div ref={ref} className="nodrag nowheel" />
}