export function hasShareText(value: unknown): boolean;
export function intentX(text: unknown): string;
export function intentLinkedIn(text: unknown): string;
export function shareModel(social: unknown): {
  x: { text: string; href: string } | null;
  linkedin: { text: string; href: string } | null;
};
