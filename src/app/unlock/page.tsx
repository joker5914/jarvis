export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form
        method="post"
        action="/api/unlock"
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm dark:bg-neutral-900"
      >
        <h1 className="text-xl font-semibold">Unlock SDR Lead Gen</h1>
        <p className="text-sm text-neutral-500">Enter the passphrase to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          name="passphrase"
          type="password"
          autoFocus
          required
          className="w-full rounded-md border px-3 py-2"
          placeholder="Passphrase"
        />
        {error === "locked" ? (
          <p className="text-sm text-red-600">Too many attempts. Try again in 15 minutes.</p>
        ) : error ? (
          <p className="text-sm text-red-600">That passphrase is not right.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
