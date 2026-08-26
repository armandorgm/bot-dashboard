import { ProcessRangeSpan, TacticalCluster, TacticalPOI } from '../types';

/**
 * Pure Mathematical & Geometric Projection Engine for the Tactical Price Spectrum.
 * 
 * - Viewport bounds calculation (extrema) with dynamic floor margin.
 * - Logarithmic Bipartite Projection (guaranteeing exact 50% center at market price).
 * - Non-destructive greedy lane assignment for overlapping process spans.
 * - Spatial clustering for anti-cluttering of nearby pins.
 */

/**
 * Pure Viewport Geometry: Calculate min and max bounds for the atemporal X-axis.
 * Handles both ProcessRangeSpans and TacticalPOIs safely centered around marketPrice.
 */
export function calculateViewportExtrema(
  marketPrice: number,
  triggerOrPois?: number | null | TacticalPOI[],
  spansOrMargin?: ProcessRangeSpan[] | number,
  minSafetyMarginPc: number = 0.0075
): { pMin: number; pMax: number } {
  if (marketPrice <= 0) {
    return { pMin: 0.99, pMax: 1.01 };
  }

  // Handle POI array call pattern: (marketPrice, pois, floorPc)
  if (Array.isArray(triggerOrPois)) {
    const pois = triggerOrPois;
    const floorMargin = typeof spansOrMargin === 'number' ? spansOrMargin : minSafetyMarginPc;
    let minP = marketPrice * (1 - floorMargin);
    let maxP = marketPrice * (1 + floorMargin);

    for (const poi of pois) {
      if (poi.price > 0) {
        if (poi.price < minP) minP = poi.price;
        if (poi.price > maxP) maxP = poi.price;
      }
    }

    const leftSpan = marketPrice - minP;
    const rightSpan = maxP - marketPrice;
    const pMin = Math.max(0.00000001, marketPrice - leftSpan * 1.10);
    const pMax = marketPrice + rightSpan * 1.10;
    return { pMin, pMax };
  }

  // Standard ProcessRangeSpan call pattern: (marketPrice, triggerPrice, spans, margin)
  const triggerPrice = typeof triggerOrPois === 'number' ? triggerOrPois : null;
  const spans = Array.isArray(spansOrMargin) ? spansOrMargin : [];
  const safetyMargin = typeof spansOrMargin === 'number' ? spansOrMargin : minSafetyMarginPc;

  let minPrice = marketPrice * (1 - safetyMargin);
  let maxPrice = marketPrice * (1 + safetyMargin);

  if (triggerPrice && triggerPrice > 0) {
    if (triggerPrice < minPrice) minPrice = triggerPrice;
    if (triggerPrice > maxPrice) maxPrice = triggerPrice;
  }

  for (const span of spans) {
    if (span.minPrice > 0 && span.minPrice < minPrice) minPrice = span.minPrice;
    if (span.maxPrice > 0 && span.maxPrice > maxPrice) maxPrice = span.maxPrice;
  }

  const leftSpan = marketPrice - minPrice;
  const rightSpan = maxPrice - marketPrice;

  const pMin = Math.max(0.00000001, marketPrice - leftSpan * 1.10);
  const pMax = marketPrice + rightSpan * 1.10;

  return { pMin, pMax };
}

/**
 * Logarithmic Bipartite Projection (Propuesta Gama):
 * - x(P_min) = 0%
 * - x(P_market) = 50% (Always exact center)
 * - x(P_max) = 100%
 */
export function calculateLogCoordinate(
  price: number,
  marketPrice: number,
  pMin: number,
  pMax: number
): number {
  if (price <= pMin) return 0;
  if (price >= pMax) return 100;
  if (price === marketPrice) return 50;

  if (price < marketPrice) {
    const denom = Math.log(marketPrice) - Math.log(pMin);
    if (denom <= 0) return 25;
    const num = Math.log(marketPrice) - Math.log(price);
    const ratio = 1 - num / denom;
    return Math.max(0, Math.min(50, 50 * ratio));
  } else {
    const denom = Math.log(pMax) - Math.log(marketPrice);
    if (denom <= 0) return 75;
    const num = Math.log(price) - Math.log(marketPrice);
    const ratio = num / denom;
    return Math.max(50, Math.min(100, 50 + 50 * ratio));
  }
}

/**
 * Project Spans to X coordinates and assign Tiered Lanes (NO MERGING).
 * Spans that overlap in price intervals are stacked into distinct lanes so all remain visible.
 */
export function projectAndAssignLanes(
  spans: ProcessRangeSpan[],
  marketPrice: number,
  pMin: number,
  pMax: number
): { spans: ProcessRangeSpan[]; totalLanes: number } {
  if (spans.length === 0) return { spans: [], totalLanes: 0 };

  // 1. Calculate X positions for each span
  spans.forEach((span) => {
    span.xStart = calculateLogCoordinate(span.startPrice, marketPrice, pMin, pMax);
    span.xEnd = calculateLogCoordinate(span.endPrice, marketPrice, pMin, pMax);
    span.xLeft = Math.min(span.xStart, span.xEnd);
    span.xRight = Math.max(span.xStart, span.xEnd);
    span.widthPc = Math.max(3.0, span.xRight - span.xLeft);
  });

  // 2. Sort by xLeft ascending (if equal, wider spans first)
  spans.sort((a, b) => a.xLeft - b.xLeft || (b.xRight - b.xLeft) - (a.xRight - a.xLeft));

  // 3. Assign lanes without merging
  const laneEnds: number[] = [];
  spans.forEach((span) => {
    let assignedLane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= span.xLeft) {
        assignedLane = i;
        laneEnds[i] = span.xRight + 0.8;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneEnds.length;
      laneEnds.push(span.xRight + 0.8);
    }
    span.lane = assignedLane;
  });

  return { spans, totalLanes: Math.max(1, laneEnds.length) };
}

/**
 * Spatial clustering for POI pins with distance < clusterRadiusPc (Anti-Cluttering).
 */
export function clusterPois(
  pois: TacticalPOI[],
  marketPrice: number,
  pMin: number,
  pMax: number,
  clusterRadiusPc: number = 3.5
): TacticalCluster[] {
  if (pois.length === 0) return [];

  // Project POIs to X positions
  const projected = pois
    .map((p) => ({
      poi: p,
      x: calculateLogCoordinate(p.price, marketPrice, pMin, pMax),
    }))
    .sort((a, b) => a.x - b.x);

  const clusters: TacticalCluster[] = [];
  let currentCluster: TacticalCluster | null = null;

  for (const item of projected) {
    if (!currentCluster) {
      currentCluster = { x: item.x, pois: [item.poi] };
    } else if (Math.abs(item.x - currentCluster.x) <= clusterRadiusPc) {
      currentCluster.pois.push(item.poi);
      // Recompute center of cluster
      const sumX = currentCluster.pois.reduce((acc, p) => acc + calculateLogCoordinate(p.price, marketPrice, pMin, pMax), 0);
      currentCluster.x = sumX / currentCluster.pois.length;
    } else {
      clusters.push(currentCluster);
      currentCluster = { x: item.x, pois: [item.poi] };
    }
  }

  if (currentCluster) {
    clusters.push(currentCluster);
  }

  return clusters;
}
