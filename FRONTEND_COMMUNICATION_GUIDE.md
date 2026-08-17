# Manual de Comunicación y Eventos Frontend (Tauri / Next.js)

Este documento es la **guía oficial y contrato de comunicación** para el equipo de desarrollo frontend (`bot-dashboard`). Detalla cómo conectarse a los flujos en tiempo real del backend FastAPI, consumir eventos de negocio y telemetría, y renderizar la **Arquitectura Visual Híbrida** para condiciones de activación y retroceso de estrategias (ej. Pullback Trigger y Flipper).

---

## 1. Arquitectura de Transporte y Buses

El sistema separa estrictamente los flujos de red en canales especializados según su criticidad:

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
│  • UI Render: Cards, Micro-Gauges, TradingView / Lightweight Charts         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tabla de Endpoints y Puertos

| Canal | Tipo | Endpoint | Frecuencia | Tolerancia a Pérdida | Propósito |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Business WS** | WebSocket | `ws://127.0.0.1:8000/ws/notifications` | Event-driven | **Cero (Crítico)** | Fills, órdenes, cambios de estado, triggers de preflight. |
| **Telemetry WS**| WebSocket | `ws://127.0.0.1:8000/ws/telemetry` | ~1s Streaming | Alta (Métricas) | Latencia, memoria, ticks, telemetría general. |
| **REST API** | HTTP REST | `http://127.0.0.1:8000/api/*` | On-Demand | Confiable | Hidratación inicial, CRUD instancias, balances. |

---

## 2. Evento `strategy_trigger_status` (Especificación del Payload)

Emitido por el canal `/ws/notifications` cada vez que el motor de preflight o la estrategia evalúa las condiciones de disparo (ej. retroceso mínimo/pullback para habilitar el *flip* de posición).

### Ejemplo de Payload JSON
```json
{
  "type": "strategy_trigger_status",
  "data": {
    "instance_id": 8,
    "symbol": "1000PEPEUSDC",
    "strategy": "GRID_POSITION_FLIPPER",
    "condition_name": "PULLBACK_REQUIREMENT",
    "state": "BLOCKED",
    "position_side": "LONG",
    "entry_price": 0.00260000,
    "current_price": 0.00259084,
    "trigger_price": 0.00260195,
    "current_metric_pc": -0.3523,
    "required_metric_pc": 0.0750,
    "delta_remaining_pc": 0.4273,
    "multiplier": 3.0,
    "timestamp": "2026-08-17T10:10:45.120Z"
  }
}
```

### Diccionario de Campos

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `instance_id` | `number` | ID único de la instancia del bot. |
| `symbol` | `string` | Símbolo operado (ej. `1000PEPEUSDC`). |
| `strategy` | `string` | Nombre canónico de la estrategia activa. |
| `condition_name` | `string` | Regla evaluada (ej. `PULLBACK_REQUIREMENT`). |
| `state` | `string` | Estado actual: `"BLOCKED"` (bloqueado), `"PASSED"` (aprobado), `"READY"` (sin posición/flat). |
| `position_side` | `string` | Lado de la posición activa: `"LONG"`, `"SHORT"`, `"FLAT"`. |
| `entry_price` | `number` | Precio promedio de entrada de la posición actual. |
| `current_price` | `number` | Precio de mercado actual (Mark Price o Best Bid/Ask). |
| `trigger_price` | `number` | **Precio exacto donde se activa el flip** (ya redondeado al `tick_size`). |
| `current_metric_pc`| `number` | Porcentaje de retroceso actual ($\%$) con signo. |
| `required_metric_pc`| `number` | Umbral de retroceso requerido ($\%$) para autorizar el disparo. |
| `delta_remaining_pc`| `number` | Distancia faltante ($\%$) para desbloquear la condición ($0.0$ si ya pasó). |
| `timestamp` | `string` | Timestamp ISO UTC del cálculo. |

---

## 3. Arquitectura Visual Recomendada (Enfoque Híbrido)

### A. Vista Macro: Gráfico de Precio (XY / Velas / Lightweight Charts)

1. **Trigger Line (Línea de Umbral Dinámico):**
   * Trazar una línea horizontal en el nivel `trigger_price`.
   * **Color:** 
     * Amarillo ámbar (`#F59E0B`) o Rojo tenue si `state === "BLOCKED"`.
     * Verde brillante (`#10B981`) si `state === "PASSED"`.
   * **Etiqueta en eje de precio:** `Flip Trigger: 0.00260195 (+0.075%)`.

2. **Marcador de Rechazo Temporal (Event Marker):**
   * Cuando se reciba un evento con `state === "BLOCKED"`, colocar un marcador tenue (icono ⛔ o punto rojo) en el eje temporal $T$.
   * **Tooltip interactivo al hacer hover:**
     ```text
     ⛔ Preflight Rechazado
     Pullback: -0.3523% < Requerido: 0.0750%
     Precio Actual: 0.00259084 | Target: 0.00260195
     Falta: 0.4273%
     ```

---

### B. Vista Micro: Card / Panel de Control de la Instancia

Incluir una **Micro-Barra Diferencial (Gauge)** compacta dentro de la card de la instancia:

```text
┌──────────────────────────────────────────────────────────────┐
│ INSTANCIA #8 — 1000PEPEUSDC              [GRID_POSITION_FLIP]│
├──────────────────────────────────────────────────────────────┤
│ Posición: +150,000 LONG @ 0.00260000                         │
│                                                              │
│ Requisito Flip Pullback:                                     │
│ [-0.50%] ────[🔴 -0.3523%]──── [0.00%] ──[| +0.075%]──►      │
│                                           ▲                  │
│                                         Target               │
│                                                              │
│ Estado: ⛔ BLOQUEADO — Falta 0.4273% para autorizar flip     │
└──────────────────────────────────────────────────────────────┘
```

#### Estilos CSS Sugeridos:
* **Fondo de la barra:** `background: rgba(255, 255, 255, 0.05);` con borde sutil.
* **Zona negativa / bloqueo:** Degradado hacia rojo/naranja (`#EF4444` / `#F97316`).
* **Zona de disparo (> required):** Verde esmeralda (`#10B981`).
* **Marcador de Target:** Línea vertical blanca o dorada en el valor `required_metric_pc`.

---

## 4. Endpoints REST para Hidratación Inicial

Para evitar que la UI arranque vacía antes de recibir el primer tick por WebSocket:

### 1. Obtener estado de trigger de una instancia
* **Método:** `GET /api/grid/instances/{instance_id}/trigger-status`
* **Respuesta:**
  ```json
  {
    "instance_id": 8,
    "symbol": "1000PEPEUSDC",
    "strategy": "GRID_POSITION_FLIPPER",
    "state": "BLOCKED",
    "position_side": "LONG",
    "entry_price": 0.0026,
    "current_price": 0.00259084,
    "trigger_price": 0.00260195,
    "current_metric_pc": -0.3523,
    "required_metric_pc": 0.075,
    "delta_remaining_pc": 0.4273,
    "multiplier": 3.0,
    "updated_at": 1723891845.12
  }
  ```

### 2. Obtener estado de trigger de todas las instancias
* **Método:** `GET /api/grid/trigger-status`
* **Respuesta:** Mapa `{ [instance_id: number]: TriggerStatusPayload }`.

### 3. Integrado en Telemetría de Instancia
* **Método:** `GET /api/grid/instances/{instance_id}/telemetry`
* El campo `trigger_status` viene embebido directamente en la respuesta.

---

## 5. Tipos TypeScript (Interfaces para Frontend)

```typescript
export type TriggerState = "BLOCKED" | "PASSED" | "READY" | "NO_DATA";
export type PositionSide = "LONG" | "SHORT" | "FLAT";

export interface StrategyTriggerStatus {
  instance_id: number;
  symbol: string;
  strategy: string;
  condition_name: string;
  state: TriggerState;
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

## 6. Ejemplo de Hook React / TypeScript

```typescript
import { useEffect, useState } from "react";
import { StrategyTriggerStatus, WsBusinessNotificationMessage } from "./types";

export function useStrategyTriggerStatus(instanceId: number, initialData?: StrategyTriggerStatus) {
  const [triggerStatus, setTriggerStatus] = useState<StrategyTriggerStatus | null>(initialData || null);

  useEffect(() => {
    // 1. Fetch REST inicial para hidratar
    if (!initialData) {
      fetch(`http://127.0.0.1:8000/api/grid/instances/${instanceId}/trigger-status`)
        .then((res) => res.json())
        .then((data) => setTriggerStatus(data))
        .catch((err) => console.error("Error fetching trigger status:", err));
    }

    // 2. Conectar al WebSocket de Notificaciones
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
