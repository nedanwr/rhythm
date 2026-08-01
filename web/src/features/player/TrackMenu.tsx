import { Menu } from "@base-ui/react/menu";
import { Ellipsis, ListEnd, ListPlus } from "lucide-react";

import type { Track } from "~/api/schemas";
import { usePlayerActions } from "./context";

const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2.5 rounded-sm px-2 text-[13px] text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-faint data-[highlighted]:[&_svg]:text-foreground";

export function TrackMenu({ track }: { track: Track }) {
  const { playNext, addToQueue } = usePlayerActions();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Actions for ${track.name}`}
        className="text-faint hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-md opacity-0 transition-opacity outline-none group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
      >
        <Ellipsis className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end">
          <Menu.Popup className="border-border bg-popover shadow-lift min-w-45 rounded-md border p-1 outline-none">
            <Menu.Item className={itemClass} onClick={() => playNext(track)}>
              <ListPlus />
              Play next
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={() => addToQueue(track)}>
              <ListEnd />
              Add to queue
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
