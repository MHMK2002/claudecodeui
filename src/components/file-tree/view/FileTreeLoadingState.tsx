export default function FileTreeLoadingState() {
  return (
    <div className="space-y-2 px-3 py-4" role="status" aria-label="Loading files">
      <span className="sr-only">Loading files…</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-9 items-center gap-3" aria-hidden="true">
          <span className="h-5 w-5 rounded bg-muted motion-safe:animate-pulse" />
          <span
            className="h-4 rounded bg-muted motion-safe:animate-pulse"
            style={{ width: `${72 - index * 5}%` }}
          />
        </div>
      ))}
    </div>
  );
}
