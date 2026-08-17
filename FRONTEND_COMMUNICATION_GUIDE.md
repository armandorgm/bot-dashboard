# Manual de Comunicación y Eventos Frontend (Tauri / Next.js) — v2.2.0

Este documento es la **guía oficial y contrato de comunicación técnica** para el equipo de desarrollo frontend (`bot-dashboard`). Detalla cómo conectarse a los flujos en tiempo real del backend FastAPI, consumir eventos de negocio y telemetría, y renderizar la **Arquitectura Visual Híbrida** para el **Conmutador Dinámico de Polaridad y Seguimiento de Tendencia (v2.2.0 Dynamic Polarity Conmutator & Trend Follower)** en estrategias como `GridPositionFlipperStrategy`.

---

## 1. Arquitectura de Transporte y Buses

El backend separa estrictamente los flujos de red en canales especializados según su criticidad:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI)                              │
│                                                                             │
│  [Grid Bot / Preflight] ──┐                                                 │
│  [Binance Stream WS]    ──┼──► NotificationManager ──► /ws/notifications     │
│  [Reconciliation]       ──┤                            (Eventos de Negocio) │
│                           └──► TelemetryBus        ──► /ws/telemetry        │
│                                                        (Métricas & Latencia)│
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                WebSocket (JSON)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Tauri / Next.js)                          │
│                                                                             │
│  • useWebSocket hooks                                                       │
│  • React Query Cache Invalidation                                           │
│  • UI Render: Direction Badges, Micro-Gauges, Lightweight Charts            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tabla de Endpoints y Puertos

| Canal | Tipo | Endpoint | Frecuencia | Tolerancia a Pérdida | Propósito |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Business WS** | WebSocket | `ws://127.0.0.1:8000/ws/notifications` | Event-driven | **Cero (Crítico)** | Fills, órdenes, cambios de estado, conmutación de polaridad de preflight. |
| **Telemetry WS**| WebSocket | `ws://127.0.0.1:8000/ws/telemetry` | ~1s Streaming | Alta (Métricas) | Latencia, memoria, ticks, telemetría general. |
| **REST API** | HTTP REST | `http://127.0.0.1:8000/api/*` | On-Demand | Confiable | Hidratación inicial, CRUD instancias, balances. |

---

## 2. Concepto Arquitectónico v2.2.0: Conmutador de Polaridad vs Bloqueador

> [!IMPORTANT]
> **Cambio Clave v2.2.0 para Frontend Developers:**
> El umbral de retroceso (**Pullback Threshold**) **NO bloquea ni congela el bot**. El motor de preflight continúa colocando órdenes ininterrumpidamente según el espaciado del grid.
> 
> El umbral actúa como un **Conmutador de Sentido de Entrada (`resolved_side`)**:
> - **Antes del Umbral (`state === "TREND_ACCUMULATION"`):** El bot opera en **Seguimiento de Tendencia** (`"TREND_BUY"` si está Long, `"TREND_SELL"` si está Short), recomprando/revendiendo escalones del grid en retrocesos normales.
> - **Al Cruzar el Umbral ($\ge 3\times$ profit, `state === "FLIP_CONMUTATED"`):** El conmutador **invierte la polaridad** y lanza la orden en sentido contrario (`"FLIP_SELL"` para voltear a Short o `"FLIP_BUY"` para voltear a Long) con dimensionamiento $2\times$.
> - **En Flat (`state === "READY"`):** Modo Semilla (`"SEED"`), listo para colocar la primera orden.

---

## 3. Evento `strategy_trigger_status` (Especificación del Payload)

Emitido por `/ws/notifications` cada vez que el motor de preflight o la estrategia evalúa las condiciones de disparo y conmutación de lado.

### Ejemplo de Payload JSON (Modo Tendencia)
```json
{
  "type": "strategy_trigger_status",
  "data": {
    "instance_id": 8,
    "symbol": "1000PEPEUSDC",
    "strategy": "GRID_POSITION_FLIPPER",
    "condition_name": "PULLBACK_CONMUTATOR",
    "state": "TREND_ACCUMULATION",
    "conmutator_mode": "TREND_BUY",
    "resolved_side": "BUY",
    "position_side": "LONG",
    "entry_price": 0.00260000,
    "current_price": 0.00259084,
    "trigger_price": 0.00258050,
    "actual_pullback_pc": 0.003523,
    "required_pullback_pc": 0.007500,
    "current_metric_pc": 0.3523,
    "required_metric_pc": 0.7500,
    "delta_remaining_pc": 0.3977,
    "multiplier": 3.0,
    "timestamp": "2026-08-17T12:30:00.000Z"
  }
}
```

### Ejemplo de Payload JSON (Giro Conmutado / Flip)
```json
{
  "type": "strategy_trigger_status",
  "data": {
    "instance_id": 8,
    "symbol": "1000PEPEUSDC",
    "strategy": "GRID_POSITION_FLIPPER",
    "condition_name": "PULLBACK_CONMUTATOR",
    "state": "FLIP_CONMUTATED",
    "conmutator_mode": "FLIP_SELL",
    "resolved_side": "SELL",
    "position_side": "LONG",
    "entry_price": 0.00260000,
    "current_price": 0.00258000,
    "trigger_price": 0.00258050,
    "actual_pullback_pc": 0.007692,
    "required_pullback_pc": 0.007500,
    "current_metric_pc": 0.7692,
    "required_metric_pc": 0.7500,
    "delta_remaining_pc": 0.0000,
    "multiplier": 3.0,
    "timestamp": "2026-08-17T12:31:00.000Z"
  }
}
```

### Diccionario de Campos

| Campo | Tipo | Valores Posibles | Descripción |
| :--- | :--- | :--- | :--- |
| `instance_id` | `number` | Ej: `8` | ID único de la instancia del bot. |
| `symbol` | `string` | Ej: `1000PEPEUSDC` | Símbolo operado en Binance Futures. |
| `strategy` | `string` | `GRID_POSITION_FLIPPER` | Nombre canónico de la estrategia. |
| `condition_name`| `string` | `PULLBACK_CONMUTATOR` | Regla evaluada. |
| `state` | `string` | `"TREND_ACCUMULATION"`<br>`"FLIP_CONMUTATED"`<br>`"READY"` | Estado macro de la condición. |
| `conmutator_mode`| `string` | `"TREND_BUY"` / `"TREND_SELL"`<br>`"FLIP_SELL"` / `"FLIP_BUY"`<br>`"SEED"` / `"FALLBACK"` | Modo operacional exacto del conmutador. |
| `resolved_side` | `string` | `"BUY"` \| `"SELL"` | **Dirección efectiva** de las órdenes que se están colocando. |
| `position_side` | `string` | `"LONG"` \| `"SHORT"` \| `"FLAT"` | Lado de la posición activa en Binance. |
| `entry_price` | `number` | Ej: `0.00260000` | Precio promedio de entrada de la posición actual. |
| `current_price` | `number` | Ej: `0.00259084` | Precio actual de mercado. |
| `trigger_price` | `number` | Ej: `0.00258050` | **Nivel de precio exacto donde se conmutará el giro**. |
| `current_metric_pc`| `number` | Ej: `0.3523` | Porcentaje de retroceso adverso actual ($\%$, positivo). |
| `required_metric_pc`| `number`| Ej: `0.7500` | Umbral requerido para conmutar el giro ($\% = 3 \times \text{profit\_pc}$). |
| `delta_remaining_pc`| `number`| Ej: `0.3977` | Distancia faltante ($\%$) para alcanzar el umbral de giro ($0.0$ si ya conmutó). |
| `multiplier` | `number` | Ej: `3.0` | Multiplicador configurado para la instancia. |
| `timestamp` | `string` | ISO 8601 UTC | Timestamp de generación del cálculo. |

---

## 4. Arquitectura Visual Recomendada (Enfoque Híbrido)

### A. Vista Macro: Gráfico de Precio (TradingView / Lightweight Charts)

1. **Línea de Conmutación de Giro (Flip Reversal Threshold):**
   * Trazar una línea horizontal punteada en el nivel `trigger_price`.
   * **Color:** 
     * Azul/Púrpura suave (`#818CF8`) si `state === "TREND_ACCUMULATION"` (indica nivel de reversión potencial).
     * Naranja/Rojo vivo (`#F97316`) si `state === "FLIP_CONMUTATED"` (indica que el giro se ha ejecutado).
   * **Etiqueta en eje de precio:** `⚡ Flip Target: 0.00258050 (-0.75%)`.

2. **Tooltip / Hover en el Gráfico:**
   ```text
   ⚡ Conmutador de Polaridad:
   Modo Actual: Seguimiento de Tendencia (BUY)
   Retroceso Actual: 0.3523% / Umbral de Giro: 0.7500%
   Distancia para Conmutar: 0.3977% (Nivel 0.00258050)
   ```

---

### B. Vista Micro: Card / Panel de Control de la Instancia

Dentro de la card de la instancia, renderizar un **Badge de Polaridad** y una **Barra de Proximidad al Giro**:

```text
┌──────────────────────────────────────────────────────────────┐
│ INSTANCIA #8 — 1000PEPEUSDC              [GRID_POSITION_FLIP]│
├──────────────────────────────────────────────────────────────┤
│ Posición: +150,000 LONG @ 0.00260000                         │
│ Modo Activo: [ 🟢 SEGUIMIENTO DE TENDENCIA — COMPRA (BUY) ]  │
│                                                              │
│ Proximidad al Giro (Flip Reversal):                          │
│ [0.00%] ──────[🔵 0.3523%]──────────[⚡ 0.7500%]────────►    │
│                                      ▲                       │
│                               Umbral de Giro                 │
│                                                              │
│ Estado: Acumulando en Long. A 0.3977% del giro a SHORT       │
└──────────────────────────────────────────────────────────────┘
```

#### Reglas de Color para UI:
* **`conmutator_mode === "TREND_BUY"`:** Badge Verde (`#10B981`) con texto *"🟢 TENDENCIA: COMPRANDO"*.
* **`conmutator_mode === "TREND_SELL"`:** Badge Rojo/Naranja (`#EF4444`) con texto *"🔴 TENDENCIA: VENDIENDO"*.
* **`conmutator_mode === "FLIP_SELL"`:** Badge Púrpura/Ámbar (`#F59E0B`) con texto *"⚡ GIRO A SHORT (SELL)"*.
* **`conmutator_mode === "FLIP_BUY"`:** Badge Azul/Verde (`#3B82F6`) con texto *"⚡ GIRO A LONG (BUY)"*.
* **`conmutator_mode === "SEED"`:** Badge Gris/Cyan (`#06B6D4`) con texto *"🌱 INICIAL: SEMILLA"*.

---

## 5. Endpoints REST para Hidratación Inicial

Para cargar el estado inmediatamente al abrir la página antes de recibir eventos WS:

### 1. Estado de trigger por instancia
* **Método:** `GET /api/grid/instances/{instance_id}/trigger-status`
* **Respuesta:** Objeto `StrategyTriggerStatus` directo.

### 2. Estado de trigger de todas las instancias
* **Método:** `GET /api/grid/trigger-status`
* **Respuesta:** Diccionario `{ [instance_id: number]: StrategyTriggerStatus }`.

### 3. Embebido en Telemetría
* **Método:** `GET /api/grid/instances/{instance_id}/telemetry`
* Campo `trigger_status` incluido en el JSON.

---

## 6. Tipos TypeScript Oficiales

```typescript
export type TriggerState = "TREND_ACCUMULATION" | "FLIP_CONMUTATED" | "READY" | "NO_DATA";

export type ConmutatorMode = 
  | "TREND_BUY" 
  | "TREND_SELL" 
  | "FLIP_SELL" 
  | "FLIP_BUY" 
  | "SEED" 
  | "FALLBACK";

export type ResolvedSide = "BUY" | "SELL";
export type PositionSide = "LONG" | "SHORT" | "FLAT";

export interface StrategyTriggerStatus {
  instance_id: number;
  symbol: string;
  strategy: string;
  condition_name: string;
  state: TriggerState;
  conmutator_mode: ConmutatorMode;
  resolved_side: ResolvedSide;
  position_side: PositionSide;
  entry_price: number;
  current_price: number;
  trigger_price: number | null;
  current_metric_pc: number;
  required_metric_pc: number;
  delta_remaining_pc: number;
  multiplier?: number;
  timestamp?: string;
  updated_at?: number;
}

export interface WsBusinessNotificationMessage {
  type: "strategy_trigger_status" | "order_update" | "balance_update" | "connection_established";
  data: any;
}
```

---

## 7. Hook React / TypeScript de Ejemplo

```typescript
import { useEffect, useState } from "react";
import { StrategyTriggerStatus, WsBusinessNotificationMessage } from "./types";

export function useStrategyTriggerStatus(instanceId: number, initialData?: StrategyTriggerStatus) {
  const [triggerStatus, setTriggerStatus] = useState<StrategyTriggerStatus | null>(initialData || null);

  useEffect(() => {
    // 1. Hidratación REST inicial
    if (!initialData) {
      fetch(`http://127.0.0.1:8000/api/grid/instances/${instanceId}/trigger-status`)
        .then((res) => res.json())
        .then((data) => setTriggerStatus(data))
        .catch((err) => console.error("Error fetching trigger status:", err));
    }

    // 2. Conexión WebSocket para actualizaciones en vivo
    const ws = new WebSocket("ws://127.0.0.1:8000/ws/notifications");

    ws.onmessage = (event) => {
      try {
        const msg: WsBusinessNotificationMessage = JSON.parse(event.data);
        if (
          msg.type === "strategy_trigger_status" &&
          msg.data?.instance_id === instanceId
        ) {
          setTriggerStatus(msg.data);
        }
      } catch (err) {
        console.error("Error parsing WS notification:", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [instanceId]);

  return triggerStatus;
}
```
