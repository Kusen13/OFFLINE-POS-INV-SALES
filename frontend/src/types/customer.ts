export interface Customer {
  id: number;
  uuid: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  credit_limit: number;
  current_balance: number;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  ledger?: CustomerLedgerEntry[];
}

export interface CustomerLedgerEntry {
  id: number;
  uuid: string;
  customer_id: number;
  transaction_type: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT';
  amount: number;
  balance_after: number;
  reference_type: string;
  reference_id?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface CustomerSummary {
  total_receivables: number;
  debtor_count: number;
  total_customers: number;
  collected_today: number;
}
