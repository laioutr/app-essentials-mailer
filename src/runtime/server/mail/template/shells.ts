import { formEmailShell } from '../../../emails/compiled/form-email';

/** Key → compiled Handlebars shell. v1 has one; the map is the seam future apps' templates extend. */
const SHELLS = { 'form-email': formEmailShell } as const;

export type ShellKey = keyof typeof SHELLS;

export function getShell(key: ShellKey): string {
  return SHELLS[key];
}
