import { getActor } from "@/lib/actor";
import { SettingsView } from "@/components/settings/SettingsView";

export default async function SettingsPage() {
  const actor = await getActor();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsView ownerId={actor.id} />
    </div>
  );
}
