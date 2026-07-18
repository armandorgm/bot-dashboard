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
interface OrderEvent {
  id: string;
  timestamp: number;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  status: string;
}

let history: TickData[] = [];
let orderEvents: OrderEvent[] = [];
let maxPoints = 150;
let tickTimes: number[] = [];
let hz = 0;

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

// Getted config
let config: InstanceConfig = { instance_id: "--", symbol: "--", port: "12001", parent_api_port: "8000" };

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

  // Background
  ctx.fillStyle = '#050814';
  ctx.fillRect(0, 0, width, height);

  if (history.length < 2) {
    ctx.fillStyle = '#4b5563';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAITING FOR TICKER FEED DATA FROM BOT...', width / 2, height / 2);
    return;
  }

  // Calculate bounds
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const pt of history) {
    if (pt.bid < minVal) minVal = pt.bid;
    if (pt.ask > maxVal) maxVal = pt.ask;
  }

  let diff = maxVal - minVal;
  if (diff <= 0) {
    diff = minVal * 0.0001 || 0.000001;
  }
  const padding = diff * 0.1;
  const yMin = minVal - padding;
  const yMax = maxVal + padding;
  const yRange = yMax - yMin;

  // Draw Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  const gridCount = 4;
  ctx.fillStyle = 'rgba(156, 163, 175, 0.4)';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  const rightMargin = 100;
  const chartWidth = width - rightMargin;

  for (let i = 0; i <= gridCount; i++) {
    const y = (i / gridCount) * (height - 40) + 15;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartWidth, y);
    ctx.stroke();

    const priceVal = yMax - (i / gridCount) * yRange;
    ctx.fillText(priceVal.toFixed(config.symbol.toLowerCase().includes("pepe") ? 8 : 4), chartWidth + 5, y);
  }

  // Mapping coordinate system
  const getX = (index: number) => {
    return (index / (maxPoints - 1)) * chartWidth;
  };
  
  const getY = (price: number) => {
    return height - 25 - ((price - yMin) / yRange) * (height - 40);
  };

  const getXForTime = (t: number) => {
    if (history.length < 2) return -1;
    const minT = history[0].time;
    const maxT = history[history.length - 1].time;
    if (maxT === minT) return -1;
    let fraction = (t - minT) / (maxT - minT);
    if (fraction > 1) fraction = 1;
    const index = fraction * (history.length - 1);
    return getX(index);
  };

  // Draw shaded Spread Area
  ctx.fillStyle = 'rgba(59, 130, 246, 0.03)';
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

  // Draw Bid Line (Green)
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].bid));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(i), getY(history[i].bid));
  }
  ctx.stroke();

  // Draw Ask Line (Red)
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0].ask));
  for (let i = 1; i < history.length; i++) {
    ctx.lineTo(getX(i), getY(history[i].ask));
  }
  ctx.stroke();

  // Draw Order Events (Placements/Cancellations) on the chart
  for (const evt of orderEvents) {
    if (evt.timestamp < history[0].time) {
      continue;
    }

    const x = getXForTime(evt.timestamp);
    const y = getY(evt.price);

    if (x >= 0 && x <= chartWidth && y >= 15 && y <= height - 25) {
      let color = '#9ca3af';
      let isCanceled = evt.status === 'canceled' || evt.status === 'expired';
      
      if (!isCanceled) {
        color = evt.side === 'buy' ? '#10b981' : '#ef4444';
      }
      
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      const displayId = evt.id ? (evt.id.length > 6 ? `...${evt.id.slice(-6)}` : evt.id) : '?';
      let actionText = isCanceled ? `CXL #${displayId}` : `${evt.side.toUpperCase()} #${displayId}`;

      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(actionText).width;
      const bubbleWidth = textWidth + 8;
      const bubbleHeight = 12;
      const bubbleX = x + 8;
      const bubbleY = y - 6;

      ctx.fillStyle = 'rgba(3, 7, 18, 0.75)';
      ctx.fillRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight);
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight);

      ctx.fillStyle = isCanceled ? '#d1d5db' : '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(actionText, bubbleX + 4, bubbleY + bubbleHeight / 2);
    }
  }

  // Current values indicators
  const latest = history[history.length - 1];
  const yBid = getY(latest.bid);
  const yAsk = getY(latest.ask);

  // Bid flag
  ctx.fillStyle = '#10b981';
  ctx.fillRect(chartWidth + 3, yBid - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#030712';
  ctx.font = 'bold 8px "JetBrains Mono", monospace';
  ctx.fillText(`B: ${latest.bid.toFixed(config.symbol.toLowerCase().includes("pepe") ? 8 : 4)}`, chartWidth + 6, yBid);

  // Ask flag
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(chartWidth + 3, yAsk - 7, rightMargin - 6, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 8px "JetBrains Mono", monospace';
  ctx.fillText(`A: ${latest.ask.toFixed(config.symbol.toLowerCase().includes("pepe") ? 8 : 4)}`, chartWidth + 6, yAsk);
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
        addLog(msg, (d.status || '').toUpperCase() === 'FILLED' ? 'success' : 'info');

        let priceVal = Number(d.price);
        if ((!priceVal || priceVal <= 0) && history.length > 0) {
          const latest = history[history.length - 1];
          priceVal = d.side.toLowerCase() === 'buy' ? latest.bid : latest.ask;
        }

        orderEvents.push({
          id: d.id || '',
          timestamp: Date.now(),
          side: (d.side || 'buy').toLowerCase() as 'buy' | 'sell',
          price: priceVal,
          qty: Number(d.qty || d.z || 0),
          status: (d.status || '').toLowerCase()
        });

        if (orderEvents.length > 100) {
          orderEvents.shift();
        }
        drawChart();
      }
      else if (payload.type === 'modifications_update' && payload.data) {
        updateModificationsList(payload.data);
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
  samplesSelectEl = document.getElementById("samples-select") as HTMLSelectElement;
  logConsoleEl = document.getElementById("log-console");
  clearLogBtnEl = document.getElementById("clear-log-btn");

  // Load instance variables from Tauri Rust environment
  try {
    config = await invoke<InstanceConfig>("get_instance_config");
    
    if (botTitleEl) botTitleEl.innerText = `BOT INSTANCE #${config.instance_id}`;
    if (symbolDisplayEl) symbolDisplayEl.innerText = config.symbol;
    if (instanceIdDisplayEl) instanceIdDisplayEl.innerText = config.instance_id;
    if (portDisplayEl) portDisplayEl.innerText = config.port;
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
