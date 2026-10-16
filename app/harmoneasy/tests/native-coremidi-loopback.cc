// Temporary CoreMIDI MIDI 2.0 endpoints used by the Electron loopback test.
#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <iostream>
#include <string>

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    MIDIClientRef client = 0;
    MIDIEndpointRef source = 0, destination = 0;
    CFStringRef name = CFStringCreateWithCString(nullptr, argv[1], kCFStringEncodingUTF8);
    if (!name || MIDIClientCreate(name, nullptr, nullptr, &client)) return 2;
    if (MIDISourceCreateWithProtocol(client, name, kMIDIProtocol_2_0, &source)) return 3;
    if (MIDIDestinationCreateWithProtocol(client, name, kMIDIProtocol_2_0, &destination,
        ^(const MIDIEventList* events, void*) { MIDIReceivedEventList(source, events); })) return 4;
    std::cout << "ready" << std::endl;
    std::string line;
    std::getline(std::cin, line);
    MIDIEndpointDispose(destination);
    MIDIEndpointDispose(source);
    MIDIClientDispose(client);
    CFRelease(name);
    return 0;
}
