import Image from 'next/image';
import LoginForm from '@/components/LoginForm';
import BrandLogo from '@/components/BrandLogo';
import { BRAND } from '@/lib/brand';

export default function LoginPage() {
  return (
    <div className="hams-login-hero relative min-h-dvh w-full overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <Image
          src="/login-aircraft.svg"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-[center_40%] opacity-[0.14] sm:opacity-[0.18]"
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] w-full items-center justify-center px-4 py-safe">
        <div className="hams-login-card w-full max-w-md sm:max-w-lg">
          <header className="mb-6 flex flex-col items-center gap-4 text-center sm:mb-8">
            <BrandLogo variant="light" placement="login" priority className="mx-auto" />
            <div className="space-y-1.5">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-hawana-blue/90 sm:text-xs">
                {BRAND.systemName}
              </p>
              <h1 className="text-balance text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {BRAND.companyName}
              </h1>
              <p className="text-sm font-medium text-slate-600 sm:text-[0.9375rem]">
                Airline Operations Management System
              </p>
              <p className="mx-auto max-w-sm text-pretty text-xs leading-relaxed text-slate-500 sm:text-sm">
                Enterprise control tower for operations, crew, finance, and commercial — authorized personnel only.
              </p>
            </div>
          </header>

          <LoginForm />

          <p className="mt-6 text-center text-[0.7rem] leading-relaxed text-slate-400/90 sm:text-xs">
            © {new Date().getFullYear()} {BRAND.companyName}. All access is audited.
          </p>
        </div>
      </div>
    </div>
  );
}
