// ============================================================
// Sync Types
// ============================================================

export interface SyncResult {
  synced_count: number;
  duplicate_count: number;
  failed_count: number;
  synced: SyncedItem[];
  duplicates: SyncedItem[];
  failed: FailedItem[];
  server_time: string;
}

export interface SyncedItem {
  status: 'synced' | 'duplicate';
  uuid: string;
  receipt_number: string;
  server_id: number;
}

export interface FailedItem {
  uuid: string;
  receipt_number: string;
  error: string;
}

export interface SyncProductsResponse {
  categories: import('./product').Category[];
  products: import('./product').Product[];
  payment_methods: import('./sale').PaymentMethod[];
  settings: Record<string, string>;
  server_time: string;
  is_incremental: boolean;
}

export interface SyncLog {
  id: number;
  transaction_uuid: string;
  device_id: string | null;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'DUPLICATE';
  request_summary: string | null;
  error_message: string | null;
  items_count: number;
  total_amount: number;
  synced_at: string;
  created_at: string;
}

export interface SyncStatus {
  total_sales: number;
  today_synced: number;
  recent_failures: number;
  recent_logs: SyncLog[];
  server_time: string;
}
