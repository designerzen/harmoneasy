export function createAssetWorker(archives) {
	return {
		async fetch(request, env) {
			const url = new URL(request.url)
			const archive = archives[url.pathname]
			if (!archive) {
				return env.ASSETS.fetch(request)
			}
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method not allowed", {
					status: 405,
					headers: { Allow: "GET, HEAD" }
				})
			}
			const headers = {
				"Content-Type": "application/gzip",
				"Cache-Control": "public, max-age=0, must-revalidate",
				"Cross-Origin-Resource-Policy": "cross-origin",
				ETag: archive.etag
			}
			if (request.headers.get("If-None-Match") === archive.etag) {
				return new Response(null, { status: 304, headers })
			}
			if (request.method === "HEAD") {
				return new Response(null, {
					headers: { ...headers, "Content-Length": String(archive.size) }
				})
			}
			// Fetch parts through ASSETS, bypassing Worker routing and client Range headers.
			const load = async (path) => {
				const response = await env.ASSETS.fetch(new Request(new URL(path, url)))
				if (!response.ok || !response.body) {
					throw new Error(`Archive part unavailable: ${path}`)
				}
				return response.body.getReader()
			}
			let reader
			try {
				reader = await load(archive.parts[0])
			} catch {
				return new Response("Archive unavailable", { status: 502 })
			}
			let index = 0
			const body = new ReadableStream({
				async pull(controller) {
					try {
						while (true) {
							const { done, value } = await reader.read()
							if (!done) {
								controller.enqueue(value)
								return
							}
							reader.releaseLock()
							if (++index === archive.parts.length) {
								controller.close()
								return
							}
							reader = await load(archive.parts[index])
						}
					} catch (error) {
						controller.error(error)
					}
				},
				cancel(reason) {
					return reader.cancel(reason)
				}
			})
			return new Response(body, { headers })
		}
	}
}