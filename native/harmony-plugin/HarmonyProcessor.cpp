#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_osc/juce_osc.h>
#include "HarmonyCore.h"

class HarmonyProcessor final : public juce::AudioProcessor,
    private juce::Timer, private juce::OSCReceiver::Listener<juce::OSCReceiver::MessageLoopCallback> {
public:
    HarmonyProcessor() : AudioProcessor(BusesProperties()), parameters(*this, nullptr, "Harmony", layout()) {
        receiver.addListener(this);
        sender.connect("127.0.0.1", 9124);
        startTimerHz(20);
    }
    ~HarmonyProcessor() override { stopTimer(); receiver.removeListener(this); receiver.disconnect(); }
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
    void prepareToPlay(double, int maximumBlockSize) override { mapping.reset(); transformed.ensureSize(juce::jmax(16384, maximumBlockSize * 64)); }
    void releaseResources() override { mapping.reset(); }
    bool isBusesLayoutSupported(const BusesLayout& buses) const override { return buses.inputBuses.isEmpty() && buses.outputBuses.isEmpty(); }
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
    void processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) override {
        juce::ScopedNoDenormals noDenormals;
        audio.clear(); transformed.clear();
        if (auto* playhead = getPlayHead()) if (auto position = playhead->getPosition()) {
            if (auto bpm = position->getBpm()) hostBpm.store(static_cast<float>(*bpm));
        }
        const int mode = value("follow");
        const int mask = mode == 0 ? 4095 : value(mode == 1 ? "scale" : "chord");
        if (panic.exchange(false)) panicAll(0);
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
