import { Handle, Position } from "@xyflow/react";
import React from "react";

export function StartNode() {
    return <div className="node-start">
        <div>Start</div>
      <Handle type="source" position={Position.Right} />
    </div>
}