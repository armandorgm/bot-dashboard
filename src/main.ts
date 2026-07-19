import { invoke } from "@tauri-apps/api/core";

interface InstanceConfig {
  instance_id: string;
  symbol: string;
  port: string;
  parent_api_port: string;
}

interface TickData {
  time: number;
  bid: number;
  ask: number;
}

// Global state variables

interface HftEvent {
  e: 'HFT_EVENT';
  type: 'buy' | 'sell' | 'cancel' | 'query' | 'buy_placed' | 'sell_placed' | 'cancel_failed' | 'cancel_buy' | 'cancel_sell' | 'cancel_buy_failed' | 'cancel_sell_failed';
  time: number;
  price?: number;
  qty?: number;
  symbol: string;
  orderId?: string;
  detail: string;
}

interface VisualMarker {
  x: number;
  y: number;
  events: HftEvent[];
}

interface OpenOrder {
  id: string;
  symbol: string;
  type: string;
  side: string;
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  status: string;
  datetime: string;
}

let history: TickData[] = [];
let hftEvents: HftEvent[] = [];
let openOrders: OpenOrder[] = [];
let maxPoints = 150;
let tickTimes: number[] = [];
let hz = 0;
let mouseX: number | null = null;
let mouseY: number | null = null;
let activeMarkers: VisualMarker[] = [];

// DOM references
let botTitleEl: HTMLElement | null = null;
let connBadgeEl: HTMLElement | null = null;
let connLedEl: HTMLElement | null = null;
let connTextEl: HTMLElement | null = null;
let symbolDisplayEl: HTMLElement | null = null;
let instanceIdDisplayEl: HTMLElement | null = null;
let portDisplayEl: HTMLElement | null = null;

let bidValEl: HTMLElement | null = null;
let askValEl: HTMLElement | null = null;
let spreadValEl: HTMLElement | null = null;
let feedRateValEl: HTMLElement | null = null;

let placedSuccessValEl: HTMLElement | null = null;
let placedFailedValEl: HTMLElement | null = null;
let modifiedValEl: HTMLElement | null = null;
let buySellValEl: HTMLElement | null = null;

let canvasEl: HTMLCanvasElement | null = null;
let samplesSelectEl: HTMLSelectElement | null = null;
let logConsoleEl: HTMLElement | null = null;
let clearLogBtnEl: HTMLElement | null = null;
let modsListEl: HTMLElement | null = null;
let openOrdersWrapperEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;

// Getted config
let config: InstanceConfig = { instance_id: "--", symbol: "--", port: "12001", parent_api_port: "8000" };

// Parse URL parameters for browser/dev-server debug mode
const urlParams = new URLSearchParams(window.location.search);
const qPort = urlParams.get('port');
const qId = urlParams.get('instance_id');
const qSym = urlParams.get('symbol');
if (qPort) config.port = qPort;
if (qId) config.instance_id = qId;
if (qSym) config.symbol = qSym;

// Log helper
function addLog(text: string, type: 'info' | 'warn' | 'err' | 'success' = 'info') {
  if (!logConsoleEl) return;
  const time = new Date().toLocaleTimeString();
  const row = document.createElement("div");
  row.className = `log-row ${type}`;
  
  const timeSpan = document.createElement("span");
  timeSpan.style.color = "#4b5563";
  timeSpan.textContent = `[${time}]`;
  
  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  
  row.appendChild(timeSpan);
  row.appendChild(textSpan);
  
  logConsoleEl.appendChild(row);
  logConsoleEl.scrollTop = logConsoleEl.scrollHeight;

  // Prune rows if too many
  while (logConsoleEl.children.length > 100) {
    logConsoleEl.removeChild(logConsoleEl.firstChild!);
  }
}

// Formatting helper
function formatNum(num: number, decimals: number = 6): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Chart drawing
function drawChart() {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;

  const width = canvasEl.width;
  const height = canvasEl.height;

  // Fondo premium ultra oscuro
  ctx.fillStyle = '#060913';
  ctx.fillRect(0, 0, width, height);

  if (history.length < 2) {
    ctx.fillStyle = '#475569';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAITING FOR TICKER FEED DATA FROM BOT...', width / 2, height / 2);
    return;
  }

  // Calcular límites de la ventana visible
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const pt of history) {
    if (pt.bid > 0 && pt.bid < minVal) minVal = pt.bid;
    if (pt.ask > 0 && pt.ask > maxVal) maxVal = pt.ask;
  }

  if (minVal === Infinity || maxVal === -Infinity) {
    minVal = 0.0000001;
    maxVal = 0.004;
  }

  // Auto-escalado logarítmico (padding multiplicativo) exactamente como en exchangeMock
  const yMin = minVal * 0.9;
  const yMax = maxVal * 1.1;

  const logMin = Math.log(yMin);
  const logMax = Math.log(yMax);
  const logRange = logMax - logMin;

  const rightMargin = 110;
  const chartWidth = width - rightMargin;

  // Dibujar rejilla (Grid Lines)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  const gridCount = 4;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  for (let i = 0; i <= gridCount; i++) {
    const y = (i / gridCount) * (height - 50) + 15;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartWidth, y);
    ctx.stroke();

    const t = 1 - (i / gridCount);
    const logVal = logMin + t * logRange;
    const priceVal = Math.exp(logVal);
    ctx.fillText(priceVal.toFixed(config.symbol.toLowerCase().includes("pepe") ? 8 : 4), chartWidth + 6, y);
  }

  // Mapeo de coordenadas X e Y
  const getX = (index: number) => {
    const shiftX = chartWidth / (maxPoints - 1);
    return index * shiftX;
  };
  
  const getY = (price: number) => {
    const p = price > 0 ? price : yMin;
    const logPrice = Math.log(p);
    return height - 35 - ((logPrice - logMin) / logRange) * (height - 50);
  };

  // Helper to calculate X for a given timestamp
  const getXForTime = (time: number) => {
    if (history.length === 0) return 0;
    if (time <= history[0].time) return getX(0);
    if (time >= history[history.length - 1].time) return getX(history.length - 1);
    
    for (let i = 0; i < history.length - 1; i++) {
      const t0 = history[i].time;
      const t1 = history[i + 1].time;
      if (time >= t0 && time <= t1) {
        const ratio = (time - t0) / (t1 - t0);
        return getX(i + ratio);
      }
    }
    return getX(history.length - 1);
  };

  // 1. Dibujar área de Spread sombreada
  ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].bid));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(i), getY(history[i].bid));
  }
  for (let i = history.length - 1; i >= 0; i--) {
    ctx.lineTo(getX(i), getY(history[i].ask));
  }
  ctx.closePath();
  ctx.fill();

  // 2. Dibujar línea de Bid (Verde HFT)
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].bid));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(i), getY(history[i].bid));
  }
  ctx.stroke();

  // 3. Dibujar línea de Ask (Rojo HFT)
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].ask));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(i), getY(history[i].ask));
  }
  ctx.stroke();

  // 4. Calcular y dibujar eventos HFT con clustering (solo queries) y offsets ante solapamiento
  const tMin = history[0].time;
  const tMax = history[history.length - 1].time;
  const visibleEvents = hftEvents.filter(e => e.time >= tMin && e.time <= tMax);

  const queryEvents = visibleEvents.filter(e => e.type === 'query');
  const tradingEvents = visibleEvents.filter(e => e.type !== 'query');

  activeMarkers = [];
  const clusterRadius = 12; // pixels

  // 1. Cluster de consultas HTTP genéricas (queries) en la barra superior
  for (const evt of queryEvents) {
    const x = getXForTime(evt.time);
    const y = 25; // fixed top track
    let merged = false;
    for (const marker of activeMarkers) {
      const dx = Math.abs(marker.x - x);
      if (dx < clusterRadius && marker.events[0].type === 'query') {
        marker.events.push(evt);
        merged = true;
        break;
      }
    }
    if (!merged) {
      activeMarkers.push({ x, y, events: [evt] });
    }
  }

  // 2. Colocación de eventos de trading individuales sin clústeres, usando un offset horizontal acumulativo ante solapamientos
  const positionOccupancy: Record<string, number> = {};

  for (const evt of tradingEvents) {
    let x = getXForTime(evt.time);
    let y = 0;
    if (evt.price) {
      y = getY(evt.price);
    } else {
      y = height / 2;
    }

    // Cuantización de tiempo (500ms) y precio estable para evitar parpadeos
    const bucketTime = Math.round(evt.time / 500) * 500;
    const bucketPrice = evt.price || 0;
    const key = `${bucketTime},${bucketPrice}`;
    const occupancy = positionOccupancy[key] || 0;
    positionOccupancy[key] = occupancy + 1;

    const offsetX = occupancy * 10;
    x = x + offsetX;

    activeMarkers.push({ x, y, events: [evt] });
  }

  // 3. Dibujar líneas rectas discontinuas de precios de órdenes desde su creación (placed) hasta su cierre (fill o cancel)
  hftEvents.forEach((placedEvt) => {
    if (placedEvt.type === 'buy_placed' || placedEvt.type === 'sell_placed') {
      const orderId = placedEvt.orderId;
      if (!orderId) return;

      // Buscar el evento de cierre correspondiente en todo el historial
      const closingEvt = hftEvents.find(
        (e) =>
          e.orderId !== undefined &&
          String(e.orderId) === String(orderId) &&
          ['buy', 'sell', 'cancel', 'cancel_buy', 'cancel_sell', 'cancel_buy_failed', 'cancel_sell_failed'].includes(e.type) &&
          e.time >= placedEvt.time
      );

      const tStart = placedEvt.time;
      const tEnd = closingEvt ? closingEvt.time : tMax;

      // Dibujar si la línea intersecta la ventana de tiempo visible
      if (tEnd >= tMin && tStart <= tMax) {
        const xStart = getXForTime(Math.max(tStart, tMin));
        const xEnd = getXForTime(Math.min(tEnd, tMax));
        const yVal = getY(placedEvt.price || 0);

        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = placedEvt.type === 'buy_placed' ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
        ctx.moveTo(xStart, yVal);
        ctx.lineTo(xEnd, yVal);
        ctx.stroke();
        ctx.restore();
      }
    }
  });

  // Dibujar marcadores de eventos
  for (const m of activeMarkers) {
    if (m.events.length > 1) {
      // Draw cluster marker
      ctx.beginPath();
      ctx.arc(m.x, m.y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#4f46e5'; // Premium indigo cluster
      ctx.fill();
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw count text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.events.length.toString(), m.x, m.y);
    } else {
      const evt = m.events[0];
      
      if (evt.type === 'buy') {
        // Draw green triangle pointing up
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 6);
        ctx.lineTo(m.x - 5, m.y + 4);
        ctx.lineTo(m.x + 5, m.y + 4);
        ctx.closePath();
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else if (evt.type === 'buy_placed') {
        // Draw hollow green triangle pointing up
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 6);
        ctx.lineTo(m.x - 5, m.y + 4);
        ctx.lineTo(m.x + 5, m.y + 4);
        ctx.closePath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fill();
      } else if (evt.type === 'sell') {
        // Draw red triangle pointing down
        ctx.beginPath();
        ctx.moveTo(m.x, m.y + 6);
        ctx.lineTo(m.x - 5, m.y - 4);
        ctx.lineTo(m.x + 5, m.y - 4);
        ctx.closePath();
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else if (evt.type === 'sell_placed') {
        // Draw hollow red triangle pointing down
        ctx.beginPath();
        ctx.moveTo(m.x, m.y + 6);
        ctx.lineTo(m.x - 5, m.y - 4);
        ctx.lineTo(m.x + 5, m.y - 4);
        ctx.closePath();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.fill();
      } else if (evt.type === 'cancel' || evt.type === 'cancel_buy' || evt.type === 'cancel_sell') {
        // Draw color-coded cross
        const crossColor = evt.type === 'cancel_buy' ? '#10b981' : evt.type === 'cancel_sell' ? '#ef4444' : '#f59e0b';
        ctx.strokeStyle = crossColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(m.x - 4, m.y - 4);
        ctx.lineTo(m.x + 4, m.y + 4);
        ctx.moveTo(m.x + 4, m.y - 4);
        ctx.lineTo(m.x - 4, m.y + 4);
        ctx.stroke();
      } else if (evt.type === 'cancel_failed' || evt.type === 'cancel_buy_failed' || evt.type === 'cancel_sell_failed') {
        // Draw color-coded cross with red warning circle (aro rojo)
        const crossColor = evt.type === 'cancel_buy_failed' ? '#10b981' : '#ef4444';
        ctx.strokeStyle = crossColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(m.x - 5, m.y - 5);
        ctx.lineTo(m.x + 5, m.y + 5);
        ctx.moveTo(m.x + 5, m.y - 5);
        ctx.lineTo(m.x - 5, m.y + 5);
        ctx.stroke();

        // Red outer warning circle (aro rojo)
        ctx.beginPath();
        ctx.arc(m.x, m.y, 8, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (evt.type === 'query') {
        // Draw blue query circle
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#60a5fa';
        ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.stroke();
      }
    }
  }

  // Current values indicators (Right Y axis tags)
  const latest = history[history.length - 1];
  const yBid = getY(latest.bid);
  const yAsk = getY(latest.ask);
  const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;

  // Bid flag
  ctx.fillStyle = '#10b981';
  ctx.fillRect(chartWidth + 3, yBid - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#030712';
  ctx.font = 'bold 8px "JetBrains Mono", monospace';
  ctx.fillText(`B: ${latest.bid.toFixed(decimals)}`, chartWidth + 6, yBid);

  // Ask flag
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(chartWidth + 3, yAsk - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 8px "JetBrains Mono", monospace';
  ctx.fillText(`A: ${latest.ask.toFixed(decimals)}`, chartWidth + 6, yAsk);

  // Barra de Telemetría inferior
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(0, height - 22, width, 22);
  
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const spread = latest.ask - latest.bid;
  ctx.fillText(
    `SPREAD: ${spread.toFixed(decimals)} | MIN: ${minVal.toFixed(decimals)} | MAX: ${maxVal.toFixed(decimals)} | MOTOR: ${hz} Hz | MUESTRAS: ${history.length}/${maxPoints}`,
    10,
    height - 11
  );

  // Crosshair e imantación (snap)
  if (mouseX !== null && mouseY !== null) {
    let snapX = mouseX;
    let snapY = mouseY;
    let isSnapped = false;

    // Buscar el marcador de evento más cercano para hacer "snap" magnético
    let closestMarker = null;
    let minDist = 15; // radio de 15px
    for (const marker of activeMarkers) {
      const dx = mouseX - marker.x;
      const dy = mouseY - marker.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closestMarker = marker;
      }
    }

    let snappedTime = 0;
    let snappedPrice = 0;

    // Calcular valores por interpolación de coordenadas de mouse
    const shiftX = chartWidth / (maxPoints - 1);
    const index = snapX / shiftX;
    const i0 = Math.floor(index);
    const i1 = Math.min(history.length - 1, Math.ceil(index));
    if (i0 >= 0 && i1 < history.length) {
      const t0 = history[i0].time;
      const t1 = history[i1].time;
      const ratio = index - i0;
      snappedTime = t0 + ratio * (t1 - t0);
    } else if (history.length > 0) {
      snappedTime = history[history.length - 1].time;
    }

    // Snap price (logarithmic formula based on canvas Y metrics)
    const yFrac = (height - 35 - snapY) / (height - 50);
    const logPrice = logMin + yFrac * logRange;
    snappedPrice = Math.exp(logPrice);

    // Si hay un marcador cerca, imantar el cursor
    if (closestMarker) {
      snapX = closestMarker.x;
      snapY = closestMarker.y;
      isSnapped = true;

      const firstEvt = closestMarker.events[0];
      snappedTime = firstEvt.time;
      snappedPrice = firstEvt.price || snappedPrice;
    }

    // Dibujar líneas discontinuas de la retícula
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([3, 3]);

    // Línea vertical
    ctx.beginPath();
    ctx.moveTo(snapX, 15);
    ctx.lineTo(snapX, height - 22);
    ctx.stroke();

    // Línea horizontal
    ctx.beginPath();
    ctx.moveTo(0, snapY);
    ctx.lineTo(chartWidth, snapY);
    ctx.stroke();
    ctx.restore();

    // Dibujar etiqueta flotante del eje X (Timestamp)
    const date = new Date(snappedTime);
    const timeStr = date.toLocaleTimeString('es-ES', { hour12: false });
    ctx.font = '9px "JetBrains Mono", monospace';
    const tWidth = ctx.measureText(timeStr).width;
    const tBadgeW = tWidth + 10;
    const tBadgeH = 14;
    const tBadgeX = Math.max(0, Math.min(chartWidth - tBadgeW, snapX - tBadgeW / 2));
    const tBadgeY = height - 22 - tBadgeH;

    ctx.save();
    ctx.fillStyle = isSnapped ? '#4f46e5' : 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(tBadgeX, tBadgeY, tBadgeW, tBadgeH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, tBadgeX + tBadgeW / 2, tBadgeY + tBadgeH / 2);
    ctx.restore();

    // Dibujar etiqueta flotante del eje Y (Precio)
    const priceStr = formatNum(snappedPrice, decimals);
    const pWidth = ctx.measureText(priceStr).width;
    const pBadgeW = pWidth + 8;
    const pBadgeH = 14;
    const pBadgeX = width - pBadgeW - 2;
    const pBadgeY = Math.max(15, Math.min(height - 22 - pBadgeH, snapY - pBadgeH / 2));

    ctx.save();
    ctx.fillStyle = isSnapped ? '#4f46e5' : 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(pBadgeX, pBadgeY, pBadgeW, pBadgeH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceStr, pBadgeX + pBadgeW / 2, pBadgeY + pBadgeH / 2);
    ctx.restore();
  }
}





// Websocket integration
function connectWebSocket() {
  const wsUrl = `ws://127.0.0.1:${config.port}/ws/notifications`;
  addLog(`Connecting to local bot WebSocket at ${wsUrl}...`, 'info');
  
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      connBadgeEl.style.background = 'rgba(16, 185, 129, 0.05)';
      connLedEl.className = 'led led-green';
      connTextEl.textContent = 'CONNECTED';
    }
    addLog(`WebSocket connection established! Listening for 5ms telemetry stream.`, 'success');
    // Fetch latest open orders to sync
    fetchOpenOrders();
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      
      if (payload.type === 'ticker_update' && payload.data) {
        const bidVal = Number(payload.data.bid);
        const askVal = Number(payload.data.ask);
        const spread = askVal - bidVal;

        // Direct-to-DOM HFT value updates bypassing any virtual DOM
        const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;
        if (bidValEl) bidValEl.innerText = formatNum(bidVal, decimals);
        if (askValEl) askValEl.innerText = formatNum(askVal, decimals);
        if (spreadValEl) spreadValEl.innerText = formatNum(spread, decimals);

        // Feed frequency calculations
        const nowMs = performance.now();
        tickTimes.push(nowMs);
        tickTimes = tickTimes.filter(t => nowMs - t < 1000);
        hz = tickTimes.length;
        if (feedRateValEl) feedRateValEl.innerText = `${hz} Hz`;

        // Update canvas values
        history.push({ time: Date.now(), bid: bidVal, ask: askVal });
        if (history.length > maxPoints) {
          history.shift();
        }
        drawChart();
      }
      else if (payload.type === 'stats_update' && payload.data) {
        const d = payload.data;
        if (placedSuccessValEl) placedSuccessValEl.innerText = d.placed_success.toString();
        if (placedFailedValEl) placedFailedValEl.innerText = d.placed_failed.toString();
        if (modifiedValEl) modifiedValEl.innerText = d.modified.toString();
        if (buySellValEl) buySellValEl.innerText = `${d.buys} / ${d.sells}`;
        if (modsListEl && d.last_modifications) {
          updateModificationsList(d.last_modifications);
        }
      }
      else if (payload.type === 'order_update' && payload.data) {
        const d = payload.data;
        const msg = `[ORDER] ${d.side} ${d.qty} ${d.symbol} @ ${d.price} | Status: ${d.status} | Reason: ${d.reason || '-'}`;
        addLog(msg, (d.status || '').toUpperCase() === 'FILLED' ? 'success' : ((d.status || '').toUpperCase() === 'FAILED' || (d.status || '').toUpperCase() === 'REJECTED') ? 'err' : 'info');

        let priceVal = Number(d.price);
        if ((!priceVal || priceVal <= 0) && history.length > 0) {
          const latest = history[history.length - 1];
          priceVal = d.side.toLowerCase() === 'buy' ? latest.bid : latest.ask;
        }

        const statusUpper = (d.status || '').toUpperCase();
        let eventType: 'buy' | 'sell' | 'cancel' | 'query' | 'buy_placed' | 'sell_placed' | 'cancel_failed' | 'cancel_buy' | 'cancel_sell' | 'cancel_buy_failed' | 'cancel_sell_failed' = 'query';
        
        const isBuy = (d.side || '').toUpperCase() === 'BUY';
        if (statusUpper === 'NEW' || statusUpper === 'PARTIALLY_FILLED') {
          eventType = isBuy ? 'buy_placed' : 'sell_placed';
        } else if (statusUpper === 'FILLED') {
          eventType = isBuy ? 'buy' : 'sell';
        } else if (statusUpper === 'CANCELED' || statusUpper === 'EXPIRED') {
          eventType = isBuy ? 'cancel_buy' : 'cancel_sell';
        } else if (statusUpper === 'FAILED' || statusUpper === 'REJECTED') {
          eventType = isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed';
        }

        hftEvents.push({
          e: 'HFT_EVENT',
          type: eventType,
          time: Date.now(),
          price: priceVal,
          qty: Number(d.qty || d.z || 0),
          symbol: d.symbol,
          orderId: d.id,
          detail: msg
        });

        if (hftEvents.length > 500) {
          hftEvents.shift();
        }

        // Reactively update openOrders
        if (statusUpper === 'NEW' || statusUpper === 'PARTIALLY_FILLED') {
          const newOrder: OpenOrder = {
            id: d.id || '',
            symbol: d.symbol,
            type: d.type || 'LIMIT',
            side: d.side || 'BUY',
            price: Number(d.price || 0),
            amount: Number(d.qty || 0),
            filled: Number(d.z || 0),
            remaining: Number(d.qty || 0) - Number(d.z || 0),
            status: statusUpper,
            datetime: new Date().toISOString()
          };
          if (!openOrders.some(o => o.id === newOrder.id)) {
            openOrders.push(newOrder);
          } else {
            openOrders = openOrders.map(o => o.id === newOrder.id ? newOrder : o);
          }
        } else if (['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED', 'FAILED'].includes(statusUpper)) {
          openOrders = openOrders.filter(o => o.id !== d.id);
        }
        renderOpenOrders();

        drawChart();
      }
      else if (payload.type === 'modifications_update' && payload.data) {
        updateModificationsList(payload.data);
      }
      else if (payload.type === 'query_log' && payload.data) {
        const d = payload.data;
        const isCancelQuery = d.method.toUpperCase().includes("DELETE /FAPI/V1/ORDER") || d.method.toLowerCase().includes("cancel_order");
        if (d.is_error && isCancelQuery) {
          let orderId = "";
          const paramsStr = typeof d.parameters === 'string' ? d.parameters : JSON.stringify(d.parameters);
          const idMatch = paramsStr.match(/orderId['"\s:]+([0-9a-zA-Z_-]+)/i) || paramsStr.match(/id['"\s:]+([0-9a-zA-Z_-]+)/i);
          if (idMatch) orderId = idMatch[1];
          
          let priceVal = history.length > 0 ? history[history.length - 1].bid : 0;
          let isBuy = true;
          
          const existingOrder = openOrders.find(o => String(o.id) === String(orderId)) || 
                                hftEvents.find(e => e.orderId && String(e.orderId) === String(orderId));
          if (existingOrder) {
            priceVal = existingOrder.price || priceVal;
            isBuy = ('side' in existingOrder) ? (existingOrder.side.toUpperCase() === 'BUY') : true;
          }
          
          hftEvents.push({
            e: 'HFT_EVENT',
            type: isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed',
            time: d.timestamp || Date.now(),
            price: priceVal,
            qty: 0,
            symbol: config.symbol,
            orderId: orderId,
            detail: `Failed cancellation: ${d.error || 'Unknown error'}`
          });
          
          if (hftEvents.length > 500) {
            hftEvents.shift();
          }
          addLog(`[CANCEL ERROR] Failed to cancel order #${orderId}: ${d.error || 'Unknown error'}`, 'err');
          drawChart();
        } else {
          const priceVal = history.length > 0 ? history[history.length - 1].bid : 0;
          const timeVal = d.timestamp || Date.now();
          
          hftEvents.push({
            e: 'HFT_EVENT',
            type: 'query',
            time: timeVal,
            price: priceVal,
            qty: 0,
            symbol: config.symbol,
            detail: `${d.method} | Params: ${JSON.stringify(d.parameters)}`
          });
          
          if (hftEvents.length > 500) {
            hftEvents.shift();
          }

          if (d.is_error) {
            addLog(`[QUERY ERROR] ${d.method} failed: ${d.error || 'Unknown error'}`, 'err');
          }
          
          drawChart();
        }
      }
      else if (payload.type === 'ws_log' && payload.data) {
        const d = payload.data;
        console.debug(`[WS PACKET] ${d.url} - Size: ${d.length} bytes - Snippet: ${d.snippet}`);
      }
      else {
        const type = payload.type || 'EVENT';
        const rawString = JSON.stringify(payload.data || payload);
        addLog(`[${type}] ${rawString}`, 'info');
      }
    } catch (e) {
      console.error("Error parsing websocket message", e);
    }
  };

  ws.onclose = () => {
    if (connBadgeEl && connLedEl && connTextEl) {
      connBadgeEl.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      connBadgeEl.style.background = 'rgba(239, 68, 68, 0.05)';
      connLedEl.className = 'led led-red';
      connTextEl.textContent = 'DISCONNECTED';
    }
    addLog(`WebSocket disconnected. Retrying in 3s...`, 'err');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Sizing logic
function handleResize() {
  if (!canvasEl) return;
  const rect = canvasEl.parentElement!.getBoundingClientRect();
  canvasEl.width = rect.width;
  canvasEl.height = rect.height;
  drawChart();
}

// Open Orders management
async function fetchOpenOrders() {
  const parentPort = config.parent_api_port || "8000";
  try {
    const response = await fetch(`http://127.0.0.1:${parentPort}/api/orders/open`);
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data)) {
        // Normalize symbol comparison
        const activeSymbol = config.symbol.replace("/", "").replace(":", "").toUpperCase();
        openOrders = data.filter((o: any) => {
          const oSym = o.symbol.replace("/", "").replace(":", "").toUpperCase();
          return oSym === activeSymbol;
        }).map((o: any) => ({
          id: o.id,
          symbol: o.symbol,
          type: o.type,
          side: o.side,
          price: Number(o.price || 0),
          amount: Number(o.amount || 0),
          filled: Number(o.filled || 0),
          remaining: Number(o.remaining || 0),
          status: o.status,
          datetime: o.datetime
        }));
        renderOpenOrders();
      }
    }
  } catch (err) {
    console.error("Failed to fetch initial open orders:", err);
  }
}

function renderOpenOrders() {
  if (!openOrdersWrapperEl) return;
  
  if (openOrders.length === 0) {
    openOrdersWrapperEl.innerHTML = `
      <div class="open-orders-empty">
        <span>📭</span>
        <span>No open orders on the grid.</span>
      </div>
    `;
    return;
  }

  const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;
  
  let html = `
    <table class="open-orders-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>SYMBOL</th>
          <th>SIDE</th>
          <th>PRICE</th>
          <th>AMOUNT</th>
          <th>FILLED</th>
          <th>REMAINING</th>
          <th>TYPE</th>
          <th style="text-align: center;">ACTION</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const order of openOrders) {
    const isBuy = order.side.toUpperCase() === 'BUY';
    const sideClass = isBuy ? 'buy' : 'sell';
    const sideText = order.side.toUpperCase();
    const formattedPrice = Number(order.price).toFixed(decimals);
    const formattedAmount = Number(order.amount).toFixed(2);
    const formattedFilled = Number(order.filled).toFixed(2);
    const formattedRemaining = Number(order.remaining).toFixed(2);

    html += `
      <tr>
        <td style="color: var(--text-secondary);">#${order.id}</td>
        <td style="font-weight: 700;">${order.symbol}</td>
        <td>
          <span class="open-orders-side ${sideClass}">${sideText}</span>
        </td>
        <td style="font-weight: 700;">$${formattedPrice}</td>
        <td style="color: #e5e7eb;">${formattedAmount}</td>
        <td style="color: var(--text-secondary);">${formattedFilled}</td>
        <td style="color: #f3f4f6;">${formattedRemaining}</td>
        <td style="color: var(--text-secondary);">${order.type}</td>
        <td style="text-align: center;">
          <button class="btn-cancel-order" data-id="${order.id}" data-symbol="${order.symbol}">CANCEL</button>
        </td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  openOrdersWrapperEl.innerHTML = html;

  // Bind cancel buttons
  const buttons = openOrdersWrapperEl.querySelectorAll('.btn-cancel-order');
  buttons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const orderId = target.getAttribute('data-id')!;
      const orderSym = target.getAttribute('data-symbol')!;
      await cancelOrder(orderId, orderSym);
      // Optimistically remove or trigger refresh
      openOrders = openOrders.filter(o => o.id !== orderId);
      renderOpenOrders();
    });
  });
}

async function cancelOrder(orderId: string, symbol: string) {
  const orderObj = openOrders.find(o => String(o.id) === String(orderId));
  try {
    addLog(`Sending cancellation request for order #${orderId}...`, 'info');
    let binanceSymbol = symbol.replace("/", "").replace(":", "");
    const response = await fetch(`http://localhost:8001/fapi/v1/order?symbol=${binanceSymbol}&orderId=${orderId}`, {
      method: 'DELETE',
    });
    let resData: any = {};
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      resData = await response.json();
    } else {
      resData = { msg: await response.text() };
    }
    if (!response.ok) {
      throw new Error(resData.msg || 'Error processing cancellation');
    }
    addLog(`Order #${orderId} cancelled successfully on exchange.`, 'success');
  } catch (err: any) {
    addLog(`Error cancelling order #${orderId}: ${err.message}`, 'err');
    if (orderObj) {
      const isBuy = orderObj.side.toUpperCase() === 'BUY';
      hftEvents.push({
        e: 'HFT_EVENT',
        type: isBuy ? 'cancel_buy_failed' : 'cancel_sell_failed',
        time: Date.now(),
        price: orderObj.price,
        qty: orderObj.amount,
        symbol: symbol,
        orderId: orderId,
        detail: `Cancellation failed: ${err.message}`
      });
      if (hftEvents.length > 500) {
        hftEvents.shift();
      }
      drawChart();
    }
  }
}

// Init procedure
window.addEventListener("DOMContentLoaded", async () => {
  // Query UI selectors
  botTitleEl = document.getElementById("bot-title");
  connBadgeEl = document.getElementById("conn-badge");
  connLedEl = document.getElementById("conn-led");
  connTextEl = document.getElementById("conn-text");
  symbolDisplayEl = document.getElementById("symbol-display");
  instanceIdDisplayEl = document.getElementById("instance-id-display");
  portDisplayEl = document.getElementById("port-display");
  
  bidValEl = document.getElementById("bid-val");
  askValEl = document.getElementById("ask-val");
  spreadValEl = document.getElementById("spread-val");
  feedRateValEl = document.getElementById("feed-rate-val");

  placedSuccessValEl = document.getElementById("placed-success-val");
  placedFailedValEl = document.getElementById("placed-failed-val");
  modifiedValEl = document.getElementById("modified-val");
  buySellValEl = document.getElementById("buy-sell-val");

  canvasEl = document.getElementById("hft-chart") as HTMLCanvasElement;
  modsListEl = document.getElementById("mods-list");
  openOrdersWrapperEl = document.getElementById("open-orders-wrapper");
  tooltipEl = document.getElementById("chart-tooltip");
  samplesSelectEl = document.getElementById("samples-select") as HTMLSelectElement;
  logConsoleEl = document.getElementById("log-console");
  clearLogBtnEl = document.getElementById("clear-log-btn");

  if (canvasEl) {
    canvasEl.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = canvasEl!.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;

      let hoverMarker: VisualMarker | null = null;
      for (const marker of activeMarkers) {
        const dx = mouseX! - marker.x;
        const dy = mouseY! - marker.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 15) {
          hoverMarker = marker;
          break;
        }
      }

      if (hoverMarker) {
        if (tooltipEl) {
          tooltipEl.style.display = 'block';
          
          const tooltipWidth = 250;
          const tooltipHeight = 80;
          let leftPos = mouseX! + 15;
          let topPos = mouseY! + 15;
          
          if (mouseX! > rect.width - tooltipWidth) {
            leftPos = mouseX! - tooltipWidth - 10;
          }
          if (mouseY! > rect.height - tooltipHeight) {
            topPos = mouseY! - tooltipHeight - 10;
          }
          
          tooltipEl.style.left = `${leftPos}px`;
          tooltipEl.style.top = `${topPos}px`;
          
          let content = `<div style="font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px; color: #60a5fa;">`;
          content += hoverMarker.events.length > 1 ? `Cluster: ${hoverMarker.events.length} Eventos` : `Detalle del Evento`;
          content += `</div>`;
          
          hoverMarker.events.forEach((evt, idx) => {
            const timeStr = new Date(evt.time).toLocaleTimeString();
            const typeUpper = evt.type.toUpperCase();
            const priceStr = evt.price ? evt.price.toFixed(config.symbol.toLowerCase().includes("pepe") ? 8 : 4) : '--';
            content += `
              <div style="font-size: 11px; margin-top: ${idx > 0 ? 6 : 2}px;">
                <strong>[${timeStr}] ${typeUpper}</strong><br/>
                Precio: $${priceStr} | Cantidad: ${evt.qty || '--'}<br/>
                <span style="color: #94a3b8; font-size: 10px;">${evt.detail}</span>
              </div>
            `;
          });
          
          tooltipEl.innerHTML = content;
        }
      } else {
        if (tooltipEl) tooltipEl.style.display = 'none';
      }

      drawChart();
    });

    canvasEl.addEventListener("mouseleave", () => {
      mouseX = null;
      mouseY = null;
      if (tooltipEl) tooltipEl.style.display = 'none';
      drawChart();
    });
  }

  // Load instance variables from Tauri Rust environment
  try {
    config = await invoke<InstanceConfig>("get_instance_config");
    
    if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE #${config.instance_id}`;
    if (symbolDisplayEl) symbolDisplayEl.innerText = config.symbol;
    if (instanceIdDisplayEl) instanceIdDisplayEl.innerText = config.instance_id;
    if (portDisplayEl) portDisplayEl.innerText = config.port;
    
    await fetchOpenOrders();
  } catch (err) {
    addLog(`Error fetching instance variables: ${err}`, 'err');
  }

  // Layout callbacks
  window.addEventListener('resize', handleResize);
  setTimeout(handleResize, 100);

  if (samplesSelectEl) {
    samplesSelectEl.addEventListener("change", (e) => {
      maxPoints = Number((e.target as HTMLSelectElement).value);
      while (history.length > maxPoints) {
        history.shift();
      }
      drawChart();
    });
  }

  if (clearLogBtnEl) {
    clearLogBtnEl.addEventListener("click", () => {
      if (logConsoleEl) logConsoleEl.innerHTML = "";
    });
  }

  // Load initial chase behavior and set selector
  const chaseSelectEl = document.getElementById("chase-behavior-select") as HTMLSelectElement | null;
  if (chaseSelectEl) {
    const parentPort = config.parent_api_port || "8000";
    try {
      const response = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${config.instance_id}/telemetry`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.chase_behavior) {
          chaseSelectEl.value = data.chase_behavior;
          addLog(`Initial chase behavior loaded: ${data.chase_behavior.toUpperCase()}`, 'info');
        }
      }
    } catch (err) {
      console.warn("Failed to load initial chase behavior via telemetry endpoint.", err);
    }

    chaseSelectEl.addEventListener("change", async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      const parentPort = config.parent_api_port || "8000";
      addLog(`Changing chase behavior to ${val.toUpperCase()} in hot...`, 'info');
      try {
        const res = await fetch(`http://127.0.0.1:${parentPort}/api/grid/instances/${config.instance_id}/chase-behavior`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ behavior: val })
        });
        if (res.ok) {
          addLog(`Successfully changed chase behavior to ${val.toUpperCase()} in hot!`, 'success');
        } else {
          const errData = await res.json().catch(() => ({ detail: res.statusText }));
          addLog(`Failed to change chase behavior: ${errData.detail}`, 'err');
        }
      } catch (err) {
        addLog(`Error updating chase behavior: ${err}`, 'err');
      }
    });
  }

  // Connect to data socket
  connectWebSocket();
});

interface ModificationInfo {
  timestamp: number;
  order_id: string;
  side: string;
  quantity: number;
  old_price: number | null;
  new_price: number | null;
}

function updateModificationsList(mods: ModificationInfo[]) {
  if (!modsListEl) return;
  if (mods.length === 0) {
    modsListEl.innerHTML = '<div class="mod-row-placeholder">No modifications detected yet.</div>';
    return;
  }

  modsListEl.innerHTML = "";

  const sortedMods = [...mods].reverse();
  const decimals = config.symbol.toLowerCase().includes("pepe") ? 8 : 4;

  for (const m of sortedMods) {
    const card = document.createElement("div");
    card.className = "mod-card";

    const header = document.createElement("div");
    header.className = "mod-card-header";
    
    const sideBadge = document.createElement("span");
    sideBadge.className = `mod-card-side ${m.side.toLowerCase()}`;
    sideBadge.innerText = m.side;

    const timeSpan = document.createElement("span");
    timeSpan.className = "mod-card-time";
    timeSpan.innerText = new Date(m.timestamp).toLocaleTimeString();

    header.appendChild(sideBadge);
    header.appendChild(timeSpan);

    const body = document.createElement("div");
    body.className = "mod-card-body";

    const priceRow = document.createElement("div");
    priceRow.className = "mod-card-price-row";

    const priceChange = document.createElement("div");
    priceChange.className = "mod-card-price-change";

    if (m.old_price !== null && m.new_price !== null) {
      const oldPriceSpan = document.createElement("span");
      oldPriceSpan.className = "price-old";
      oldPriceSpan.innerText = m.old_price.toFixed(decimals);

      const arrow = document.createElement("span");
      arrow.className = "price-arrow";
      arrow.innerHTML = "&rarr;";

      const newPriceSpan = document.createElement("span");
      newPriceSpan.className = "price-new";
      newPriceSpan.innerText = m.new_price.toFixed(decimals);

      priceChange.appendChild(oldPriceSpan);
      priceChange.appendChild(arrow);
      priceChange.appendChild(newPriceSpan);

      const pctSpan = document.createElement("span");
      const pct = ((m.new_price - m.old_price) / m.old_price) * 100;
      if (pct > 0) {
        pctSpan.className = "price-pct up";
        pctSpan.innerText = `+${pct.toFixed(3)}%`;
      } else if (pct < 0) {
        pctSpan.className = "price-pct down";
        pctSpan.innerText = `${pct.toFixed(3)}%`;
      } else {
        pctSpan.className = "price-pct neutral";
        pctSpan.innerText = "0.000%";
      }
      priceRow.appendChild(priceChange);
      priceRow.appendChild(pctSpan);
    } else if (m.new_price !== null) {
      const newPriceSpan = document.createElement("span");
      newPriceSpan.className = "price-new";
      newPriceSpan.innerText = m.new_price.toFixed(decimals);
      priceChange.appendChild(newPriceSpan);
      priceRow.appendChild(priceChange);
    }

    const detailsRow = document.createElement("div");
    detailsRow.className = "mod-card-details";

    const qtySpan = document.createElement("span");
    qtySpan.className = "mod-card-qty";
    qtySpan.innerText = `QTY: ${m.quantity}`;

    const idSpan = document.createElement("span");
    idSpan.innerText = `ID: ...${m.order_id.slice(-6)}`;

    detailsRow.appendChild(qtySpan);
    detailsRow.appendChild(idSpan);

    body.appendChild(priceRow);
    body.appendChild(detailsRow);

    card.appendChild(header);
    card.appendChild(body);

    modsListEl.appendChild(card);
  }
}
