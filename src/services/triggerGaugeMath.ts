import { ProcessRangeSpan, TacticalCluster, TacticalPOI, TacticalProcessGap } from '../types';

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
 * Geometria del stagger de process spans.
 *
 * Los spans NO se reparten en carriles de 24px: todos comparten UNA unica banda
 * vertical y los solapamientos de precio se resuelven con un desfase Y fijo por
 * nivel de apilamiento. `span.lane` conserva el nivel asignado (informativo),
 * pero el posicionamiento vertical depende EXCLUSIVAMENTE de `yOffsetPx`.
 *
 * `STAGGER_TRACK_HEIGHT_PX` es el alto de pista que acomoda el peor caso
 * (MAX_LEVELS desfases + alto del span + margen superior e inferior).
 */
export const STAGGER = {
  /** Nivel maximo de apilamiento (los niveles utiles son 0..MAX_LEVELS). */
  MAX_LEVELS: 4,
  /** Desfase vertical por nivel de apilamiento, en px. */
  Y_OFFSET_PX: 6,
  /** Separacion vertical base desde el borde superior del track. */
  TOP_BASE_PX: 6,
  /** Alto del span; debe coincidir con .tactical-process-span en styles.css. */
  SPAN_HEIGHT_PX: 20,
  /** Margen inferior del track. */
  BOTTOM_MARGIN_PX: 8,
} as const;

/** Alto de pista que garantiza que el peor caso de stagger quepa completo. */
export const STAGGER_TRACK_HEIGHT_PX =
  STAGGER.TOP_BASE_PX + STAGGER.MAX_LEVELS * STAGGER.Y_OFFSET_PX + STAGGER.SPAN_HEIGHT_PX + STAGGER.BOTTOM_MARGIN_PX;

/**
 * Posicion vertical (top) de un span dentro del track.
 *
 * Unica fuente de verdad de la geometria vertical: NO multiplica por el alto de
 * carril, solo suma el desfase por nivel. Dos spans que solapan en precio
 * quedan en la misma banda, distinguidos unicamente por este offset.
 */
export function computeSpanTopPx(span: ProcessRangeSpan): number {
  return STAGGER.TOP_BASE_PX + (span.yOffsetPx || 0);
}

/**
 * Staggered Stacking for overlapping Process Spans.
 *
 * Estrategia (reemplaza la fusion por barras union):
 *   1. Proyecta cada span a coordenadas X (igual que antes).
 *   2. Ordena por xLeft ascendente (wider spans first on ties).
 *   3. Para cada span, busca el primer nivel de apilamiento (0..MAX_LEVELS)
 *      donde NO se solape en PRECIO con ningun span ya asignado.
 *   4. Si ningun nivel esta libre, asigna al nivel con menos spans (desbordamiento).
 *   5. Cada nivel recibe un desfase vertical fijo en px (STAGGER.Y_OFFSET_PX),
 *      NUNCA un carril propio de 24px.
 *
 * Garantiza:
 *   - Cada proceso se renderiza como un span independiente (no fusionado).
 *   - Una sola banda vertical: totalLanes = 1.
 *   - El solapamiento visual se acota a MAX_LEVELS niveles (sin escalera infinita).
 *   - El criterio de apilamiento usa el rango de PRECIOS, no la proyeccion X
 *     logaritmica (que comprime rangos amplios y provoca solapes ficticios).
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
    span.yOffsetPx = 0;
  });

  // 2. Sort by xLeft ascending (if equal, wider spans first)
  spans.sort((a, b) => a.xLeft - b.xLeft || (b.xRight - a.xLeft) - (a.xRight - a.xLeft));

  // 3. Staggered stacking (una sola banda vertical, sin carriles de 24px)
  const MAX_LEVELS = STAGGER.MAX_LEVELS;
  const Y_OFFSET_PX = STAGGER.Y_OFFSET_PX;
  const PRICE_OVERLAP_EPSILON = 1e-9;

  // Levels store the spans assigned to each stacking level
  const levels: ProcessRangeSpan[][] = Array.from({ length: MAX_LEVELS + 1 }, () => []);

  for (const span of spans) {
    let assignedLevel: number | null = null;

    // Price bounds of the current span (direction-agnostic: startPrice may be > endPrice)
    const spanMinPrice = Math.min(span.startPrice, span.endPrice);
    const spanMaxPrice = Math.max(span.startPrice, span.endPrice);

    // Find first free level (no PRICE overlap with any span already in that level).
    //
    // NOTE: The overlap decision MUST use raw price intervals, NOT the projected
    // X coordinates. The logarithmic projection compresses wide price ranges
    // (e.g. a $1..$109 viewport) into very small X ranges on one side of the
    // center, so spans with completely disjoint prices end up with overlapping
    // xLeft/xRight and get wrongly pushed onto different lanes. Testing the
    // prices directly reflects the user's intent: "spans that don't overlap in
    // price stay on the same lane".
    for (let lvl = 0; lvl <= MAX_LEVELS; lvl++) {
      const levelSpans = levels[lvl];
      const hasOverlap = levelSpans.some((existing) => {
        const existingMinPrice = Math.min(existing.startPrice, existing.endPrice);
        const existingMaxPrice = Math.max(existing.startPrice, existing.endPrice);
        // Overlap iff the price intervals intersect (touching edges do NOT overlap)
        return (
          existingMaxPrice > spanMinPrice + PRICE_OVERLAP_EPSILON &&
          spanMaxPrice > existingMinPrice + PRICE_OVERLAP_EPSILON
        );
      });
      if (!hasOverlap) {
        assignedLevel = lvl;
        break;
      }
    }

    // Overflow: assign to the level with the fewest spans
    if (assignedLevel === null) {
      let minCount = Infinity;
      for (let lvl = 0; lvl <= MAX_LEVELS; lvl++) {
        if (levels[lvl].length < minCount) {
          minCount = levels[lvl].length;
          assignedLevel = lvl;
        }
      }
      // Safety fallback: should never happen since MAX_LEVELS >= 0
      if (assignedLevel === null) {
        assignedLevel = 0;
      }
    }

    // Assign to the chosen level. `lane` is informational only: the vertical
    // position is driven solely by `yOffsetPx` (see computeSpanTopPx).
    levels[assignedLevel].push(span);
    span.lane = assignedLevel;
    span.yOffsetPx = assignedLevel * Y_OFFSET_PX;
  }

  // 4. Single vertical band for every span (no 24px lanes)
  return { spans, totalLanes: 1 };
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

/**
 * Pure Mathematical Edge-to-Edge Distance Percentage Engine for Adjacent Processes.
 * 
 * - Midpoint of process: (P_start + P_end) / 2
 * - Distance to Center: |P_mid - P_market|
 * - Reference Process: argmin(|P_mid - P_market|) between adjacent pair (A, B)
 * - Edge-to-Edge Price Gap: P_min,B - P_max,A
 * - Percentage: (PriceGap / ReferenceEdgePrice) * 100
 */
export function calculateProcessGaps(
  spans: ProcessRangeSpan[],
  marketPrice: number,
  pMin: number,
  pMax: number
): TacticalProcessGap[] {
  if (!Array.isArray(spans) || spans.length < 2 || marketPrice <= 0) return [];

  interface EnrichedSpan {
    span: ProcessRangeSpan;
    midPrice: number;
    minPrice: number;
    maxPrice: number;
    distToCenter: number;
  }

  const enriched: EnrichedSpan[] = spans.map((span) => {
    const minP = Math.min(span.startPrice, span.endPrice);
    const maxP = Math.max(span.startPrice, span.endPrice);
    const midP = (span.startPrice + span.endPrice) / 2;
    return {
      span,
      midPrice: midP,
      minPrice: minP,
      maxPrice: maxP,
      distToCenter: Math.abs(midP - marketPrice),
    };
  });

  // Sort horizontally by midpoint ascending
  enriched.sort((a, b) => a.midPrice - b.midPrice || a.minPrice - b.minPrice);

  const gaps: TacticalProcessGap[] = [];

  for (let i = 0; i < enriched.length - 1; i++) {
    const left = enriched[i];
    const right = enriched[i + 1];

    const leftEdgePrice = left.maxPrice;
    const rightEdgePrice = right.minPrice;
    const priceGap = rightEdgePrice - leftEdgePrice;
    const isOverlap = priceGap < 0;

    // Determine reference: closest midpoint to market price
    let referenceSide: 'LEFT' | 'RIGHT' = 'LEFT';
    let referenceProcessId = left.span.processId;
    let referencePrice = leftEdgePrice;

    if (right.distToCenter < left.distToCenter) {
      referenceSide = 'RIGHT';
      referenceProcessId = right.span.processId;
      referencePrice = rightEdgePrice;
    }

    const gapPercent = referencePrice > 0 ? (priceGap / referencePrice) * 100 : 0;

    const xLeft = calculateLogCoordinate(leftEdgePrice, marketPrice, pMin, pMax);
    const xRight = calculateLogCoordinate(rightEdgePrice, marketPrice, pMin, pMax);
    const xCenter = (xLeft + xRight) / 2;
    const widthPc = Math.abs(xRight - xLeft);

    gaps.push({
      id: `gap-${left.span.processId}-${right.span.processId}`,
      leftProcessId: left.span.processId,
      rightProcessId: right.span.processId,
      leftSpanId: left.span.id,
      rightSpanId: right.span.id,
      leftSpan: left.span,
      rightSpan: right.span,
      leftEdgePrice,
      rightEdgePrice,
      priceGap,
      leftMidPrice: left.midPrice,
      rightMidPrice: right.midPrice,
      leftDistToCenter: left.distToCenter,
      rightDistToCenter: right.distToCenter,
      referenceSide,
      referenceProcessId,
      referencePrice,
      gapPercent,
      isOverlap,
      xLeft: Math.min(xLeft, xRight),
      xRight: Math.max(xLeft, xRight),
      xCenter,
      widthPc,
    });
  }

  return gaps;
}

