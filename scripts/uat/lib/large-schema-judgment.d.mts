export function judgeReadTables(
  result: { done: number; columns: number; failure: string },
  expectedTables: number,
  expectedColumnsMin: number
): { pass: boolean; reason: string };
