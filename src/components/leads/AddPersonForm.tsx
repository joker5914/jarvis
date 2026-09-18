"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Add a person" (Plan 10 Task 3): the manual-knowledge path for a business Apollo doesn't know
 * about (Pearland Coffee Roasters' Albert is the motivating case — see the plan's intro). Posts
 * straight to `POST /api/businesses/:id/people` and reloads the drawer on success; the route does
 * the real validation (this component's own checks are just a fast fail before the round trip).
 */
export function AddPersonForm({ businessId, onAdded }: { businessId: string; onAdded: () => Promise<void> }) {
  const nameId = useId();
  const titleId = useId();
  const emailId = useId();
  const phoneId = useId();
  const noteId = useId();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [setPrimary, setSetPrimary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/people`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          title: title.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
          setPrimary,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add person");
        return;
      }
      toast.success(`Added ${trimmedName}`);
      setName("");
      setTitle("");
      setEmail("");
      setPhone("");
      setNote("");
      setSetPrimary(true);
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border p-3" data-testid="add-person-form">
      <h4 className="text-xs font-semibold text-muted-foreground">Add a person</h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={nameId}>Name</Label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Albert" data-testid="add-person-name" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={titleId}>Title</Label>
          <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Owner" data-testid="add-person-title" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={emailId}>Email</Label>
          <Input id={emailId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="add-person-email" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={phoneId}>Phone</Label>
          <Input id={phoneId} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" data-testid="add-person-phone" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={noteId}>Note</Label>
        <Textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="How you know this" data-testid="add-person-note" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={setPrimary} onCheckedChange={(c) => setSetPrimary(!!c)} data-testid="add-person-set-primary" />
        Set as primary
      </label>
      {error && (
        <p className="text-xs text-destructive" data-testid="add-person-error">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={submitting} data-testid="add-person-submit">
        {submitting ? "Adding…" : "Add person"}
      </Button>
    </form>
  );
}
