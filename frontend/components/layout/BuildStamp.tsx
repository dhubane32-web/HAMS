import { APP_BUILD_ID, NAV_CONFIG_VERSION } from '@/lib/build-meta';

/** Server-rendered build stamp — helps verify deploy + bust stale HTML caches. */
export default function BuildStamp() {
  return (
    <>
      <meta name="hams-build-id" content={APP_BUILD_ID} />
      <meta name="hams-nav-version" content={NAV_CONFIG_VERSION} />
    </>
  );
}
