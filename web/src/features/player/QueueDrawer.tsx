import { useState, type DragEvent, type RefObject } from "react";
import { GripVertical, X } from "lucide-react";

import { Count } from "~/lib/format";
import { cn } from "~/lib/utils";
import { usePlayerActions, useQueue } from "./context";
import { selectIndex, selectItems } from "~/stores/queueStore";
import { CoverArt } from "~/components/CoverArt";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from "~/components/ui/drawer";

export function QueueDrawer({
  open,
  onClose,
  container
}: {
  open: boolean;
  onClose: () => void;
  /** Limits the drawer to a pane instead of the viewport. */
  container?: RefObject<HTMLElement | null>;
}) {
  const queue = useQueue(selectItems);
  const index = useQueue(selectIndex);
  const { playAt, removeAt, reorder, clearQueue } = usePlayerActions();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const startDrag = (event: DragEvent, position: number) => {
    setDraggedIndex(position);
    setDropIndex(position);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(position));
  };

  const finishDrag = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  const drop = (event: DragEvent, position: number) => {
    event.preventDefault();
    const from =
      draggedIndex ?? Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(from)) reorder(from, position);
    finishDrag();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // Keep browsing and playback controls interactive while open.
      modal={false}
      swipeDirection="right"
    >
      <DrawerContent
        // Keep the drawer above the player instead of covering it.
        container={container}
        // This persistent side panel is a landmark, not a dialog.
        render={<aside aria-label="Queue" />}
        role="complementary"
        className="w-97.5 max-w-full"
      >
        <DrawerHeader className="flex-row items-center justify-between">
          <div>
            <DrawerTitle>Queue</DrawerTitle>
            <DrawerDescription className="mt-0.5">
              <Count count={queue.length} singular="track" />
            </DrawerDescription>
          </div>
          <div className="flex items-center gap-1">
            {queue.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px]"
                onClick={clearQueue}
              >
                Clear
              </Button>
            )}
            <DrawerClose
              render={
                <Button variant="ghost" size="icon" aria-label="Close queue" />
              }
            >
              <X className="size-4" />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-[.14em] uppercase">
            {queue.length === 0 ? "Queue is empty" : "Now playing & up next"}
          </p>
          <ul>
            {queue.map((track, position) => (
              <li
                key={`${track.id}-${position}`}
                draggable
                onDragStart={(event) => startDrag(event, position)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropIndex(position);
                }}
                onDrop={(event) => drop(event, position)}
                onDragEnd={finishDrag}
                className={cn(
                  "group border-border/60 flex h-14 items-center gap-2 border-b px-1 transition-[opacity,transform,box-shadow]",
                  position === index && "bg-accent rounded-md border-0",
                  draggedIndex === position && "opacity-40",
                  dropIndex === position &&
                    draggedIndex !== position &&
                    "-translate-y-0.5 shadow-[0_-2px_0_var(--primary)]"
                )}
              >
                <GripVertical
                  aria-hidden="true"
                  className="text-faint size-4 shrink-0 cursor-grab active:cursor-grabbing"
                />
                <span className="text-muted-foreground w-5 shrink-0 font-mono text-[10px] tabular-nums">
                  {position + 1}
                </span>
                <CoverArt
                  trackId={track.id}
                  size={64}
                  className="size-9"
                  markClassName="scale-[.55]"
                />
                <button
                  type="button"
                  aria-label={`Play ${track.name}`}
                  onClick={() => playAt(position)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs" title={track.name}>
                    {track.name}
                  </span>
                  <span className="text-muted-foreground mt-1 block truncate text-[10px]">
                    {position === index
                      ? "Playing now"
                      : position < index
                        ? "Played"
                        : "Up next"}
                  </span>
                </button>
                {/* Keyboard-accessible alternatives to drag and drop. */}
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${track.name} up`}
                    disabled={position === 0}
                    onClick={() => reorder(position, position - 1)}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${track.name} down`}
                    disabled={position === queue.length - 1}
                    onClick={() => reorder(position, position + 1)}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${track.name} from queue`}
                    onClick={() => removeAt(position)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
