import { Plus, Trash2, Youtube, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { useChannels, useRemoveChannel } from "../hooks/use-channels";
import { useState } from "react";

interface ChannelSidebarProps {
  layout: "vertical" | "horizontal";
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
  onAddClick: () => void;
}

export function ChannelSidebar({ layout, selectedId, onSelect, onAddClick }: ChannelSidebarProps) {
  const { data: channels, isLoading } = useChannels();
  const removeMutation = useRemoveChannel();
  const [removingId, setRemovingId] = useState<number | null>(null);

  const handleRemove = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Remove this channel from your feed?")) {
      setRemovingId(id);
      removeMutation.mutate({ id }, {
        onSettled: () => setRemovingId(null),
        onSuccess: () => {
          if (selectedId === id) onSelect(undefined);
        }
      });
    }
  };

  const isVertical = layout === "vertical";

  if (isLoading) {
    return (
      <div className={cn("flex gap-3", isVertical ? "flex-col" : "items-center")}>
        {[1, 2, 3].map(i => (
          <div key={i} className={cn("bg-surface animate-pulse rounded-lg", isVertical ? "h-12 w-full" : "h-10 w-32 shrink-0")} />
        ))}
      </div>
    );
  }

  const hasChannels = channels && channels.length > 0;

  return (
    <div className={cn("flex", isVertical ? "flex-col gap-4" : "gap-3 items-center")}>
      {isVertical && (
        <div className="flex items-center justify-between px-2 mb-2">
          <h2 className="text-sm font-display font-semibold text-text-muted tracking-wider uppercase">Your Channels</h2>
          <span className="text-xs bg-surface-hover text-text-muted px-2 py-0.5 rounded-full font-medium">
            {channels?.length || 0}
          </span>
        </div>
      )}

      {/* "All Channels" Button */}
      {hasChannels && (
        <button
          onClick={() => onSelect(undefined)}
          className={cn(
            "group flex items-center transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl",
            isVertical 
              ? "w-full p-2.5 gap-3" 
              : "shrink-0 px-4 py-2 gap-2 bg-surface border border-border whitespace-nowrap",
            selectedId === undefined
              ? (isVertical ? "bg-surface text-white" : "bg-text-main text-background border-text-main shadow-md")
              : (isVertical ? "hover:bg-surface-hover text-text-muted hover:text-text-main" : "hover:bg-surface-hover text-text-muted hover:text-text-main hover:border-border-hover")
          )}
        >
          <div className={cn(
            "flex items-center justify-center shrink-0 rounded-full",
            isVertical ? "w-8 h-8" : "w-5 h-5",
            selectedId === undefined ? (isVertical ? "bg-primary text-white" : "text-background") : "bg-surface-hover text-text-muted group-hover:text-primary group-hover:bg-primary/10 transition-colors"
          )}>
            <Youtube className={isVertical ? "w-4 h-4" : "w-3 h-3"} />
          </div>
          <span className="font-medium text-sm">All Channels</span>
        </button>
      )}

      {/* Channel List */}
      {channels?.map((channel) => {
        const isSelected = selectedId === channel.id;
        const isRemoving = removingId === channel.id;
        
        return (
          <button
            key={channel.id}
            onClick={() => onSelect(channel.id)}
            disabled={isRemoving}
            className={cn(
              "group flex items-center transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl relative overflow-hidden",
              isVertical 
                ? "w-full p-2.5 gap-3" 
                : "shrink-0 px-4 py-2 gap-2 bg-surface border border-border whitespace-nowrap",
              isSelected
                ? (isVertical ? "bg-surface text-white shadow-sm border border-border/50" : "bg-text-main text-background border-text-main shadow-md")
                : (isVertical ? "hover:bg-surface-hover text-text-muted hover:text-text-main border border-transparent" : "hover:bg-surface-hover text-text-muted hover:text-text-main hover:border-border-hover"),
              isRemoving && "opacity-50 cursor-not-allowed"
            )}
          >
            {channel.thumbnailUrl ? (
              <img 
                src={channel.thumbnailUrl} 
                alt={channel.name} 
                className={cn(
                  "rounded-full object-cover shrink-0", 
                  isVertical ? "w-8 h-8" : "w-5 h-5"
                )} 
              />
            ) : (
              <div className={cn(
                "rounded-full bg-surface-hover flex items-center justify-center shrink-0 font-bold",
                isVertical ? "w-8 h-8 text-xs" : "w-5 h-5 text-[10px]"
              )}>
                {channel.name.charAt(0)}
              </div>
            )}
            
            <span className={cn(
              "font-medium text-sm truncate",
              isVertical ? "flex-1 text-left" : ""
            )}>
              {channel.name}
            </span>

            {/* Remove Button (Vertical Only) */}
            {isVertical && (
              <div 
                role="button"
                onClick={(e) => handleRemove(e, channel.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-red-500/70 hover:text-red-500 rounded-lg transition-all"
                title="Remove channel"
              >
                {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </div>
            )}
          </button>
        );
      })}

      {/* Add Action (Horizontal Only) */}
      {!isVertical && (
        <button
          onClick={onAddClick}
          className="shrink-0 px-4 py-2 flex items-center gap-2 bg-surface border border-dashed border-border hover:border-primary/50 text-text-muted hover:text-primary transition-colors rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="w-4 h-4" />
          <span className="font-medium text-sm text-nowrap">Add Channel</span>
        </button>
      )}

      {/* Empty State (Vertical) */}
      {isVertical && !hasChannels && (
        <div className="px-2 py-6 text-center border border-dashed border-border rounded-xl bg-surface/30">
          <Youtube className="w-8 h-8 mx-auto text-border mb-3" />
          <p className="text-sm text-text-muted mb-4 px-2">Your feed is empty. Add a channel to start watching.</p>
          <button
            onClick={onAddClick}
            className="text-sm font-medium text-primary hover:text-primary-hover flex items-center justify-center gap-1 w-full"
          >
            <Plus className="w-4 h-4" /> Add Channel
          </button>
        </div>
      )}
    </div>
  );
}
