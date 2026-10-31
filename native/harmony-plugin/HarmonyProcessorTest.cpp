#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_osc/juce_osc.h>
#include <cstdlib>
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter();
static void check(bool condition) { if (!condition) std::abort(); }
int main() {
    juce::ScopedJuceInitialiser_GUI initialiser;
    std::unique_ptr<juce::AudioProcessor> plugin(createPluginFilter());
    auto parameter = [&](const juce::String& id) -> juce::RangedAudioParameter* {
        for (auto* p : plugin->getParameters()) if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(p)) if (ranged->getParameterID() == id) return ranged;
        std::abort();
    };
    auto set = [&](const juce::String& id, int value) { auto* p = parameter(id); p->setValueNotifyingHost(p->convertTo0to1(static_cast<float>(value))); };
    plugin->prepareToPlay(48000, 256);
    set("follow", 2);
    juce::AudioBuffer<float> audio(0, 256);
    juce::MidiBuffer events;
    events.addEvent(juce::MidiMessage::noteOn(1, 61, static_cast<juce::uint8>(100)), 12);
    plugin->processBlock(audio, events);
    check(events.getNumEvents() == 1);
    check((*events.begin()).getMessage().getNoteNumber() == 60);
    set("chord", 580);
    events.clear(); events.addEvent(juce::MidiMessage::noteOff(1, 61), 14);
    plugin->processBlock(audio, events);
    check(events.getNumEvents() == 1 && (*events.begin()).getMessage().getNoteNumber() == 60);
    set("root", 2); set("scale", 2774); set("bridge", 1);
    // Run the message loop to bind OSC, then store a browser harmonic project in the plugin.
    juce::OSCSender browser;
    browser.connect("127.0.0.1", 9123);
    const auto project = juce::String(R"({"version":1,"harmony":{"root":2,"scale":2774,"chord":580},"sections":[],"playSections":false})");
    for (int i = 0; i < 12; ++i) {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(20);
        browser.send("/harmoneasy/project", project);
    }
    juce::MessageManager::getInstance()->runDispatchLoopUntil(30);
    juce::MemoryBlock saved;
    plugin->getStateInformation(saved);
    set("root", 0); set("scale", 2741); set("chord", 145);
    plugin->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    check(juce::roundToInt(parameter("root")->convertFrom0to1(parameter("root")->getValue())) == 2);
    check(juce::roundToInt(parameter("scale")->convertFrom0to1(parameter("scale")->getValue())) == 2774);
    check(juce::roundToInt(parameter("chord")->convertFrom0to1(parameter("chord")->getValue())) == 580);
    // Project JSON survives host state serialization along with automatable parameters.
    juce::MemoryBlock recalled;
    plugin->getStateInformation(recalled);
    const auto bytes = juce::String::fromUTF8(static_cast<const char*>(recalled.getData()) + 8, static_cast<int>(recalled.getSize()) - 8);
    check(bytes.contains("sections"));
    plugin->releaseResources();
}
