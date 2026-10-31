cmake_minimum_required(VERSION 3.22)
project(HarmoneasyHarmony VERSION 0.1.0 LANGUAGES C CXX)
include(FetchContent)
FetchContent_Declare(JUCE
    URL https://github.com/juce-framework/JUCE/archive/refs/tags/8.0.9.tar.gz
    URL_HASH SHA256=5203f2509d7bf0a907f89dcc40ecbf875b44102aa86f0acf2003d2a633078450
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(JUCE)
set(HARMONEASY_FORMATS VST3)
if(APPLE)
    list(APPEND HARMONEASY_FORMATS AU)
endif()
juce_add_plugin(HarmoneasyHarmony
    COMPANY_NAME Harmoneasy
    PLUGIN_MANUFACTURER_CODE Hmey
    PLUGIN_CODE Hmhr
    FORMATS ${HARMONEASY_FORMATS}
    PRODUCT_NAME "Harmoneasy Harmony"
    IS_MIDI_EFFECT TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    VST3_CATEGORIES Fx Tools
    AU_MAIN_TYPE kAudioUnitType_MIDIProcessor
    COPY_PLUGIN_AFTER_BUILD FALSE)
target_sources(HarmoneasyHarmony PRIVATE HarmonyProcessor.cpp)
target_compile_features(HarmoneasyHarmony PRIVATE cxx_std_17)
target_compile_definitions(HarmoneasyHarmony PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(HarmoneasyHarmony PRIVATE juce::juce_audio_utils juce::juce_osc
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
include(CTest)
if(BUILD_TESTING)
    add_executable(harmony_core_test HarmonyCoreTest.cpp)
    target_compile_features(harmony_core_test PRIVATE cxx_std_17)
    add_test(NAME harmony_core COMMAND harmony_core_test)
    juce_add_console_app(HarmonyProcessorTest PRODUCT_NAME "Harmoneasy processor tests")
    target_sources(HarmonyProcessorTest PRIVATE HarmonyProcessorTest.cpp)
    target_compile_definitions(HarmonyProcessorTest PRIVATE JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(HarmonyProcessorTest PRIVATE HarmoneasyHarmony juce::juce_audio_utils juce::juce_osc)
    add_test(NAME harmony_processor COMMAND HarmonyProcessorTest)
endif()
