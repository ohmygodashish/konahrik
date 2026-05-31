"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, LineSeries, TickMarkType, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { useAmmState } from "@/hooks/useAmmState";
import { useIndexPrice } from "@/hooks/useIndexPrice";
import { getMarkPrice } from "@/lib/math";

interface PricePoint {
  time: number;
  price: number;
}

const MAX_CHART_POINTS = 500;

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const markSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const indexSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markHistoryRef = useRef<PricePoint[]>([]);

  const [showMark, setShowMark] = useState(true);
  const [showIndex, setShowIndex] = useState(true);

  const { ammState } = useAmmState();
  const { history: indexHistory, currentPrice: currentIndexPrice } = useIndexPrice();

  const markPrice = ammState
    ? getMarkPrice(
        BigInt(ammState.baseAssetReserve.toString()),
        BigInt(ammState.quoteAssetReserve.toString())
      )
    : null;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#121317" },
        textColor: "#908fa0",
        fontFamily: "monospace",
      },
      localization: {
        timeFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        },
      },
      grid: {
        vertLines: { color: "#1f1f24" },
        horzLines: { color: "#1f1f24" },
      },
      crosshair: {
        vertLine: { color: "#6366F1", width: 1, style: 2 },
        horzLine: { color: "#6366F1", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "#1f1f24",
      },
      timeScale: {
        borderColor: "#1f1f24",
        timeVisible: true,
        secondsVisible: true,
        tickMarkFormatter: (time: any, tickMarkType: TickMarkType) => {
          const date = new Date(typeof time === "object" ? (time as any).value * 1000 : time * 1000);
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          switch (tickMarkType) {
            case TickMarkType.Year:
              return date.toLocaleDateString([], { year: "numeric", timeZone: tz });
            case TickMarkType.Month:
              return date.toLocaleDateString([], { month: "short", year: "numeric", timeZone: tz });
            case TickMarkType.DayOfMonth:
              return date.toLocaleDateString([], { day: "numeric", month: "short", timeZone: tz });
            case TickMarkType.Time:
              return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz });
            case TickMarkType.TimeWithSeconds:
              return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
            default:
              return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz });
          }
        },
      },
    });

    const markSeries = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      lastValueVisible: true,
      priceLineVisible: true,
    });

    const indexSeries = chart.addSeries(LineSeries, {
      color: "#6366F1",
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    markSeriesRef.current = markSeries;
    indexSeriesRef.current = indexSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      markSeriesRef.current = null;
      indexSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markSeriesRef.current || !ammState) return;

    const markPrice = getMarkPrice(
      BigInt(ammState.baseAssetReserve.toString()),
      BigInt(ammState.quoteAssetReserve.toString())
    );

    const now = Math.floor(Date.now() / 1000);
    const point: PricePoint = { time: now, price: markPrice };

    markHistoryRef.current = [...markHistoryRef.current, point];
    if (markHistoryRef.current.length > MAX_CHART_POINTS) {
      markHistoryRef.current = markHistoryRef.current.slice(-MAX_CHART_POINTS);
    }

    markSeriesRef.current.update({ time: point.time as any, value: point.price });
  }, [ammState]);

  useEffect(() => {
    if (!indexSeriesRef.current || indexHistory.length === 0) return;

    const latest = indexHistory[indexHistory.length - 1];
    indexSeriesRef.current.update({ time: latest.time as any, value: latest.price });
  }, [indexHistory]);

  const toggleMark = useCallback(() => {
    setShowMark((prev) => {
      const next = !prev;
      markSeriesRef.current?.applyOptions({ visible: next });
      if (next) {
        chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      }
      return next;
    });
  }, []);

  const toggleIndex = useCallback(() => {
    setShowIndex((prev) => {
      const next = !prev;
      indexSeriesRef.current?.applyOptions({ visible: next });
      if (next) {
        chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-container text-[11px]">
        <button
          onClick={toggleMark}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-sm transition-all cursor-pointer ${
            showMark
              ? "bg-positive/10 border border-positive/30"
              : "bg-transparent border border-transparent opacity-40"
          }`}
        >
          <span
            className="w-2 h-[2px] inline-block rounded-full"
            style={{
              backgroundColor: showMark ? "#22c55e" : "#908fa0",
            }}
          />
          <span className="text-outline">Mark</span>
          <span className="text-white font-mono-data">
            {markPrice ? `$${markPrice.toFixed(2)}` : "---"}
          </span>
        </button>
        <button
          onClick={toggleIndex}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-sm transition-all cursor-pointer ${
            showIndex
              ? "bg-electric-indigo/10 border border-electric-indigo/30"
              : "bg-transparent border border-transparent opacity-40"
          }`}
        >
          <span
            className="w-2 h-[2px] inline-block rounded-full"
            style={{
              backgroundColor: showIndex ? "#6366F1" : "#908fa0",
            }}
          />
          <span className="text-outline">Index</span>
          <span className="text-white font-mono-data">
            {currentIndexPrice ? `$${currentIndexPrice.toFixed(2)}` : "---"}
          </span>
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
