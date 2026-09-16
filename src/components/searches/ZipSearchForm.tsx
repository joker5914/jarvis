"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ZipSearchForm() {
  const router = useRouter();
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      toast.error("Enter a 5-digit zip code");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zip }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to start search");
      toast.success(`Search started for ${zip}`);
      setZip("");
      router.push("/searches");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md gap-2" data-testid="zip-search-form">
      <Input
        value={zip}
        onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
        placeholder="Zip code, e.g. 77084"
        inputMode="numeric"
        aria-label="Zip code"
      />
      <Button type="submit" disabled={busy}>
        {busy ? "Starting…" : "Run search"}
      </Button>
    </form>
  );
}
