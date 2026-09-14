export type Result = 'reproduced' | 'not_reproduced' | 'blocked' | 'needs_context'
export type InvestigationRun = {
  execution_kind?: 'hermes' | 'local_validation';
  id:string; case_id:string; case_revision:number; owner_version:number; build:string; version:number;
  status:string; detail:string; created_at:string; checked_at:string; deadline:string; max_seconds:number;
  remote_id:string|null; output:string|null; stop_requested:boolean; context_stale:boolean; context:unknown;
  usage:{input_tokens?:number;output_tokens?:number;total_tokens?:number;cost_usd?:number;cached_input_tokens?:number;cache_write_input_tokens?:number;reasoning_output_tokens?:number;model_calls?:number;tool_calls?:number;model?:string;provider?:string}|null;
  context_hash?:string;
  usage_audit?:{observed_at:string|null;fields_observed_at:Record<string,string>;receipts:{observed_at:string;reported:Record<string,number|string>;revised_downward:string[]}[];omitted_receipts:number};
  events:{sequence:number;kind:string;at:string;detail:string}[];
}
export type CaseStatus = Result | 'new'
export type Observation = {
  id: string; result: Result; observed: string; build: string; evidence_url: string;
  steps: string; author: string; at: string; case_revision: number; verification: 'human_recorded';
}
export type Case = {
  id: string; title: string; project: string; url: string; description: string;
  expected: string; build: string; owner_version: number; handoffs: Handoff[]; source: string; status: CaseStatus; revision: number;
  created_at: string; updated_at: string; observations: Observation[];
  events: {id: string; kind: string; at: string; detail: string; case_revision: number}[];
}
export type Memory = {
  id: string; case_id: string; revision: number; reviewer: string; created_at: string;
  title: string; project: string; observation: Observation; matched_terms: string[];
  kind: 'reviewed_observation';
}
export type Health = {
  status: string; mode: string; memory: string;
  integrations: Record<string, boolean>;
}

export type Role = 'investigator' | 'repair' | 'verifier' | 'update'
export type ContextView = {
  case_id: string; case_revision: number; role: Role; expected: string;
  source_event_ids: string[]; related_reviewed_observations: Memory[];
}
export type Handoff = {
  id: string; role: Role; case_revision: number; build: string; owner_version: number;
  created_at: string; status: 'prepared' | 'checked' | 'stale' | 'superseded';
  reason: string | null; context: ContextView; memory_ids: string[];
}
