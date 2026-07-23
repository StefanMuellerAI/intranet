"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Lösch-Button mit Bestätigungsdialog für zurückgezogene Anträge.
 * Die übergebene Server Action löscht den Antrag endgültig und leitet
 * anschließend zur Listenseite weiter.
 */
export function DeleteRequestButton({
  action,
  description,
}: {
  action: () => Promise<void>;
  description: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" />}>
        Endgültig löschen
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Endgültig löschen?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Abbrechen
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => startTransition(async () => action())}
          >
            {pending ? "Wird gelöscht …" : "Endgültig löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
