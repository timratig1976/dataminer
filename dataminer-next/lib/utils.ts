export function randomUUID(): string {
  return crypto.randomUUID();
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
