export type Severity = 'error' | 'warning' | 'info' | 'off';
export type FileId = string;

export interface SourceSpan {
  file: FileId;
  line: number;
  column: number;
  length?: number;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  span: SourceSpan;
  related?: SourceSpan[];
  data?: Record<string, unknown>;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Pose extends Vec3 {
  a?: number;
}
