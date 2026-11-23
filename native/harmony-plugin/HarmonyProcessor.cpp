#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_osc/juce_osc.h>
#include "HarmonyCore.h"

// Link mode: DAW MIDI and transport go to HarmonEasy through the local OSC bridge,
// and the notes HarmonEasy plays come back as this plugin's MIDI output.
struct LinkEvent { enum Kind : int { noteOn, noteOff, cc, pitch, clock, start, resume, stop } kind = noteOn; int a = 0, b = 0, channel = 1; };
// Single producer, single consumer: the audio thread on one side, an OSC thread on the other.
class LinkQueue {
public:
    bool push(const LinkEvent& event) noexcept {
        if (fifo.getFreeSpace() < 1) return false;
        const auto scope = fifo.write(1);
        events[static_cast<size_t>(scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)] = event;
        return true;
    }
    template <typename Visit> void drain(Visit&& visit) {
        const auto scope = fifo.read(fifo.getNumReady());
        for (int i = 0; i < scope.blockSize1; ++i) visit(events[static_cast<size_t>(scope.startIndex1 + i)]);
        for (int i = 0; i < scope.blockSize2; ++i) visit(events[static_cast<size_t>(scope.startIndex2 + i)]);
    }
private:
    static constexpr int capacity = 4096;
    juce::AbstractFifo fifo { capacity };
    std::array<LinkEvent, capacity> events {};
};
class LinkSender final : public juce::Thread {
public:
    explicit LinkSender(LinkQueue& source) : juce::Thread("Harmoneasy link"), queue(source) {}
    ~LinkSender() override { stopThread(1000); }
    void run() override {
        sender.connect("127.0.0.1", 9124);
        while (!threadShouldExit()) {
            wait(20);
            queue.drain([this](const LinkEvent& event) { send(event); });
        }
    }
private:
    LinkQueue& queue;
    juce::OSCSender sender;
    void send(const LinkEvent& event) {
        switch (event.kind) {
            case LinkEvent::noteOn: sender.send("/harmoneasy/note/on", event.a, event.b, event.channel); break;
            case LinkEvent::noteOff: sender.send("/harmoneasy/note/off", event.a, event.channel); break;
            case LinkEvent::cc: sender.send("/harmoneasy/cc", event.a, event.b, event.channel); break;
            case LinkEvent::pitch: sender.send("/harmoneasy/pitch", event.a, event.channel); break;
            case LinkEvent::clock: sender.send("/harmoneasy/clock"); break;
            case LinkEvent::start: sender.send("/harmoneasy/start"); break;
            case LinkEvent::resume: sender.send("/harmoneasy/continue"); break;
            case LinkEvent::stop: sender.send("/harmoneasy/stop"); break;
        }
    }
};

class HarmonyProcessor final : public juce::AudioProcessor,
    private juce::Timer, private juce::OSCReceiver::Listener<juce::OSCReceiver::MessageLoopCallback> {
public:
    HarmonyProcessor() : AudioProcessor(BusesProperties()), parameters(*this, nullptr, "Harmony", layout()) {
        receiver.addListener(this);
        receiver.addListener(&notes);
        sender.connect("127.0.0.1", 9124);
        linkSender.startThread();
        startTimerHz(20);
    }
    ~HarmonyProcessor() override {
        stopTimer(); linkSender.stopThread(1000);
        receiver.removeListener(this); receiver.removeListener(&notes); receiver.disconnect();
    }
    const juce::String getName() const override { return "Harmoneasy Harmony"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return true; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void prepareToPlay(double rate, int maximumBlockSize) override {
        sampleRate = rate; mapping.reset(); clock.reset(); linkHeld = {};
        transformed.ensureSize(juce::jmax(16384, maximumBlockSize * 64));
    }
    void releaseResources() override { mapping.reset(); clock.reset(); linkHeld = {}; }
    bool isBusesLayoutSupported(const BusesLayout& buses) const override { return buses.inputBuses.isEmpty() && buses.outputBuses.isEmpty(); }
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
    void processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) override {
        juce::ScopedNoDenormals noDenormals;
        audio.clear(); transformed.clear();
        bool playing = false; double ppq = 0, bpm = hostBpm.load();
        if (auto* playhead = getPlayHead()) if (auto position = playhead->getPosition()) {
            if (auto hostTempo = position->getBpm()) { bpm = *hostTempo; hostBpm.store(static_cast<float>(bpm)); }
            if (auto hostPpq = position->getPpqPosition()) { ppq = *hostPpq; playing = position->getIsPlaying(); }
        }
        const bool open = bridgeOpen.load();
        sendClock(open && value("clock") != 0, playing, ppq, ppq + audio.getNumSamples() / sampleRate * bpm / 60.0);
        const bool link = open && value("link") != 0;
        if (panic.exchange(false)) panicAll(0);
        if (linkActive.exchange(link) && !link) releaseLinked(0);
        if (link) { linkBlock(midi); return; }
        incoming.drain([](const LinkEvent&) {}); // Never replay notes queued before the link closed.
        const int mode = value("follow");
        const int mask = mode == 0 ? 4095 : value(mode == 1 ? "scale" : "chord");
        for (const auto metadata : midi) {
            auto message = metadata.getMessage();
            const int channel = message.getChannel();
            if (message.isAllNotesOff() || message.isAllSoundOff() || message.isResetAllControllers()) {
                panicAll(metadata.samplePosition);
                transformed.addEvent(message, metadata.samplePosition);
            } else if (message.isNoteOn()) {
                const int target = mapping.attack(channel - 1, message.getNoteNumber(), mask);
                if (target == -3) panicAll(metadata.samplePosition);
                else if (target >= 0) { message.setNoteNumber(target); transformed.addEvent(message, metadata.samplePosition); }
            } else if (message.isNoteOff()) {
                const int target = mapping.release(channel - 1, message.getNoteNumber());
                if (target >= 0) { message.setNoteNumber(target); transformed.addEvent(message, metadata.samplePosition); }
            } else transformed.addEvent(message, metadata.samplePosition);
        }
        midi.swapWith(transformed);
    }
    void getStateInformation(juce::MemoryBlock& destination) override {
        auto state = parameters.copyState();
        if (auto xml = state.createXml()) copyXmlToBinary(*xml, destination);
    }
    void setStateInformation(const void* data, int bytes) override {
        if (auto xml = getXmlFromBinary(data, bytes)) {
            auto state = juce::ValueTree::fromXml(*xml);
            if (state.hasType("Harmony")) { parameters.replaceState(state); panic.store(true); recalled.store(true); }
        }
    }
private:
    juce::AudioProcessorValueTreeState parameters;
    juce::OSCReceiver receiver;
    std::unique_ptr<juce::DatagramSocket> bridgeSocket;
    juce::OSCSender sender;
    // Receives the notes HarmonEasy plays on the OSC thread, without waiting for the message loop.
    struct NoteReceiver final : juce::OSCReceiver::Listener<juce::OSCReceiver::RealtimeCallback> {
        HarmonyProcessor& owner;
        explicit NoteReceiver(HarmonyProcessor& processor) : owner(processor) {}
        void oscMessageReceived(const juce::OSCMessage& message) override { owner.linkMessage(message); }
    } notes { *this };
    LinkQueue outgoing, incoming;
    LinkSender linkSender { outgoing };
    harmoneasy::TransportClock clock;
    std::array<std::array<bool, 128>, 16> linkHeld {};
    std::atomic<bool> bridgeOpen {false}, linkActive {false};
    double sampleRate = 44100;
    harmoneasy::MidiHarmony mapping;
    juce::MidiBuffer transformed;
    std::atomic<float> hostBpm {120};
    std::atomic<bool> panic {false}, recalled {false};
    bool connected = false;
    juce::String lastState;
    static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
        juce::AudioProcessorValueTreeState::ParameterLayout result;
        result.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID("root", 1), "Tonic (C = 0)", 0, 11, 0));
        result.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID("scale", 1), "Scale mask (C = bit 0)", 0, 4095, 2741));
        result.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID("chord", 1), "Chord mask (C = bit 0)", 0, 4095, 145));
        result.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID("follow", 1), "Follow", juce::StringArray { "Pass through", "Scale", "Chord" }, 1));
        result.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID("bridge", 1), "Enable local bridge (one instance)", false));
        result.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID("link", 1), "Process notes in HarmonEasy", false));
        result.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID("clock", 1), "Send DAW transport as clock", false));
        return result;
    }
    int value(const char* id) const { return juce::roundToInt(parameters.getRawParameterValue(id)->load()); }
    void set(const char* id, int number) {
        if (auto* parameter = parameters.getParameter(id)) {
            parameter->beginChangeGesture(); parameter->setValueNotifyingHost(parameter->convertTo0to1(static_cast<float>(number))); parameter->endChangeGesture();
        }
    }
    void panicAll(int at) {
        for (int channel = 1; channel <= 16; ++channel) {
            transformed.addEvent(juce::MidiMessage::controllerEvent(channel, 64, 0), at);
            transformed.addEvent(juce::MidiMessage::allNotesOff(channel), at);
        }
        mapping.reset();
        linkHeld = {};
    }
    void sendClock(bool enabled, bool playing, double ppq, double ppqEnd) {
        if (!enabled) {
            if (clock.playing && outgoing.push({ LinkEvent::stop })) linkSender.notify();
            clock.reset();
            return;
        }
        bool pushed = false;
        clock.advance(playing, ppq, ppqEnd, [&](harmoneasy::ClockEvent event) {
            constexpr LinkEvent::Kind kinds[] { LinkEvent::start, LinkEvent::resume, LinkEvent::stop, LinkEvent::clock };
            pushed = outgoing.push({ kinds[static_cast<int>(event)] }) || pushed;
        });
        if (pushed) linkSender.notify();
    }
    // Notes, controllers and pitch bend go to HarmonEasy; everything else passes through.
    void linkBlock(juce::MidiBuffer& midi) {
        bool pushed = false;
        for (const auto metadata : midi) {
            const auto message = metadata.getMessage();
            const int channel = message.getChannel();
            LinkEvent event;
            if (message.isNoteOn()) event = { LinkEvent::noteOn, message.getNoteNumber(), message.getVelocity(), channel };
            else if (message.isNoteOff()) event = { LinkEvent::noteOff, message.getNoteNumber(), 0, channel };
            else if (message.isController()) event = { LinkEvent::cc, message.getControllerNumber(), message.getControllerValue(), channel };
            else if (message.isPitchWheel()) event = { LinkEvent::pitch, message.getPitchWheelValue(), 0, channel };
            else { transformed.addEvent(message, metadata.samplePosition); continue; }
            pushed = outgoing.push(event) || pushed;
        }
        if (pushed) linkSender.notify();
        // Returned events land at the block start: the round trip is never sample accurate.
        incoming.drain([this](const LinkEvent& event) {
            auto& held = linkHeld[static_cast<size_t>(event.channel - 1)][static_cast<size_t>(event.a & 127)];
            switch (event.kind) {
                case LinkEvent::noteOn: held = true; transformed.addEvent(juce::MidiMessage::noteOn(event.channel, event.a, static_cast<juce::uint8>(event.b)), 0); break;
                case LinkEvent::noteOff: held = false; transformed.addEvent(juce::MidiMessage::noteOff(event.channel, event.a), 0); break;
                case LinkEvent::cc: transformed.addEvent(juce::MidiMessage::controllerEvent(event.channel, event.a, event.b), 0); break;
                case LinkEvent::pitch: transformed.addEvent(juce::MidiMessage::pitchWheel(event.channel, event.a), 0); break;
                default: break;
            }
        });
        midi.swapWith(transformed);
    }
    void releaseLinked(int at) {
        for (int channel = 0; channel < 16; ++channel)
            for (int note = 0; note < 128; ++note)
                if (linkHeld[static_cast<size_t>(channel)][static_cast<size_t>(note)]) transformed.addEvent(juce::MidiMessage::noteOff(channel + 1, note), at);
        linkHeld = {};
    }
    // OSC thread: validate what HarmonEasy plays and queue it for the next block.
    void linkMessage(const juce::OSCMessage& message) {
        if (!linkActive.load()) return;
        const auto address = message.getAddressPattern().toString();
        auto integer = [&](int index, int low, int high, int& out) {
            if (index >= message.size()) return false;
            const auto& argument = message[index];
            if (argument.isInt32()) out = argument.getInt32();
            else if (argument.isFloat32() && std::isfinite(argument.getFloat32())) out = juce::roundToInt(argument.getFloat32());
            else return false;
            return out >= low && out <= high;
        };
        LinkEvent event;
        if (address == "/harmoneasy/note/on" && message.size() == 3 && integer(0, 0, 127, event.a) && integer(1, 0, 127, event.b) && integer(2, 1, 16, event.channel))
            event.kind = event.b > 0 ? LinkEvent::noteOn : LinkEvent::noteOff;
        else if (address == "/harmoneasy/note/off" && message.size() == 2 && integer(0, 0, 127, event.a) && integer(1, 1, 16, event.channel))
            event.kind = LinkEvent::noteOff;
        else if (address == "/harmoneasy/cc" && message.size() == 3 && integer(0, 0, 127, event.a) && integer(1, 0, 127, event.b) && integer(2, 1, 16, event.channel))
            event.kind = LinkEvent::cc;
        else if (address == "/harmoneasy/pitch" && message.size() == 2 && integer(0, 0, 16383, event.a) && integer(1, 1, 16, event.channel))
            event.kind = LinkEvent::pitch;
        else return;
        incoming.push(event);
    }
    void sendState() {
        sender.send("/harmoneasy/state", value("root"), value("scale"), value("chord"), hostBpm.load());
    }
    void sendProject() {
        auto project = juce::JSON::parse(parameters.state.getProperty("project").toString());
        if (auto* object = project.getDynamicObject()) {
            auto* harmony = new juce::DynamicObject();
            harmony->setProperty("root", value("root")); harmony->setProperty("scale", value("scale")); harmony->setProperty("chord", value("chord"));
            object->setProperty("harmony", juce::var(harmony));
            sender.send("/harmoneasy/project", juce::JSON::toString(project, true));
        }
        sendState();
    }
    void timerCallback() override {
        if (value("bridge") != 0 && !connected) {
            bridgeSocket = std::make_unique<juce::DatagramSocket>(false);
            connected = bridgeSocket->bindToPort(9123, "127.0.0.1") && receiver.connectToSocket(*bridgeSocket);
            if (!connected) bridgeSocket.reset();
        } else if (value("bridge") == 0 && connected) { receiver.disconnect(); bridgeSocket.reset(); connected = false; }
        bridgeOpen.store(connected);
        if (!connected) return;
        const auto signature = juce::String(value("root")) + ":" + juce::String(value("scale")) + ":" + juce::String(value("chord")) + ":" + juce::String(hostBpm.load());
        if (signature != lastState) { lastState = signature; sendState(); }
        if (recalled.exchange(false)) sendProject();
    }
    void oscMessageReceived(const juce::OSCMessage& message) override {
        const auto address = message.getAddressPattern().toString();
        if (address == "/harmoneasy/request") { sendProject(); return; }
        if (address == "/harmoneasy/state" && message.size() >= 3 && message[0].isInt32() && message[1].isInt32() && message[2].isInt32()) {
            const auto root = message[0].getInt32(), scale = message[1].getInt32(), chord = message[2].getInt32();
            if (root < 0 || root > 11 || scale < 0 || scale > 4095 || chord < 0 || chord > 4095) return;
            set("root", root); set("scale", scale); set("chord", chord);
            return;
        }
        if (address == "/harmoneasy/project" && message.size() == 1 && message[0].isString() && message[0].getString().length() <= 48000) {
            const auto text = message[0].getString();
            const auto project = juce::JSON::parse(text);
            if (project.isObject() && static_cast<int>(project["version"]) == 1) parameters.state.setProperty("project", text, nullptr);
        }
    }
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new HarmonyProcessor(); }
