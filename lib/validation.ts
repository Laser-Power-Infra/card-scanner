import type { CardData } from "@/types/card";

// `!= null` rather than `!== undefined`: CardData types its scalars as
// `string | null`, so a partial patch can legitimately carry an explicit null
// and it must not be dereferenced.
export function validateContact(changes: Partial<CardData>): string | null {
  if (changes.fullName != null && !changes.fullName.trim()) {
    return "Name is required";
  }
  if (changes.company != null && !changes.company.trim()) {
    return "Company is required";
  }
  if (changes.emails !== undefined) {
    for (const email of changes.emails) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return `Invalid email: ${email}`;
      }
    }
  }
  if (changes.mobileNumbers !== undefined) {
    for (const num of changes.mobileNumbers) {
      if (num && !/^\+?\d+$/.test(num)) {
        return `Mobile number must be digits, optionally prefixed with +: ${num}`;
      }
    }
  }
  return null;
}
