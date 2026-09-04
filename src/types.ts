/** Shared domain types. Keep UI and PDF engine decoupled. */

export interface ToolDef {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  icon: string;
  accept: string;
  multiple: boolean;
  maxFilesNote?: string;
}

export type ToolCategory =
  | 'Essentials'
  | 'Edit & Organize'
  | 'Security & Privacy'
  | 'Convert & Export'
  | 'Create from Scratch'
  | 'View & Utilities';

export interface ProcessResult {
  blob: Blob;
  filename: string;
  /** Optional extra files (e.g. split pages as zip counts as one blob, but keep for future). */
  label?: string;
}

export interface PageRange {
  start: number; // 1-based inclusive
  end: number; // 1-based inclusive
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
