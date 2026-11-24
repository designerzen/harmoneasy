import { readdir, readFile, stat } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { dirname, relative, resolve, sep } from "node:path"

const escape = (value) =>
	String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const json = (value) => JSON.stringify(value, null, 2)
const webPath = (value) => value.replaceAll("\\", "/")
const skip = new Set(["node_modules", "dist", "build", ".git", ".upstream"])

async function documentationFiles(directory) {
	const files = []
	for (const item of await readdir(directory, { withFileTypes: true })) {
		if (skip.has(item.name) || item.name.startsWith(".")) {
			continue
		}
		const path = resolve(directory, item.name)
		if (item.isDirectory()) {
			files.push(...(await documentationFiles(path)))
		} else if (/\.md$/i.test(item.name)) {
			files.push(path)
		}
	}
	return files.sort()
}

/** Publish package documentation from this checkout, including all recorded submodules. */
export async function packageDocumentationAssets(repository, base) {
	const assets = new Map()
	const gitmodules = await readFile(resolve(repository, ".gitmodules"), "utf8")
	const submodules = new Map()
	for (const section of gitmodules.split(/\[submodule [^\]]+\]/).slice(1)) {
		const path = section.match(/^\s*path\s*=\s*(.+)$/m)?.[1].trim()
		const url = section
			.match(/^\s*url\s*=\s*(.+)$/m)?.[1]
			.trim()
			.replace(/\.git$/, "")
		if (path && url) {
			submodules.set(path, url)
		}
	}
	const packages = []
	for (const directory of await readdir(resolve(repository, "packages"), {
		withFileTypes: true
	})) {
		if (!directory.isDirectory()) {
			continue
		}
		const folder = `packages/${directory.name}`
		const root = resolve(repository, folder)
		let manifest
		try {
			manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
		} catch (error) {
			if (error.code === "ENOENT") {
				continue
			}
			throw error
		}
		const documents = await documentationFiles(root)
		const readme = documents.find((path) => dirname(path) === root && /readme\.md$/i.test(path))
		if (!readme) {
			throw new Error(`Package needs a README: ${folder}`)
		}
		const submodule = submodules.has(folder)
		const gitRoot = submodule ? root : repository
		const commit = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], {
			encoding: "utf8"
		}).trim()
		const modified = Boolean(
			execFileSync("git", ["-C", root, "status", "--porcelain", "--", "."], {
				encoding: "utf8"
			}).trim()
		)
		packages.push({
			folder,
			name: manifest.name,
			version: manifest.version,
			description:
				manifest.description ??
				"Musical control descriptors, bindings and performance surfaces",
			submodule,
			repository: submodules.get(folder) ?? "https://github.com/designerzen/harmoneasy",
			commit,
			workingTreeModified: modified,
			exports: manifest.exports ?? { ".": manifest.main },
			scripts: manifest.scripts ?? {},
			dependencies: manifest.dependencies ?? {},
			readme,
			documents
		})
	}
	const sourceRepository = (path, directory = false) => {
		const local = webPath(relative(repository, path))
		const owner = packages.find(
			(pkg) => pkg.submodule && (local === pkg.folder || local.startsWith(pkg.folder + "/"))
		)
		const pkg = owner ?? packages.find((item) => !item.submodule)
		const sourcePath = owner ? local.slice(owner.folder.length + 1) : local
		return `${pkg.repository}/${directory ? "tree" : "blob"}/${pkg.commit}/${sourcePath}`
	}
	const published = new Set()
	const publish = async (path) => {
		const local = webPath(relative(repository, path))
		if (local === ".." || local.startsWith("../") || path === repository) {
			throw new Error(`Documentation path escapes repository: ${path}`)
		}
		const info = await stat(path)
		if (info.isDirectory()) {
			return sourceRepository(path, true)
		}
		// Images and binary artifacts remain linked to their repository, not decoded as text.
		if (
			!/\.(?:md|ts|js|mjs|cjs|json|txt|html|xml|css|scss|yaml|yml|toml|svg)$/i.test(path) &&
			!/^(?:LICENSE|NOTICE)(?:[-.].*)?$/.test(path.split(sep).at(-1))
		) {
			return sourceRepository(path)
		}
		const name = `docs/ai/source/${local}.txt`
		if (published.has(path)) {
			return base + name
		}
		published.add(path)
		let text = await readFile(path, "utf8")
		if (/\.md$/i.test(path)) {
			for (const match of [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]) {
				const target = match[1]
				if (/^(?:[a-z]+:|\/\/|#|\/)/i.test(target) || /[<>{}\s]/.test(target)) {
					continue
				}
				const destination = resolve(
					dirname(path),
					decodeURIComponent(target.split(/[?#]/)[0])
				)
				const owner = packages.find(
					(pkg) =>
						pkg.submodule && (local === pkg.folder || local.startsWith(pkg.folder + "/"))
				)
				const destLocal = webPath(relative(repository, destination))
				if (owner && !destLocal.startsWith(owner.folder + "/") && destLocal !== owner.folder) {
					continue
				}
				let url
				try {
					url = await publish(destination)
				} catch (error) {
					throw new Error(`Broken documentation link in ${local}: ${target}`, {
						cause: error
					})
				}
				text = text.replace(match[0], match[0].replace(`(${target})`, `(${url})`))
			}
		}
		assets.set(name, text)
		return base + name
	}
	for (const pkg of packages) {
		pkg.documents = await Promise.all(
			pkg.documents.map(async (path) => ({
				path: webPath(relative(repository, path)),
				url: await publish(path)
			}))
		)
		pkg.readme = pkg.documents.find(
			(document) => document.path === webPath(relative(repository, pkg.readme))
		).url
		pkg.manifest = await publish(resolve(repository, pkg.folder, "package.json"))
		pkg.url = `${base}docs/ai/packages/#${pkg.folder.slice(9)}`
	}
	const catalog = { version: 1, packages }
	assets.set("docs/ai/packages/index.json", json(catalog))
	const links = packages
		.map(
			(pkg) =>
				`<article id="${escape(pkg.folder.slice(9))}"><h2>${escape(pkg.name)}</h2><p>${escape(pkg.description)}</p><p>Version ${escape(pkg.version)} · ${pkg.submodule ? "Git submodule" : "Workspace package"} · commit <code>${escape(pkg.commit)}</code>${pkg.workingTreeModified ? " · includes local changes" : ""}</p><p><a href="${escape(pkg.readme)}">Read package documentation</a> · <a href="${escape(pkg.manifest)}">Package manifest</a> · <a href="${escape(pkg.repository)}">Repository</a></p><ul>${pkg.documents.map((doc) => `<li><a href="${escape(doc.url)}">${escape(doc.path.slice(pkg.folder.length + 1))}</a></li>`).join("")}</ul></article>`
		)
		.join("\n")
	assets.set(
		"docs/ai/packages/index.html",
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harmoneasy package documentation</title><style>body{max-width:70rem;margin:auto;padding:2rem;font:17px/1.6 system-ui}article{border-top:1px solid #8886;padding-block:1rem}code{overflow-wrap:anywhere}</style><a href="${escape(base)}docs/ai/">AI agent documentation</a><h1>Every packaged library and submodule</h1><p>Built from the checked-out package manifests and documentation. Versions, exports, commands and dependency names come from each manifest. A commit identifies provenance; local modifications are included in the served documentation and may not yet exist at the repository URL. Missing or incomplete APIs are described in the package READMEs.</p><p><a href="${escape(base)}docs/ai/packages/index.json">Package catalog JSON</a></p>${links}</html>`
	)
	return { assets, packages }
}