export type CompletionStatus = "not_started" | "partial" | "done" | "validation_failed";

export type AuthoredText = {
  ai?: string;
  human?: string;
};

export type Column = {
  name: string;
  type: "string" | "number" | "time" | "boolean";
  pk?: boolean;
  nullable?: boolean;
  descriptions: AuthoredText;
};

export type Join = {
  to: string;
  on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  alias?: string;
  source?: "formal" | "manual" | "candidate";
};

export type Measure = {
  name: string;
  expr: string;
  filter?: string;
  description?: string;
};

export type Segment = {
  name: string;
  expr: string;
  description?: string;
};

export type TableModel = {
  conn: string;
  schema: string;
  table: string;
  filePath: string;
  qualifiedName?: string;
  descriptions: AuthoredText;
  grain?: string[];
  columns: Column[];
  measures?: Measure[];
  segments?: Segment[];
  joins?: Join[];
  unknownKeys?: string[];
};

export type SourceSummary = {
  conn: string;
  schema: string;
  table: string;
  filePath: string;
  columnCount: number;
  columnNames: string[];
  hasTableDesc: boolean;
  hasGrain: boolean;
  measureCount: number;
  joinCount: number;
  wikiRefCount: number;
  completion: CompletionStatus;
  mtime: string;
};

export type ProjectInfo = {
  root: string;
  connections: Array<{
    id: string;
    driver?: string;
    passwordSource?: "file" | "inline" | "env";
    schemas: string[];
  }>;
  ktxAvailable: boolean;
};

export type SourcesResponse = {
  tables: SourceSummary[];
};

export type SourceDetail = {
  model: TableModel;
  rawYaml: string;
  completion: CompletionStatus;
};

export type TablePatch = {
  tableDescription?: string;
  grain?: string[];
  measures?: Measure[];
  segments?: Segment[];
  joins?: Join[];
  columns?: Array<{
    name: string;
    description?: string;
  }>;
};

export type SourcePreview = {
  diff: string;
  proposedYaml: string;
  files: Array<{
    filePath: string;
    diff: string;
    proposedYaml: string;
  }>;
};

export type ValidationResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  issues?: Array<{ message: string }>;
};

export type ChangedFile = {
  filePath: string;
  status: string;
  diff: string;
};

export type SourceSaveResponse = {
  written: true;
  validation: ValidationResult;
  changedFiles: ChangedFile[];
};

export type ChangedFilesResponse = {
  files: ChangedFile[];
};

export type ValidateChangedResponse = {
  results: Array<{
    conn: string;
    schema: string;
    table: string;
    validation: ValidationResult;
  }>;
};

export type WikiFrontmatter = {
  summary?: string;
  tags?: string[];
  sl_refs?: string[];
  refs?: string[];
  usage_mode?: string;
};

export type WikiSummary = {
  key: string;
  summary?: string;
  tags: string[];
  slRefs: string[];
};

export type WikiListResponse = {
  pages: WikiSummary[];
};

export type WikiPage = {
  key: string;
  frontmatter: WikiFrontmatter;
  content: string;
  rawMarkdown: string;
};

export type WikiPreview = {
  key: string;
  filePath: string;
  diff: string;
  proposedMarkdown: string;
};

export type JoinCandidate = {
  conn: string;
  schema: string;
  fromTable: string;
  join: Join;
  confidence: "candidate" | "rejected";
  note?: string;
};

export type JoinCandidatesResponse = {
  version: 1;
  candidates: JoinCandidate[];
};
