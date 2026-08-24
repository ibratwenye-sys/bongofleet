import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, ApiError, NetworkError } from '../api';
import { clearTokens, getQueue } from '../storage';
import { enqueuePayment, flushQueue } from '../queue';
import { enqueueGpsFix, flushGpsQueue } from '../gpsQueue';
import { startGpsTracking, stopGpsTracking } from '../gpsTracking';
import { formatTZS, todayKey } from '../format';
import type {
  Assignment,
  AssignmentDetail,
  Me,
  OwnershipPlan,
  Payment,
  QueuedGpsFix,
} from '../types';

/**
 * Stage DM1. Moved out of the old monolithic HomeScreen.tsx unchanged, not
 * rewritten: Leo (balance + Pay button) and Lipa (payment form + offline
 * queue + receipt upload) are now two separate screens under the tab
 * navigator, but they show the same live data - a payment recorded on Lipa
 * has to be reflected in Leo's balance without Leo needing to remount, and
 * the offline/queue banners have to agree on both tabs. A plain hook would
 * give each screen its own independent fetch and state, which is exactly
 * the split-brain this Provider avoids: one fetch, one queue, one banner,
 * shared via context.
 *
 * Every Alert.alert(...) from the old HomeScreen is gone from here -
 * Alert.alert is a documented no-op under react-native-web, so on the web
 * preview every one of these used to fail completely silently. All eight
 * are replaced by the banner below (testID="notice-banner"), which is a
 * real React Native view and renders identically on every platform this
 * app targets, web included.
 */

interface Banner {
  message: string;
  kind: 'success' | 'error';
}

// Error banners tend to carry more to read (validation detail, a rejected-
// payment report with a reason per line) than a short "Payment recorded."
// success - longer on screen, same reasoning as the original 4s success
// timing, just extended for the case that needs it.
const SUCCESS_BANNER_MS = 4000;
const ERROR_BANNER_MS = 7000;

interface DriverData {
  me: Me | null;
  assignment: AssignmentDetail | null;
  noAssignment: boolean;
  /** Stage G2 - the plan behind assignment.ownershipPlanId, fetched
   *  alongside it and null for a daily-rental driver. Lives here, not as a
   *  screen-local fetch (contrast Mkataba wangu, which does fetch its own
   *  copy): recordPayment already calls load() after every payment, and a
   *  plan card whose whole point is showing the driver's up-to-date
   *  days-behind/ahead position must not go stale between Lipa and Leo the
   *  way a screen-local fetch would. */
  plan: OwnershipPlan | null;
  payments: Payment[];
  queueCount: number;
  /** Stage I1 - true only while actually watching position: foregrounded,
   *  an assignment exists today, AND permission was granted. The consent
   *  row (StatusBanners) reads this, not just "was permission ever
   *  granted" - tracking stops the instant any one of those conditions
   *  stops holding, and this reflects that in real time. */
  gpsEnabled: boolean;
  /** Stage I1 - last time a GPS fix was actually accepted by the server
   *  (not just queued locally) - what the consent row's "last sent" reads. */
  gpsLastSentAt: string | null;
  offline: boolean;
  loading: boolean;
  refreshing: boolean;
  banner: Banner | null;
  /** Stage H4 - exposed so a screen outside this provider's own closure
   *  (Matumizi) can use the same notice-banner pattern every other screen
   *  uses, rather than inventing its own. Payment-specific state
   *  (recordPayment/uploadReceipt/the payment queue) stays exactly as it
   *  was - this is the one general-purpose piece of the provider that
   *  genuinely needed to be reusable. */
  showBanner: (message: string, kind: 'success' | 'error') => void;
  submitting: boolean;
  uploadingId: string | null;
  refresh: () => Promise<void>;
  /** Just a sync attempt, no full reload - what the "tap to sync now" queue
   *  banner calls, matching the original HomeScreen exactly. */
  trySync: () => Promise<void>;
  /** Resolves true if the form should be cleared (recorded or queued OK),
   *  false if it should be left as-is (validation failure or an error the
   *  driver may want to retry without retyping). Mirrors exactly which
   *  paths called setAmount('')/setMethod('') in the old HomeScreen. */
  recordPayment: (amountRaw: string, methodRaw: string) => Promise<boolean>;
  uploadReceipt: (paymentId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const DriverDataContext = createContext<DriverData | null>(null);

export function useDriverData(): DriverData {
  const ctx = useContext(DriverDataContext);
  if (!ctx) {
    throw new Error('useDriverData() must be called within a DriverDataProvider');
  }
  return ctx;
}

export function DriverDataProvider({
  onLoggedOut,
  children,
}: {
  onLoggedOut: () => void;
  children: ReactNode;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [noAssignment, setNoAssignment] = useState(false);
  const [plan, setPlan] = useState<OwnershipPlan | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsLastSentAt, setGpsLastSentAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const showBanner = useCallback((message: string, kind: Banner['kind']) => {
    setBanner({ message, kind });
  }, []);

  const refreshQueueCount = useCallback(async () => {
    setQueueCount((await getQueue()).length);
  }, []);

  const load = useCallback(async () => {
    try {
      const today = todayKey();
      const [meRes, assignments, paymentList] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        apiFetch<Assignment[]>(`/assignments?dateFrom=${today}&dateTo=${today}`),
        apiFetch<Payment[]>('/payments'),
      ]);
      setMe(meRes);
      setPayments(paymentList);
      setOffline(false);

      if (assignments.length > 0) {
        const detail = await apiFetch<AssignmentDetail>(`/assignments/${assignments[0].id}`);
        setAssignment(detail);
        setNoAssignment(false);
        setPlan(
          detail.ownershipPlanId
            ? await apiFetch<OwnershipPlan>(`/ownership-plans/${detail.ownershipPlanId}`)
            : null,
        );
      } else {
        setAssignment(null);
        setNoAssignment(true);
        setPlan(null);
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        setOffline(true); // keep whatever we already have on screen
      }
    } finally {
      await refreshQueueCount();
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshQueueCount]);

  const trySync = useCallback(async () => {
    const result = await flushQueue();
    if (result.sent > 0) {
      showBanner(`${result.sent} queued payment(s) synced.`, 'success');
      await load();
    }
    if (result.rejected.length > 0) {
      // Multi-line on purpose - a joined reason-per-payment report loses
      // real information if squeezed onto one line.
      showBanner(
        'Some queued payments were rejected:\n' +
          result.rejected.map((r) => `${formatTZS(r.item.amount)}: ${r.reason}`).join('\n'),
        'error',
      );
    }
    await refreshQueueCount();
    // Stage I1 - GPS fixes flush alongside payments on the same reconnect/
    // manual-sync trigger, not on a separate schedule; see the lifecycle
    // effect below for how fixes actually get queued in the first place.
    const gpsResult = await flushGpsQueue();
    if (gpsResult && gpsResult.sent > 0) {
      setGpsLastSentAt(new Date().toISOString());
    }
  }, [load, refreshQueueCount, showBanner]);

  useEffect(() => {
    void load().then(() => trySync());
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        setOffline(false);
        void trySync();
      } else {
        setOffline(true);
      }
    });
    return unsubscribe;
    // Intentionally run once on mount - load/trySync are stable enough here.
    // eslint-disable-next-line
  }, []);

  const handleGpsFix = useCallback(async (fix: QueuedGpsFix) => {
    await enqueueGpsFix(fix);
    const result = await flushGpsQueue();
    if (result && result.sent > 0) {
      setGpsLastSentAt(new Date().toISOString());
    }
  }, []);

  // Stage I1 (§4) - tracking runs only while: the app is foregrounded, AND
  // the driver has today's DailyAssignment. `hasAssignmentToday` (a plain
  // boolean, not the assignment object itself) is the effect's dependency
  // on purpose - `assignment` gets a fresh object reference on every load()/
  // refresh() even when nothing about it changed, which would otherwise
  // restart tracking (and re-check permission) on every pull-to-refresh.
  // startGpsTracking/stopGpsTracking are both idempotent, so re-running this
  // on an AppState change is harmless even when nothing actually needs to
  // change.
  const hasAssignmentToday = assignment !== null;
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (hasAssignmentToday && AppState.currentState === 'active') {
        const status = await startGpsTracking((fix) => void handleGpsFix(fix));
        if (!cancelled) setGpsEnabled(status === 'granted');
      } else {
        stopGpsTracking();
        if (!cancelled) setGpsEnabled(false);
      }
    }

    void sync();
    const subscription = AppState.addEventListener('change', () => void sync());
    return () => {
      cancelled = true;
      subscription.remove();
      stopGpsTracking();
    };
  }, [hasAssignmentToday, handleGpsFix]);

  useEffect(() => {
    if (!banner) return;
    const ms = banner.kind === 'error' ? ERROR_BANNER_MS : SUCCESS_BANNER_MS;
    const t = setTimeout(() => setBanner(null), ms);
    return () => clearTimeout(t);
  }, [banner]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    await trySync();
  }, [load, trySync]);

  const logout = useCallback(async () => {
    await clearTokens();
    onLoggedOut();
  }, [onLoggedOut]);

  const recordPayment = useCallback(
    async (amountRaw: string, methodRaw: string): Promise<boolean> => {
      const value = Number(amountRaw);
      if (!amountRaw || Number.isNaN(value) || value <= 0) {
        showBanner('Enter a positive amount.', 'error');
        return false;
      }
      if (!assignment) return false;

      setSubmitting(true);
      try {
        await apiFetch('/payments', {
          method: 'POST',
          body: JSON.stringify({
            dailyAssignmentId: assignment.id,
            driverId: assignment.driverId,
            amount: value,
            ...(methodRaw.trim() ? { paymentMethod: methodRaw.trim() } : {}),
          }),
        });
        showBanner('Payment recorded.', 'success');
        await load();
        return true;
      } catch (err) {
        if (err instanceof NetworkError) {
          await enqueuePayment({
            clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            dailyAssignmentId: assignment.id,
            driverId: assignment.driverId,
            amount: value,
            paymentMethod: methodRaw.trim() || undefined,
            queuedAt: new Date().toISOString(),
          });
          showBanner(
            'No connection - payment saved on this phone and will sync automatically.',
            'success',
          );
          await refreshQueueCount();
          return true;
        } else if (err instanceof ApiError) {
          showBanner(`Could not record payment: ${err.message}`, 'error');
        } else {
          showBanner('Something went wrong. Please try again.', 'error');
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [assignment, load, refreshQueueCount, showBanner],
  );

  const uploadReceipt = useCallback(
    async (paymentId: string) => {
      try {
        if (Platform.OS !== 'web') {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            showBanner('Allow photo access to attach a receipt.', 'error');
            return;
          }
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
        });
        if (result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];

        const form = new FormData();
        const name = asset.fileName ?? `receipt-${Date.now()}.jpg`;
        if (Platform.OS === 'web') {
          const blob = await (await fetch(asset.uri)).blob();
          form.append('file', blob, name);
        } else {
          form.append('file', {
            uri: asset.uri,
            name,
            type: asset.mimeType ?? 'image/jpeg',
          } as unknown as Blob);
        }

        setUploadingId(paymentId);
        await apiFetch(`/payments/${paymentId}/receipt`, { method: 'POST', body: form });
        showBanner('Receipt uploaded.', 'success');
        await load();
      } catch (err) {
        if (err instanceof NetworkError) {
          showBanner('Cannot upload the receipt while offline. Try again when connected.', 'error');
        } else if (err instanceof ApiError) {
          showBanner(`Upload failed: ${err.message}`, 'error');
        } else {
          showBanner('Could not upload the receipt. Please try again.', 'error');
        }
      } finally {
        setUploadingId(null);
      }
    },
    [load, showBanner],
  );

  const value = useMemo<DriverData>(
    () => ({
      me,
      assignment,
      noAssignment,
      plan,
      payments,
      queueCount,
      gpsEnabled,
      gpsLastSentAt,
      offline,
      loading,
      refreshing,
      banner,
      showBanner,
      submitting,
      uploadingId,
      refresh,
      trySync,
      recordPayment,
      uploadReceipt,
      logout,
    }),
    [
      me,
      assignment,
      noAssignment,
      plan,
      payments,
      queueCount,
      gpsEnabled,
      gpsLastSentAt,
      offline,
      loading,
      refreshing,
      banner,
      showBanner,
      submitting,
      uploadingId,
      refresh,
      trySync,
      recordPayment,
      uploadReceipt,
      logout,
    ],
  );

  return <DriverDataContext.Provider value={value}>{children}</DriverDataContext.Provider>;
}
