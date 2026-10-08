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

  // 10. Live onTick real-time price fluctuation check (Dummy UI centering & visual delta)
  manager.setStatus({
    instance_id: 8,
    symbol: '1000PEPEUSDC',
    strategy: 'GRID_POSITION_FLIPPER',
    condition_name: 'PULLBACK_CONMUTATOR',
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
    multiplier: 1.0,
    updated_at: Date.now() / 1000,
  });

  // Simulate tick down (adverse pullback increases to ~0.7692%)
  manager.onTick(0.0025800, 0.0025800);
  const updatedStatus = manager.getStatus();
  if (!updatedStatus || updatedStatus.current_price !== 0.00258 || updatedStatus.current_metric_pc < 0.75) {
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
  // NEW BEHAVIOR: overlapping spans MERGED into single channel (no escalera)
  if (laneResult.spans.length !== 1) {
    throw new Error(`Expected overlapping spans merged into 1 span, got ${laneResult.spans.length}`);
  }
  if (laneResult.totalLanes !== 1) {
    throw new Error(`Expected single channel (totalLanes=1), got ${laneResult.totalLanes}`);
  }
  if (laneResult.spans[0].lane !== 0) {
    throw new Error(`Expected merged span in lane 0, got lane ${laneResult.spans[0].lane}`);
  }
  // Verify mergedProcessIds contains both process IDs
  const mergedIds = laneResult.spans[0].mergedProcessIds;
  if (!mergedIds || mergedIds.length !== 2 || !mergedIds.includes(1) || !mergedIds.includes(2)) {
    throw new Error(`Expected mergedProcessIds=[1,2], got ${JSON.stringify(mergedIds)}`);
  }

  // 15. TACTICAL SPECTRUM: In-place DOM Synchronization for Spans (Anti-Flickering Verification)
  if (typeof document !== 'undefined') {
    const mockContainer = document.createElement('div');
    manager.syncSpansDom(mockContainer, laneResult.spans, 6, 0.00260);
    const initialElements = Array.from(mockContainer.children);
    // Now only 1 element (merged span)
    if (initialElements.length !== 1) {
      throw new Error(`Expected 1 element in syncSpansDom (merged), got ${initialElements.length}`);
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

  // 17. TACTICAL PROCESS GAPS: Pure Mathematical Edge-to-Edge Distance Calculation (Left as Reference)
  const leftRefSpans = [
    {
      id: 'span-left-1',
      processId: 10,
      side: 'SELL' as const,
      startPrice: 715,
      endPrice: 720,
      minPrice: 715,
      maxPrice: 720,
      status: 'WAITING_TP_FILL',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#10 SELL',
      subLabel: '',
    },
    {
      id: 'span-left-2',
      processId: 11,
      side: 'SELL' as const,
      startPrice: 725,
      endPrice: 730,
      minPrice: 725,
      maxPrice: 730,
      status: 'CHASING',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#11 SELL',
      subLabel: '',
    },
  ];

  // Market price at 710 -> Process #10 (mid 717.5, dist 7.5) is closer to market than #11 (mid 727.5, dist 17.5)
  const gapsLeftRef = manager.calculateProcessGaps(leftRefSpans, 710, 700, 750);
  if (gapsLeftRef.length !== 1) {
    throw new Error(`Expected 1 gap, got ${gapsLeftRef.length}`);
  }
  const gap1 = gapsLeftRef[0];
  if (gap1.referenceProcessId !== 10 || gap1.referenceSide !== 'LEFT' || gap1.referencePrice !== 720) {
    throw new Error(`Expected Left Process #10 as reference with price 720, got ${JSON.stringify(gap1)}`);
  }
  if (gap1.priceGap !== 5 || Math.abs(gap1.gapPercent - (5 / 720) * 100) > 0.0001 || gap1.isOverlap !== false) {
    throw new Error(`Invalid gap calculations: ${JSON.stringify(gap1)}`);
  }

  // 18. TACTICAL PROCESS GAPS: Right Process as Reference (Closer to Market Price)
  const rightRefSpans = [
    {
      id: 'span-r-1',
      processId: 20,
      side: 'BUY' as const,
      startPrice: 700,
      endPrice: 705,
      minPrice: 700,
      maxPrice: 705,
      status: 'CHASING',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#20 BUY',
      subLabel: '',
    },
    {
      id: 'span-r-2',
      processId: 21,
      side: 'BUY' as const,
      startPrice: 710,
      endPrice: 715,
      minPrice: 710,
      maxPrice: 715,
      status: 'WAITING_TP_FILL',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#21 BUY',
      subLabel: '',
    },
  ];

  // Market price at 720 -> Process #21 (mid 712.5, dist 7.5) is closer to market than #20 (mid 702.5, dist 17.5)
  const gapsRightRef = manager.calculateProcessGaps(rightRefSpans, 720, 690, 730);
  if (gapsRightRef.length !== 1) {
    throw new Error(`Expected 1 gap, got ${gapsRightRef.length}`);
  }
  const gap2 = gapsRightRef[0];
  if (gap2.referenceProcessId !== 21 || gap2.referenceSide !== 'RIGHT' || gap2.referencePrice !== 710) {
    throw new Error(`Expected Right Process #21 as reference with price 710, got ${JSON.stringify(gap2)}`);
  }
  if (gap2.priceGap !== 5 || Math.abs(gap2.gapPercent - (5 / 710) * 100) > 0.0001) {
    throw new Error(`Invalid gap calculations for right reference: ${JSON.stringify(gap2)}`);
  }

  // 19. TACTICAL PROCESS GAPS: Process Crossed by Center (Market Price)
  const centerCrossSpans = [
    {
      id: 'span-c-1',
      processId: 30,
      side: 'BUY' as const,
      startPrice: 705,
      endPrice: 715,
      minPrice: 705,
      maxPrice: 715,
      status: 'WAITING_TP_FILL',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#30 BUY',
      subLabel: '',
    },
    {
      id: 'span-c-2',
      processId: 31,
      side: 'SELL' as const,
      startPrice: 720,
      endPrice: 725,
      minPrice: 720,
      maxPrice: 725,
      status: 'CHASING',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#31 SELL',
      subLabel: '',
    },
  ];

  // Market at 710 (exact midpoint of #30, distance = 0)
  const gapsCenter = manager.calculateProcessGaps(centerCrossSpans, 710, 700, 730);
  const gap3 = gapsCenter[0];
  if (gap3.referenceProcessId !== 30 || gap3.referencePrice !== 715 || Math.abs(gap3.gapPercent - (5 / 715) * 100) > 0.0001) {
    throw new Error(`Center crossed process failed to act as reference: ${JSON.stringify(gap3)}`);
  }

  // 20. TACTICAL PROCESS GAPS: Overlapping Spans (Negative Edge-to-Edge Price Gap)
  const overlapSpans = [
    {
      id: 'span-o-1',
      processId: 40,
      side: 'BUY' as const,
      startPrice: 700,
      endPrice: 712,
      minPrice: 700,
      maxPrice: 712,
      status: 'CHASING',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#40 BUY',
      subLabel: '',
    },
    {
      id: 'span-o-2',
      processId: 41,
      side: 'SELL' as const,
      startPrice: 708,
      endPrice: 720,
      minPrice: 708,
      maxPrice: 720,
      status: 'WAITING_TP_FILL',
      amount: 1,
      xStart: 0,
      xEnd: 0,
      xLeft: 0,
      xRight: 0,
      widthPc: 0,
      lane: 0,
      label: '#41 SELL',
      subLabel: '',
    },
  ];

  const gapsOverlap = manager.calculateProcessGaps(overlapSpans, 705, 690, 730);
  const gapOverlap = gapsOverlap[0];
  if (gapOverlap.isOverlap !== true || gapOverlap.priceGap !== -4) {
    throw new Error(`Failed overlap detection: ${JSON.stringify(gapOverlap)}`);
  }

  // 21. TACTICAL PROCESS GAPS: DOM Synchronization & Rich Tooltip HTML
  if (typeof document !== 'undefined') {
    const mockContainer = document.createElement('div');
    manager.syncGapsDom(mockContainer, gapsLeftRef, 2, 710);
    if (mockContainer.children.length !== 1) {
      throw new Error(`Expected 1 gap element in syncGapsDom, got ${mockContainer.children.length}`);
    }
  }

  const gapTooltipHtml = manager.getGapTooltipHtml(gap1, 2, 710);
  if (!gapTooltipHtml.includes('DISTANCIA: #10 ➔ #11') || !gapTooltipHtml.includes('Proceso Referencia:') || !gapTooltipHtml.includes('#10')) {
    throw new Error(`Failed getGapTooltipHtml check: got ${gapTooltipHtml}`);
  }

  // 22. VIRTUAL EXIT / VIRTUAL_WATCHING PROCESS SPAN THEME & SSOT VERIFICATION
  const virtualSpanThemeBuy = manager.getProcessSpanTheme('BUY', 'VIRTUAL_WATCHING');
  if (
    !virtualSpanThemeBuy.isVirtual ||
    virtualSpanThemeBuy.color !== '#38bdf8' ||
    !virtualSpanThemeBuy.className.includes('virtual_watching') ||
    !virtualSpanThemeBuy.className.includes('buy') ||
    !virtualSpanThemeBuy.bg.includes('16, 185, 129') ||
    !virtualSpanThemeBuy.bg.includes('56, 189, 248')
  ) {
    throw new Error(`Failed virtualSpanThemeBuy check: ${JSON.stringify(virtualSpanThemeBuy)}`);
  }

  const virtualSpanThemeSell = manager.getProcessSpanTheme('SELL', 'VIRTUAL_WATCHING');
  if (
    !virtualSpanThemeSell.isVirtual ||
    virtualSpanThemeSell.color !== '#38bdf8' ||
    !virtualSpanThemeSell.className.includes('virtual_watching') ||
    !virtualSpanThemeSell.className.includes('sell') ||
    !virtualSpanThemeSell.bg.includes('239, 68, 68') ||
    !virtualSpanThemeSell.bg.includes('56, 189, 248')
  ) {
    throw new Error(`Failed virtualSpanThemeSell check: ${JSON.stringify(virtualSpanThemeSell)}`);
  }

  // WAITING_EXIT_FILL with default/fallback and explicit isVirtualExit
  const waitingExitDefaultTheme = manager.getProcessSpanTheme('BUY', 'WAITING_EXIT_FILL');
  if (!waitingExitDefaultTheme.isVirtual || waitingExitDefaultTheme.color !== '#38bdf8') {
    throw new Error(`Failed waitingExitDefaultTheme check: ${JSON.stringify(waitingExitDefaultTheme)}`);
  }

  const waitingExitExplicitPhysicalTheme = manager.getProcessSpanTheme('BUY', 'WAITING_EXIT_FILL', false);
  if (waitingExitExplicitPhysicalTheme.isVirtual || waitingExitExplicitPhysicalTheme.color !== '#10b981') {
    throw new Error(`Failed waitingExitExplicitPhysicalTheme check: ${JSON.stringify(waitingExitExplicitPhysicalTheme)}`);
  }

  const standardBuyTheme = manager.getProcessSpanTheme('BUY', 'CHASING');
  if (standardBuyTheme.isVirtual || standardBuyTheme.color !== '#10b981' || standardBuyTheme.className !== 'tactical-process-span buy') {
    throw new Error(`Failed standardBuyTheme check: ${JSON.stringify(standardBuyTheme)}`);
  }

  const standardSellTheme = manager.getProcessSpanTheme('SELL', 'CHASING');
  if (standardSellTheme.isVirtual || standardSellTheme.color !== '#ef4444' || standardSellTheme.className !== 'tactical-process-span sell') {
    throw new Error(`Failed standardSellTheme check: ${JSON.stringify(standardSellTheme)}`);
  }

  // 23. VIRTUAL_WATCHING / WAITING_EXIT_FILL SPAN TOOLTIP & DOM RECONCILIATION
  const virtualSpan: any = {
    id: 'proc-span-99',
    processId: 99,
    side: 'BUY' as const,
    startPrice: 700,
    endPrice: 710,
    minPrice: 700,
    maxPrice: 710,
    status: 'WAITING_EXIT_FILL',
    isVirtualExit: true,
    amount: 5,
    xStart: 0,
    xEnd: 0,
    xLeft: 45,
    xRight: 55,
    widthPc: 10,
    lane: 0,
    label: '#99 BUY',
    subLabel: 'WAITING_EXIT_FILL',
  };

  const virtualTooltipHtml = manager.getSpanTooltipHtml(virtualSpan, 2, 705);
  if (!virtualTooltipHtml.includes('ESPERANDO SALIDA VIRTUAL') || !virtualTooltipHtml.includes('#38bdf8')) {
    throw new Error(`Failed virtualTooltipHtml check: got ${virtualTooltipHtml}`);
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
