import React, { useState, useCallback, useEffect } from 'react';
import { ReactFlow, applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TransformerManager } from '../../libs/audiobus/transformers/transformer-manager';
import { ConfigDrawer } from './ConfigDrawer';
import { StartNode } from './nodes/StartNode';
import { EndNode } from './nodes/EndNode';
import { TransformerNode } from './nodes/TransformerNode';

const initialNodes = [
  { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
  { id: 'n2', position: { x: 0, y: 100 }, data: { label: 'Node 2' } },
];
const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];

const nodeTypes = {
  start: StartNode,
  end: EndNode,
  transformer: TransformerNode
}

function FlowComponent() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    console.log('EFFECT')
    const tM = (window as any).transformerManager as TransformerManager
    tM.onChange(() => {
      console.log('CHANGED!!!')
      const structure = tM.getStructure()
      setNodes(structure.nodes)
      setEdges(structure.edges)
    })
    const structure = tM.getStructure()
      setNodes(structure.nodes)
      setEdges(structure.edges)
  }, [setNodes, setEdges])

  // Auto-fit view whenever nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      // Use setTimeout to ensure nodes are rendered before fitting
      setTimeout(() => {
        fitView({
          padding: 0.2,
          minZoom: 0.5,
          maxZoom: 1.5,
          duration: 200
        });
      }, 0);
    }
  }, [nodes, fitView])

  
 
  const onNodesChange = useCallback(
    (changes) => setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect = useCallback(
    (params) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

  return (
    <div style={{width: '100%', height: '100%', display: 'flex', gap: '16px'}}>
      <div style={{padding: '16px'}}>
        <ConfigDrawer />
      </div>
      <div style={{flex: 1}}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          minZoom={0.3}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowComponent />
    </ReactFlowProvider>
  );
}