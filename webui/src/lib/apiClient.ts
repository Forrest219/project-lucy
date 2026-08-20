type ApiSuccess<T> = {
  ok: true;
  data: T;
};

type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
  data?: unknown;
};

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  code: string;
  detail?: unknown;
  data?: unknown;

  constructor(error: ApiFailure["error"], data?: unknown) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.detail = error.detail;
    this.data = data;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        })
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}
