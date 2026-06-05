import React, { useEffect, useRef, useState, useMemo } from 'react';
import { getKnowledgeGraph, KnowledgeGraphResponse, GraphNode, GraphEdge } from '../../api/learning';
import { Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { motion } from 'motion/react';

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function KnowledgeGraphView() {
  const [graphData, setGraphData] = useState<KnowledgeGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Simulation states
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<number | null>(null);
  
  // Viewport states for Zoom/Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getKnowledgeGraph();
      setGraphData(data);
      
      // Initialize nodes with circular layout positions
      const width = 600;
      const height = 400;
      const initialized = data.nodes.map((node, i) => {
        const angle = (i / data.nodes.length) * 2 * Math.PI;
        const radius = 100 + Math.random() * 50;
        return {
          ...node,
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        };
      });
      setNodes(initialized);
    } catch (err: any) {
      setError(err.message || 'Không thể tải đồ thị tri thức.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Force-directed layout simulation loop
  useEffect(() => {
    if (nodes.length === 0 || draggedNodeId !== null) return;

    const width = 600;
    const height = 400;
    const center = { x: width / 2, y: height / 2 };
    
    // Physical constants
    const repulsion = 400; // Force pushing nodes apart
    const attraction = 0.05; // Spring force pulling connected nodes together
    const gravity = 0.01;   // Force pulling nodes to center
    const friction = 0.85;

    const tick = () => {
      setNodes(currentNodes => {
        const newNodes = currentNodes.map(n => ({ ...n }));
        const nodeMap = new Map(newNodes.map(n => [n.id, n]));

        // 1. Repulsion between all nodes
        for (let i = 0; i < newNodes.length; i++) {
          const n1 = newNodes[i];
          for (let j = i + 1; j < newNodes.length; j++) {
            const n2 = newNodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const distSq = dx * dx + dy * dy || 1;
            const dist = Math.sqrt(distSq);

            if (dist < 150) {
              const force = (repulsion / distSq) * 1.5;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              
              n1.vx -= fx;
              n1.vy -= fy;
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }

        // 2. Attraction along edges
        if (graphData?.edges) {
          graphData.edges.forEach(edge => {
            const source = nodeMap.get(edge.sourceTagId);
            const target = nodeMap.get(edge.targetTagId);
            if (source && target) {
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              
              // Edge target distance
              const targetDist = 100;
              const k = attraction * edge.weight;
              const force = (dist - targetDist) * k;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              source.vx += fx;
              source.vy += fy;
              target.vx -= fx;
              target.vy -= fy;
            }
          });
        }

        // 3. Gravity pulling to center & Apply velocities
        newNodes.forEach(n => {
          n.vx += (center.x - n.x) * gravity;
          n.vy += (center.y - n.y) * gravity;

          n.vx *= friction;
          n.vy *= friction;

          n.x += n.vx;
          n.y += n.vy;

          // Boundary constraints
          n.x = Math.max(20, Math.min(width - 20, n.x));
          n.y = Math.max(20, Math.min(height - 20, n.y));
        });

        return newNodes;
      });

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [graphData, draggedNodeId, nodes.length]);

  // Color mapping based on weakness score
  const getNodeColor = (score: number, isHighlighted: boolean) => {
    if (score > 0.8) return isHighlighted ? '#ef4444' : '#ef4444/70'; // Red (Critical)
    if (score > 0.6) return isHighlighted ? '#f59e0b' : '#f59e0b/70'; // Amber (Weak)
    return isHighlighted ? '#06b6d4' : '#06b6d4/70'; // Cyan (Strong)
  };

  const getNodeGlow = (score: number) => {
    if (score > 0.8) return 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.5))';
    if (score > 0.6) return 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.5))';
    return 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.5))';
  };

  // Find connected nodes of hovered node
  const connectedNodeIds = useMemo(() => {
    if (hoveredNodeId === null || !graphData?.edges) return new Set<number>();
    const connected = new Set<number>([hoveredNodeId]);
    graphData.edges.forEach(e => {
      if (e.sourceTagId === hoveredNodeId) connected.add(e.targetTagId);
      if (e.targetTagId === hoveredNodeId) connected.add(e.sourceTagId);
    });
    return connected;
  }, [hoveredNodeId, graphData]);

  // Drag handlers
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: number) => {
    e.stopPropagation();
    setDraggedNodeId(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedNodeId !== null && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Adjust client coordinate for zoom and pan
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;
      setNodes(prev => prev.map(n => n.id === draggedNodeId ? { ...n, x, y, vx: 0, vy: 0 } : n));
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setDraggedNodeId(null);
    setIsPanning(false);
  };

  // Zoom helpers
  const handleZoom = (factor: number) => {
    setZoom(z => Math.max(0.5, Math.min(3, z * factor)));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-400" />
        <span className="mt-3 text-sm text-zinc-400">Đang khởi tạo Đồ thị Tri thức...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-6 text-center">
        <p className="text-sm text-red-400 font-semibold mb-3">{error}</p>
        <button onClick={loadData} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-sm transition-colors">
          <RefreshCw size={14} /> Tải lại
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg text-white font-bold">Bản đồ Kiến thức (Knowledge Graph)</h3>
          <p className="text-xs text-zinc-400 mt-1">Đồ thị liên kết khái niệm tự động trích xuất từ tài liệu của bạn</p>
        </div>
        
        <div className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
          <button onClick={() => handleZoom(1.2)} title="Phóng to" className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors hover:bg-zinc-800">
            <ZoomIn size={16} />
          </button>
          <button onClick={() => handleZoom(0.8)} title="Thu nhỏ" className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors hover:bg-zinc-800">
            <ZoomOut size={16} />
          </button>
          <button onClick={resetView} title="Căn giữa" className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors hover:bg-zinc-800">
            <Maximize2 size={16} />
          </button>
          <button onClick={loadData} title="Tải lại" className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors hover:bg-zinc-800">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="w-full h-96 border border-zinc-800/80 bg-zinc-900/20 rounded-xl overflow-hidden relative cursor-grab active:cursor-grabbing select-none"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onMouseDown={(e) => {
          if (e.button === 0) {
            setIsPanning(true);
            panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          }
        }}
      >
        <svg className="w-full h-full">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3f3f46" />
            </marker>
          </defs>

          {/* Render Graph with Viewport Transformation */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 1. Render Edges (Relations) */}
            {graphData?.edges.map((edge) => {
              const source = nodes.find(n => n.id === edge.sourceTagId);
              const target = nodes.find(n => n.id === edge.targetTagId);
              if (!source || !target) return null;

              const isHovered = hoveredNodeId !== null;
              const isPart = hoveredNodeId === edge.sourceTagId || hoveredNodeId === edge.targetTagId;
              const strokeColor = isPart ? '#06b6d4' : '#3f3f46';
              const strokeWidth = isPart ? 2 : 1;
              const opacity = isHovered ? (isPart ? 0.9 : 0.15) : 0.4;

              return (
                <g key={edge.id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeOpacity={opacity}
                    markerEnd="url(#arrow)"
                    className="transition-all duration-300"
                  />
                  {/* Label for hover relationship */}
                  {isPart && (
                    <text
                      x={(source.x + target.x) / 2}
                      y={(source.y + target.y) / 2 - 4}
                      fill="#06b6d4"
                      fontSize="9"
                      textAnchor="middle"
                      opacity={opacity}
                      className="font-semibold select-none bg-zinc-950 p-1"
                    >
                      {edge.relationshipType}
                    </text>
                  )}
                </g>
              );
            })}

            {/* 2. Render Nodes (Concepts) */}
            {nodes.map((node) => {
              const isHovered = hoveredNodeId !== null;
              const isHighlighted = isHovered ? connectedNodeIds.has(node.id) : true;
              const color = getNodeColor(node.weaknessScore, isHighlighted);
              const glow = getNodeGlow(node.weaknessScore);
              const size = 12 + node.cardCount * 1.2; // Size proportional to card count
              const opacity = isHovered ? (isHighlighted ? 1.0 : 0.3) : 1.0;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                >
                  {/* Node Circle */}
                  <circle
                    r={size}
                    fill={color}
                    fillOpacity={opacity}
                    style={{ filter: isHighlighted ? glow : 'none' }}
                    className="transition-all duration-200"
                  />
                  
                  {/* Text Label */}
                  <text
                    y={size + 14}
                    textAnchor="middle"
                    fill={isHighlighted ? '#ffffff' : '#a1a1aa'}
                    fillOpacity={opacity}
                    fontSize="11"
                    className="font-medium tracking-wide select-none drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]"
                  >
                    {node.name}
                  </text>

                  {/* Card count badge if highlighted */}
                  {isHighlighted && node.cardCount > 0 && (
                    <text
                      y={4}
                      textAnchor="middle"
                      fill="#09090b"
                      fontSize="9"
                      fontWeight="bold"
                      className="select-none"
                    >
                      {node.cardCount}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating Legend */}
        <div className="absolute bottom-4 left-4 bg-zinc-950/80 border border-zinc-800/80 p-3 rounded-lg flex flex-col gap-1.5 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
            <span>Hiểu vững (score ≤ 0.60)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
            <span>Cần ôn tập (score &gt; 0.60)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
            <span>Khái niệm yếu (score &gt; 0.80)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
