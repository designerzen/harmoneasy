import React, { useEffect, useRef } from 'react'

// A device's createGui commonly returns one cached DOM element. Keep it mounted
// in one graph at a time; moving/deleting a chain must not destroy another view.
const views = new WeakMap<object, { hosts: Map<HTMLDivElement, boolean>; gui?: HTMLElement; loading?: Promise<void> }>()
export function DeviceGui({ device, expanded = false }: { device: any; expanded?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!device.createGui || !ref.current) return
        const host = ref.current
        let view = views.get(device)
        if (!view) views.set(device, view = { hosts: new Map() })
        view.hosts.set(host, expanded)
        const place = () => {
            const first = [...view.hosts].find(([, isExpanded]) => isExpanded)?.[0] ?? view.hosts.keys().next().value
            if (first && view.gui && view.gui.parentElement !== first) first.replaceChildren(view.gui)
            for (const item of view.hosts.keys()) {
                if (item !== first) item.textContent = 'Controls are shown in another view of this device.'
                else if (!view.gui) item.textContent = ''
            }
        }
        const release = () => {
            if (view.hosts.size || view.loading) return
            view.gui?.remove()
            view.gui = undefined
            views.delete(device)
            void Promise.resolve().then(() => device.destroyGui?.()).catch(error => {
                console.warn('Device controls cleanup failed', error)
            })
        }
        if (!view.gui && !view.loading) {
            view.loading = Promise.resolve().then(() => device.createGui()).then(gui => {
                view.gui = gui
                place()
            }).catch(error => { host.textContent = `Controls unavailable: ${String(error)}` }).finally(() => {
                view.loading = undefined
                release()
            })
        }
        place()
        return () => {
            view.hosts.delete(host)
            host.replaceChildren()
            place()
            queueMicrotask(release)
        }
    }, [device, expanded])
    return <div ref={ref} className="nodrag nowheel" />
}
