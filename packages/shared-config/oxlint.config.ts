import { defineConfig } from "oxlint"

export default defineConfig({
	plugins: ["jsx-a11y"],
	env: {
		browser: true,
		es2024: true,
		node: true
	},
	rules: {
		"jsx-a11y/alt-text": "error",
		"jsx-a11y/aria-props": "error",
		"jsx-a11y/aria-role": "error",
		"jsx-a11y/aria-unsupported-elements": "error",
		"jsx-a11y/heading-has-content": "error",
		"jsx-a11y/label-has-associated-control": "warn",
		"jsx-a11y/no-redundant-roles": "warn",
		"jsx-a11y/role-has-required-aria-props": "error",
		"jsx-a11y/role-supports-aria-props": "error",
		"no-debugger": "warn",
		"no-constant-condition": "warn",
		"no-empty": "warn",
		"no-extra-boolean-cast": "warn",
		"no-loss-of-precision": "warn",
		"no-obj-calls": "error",
		"no-regex-spaces": "warn",
		"no-sparse-arrays": "warn",
		"no-unexpected-multiline": "error",
		"use-isnan": "error",
		curly: ["error", "all"],
		eqeqeq: ["warn", "always", { null: "ignore" }],
		"typescript/no-this-alias": [
			"warn",
			{ allowedNames: ["vis", "head", "tail", "worker", "node"] }
		],
		"no-var": "error",
		"prefer-const": ["warn", { destructuring: "any" }],
		"prefer-arrow-callback": "warn"
	},
	// Oxfmt owns layout, quotes, indentation, and the prohibition on trailing semicolons.
	ignorePatterns: [
		"**/node_modules/**",
		"**/dist*/**",
		"**/build/**",
		"**/release/**",
		"**/out/**",
		"**/coverage/**",
		"**/.turbo/**",
		"**/public/**",
		"**/netronome/**",
		"**/wam/yoshimi/**",
		"**/sion/sion/**",
		"**/*.min.js",
		"**/*.d.ts"
	]
})