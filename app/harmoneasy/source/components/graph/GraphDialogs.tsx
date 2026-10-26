import { useEffect, useRef } from 'react'
import { useChain } from './ChainContext'
import { createDeviceDialog, createTransformerDialog } from './DeviceDialog'

// Graph nodes launch native dialogs; React never renders their contents.
export function DeviceDialog(props: Parameters<typeof createDeviceDialog>[1]) {
	const context = useChain()
	const onClose = useRef(props.onClose)
	onClose.current = props.onClose
	useEffect(() => {
		const view = createDeviceDialog(context, { ...props, onClose: () => onClose.current() })
		return () => view.destroy()
	}, [context.chain, context.manager, props.direction, props.replacing])
	return null
}
export function TransformerDialog(props: Parameters<typeof createTransformerDialog>[1]) {
	const context = useChain()
	const onClose = useRef(props.onClose)
	onClose.current = props.onClose
	useEffect(() => {
		const view = createTransformerDialog(context, { ...props, onClose: () => onClose.current() })
		return () => view.destroy()
	}, [context.chain, context.manager, props.replacing])
	return null
}