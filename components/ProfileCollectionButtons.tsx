"use client";

import { useSession } from "next-auth/react";
import type { CardData } from "@/types/card";
import { useAppDispatch, useAppSelector } from "@/lib/store";
import { queueProfileCollection } from "@/lib/store/contactsSlice";
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
  const dispatch = useAppDispatch();
  const queuedTag = useAppSelector((s) => (contact.id ? s.contacts.queueing[contact.id] : undefined)) ?? null;
  const queueError = useAppSelector((s) => (contact.id ? s.contacts.queueErrors[contact.id] : undefined));

  if (!session?.user || session?.user?.role !== "DEVELOPER") {
    return null;
  }

  const handleCollect = (tag: ProfileTag) => {
    dispatch(queueProfileCollection({ tag, contact }));
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
                ? "rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition duration-200 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800 active:scale-[.98] disabled:opacity-50"
                : "rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition duration-200 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800 active:scale-[.98] disabled:opacity-50"
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
