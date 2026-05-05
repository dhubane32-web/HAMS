'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';
import { getResolvedBrand } from '@/lib/brand-config';

export type BrandLogoPlacement = 'login' | 'sidebar' | 'sidebarCollapsed' | 'navbar' | 'hero' | 'marketing';

type Props = {
  /** Light: full-colour / dark-on-light PNG. Dark: light-on-dark PNG for navy bands. */
  variant: 'light' | 'dark';
  placement: BrandLogoPlacement;
  className?: string;
  priority?: boolean;
};

const outerClass: Record<BrandLogoPlacement, string> = {
  login: 'w-full max-w-[110px] overflow-hidden md:max-w-[180px]',
  sidebar: 'max-w-[140px] w-full min-w-0 overflow-hidden',
  sidebarCollapsed: 'max-w-[44px] w-full min-w-0 overflow-hidden',
  navbar: 'max-w-[180px] w-full min-w-0 overflow-hidden',
  hero: 'w-full max-w-[200px] overflow-hidden sm:max-w-[220px]',
  marketing: 'max-w-[160px] overflow-hidden sm:max-w-[200px]'
};

const imgClass: Record<BrandLogoPlacement, string> = {
  login: 'h-auto w-full object-contain object-center',
  sidebar: 'h-auto w-full object-contain object-left',
  sidebarCollapsed: 'h-auto w-full object-contain object-left',
  navbar: 'h-auto w-full object-contain object-left',
  hero: 'h-auto w-full object-contain object-left sm:object-left',
  marketing: 'h-auto w-full object-contain object-left'
};

/** Official Hawana mark — responsive caps, never stretched (object-contain). */
function readThemeDark() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export default function BrandLogo({ variant, placement, className, priority }: Props) {
  const [lightSrc, setLightSrc] = useState<string>(BRAND.logoPath);
  const [darkSrc, setDarkSrc] = useState<string>(BRAND.logoDarkPath);
  const [themeDark, setThemeDark] = useState(false);

  useEffect(() => {
    const b = getResolvedBrand();
    setLightSrc(b.logoLight);
    setDarkSrc(b.logoDark);
  }, []);

  useEffect(() => {
    const sync = () => setThemeDark(readThemeDark());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  /** Light-on-dark raster on dark backgrounds; follow app `data-theme` when variant is light. */
  const useDarkAsset = variant === 'dark' || (variant === 'light' && themeDark);

  const src = useDarkAsset ? darkSrc : lightSrc;

  return (
    <div className={[outerClass[placement], className].filter(Boolean).join(' ')}>
      <Image
        src={src}
        alt={BRAND.companyName}
        width={560}
        height={240}
        priority={priority}
        className={imgClass[placement]}
        sizes="(max-width: 768px) 110px, 180px"
      />
    </div>
  );
}
