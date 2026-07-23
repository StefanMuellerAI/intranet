import Image from "next/image";
import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Anmelden" };

export default function AnmeldenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="StefanAI Logo"
            width={72}
            height={72}
            priority
            className="mb-3 dark:invert"
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            StefanAI Intranet
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mitarbeiterportal der StefanAI Solutions GmbH
          </p>
        </div>
        <SignIn
          appearance={{ elements: { footer: "hidden" } }}
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </main>
  );
}
