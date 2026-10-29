import React from "react"

export function ElementIcon({
	src,
	title,
	className = ""
}: {
	src: string
	title: string
	className?: string
}) {
	return (
		<span
			className={`element-icon ${className}`.trim()}
			aria-hidden="true"
			title={title}
			style={{ maskImage: `url("${src}")` }}
		/>
	)
}