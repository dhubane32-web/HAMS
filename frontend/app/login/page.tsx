import Image from 'next/image';
import LoginForm from '@/components/LoginForm';
import BrandLogo from '@/components/BrandLogo';

function CheckIcon() {
  return (
    <svg className="h-3 w-3 text-hawana-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const features = [
  'Secure role-based access (RBAC)',
  'Operations, crew & maintenance',
  'Finance, sales & reporting'
];

export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100">
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl grid-cols-1 items-stretch bg-white shadow-card-lg md:my-4 md:min-h-[calc(100dvh-2rem)] md:grid-cols-2 md:overflow-hidden md:rounded-3xl md:border md:border-slate-200/80">
        {/* Brand / hero */}
        <aside className="relative flex min-h-[min(100dvh,520px)] flex-col overflow-hidden bg-hawana-navy text-white md:min-h-0">
          {/* Background image — clipped, never overlaps copy */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <Image
              src="/login-aircraft.svg"
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-[center_35%] opacity-25 md:object-[center_30%] md:opacity-30"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-hawana-navy/95 via-hawana-blue/80 to-slate-950/92" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_0%,rgba(255,215,0,0.1),transparent_50%)]" />
          </div>

          {/* Vertically centered content block + footer */}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col px-6 py-10 sm:px-8 md:px-10 md:py-12">
            <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 md:mx-0">
              {/* Logo: bounded box, aspect preserved, no overflow */}
              <div className="shrink-0">
                <BrandLogo variant="dark" placement="hero" priority />
              </div>

              <div className="space-y-4">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-hawana-gold/95 sm:text-xs">HAMS</p>
                <h1 className="text-balance text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-[2rem] lg:leading-snug">
                  Hawana Airways <span className="text-hawana-gold">Management System</span>
                </h1>
                <p className="max-w-prose text-pretty text-sm leading-relaxed text-slate-200/95 sm:text-[0.9375rem] lg:text-base">
                  Enterprise-grade control tower for bookings, operations, finance, crew, maintenance, and commercial —
                  aligned with modern airline ERP practice.
                </p>
              </div>

              <ul className="grid max-w-lg gap-3">
                {features.map((text) => (
                  <li
                    key={text}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-snug text-slate-100/95 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                      <CheckIcon />
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mx-auto mt-10 w-full max-w-lg text-[0.7rem] leading-relaxed text-slate-300/90 sm:text-xs md:mx-0 md:mt-12">
              © {new Date().getFullYear()} Hawana Airways. Authorized personnel only. All access is audited.
            </p>
          </div>
        </aside>

        {/* Form column — scroll if needed on short viewports */}
        <main className="flex min-h-0 flex-col justify-center overflow-y-auto bg-gradient-to-b from-slate-50 via-white to-slate-50/90 px-5 py-10 sm:px-8 md:px-10 lg:px-12">
          <LoginForm />
        </main>
      </div>
    </div>
  );
}
