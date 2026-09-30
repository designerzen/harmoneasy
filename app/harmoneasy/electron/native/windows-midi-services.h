#pragma once
// Windows MIDI Services COM ABI declarations. No redistributable SDK or MIDI library.
// Interface contracts: microsoft/MIDI, rc-4, src/api/idl/WindowsMidiServices.idl
// https://github.com/microsoft/MIDI/blob/d1d274a67102c28a94b6a96d262f7071d5ee7281/src/api/idl/WindowsMidiServices.idl
#include <windows.h>
#include <unknwn.h>
#include <wrl/client.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devpkey.h>
#include <functional>
#include <mutex>
#include <map>
#include <vector>
#include <string>
#include <atomic>

namespace wms {
using Microsoft::WRL::ComPtr;
struct CreationParams { UINT messageOptions; UINT dataFormat; GUID callingComponent; };
struct __declspec(uuid("EA264200-3328-49E5-8815-73649A8748BE")) Transport : IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Activate(REFIID, void**) = 0;
};
struct __declspec(uuid("4D6A29E5-DF4F-4A2D-A923-9B23B3F2D6F6")) Callback : IUnknown {
    virtual HRESULT STDMETHODCALLTYPE OnMessage(UINT, PVOID, UINT, LONGLONG, LONGLONG) = 0;
};
struct __declspec(uuid("B89BBB45-7001-4BEA-BBD8-C7CC26E7836C")) Bidirectional : IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Initialize(LPCWSTR, CreationParams*, DWORD*, Callback*, LONGLONG, GUID) = 0;
    virtual HRESULT STDMETHODCALLTYPE Shutdown() = 0;
    virtual HRESULT STDMETHODCALLTYPE SendMidiMessage(UINT, PVOID, UINT, LONGLONG) = 0;
};
struct __declspec(uuid("194C2746-3AE5-419A-94D9-20416C7DBEFE")) SessionTracker : IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Initialize() = 0;
    virtual HRESULT STDMETHODCALLTYPE AddClientSession(GUID, LPCWSTR) = 0;
    virtual HRESULT STDMETHODCALLTYPE UpdateClientSessionName(GUID, LPCWSTR) = 0;
    virtual HRESULT STDMETHODCALLTYPE RemoveClientSession(GUID) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetSessionList(LPWSTR*) = 0;
    virtual HRESULT STDMETHODCALLTYPE Shutdown() = 0;
    virtual BOOL STDMETHODCALLTYPE VerifyConnectivity() = 0;
};
inline constexpr GUID transportClass{0x2ba15e4e,0x5417,0x4a66,{0x85,0xb8,0x2b,0x22,0x60,0xef,0xbc,0x84}};
inline constexpr GUID endpointClass{0xe7cce071,0x3c03,0x423f,{0x88,0xd3,0xf1,0x04,0x5d,0x02,0x55,0x2b}};
inline constexpr GUID propertyClass{0x3f114a6a,0x11fa,0x4bd0,{0x9d,0x2c,0x6b,0x77,0x80,0xcd,0x80,0xad}};
using Receive = std::function<void(const uint32_t*, size_t, uint64_t)>;
struct Endpoint { uint32_t index; std::wstring id; std::string name; bool midi2; uint32_t purpose; };

inline std::vector<BYTE> property(const std::wstring& id, const DEVPROPKEY& key, DEVPROPTYPE expected) {
    ULONG size = 0; DEVPROPTYPE type;
    if (CM_Get_Device_Interface_PropertyW(id.c_str(), &key, &type, nullptr, &size, 0) != CR_BUFFER_SMALL || type != expected) return {};
    std::vector<BYTE> bytes(size);
    if (CM_Get_Device_Interface_PropertyW(id.c_str(), &key, &type, bytes.data(), &size, 0) != CR_SUCCESS || type != expected) return {};
    return bytes;
}
inline std::string utf8(const std::wstring& text) {
    int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size, nullptr, nullptr);
    return result;
}
class Receiver final : public Callback {
    std::atomic<ULONG> refs{1};
    std::mutex mutex;
    Receive receive;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (iid != __uuidof(IUnknown) && iid != __uuidof(Callback)) return E_NOINTERFACE;
        *result = static_cast<Callback*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
    ULONG STDMETHODCALLTYPE Release() override { auto remaining = --refs; if (!remaining) delete this; return remaining; }
    void set(Receive next) { std::lock_guard<std::mutex> lock(mutex); receive = std::move(next); }
    HRESULT STDMETHODCALLTYPE OnMessage(UINT, PVOID data, UINT bytes, LONGLONG time, LONGLONG) override {
        if (!data || bytes % sizeof(uint32_t)) return E_INVALIDARG;
        std::lock_guard<std::mutex> lock(mutex);
        if (receive) receive(static_cast<const uint32_t*>(data), bytes / sizeof(uint32_t), time);
        return S_OK;
    }
};
class Backend {
    struct Connection {
        ComPtr<Bidirectional> port;
        ComPtr<Receiver> receiver;
        bool input = false, output = false;
    };
    HMODULE module = nullptr;
    bool comOwned = false;
    ComPtr<Transport> transport;
    ComPtr<SessionTracker> tracker;
    GUID session{};
    std::map<std::wstring, uint32_t> indices;
    std::map<uint32_t, std::wstring> ids;
    std::map<uint32_t, Connection> connections;
public:
    HRESULT lastError = S_OK;
    bool initialize() {
        if (tracker) return true;
        HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        comOwned = SUCCEEDED(hr);
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) { lastError = hr; return false; }
        // Load only the OS binary. It is not registered as a COM server on every Windows build.
        module = LoadLibraryExW(L"Midi2.MidiSrvTransport.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (!module) { lastError = HRESULT_FROM_WIN32(GetLastError()); shutdown(); return false; }
        auto getFactory = reinterpret_cast<HRESULT (STDAPICALLTYPE*)(REFCLSID, REFIID, void**)>(GetProcAddress(module, "DllGetClassObject"));
        ComPtr<IClassFactory> factory;
        hr = getFactory ? getFactory(transportClass, IID_PPV_ARGS(&factory)) : E_NOINTERFACE;
        if (SUCCEEDED(hr)) hr = factory->CreateInstance(nullptr, IID_PPV_ARGS(&transport));
        factory.Reset();
        if (SUCCEEDED(hr)) hr = transport->Activate(__uuidof(SessionTracker), reinterpret_cast<void**>(tracker.GetAddressOf()));
        if (SUCCEEDED(hr)) hr = tracker->Initialize();
        if (SUCCEEDED(hr) && !tracker->VerifyConnectivity()) hr = HRESULT_FROM_WIN32(ERROR_SERVICE_NOT_ACTIVE);
        if (SUCCEEDED(hr)) hr = CoCreateGuid(&session);
        if (SUCCEEDED(hr)) hr = tracker->AddClientSession(session, L"Harmoneasy");
        if (FAILED(hr)) { lastError = hr; shutdown(); return false; }
        lastError = S_OK; return true;
    }
    std::vector<Endpoint> enumerate() {
        std::vector<Endpoint> result;
        if (!initialize()) return result;
        ULONG size = 0;
        std::vector<wchar_t> list;
        CONFIGRET status;
        do {
            status = CM_Get_Device_Interface_List_SizeW(&size, const_cast<GUID*>(&endpointClass), nullptr, CM_GET_DEVICE_INTERFACE_LIST_PRESENT);
            if (status != CR_SUCCESS) return result;
            list.resize(size);
            status = CM_Get_Device_Interface_ListW(const_cast<GUID*>(&endpointClass), nullptr, list.data(), size, CM_GET_DEVICE_INTERFACE_LIST_PRESENT);
        } while (status == CR_BUFFER_SMALL);
        if (status != CR_SUCCESS) return result;
        for (const wchar_t* path = list.data(); *path; path += wcslen(path) + 1) {
            std::wstring id(path);
            uint32_t purpose = 0;
            auto purposeBytes = property(id, {propertyClass, 100}, DEVPROP_TYPE_UINT32);
            if (purposeBytes.size() == sizeof(purpose)) memcpy(&purpose, purposeBytes.data(), sizeof(purpose));
            if (purpose == 100) continue; // Private device-side virtual endpoints.
            auto name = property(id, {propertyClass, 500}, DEVPROP_TYPE_STRING);
            if (name.size() <= sizeof(wchar_t)) name = property(id, {propertyClass, 14}, DEVPROP_TYPE_STRING);
            if (name.size() <= sizeof(wchar_t)) name = property(id, DEVPKEY_DeviceInterface_FriendlyName, DEVPROP_TYPE_STRING);
            auto protocol = property(id, {propertyClass, 400}, DEVPROP_TYPE_BYTE);
            auto supports = property(id, {propertyClass, 150}, DEVPROP_TYPE_BOOLEAN);
            bool midi2 = purpose == 500 || purpose == 510 || (!protocol.empty() ? protocol[0] == 2 : !supports.empty() && supports[0]);
            if (!indices.count(id)) { uint32_t index = 0x10000000 + static_cast<uint32_t>(indices.size()); indices[id] = index; ids[index] = id; }
            result.push_back({indices[id], id, name.empty() ? utf8(id) : utf8(reinterpret_cast<const wchar_t*>(name.data())), midi2, purpose});
        }
        return result;
    }
    HRESULT open(uint32_t index, bool input, Receive receive = {}) {
        if (!initialize()) return lastError;
        auto id = ids.find(index); if (id == ids.end()) return E_INVALIDARG;
        auto found = connections.find(index);
        if (found == connections.end()) {
            Connection connection;
            connection.receiver.Attach(new Receiver());
            if (input) connection.receiver->set(std::move(receive));
            HRESULT hr = transport->Activate(__uuidof(Bidirectional), reinterpret_cast<void**>(connection.port.GetAddressOf()));
            CreationParams params{0, 2, session}; DWORD taskId = 0;
            if (SUCCEEDED(hr)) hr = connection.port->Initialize(id->second.c_str(), &params, &taskId, connection.receiver.Get(), 0, session);
            if (FAILED(hr)) { if (connection.port) connection.port->Shutdown(); return hr; }
            if (params.dataFormat != 2) { connection.port->Shutdown(); return E_UNEXPECTED; }
            found = connections.emplace(index, std::move(connection)).first;
        } else if (input) found->second.receiver->set(std::move(receive));
        if (input) found->second.input = true; else found->second.output = true;
        return S_OK;
    }
    void close(uint32_t index, bool input) {
        auto found = connections.find(index); if (found == connections.end()) return;
        if (input) { found->second.receiver->set({}); found->second.input = false; }
        else found->second.output = false;
        if (!found->second.input && !found->second.output) { found->second.port->Shutdown(); connections.erase(found); }
    }
    HRESULT send(uint32_t index, uint32_t* words, size_t count) {
        auto found = connections.find(index);
        if (found == connections.end() || !found->second.output) return E_HANDLE;
        return found->second.port->SendMidiMessage(0, words, static_cast<UINT>(count * sizeof(uint32_t)), 0);
    }
    void shutdown() {
        for (auto& item : connections) { item.second.receiver->set({}); item.second.port->Shutdown(); }
        connections.clear();
        if (tracker) { tracker->RemoveClientSession(session); tracker->Shutdown(); tracker.Reset(); }
        transport.Reset();
        if (module) { FreeLibrary(module); module = nullptr; }
        if (comOwned) { CoUninitialize(); comOwned = false; }
    }
};
}
