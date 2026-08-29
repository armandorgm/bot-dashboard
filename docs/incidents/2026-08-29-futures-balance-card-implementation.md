# Incidente / Feature: Implementación Dual de Futures Balance Card en Global Command Center e Instancias

## Problema
El operador y trader de la plataforma carecía de visibilidad directa e inmediata sobre el balance de margen global de Binance Futures (USD?-M), margen libre disponible (Free Margin), ratio de margen de mantenimiento y riesgo de liquidación, tanto a nivel macro de portafolio en el Global Command Center (HOME) como en el dashboard operativo de instancias individuales.

## Solución
1. **Lideré y diseñé** la arquitectura de datos para balance de futuros con la interfaz FuturesAccountBalance y AssetBalanceItem en src/types/index.ts.
2. **Implementé** la gestión de estado y renderizado desacoplado con *dirty-checking* a 4 FPS (FRAME_BUDGET_MS = 250ms) dentro de MetricsDisplayController, sincronizando simultáneamente la vista del Global Command Center (#ov-card-futures-balance) y la vista de instancia (#card-futures-balance).
3. **Integré** la captura en tiempo real de eventos WebSocket alance_update / ACCOUNT_UPDATE en MarketFeedService y fallback de sincronización en main.ts.
4. **Diseñé y construí** las tarjetas duales diagonales BINANCE FUTURES BALANCE en ambas vistas (index.html) y el modal de desglose interactivo de activos por divisa (USDT, USDC, BNB) con barra de salud de margen accesible desde cualquier pantalla.
5. **Lancé** suite de verificación unitaria en metricsDisplayController.test.ts asegurando pruebas de formato dual, transiciones de LED de salud y cero parpadeo del DOM.

## Impacto
- Visibilidad total, instantánea y unificada del capital global, margen disponible y salud de la cuenta de futuros Binance en todo momento (vista HOME y vista de instancias) sin recargas ni *layout thrashing*.

## Recommended Git Branch
eat/futures-balance-card
