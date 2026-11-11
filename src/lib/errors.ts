export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string, code = "validation_error") {
  return new ApiError(400, code, message);
}

export function unauthorized(message = "Sign in to continue.") {
  return new ApiError(401, "unauthorized", message);
}

export function forbidden(message = "You cannot perform this action.") {
  return new ApiError(403, "forbidden", message);
}

export function notFound(message = "That record was not found.") {
  return new ApiError(404, "not_found", message);
}

export function conflict(message: string) {
  return new ApiError(409, "conflict", message);
}
