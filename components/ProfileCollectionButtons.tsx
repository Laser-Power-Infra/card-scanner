"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { CardData } from "@/types/card";
import { publishProfileCollection } from "@/app/actions/profile-collection";
import { PROFILE_TAGS, type ProfileTag } from "@/lib/queue/config";

const TAG_LABELS: Record<ProfileTag, string> = {
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "Twitter",
  research: "Research",
};

interface ProfileCollectionButtonsProps {
  contact: CardData;
  compact?: boolean;
}

export default function ProfileCollectionButtons({
  contact,
  compact = false,
}: ProfileCollectionButtonsProps) {
  const { data: session } = useSession();
  const [queuedTag, setQueuedTag] = useState<ProfileTag | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  if (!session?.user || session?.user?.role !== "DEVELOPER") {
    return null;
  }

  const handleCollect = async (tag: ProfileTag) => {
    setQueuedTag(tag);
    setQueueError(null);

    try {
      const result = await publishProfileCollection({
        tag,
        contact,
        contactId: contact.id,
      });
      if (!result.success || !result.queued) {
        setQueueError(result.error || "Failed to queue task.");
      }
    } catch (err) {
      setQueueError(
        err instanceof Error ? err.message : "Failed to queue task."
      );
    } finally {
      setQueuedTag(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {PROFILE_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => handleCollect(tag)}
            disabled={queuedTag !== null}
            className={
              compact
                ? "rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-300 disabled:opacity-50"
                : "rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-300 disabled:opacity-50"
            }
          >
            {queuedTag === tag ? "Queuing…" : TAG_LABELS[tag]}
          </button>
        ))}
      </div>
      {queueError && (
        <p className="mt-2 text-sm text-red-700">{queueError}</p>
      )}
    </div>
  );
}
