#!/usr/bin/env node
// Reproduces the CI install check against what is committed, not the working tree.
// CI checks out HEAD with submodules at their recorded commits and runs
// `pnpm install --frozen-lockfile`, so uncommitted package.json edits (including
// inside submodules) must not be able to make the lockfile look valid locally.
// Run by the pre-push hook in .githooks; also usable as `pnpm run check:lockfile`.
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const gitBuffer = (args, cwd = root) => execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })

const ROOT_FILES = new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs"])
const wanted = (path) => ROOT_FILES.has(path) || path.startsWith("patches/") || path === "package.json" || path.endsWith("/package.json")

const errors = []
const files = [] // { path, cwd, rev }

const parseTree = (output) =>
	output
		.split("\0")
		.filter(Boolean)
		.map((line) => {
			const [meta, path] = line.split("\t")
			const [mode, type, sha] = meta.split(" ")
			return { mode, type, sha, path }
		})

for (const entry of parseTree(git(["ls-tree", "-r", "-z", "HEAD"]))) {
	if (entry.type === "commit") {
		// Submodule: CI checks out exactly this commit, so it must exist on its remote.
		const cwd = join(root, entry.path)
		let remoteRefs = ""
		try {
			remoteRefs = git(["branch", "-r", "--contains", entry.sha], cwd).trim()
		} catch {
			errors.push(`${entry.path}: recorded commit ${entry.sha.slice(0, 7)} is not available locally (run git submodule update).`)
			continue
		}
		if (!remoteRefs) {
			errors.push(`${entry.path}: recorded commit ${entry.sha.slice(0, 7)} is not pushed to the submodule's remote. Push the submodule first.`)
		}
		for (const sub of parseTree(git(["ls-tree", "-r", "-z", entry.sha], cwd))) {
			if (sub.type === "blob" && (sub.path === "package.json" || sub.path.endsWith("/package.json")) && !sub.path.includes("node_modules/")) {
				files.push({ path: `${entry.path}/${sub.path}`, cwd, rev: `${entry.sha}:${sub.path}` })
			}
		}
	} else if (entry.type === "blob" && wanted(entry.path) && !entry.path.includes("node_modules/")) {
		files.push({ path: entry.path, cwd: root, rev: `HEAD:${entry.path}` })
	}
}

const snapshot = mkdtempSync(join(tmpdir(), "lockfile-check-"))
let status = 0
try {
	for (const file of files) {
		const target = join(snapshot, file.path)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, gitBuffer(["show", file.rev], file.cwd))
	}
	try {
		execFileSync("pnpm", ["install", "--frozen-lockfile", "--lockfile-only", "--ignore-scripts", "--prefer-offline"], {
			cwd: snapshot,
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			shell: process.platform === "win32",
			env: { ...process.env, CI: "true" },
		})
	} catch (error) {
		errors.push(`pnpm-lock.yaml does not match the committed package.json files:\n${error.stdout ?? ""}${error.stderr ?? ""}`)
	}
} finally {
	rmSync(snapshot, { recursive: true, force: true })
}

if (errors.length) {
	console.error("\n✖ Lockfile check failed (this is what CI would hit):\n")
	for (const message of errors) console.error(`  - ${message}\n`)
	console.error("Commit the package.json changes (and push submodules), then run `pnpm install --lockfile-only` and commit pnpm-lock.yaml.\n")
	status = 1
} else {
	console.log("✓ Lockfile matches committed package.json files")
}
process.exit(status)
