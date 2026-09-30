export default function Loading() {
  return (
    <main
      id="main"
      role="status"
      aria-label="Loading contact"
      className="bg-grain min-h-[calc(100dvh-64px)]"
    >
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="skeleton mt-5 h-7 w-28" />
        <div className="mt-6 flex items-center gap-5">
          <div className="skeleton h-20 w-20 rounded-3xl" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-8 w-2/3 max-w-sm" />
            <div className="skeleton h-4 w-1/2 max-w-xs" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[4.5rem] rounded-2xl" />
          ))}
        </div>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            {[92, 88, 95, 70].map((w) => (
              <div key={w} className="skeleton h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="skeleton h-56 rounded-2xl" />
        </div>
      </div>
    </main>
  );
}
