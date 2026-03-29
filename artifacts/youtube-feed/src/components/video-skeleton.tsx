export function VideoSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="aspect-video bg-surface rounded-xl w-full border border-border" />
      <div className="flex gap-3 pr-2">
        <div className="w-9 h-9 rounded-full bg-surface shrink-0 mt-0.5 border border-border" />
        <div className="flex flex-col gap-2 w-full pt-1">
          <div className="h-4 bg-surface rounded w-[90%]" />
          <div className="h-4 bg-surface rounded w-[60%]" />
          <div className="h-3 bg-surface rounded w-[40%] mt-2" />
        </div>
      </div>
    </div>
  );
}
