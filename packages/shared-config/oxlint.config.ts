import { defineConfig } from "oxlint"

export default defineConfig({
	env: {
		browser: true,
		es2024: true,
		node: true
	},
	rules: {
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