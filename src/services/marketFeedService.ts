import { HftEvent, InstanceConfig, ModificationInfo, ChasePipelineProcess, StrategyTriggerStatus } from '../types';
import { formatNum, getSymbolDecimals, normalizeSymbol, cleanPublicWsSymbol } from '../utils/formatters';
import { addLog } from './logger';
import { dataSourceManager } from './dataSourceManager';

export interface MarketFeedCallbacks {
  getConfig: () => InstanceConfig;
  onTicker: (bid: number, ask: number, hz: number) => void;
  onStatsUpdate: (stats: any) => void;
  onModificationsUpdate: (mods: ModificationInfo[]) => void;
  onPipelinesActive: (pipelines: ChasePipelineProcess[], rawText?: string) => void;
  onSessionUpdate: (data: any) => void;
  onInstanceTelemetry: (data: any) => void;
  onStrategyTriggerStatus?: (status: StrategyTriggerStatus) => void;
  onHftEvent: (evt: HftEvent) => void;
  onOpenOrdersRequested: () => void;
  onActivePipelinesRequested: () => void;
  onWsConnected: () => void;
  onWsDisconnected: () => void;
}

export class MarketFeedService {
  private binancePublicWs: WebSocket | null = null;
  private localBotWs: WebSocket | null = null;
  private tickTimes: number[] = [];
  private hz: number = 0;

  constructor(private callbacks: MarketFeedCallbacks) {}

  public getHz(): number {
    return this.hz;
  }

  public connectBinancePublicWs(symbol: string): void {
    if (this.binancePublicWs) {
      addLog(`[BINANCE-PUBLIC-WS] Cerrando conexión previa antes de conectar a ${symbol}...`, 'warn');
      this.binancePublicWs.onclose = null;
      this.binancePublicWs.onmessage = null;
      this.binancePublicWs.onerror = null;
      this.binancePublicWs.close();
      this.binancePublicWs = null;
    }

    const cleanSymbol = cleanPublicWsSymbol(symbol);
    const wsUrl = `wss://fstream.binance.com/ws/${cleanSymbol}@bookTicker`;

    addLog(`[BINANCE-PUBLIC-WS] Connecting to public ticker feed at ${wsUrl}...`, 'info');

    const currentSocketSymbol = symbol;
    this.binancePublicWs = new WebSocket(wsUrl);

    this.binancePublicWs.onopen = () => {
      addLog(`[BINANCE-PUBLIC-WS] Connection established for ${symbol.toUpperCase()} ticker!`, 'success');
    };

    this.binancePublicWs.onmessage = (event) => {
      const activeCleanSymbol = cleanPublicWsSymbol(this.callbacks.getConfig().symbol);
      if (cleanSymbol !== activeCleanSymbol) return;

      try {
        const data = JSON.parse(event.data);
        if (!data) return;

        const bidVal = Number(data.b);
        const askVal = Number(data.a);
        const spread = askVal - bidVal;

        const nowMs = performance.now();
        this.tickTimes.push(nowMs);
        this.tickTimes = this.tickTimes.filter((t) => nowMs - t < 1000);
        this.hz = this.tickTimes.length;

        const feedRateValEl = document.getElementById('feed-rate-val');
        if (feedRateValEl) feedRateValEl.innerText = `${this.hz} Hz`;

        if (!dataSourceManager.isEnabled('ticker')) return;

        const decimals = getSymbolDecimals(this.callbacks.getConfig().symbol);
        const bidValEl = document.getElementById('bid-val');
        const askValEl = document.getElementById('ask-val');
        const spreadValEl = document.getElementById('spread-val');

        if (bidValEl) bidValEl.innerText = formatNum(bidVal, decimals);
        if (askValEl) askValEl.innerText = formatNum(askVal, decimals);
        if (spreadValEl) spreadValEl.innerText = formatNum(spread, decimals);

        this.callbacks.onTicker(bidVal, askVal, this.hz);
      } catch (err) {
        console.error('[BINANCE-PUBLIC-WS] Parse error:', err);
      }
    };

    this.binancePublicWs.onclose = () => {
      const activeCleanSymbol = cleanPublicWsSymbol(this.callbacks.getConfig().symbol);
      if (cleanSymbol === activeCleanSymbol) {
        addLog(`[BINANCE-PUBLIC-WS] Connection closed. Reconnecting in 3s...`, 'warn');
        setTimeout(() => this.connectBinancePublicWs(currentSocketSymbol), 3000);
      }
    };
  }

  public connectLocalBotWebSocket(): void {
    const config = this.callbacks.getConfig();
    const targetPort = config.port || config.parent_api_port || '8000';
    const wsUrl = `ws://127.0.0.1:${targetPort}/ws/notifications`;
    addLog(`Connecting to local bot WebSocket at ${wsUrl}...`, 'info');


    if (this.localBotWs) {
      this.localBotWs.onclose = null;
      this.localBotWs.close();
      this.localBotWs = null;
    }

    const ws = new WebSocket(wsUrl);
    this.localBotWs = ws;

    ws.onopen = () => {
      this.callbacks.onWsConnected();
      addLog(`WebSocket connection established! Listening for local metrics/logs.`, 'success');
      this.callbacks.onOpenOrdersRequested();
      this.callbacks.onActivePipelinesRequested();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'ticker_update' && payload.data) {
          return;
        } else if (payload.type === 'stats_update' && payload.data) {
          this.callbacks.onStatsUpdate(payload.data);
        } else if (payload.type === 'order_update' && payload.data) {
          return;
        } else if (payload.type === 'modifications_update' && payload.data) {
          this.callbacks.onModificationsUpdate(payload.data);
        } else if (payload.type === 'pipelines_active' && payload.data) {
          this.callbacks.onPipelinesActive(payload.data);
        } else if (payload.type === 'session_update' && payload.data) {
          this.callbacks.onSessionUpdate(payload.data);
        } else if (
          (payload.type === 'instance_telemetry' ||
            payload.type === 'INSTANCE_TELEMETRY' ||
            payload.event === 'INSTANCE_TELEMETRY') &&
          payload.data
        ) {
          this.callbacks.onInstanceTelemetry(payload.data);
        } else if (payload.type === 'strategy_trigger_status' && payload.data) {
          const triggerData: StrategyTriggerStatus = payload.data;
          if (this.callbacks.onStrategyTriggerStatus) {
            this.callbacks.onStrategyTriggerStatus(triggerData);
          }

          // Emit visual rejection marker if blocked
          if (triggerData.state === 'BLOCKED') {
            this.callbacks.onHftEvent({
              e: 'HFT_EVENT',
              type: 'trigger_rejected',
              time: triggerData.timestamp ? new Date(triggerData.timestamp).getTime() : Date.now(),
              price: triggerData.current_price,
              symbol: triggerData.symbol || config.symbol,
              detail: `Pullback: ${triggerData.current_metric_pc.toFixed(4)}% < Requerido: +${triggerData.required_metric_pc.toFixed(4)}% | Falta: +${triggerData.delta_remaining_pc.toFixed(4)}%`,
              triggerData: triggerData,
            });
          } else if (triggerData.state === 'PASSED') {
            this.callbacks.onHftEvent({
              e: 'HFT_EVENT',
              type: 'trigger_passed',
              time: triggerData.timestamp ? new Date(triggerData.timestamp).getTime() : Date.now(),
              price: triggerData.current_price,
              symbol: triggerData.symbol || config.symbol,
              detail: `Pullback superó el umbral requerido (+${triggerData.required_metric_pc.toFixed(4)}%)`,
              triggerData: triggerData,
            });
          }
        } else if (payload.type === 'query_log' && payload.data) {
          const d = payload.data;
          const isCancelQuery =
            d.method.toUpperCase().includes('DELETE /FAPI/V1/ORDER') ||
            d.method.toLowerCase().includes('cancel_order');
          if (d.is_error && isCancelQuery) {
            let orderId = '';
            const paramsStr = typeof d.parameters === 'string' ? d.parameters : JSON.stringify(d.parameters);
            const idMatch =
              paramsStr.match(/orderId['"\s:]+([0-9a-zA-Z_-]+)/i) ||
              paramsStr.match(/id['"\s:]+([0-9a-zA-Z_-]+)/i);
            if (idMatch) orderId = idMatch[1];

            this.callbacks.onHftEvent({
              e: 'HFT_EVENT',
              type: 'cancel_buy_failed',
              time: d.timestamp || Date.now(),
              symbol: config.symbol,
              orderId: orderId,
              detail: `Failed cancellation: ${d.error || 'Unknown error'}`,
            });

            addLog(`[CANCEL ERROR] Failed to cancel order #${orderId}: ${d.error || 'Unknown error'}`, 'err');
          } else {
            this.callbacks.onHftEvent({
              e: 'HFT_EVENT',
              type: 'query',
              time: d.timestamp || Date.now(),
              symbol: config.symbol,
              detail: `${d.method} | Params: ${JSON.stringify(d.parameters)}`,
            });

            if (d.is_error) {
              addLog(`[QUERY ERROR] ${d.method} failed: ${d.error || 'Unknown error'}`, 'err');
            }
          }
        } else if (payload.type === 'ws_log' && payload.data) {
          const d = payload.data;
          console.debug(`[WS PACKET] ${d.url} - Size: ${d.length} bytes - Snippet: ${d.snippet}`);
        } else {
          const type = payload.type || 'EVENT';
          const rawString = JSON.stringify(payload.data || payload);
          addLog(`[${type}] ${rawString}`, 'info');
        }
      } catch (e) {
        console.error('Error parsing websocket message', e);
      }
    };

    ws.onclose = () => {
      this.callbacks.onWsDisconnected();
      addLog(`WebSocket disconnected. Retrying in 3s...`, 'err');
      setTimeout(() => this.connectLocalBotWebSocket(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  public handleBinancePrivateEvent(rawData: string): void {
    try {
      addLog(`[PRIVATE DIRECT RX] Payload: ${rawData.slice(0, 150)}...`, 'success');

      const event = JSON.parse(rawData);
      if (!event || !event.e) return;

      const config = this.callbacks.getConfig();

      if (event.e === 'ORDER_TRADE_UPDATE' && event.o) {
        if (!dataSourceManager.isEnabled('orders')) return;
        const o = event.o;

        const symbol = o.s || 'UNKNOWN';
        const activeSymbol = normalizeSymbol(config.symbol);
        const eventSymbol = normalizeSymbol(symbol);
        if (activeSymbol !== eventSymbol) return;

        const side = o.S || 'BUY';
        const status = o.X || 'NEW';
        const executionType = o.x || 'NEW';
        const price = Number(o.p || 0);
        const qty = Number(o.q || 0);
        const orderId = String(o.i || '');

        const msg = `[RUST-DIRECT-WS] ${side} ${qty} ${symbol} @ ${price} | Status: ${status} (exec: ${executionType})`;
        addLog(
          msg,
          status === 'FILLED' ? 'success' : status === 'CANCELED' || status === 'REJECTED' ? 'warn' : 'info'
        );

        const isBuy = side.toUpperCase() === 'BUY';
        const isFilled = status === 'FILLED';
        const isCanceled = status === 'CANCELED' || status === 'EXPIRED';

        let markerType: HftEvent['type'] = isBuy ? 'buy_placed' : 'sell_placed';
        if (isFilled) {
          markerType = isBuy ? 'buy' : 'sell';
        } else if (isCanceled) {
          markerType = isBuy ? 'cancel_buy' : 'cancel_sell';
        }

        this.callbacks.onHftEvent({
          e: 'HFT_EVENT',
          type: markerType,
          time: Date.now(),
          price: price,
          qty: qty,
          symbol: symbol,
          orderId: orderId,
          detail: `[Direct] Status: ${status} | Exec: ${executionType}`,
        });

        this.callbacks.onOpenOrdersRequested();
      } else if (event.e === 'ACCOUNT_UPDATE') {
        const wallets = event.a?.B || [];
        for (const w of wallets) {
          if (w.a === 'USDT' && Number(w.wb) > 0) {
            addLog(`[RUST-DIRECT-WS] Wallet Update → Asset: ${w.a} | Balance: ${w.wb}`, 'info');
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse Binance private user data event:', err);
    }
  }
}
