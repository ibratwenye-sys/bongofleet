import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Marker } from 'react-leaflet';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicVehiclePosition } from '../lib/types';
import { VehicleMap } from '../components/VehicleMap';
import { vehicleDivIcon } from '../lib/gps-status';
// Stage L23 - the raw i18next singleton, imported directly rather than
// destructured from useTranslation(). Verified empirically that the `i18n`
// useTranslation() returns is NOT referentially stable across this page's
// own lifecycle: forcing the language below (i18n.changeLanguage('sw'))
// causes react-i18next to re-bind its hook return values once the change
// lands, changing `i18n`'s identity exactly once shortly after mount. Any
// effect/callback with that hook-bound `i18n` in its deps therefore
// re-fires once on every mount regardless of the AuthProvider race - this
// module import is the same object on every render, by construction, so
// nothing keyed off it re-fires spuriously. Reserve the hook's own `t`
// (and its `i18n`) for JSX, which SHOULD re-render on a real language
// change - that part already works correctly via React's normal render.
import i18n from '../lib/i18n';

// Stage I2 (§8) - relative "how long ago" phrasing for a stranger with no
// login, who has no reason to know what an ISO timestamp means. Local to
// this page rather than added to lib/format.ts (formatDateTime there is
// absolute date+time, a different need, used across the authenticated
// dashboard) - nothing else in the app currently wants relative phrasing.
// Stage L23 - takes `t` as a parameter (rather than moving inline into a
// component) since it's called from both VehicleCard and, indirectly,
// nowhere else - a plain function stays the simplest shape, same
// convention as vehicleTypeLabel(vehicleType, tCommon) elsewhere in the
// app. i18next itself picks the _one/_other form from `count`.
function timeAgo(iso: string, t: TFunction<'publicTracking'>): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('hoursAgo', { count: hours });
  const days = Math.round(hours / 24);
  return t('daysAgo', { count: days });
}

function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function VehicleCard({ position }: { position: PublicVehiclePosition }) {
  const { t } = useTranslation('publicTracking');
  const { t: tCommon } = useTranslation('common');
  return (
    <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-txt">{position.registrationNumber}</h2>
        {position.offline ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {tCommon('statusOffline')}
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            {tCommon('statusLive')}
          </span>
        )}
      </div>

      {position.offline ? (
        <p className="text-sm text-txt-2">
          {position.lastKnownAt
            ? t('lastSeen', { time: timeAgo(position.lastKnownAt, t) })
            : t('noLocationYet')}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-txt-2">
            {t('asOfLine', {
              time: timeAgo(position.recordedAt, t),
              lat: position.latitude.toFixed(5),
              lng: position.longitude.toFixed(5),
            })}
          </p>
          {/* Stage I3 (§8's map addendum) - the current dot only, no path:
              §10 open question 4 (today's path on the PUBLIC link) is still
              genuinely unresolved, unlike the authenticated live map. */}
          <VehicleMap
            center={[position.latitude, position.longitude]}
            zoom={15}
            heightClassName="h-64"
          >
            <Marker
              position={[position.latitude, position.longitude]}
              icon={vehicleDivIcon('live', position.source)}
            />
          </VehicleMap>
          <a
            href={googleMapsUrl(position.latitude, position.longitude)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-medium text-blue-700 hover:underline"
          >
            {t('openInGoogleMaps')}
          </a>
        </>
      )}
    </div>
  );
}

export function PublicTrackingPage() {
  const { t } = useTranslation('publicTracking');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicVehiclePosition | PublicVehiclePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Stage L23 - this page is public and unauthenticated: there is no
  // signed-in account preference to read, so it always renders in Swahili
  // regardless of whatever language the rest of the app is currently set
  // to in this browser tab. useLayoutEffect (not useEffect) so the switch
  // happens before first paint - no flash of the previous language. Merged
  // with the title/meta-tag effect since both belong to the same page-setup
  // concern. No head-management library exists in this app (App.tsx has no
  // route that needs one) - a plain document.title + injected meta tag is
  // enough for this one public page. Both the language and the title are
  // restored on unmount, so navigating back into the authenticated
  // dashboard in the same tab doesn't leave an English-preferring user
  // stuck in Swahili, and doesn't leave a stale noindex tag behind either.
  //
  // Verified empirically that a plain one-shot changeLanguage('sw') is not
  // enough: AuthProvider's own bootstrap effect (auth-context.tsx) mounts
  // on every route including this public one, and if this browser already
  // holds a stored session (an owner checking their own tracking link in
  // the same tab they're logged into the dashboard with - one of this
  // page's two intended uses per TrackingLinksPage's own intro copy), its
  // /auth/me round trip resolves shortly after this effect and silently
  // calls applyLanguage() back to that account's own preference, flipping
  // this page back to English mid-view. Holding a lock on 'sw' for as long
  // as this page is mounted - re-asserting it immediately whenever
  // anything else changes the language away from it - is what actually
  // fixes this, not just a one-time changeLanguage call.
  useLayoutEffect(() => {
    const previousLanguage = i18n.language;
    const previousTitle = document.title;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);

    function holdSwahili(lng: string) {
      if (lng !== 'sw') {
        void i18n.changeLanguage('sw');
        return;
      }
      document.title = i18n.t('pageTitle', { ns: 'publicTracking' });
    }
    i18n.on('languageChanged', holdSwahili);
    if (i18n.language === 'sw') {
      holdSwahili('sw');
    } else {
      void i18n.changeLanguage('sw');
    }

    return () => {
      i18n.off('languageChanged', holdSwahili);
      document.title = previousTitle;
      document.head.removeChild(meta);
      void i18n.changeLanguage(previousLanguage);
    };
    // Mount/unmount-only, and correctly so: `i18n` here is the module
    // import above, not the hook's per-render binding, so it is genuinely
    // exempt from exhaustive-deps rather than merely suppressed - it never
    // changes identity, and re-running this on every render would re-append
    // a meta tag and re-capture previousLanguage as 'sw' instead of the
    // tab's real prior language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage L23 - a second bug in the same family, found in review: this
  // callback used to depend on the hook's own `t`/`i18n` for its two error
  // strings. Verified empirically that useTranslation()'s `i18n` is NOT
  // referentially stable across this page's lifecycle either - forcing the
  // language above causes react-i18next to rebind its hook return values
  // once the change lands, changing identity exactly once shortly after
  // mount, regardless of whether the AuthProvider race above also fires.
  // With either the hook's `t` or its `i18n` in this callback's deps, that
  // rebind alone recreated loadTracking and re-ran the effect below, always
  // silently refetching /public/track/:token a second time on every mount -
  // a spurious flash back to "Loading…" after the page had already
  // rendered, and (worse, if the AuthProvider race also fires) a stale
  // English-bound request resolving after a newer Swahili one and flipping
  // a shown error back to English. The module-level `i18n` import is a
  // plain object reference, stable by construction, so using it here
  // instead drops this callback's real dependency to just `token`.
  const loadTracking = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    apiFetch<PublicVehiclePosition | PublicVehiclePosition[]>(`/public/track/${token}`)
      .then(setData)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? i18n.t('errorInvalidLink', { ns: 'publicTracking' })
            : i18n.t('errorLoadFailed', { ns: 'publicTracking' }),
        );
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    loadTracking();
  }, [loadTracking]);

  const positions = data === null ? [] : Array.isArray(data) ? data : [data];

  return (
    <div className="min-h-screen bg-page p-4 md:p-6">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-lg font-semibold text-txt">{t('pageTitle')}</h1>

        {loading && <p className="text-sm text-txt-2">{t('loading')}</p>}
        {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

        {!loading && !error && positions.length === 0 && (
          <p className="text-sm text-txt-2">{t('noVehicles')}</p>
        )}

        <div className="space-y-3">
          {positions.map((position) => (
            <VehicleCard key={position.registrationNumber} position={position} />
          ))}
        </div>
      </div>
    </div>
  );
}
