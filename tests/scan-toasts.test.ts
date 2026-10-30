import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
  downloadVCard: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
    dismiss: mocks.dismiss,
  },
}));
vi.mock("@/lib/contact", () => ({ downloadVCard: mocks.downloadVCard }));

import {
  SCAN_TOAST_ID,
  dismissScanToast,
  showScanDuplicate,
  showScanError,
  showScanNotice,
  showScanSuccess,
} from "@/lib/scanToasts";
import type { CardData } from "@/types/card";

const contact = {
  fullName: "Asha Rao",
  company: "Acme",
  emails: ["asha@acme.test"],
} as unknown as CardData;

type Action = { label: string; onClick: () => void };
const actionOf = (fn: typeof mocks.success) => (fn.mock.calls[0][1].action as Action);

describe("scanToasts", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
  });

  it("shows a success toast with a vcf action for the persisted contact", () => {
    showScanSuccess(contact);

    const [title, options] = mocks.success.mock.calls[0];
    expect(title).toBe("Asha Rao");
    expect(options.id).toBe(SCAN_TOAST_ID);
    expect(options.description).toBe("Added to your directory.");

    const action = actionOf(mocks.success);
    expect(action.label).toBe("Save .vcf");
    action.onClick();
    expect(mocks.downloadVCard).toHaveBeenCalledWith(contact);
  });

  it("falls back to the company, then a placeholder, when the name is missing", () => {
    showScanSuccess({ ...contact, fullName: null } as CardData);
    showScanSuccess({ ...contact, fullName: null, company: null } as CardData);

    expect(mocks.success.mock.calls[0][0]).toBe("Acme");
    expect(mocks.success.mock.calls[1][0]).toBe("Unnamed contact");
  });

  it("renders a notice at the tone it was given", () => {
    showScanNotice({ tone: "success", message: "3 contacts imported." });
    showScanNotice({ tone: "warning", message: "1 duplicate skipped." });

    expect(mocks.success).toHaveBeenCalledWith("3 contacts imported.", {
      id: SCAN_TOAST_ID,
      duration: 10000,
    });
    expect(mocks.warning).toHaveBeenCalledWith("1 duplicate skipped.", {
      id: SCAN_TOAST_ID,
      duration: 10000,
    });
  });

  it("lists at most three duplicate names and counts the rest", () => {
    showScanDuplicate({
      message: "4 duplicates skipped.",
      details: ["A", "B", "C", "D", "E"].map((fullName) => ({ fullName })),
    });

    const [title, options] = mocks.warning.mock.calls[0];
    expect(title).toBe("4 duplicates skipped.");
    expect(options.description).toBe("A, B, C +2 more");
  });

  it("omits the description when the duplicate has no named details", () => {
    showScanDuplicate({ message: "Already exists.", details: [] });
    expect(mocks.warning.mock.calls[0][1].description).toBeUndefined();
  });

  it("keeps a scan failure on screen until dismissed and offers retry", () => {
    const retry = vi.fn();
    showScanError("No card detected.", retry);

    const [title, options] = mocks.error.mock.calls[0];
    expect(title).toBe("Scan failed");
    expect(options.duration).toBe(Infinity);
    expect(options.description).toBe("No card detected.");

    actionOf(mocks.error).onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("dismisses by the shared scan id", () => {
    dismissScanToast();
    expect(mocks.dismiss).toHaveBeenCalledWith(SCAN_TOAST_ID);
  });
});
