/**
 * Ziel von Formularen, die vor dem Laden des JavaScripts abgeschickt werden
 * (siehe src/components/form-submit.ts). Ohne dieses Ziel schickte der
 * Browser sie per GET an die aktuelle Seite — mit allen Eingaben in der URL.
 * Die Daten werden hier bewusst nicht verarbeitet.
 */
export function POST() {
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bitte erneut senden</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem">
<h1 style="font-size: 1.25rem">Bitte erneut senden</h1>
<p>Das Formular wurde abgeschickt, bevor die Seite vollständig geladen war. Es wurde nichts gespeichert.</p>
<p><a href="javascript:history.back()">Zurück zum Formular</a></p>
</body></html>`,
    {
      status: 400,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}
