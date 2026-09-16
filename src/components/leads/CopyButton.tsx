"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}
