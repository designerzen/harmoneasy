import { Handle, Position } from "@xyflow/react"
import React, { memo, useCallback } from "react"
 
/**
 * ConfigField component - memoized to prevent unnecessary re-renders
 */
export const ConfigField = memo(function ConfigField({ config, element }) {
	const handleChange = useCallback((v) => {
		element.setConfig(config.name, v.target.value)
	}, [config.name, element])

	return <label>{config.name}
		{ config.type === 'select' ? <SelectField values={config.values} defaultValue={config.default} onChange={handleChange} /> : 'unknown' }
	</label>
	
}, (prevProps, nextProps) => {
	// Only re-render if config values changed
	return (
		prevProps.config.name === nextProps.config.name &&
		prevProps.config.default === nextProps.config.default &&
		(prevProps.config.values?.length ?? 0) === (nextProps.config.values?.length ?? 0) &&
		prevProps.element === nextProps.element
	)
})
/**
 * SelectField component - memoized to prevent unnecessary re-renders
 * GAH React is so crap it doesn't allow modern html already landed in browsers
 */
export const SelectField = memo(function SelectField({ values, onChange, defaultValue }) {
	return <select suppressHydrationWarning={true} defaultValue={defaultValue ?? ''}>
		<button className="btn-select">
			<selectedcontent></selectedcontent>
		</button>

		{values.map((v) => {
			const isObject = typeof v === 'object' && v !== null
			const value = isObject ? v.value : v
			const name = isObject ? v.name : v
			return ( <option 
				onClick={() => onChange({ target: { value } })}
				key={value} 
				value={value}>
					{name}
				</option>)
		})}
	</select>
}, (prevProps, nextProps) => {
	// Custom comparison: only re-render if values, onChange, or defaultValue change
	return (
		prevProps.defaultValue === nextProps.defaultValue &&
		prevProps.values.length === nextProps.values.length &&
		prevProps.values.every((v, i) => {
			const curr = nextProps.values[i]
			const prevVal = typeof v === 'object' ? v.value : v
			const currVal = typeof curr === 'object' ? curr.value : curr
			return prevVal === currVal
		})
	)
})
