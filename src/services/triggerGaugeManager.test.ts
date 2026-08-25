import { TriggerGaugeManager } from './triggerGaugeManager';

export function runTriggerGaugeVerification(): boolean {
  const manager = new TriggerGaugeManager();

  // 1. TREND_BUY theme check (Emerald Green)
  const trendBuyTheme = manager.getMetricColor(0.3523, 0.75, 'TREND_ACCUMULATION', 'TREND_BUY');
  if (trendBuyTheme.color !== '#10b981' || trendBuyTheme.ledClass !== 'led-green') {
    throw new Error(`Failed TREND_BUY theme check: got ${trendBuyTheme.color}`);
  }

  // 2. TREND_SELL theme check (Red)
  const trendSellTheme = manager.getMetricColor(0.25, 0.75, 'TREND_ACCUMULATION', 'TREND_SELL');
  if (trendSellTheme.color !== '#ef4444' || trendSellTheme.ledClass !== 'led-red') {
    throw new Error(`Failed TREND_SELL theme check: got ${trendSellTheme.color}`);
  }

  // 3. FLIP_SELL theme check (Amber/Yellow)
  const flipSellTheme = manager.getMetricColor(0.7692, 0.75, 'FLIP_CONMUTATED', 'FLIP_SELL');
  if (flipSellTheme.color !== '#f59e0b' || flipSellTheme.ledClass !== 'led-yellow') {
    throw new Error(`Failed FLIP_SELL theme check: got ${flipSellTheme.color}`);
  }

  // 4. FLIP_BUY theme check (Azure Blue)
  const flipBuyTheme = manager.getMetricColor(0.85, 0.75, 'FLIP_CONMUTATED', 'FLIP_BUY');
  if (flipBuyTheme.color !== '#3b82f6' || flipBuyTheme.ledClass !== 'led-blue') {
    throw new Error(`Failed FLIP_BUY theme check: got ${flipBuyTheme.color}`);
  }

  // 5. SEED / READY theme check (Cyan)
  const seedTheme = manager.getMetricColor(0.0, 0.75, 'READY', 'SEED');
  if (seedTheme.color !== '#06b6d4' || seedTheme.ledClass !== 'led-cyan') {
    throw new Error(`Failed SEED theme check: got ${seedTheme.color}`);
  }

  // 6. Sanitization of v2.2.0 payload (Modo Tendencia)
  const sanitizedTrend = manager.getSanitizedStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    condition_name: 'PULLBACK_CONMUTATOR',
    state: 'TREND_ACCUMULATION',
    conmutator_mode: 'TREND_BUY',
    resolved_side: 'BUY',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00259084,
    trigger_price: 0.0025805,
    actual_pullback_pc: 0.003523,
    required_pullback_pc: 0.0075,
    current_metric_pc: 0.3523,
    required_metric_pc: 0.75,
    delta_remaining_pc: 0.3977,
    multiplier: 3.0,
  });

  if (
    sanitizedTrend.state !== 'TREND_ACCUMULATION' ||
    sanitizedTrend.conmutator_mode !== 'TREND_BUY' ||
    sanitizedTrend.resolved_side !== 'BUY' ||
    sanitizedTrend.required_metric_pc !== 0.75 ||
    sanitizedTrend.delta_remaining_pc !== 0.3977
  ) {
    throw new Error(`Sanitization failed for Trend Mode payload: ${JSON.stringify(sanitizedTrend)}`);
  }

  // 7. Sanitization of v2.2.0 payload (Modo Giro Conmutado / Flip)
  const sanitizedFlip = manager.getSanitizedStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    condition_name: 'PULLBACK_CONMUTATOR',
    state: 'FLIP_CONMUTATED',
    conmutator_mode: 'FLIP_SELL',
    resolved_side: 'SELL',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00258,
    trigger_price: 0.0025805,
    current_metric_pc: 0.7692,
    required_metric_pc: 0.75,
    delta_remaining_pc: 0.0,
    multiplier: 3.0,
  });

  if (
    sanitizedFlip.state !== 'FLIP_CONMUTATED' ||
    sanitizedFlip.conmutator_mode !== 'FLIP_SELL' ||
    sanitizedFlip.resolved_side !== 'SELL'
  ) {
    throw new Error(`Sanitization failed for Flip Mode payload: ${JSON.stringify(sanitizedFlip)}`);
  }

  // 8. Badge Info Helper check
  const badgeInfo = manager.getConmutatorModeBadgeInfo('FLIP_SELL', 'FLIP_CONMUTATED');
  if (!badgeInfo.label.includes('GIRO A SHORT (SELL)')) {
    throw new Error(`Failed badge info check: got ${badgeInfo.label}`);
  }

  // 9. Compact status badge for Global Overview
  const compactHtml = manager.getCompactStatusBadgeHtml(sanitizedTrend);
  if (!compactHtml.includes('TREND BUY') || !compactHtml.includes('0.35%')) {
    throw new Error(`Failed compact badge HTML check: got ${compactHtml}`);
  }

  // 10. Live onTick real-time price fluctuation check
  manager.setStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    state: 'TREND_ACCUMULATION',
    conmutator_mode: 'TREND_BUY',
    resolved_side: 'BUY',
    position_side: 'LONG',
    entry_price: 0.0026,
    current_price: 0.00259,
    trigger_price: 0.0025805,
    current_metric_pc: 0.3846,
    required_metric_pc: 0.75,
    delta_remaining_pc: 0.3654,
  });

  // Simulate tick down (adverse pullback increases)
  manager.onTick(0.0025800, 0.0025800);
  const updatedStatus = manager.getStatus();
  if (!updatedStatus || updatedStatus.current_price !== 0.00258 || updatedStatus.state !== 'FLIP_CONMUTATED' || updatedStatus.conmutator_mode !== 'FLIP_SELL') {
    throw new Error(`Failed live onTick update check: got ${JSON.stringify(updatedStatus)}`);
  }

  // 11. GAMA SPEC: Viewport Extrema Calculation
  const testPois = [
    { id: 'p1', price: 0.00255, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Buy 1' },
    { id: 'p2', price: 0.00265, category: 'REAL_ORDER' as const, side: 'SELL' as const, label: 'Sell 1' },
  ];
  const extrema = manager.calculateViewportExtrema(0.00260, testPois);
  if (extrema.pMin >= 0.00255 || extrema.pMax <= 0.00265) {
    throw new Error(`Failed calculateViewportExtrema check: got pMin=${extrema.pMin}, pMax=${extrema.pMax}`);
  }

  // 12. GAMA SPEC: Logarithmic Bipartite Projection (50% Center Guarantee)
  const centerCoord = manager.calculateLogCoordinate(0.00260, 0.00260, 0.00250, 0.00270);
  if (Math.abs(centerCoord - 50.0) > 0.0001) {
    throw new Error(`Failed calculateLogCoordinate center check: expected 50.0, got ${centerCoord}`);
  }

  const leftExtremeCoord = manager.calculateLogCoordinate(0.00250, 0.00260, 0.00250, 0.00270);
  if (leftExtremeCoord !== 0) {
    throw new Error(`Failed calculateLogCoordinate left extreme check: expected 0, got ${leftExtremeCoord}`);
  }

  const rightExtremeCoord = manager.calculateLogCoordinate(0.00270, 0.00260, 0.00250, 0.00270);
  if (rightExtremeCoord !== 100) {
    throw new Error(`Failed calculateLogCoordinate right extreme check: expected 100, got ${rightExtremeCoord}`);
  }

  const midLeftCoord = manager.calculateLogCoordinate(0.00255, 0.00260, 0.00250, 0.00270);
  if (midLeftCoord <= 0 || midLeftCoord >= 50) {
    throw new Error(`Failed calculateLogCoordinate mid-left check: got ${midLeftCoord}`);
  }

  const midRightCoord = manager.calculateLogCoordinate(0.00265, 0.00260, 0.00250, 0.00270);
  if (midRightCoord <= 50 || midRightCoord >= 100) {
    throw new Error(`Failed calculateLogCoordinate mid-right check: got ${midRightCoord}`);
  }

  // 13. GAMA SPEC: POI Aggregation & Sources Integration
  manager.setPoiSources({
    getOpenOrders: () => [
      {
        id: 'ord-123',
        symbol: '1000PEPEUSDC',
        type: 'LIMIT',
        side: 'BUY',
        price: 0.00254,
        amount: 100000,
        filled: 0,
        remaining: 100000,
        status: 'OPEN',
        datetime: new Date().toISOString(),
      },
    ],
    getActiveProcesses: () => [
      {
        id: 42,
        pipeline_id: 1,
        symbol: '1000PEPEUSDC',
        status: 'WAITING_TP_FILL',
        sub_status: 'TP_PLACED',
        side: 'SELL',
        amount: 100000,
        last_order_price: 0.00266,
      },
    ],
  });

  const aggregatedPois = manager.getTacticalPois(sanitizedTrend);
  const hasFlip = aggregatedPois.some((p) => p.category === 'FLIP_TRIGGER');
  const hasEntry = aggregatedPois.some((p) => p.category === 'ENTRY_REF');
  const hasOrder = aggregatedPois.some((p) => p.id === 'poi-order-ord-123');
  const hasProc = aggregatedPois.some((p) => p.id === 'poi-proc-42');

  if (!hasFlip || !hasEntry || !hasOrder || !hasProc) {
    throw new Error(`Failed POI aggregation check: got ${JSON.stringify(aggregatedPois)}`);
  }

  // 14. GAMA SPEC: Clustering & Anti-Cluttering Engine
  const clusterTestPois = [
    { id: 'c1', price: 0.002550, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Order 1' },
    { id: 'c2', price: 0.002551, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Order 2' }, // Very close -> should cluster
    { id: 'c3', price: 0.002680, category: 'REAL_ORDER' as const, side: 'SELL' as const, label: 'Order 3' }, // Far -> separate
  ];
  const clusters = manager.clusterPois(clusterTestPois, 0.00260, 0.00250, 0.00270, 3.5);
  if (clusters.length !== 2) {
    throw new Error(`Failed clustering check: expected 2 clusters, got ${clusters.length}`);
  }
  if (clusters[0].pois.length !== 2 || clusters[1].pois.length !== 1) {
    throw new Error(`Failed clustering POI grouping check: got ${JSON.stringify(clusters)}`);
  }

  // 15. GAMA SPEC: In-place DOM Synchronization (Anti-Flickering Verification)
  if (typeof document !== 'undefined') {
    const mockContainer = document.createElement('div');
    manager.syncPinsDom(mockContainer, clusters, 6);
    const initialElements = Array.from(mockContainer.children);
    if (initialElements.length !== 2) {
      throw new Error(`Expected 2 elements in syncPinsDom, got ${initialElements.length}`);
    }
    const firstEl = initialElements[0];

    // Re-sync with updated positions: element reference MUST be preserved (in-place mutation)
    const movedClusters = [
      { ...clusters[0], x: clusters[0].x + 1 },
      { ...clusters[1], x: clusters[1].x - 1 },
    ];
    manager.syncPinsDom(mockContainer, movedClusters, 6);
    const updatedElements = Array.from(mockContainer.children);
    if (updatedElements[0] !== firstEl) {
      throw new Error('syncPinsDom failed to preserve existing DOM node reference in-place (flickering hazard)');
    }
  }

  // 16. GAMA SPEC: Kinematic Fluid Convergence Toward Center (50%)
  // Test case: Single solitary order moving from far (-1.0%) to near (1 tick away ~ -0.01%)
  const marketP = 0.00260;
  const floorPc = 0.005; // 0.5% base floor

  // A. When order is far (-1.0% = 0.002574)
  const farPoi = [{ id: 'far-1', price: 0.002574, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Buy Far' }];
  const extremaFar = manager.calculateViewportExtrema(marketP, farPoi, floorPc);
  const xCoordFar = manager.calculateLogCoordinate(0.002574, marketP, extremaFar.pMin, extremaFar.pMax);

  // B. When order is at moderate distance (-0.25% = 0.0025935)
  const midPoi = [{ id: 'mid-1', price: 0.0025935, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Buy Mid' }];
  const extremaMid = manager.calculateViewportExtrema(marketP, midPoi, floorPc);
  const xCoordMid = manager.calculateLogCoordinate(0.0025935, marketP, extremaMid.pMin, extremaMid.pMax);

  // C. When order is 1 tick away (-0.004% = 0.0025999)
  const oneTickPoi = [{ id: 'tick-1', price: 0.0025999, category: 'REAL_ORDER' as const, side: 'BUY' as const, label: 'Buy 1Tick' }];
  const extremaOneTick = manager.calculateViewportExtrema(marketP, oneTickPoi, floorPc);
  const xCoordOneTick = manager.calculateLogCoordinate(0.0025999, marketP, extremaOneTick.pMin, extremaOneTick.pMax);

  // Verification: The coordinate MUST move fluidly from extreme left (~4%) to center-adjacent (~49%)
  if (xCoordFar >= 15 || xCoordFar <= 0) {
    throw new Error(`Gama Kinematics Error: Far order expected in 0..15% range, got ${xCoordFar}`);
  }
  if (xCoordMid <= xCoordFar || xCoordMid >= 45) {
    throw new Error(`Gama Kinematics Error: Mid order expected between Far and near center, got ${xCoordMid}`);
  }
  if (xCoordOneTick < 48 || xCoordOneTick >= 50) {
    throw new Error(`Gama Kinematics Error: 1-tick order expected adjacent to center (48..49.99%), got ${xCoordOneTick}`);
  }

  return true;
}

// Direct execution when invoked as a script
if (typeof (globalThis as any).process !== 'undefined') {
  try {
    const result = runTriggerGaugeVerification();
    console.log('✅ TriggerGaugeManager verification suite PASSED successfully! Result:', result);
  } catch (err) {
    console.error('❌ TriggerGaugeManager verification suite FAILED:', err);
    throw err;
  }
}
