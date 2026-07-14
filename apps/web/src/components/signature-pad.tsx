"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  toBlob: () => Promise<Blob | null>;
  isEmpty: () => boolean;
  clear: () => void;
}

// Lienzo de firma reutilizable. El padre obtiene el trazo con ref.toBlob().
export const SignaturePad = forwardRef<SignaturePadHandle, { disabled?: boolean }>(
  function SignaturePad({ disabled }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const [hasInk, setHasInk] = useState(false);

    useEffect(() => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) { ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#111827"; }
    }, []);

    function coords(e: React.PointerEvent<HTMLCanvasElement>) {
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
    }
    function start(e: React.PointerEvent<HTMLCanvasElement>) {
      if (disabled) return;
      drawing.current = true;
      const ctx = canvasRef.current!.getContext("2d")!;
      const p = coords(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvasRef.current!.setPointerCapture(e.pointerId);
    }
    function move(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawing.current) return;
      const ctx = canvasRef.current!.getContext("2d")!;
      const p = coords(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setHasInk(true);
    }
    function end() { drawing.current = false; }

    function clear() {
      const c = canvasRef.current;
      if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setHasInk(false);
    }

    useImperativeHandle(ref, () => ({
      isEmpty: () => !hasInk,
      clear,
      toBlob: () =>
        new Promise((resolve) => {
          if (!hasInk || !canvasRef.current) return resolve(null);
          canvasRef.current.toBlob((b) => resolve(b), "image/png");
        }),
    }));

    return (
      <div>
        <canvas
          ref={canvasRef}
          width={500}
          height={160}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="w-full border border-dashed border-gray-300 rounded-lg bg-white touch-none cursor-crosshair"
          style={{ aspectRatio: "500 / 160" }}
        />
        <button type="button" onClick={clear} className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
          Limpiar
        </button>
      </div>
    );
  },
);
