import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitSickLeave } from "../actions";

export const metadata = { title: "Krank melden" };

export default async function NeueKrankmeldungPage() {
  await requireUser();

  return (
    <div>
      <PageHeader
        title="Krank melden"
        description="Die Meldung wird sofort an die Geschäftsführung übermittelt. Es ist kein Upload einer AU-Bescheinigung nötig — der Nachweis läuft über das elektronische eAU-Verfahren."
      />
      <form action={submitSickLeave} className="space-y-6 max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="startDate">
              Erster Tag der Arbeitsunfähigkeit
            </Label>
            <Input id="startDate" name="startDate" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endDate">Voraussichtliches Ende (optional)</Label>
            <Input id="endDate" name="endDate" type="date" />
            <p className="text-xs text-muted-foreground">
              Kann offen bleiben und später nachgetragen werden.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Typ</Label>
          <select
            id="type"
            name="type"
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="eigene_erkrankung"
          >
            <option value="eigene_erkrankung">eigene Erkrankung</option>
            <option value="kind_krank">Kind krank</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="note">Bemerkung (optional)</Label>
          <Textarea id="note" name="note" />
          <p className="text-xs text-muted-foreground">
            Bitte keine Diagnosen oder Krankheitsgründe angeben — diese werden
            nicht benötigt und nicht gespeichert.
          </p>
        </div>
        <Button type="submit">Krankmeldung senden</Button>
      </form>
    </div>
  );
}
