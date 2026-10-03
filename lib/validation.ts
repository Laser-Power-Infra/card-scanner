import type { CardData } from "@/types/card";

export function validateContact(changes: Partial<CardData>): string | null {
  if (changes.fullName !== undefined && !changes.fullName.trim()) {
    return "Name is required";
  }
  if (changes.company !== undefined && !changes.company.trim()) {
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
      if (num && !/^\d+$/.test(num)) {
        return `Mobile number must be digits only: ${num}`;
      }
    }
  }
  return null;
}
