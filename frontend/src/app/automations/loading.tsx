export default function Loading() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-muted rounded" />
        <div className="h-9 w-36 bg-muted rounded-md" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-20 bg-muted rounded-lg" />
      ))}
    </div>
  );
}
