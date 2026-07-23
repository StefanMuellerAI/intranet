"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveAction, rejectAction } from "@/app/(app)/freigaben/actions";
import type { WorkflowType } from "@/lib/workflow";

export function ApprovalButtons({
  type,
  id,
  isOwn,
  isCancellation,
}: {
  type: WorkflowType;
  id: string;
  /** Eigener Antrag → Vier-Augen-Prinzip, Buttons deaktiviert */
  isOwn: boolean;
  isCancellation?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState("");
  const router = useRouter();

  if (isOwn) {
    return (
      <p className="text-sm text-muted-foreground">
        Eigene Anträge dürfen nicht selbst genehmigt werden
        (Vier-Augen-Prinzip).
      </p>
    );
  }

  function run(fn: () => Promise<void>, successMsg: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMsg);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Fehler");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          run(
            () => approveAction(type, id),
            isCancellation ? "Storno bestätigt." : "Antrag genehmigt."
          )
        }
      >
        {isCancellation ? "Storno bestätigen" : "Genehmigen"}
      </Button>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger render={<Button variant="outline" disabled={pending} />}>
          {isCancellation ? "Storno ablehnen" : "Beanstanden"}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isCancellation ? "Storno ablehnen" : "Antrag beanstanden"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="comment">Grund (Pflichtfeld)</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Bitte begründen Sie die Beanstandung …"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !comment.trim()}
              onClick={() => {
                const fd = new FormData();
                fd.set("comment", comment);
                run(async () => {
                  await rejectAction(type, id, fd);
                  setRejectOpen(false);
                  setComment("");
                }, "Beanstandung gesendet.");
              }}
            >
              Beanstandung senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
