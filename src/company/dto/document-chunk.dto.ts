export type DocumentStatus = 'draft' | 'published' | 'disabled';

export interface Documentdata {
  companyId: string;
  title: string;
  sourceType?: string;
  text: string;
  status?: DocumentStatus;
}

