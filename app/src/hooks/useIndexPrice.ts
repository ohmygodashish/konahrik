"use client";

import { useEffect, useState, useRef } from "react";
import { getIndexPrice } from "@/lib/price-client";
import { POLLING_INTERVAL_MS } from "@/lib/constants";

export interface PricePoint {
  time: number;
  price: number;
}

const MAX_HISTORY = 500;

export function useIndexPrice() {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const fetchAndStore = async () => {
      const data = await getIndexPrice();
      if (!data) return;

      const point: PricePoint = {
        time: Math.floor(data.timestamp / 1000),
        price: data.price,
      };

      setCurrentPrice(data.price);

      setHistory((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].time === point.time) {
          return prev;
        }
        const next = [...prev, point];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
    };

    fetchAndStore();
    const interval = setInterval(fetchAndStore, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { history, currentPrice };
}
