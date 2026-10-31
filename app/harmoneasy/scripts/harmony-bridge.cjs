process.env.OSC_WS_PORT ??= "9122"
process.env.OSC_RECEIVE_PORT ??= "9124"
process.env.OSC_SEND_PORT ??= "9123"
process.env.OSC_MIRROR_PORT ??= "9125"
require("./osc-bridge.cjs")