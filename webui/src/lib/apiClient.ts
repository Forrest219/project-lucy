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
};

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  code: string;
  detail?: unknown;

  constructor(error: ApiFailure["error"]) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.detail = error.detail;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error);
  }

  return envelope.data;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error);
  }

  return envelope.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error);
  }

  return envelope.data;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error);
  }

  return envelope.data;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
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
    throw new ApiError(envelope.error);
  }

  return envelope.data;
}
