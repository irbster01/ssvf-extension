/** Shared types, interfaces, and constants for the extension popup */

export interface NetSuiteVendor {
  id: string;
  entityId: string;
  companyName: string;
}

export interface ClientRecord {
  id: string;
  clientName: string;
  provider?: string;
  program?: string;
  region?: string;
}

export interface ReceiptAnalysisResult {
  success: boolean;
  message?: string;
  vendorName?: string | null;
  amount?: number | null;
  date?: string | null;
  assistanceType?: string | null;
  description?: string | null;
  confidence: {
    vendorName?: number;
    amount?: number;
    date?: number;
  };
}

export interface CaptureLog {
  timestamp: string;
  status: 'success' | 'error';
  url: string;
  fieldCount: number;
  clientId?: string;
}

export interface Stats {
  totalCaptures: number;
  successfulCaptures: number;
  lastCaptureTime: string | null;
  recentLogs: CaptureLog[];
}

export type SSVFRegion = 'Shreveport' | 'Monroe' | 'Arkansas';
export type ProgramCategory = 'Homeless Prevention' | 'Rapid Rehousing';
export type FinancialAssistanceType =
  | 'Rental Assistance'
  | 'Moving Cost Assistance'
  | 'Utility Deposit'
  | 'Security Deposit'
  | 'Other as approved by VA'
  | 'Utility Assistance'
  | 'Motel/Hotel Voucher'
  | 'Emergency Supplies'
  | 'Transportation';

export const FINANCIAL_ASSISTANCE_TYPES: FinancialAssistanceType[] = [
  'Rental Assistance',
  'Moving Cost Assistance',
  'Utility Deposit',
  'Security Deposit',
  'Other as approved by VA',
  'Utility Assistance',
  'Motel/Hotel Voucher',
  'Emergency Supplies',
  'Transportation',
];

export interface ManualTFAForm {
  clientId: string;
  clientName: string;
  vendor: string;
  amount: string;
  region: SSVFRegion;
  programCategory: ProgramCategory;
  assistanceType: FinancialAssistanceType;
  tfaDate: string;
  notes: string;
}

export interface Submission {
  id: string;
  client_id?: string;
  client_name?: string;
  vendor?: string;
  service_amount?: number;
  service_type?: string;
  status?: 'New' | 'In Progress' | 'Complete';
  captured_at_utc: string;
  region?: string;
  program_category?: string;
  entered_in_system?: boolean;
  entered_in_system_by?: string;
  entered_in_system_at?: string;
  form_data?: {
    assistance_type?: string;
    region?: string;
    program_category?: string;
    [key: string]: any;
  };
}

export interface ThreadMessage {
  id: string;
  text: string;
  sentBy: string;
  sentByName: string;
  sentAt: string;
  readBy: string[];
}

export type TabType = 'activity' | 'manual' | 'submissions';

export const INITIAL_MANUAL_FORM: ManualTFAForm = {
  clientId: '',
  clientName: '',
  vendor: '',
  amount: '',
  region: 'Shreveport',
  programCategory: 'Homeless Prevention',
  assistanceType: 'Rental Assistance',
  tfaDate: '',
  notes: '',
};
