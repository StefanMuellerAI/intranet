"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  createCustomerAction,
  createProjectAction,
  toggleCustomerActiveAction,
  toggleProjectActiveAction,
  updateCustomerAction,
  updateProjectAction,
} from "@/app/(app)/faktura/kunden/actions";
import type { ActionResult } from "@/lib/faktura/user-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QUARTER_HOURS_PATTERN,
  QUARTER_HOURS_TITLE,
} from "@/lib/form-patterns";

export interface ProjectView {
  id: string;
  name: string;
  validFrom: string | null;
  validTo: string | null;
  monthlyLimitHours: string | null;
  active: boolean;
  bookedHours: string;
  overLimit: boolean;
}

export interface CustomerView {
  id: string;
  name: string;
  address: string | null;
  contactPerson: string | null;
  active: boolean;
  projects: ProjectView[];
}

function useAction() {
  const [pending, startTransition] = useTransition();
  // Actions liefern Fehler als Ergebnis (statt throw), damit die Meldung
  // auch im Production-Build lesbar ankommt.
  const run = (fn: () => Promise<ActionResult<unknown>>, msg?: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (msg) toast.success(msg);
    });
  return { pending, run };
}

function ActionForm({
  action,
  successMessage,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown>>;
  successMessage: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { pending, run } = useAction();
  return (
    <form
      action={(fd) => run(() => action(fd), successMessage)}
      className={className}
      aria-busy={pending}
    >
      {children}
    </form>
  );
}

export function CustomerCreateForm() {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Neuen Kunden anlegen</CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={createCustomerAction}
          successMessage="Kunde angelegt."
          className="grid gap-3 sm:grid-cols-3"
        >
          <div className="space-y-1">
            <Label htmlFor="new-customer-name">Name (Pflicht, eindeutig)</Label>
            <Input id="new-customer-name" name="name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-customer-address">Anschrift (optional)</Label>
            <Input id="new-customer-address" name="address" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-customer-contact">
              Ansprechpartner/in (optional)
            </Label>
            <Input id="new-customer-contact" name="contactPerson" />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit">Kunde anlegen</Button>
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}

function ProjectRow({ project }: { project: ProjectView }) {
  const { pending, run } = useAction();
  return (
    <li className="rounded-md border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{project.name}</p>
        <Badge variant={project.active ? "default" : "secondary"}>
          {project.active ? "aktiv" : "inaktiv"}
        </Badge>
        {project.monthlyLimitHours ? (
          <Badge variant={project.overLimit ? "destructive" : "outline"}>
            Monat: {project.bookedHours} / {project.monthlyLimitHours} h
            {project.overLimit ? " · Überbuchung" : ""}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            Monat: {project.bookedHours} h · kein Limit
          </span>
        )}
      </div>
      <ActionForm
        action={updateProjectAction}
        successMessage="Projekt aktualisiert."
        className="grid gap-3 sm:grid-cols-4"
      >
        <input type="hidden" name="id" value={project.id} />
        <div className="space-y-1">
          <Label htmlFor={`project-name-${project.id}`}>Name</Label>
          <Input
            id={`project-name-${project.id}`}
            name="name"
            defaultValue={project.name}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`project-from-${project.id}`}>Laufzeit von</Label>
          <Input
            id={`project-from-${project.id}`}
            name="validFrom"
            type="date"
            defaultValue={project.validFrom ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`project-to-${project.id}`}>Laufzeit bis</Label>
          <Input
            id={`project-to-${project.id}`}
            name="validTo"
            type="date"
            defaultValue={project.validTo ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`project-limit-${project.id}`}>
            Monatslimit (h, 0,25er)
          </Label>
          <Input
            id={`project-limit-${project.id}`}
            name="monthlyLimitHours"
            inputMode="decimal"
            pattern={QUARTER_HOURS_PATTERN}
            title={QUARTER_HOURS_TITLE}
            placeholder="z. B. 40"
            defaultValue={project.monthlyLimitHours ?? ""}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
          <Button type="submit" size="sm" variant="outline">
            Speichern
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => toggleProjectActiveAction(project.id, !project.active),
                project.active
                  ? "Projekt inaktiv gesetzt."
                  : "Projekt aktiviert."
              )
            }
          >
            {project.active ? "Inaktiv setzen" : "Aktivieren"}
          </Button>
        </div>
      </ActionForm>
    </li>
  );
}

export function CustomerCard({ customer }: { customer: CustomerView }) {
  const { pending, run } = useAction();
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {customer.name}
          <Badge variant={customer.active ? "default" : "secondary"}>
            {customer.active ? "aktiv" : "inaktiv"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ActionForm
          action={updateCustomerAction}
          successMessage="Kunde aktualisiert."
          className="grid gap-3 sm:grid-cols-3"
        >
          <input type="hidden" name="id" value={customer.id} />
          <div className="space-y-1">
            <Label htmlFor={`customer-name-${customer.id}`}>Name</Label>
            <Input
              id={`customer-name-${customer.id}`}
              name="name"
              defaultValue={customer.name}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`customer-address-${customer.id}`}>Anschrift</Label>
            <Input
              id={`customer-address-${customer.id}`}
              name="address"
              defaultValue={customer.address ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`customer-contact-${customer.id}`}>
              Ansprechpartner/in
            </Label>
            <Input
              id={`customer-contact-${customer.id}`}
              name="contactPerson"
              defaultValue={customer.contactPerson ?? ""}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" size="sm" variant="outline">
              Speichern
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    toggleCustomerActiveAction(customer.id, !customer.active),
                  customer.active
                    ? "Kunde inaktiv gesetzt — Bestandsbuchungen bleiben erhalten."
                    : "Kunde aktiviert."
                )
              }
            >
              {customer.active ? "Inaktiv setzen" : "Aktivieren"}
            </Button>
          </div>
        </ActionForm>

        <div>
          <p className="mb-2 text-sm font-medium">
            Projekte ({customer.projects.length})
          </p>
          {customer.projects.length === 0 ? (
            <p className="mb-3 text-sm text-muted-foreground">
              Noch keine Projekte.
            </p>
          ) : (
            <ul className="mb-3 space-y-3">
              {customer.projects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </ul>
          )}

          <ActionForm
            action={createProjectAction}
            successMessage="Projekt angelegt."
            className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-4"
          >
            <input type="hidden" name="customerId" value={customer.id} />
            <div className="space-y-1">
              <Label htmlFor={`new-project-name-${customer.id}`}>
                Neues Projekt
              </Label>
              <Input
                id={`new-project-name-${customer.id}`}
                name="name"
                required
                placeholder="Projektname"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`new-project-from-${customer.id}`}>
                Laufzeit von (optional)
              </Label>
              <Input
                id={`new-project-from-${customer.id}`}
                name="validFrom"
                type="date"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`new-project-to-${customer.id}`}>
                Laufzeit bis (optional)
              </Label>
              <Input
                id={`new-project-to-${customer.id}`}
                name="validTo"
                type="date"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`new-project-limit-${customer.id}`}>
                Monatslimit (h, optional)
              </Label>
              <Input
                id={`new-project-limit-${customer.id}`}
                name="monthlyLimitHours"
                inputMode="decimal"
                pattern={QUARTER_HOURS_PATTERN}
                title={QUARTER_HOURS_TITLE}
                placeholder="z. B. 40"
              />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm">
                Projekt anlegen
              </Button>
            </div>
          </ActionForm>
        </div>
      </CardContent>
    </Card>
  );
}
