/**
 * P1-89 D2/D8 — 语义层写/删接口公共请求体键白名单校验（供 P1-90／P1-91 复用）。
 *
 * 请求体含合同外顶层字段时必须显式 400，不得静默忽略；
 * 错误消息给出正确字段指引，机器可读下一步统一经响应顶层 `data.nextSteps` 透出。
 */

export type RequestBodyErrorData = {
  unknownKeys: string[];
  allowedKeys: string[];
  nextSteps: string[];
};

export class InvalidRequestBodyError extends Error {
  code: string;
  statusCode = 400;
  /** 由全局错误处理器原样透传为错误响应顶层 `data`（含 nextSteps）。 */
  data: RequestBodyErrorData;

  constructor(code: string, message: string, data: RequestBodyErrorData) {
    super(message);
    this.name = "InvalidRequestBodyError";
    this.code = code;
    this.data = data;
  }
}

export function assertAllowedKeys(
  body: unknown,
  allowedKeys: readonly string[],
  errorCode: string,
  hint: string,
  nextSteps: readonly string[]
): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    // 非对象请求体交由各端点既有的解析逻辑处理。
    return;
  }
  const known = new Set(allowedKeys);
  const unknownKeys = Object.keys(body).filter((key) => !known.has(key));
  if (unknownKeys.length === 0) {
    return;
  }
  throw new InvalidRequestBodyError(
    errorCode,
    `无法识别的字段 ${unknownKeys.join("、")}；${hint}`,
    { unknownKeys, allowedKeys: [...allowedKeys], nextSteps: [...nextSteps] }
  );
}
