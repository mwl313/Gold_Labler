"use client";

import { MouseEvent, useMemo, useState } from "react";
import Image from "next/image";

type Point = { x: number; y: number };

type ImageViewerProps = {
  src: string;
  alt: string;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.2;

export function ImageViewer({ src, alt }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastPoint, setLastPoint] = useState<Point | null>(null);

  const imageStyle = useMemo(
    () => ({
      transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
      transformOrigin: "center center",
    }),
    [scale, translate.x, translate.y],
  );

  const reset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const zoomIn = () => setScale((prev) => Math.min(MAX_SCALE, Number((prev + SCALE_STEP).toFixed(2))));
  const zoomOut = () => setScale((prev) => Math.max(MIN_SCALE, Number((prev - SCALE_STEP).toFixed(2))));

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    setLastPoint({ x: event.clientX, y: event.clientY });
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragging || !lastPoint) {
      return;
    }
    const deltaX = event.clientX - lastPoint.x;
    const deltaY = event.clientY - lastPoint.y;
    setTranslate((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
    setLastPoint({ x: event.clientX, y: event.clientY });
  };

  const endDrag = () => {
    setDragging(false);
    setLastPoint(null);
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={zoomOut}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-semibold hover:bg-slate-300"
        >
          -
        </button>
        <button
          type="button"
          onClick={zoomIn}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-semibold hover:bg-slate-300"
        >
          +
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded bg-slate-900 px-3 py-1 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Reset
        </button>
        <span className="ml-auto text-xs text-slate-600">Zoom: {Math.round(scale * 100)}%</span>
      </div>

      <div
        className={`relative flex-1 overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div className="flex h-full w-full items-center justify-center bg-slate-100">
          <div className="relative h-full w-full">
            <Image
              src={src}
              alt={alt}
              fill
              unoptimized
              draggable={false}
              style={imageStyle}
              className="select-none object-contain transition-transform duration-75"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
