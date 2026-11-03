/**
 * Strict Hive SQL tokenizer, parser and post-parse safety checks.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.3.5
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H5)
 *
 * Why a hand-written parser instead of a library:
 *
 * - The repo may not take a new runtime dependency, and no Node SQL parser is
 *   already installed.
 * - The check has to be a *parse*, not a pattern match: the Spec forbids
 *   regex-rewriting SQL, string-replacing functions and blind re-transpiling.
 *   A tokenizer plus recursive descent gives a real tree that can be walked
 *   for dependencies, output columns and predicate placement.
 *
 * What this module deliberately does NOT do:
 *
 * - It never rewrites the SQL. The compiled statement is either accepted as
 *   parsed or rejected.
 * - It does not decide whether HiveServer2 can execute the statement. A
 *   successful parse proves the *shape*, not the dialect support of a
 *   function. In particular `DATE_TRUNC('MONTH', ts)` parses fine but is only
 *   proven executable by a real HS2 EXPLAIN (Spec V04), never here.
 * - It does not re-transpile anything. The SQL arrives already compiled by
 *   the unmodified KTX daemon.
 */

export const HIVE_MAX_SQL_BYTES = 256 * 1024;

// ── tokenizer ────────────────────────────────────────────────────────────────

export type HiveTokenKind =
  | "identifier"
  | "quotedIdentifier"
  | "string"
  | "number"
  | "operator"
  | "punct"
  | "keyword";

export type HiveToken = {
  kind: HiveTokenKind;
  /** Raw source text. */
  text: string;
  /** Identifier/keyword: lower-cased. String: decoded content. */
  value: string;
  start: number;
  end: number;
};

/**
 * Reserved words that may not be used as a bare identifier. Hive itself
 * rejects them, so accepting them would let a crafted asset define a source
 * named `select`.
 */
const RESERVED_WORDS = new Set([
  "select", "from", "where", "group", "by", "having", "order", "limit", "offset",
  "join", "inner", "left", "right", "full", "outer", "cross", "on", "as", "with",
  "union", "intersect", "except", "distinct", "and", "or", "not", "is", "null",
  "true", "false", "like", "rlike", "in", "between", "case", "when", "then",
  "else", "end", "asc", "desc", "over", "partition", "div", "lateral", "view",
  "rows", "range", "unbounded", "preceding", "following", "current", "row",
  "interval", "explode", "tablesample", "qualify", "window", "recursive",
  "insert", "update", "delete", "merge", "create", "drop", "alter", "truncate",
  "replace", "load", "export", "add", "set", "use", "msck", "grant", "revoke",
  "analyze", "cache", "uncache", "describe", "desc", "show", "explain",
  "values", "into", "table", "computed", "otherwise", "double", "float", "bigint",
  "int", "integer", "smallint", "tinyint", "decimal", "numeric", "boolean",
  "string", "varchar", "char", "date", "timestamp", "binary", "array", "map",
  "struct", "uniontype", "semi", "anti", "natural", "join",
]);

/**
 * Keywords that make a statement a write / session / metadata operation.
 * The Hive query path never accepts them — system metadata operations belong
 * to a separate, fixed operation list (Spec §4.3.6).
 */
const WRITE_KEYWORDS = new Set([
  "insert", "update", "delete", "merge", "create", "drop", "alter", "truncate",
  "replace", "load", "export", "add", "set", "use", "msck", "grant", "revoke",
  "analyze", "cache", "uncache", "describe", "desc", "show", "explain"
]);

const MULTI_CHAR_OPERATORS = ["<=", ">=", "<>", "!=", "||", "->", "::"];

export type HiveTokenizeResult =
  | { ok: true; tokens: HiveToken[] }
  | { ok: false; reason: string; position: number };

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * Tokenize Hive SQL. Fails closed on an unterminated string / identifier /
 * comment — a statement we cannot fully read is a statement we cannot check.
 */
export function tokenizeHiveSql(sql: string): HiveTokenizeResult {
  const tokens: HiveToken[] = [];
  let index = 0;
  const length = sql.length;

  while (index < length) {
    const ch = sql[index]!;

    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    // Line comment
    if (ch === "-" && sql[index + 1] === "-") {
      while (index < length && sql[index] !== "\n") index += 1;
      continue;
    }

    // Block comment
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) {
        return { ok: false, reason: "Unterminated block comment", position: index };
      }
      index = end + 2;
      continue;
    }

    // Single-quoted string literal ('...' with '' and \' escapes)
    if (ch === "'") {
      const start = index;
      index += 1;
      let value = "";
      let closed = false;
      while (index < length) {
        const current = sql[index]!;
        if (current === "\\" && index + 1 < length) {
          value += sql[index + 1]!;
          index += 2;
          continue;
        }
        if (current === "'") {
          if (sql[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        return { ok: false, reason: "Unterminated string literal", position: start };
      }
      tokens.push({ kind: "string", text: sql.slice(start, index), value, start, end: index });
      continue;
    }

    // Double-quoted string literal (Hive treats "..." as a string)
    if (ch === '"') {
      const start = index;
      index += 1;
      let value = "";
      let closed = false;
      while (index < length) {
        const current = sql[index]!;
        if (current === "\\" && index + 1 < length) {
          value += sql[index + 1]!;
          index += 2;
          continue;
        }
        if (current === '"') {
          if (sql[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        return { ok: false, reason: "Unterminated string literal", position: start };
      }
      tokens.push({ kind: "string", text: sql.slice(start, index), value, start, end: index });
      continue;
    }

    // Backtick-quoted identifier
    if (ch === "`") {
      const start = index;
      index += 1;
      let value = "";
      let closed = false;
      while (index < length) {
        const current = sql[index]!;
        if (current === "`") {
          if (sql[index + 1] === "`") {
            value += "`";
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        return { ok: false, reason: "Unterminated quoted identifier", position: start };
      }
      tokens.push({
        kind: "quotedIdentifier",
        text: sql.slice(start, index),
        value,
        start,
        end: index
      });
      continue;
    }

    // Number
    if (isDigit(ch) || (ch === "." && isDigit(sql[index + 1] ?? ""))) {
      const start = index;
      while (index < length && isDigit(sql[index]!)) index += 1;
      if (sql[index] === ".") {
        index += 1;
        while (index < length && isDigit(sql[index]!)) index += 1;
      }
      if (sql[index] === "e" || sql[index] === "E") {
        const save = index;
        index += 1;
        if (sql[index] === "+" || sql[index] === "-") index += 1;
        if (isDigit(sql[index] ?? "")) {
          while (index < length && isDigit(sql[index]!)) index += 1;
        } else {
          index = save;
        }
      }
      const text = sql.slice(start, index);
      tokens.push({ kind: "number", text, value: text, start, end: index });
      continue;
    }

    // Identifier / keyword
    if (isIdentifierStart(ch)) {
      const start = index;
      while (index < length && isIdentifierPart(sql[index]!)) index += 1;
      const text = sql.slice(start, index);
      const value = text.toLowerCase();
      tokens.push({
        kind: RESERVED_WORDS.has(value) ? "keyword" : "identifier",
        text,
        value,
        start,
        end: index
      });
      continue;
    }

    // Operators / punctuation
    const two = sql.slice(index, index + 2);
    if (MULTI_CHAR_OPERATORS.includes(two)) {
      tokens.push({ kind: "operator", text: two, value: two, start: index, end: index + 2 });
      index += 2;
      continue;
    }
    if ("+-*/%<>=&|^~".includes(ch)) {
      tokens.push({ kind: "operator", text: ch, value: ch, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if ("(),;.[]".includes(ch)) {
      tokens.push({ kind: "punct", text: ch, value: ch, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    return {
      ok: false,
      reason: `Unexpected character '${ch}'`,
      position: index
    };
  }

  return { ok: true, tokens };
}

// ── AST ──────────────────────────────────────────────────────────────────────

export type HiveExpr =
  | { kind: "literal"; literalType: "string" | "number" | "boolean" | "null"; value: string }
  | { kind: "column"; parts: string[] }
  | { kind: "star"; qualifier?: string }
  | { kind: "function"; name: string; args: HiveExpr[]; distinct: boolean }
  | { kind: "binary"; operator: string; left: HiveExpr; right: HiveExpr }
  | { kind: "unary"; operator: string; operand: HiveExpr }
  | { kind: "isNull"; operand: HiveExpr; negated: boolean }
  | { kind: "in"; operand: HiveExpr; values: HiveExpr[]; negated: boolean }
  | { kind: "between"; operand: HiveExpr; low: HiveExpr; high: HiveExpr; negated: boolean }
  | {
      kind: "case";
      operand?: HiveExpr;
      whens: Array<{ when: HiveExpr; then: HiveExpr }>;
      else?: HiveExpr;
    }
  | { kind: "cast"; expr: HiveExpr; targetType: string }
  | { kind: "nested"; expr: HiveExpr };

export type HiveTableRef =
  | { kind: "table"; database?: string; table: string; alias?: string }
  | { kind: "subquery"; query: HiveQuery; alias?: string };

export type HiveJoinType = "inner" | "left" | "right" | "full" | "cross";

export type HiveJoin = {
  type: HiveJoinType;
  ref: HiveTableRef;
  on?: HiveExpr;
};

export type HiveSelectItem = { expr: HiveExpr; alias?: string };

export type HiveOrderItem = { expr: HiveExpr; direction: "asc" | "desc" };

export type HiveCte = { name: string; query: HiveQuery };

export type HiveQuery = {
  ctes: HiveCte[];
  distinct: boolean;
  select: HiveSelectItem[];
  from: HiveTableRef;
  joins: HiveJoin[];
  where?: HiveExpr;
  groupBy?: HiveExpr[];
  having?: HiveExpr;
  orderBy?: HiveOrderItem[];
  limit?: number;
};

export type HiveStatement = { query: HiveQuery };

// ── parser ──────────────────────────────────────────────────────────────────

export class HiveParseError extends Error {
  readonly kind: "syntax" | "not_readonly";
  readonly position: number;

  constructor(kind: "syntax" | "not_readonly", message: string, position: number) {
    super(message);
    this.name = "HiveParseError";
    this.kind = kind;
    this.position = position;
  }
}

const CLAUSE_KEYWORDS = new Set([
  "from", "where", "group", "having", "order", "limit", "join", "inner", "left",
  "right", "full", "cross", "on", "union", "intersect", "except", "as", "when",
  "then", "else", "end", "and", "or", "not", "is", "in", "between", "like",
  "asc", "desc", "over", "partition", "distinct"
]);

class HiveParser {
  private readonly tokens: HiveToken[];
  private position = 0;

  constructor(tokens: HiveToken[]) {
    this.tokens = tokens;
  }

  /** Look ahead without consuming. */
  peek(offset = 0): HiveToken | undefined {
    return this.tokens[this.position + offset];
  }

  /** True when every token has been consumed. */
  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  private next(): HiveToken | undefined {
    const token = this.tokens[this.position];
    if (token) this.position += 1;
    return token;
  }

  private atKeyword(...names: string[]): boolean {
    const token = this.peek();
    if (!token || token.kind !== "keyword") return false;
    return names.includes(token.value);
  }

  private atPunct(value: string): boolean {
    const token = this.peek();
    return Boolean(token && token.kind === "punct" && token.value === value);
  }

  private atOperator(...values: string[]): boolean {
    const token = this.peek();
    return Boolean(token && token.kind === "operator" && values.includes(token.value));
  }

  private expectPunct(value: string): HiveToken {
    const token = this.peek();
    if (!token || token.kind !== "punct" || token.value !== value) {
      throw new HiveParseError(
        "syntax",
        `Expected '${value}' but found '${token?.text ?? "<end of statement>"}'`,
        token?.start ?? this.tokens.length
      );
    }
    this.position += 1;
    return token;
  }

  private expectKeyword(...names: string[]): HiveToken {
    const token = this.peek();
    if (!token || token.kind !== "keyword" || !names.includes(token.value)) {
      throw new HiveParseError(
        "syntax",
        `Expected ${names.map((name) => `'${name}'`).join(" or ")} but found '${token?.text ?? "<end of statement>"}'`,
        token?.start ?? this.tokens.length
      );
    }
    this.position += 1;
    return token;
  }

  private assertNotWrite(token: HiveToken | undefined): void {
    if (token && token.kind === "keyword" && WRITE_KEYWORDS.has(token.value)) {
      throw new HiveParseError(
        "not_readonly",
        `Statement keyword '${token.text}' is not allowed on the Hive query path`,
        token.start
      );
    }
  }

  parseStatement(): HiveStatement {
    const first = this.peek();
    this.assertNotWrite(first);
    if (!first) {
      throw new HiveParseError("syntax", "Empty statement", 0);
    }
    const query = this.parseQuery();
    // Exactly one statement: a trailing semicolon is allowed, a second
    // statement is not.
    if (this.atPunct(";")) {
      this.position += 1;
    }
    const trailing = this.peek();
    if (trailing) {
      this.assertNotWrite(trailing);
      throw new HiveParseError(
        "syntax",
        `Unexpected trailing token '${trailing.text}' after the statement`,
        trailing.start
      );
    }
    return { query };
  }

  parseQuery(): HiveQuery {
    const ctes: HiveCte[] = [];
    if (this.atKeyword("with")) {
      this.position += 1;
      // Optional RECURSIVE
      if (this.atKeyword("recursive")) this.position += 1;
      for (;;) {
        const nameToken = this.peek();
        if (!nameToken || (nameToken.kind !== "identifier" && nameToken.kind !== "quotedIdentifier")) {
          throw new HiveParseError(
            "syntax",
            "Expected a CTE name",
            nameToken?.start ?? 0
          );
        }
        this.position += 1;
        this.expectKeyword("as");
        this.expectPunct("(");
        const cteQuery = this.parseQuery();
        this.expectPunct(")");
        ctes.push({ name: nameToken.value, query: cteQuery });
        if (this.atPunct(",")) {
          this.position += 1;
          continue;
        }
        break;
      }
    }

    this.expectKeyword("select");
    const distinct = this.atKeyword("distinct");
    if (distinct) this.position += 1;

    const select: HiveSelectItem[] = [];
    do {
      select.push(this.parseSelectItem());
    } while (this.atPunct(",") && (this.position += 1, true));

    this.expectKeyword("from");
    const from = this.parseTableRef();
    const joins: HiveJoin[] = [];
    while (this.atKeyword("join", "inner", "left", "right", "full", "cross")) {
      joins.push(this.parseJoin());
    }

    let where: HiveExpr | undefined;
    if (this.atKeyword("where")) {
      this.position += 1;
      where = this.parseExpr();
    }

    let groupBy: HiveExpr[] | undefined;
    if (this.atKeyword("group")) {
      this.position += 1;
      this.expectKeyword("by");
      groupBy = [];
      do {
        groupBy.push(this.parseExpr());
      } while (this.atPunct(",") && (this.position += 1, true));
    }

    let having: HiveExpr | undefined;
    if (this.atKeyword("having")) {
      this.position += 1;
      having = this.parseExpr();
    }

    let orderBy: HiveOrderItem[] | undefined;
    if (this.atKeyword("order")) {
      this.position += 1;
      this.expectKeyword("by");
      orderBy = [];
      do {
        const expr = this.parseExpr();
        let direction: "asc" | "desc" = "asc";
        if (this.atKeyword("asc", "desc")) {
          direction = this.next()!.value as "asc" | "desc";
        }
        orderBy.push({ expr, direction });
      } while (this.atPunct(",") && (this.position += 1, true));
    }

    let limit: number | undefined;
    if (this.atKeyword("limit")) {
      this.position += 1;
      const token = this.next();
      if (!token || token.kind !== "number" || !/^\d+$/.test(token.text)) {
        throw new HiveParseError(
          "syntax",
          "LIMIT requires a non-negative integer literal",
          token?.start ?? 0
        );
      }
      limit = Number(token.text);
    }

    if (this.atKeyword("union", "intersect", "except")) {
      const token = this.peek()!;
      throw new HiveParseError(
        "syntax",
        `Set operation '${token.text.toUpperCase()}' is not allowed on the Hive query path`,
        token.start
      );
    }

    return { ctes, distinct, select, from, joins, where, groupBy, having, orderBy, limit };
  }

  private parseSelectItem(): HiveSelectItem {
    const expr = this.parseExpr();
    let alias: string | undefined;
    if (this.atKeyword("as")) {
      this.position += 1;
      const token = this.next();
      if (!token || (token.kind !== "identifier" && token.kind !== "quotedIdentifier" && token.kind !== "string")) {
        throw new HiveParseError("syntax", "Expected an alias after AS", token?.start ?? 0);
      }
      alias = token.value;
    } else {
      const token = this.peek();
      if (
        token &&
        (token.kind === "identifier" || token.kind === "quotedIdentifier") &&
        !CLAUSE_KEYWORDS.has(token.value)
      ) {
        this.position += 1;
        alias = token.value;
      }
    }
    return { expr, alias };
  }

  private parseTableRef(): HiveTableRef {
    if (this.atPunct("(")) {
      this.position += 1;
      const query = this.parseQuery();
      this.expectPunct(")");
      const alias = this.parseOptionalAlias();
      return { kind: "subquery", query, alias };
    }
    const token = this.next();
    if (!token || (token.kind !== "identifier" && token.kind !== "quotedIdentifier")) {
      throw new HiveParseError(
        "syntax",
        `Expected a table reference but found '${token?.text ?? "<end of statement>"}'`,
        token?.start ?? 0
      );
    }
    if (this.atPunct(".")) {
      this.position += 1;
      const tableToken = this.next();
      if (!tableToken || (tableToken.kind !== "identifier" && tableToken.kind !== "quotedIdentifier")) {
        throw new HiveParseError("syntax", "Expected a table name", tableToken?.start ?? 0);
      }
      const alias = this.parseOptionalAlias();
      return { kind: "table", database: token.value, table: tableToken.value, alias };
    }
    const alias = this.parseOptionalAlias();
    return { kind: "table", table: token.value, alias };
  }

  private parseOptionalAlias(): string | undefined {
    if (this.atKeyword("as")) {
      this.position += 1;
      const token = this.next();
      if (!token || (token.kind !== "identifier" && token.kind !== "quotedIdentifier")) {
        throw new HiveParseError("syntax", "Expected an alias after AS", token?.start ?? 0);
      }
      return token.value;
    }
    const token = this.peek();
    if (
      token &&
      (token.kind === "identifier" || token.kind === "quotedIdentifier") &&
      !CLAUSE_KEYWORDS.has(token.value)
    ) {
      this.position += 1;
      return token.value;
    }
    return undefined;
  }

  private parseJoin(): HiveJoin {
    let type: HiveJoinType = "inner";
    if (this.atKeyword("cross")) {
      this.position += 1;
      type = "cross";
    } else if (this.atKeyword("inner")) {
      this.position += 1;
      type = "inner";
    } else if (this.atKeyword("left")) {
      this.position += 1;
      if (this.atKeyword("outer")) this.position += 1;
      type = "left";
    } else if (this.atKeyword("right")) {
      this.position += 1;
      if (this.atKeyword("outer")) this.position += 1;
      type = "right";
    } else if (this.atKeyword("full")) {
      this.position += 1;
      if (this.atKeyword("outer")) this.position += 1;
      type = "full";
    }
    this.expectKeyword("join");
    const ref = this.parseTableRef();
    let on: HiveExpr | undefined;
    if (this.atKeyword("on")) {
      this.position += 1;
      on = this.parseExpr();
    }
    return { type, ref, on };
  }

  parseExpr(): HiveExpr {
    return this.parseOr();
  }

  private parseOr(): HiveExpr {
    let left = this.parseAnd();
    while (this.atKeyword("or")) {
      this.position += 1;
      const right = this.parseAnd();
      left = { kind: "binary", operator: "or", left, right };
    }
    return left;
  }

  private parseAnd(): HiveExpr {
    let left = this.parseNot();
    while (this.atKeyword("and")) {
      this.position += 1;
      const right = this.parseNot();
      left = { kind: "binary", operator: "and", left, right };
    }
    return left;
  }

  private parseNot(): HiveExpr {
    if (this.atKeyword("not")) {
      this.position += 1;
      return { kind: "unary", operator: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): HiveExpr {
    let left = this.parseAdditive();

    for (;;) {
      if (this.atOperator("=", "!=", "<>", "<", "<=", ">", ">=")) {
        const operator = this.next()!.value;
        const right = this.parseAdditive();
        left = { kind: "binary", operator, left, right };
        continue;
      }
      if (this.atKeyword("is")) {
        this.position += 1;
        const negated = this.atKeyword("not");
        if (negated) this.position += 1;
        this.expectKeyword("null");
        left = { kind: "isNull", operand: left, negated };
        continue;
      }
      if (this.atKeyword("not")) {
        // NOT LIKE / NOT IN / NOT BETWEEN
        const save = this.position;
        this.position += 1;
        if (this.atKeyword("like")) {
          this.position += 1;
          const right = this.parseAdditive();
          left = { kind: "binary", operator: "not like", left, right };
          continue;
        }
        if (this.atKeyword("in")) {
          this.position += 1;
          const values = this.parseExprList();
          left = { kind: "in", operand: left, values, negated: true };
          continue;
        }
        if (this.atKeyword("between")) {
          this.position += 1;
          const low = this.parseAdditive();
          this.expectKeyword("and");
          const high = this.parseAdditive();
          left = { kind: "between", operand: left, low, high, negated: true };
          continue;
        }
        this.position = save;
        break;
      }
      if (this.atKeyword("like")) {
        this.position += 1;
        const right = this.parseAdditive();
        left = { kind: "binary", operator: "like", left, right };
        continue;
      }
      if (this.atKeyword("in")) {
        this.position += 1;
        const values = this.parseExprList();
        left = { kind: "in", operand: left, values, negated: false };
        continue;
      }
      if (this.atKeyword("between")) {
        this.position += 1;
        const low = this.parseAdditive();
        this.expectKeyword("and");
        const high = this.parseAdditive();
        left = { kind: "between", operand: left, low, high, negated: false };
        continue;
      }
      break;
    }

    return left;
  }

  private parseExprList(): HiveExpr[] {
    this.expectPunct("(");
    const values: HiveExpr[] = [];
    do {
      values.push(this.parseExpr());
    } while (this.atPunct(",") && (this.position += 1, true));
    this.expectPunct(")");
    return values;
  }

  private parseAdditive(): HiveExpr {
    let left = this.parseMultiplicative();
    while (this.atOperator("+", "-", "||", "&", "|", "^")) {
      const operator = this.next()!.value;
      const right = this.parseMultiplicative();
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  private parseMultiplicative(): HiveExpr {
    let left = this.parseUnary();
    while (this.atOperator("*", "/", "%") || this.atKeyword("div")) {
      const token = this.next()!;
      const operator = token.kind === "keyword" ? token.value : token.value;
      const right = this.parseUnary();
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  private parseUnary(): HiveExpr {
    if (this.atOperator("-", "+")) {
      const operator = this.next()!.value;
      return { kind: "unary", operator, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): HiveExpr {
    const token = this.peek();
    if (!token) {
      throw new HiveParseError("syntax", "Unexpected end of statement", this.tokens.length);
    }
    this.assertNotWrite(token);

    if (token.kind === "string") {
      this.position += 1;
      return { kind: "literal", literalType: "string", value: token.value };
    }
    if (token.kind === "number") {
      this.position += 1;
      return { kind: "literal", literalType: "number", value: token.text };
    }
    if (token.kind === "keyword" && (token.value === "true" || token.value === "false")) {
      this.position += 1;
      return { kind: "literal", literalType: "boolean", value: token.value };
    }
    if (token.kind === "keyword" && token.value === "null") {
      this.position += 1;
      return { kind: "literal", literalType: "null", value: "null" };
    }
    if (token.kind === "keyword" && token.value === "case") {
      return this.parseCase();
    }
    if (token.kind === "keyword" && token.value === "cast") {
      return this.parseCast();
    }
    if (token.kind === "operator" && token.value === "*") {
      this.position += 1;
      return { kind: "star" };
    }
    if (this.atPunct("(")) {
      this.position += 1;
      const inner = this.parseExpr();
      this.expectPunct(")");
      return { kind: "nested", expr: inner };
    }
    if (token.kind === "identifier" || token.kind === "quotedIdentifier") {
      this.position += 1;
      // Function call
      if (this.atPunct("(")) {
        this.position += 1;
        const distinct = this.atKeyword("distinct");
        if (distinct) this.position += 1;
        const args: HiveExpr[] = [];
        if (!this.atPunct(")")) {
          do {
            args.push(this.parseExpr());
          } while (this.atPunct(",") && (this.position += 1, true));
        }
        this.expectPunct(")");
        return { kind: "function", name: token.value, args, distinct };
      }
      // Qualified column or qualified star
      const parts = [token.value];
      while (this.atPunct(".")) {
        this.position += 1;
        if (this.atOperator("*")) {
          this.position += 1;
          return { kind: "star", qualifier: parts.join(".") };
        }
        const part = this.next();
        if (!part || (part.kind !== "identifier" && part.kind !== "quotedIdentifier")) {
          throw new HiveParseError("syntax", "Expected an identifier after '.'", part?.start ?? 0);
        }
        parts.push(part.value);
      }
      return { kind: "column", parts };
    }

    throw new HiveParseError(
      "syntax",
      `Unexpected token '${token.text}' in expression`,
      token.start
    );
  }

  private parseCase(): HiveExpr {
    this.expectKeyword("case");
    let operand: HiveExpr | undefined;
    if (!this.atKeyword("when")) {
      operand = this.parseExpr();
    }
    const whens: Array<{ when: HiveExpr; then: HiveExpr }> = [];
    while (this.atKeyword("when")) {
      this.position += 1;
      const when = this.parseExpr();
      this.expectKeyword("then");
      const then = this.parseExpr();
      whens.push({ when, then });
    }
    let elseExpr: HiveExpr | undefined;
    if (this.atKeyword("else")) {
      this.position += 1;
      elseExpr = this.parseExpr();
    }
    this.expectKeyword("end");
    return { kind: "case", operand, whens, else: elseExpr };
  }

  private parseCast(): HiveExpr {
    this.expectKeyword("cast");
    this.expectPunct("(");
    const expr = this.parseExpr();
    this.expectKeyword("as");
    const typeParts: string[] = [];
    for (;;) {
      const token = this.next();
      if (!token) {
        throw new HiveParseError("syntax", "Unexpected end of statement in CAST", this.tokens.length);
      }
      if (token.kind === "punct" && token.value === ")") break;
      if (token.kind === "punct" && token.value === "(") continue;
      if (token.kind === "punct" && token.value === ",") continue;
      typeParts.push(token.text);
    }
    return { kind: "cast", expr, targetType: typeParts.join(" ").toLowerCase() };
  }
}

export type HiveParseResult =
  | { ok: true; statement: HiveStatement }
  | { ok: false; reason: "hive_sql_parse_failed" | "hive_sql_not_readonly"; detail: string; position: number };

export type HiveExpressionParseResult =
  | { ok: true; expr: HiveExpr }
  | { ok: false; reason: "hive_sql_parse_failed" | "hive_sql_not_readonly"; detail: string; position: number };

/**
 * Parse a single Hive expression.
 *
 * The forced row-policy predicates and the asset expressions are parsed with
 * this entry point, so they are compared against the compiled SQL as real
 * syntax trees rather than as strings.
 */
export function parseHiveExpression(text: string): HiveExpressionParseResult {
  const tokenized = tokenizeHiveSql(text);
  if (!tokenized.ok) {
    return {
      ok: false,
      reason: "hive_sql_parse_failed",
      detail: `${tokenized.reason} at offset ${tokenized.position}`,
      position: tokenized.position
    };
  }
  try {
    const parser = new HiveParser(tokenized.tokens);
    const expr = parser.parseExpr();
    if (!parser.atEnd()) {
      const trailing = parser.peek();
      throw new HiveParseError(
        "syntax",
        `Unexpected trailing token '${trailing?.text ?? "<end of expression>"}'`,
        trailing?.start ?? 0
      );
    }
    return { ok: true, expr };
  } catch (error) {
    if (error instanceof HiveParseError) {
      return {
        ok: false,
        reason: error.kind === "not_readonly" ? "hive_sql_not_readonly" : "hive_sql_parse_failed",
        detail: error.message,
        position: error.position
      };
    }
    return {
      ok: false,
      reason: "hive_sql_parse_failed",
      detail: error instanceof Error ? error.message : String(error),
      position: 0
    };
  }
}

/** Parse a Hive statement. Never rewrites the input. */
export function parseHiveSql(sql: string): HiveParseResult {
  const tokenized = tokenizeHiveSql(sql);
  if (!tokenized.ok) {
    return {
      ok: false,
      reason: "hive_sql_parse_failed",
      detail: `${tokenized.reason} at offset ${tokenized.position}`,
      position: tokenized.position
    };
  }
  try {
    const parser = new HiveParser(tokenized.tokens);
    return { ok: true, statement: parser.parseStatement() };
  } catch (error) {
    if (error instanceof HiveParseError) {
      return {
        ok: false,
        reason: error.kind === "not_readonly" ? "hive_sql_not_readonly" : "hive_sql_parse_failed",
        detail: error.message,
        position: error.position
      };
    }
    return {
      ok: false,
      reason: "hive_sql_parse_failed",
      detail: error instanceof Error ? error.message : String(error),
      position: 0
    };
  }
}

// ── AST helpers ─────────────────────────────────────────────────────────────

/** Unwrap redundant parentheses so `(a = b)` equals `a = b`. */
export function unwrapHiveExpr(expr: HiveExpr): HiveExpr {
  let current = expr;
  while (current.kind === "nested") current = current.expr;
  return current;
}

const COMMUTATIVE_OPERATORS = new Set(["=", "!=", "<>", "and", "or", "+", "*"]);

/** Structural equality of two Hive expressions. */
export function hiveExprEqual(a: HiveExpr, b: HiveExpr): boolean {
  const left = unwrapHiveExpr(a);
  const right = unwrapHiveExpr(b);
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "literal":
      return (
        right.kind === "literal" &&
        left.literalType === right.literalType &&
        left.value === right.value
      );
    case "column":
      return (
        right.kind === "column" &&
        left.parts.length === right.parts.length &&
        left.parts.every((part, index) => part === right.parts[index])
      );
    case "star":
      return right.kind === "star" && left.qualifier === right.qualifier;
    case "function":
      return (
        right.kind === "function" &&
        left.name === right.name &&
        left.distinct === right.distinct &&
        left.args.length === right.args.length &&
        left.args.every((arg, index) => hiveExprEqual(arg, right.args[index]!))
      );
    case "binary": {
      if (right.kind !== "binary" || left.operator !== right.operator) return false;
      if (hiveExprEqual(left.left, right.left) && hiveExprEqual(left.right, right.right)) return true;
      if (COMMUTATIVE_OPERATORS.has(left.operator)) {
        return hiveExprEqual(left.left, right.right) && hiveExprEqual(left.right, right.left);
      }
      return false;
    }
    case "unary":
      return (
        right.kind === "unary" &&
        left.operator === right.operator &&
        hiveExprEqual(left.operand, right.operand)
      );
    case "isNull":
      return (
        right.kind === "isNull" &&
        left.negated === right.negated &&
        hiveExprEqual(left.operand, right.operand)
      );
    case "in":
      return (
        right.kind === "in" &&
        left.negated === right.negated &&
        hiveExprEqual(left.operand, right.operand) &&
        left.values.length === right.values.length &&
        left.values.every((value, index) => hiveExprEqual(value, right.values[index]!))
      );
    case "between":
      return (
        right.kind === "between" &&
        left.negated === right.negated &&
        hiveExprEqual(left.operand, right.operand) &&
        hiveExprEqual(left.low, right.low) &&
        hiveExprEqual(left.high, right.high)
      );
    case "case": {
      if (right.kind !== "case") return false;
      if (left.whens.length !== right.whens.length) return false;
      if (!left.whens.every((branch, index) => {
        const other = right.whens[index]!;
        return hiveExprEqual(branch.when, other.when) && hiveExprEqual(branch.then, other.then);
      })) {
        return false;
      }
      if (left.operand && right.operand && !hiveExprEqual(left.operand, right.operand)) return false;
      if (Boolean(left.operand) !== Boolean(right.operand)) return false;
      if (left.else && right.else && !hiveExprEqual(left.else, right.else)) return false;
      return Boolean(left.else) === Boolean(right.else);
    }
    case "cast":
      return (
        right.kind === "cast" &&
        left.targetType === right.targetType &&
        hiveExprEqual(left.expr, right.expr)
      );
    default:
      return false;
  }
}

/** Split a boolean expression into its top-level AND conjuncts. */
export function splitHiveConjuncts(expr: HiveExpr | undefined): HiveExpr[] {
  if (!expr) return [];
  const unwrapped = unwrapHiveExpr(expr);
  if (unwrapped.kind === "binary" && unwrapped.operator === "and") {
    return [...splitHiveConjuncts(unwrapped.left), ...splitHiveConjuncts(unwrapped.right)];
  }
  return [unwrapped];
}

/** Collect every column reference used by an expression. */
export function collectHiveColumnRefs(expr: HiveExpr): string[][] {
  const refs: string[][] = [];
  const walk = (node: HiveExpr): void => {
    const current = unwrapHiveExpr(node);
    switch (current.kind) {
      case "column":
        refs.push(current.parts);
        return;
      case "function":
        current.args.forEach(walk);
        return;
      case "binary":
        walk(current.left);
        walk(current.right);
        return;
      case "unary":
        walk(current.operand);
        return;
      case "isNull":
        walk(current.operand);
        return;
      case "in":
        walk(current.operand);
        current.values.forEach(walk);
        return;
      case "between":
        walk(current.operand);
        walk(current.low);
        walk(current.high);
        return;
      case "case":
        if (current.operand) walk(current.operand);
        current.whens.forEach((branch) => {
          walk(branch.when);
          walk(branch.then);
        });
        if (current.else) walk(current.else);
        return;
      case "cast":
        walk(current.expr);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return refs;
}

/**
 * Constructs that are known to COMPILE but whose executability on a real
 * HiveServer2 is NOT proven.
 *
 * The probe showed that the KTX generator emits `DATE_TRUNC('MONTH', ts)`
 * for a monthly time grouping. Hive versions differ in whether they accept
 * `date_trunc` at all and whether the unit is case sensitive. A clean parse
 * therefore proves the SHAPE of the statement, never its executability.
 *
 * These are reported as pending verification, never as "supported": the real
 * proof is an HS2 EXPLAIN plus a real result (Spec V04, `blocked_environment`
 * until the customer environment exists).
 */
export const HIVE_UNVERIFIED_CONSTRUCTS: ReadonlyArray<{
  name: string;
  note: string;
}> = [
  {
    name: "date_trunc",
    note:
      "Time grouping compiles to DATE_TRUNC('MONTH', ts); Hive version support and unit case sensitivity are unverified until a real HS2 EXPLAIN runs (Spec V04)."
  }
];

/** Collect every function name used in an expression. */
export function collectHiveFunctionNames(expr: HiveExpr): string[] {
  const names: string[] = [];
  const walk = (node: HiveExpr): void => {
    const current = unwrapHiveExpr(node);
    switch (current.kind) {
      case "function":
        names.push(current.name.toLowerCase());
        current.args.forEach(walk);
        return;
      case "binary":
        walk(current.left);
        walk(current.right);
        return;
      case "unary":
        walk(current.operand);
        return;
      case "isNull":
        walk(current.operand);
        return;
      case "in":
        walk(current.operand);
        current.values.forEach(walk);
        return;
      case "between":
        walk(current.operand);
        walk(current.low);
        walk(current.high);
        return;
      case "case":
        if (current.operand) walk(current.operand);
        current.whens.forEach((branch) => {
          walk(branch.when);
          walk(branch.then);
        });
        if (current.else) walk(current.else);
        return;
      case "cast":
        walk(current.expr);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return names;
}

/**
 * The constructs in a statement whose HS2 executability is still unproven.
 *
 * The caller is expected to carry this into the response as "pending
 * verification", so nobody reads a clean compile as a proven executable
 * statement.
 */
export function findUnverifiedHiveConstructs(statement: HiveStatement): string[] {
  const found = new Set<string>();
  const walkQuery = (query: HiveQuery): void => {
    for (const item of query.select) {
      for (const name of collectHiveFunctionNames(item.expr)) {
        for (const candidate of HIVE_UNVERIFIED_CONSTRUCTS) {
          if (name === candidate.name) found.add(candidate.name);
        }
      }
    }
    for (const cte of query.ctes) walkQuery(cte.query);
    if (query.from.kind === "subquery") walkQuery(query.from.query);
    for (const join of query.joins) {
      if (join.ref.kind === "subquery") walkQuery(join.ref.query);
    }
  };
  walkQuery(statement.query);
  return [...found].sort();
}

// ── post-parse checks ────────────────────────────────────────────────────────

export type HiveAstCheckReason =
  | "hive_sql_parse_failed"
  | "hive_sql_not_readonly"
  | "hive_sql_too_large"
  | "hive_sql_limit_missing"
  | "hive_sql_limit_exceeded"
  | "hive_sql_dependency_not_allowed"
  | "hive_sql_hidden_column_exposed"
  | "hive_sql_forced_predicate_missing";

export type HiveRequiredPredicate = {
  /** Server-generated predicate text, parsed and compared structurally. */
  expression: string;
  /** The source alias the predicate must constrain. */
  sourceAlias: string;
};

export type HiveAstCheckInput = {
  sql: string;
  /** Physical `database.table` objects that this request may touch. */
  allowedPhysicalTables: readonly string[];
  /** Source alias (KTX source name) → physical table. */
  sourceAliasToPhysical: ReadonlyMap<string, string>;
  /** Columns that must never appear in the output projection. */
  hiddenColumns?: ReadonlySet<string>;
  /** Maximum accepted LIMIT value. */
  maxLimit: number;
  /** Maximum accepted SQL size in bytes. */
  maxSqlBytes?: number;
  /** Forced predicates that must be provably applied before aggregation. */
  requiredPredicates?: readonly HiveRequiredPredicate[];
};

export type HiveAstCheckResult =
  | {
      ok: true;
      statement: HiveStatement;
      physicalTables: string[];
      outputColumns: string[];
      limit: number;
      /**
       * Constructs whose HS2 executability is still unproven. A clean check
       * does NOT mean the statement can run on the customer's HiveServer2.
       */
      unverifiedConstructs: string[];
    }
  | { ok: false; reason: HiveAstCheckReason; detail: string };

/** Aliases referenced by a query scope (FROM + JOINs). */
function scopeAliases(query: HiveQuery): Set<string> {
  const aliases = new Set<string>();
  const collectRef = (ref: HiveTableRef): void => {
    if (ref.kind === "table") {
      if (ref.alias) aliases.add(ref.alias);
      else aliases.add(ref.table);
      return;
    }
    if (ref.alias) aliases.add(ref.alias);
  };
  collectRef(query.from);
  query.joins.forEach((join) => collectRef(join.ref));
  return aliases;
}

/**
 * Every query scope in the statement, CTE scopes included.
 */
function collectScopes(query: HiveQuery, out: HiveQuery[] = []): HiveQuery[] {
  out.push(query);
  for (const cte of query.ctes) collectScopes(cte.query, out);
  if (query.from.kind === "subquery") collectScopes(query.from.query, out);
  for (const join of query.joins) {
    if (join.ref.kind === "subquery") collectScopes(join.ref.query, out);
  }
  return out;
}

/** Map every CTE name in the statement to the query it stands for. */
function collectCteMap(query: HiveQuery, map: Map<string, HiveQuery> = new Map()): Map<string, HiveQuery> {
  for (const cte of query.ctes) {
    if (!map.has(cte.name)) map.set(cte.name, cte.query);
    collectCteMap(cte.query, map);
  }
  if (query.from.kind === "subquery") collectCteMap(query.from.query, map);
  for (const join of query.joins) {
    if (join.ref.kind === "subquery") collectCteMap(join.ref.query, map);
  }
  return map;
}

/**
 * Resolve the physical tables a statement depends on.
 *
 * A CTE name is never reported as a physical table — that is exactly the
 * "CTE name mistaken for a physical table" trap. A CTE reference is expanded
 * into the physical tables the CTE itself reads, so the dependency closure
 * still covers the real objects.
 */
export function expandPhysicalTables(query: HiveQuery, cteMap?: Map<string, HiveQuery>): string[] {
  const ctes = cteMap ?? collectCteMap(query);
  const tables: string[] = [];
  const visited = new Set<string>();

  const collectScope = (scope: HiveQuery): void => {
    const collectRef = (ref: HiveTableRef): void => {
      if (ref.kind === "table") {
        if (!ref.database) {
          const cte = ctes.get(ref.table);
          if (cte) {
            if (!visited.has(ref.table)) {
              visited.add(ref.table);
              collectScope(cte);
            }
            return;
          }
        }
        tables.push(ref.database ? `${ref.database}.${ref.table}` : ref.table);
        return;
      }
      collectScope(ref.query);
    };
    collectRef(scope.from);
    scope.joins.forEach((join) => collectRef(join.ref));
  };

  collectScope(query);
  return tables;
}

/**
 * Scopes that can see a given source alias.
 *
 * A scope sees an alias when it references the alias directly, or references a
 * CTE that (transitively) depends on it. This is what makes "the forced
 * predicate is applied before the protected rows are aggregated" provable
 * rather than assumed.
 */
function scopesSeeingAlias(query: HiveQuery, alias: string): Set<number> {
  const scopes = collectScopes(query);
  const result = new Set<number>();

  // Which aliases does a CTE transitively depend on? The dependency is
  // computed recursively so that a CTE reading another CTE that reads the
  // protected source still counts as "seeing" it.
  const dependencyCache = new Map<string, Set<string>>();
  const dependencyOf = (cteName: string, seen: Set<string>): Set<string> => {
    const cached = dependencyCache.get(cteName);
    if (cached) return cached;
    if (seen.has(cteName)) return new Set<string>();
    seen.add(cteName);
    const cte = query.ctes.find((candidate) => candidate.name === cteName);
    const direct = new Set<string>();
    if (!cte) {
      dependencyCache.set(cteName, direct);
      return direct;
    }
    for (const aliasName of scopeAliases(cte.query)) direct.add(aliasName);
    for (const nested of cte.query.ctes) {
      for (const value of dependencyOf(nested.name, seen)) direct.add(value);
    }
    dependencyCache.set(cteName, direct);
    return direct;
  };

  scopes.forEach((scope, index) => {
    const aliases = scopeAliases(scope);
    if (aliases.has(alias)) {
      result.add(index);
      return;
    }
    // The scope may reference a CTE that (transitively) depends on the alias.
    for (const cteName of aliases) {
      if (dependencyOf(cteName, new Set()).has(alias)) {
        result.add(index);
        return;
      }
    }
  });

  return result;
}

function outputColumnNames(query: HiveQuery): string[] {
  const names: string[] = [];
  for (const item of query.select) {
    if (item.alias) {
      names.push(item.alias);
      continue;
    }
    const expr = unwrapHiveExpr(item.expr);
    if (expr.kind === "column") {
      names.push(expr.parts[expr.parts.length - 1]!);
      continue;
    }
    if (expr.kind === "star") {
      names.push("*");
      continue;
    }
    names.push("");
  }
  return names;
}

/**
 * Check the compiled statement against the authorization closure and the
 * output contract.
 *
 * The check is read-only: it never rewrites, patches or re-translates the
 * SQL. Any unknown or non-conforming item rejects the statement so that it is
 * never dispatched to a JDBC worker.
 */
export function checkHiveSql(input: HiveAstCheckInput): HiveAstCheckResult {
  const sql = input.sql;
  const maxBytes = input.maxSqlBytes ?? HIVE_MAX_SQL_BYTES;
  const byteLength = Buffer.byteLength(sql, "utf8");
  if (byteLength > maxBytes) {
    return {
      ok: false,
      reason: "hive_sql_too_large",
      detail: `Compiled SQL is ${byteLength} bytes, above the ${maxBytes} byte contract`
    };
  }

  const parsed = parseHiveSql(sql);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, detail: parsed.detail };
  }

  const query = parsed.statement.query;

  // LIMIT contract
  if (query.limit === undefined) {
    return {
      ok: false,
      reason: "hive_sql_limit_missing",
      detail: "Compiled SQL has no LIMIT; a bounded result is required on the Hive path"
    };
  }
  if (query.limit > input.maxLimit) {
    return {
      ok: false,
      reason: "hive_sql_limit_exceeded",
      detail: `Compiled SQL LIMIT ${query.limit} exceeds the allowed maximum ${input.maxLimit}`
    };
  }

  // Physical dependency closure
  const scopes = collectScopes(query);
  const physicalTables = [...new Set(expandPhysicalTables(query))].sort();
  const allowed = new Set(input.allowedPhysicalTables);
  for (const table of physicalTables) {
    if (!allowed.has(table)) {
      return {
        ok: false,
        reason: "hive_sql_dependency_not_allowed",
        detail: `Compiled SQL depends on '${table}', which is outside the authorized source closure`
      };
    }
  }

  // Output columns / hidden columns
  const hidden = input.hiddenColumns ?? new Set<string>();
  const outputColumns = outputColumnNames(query);
  for (const column of outputColumns) {
    if (column && hidden.has(column)) {
      return {
        ok: false,
        reason: "hive_sql_hidden_column_exposed",
        detail: `Compiled SQL exposes hidden column '${column}'`
      };
    }
  }
  if (outputColumns.includes("*")) {
    // A star projection cannot be proven free of hidden columns.
    return {
      ok: false,
      reason: "hive_sql_hidden_column_exposed",
      detail: "Compiled SQL uses a star projection; hidden columns cannot be excluded"
    };
  }

  // Forced predicates must be provably applied before aggregation.
  for (const required of input.requiredPredicates ?? []) {
    const expected = parseHiveExpression(required.expression);
    if (!expected.ok) {
      return {
        ok: false,
        reason: "hive_sql_forced_predicate_missing",
        detail: `The server-side forced predicate could not be parsed: ${expected.detail}`
      };
    }
    const expectedExpr = expected.expr;
    const seenScopes = scopesSeeingAlias(query, required.sourceAlias);
    // A forced scope that is an AND group is applied iff every one of its
    // predicates is applied. An OR group (two Roles) stays one conjunct.
    const expectedConjuncts = splitHiveConjuncts(expectedExpr);
    if (expectedConjuncts.length === 0) {
      return {
        ok: false,
        reason: "hive_sql_forced_predicate_missing",
        detail: "The server-side forced predicate is empty"
      };
    }
    let matched = false;
    for (let index = 0; index < scopes.length; index += 1) {
      const scope = scopes[index]!;
      if (!seenScopes.has(index)) continue;
      const conjuncts = splitHiveConjuncts(scope.where);
      const applied = expectedConjuncts.every((expectedConjunct) =>
        conjuncts.some((conjunct) => hiveExprEqual(conjunct, expectedConjunct))
      );
      if (applied) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return {
        ok: false,
        reason: "hive_sql_forced_predicate_missing",
        detail: `The forced row policy for source '${required.sourceAlias}' is not provably applied in a WHERE clause before aggregation`
      };
    }
  }

  return {
    ok: true,
    statement: parsed.statement,
    physicalTables,
    outputColumns,
    limit: query.limit,
    unverifiedConstructs: findUnverifiedHiveConstructs(parsed.statement)
  };
}
