import { Button } from "@/components/ui/button";
import { assistLinks } from "@/lib/leads/manualAssists";

/**
 * Plan 10 Task 4: quick manual assists for a lead where no database knows the real point of
 * contact — rendered by `PeopleSection` under the confidence line whenever the best-known contact
 * isn't already a decision-maker set by the rep (levels `manager`, `staff`, `none`). Every link is
 * a plain search-engine URL (no API call, no credit); the call prompt only appears when the
 * business's own phone number parses.
 */
export function ManualAssists({
  business,
}: {
  business: { name: string; formattedAddress: string | null; websiteUrl: string | null; phone: string | null };
}) {
  const links = assistLinks(business);
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" data-testid="manual-assists">
      <span className="text-muted-foreground">Find the owner:</span>
      <Button
        size="xs"
        variant="ghost"
        nativeButton={false}
        aria-label="Find the owner on LinkedIn"
        render={<a href={links.linkedinPeople} target="_blank" rel="noopener noreferrer" />}
      >
        LinkedIn
      </Button>
      <span className="text-muted-foreground">·</span>
      <Button
        size="xs"
        variant="ghost"
        nativeButton={false}
        aria-label="Find the owner on Facebook"
        render={<a href={links.facebookPages} target="_blank" rel="noopener noreferrer" />}
      >
        Facebook
      </Button>
      <span className="text-muted-foreground">·</span>
      <Button
        size="xs"
        variant="ghost"
        nativeButton={false}
        aria-label="Find the owner on Google"
        render={<a href={links.googleOwner} target="_blank" rel="noopener noreferrer" />}
      >
        Google
      </Button>
      {links.tel && (
        <Button
          size="xs"
          variant="outline"
          className="ml-1"
          nativeButton={false}
          data-testid="call-owner-button"
          render={<a href={links.tel} />}
        >
          Call and ask for the owner ({links.telDisplay})
        </Button>
      )}
    </div>
  );
}
