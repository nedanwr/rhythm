import { useEffect, useState } from "react";

import { artUrl, type ArtSize } from "~/api/client";
import { cn } from "~/lib/utils";

/**
 * Cover art, falling back to Rhythm's mark. A 404 is normal — plenty of
 * tracks have no artwork — so it stays quiet.
 */
export function CoverArt({
  trackId,
  size,
  className,
  markClassName
}: {
  /** Null draws the placeholder alone. */
  trackId: string | null;
  size: ArtSize;
  className?: string;
  markClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset per track, or one artless track pins the placeholder for good.
  useEffect(() => setFailed(false), [trackId]);

  return (
    <div
      className={cn(
        "bg-raised relative grid shrink-0 place-items-center overflow-hidden rounded",
        className
      )}
    >
      <span
        className={cn("flex items-end gap-0.5", markClassName)}
        aria-hidden="true"
      >
        <i className="bg-primary h-2 w-1" />
        <i className="bg-primary h-5 w-1" />
        <i className="bg-primary h-3 w-1" />
      </span>
      {trackId && !failed && (
        <img
          key={trackId}
          src={artUrl(trackId, size)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
