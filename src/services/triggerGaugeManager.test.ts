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

  // 11. TACTICAL SPECTRUM: Viewport Extrema Calculation with Spans & Trigger
  const testSpans = [
    {
      id: 'span-1',
      processId: 101,
      side: 'BUY' as const,
      startPrice: 0.00255,
      endPrice: 0.00262,
      minPrice: 0.00255,
      maxPrice: 0.00262,
      status: 'CHASING',
      amount: 50000,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#101 BUY',
      subLabel: 'CHASING',
    },
    {
      id: 'span-2',
      processId: 102,
      side: 'SELL' as const,
      startPrice: 0.00265,
      endPrice: 0.00258,
      minPrice: 0.00258,
      maxPrice: 0.00265,
      status: 'WAITING_TP_FILL',
      amount: 50000,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#102 SELL',
      subLabel: 'WAITING_TP_FILL',
    },
  ];
  const extrema = manager.calculateViewportExtrema(0.00260, 0.00254, testSpans);
  if (extrema.pMin >= 0.00254 || extrema.pMax <= 0.00265) {
    throw new Error(`Failed calculateViewportExtrema check: got pMin=${extrema.pMin}, pMax=${extrema.pMax}`);
  }

  // 12. TACTICAL SPECTRUM: Logarithmic Bipartite Projection (50% Center Guarantee)
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

  // 13. TACTICAL SPECTRUM: Process Spans Extraction & Side Theme
  manager.setPoiSources({
    getActiveProcesses: () => [
      {
        id: 42,
        pipeline_id: 1,
        symbol: '1000PEPEUSDC',
        status: 'WAITING_TP_FILL',
        sub_status: 'TP_PLACED',
        side: 'BUY',
        amount: 100000,
        initial_price: 0.00258,
        last_order_price: 0.00258,
        last_tick_price: 0.00261,
      },
      {
        id: 43,
        pipeline_id: 1,
        symbol: '1000PEPEUSDC',
        status: 'CHASING',
        sub_status: 'CHASING_MARKET',
        side: 'SELL',
        amount: 50000,
        initial_price: 0.00262,
        last_order_price: 0.00259,
      },
    ],
  });

  const extractedSpans = manager.getProcessSpans(sanitizedTrend);
  if (extractedSpans.length !== 2) {
    throw new Error(`Expected 2 extracted process spans, got ${extractedSpans.length}`);
  }
  const buySpan = extractedSpans.find((s) => s.processId === 42);
  const sellSpan = extractedSpans.find((s) => s.processId === 43);

  if (!buySpan || buySpan.side !== 'BUY' || buySpan.startPrice !== 0.00258) {
    throw new Error(`Failed buy span extraction: ${JSON.stringify(buySpan)}`);
  }
  if (!sellSpan || sellSpan.side !== 'SELL' || sellSpan.startPrice !== 0.00262) {
    throw new Error(`Failed sell span extraction: ${JSON.stringify(sellSpan)}`);
  }

  // 14. TACTICAL SPECTRUM: Tiered Lane Assignment (NO Merging / NO Fusion)
  const overlappingSpans = [
    {
      id: 'span-a',
      processId: 1,
      side: 'BUY' as const,
      startPrice: 0.00255,
      endPrice: 0.00265,
      minPrice: 0.00255,
      maxPrice: 0.00265,
      status: 'CHASING',
      amount: 10000,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#1 BUY',
      subLabel: '',
    },
    {
      id: 'span-b',
      processId: 2,
      side: 'SELL' as const,
      startPrice: 0.00258,
      endPrice: 0.00262,
      minPrice: 0.00258,
      maxPrice: 0.00262,
      status: 'WAITING_TP_FILL',
      amount: 20000,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#2 SELL',
      subLabel: '',
    },
  ];

  const laneResult = manager.projectAndAssignLanes(overlappingSpans, 0.00260, 0.00250, 0.00270);
  if (laneResult.spans.length !== 2) {
    throw new Error(`Expected both spans preserved without merging, got ${laneResult.spans.length}`);
  }
  if (laneResult.totalLanes < 2) {
    throw new Error(`Expected at least 2 stacked lanes for overlapping intervals, got ${laneResult.totalLanes}`);
  }
  if (laneResult.spans[0].lane === laneResult.spans[1].lane) {
    throw new Error(`Overlapping spans were placed in the same lane: lane 0 = ${laneResult.spans[0].lane}, lane 1 = ${laneResult.spans[1].lane}`);
  }

  // 15. TACTICAL SPECTRUM: In-place DOM Synchronization for Spans (Anti-Flickering Verification)
  if (typeof document !== 'undefined') {
    const mockContainer = document.createElement('div');
    manager.syncSpansDom(mockContainer, laneResult.spans, 6, 0.00260);
    const initialElements = Array.from(mockContainer.children);
    if (initialElements.length !== 2) {
      throw new Error(`Expected 2 elements in syncSpansDom, got ${initialElements.length}`);
    }
    const firstEl = initialElements[0];

    // Re-sync with updated positions: element reference MUST be preserved (in-place mutation)
    manager.syncSpansDom(mockContainer, laneResult.spans, 6, 0.00260);
    const updatedElements = Array.from(mockContainer.children);
    if (updatedElements[0] !== firstEl) {
      throw new Error('syncSpansDom failed to preserve existing DOM node reference in-place (flickering hazard)');
    }

    // Verify title attribute is NOT mutated (preventing OS native tooltip dismissal)
    if (firstEl.hasAttribute('title')) {
      throw new Error('syncSpansDom should not set native title attribute to prevent browser tooltip flickering');
    }
  }

  // 16. TACTICAL SPECTRUM: Rich Floating Tooltip HTML Generation
  const spanHtml = manager.getSpanTooltipHtml(buySpan, 6, 0.00260);
  if (!spanHtml.includes('PROCESO #42 (BUY)') || !spanHtml.includes('WAITING_TP_FILL') || !spanHtml.includes('100000')) {
    throw new Error(`Failed getSpanTooltipHtml check: got ${spanHtml}`);
  }

  const flipHtml = manager.getFlipTargetTooltipHtml(sanitizedTrend, 6);
  if (!flipHtml.includes('FLIP TARGET') || !flipHtml.includes('TREND_BUY') || !flipHtml.includes('0.002581')) {
    throw new Error(`Failed getFlipTargetTooltipHtml check: got ${flipHtml}`);
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
