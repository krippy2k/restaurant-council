import { ApiError } from "./api";

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : "Something went wrong";
  return <div className="error">{message}</div>;
}
