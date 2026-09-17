export function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("renacer_csrf="));
  return match?.split("=")[1] ?? "";
}
