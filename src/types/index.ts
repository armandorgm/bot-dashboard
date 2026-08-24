export interface InstanceConfig {
  instance_id: string;
  symbol: string;
  port: string;
  parent_api_port: string;
}

export interface TickData {
  time: number;
  bid: number;
  ask: number;
}

export interface HftEvent {
  e: 'HFT_EVENT';
  type: 'buy' | 'sell' | 'cancel' | 'query' | 'buy_placed' | 'sell_placed' | 'cancel_failed' | 'cancel_buy' | 'cancel_sell' | 'cancel_buy_failed' | 'cancel_sell_failed' | 'trigger_rejected' | 'trigger_passed';
  time: number;
  price?: number;
  qty?: number;
  symbol: string;
  orderId?: string;
  detail: string;
  triggerData?: StrategyTriggerStatus;
}

export interface VisualMarker {
  x: number;
  y: number;
  events: HftEvent[];
}

export interface ChasePipelineProcess {
  id: number;
  pipeline_id: number;
  instance_id?: number;
  symbol: string;
  entry_order_id?: string;
  exit_order_id?: string;
  status: 'CHASING' | 'WAITING_FILL' | 'PLACING_TP' | 'COMPLETED' | 'ABORTED' | string;
  sub_status: string;
  initial_price?: number;
  last_tick_price?: number;
  last_order_price?: number;
  side: string;
  amount: number;
  created_at?: string;
  finished_at?: string;
}

export interface OpenOrder {
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

export interface ModificationInfo {
  timestamp: number;
  order_id: string;
  side: string;
  quantity: number;
  old_price: number | null;
  new_price: number | null;
}

export type TriggerState = 'TREND_ACCUMULATION' | 'FLIP_CONMUTATED' | 'READY' | 'NO_DATA' | 'BLOCKED' | 'PASSED';
export type ConmutatorMode = 'TREND_BUY' | 'TREND_SELL' | 'FLIP_SELL' | 'FLIP_BUY' | 'SEED' | 'FALLBACK';
export type ResolvedSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT' | 'FLAT';

export type POICategory =
  | 'REAL_ORDER'
  | 'VIRTUAL_ORDER'
  | 'EXECUTED_PENDING'
  | 'FLIP_TRIGGER'
  | 'NEW_PROCESS'
  | 'ENTRY_REF';

export interface TacticalPOI {
  id: string;
  price: number;
  category: POICategory;
  side: 'BUY' | 'SELL' | 'NEUTRAL';
  label: string;
  subLabel?: string;
  isPrimary?: boolean;
}

export interface TacticalCluster {
  x: number;
  pois: TacticalPOI[];
}

export interface StrategyTriggerStatus {
  instance_id: number;
  symbol: string;
  strategy: string;
  condition_name?: string;
  state: TriggerState;
  conmutator_mode?: ConmutatorMode;
  resolved_side?: ResolvedSide;
  position_side: PositionSide;
  entry_price: number;
  current_price: number;
  trigger_price: number | null;
  actual_pullback_pc?: number;
  required_pullback_pc?: number;
  current_metric_pc: number;
  required_metric_pc: number;
  delta_remaining_pc: number;
  multiplier?: number;
  timestamp?: string;
  updated_at?: number;
}

export interface WsBusinessNotificationMessage {
  type: 'strategy_trigger_status' | 'order_update' | 'balance_update' | 'connection_established' | string;
  data: any;
}

export interface InstanceTelemetry {
  name: string;
  symbol: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'STOPPED' | string;
  strategy_type: string;
  chase_behavior: 'flat' | 'fibonacci' | string;
  allocated_capital: number;
  used_capital: number;
  available_capital: number;
  open_processes_count?: number;
  total_open_orders?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  lifetime_pnl?: number;
  total_pnl?: number;
  trigger_status?: StrategyTriggerStatus;
}

export type AllInstancesTelemetryResponse = Record<string | number, InstanceTelemetry>;

export interface BotInstanceData {
  id: number;
  name: string;
  symbol: string;
  strategy_type: string;
  allocated_capital: number;
  used_capital?: number;
  lifetime_pnl?: number;
  created_at?: string;
  status: string;
  params: Record<string, any>;
  trigger_status?: StrategyTriggerStatus;
}

export interface StrategyManifestItem {
  class?: string;
  modularity: 'SEALED' | 'COMPOSABLE' | string;
  allowed_slots: string[];
  allowed_types?: Record<string, string[]>;
  description?: string;
}

export interface StrategiesManifest {
  description?: string;
  definitions?: {
    modularity_modes: string[];
  };
  strategies: Record<string, StrategyManifestItem>;
}

export interface GlobalOverviewResponse {
  status: string;
  portfolio_summary: {
    total_lifetime_pnl: number;
    total_session_pnl?: number;
    total_unrealized_pnl?: number;
    total_session_unrealized_pnl?: number;
    total_trades: number;
    total_instances: number;
    active_instances: number;
  };
  instances: Array<{
    id: number;
    name: string;
    symbol: string;
    strategy_type: string;
    status: string;
    allocated_capital: number;
    used_capital: number;
    lifetime_pnl: number;
    session_pnl?: number | null;
    unrealized_pnl?: number;
    session_unrealized_pnl?: number | null;
    total_trades: number;
    session_trades?: number | null;
    session_start_time?: string | null;
    winning_trades: number;
    win_rate_pc: number;
    traded_volume: number;
    created_at: string;
    trigger_status?: StrategyTriggerStatus;
  }>;
}
