// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomConnection, ROOM_PROTOCOL } from '../source/services/room-connection'

const mocks = vi.hoisted(() => ({ sessions: [] as any[] }))
vi.mock('netronome', () => ({ NetworkSession: class {
    peers = new Set<string>()
    constructor(_timer: unknown, readonly options: any) { mocks.sessions.push(this) }
    start = vi.fn(async () => {})
    destroy = vi.fn(async () => {})
    setTransport = vi.fn()
    receive = vi.fn()
    addPeer(id: string) { this.peers.add(id); this.options.onStateChange() }
    removePeer(id: string) { this.peers.delete(id) }
    getState() { return { bpm: 120, swing: 0, peers: [...this.peers].map(id => ({ id, locked: true, offsetMs: 0, rttMs: 20 })) } }
} }))

class Channel extends EventTarget {
    readyState = 'connecting'
    bufferedAmount = 0
    bufferedAmountLowThreshold = 0
    partner?: Channel
    send = vi.fn((data: string) => { queueMicrotask(() => this.partner?.dispatchEvent(new MessageEvent('message', { data }))) })
    close() {
        if (this.readyState === 'closed') return
        this.readyState = 'closed'
        this.dispatchEvent(new Event('close'))
        this.partner?.close()
    }
}

class Peer extends EventTarget {
    static all: Peer[] = []
    id = String(Peer.all.length)
    iceGatheringState = 'complete'
    connectionState = 'new'
    localDescription: any
    remoteDescription: any
    ondatachannel?: (event: { channel: Channel }) => void
    channel?: Channel
    constructor() { super(); Peer.all.push(this) }
    createDataChannel = vi.fn(() => this.channel = new Channel())
    async createOffer() { return { type: 'offer', sdp: this.id } }
    async createAnswer() { return { type: 'answer', sdp: this.id } }
    async setLocalDescription(description: any) { this.localDescription = { ...description, toJSON: () => description } }
    async setRemoteDescription(description: any) {
        this.remoteDescription = description
        if (description.type !== 'answer') return
        const remote = Peer.all[Number(description.sdp)]
        const channel = this.channel!
        const partner = remote.channel = new Channel()
        partner.partner = channel
        channel.partner = partner
        remote.ondatachannel?.({ channel: partner })
        channel.readyState = partner.readyState = 'open'
        channel.dispatchEvent(new Event('open'))
        partner.dispatchEvent(new Event('open'))
    }
    close() { this.connectionState = 'closed'; this.channel?.close() }
}

const connections: RoomConnection[] = []
const create = (role: 'leader' | 'follower') => {
    const connection = new RoomConnection({ BPM: 120, swing: 0 } as any, { role })
    connections.push(connection)
    return connection
}
const connect = async (host: RoomConnection, guest: RoomConnection) => {
    const offer = await host.createOfferBundle()
    await guest.applyOfferBundle(offer)
    const answer = await guest.createAnswerBundle()
    await host.applyAnswerBundle(answer)
    await Promise.resolve()
    await Promise.resolve()
    return { offer, answer }
}

beforeEach(() => { Peer.all = []; mocks.sessions.length = 0; vi.stubGlobal('RTCPeerConnection', Peer) })
afterEach(async () => { await Promise.all(connections.splice(0).map(connection => connection.destroy())) })

describe('serverless room connection', () => {
    it('pairs through offer/reply links and uses one shared clock for multiple players', async () => {
        const host = create('leader'), alice = create('follower'), bob = create('follower')
        const first = await connect(host, alice)
        const second = await connect(host, bob)
        expect(first.offer.protocol).toBe(ROOM_PROTOCOL)
        expect(second.offer.roomId).toBe(first.offer.roomId)
        expect(second.offer.connectionId).not.toBe(first.offer.connectionId)
        expect(mocks.sessions).toHaveLength(3)
        const hostClock = mocks.sessions.find(session => session.options.peerId === host.id)
        expect(hostClock.peers).toEqual(new Set([alice.id, bob.id]))
        await host.startSynchronized()
        expect(hostClock.setTransport).toHaveBeenLastCalledWith({ playing: true, position: 0 })
        host.broadcastTempoUpdate()
        expect(hostClock.setTransport).toHaveBeenLastCalledWith({ bpm: 120, swing: 0 })
        host.onTransportChange = vi.fn()
        hostClock.options.onTransport({ playing: false })
        expect(host.onTransportChange).toHaveBeenCalledOnce()
        expect((host as any).timer.isRunning).toBe(false)
    })

    it('transfers large workspaces in bounded frames and resumes after backpressure', async () => {
        const host = create('leader'), guest = create('follower')
        await connect(host, guest)
        guest.onData = vi.fn()
        const channel = Peer.all[0].channel!
        channel.send.mockClear()
        channel.bufferedAmount = 70000
        const message = { type: 'workspace', encoded: 'workspace:' + 'x'.repeat(100000) }
        host.sendData(guest.id, message)
        expect(channel.send).not.toHaveBeenCalled()
        channel.bufferedAmount = 0
        channel.dispatchEvent(new Event('bufferedamountlow'))
        await vi.waitFor(() => expect(guest.onData).toHaveBeenCalledExactlyOnceWith(host.id, message))
        expect(channel.send.mock.calls.every(([frame]) => frame.length < 32768)).toBe(true)
    })

    it('keeps connected peers when creating another invitation and rejects replies to the wrong offer', async () => {
        const host = create('leader'), guest = create('follower')
        const { answer } = await connect(host, guest)
        const live = Peer.all[0].channel!
        await host.createOfferBundle()
        expect(live.readyState).toBe('open')
        await expect(host.applyAnswerBundle({ ...answer, connectionId: 'wrong' })).rejects.toThrow('expired')
        await expect(host.applyAnswerBundle({ ...answer, roomId: 'wrong' })).rejects.toThrow('expired')
    })

    it('closes peer connections and releases clock ownership when destroyed', async () => {
        const host = create('leader'), guest = create('follower')
        await connect(host, guest)
        guest.onPeerClose = vi.fn()
        await host.destroy()
        expect(guest.onPeerClose).toHaveBeenCalledWith(host.id)
        expect(Peer.all.every(peer => peer.connectionState === 'closed')).toBe(true)
        expect(mocks.sessions[0].destroy).toHaveBeenCalled()
        expect(host.sendData(guest.id, {})).toBe(false)
    })
    it('keeps the first conductor until departure and hands over to the next connected player', async () => {
        const host = create('leader'), alice = create('follower'), bob = create('follower')
        await connect(host, alice)
        await connect(host, bob)
        await vi.waitFor(() => expect(alice.connectedPeerIds).toContain(bob.id))
        expect(host.role).toBe('leader')
        expect(alice.conductorId).toBe(host.id)
        expect(bob.conductorId).toBe(host.id)
        const roomId = host.roomId
        await host.destroy()
        await vi.waitFor(() => expect(alice.role).toBe('leader'))
        await vi.waitFor(() => expect(bob.conductorId).toBe(alice.id))
        expect(alice.roomId).toBe(roomId)
        expect(bob.roomId).toBe(roomId)
        expect(bob.role).toBe('follower')
        const received = vi.fn()
        bob.onData = received
        alice.sendData(bob.id, { type: 'still-playing' })
        await vi.waitFor(() => expect(received).toHaveBeenCalledWith(alice.id, { type: 'still-playing' }))
        const late = create('follower')
        await connect(alice, late)
        await vi.waitFor(() => expect(bob.connectedPeerIds).toContain(late.id))
        expect(alice.role).toBe('leader')
        expect(late.conductorId).toBe(alice.id)
        await alice.destroy()
        await vi.waitFor(() => expect(bob.role).toBe('leader'))
        await vi.waitFor(() => expect(late.conductorId).toBe(bob.id))
    })
})
