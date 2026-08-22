# ⚡ Refactorización Propuesta "Alpha": Límite Universal de 4 FPS (SOLID + KISS + DRY)

- **Fecha:** 2026-08-22
- **Autor / Rol:** Antigravity AI Agent (Fullstack Architecture)
- **Alcance:** `src/utils/constants.ts`, `src/services/chartRenderer.ts`, `src/services/metricsDisplayController.ts`, `src/services/triggerGaugeManager.ts`, `src/services/logger.ts`, `src/styles.css`
- **Rama recomendada:** `feature/alpha-4fps-throttling`

---

## 🎯 Objetivo de la Refactorización "Alpha"
Implementar un límite estricto de **4 frames por segundo (4 FPS = 250 ms por ciclo de renderizado)** en todos los componentes del dashboard de Tauri para minimizar al extremo el consumo de CPU, GPU y memoria en el WebView.

---

## 🛠️ Diseño e Implementación (SOLID + KISS + DRY)

1. **DRY & Single Source of Truth (`src/utils/constants.ts`):**
   - Centralicé la cadencia global en `TARGET_MAX_FPS = 4` y `FRAME_BUDGET_MS = 250`.
   - Todos los servicios consumen esta constante única, eliminando números mágicos (`magic numbers`) dispersos.

2. **Canvas Render Throttling (`ChartRenderer`):**
   - El bucle `renderLoop` compara el delta de tiempo con `FRAME_BUDGET_MS`. Si el tiempo transcurrido desde el último frame es menor a 250 ms, se pospone la ejecución al siguiente ciclo de `rAF`.

3. **Metrics Display Batching (`MetricsDisplayController`):**
   - El scheduler de actualización de métricas del DOM (Bid, Ask, Spread, Feed Rate, PnL y tasas de sesión) opera a intervalos de 250 ms con dirty-checking.

4. **Trigger Gauge Throttling (`TriggerGaugeManager`):**
   - Integré `requestRender()` con `renderLoop` en `TriggerGaugeManager`, sincronizando los cálculos de indicadores de tendencia/reversión al presupuesto de 4 FPS.

5. **Logger Console Batching (`LoggerService`):**
   - Agrupé las inserciones de logs en ráfagas utilizando `DocumentFragment` y flush diferido a 250 ms.

6. **CSS Layout Containment (`src/styles.css`):**
   - Aplicación de `contain: layout style paint;` en el contenedor del Canvas y la consola de logs.

---

## 📈 Impacto y Verificación
- **Consumo de CPU/GPU:** Reducción drástica del cómputo gráfico y operaciones de DOM.
- **Compilación:** `npm run build` ejecutado y validado con 0 errores (código de salida 0).
