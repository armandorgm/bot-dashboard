# Incidente / Feature: Implementación de Futures Balance Card en Dashboard

## Problema
El operador y trader de la plataforma carecía de visibilidad directa e inmediata sobre el balance de margen global de Binance Futures (USD?-M), margen libre disponible (Free Margin), ratio de margen de mantenimiento y riesgo de liquidación en el dashboard principal.

## Solución
1. **Lideré y diseñé** la arquitectura de datos para balance de futuros con la interfaz FuturesAccountBalance y AssetBalanceItem en src/types/index.ts.
2. **Implementé** la gestión de estado y renderizado desacoplado con *dirty-checking* a 4 FPS (FRAME_BUDGET_MS = 250ms) dentro de MetricsDisplayController.
3. **Integré** la captura en tiempo real de eventos WebSocket alance_update / ACCOUNT_UPDATE en MarketFeedService y fallback de sincronización en main.ts.
4. **Diseñé y construí** la tarjeta dual diagonal FUTURES BALANCE en index.html y el modal de desglose interactivo de activos por divisa (USDT, USDC, BNB) con barra de salud de margen.
5. **Lancé** suite de verificación unitaria en metricsDisplayController.test.ts asegurando pruebas de formato, transiciones de LED de salud y cero parpadeo del DOM.

## Impacto
- Visibilidad total e instantánea del capital global, margen disponible y salud de la cuenta de futuros Binance sin necesidad de cambiar a la interfaz web de Binance.
- Renderizado optimizado sin recargas de página ni *layout thrashing*.

## Recommended Git Branch
eat/futures-balance-card
