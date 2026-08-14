"use server";

import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishProfileCollectionTask } from "@/lib/queue/profileCollection";
import { PROFILE_TAGS, type ProfileTag } from "@/lib/queue/config";
import type { CardData } from "@/types/card";

export type PublishProfileCollectionInput = {
  tag: ProfileTag;
  contact: CardData;
  contactId?: string;
};

export type PublishProfileCollectionResult = {
  success: boolean;
  queued: boolean;
  error?: string;
};

export async function publishProfileCollection(
  input: PublishProfileCollectionInput,
): Promise<PublishProfileCollectionResult> {
  try {
    const session = await getServerSession(authOptions);

    if (session?.user?.role !== "DEVELOPER") {
      console.warn(
        "[ProfileCollection] Rejected non-developer publish:",
        session?.user?.email ?? "(no session)"
      );
      return {
        success: false,
        queued: false,
        error: "Forbidden",
      };
    }

    if (!PROFILE_TAGS.includes(input.tag)) {
      return {
        success: false,
        queued: false,
        error: `Unknown tag: ${input.tag}`,
      };
    }

    const taskId = randomUUID();
    const payload = {
      tag: input.tag,
      taskId,
      contactId: input.contactId,
      contact: input.contact,
      timestamp: Date.now(),
    };

    if (!input.contactId) {
      console.warn(
        "[ProfileCollection] Task has no contactId — worker will drop it.",
        JSON.stringify(payload)
      );
    }

    console.log(
      "[ProfileCollection] Publishing task:",
      JSON.stringify(payload)
    );

    const queued = await publishProfileCollectionTask(payload);

    console.log(
      `[ProfileCollection] Publish result for taskId=${taskId} tag=${input.tag}: queued=${queued}`
    );

    return {
      success: queued,
      queued,
      error: queued
        ? undefined
        : "Task could not be queued. RabbitMQ may be unavailable.",
    };
  } catch (err) {
    console.error("[ProfileCollection] Failed to publish:", err);
    return {
      success: false,
      queued: false,
      error:
        err instanceof Error ? err.message : "Failed to queue profile task.",
    };
  }
}

export type ResearchAllResult = {
  success: boolean;
  total: number;
  queued: number;
  failed: number;
  error?: string;
};

export type ResearchAllMode = "all" | "not_done";

export async function researchAllContacts(
  mode: ResearchAllMode = "all",
): Promise<ResearchAllResult> {
  try {
    const session = await getServerSession(authOptions);

    if (session?.user?.role !== "DEVELOPER") {
      console.warn(
        "[ProfileCollection] Rejected non-developer research-all:",
        session?.user?.email ?? "(no session)"
      );
      return {
        success: false,
        total: 0,
        queued: 0,
        failed: 0,
        error: "Forbidden",
      };
    }

    const contacts =
      mode === "not_done"
        ? await prisma.contact.findMany({
            where: {
              OR: [
                { enrichment: null },
                { enrichment: { status: { not: "DONE" } } },
              ],
            },
            orderBy: { createdAt: "desc" },
          })
        : await prisma.contact.findMany({
            orderBy: { createdAt: "desc" },
          });

    let queued = 0;
    let failed = 0;

    for (const contact of contacts) {
      const payload: CardData = {
        id: contact.id,
        fullName: contact.fullName,
        jobTitle: contact.jobTitle,
        company: contact.company,
        mobileNumbers: contact.mobileNumbers ?? [],
        telephoneNumbers: contact.telephoneNumbers ?? [],
        emails: contact.emails ?? [],
        website: contact.website,
        address: contact.address,
        companyLocation: contact.companyLocation,
        linkedin: contact.linkedin,
        otherSocials: [],
        rawNotes: contact.rawNotes,
      };

      try {
        const ok = await publishProfileCollectionTask({
          tag: "research",
          taskId: randomUUID(),
          contactId: contact.id,
          contact: payload,
          timestamp: Date.now(),
        });
        if (ok) queued += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[ProfileCollection] research-all failed for ${contact.id}:`,
          err
        );
      }
    }

    console.log(
      `[ProfileCollection] research-all complete: total=${contacts.length} queued=${queued} failed=${failed}`
    );

    return {
      success: true,
      total: contacts.length,
      queued,
      failed,
    };
  } catch (err) {
    console.error("[ProfileCollection] research-all failed:", err);
    return {
      success: false,
      total: 0,
      queued: 0,
      failed: 0,
      error:
        err instanceof Error ? err.message : "Failed to queue research tasks.",
    };
  }
}
