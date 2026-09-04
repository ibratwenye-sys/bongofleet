import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatDateSwahiliShort, formatTZS, formatTimeHuman } from '../format';
import { Icon } from '../components/Icon';
import { colors, radii, spacing, typography } from '../theme';
import type { TransportJobDetail, TransportJobExpense } from '../types';
import type { DriverTabParamList } from '../navigation/DriverTabNavigator';

function Row({
  label,
  value,
  valueColor,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

/** "Mbeya Kilimo Ltd" -> "MK" - first letters of the first two words, or
 *  the first two letters of a single-word name. Company/organisation
 *  names, unlike a driver's firstName/lastName, don't come as separate
 *  fields to take single initials from. */
function initialsFromCompanyName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '').slice(0, 2).toUpperCase();
}

type ScheduleStep = {
  key: string;
  title: string;
  subtitle?: string;
  done: boolean;
  /** Muted dot outline for a step that isn't next up and isn't done - only
   *  meaningful for Kupakia/Kufikisha; every Mafuta step is always done. */
  isNext: boolean;
};

/**
 * Built from real data only - no fabricated checkpoint or ETA anywhere.
 * The mockup's "Kituo cha ukaguzi" (inspection checkpoint) step has no
 * backing data model at all, so it's left out entirely rather than
 * approximated. Kupakia/Kufikisha use the job's own pickedUpAt/deliveredAt
 * timestamps (real time-of-day); the Mafuta step(s) use each expense's
 * incurredAt, which is a date-only column - formatted as a date
 * (formatDateSwahiliShort), never a fabricated time like the mockup's own
 * "14:20" example.
 */
function buildScheduleSteps(job: TransportJobDetail): ScheduleStep[] {
  const pickedUp = job.pickedUpAt !== null;
  const delivered = job.deliveredAt !== null;

  const kupakia: ScheduleStep = {
    key: 'kupakia',
    title: `Kupakia — ${job.origin}`,
    subtitle: pickedUp
      ? [formatTimeHuman(job.pickedUpAt as string), job.cargo].filter(Boolean).join(' · ')
      : (job.cargo ?? undefined),
    done: pickedUp,
    isNext: !pickedUp,
  };

  const fuelSteps: ScheduleStep[] = [...job.expenses]
    .filter((e) => e.category === 'Fuel')
    .sort((a, b) => a.incurredAt.localeCompare(b.incurredAt))
    .map((e: TransportJobExpense) => ({
      key: `fuel-${e.id}`,
      title: 'Mafuta',
      subtitle: `${formatDateSwahiliShort(e.incurredAt)} · ${formatTZS(e.amount)}`,
      done: true,
      isNext: false,
    }));

  const kufikisha: ScheduleStep = {
    key: 'kufikisha',
    title: `Kufikisha — ${job.destination}`,
    subtitle: delivered ? formatTimeHuman(job.deliveredAt as string) : 'Bado',
    done: delivered,
    // Only the nearest not-done milestone reads as "next" (green outline);
    // Kufikisha can't be next until Kupakia is done, same "single nearest
    // milestone" rule Mkataba wangu's own step list already follows.
    isNext: !delivered && pickedUp,
  };

  return [kupakia, ...fuelSteps, kufikisha];
}

type Props = BottomTabScreenProps<DriverTabParamList, 'SafariDetail'>;

/**
 * Stage DM14 - rebuilt against the mockup's screen 8 ("Job detail"). GET
 * /transport-jobs/:id 404s (not 403) for a RIDER on another driver's job
 * (TransportService.getJob) - not re-implemented client-side.
 * revenue/netProfit are never in this response for a RIDER caller (see
 * types.ts's TransportJobDetail) - there is no field to hide here, the
 * server already omits both. The mockup's "Malipo" card also shows "Bei ya
 * safari" (revenue) and an advance-payment row - neither is rendered here:
 * revenue is owner-only by design (DM12), and no partial-advance-payment
 * concept exists on the backend to render honestly.
 */
export function SafariJobDetailScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const [job, setJob] = useState<TransportJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await apiFetch<TransportJobDetail>(`/transport-jobs/${jobId}`);
      setJob(detail);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Cannot reach the server. Check your connection.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const title = job ? (job.reference ?? `${job.origin} → ${job.destination}`) : '';
  const scheduleSteps = job ? buildScheduleSteps(job) : [];

  return (
    <View style={styles.container}>
      <View style={styles.appbar}>
        {/* Icon-only back button, same label-less convention every other
            DM6-DM13 appbar back button already uses - it always returns to
            the 'Safari' route, relabeled "Jobs" in the tab bar by DM13. */}
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Safari')}>
          <Icon name="back" size={17} color={colors.txt2} />
        </TouchableOpacity>
        <Text style={styles.appbarTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.green}
          />
        }
      >
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {job && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ratiba ya safari</Text>
              {scheduleSteps.map((step, index) => {
                const last = index === scheduleSteps.length - 1;
                return (
                  <View key={step.key} style={[styles.step, last && styles.stepLast]}>
                    <View style={styles.stepIndicator}>
                      <View
                        style={[
                          styles.stepDot,
                          step.done && styles.stepDotDone,
                          !step.done && step.isNext && styles.stepDotNext,
                        ]}
                      />
                      {!last && <View style={styles.stepLine} />}
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={[styles.stepTitle, !step.done && styles.stepTitleMuted]}>
                        {step.title}
                      </Text>
                      {step.subtitle && <Text style={styles.stepSub}>{step.subtitle}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>

            {job.customerName && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Mteja</Text>
                <View style={styles.customerRow}>
                  <View style={styles.customerAvatar}>
                    <Text style={styles.customerAvatarText}>
                      {initialsFromCompanyName(job.customerName)}
                    </Text>
                  </View>
                  <View style={styles.customerBody}>
                    <Text style={styles.rowName}>{job.customerName}</Text>
                    {job.customerContactPhone && (
                      <Text style={styles.rowMeta}>{job.customerContactPhone}</Text>
                    )}
                  </View>
                  {job.customerContactPhone && (
                    <TouchableOpacity
                      style={styles.callButton}
                      onPress={() => {
                        void Linking.openURL(`tel:${job.customerContactPhone}`);
                      }}
                    >
                      <Icon name="phone" size={17} color={colors.green} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Malipo</Text>
              <Row
                label="Ujira wako"
                value={job.driverFee !== null ? formatTZS(job.driverFee) : 'Not on file'}
                valueColor={job.driverFee !== null ? colors.green : undefined}
                last
              />
            </View>

            <Text style={styles.sectionTitle}>Gari</Text>
            <View style={styles.card}>
              <Text style={styles.plate}>{job.motorcycle.registrationNumber}</Text>
              <Row label="Make" value={job.motorcycle.make ?? 'Not on file'} />
              <Row label="Model" value={job.motorcycle.model ?? 'Not on file'} />
              <Row
                label="Year"
                value={job.motorcycle.year ? String(job.motorcycle.year) : 'Not on file'}
              />
              <Row label="Colour" value={job.motorcycle.colour ?? 'Not on file'} last />
            </View>

            {job.expenses.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Matumizi ya safari</Text>
                <View style={styles.card}>
                  {job.expenses.map((e, index) => (
                    <Row
                      key={e.id}
                      label={`${e.category} · ${e.incurredAt.slice(0, 10)}`}
                      value={formatTZS(e.amount)}
                      last={index === job.expenses.length - 1}
                    />
                  ))}
                </View>
              </>
            )}

            {job.status === 'IN_TRANSIT' && (
              // Stage DM15 - exact button styling/icon reused from
              // TodayScreen.tsx's own confirmButton/confirmButtonText.
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={() => navigation.navigate('SafariProofOfDelivery', { jobId: job.id })}
              >
                <Icon name="check" size={19} color="#fff" />
                <Text style={styles.confirmButtonText}>Thibitisha kufika · Confirm delivery</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarTitle: {
    flex: 1,
    color: colors.txt,
    fontSize: 17.5,
    fontWeight: '750' as TextStyle['fontWeight'],
    letterSpacing: -0.4,
  },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  plate: { color: colors.txt, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  sectionTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  // Trip-schedule timeline - dot/line treatment ported from Mkataba
  // wangu's own step list (same done/next/plain states, same CSS values as
  // the mockup's .js-d/.js-line), plus this screen's own muted-title
  // treatment for a not-yet-reached step, per screen 8's own inline style.
  step: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.lg },
  stepLast: { paddingBottom: 0 },
  stepIndicator: { alignItems: 'center', width: 13 },
  stepDot: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 3,
    borderColor: colors.txt3,
    backgroundColor: colors.bg,
  },
  stepDotNext: { borderColor: colors.green },
  stepDotDone: { backgroundColor: colors.green, borderColor: colors.green },
  stepLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 4 },
  stepBody: { flex: 1 },
  stepTitle: { color: colors.txt, fontSize: 13, fontWeight: '700' },
  stepTitleMuted: { color: colors.txt3 },
  stepSub: { color: colors.txt3, fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  customerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.card2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerAvatarText: { color: colors.txt2, fontSize: 13, fontWeight: '800' },
  customerBody: { flex: 1, minWidth: 0 },
  rowName: { color: colors.txt, fontSize: 13.5, fontWeight: '700' as TextStyle['fontWeight'] },
  rowMeta: { color: colors.txt3, fontSize: 11.5, marginTop: 2 },
  callButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  rowLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600' as TextStyle['fontWeight'],
    color: colors.txt2,
  },
  rowValue: { fontSize: 13.5, fontWeight: '750' as TextStyle['fontWeight'], color: colors.txt },
  // Stage DM15 - verbatim copy of TodayScreen.tsx's confirmButton/
  // confirmButtonText (same blue, same padding/radius/icon gap).
  confirmButton: {
    backgroundColor: colors.blue,
    borderRadius: radii.card,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: spacing.sm,
  },
  confirmButtonText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
