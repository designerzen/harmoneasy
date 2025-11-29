import { Handle, Position } from "@xyflow/react";
import React from "react";

export function EndNode() {
    return <div className="node-end">
        <div>End</div>
        <Handle type="target" position={Position.Left} />

    </div>
}