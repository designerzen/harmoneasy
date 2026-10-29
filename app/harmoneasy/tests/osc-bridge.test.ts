import { afterEach, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket, type Socket } from 'node:dgram'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { encodeOSC } from '../../../packages/audiobus/io/osc'
const { WebSocket } = createRequire(import.meta.url)('ws')
let child: ChildProcess | undefined
const sockets: Socket[] = []
let client: InstanceType<typeof WebSocket> | undefined
afterEach(async () => {
    client?.terminate(); client = undefined
    for (const socket of sockets.splice(0)) socket.close()
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    child = undefined
})

it('bridges binary OSC between a permitted WebSocket origin and loopback UDP in both directions', async () => {
    const receiver = createSocket('udp4'); sockets.push(receiver); receiver.bind(0, '127.0.0.1'); await once(receiver, 'listening')
    const sendPort = (receiver.address() as any).port
    const reserveUDP = createSocket('udp4'); reserveUDP.bind(0, '127.0.0.1'); await once(reserveUDP, 'listening')
    const receivePort = (reserveUDP.address() as any).port; reserveUDP.close()
    const reserveTCP = createServer(); reserveTCP.listen(0, '127.0.0.1'); await once(reserveTCP, 'listening')
    const wsPort = (reserveTCP.address() as any).port; await new Promise<void>(resolve => reserveTCP.close(() => resolve()))
    child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/osc-bridge.cjs', import.meta.url))], {
        env: { ...process.env, OSC_WS_PORT: String(wsPort), OSC_RECEIVE_PORT: String(receivePort), OSC_SEND_PORT: String(sendPort), OSC_ALLOWED_ORIGIN: 'http://localhost:1999' },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    await Promise.race([
        once(child.stdout!, 'data'),
        once(child, 'exit').then(([code]) => { throw new Error(`Bridge exited: ${code}`) }),
    ])
    const forbidden = new WebSocket(`ws://127.0.0.1:${wsPort}`, { origin: 'https://unrelated.example' })
    await expect(once(forbidden, 'open')).rejects.toThrow('401')
    client = new WebSocket(`ws://127.0.0.1:${wsPort}`, { origin: 'http://localhost:1999' })
    await once(client, 'open')
    const packet = encodeOSC({ address: '/harmoneasy/note/on', args: [60, 100, 1] })
    const receivedUDP = once(receiver, 'message'); client.send(packet)
    expect(new Uint8Array((await receivedUDP)[0])).toEqual(packet)
    const sender = createSocket('udp4'); sockets.push(sender)
    const receivedWS = once(client, 'message'); sender.send(packet, receivePort, '127.0.0.1')
    expect(new Uint8Array((await receivedWS)[0])).toEqual(packet)
}, 15000)
