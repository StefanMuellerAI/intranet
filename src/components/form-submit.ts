import type { FormEvent } from "react";

/**
 * Für jedes Formular mit submitWithoutReset: Wird es abgeschickt, bevor
 * React geladen ist, landen die Eingaben per POST im Body (statt per GET in
 * der URL und damit in Verlauf und Logs) und die Fallback-Route bittet um
 * erneutes Senden.
 */
export const preHydrationFallback = {
  method: "post",
  action: "/api/formular-ohne-javascript",
} as const;

/**
 * onSubmit-Handler statt `<form action={…}>`: React 19 setzt Formulare mit
 * action-Prop nach jedem Absenden zurück — auch wenn die Server Action mit
 * einem Fehler endet. Dann wären alle Eingaben weg, obwohl das Formular zur
 * Korrektur offen bleibt. Die native Pflichtfeld-Prüfung läuft weiterhin
 * vor dem submit-Event.
 */
export function submitWithoutReset(
  handler: (formData: FormData) => unknown
): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    void handler(new FormData(event.currentTarget));
  };
}
