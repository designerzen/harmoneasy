import {getHost, startHost, getWclap} from "./wclap-js/wclap.mjs";
import {hostImports, startThreadWorker} from "./host-imports.mjs";
import CBOR from "./cbor.mjs";

// Resolve bundled UIs even when a plugin reports a stale/invalid VFS prefix.
// Keep the longest unambiguous suffix, then use a canonical URL for imports.
export function resolveFilePath(files, path) {
	try { path = decodeURIComponent(path.replace(/[?#].*/, '')); } catch {}
	if (files[path]) return path;
	let suffix = path;
	while (suffix.includes('/')) {
		suffix = suffix.slice(suffix.indexOf('/') + 1);
		if (!suffix) break;
		let matches = Object.keys(files).filter(key => key.endsWith('/' + suffix));
		if (matches.length === 1) return matches[0];
	}
	return path;
}

export default class ClapAudioNode {
	#moduleAddedToAudioContext = Symbol();

	static #routingId = Symbol();
	static #timerSharedArrayBuffer;
	static #hostConfigPromise;
	#ready;
	
	constructor(wclapOptions) {
		if (typeof wclapOptions === 'string') wclapOptions = {url: wclapOptions};
		wclapOptions.url = new URL(wclapOptions.url, document.baseURI).href;

		// Load configs and start host/WCLAP
		if (!ClapAudioNode.#hostConfigPromise) {
			ClapAudioNode.#hostConfigPromise = getHost(new URL("./host.wasm", import.meta.url).href);
		}
		this.#ready = (async (hostConfigPromise, wclapConfigPromise) => {
			// We *could* have a common host across all WCLAP modules, but then we'd need to figure out when to de-register them
			let host = await startHost(await hostConfigPromise, hostImports());
			let wclapConfig = await wclapConfigPromise;
			let api = host.hostInstance.exports;
			return {
				host: host,
				api: api,
				bytesPtr: api.createBytes(),
				wclapConfig: wclapConfig,
				files: wclapConfig.files // TODO: we use this for `.getFiles()` but actually that should use the WASI VFS which these are loaded into
			};
		})(ClapAudioNode.#hostConfigPromise, getWclap(wclapOptions));
		
		// Optional timer thread to get more accurate CPU measurements
		if (globalThis.crossOriginIsolated && wclapOptions?.timerWorklet && !ClapAudioNode.#timerSharedArrayBuffer) {
			let workerJs = new Blob([`this.onmessage = e => {`,
				`console.log("CLAP AudioNode performance timer starting");`,
				`let dv = new DataView(e.data);`,
				`while (1) dv.setFloat64(0, performance.now());`,
			`};`], {type: 'application/javascript'});
			let worker = new Worker(URL.createObjectURL(workerJs), {name: "CLAP AudioNode performance timer"});
			let buffer = ClapAudioNode.#timerSharedArrayBuffer = new SharedArrayBuffer(8);
			new DataView(buffer).setFloat64(0, performance.now());
			worker.postMessage(buffer);
		}
	}
	
	async plugins() {
		let {host, api, wclapConfig, bytesPtr} = await this.#ready;
		// distinct copy - we're going to register and run it independently of the processor to inspect the plugin list
		wclapConfig = await getWclap(wclapConfig);

		let wclap = await host.startWclap(wclapConfig);
		let hostedPtr = api.makeHosted(wclap.ptr); // this specific host's wrapper around an `Instance *`
		if (!hostedPtr) throw Error("Failed to start WCLAP");

		let decodeCbor = _ => {
			let cborPtr = api.getBytesData(bytesPtr);
			let cborLength = api.getBytesLength(bytesPtr);

			// Have to copy because the TextDecoder doesn't like shared buffers
			let bytes = new Uint8Array(host.hostMemory.buffer).slice(cborPtr, cborPtr + cborLength);
			return CBOR.decode(bytes);
		};
		
		let info = decodeCbor(api.getInfo(hostedPtr, bytesPtr));
		api.removeHosted(hostedPtr);
		
		console.log(info);
		return info.plugins;
	}
	
	async createNode(audioContext, pluginId, nodeOptions) {
		if (!nodeOptions && typeof pluginId === 'object') { // optional argument
			nodeOptions = pluginId;
			pluginId = null;
		}
		nodeOptions = nodeOptions || {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
		};

		// Add the AudioWorkletProcessor module
		if (!audioContext[this.#moduleAddedToAudioContext]) {
			let moduleUrl = new URL('./clap-audioworkletprocessor.mjs', import.meta.url);
			await audioContext.audioWorklet.addModule(moduleUrl);
		}
		audioContext[this.#moduleAddedToAudioContext] = true;

		let {host, wclapConfig, files} = await this.#ready;
		nodeOptions.processorOptions = {
			// These provide enough information for the processor to load the module and start the plugin
			host: host.initObj(),
			wclap: wclapConfig,
			pluginId: pluginId
		};

		let effectNode = new AudioWorkletNode(audioContext, 'audioworkletprocessor-clap', nodeOptions);

		// Connect to timer worker, if running
		if (ClapAudioNode.#timerSharedArrayBuffer) {
			effectNode.port.postMessage(["timer-sharedArrayBuffer", ClapAudioNode.#timerSharedArrayBuffer]);
		}

		let responseMap = Object.create(null);
		let idCounter = 0;
		function addRemoteMethod(name) {
			effectNode[name] = (...args) => {
				let requestId = idCounter++;

				effectNode.port.postMessage([requestId, name, args]);

				return new Promise((pass, fail) => {
					responseMap[requestId] = {m_pass: pass, m_fail: fail};
				});
			};
		}

		effectNode.getFile = async path => {
			return files[resolveFilePath(files, path)];
		};

		// Hacky event-handling: add a named function to this map
		effectNode.events = Object.create(null);
		
		function handleWorkerMessage(data) {
			if (data?.[0] == 'thread-worker') return startThreadWorker(host, wclapConfig, data[1]);
			return false;
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { effectNode.disconnect(); effectNode.port.close(); reject(Error('WebCLAP initialization timed out')); }, 30000);
			effectNode.port.onmessage = e => {
				if (handleWorkerMessage(e.data)) return;
				clearTimeout(timer);
				if (e.data.initialError) { effectNode.disconnect(); effectNode.port.close(); reject(Error(e.data.initialError)); return; }
				let {routingId, desc, methods, webview} = e.data;
				if (/^file:/.test(webview)) {
					let path = webview.replace(/^file:\/*/, '/');
					webview = 'file://' + resolveFilePath(files, path);
				}
				effectNode[ClapAudioNode.#routingId] = routingId;
				effectNode.descriptor = desc;
				methods.forEach(addRemoteMethod);
				// For [dis]connectEvents, replace the other node with its ID
				effectNode.connectEvents = (prevMethod => otherNode => {
					if (otherNode[ClapAudioNode.#routingId] != null) {
						return prevMethod(otherNode[ClapAudioNode.#routingId]);
					}
				})(effectNode.connectEvents);
				effectNode.disconnectEvents = (prevMethod => nodeOrNull => {
					return prevMethod(nodeOrNull?.[ClapAudioNode.#routingId]);
				})(effectNode.disconnectEvents);

				let prevGetResource = effectNode.getResource;
				effectNode.getResource = async path => {
					let obj = await prevGetResource(path);
					if (!obj) return null;
					// Can't construct Blob in the AudioWorklet, so we translate it here
					return new Blob([obj.bytes], {type: obj.type});
				};

				let iframe = null;

				effectNode.port.onmessage = e => {
					if (handleWorkerMessage(e.data)) return;
					let data = e.data;
					if (data instanceof ArrayBuffer) {
						// it's a message from the plugin to the UI
						if (iframe) iframe.contentWindow.postMessage(data, '*');
						return;
					}
					if (typeof data[0] === 'string') {
						// it's an event - call a handler if there is one
						let handler = effectNode.events[data[0]];
						if (handler) {
							handler(data[1]);
						} else {
							console.error("unhandled event:", ...data);
						}
						return;
					}
					let response = responseMap[data[0]];
					if (!response) return;
					delete responseMap[data[0]];
					if (data[1]) {
						response.m_fail(data[1]);
					} else {
						response.m_pass(data[2]);
					}
				};

				if (webview) {
					let messageHandler = e => {
						if (e.source === iframe?.contentWindow) {
							let data = e.data;
							if (!(data instanceof ArrayBuffer)) throw Error("messages must be ArrayBuffers");
							effectNode.port.postMessage(data);
						}
					};
					let visibilityHandler;
					effectNode.openInterface = (uiOptions) => {
						iframe = document.createElement('iframe');
						window.addEventListener('message', messageHandler);
						window.addEventListener('visibilitychange', visibilityHandler = () => {
							effectNode.webviewOpen(true, !document.hidden);
						});
						let src = webview;
						if (/^file:/.test(src) && uiOptions?.filePrefix) {
							src = uiOptions.filePrefix + webview.replace(/^file:\/*/, '/');
						} else if (src[0] == "/" && uiOptions?.resourcePrefix) {
							src = uiOptions.resourcePrefix + webview;
						}
						iframe.src = new URL(src, document.baseURI);
						effectNode.webviewOpen(true, !document.hidden);
						return iframe;
					};
					effectNode.closeInterface = () => {
						effectNode.webviewOpen(false);
						if (iframe) {
							window.removeEventListener('message', messageHandler);
							window.removeEventListener('visibilitychange', visibilityHandler);
						}
						iframe = null;
					}
				}

				let prevConnect = effectNode.connect;
				effectNode.connect = function() {
					effectNode.resume();
					prevConnect.apply(this, arguments);
				};

				resolve(effectNode);
			};
		});
	}
}
