import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatRelativeDaySwahili, formatTZS } from '../format';
import { Icon } from '../components/Icon';
import { colors, dayBarNeutral, gradients, radii, spacing, typography } from '../theme';
import { CATEGORY_LABELS } from './MimiScreen';
import type { DriverTabParamList } from '../navigation/DriverTabNavigator';
import type { Motorcycle, TransportJob, TransportJobDetail } from '../types';

type Props = BottomTabScreenProps<DriverTabParamList, 'Today'>;

/**
 * Stage DM13 - rebuilt against the mockup's screen 7 ("Truck driver -
 * Today"). GET /transport-jobs finds the caller's current job (the first
 * IN_TRANSIT one, if any); when found, GET /transport-jobs/:id fetches its
 * full detail (progress, driverFee, fuelSpent, lastSpeedKmh - all new this
 * stage). Origin/destination are shown exactly as the backend stores them
 * (e.g. "DAR ES SALAAM"), not shortened to the mockup's "Dar" - that
 * shortening is mockup shorthand, not real data, and inventing a truncation
 * rule would be fabricating presentation the data doesn't support.
 *
 * Deliberately NOT built (decision 1 in this stage's task spec): the
 * confirm button does not call PATCH .../status itself - it navigates to
 * SafariDetail, same as every job row elsewhere in this app. Real
 * completion (photo + signature proof) is a later stage. No "Kufika HH:MM"
 * ETA anywhere either - transport-progress.ts computes no such thing, and
 * TransportJob.scheduledDate has no time-of-day to build one from.
 */
export function TodayScreen({ navigation }: Props) {
  const { me, showBanner } = useDriverData();
  const [jobs, setJobs] = useState<TransportJob[]>([]);
  const [currentJob, setCurrentJob] = useState<TransportJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await apiFetch<TransportJob[]>('/transport-jobs');
      setJobs(list);
      const inTransit = list.find((j) => j.status === 'IN_TRANSIT');
      setCurrentJob(
        inTransit ? await apiFetch<TransportJobDetail>(`/transport-jobs/${inTransit.id}`) : null,
      );
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notAvailable = () => showBanner('Not available yet.', 'success');

  const scheduledJobs = jobs
    .filter((j) => j.status === 'SCHEDULED')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  // Only used as the hero when there's no IN_TRANSIT job at all.
  const heroUpcomingJob = currentJob ? null : (scheduledJobs[0] ?? null);
  const upcomingList = heroUpcomingJob
    ? scheduledJobs.filter((j) => j.id !== heroUpcomingJob.id)
    : scheduledJobs;

  const vehicle: Motorcycle | null =
    currentJob?.motorcycle ?? heroUpcomingJob?.motorcycle ?? jobs[0]?.motorcycle ?? null;
  const initials = me ? `${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase() : '';
  const subline = [
    vehicle?.registrationNumber,
    me?.driverType ? CATEGORY_LABELS[me.driverType] : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.greet}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View>
          <Text style={styles.greeting}>Habari, {me?.firstName ?? ''}</Text>
          {subline.length > 0 && <Text style={styles.subline}>{subline}</Text>}
        </View>
      </View>

      <StatusBanners />

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

        {currentJob && (
          <>
            <LinearGradient
              colors={gradients.tripHero.colors}
              start={gradients.tripHero.start}
              end={gradients.tripHero.end}
              style={[styles.heroCard, styles.tripHeroBorder]}
            >
              <View style={styles.chead}>
                <Text style={styles.ctitle}>Safari ya leo</Text>
                <View style={[styles.pill, { backgroundColor: colors.blueSoft }]}>
                  <Text style={[styles.pillText, { color: colors.blue }]}>Njiani</Text>
                </View>
              </View>
              <Text style={styles.route}>
                {currentJob.origin} → {currentJob.destination}
              </Text>
              <Text style={styles.refLine}>
                {[currentJob.reference, currentJob.cargo].filter(Boolean).join(' · ')}
              </Text>
              {currentJob.progress.kind === 'progress' && (
                <>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.trackFill,
                        {
                          width: `${Math.min(100, Math.round((currentJob.progress.kmCovered / currentJob.progress.expectedDistanceKm) * 100))}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.trackLabel}>
                    km {Math.round(currentJob.progress.kmCovered)} kati ya{' '}
                    {Math.round(currentJob.progress.expectedDistanceKm)}
                  </Text>
                </>
              )}
            </LinearGradient>

            <View style={styles.strip}>
              <View style={styles.stripStat}>
                <Text style={styles.stripLabel}>Malipo yako</Text>
                <Text style={[styles.stripValue, { color: colors.green }]}>
                  {currentJob.driverFee !== null ? formatTZS(currentJob.driverFee) : '—'}
                </Text>
              </View>
              <View style={styles.stripStat}>
                <Text style={styles.stripLabel}>Mafuta</Text>
                <Text style={styles.stripValue}>{formatTZS(currentJob.fuelSpent)}</Text>
              </View>
              <View style={styles.stripStat}>
                <Text style={styles.stripLabel}>Kasi</Text>
                <Text style={styles.stripValue}>
                  {currentJob.progress.lastSpeedKmh !== null
                    ? `${Math.round(currentJob.progress.lastSpeedKmh)} km/h`
                    : '—'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={() => navigation.navigate('SafariDetail', { jobId: currentJob.id })}
            >
              <Icon name="check" size={19} color="#fff" />
              <Text style={styles.confirmButtonText}>Thibitisha kufika · Confirm delivery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.altButton} onPress={notAvailable}>
              <Text style={styles.altButtonText}>Ripoti tatizo njiani</Text>
            </TouchableOpacity>
          </>
        )}

        {!currentJob && heroUpcomingJob && (
          // "Ijayo" (upcoming) variant - no design for this state in the
          // mockup (screen 7 only shows the in-transit case), so this is a
          // judgment call: a plain (non-gradient) card, amber pill instead
          // of blue - amber already reads as "pending/not yet" everywhere
          // else in this app (document expiry, PENDING expenses, a partial
          // payment day) - visually distinct from Njiani's blue-gradient
          // treatment, using only existing tokens. No progress bar, stat
          // strip, or action buttons - there's nothing to confirm or report
          // on a trip that hasn't started.
          <View style={[styles.heroCard, styles.plainHeroBorder]}>
            <View style={styles.chead}>
              <Text style={styles.ctitle}>Safari ijayo</Text>
              <View style={[styles.pill, { backgroundColor: colors.amberSoft }]}>
                <Text style={[styles.pillText, { color: colors.amber }]}>Ijayo</Text>
              </View>
            </View>
            <Text style={styles.route}>
              {heroUpcomingJob.origin} → {heroUpcomingJob.destination}
            </Text>
            <Text style={styles.refLine}>
              {[
                formatRelativeDaySwahili(heroUpcomingJob.scheduledDate),
                heroUpcomingJob.reference,
                heroUpcomingJob.cargo,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        )}

        {!currentJob && !heroUpcomingJob && (
          <View style={[styles.heroCard, styles.plainHeroBorder, styles.emptyHero]}>
            <Text style={styles.emptyHeroText}>Hakuna safari leo · No trip today</Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.chead}>
            <Text style={styles.ctitle}>Safari zijazo</Text>
            <Text style={styles.csub}>{upcomingList.length}</Text>
          </View>
          {upcomingList.length === 0 && (
            <Text style={styles.emptyUpcoming}>Hakuna safari nyingine iliyopangwa.</Text>
          )}
          {upcomingList.map((job, index) => {
            const highlighted = index === 0;
            const meta = [formatRelativeDaySwahili(job.scheduledDate), job.cargo ?? 'tupu'].join(
              ' · ',
            );
            return (
              <View
                key={job.id}
                style={[styles.row, index === upcomingList.length - 1 && styles.rowNoBorder]}
              >
                <View
                  style={[
                    styles.rowAvatar,
                    { backgroundColor: highlighted ? colors.blueSoft : colors.card2 },
                  ]}
                >
                  <Icon name="truck" size={18} color={highlighted ? colors.blue : colors.txt2} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowName}>
                    {job.origin} → {job.destination}
                  </Text>
                  <Text style={styles.rowMeta}>{meta}</Text>
                </View>
                {job.driverFee !== null && (
                  <View style={styles.rowValueWrap}>
                    <Text style={styles.rowValue}>{formatTZS(job.driverFee)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  greet: {
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Flat colors.card2 avatar, not the mockup's own gradient - same
  // simplification DM7/DM11 already made for Leo's/Mimi's avatars.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.card2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.txt2, fontSize: 16, fontWeight: '800' },
  greeting: {
    fontSize: typography.greeting.fontSize,
    fontWeight: typography.greeting.fontWeight as TextStyle['fontWeight'],
    color: colors.txt,
    letterSpacing: -0.4,
  },
  subline: { fontSize: 12.5, color: colors.txt3, marginTop: 2 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  heroCard: { borderRadius: radii.card, padding: 16, marginBottom: spacing.lg },
  tripHeroBorder: { borderWidth: 1, borderColor: 'rgba(59,130,246,.3)' },
  plainHeroBorder: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  emptyHero: { alignItems: 'center', paddingVertical: 22 },
  emptyHeroText: { color: colors.txt3, fontSize: 13 },
  chead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 13 },
  ctitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    color: colors.txt,
  },
  csub: {
    marginLeft: 'auto',
    fontSize: typography.label.fontSize,
    fontWeight: typography.label.fontWeight as TextStyle['fontWeight'],
    color: colors.txt3,
  },
  pill: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.pill },
  pillText: { fontSize: 10.5, fontWeight: '750' as TextStyle['fontWeight'] },
  route: {
    fontSize: 19,
    fontWeight: '800' as TextStyle['fontWeight'],
    letterSpacing: -0.4,
    color: colors.txt,
    marginBottom: 5,
  },
  refLine: { fontSize: 12, color: colors.txt3 },
  track: {
    height: 8,
    borderRadius: 5,
    backgroundColor: dayBarNeutral,
    overflow: 'hidden',
    marginTop: 15,
  },
  trackFill: { height: '100%', borderRadius: 5, backgroundColor: colors.blue },
  trackLabel: { fontSize: 11.5, color: colors.txt3, marginTop: 9 },
  strip: { flexDirection: 'row', gap: 9, marginBottom: 13 },
  stripStat: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  stripLabel: { color: colors.txt3, fontSize: 10.5, fontWeight: '650' as TextStyle['fontWeight'] },
  stripValue: {
    color: colors.txt,
    fontSize: typography.statValue.fontSize,
    fontWeight: typography.statValue.fontWeight as TextStyle['fontWeight'],
    marginTop: 5,
  },
  confirmButton: {
    backgroundColor: colors.blue,
    borderRadius: radii.card,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginBottom: 9,
  },
  confirmButtonText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  altButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  altButtonText: { color: colors.txt, fontSize: 14.5, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
  },
  emptyUpcoming: { color: colors.txt3, fontSize: 12.5, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  rowNoBorder: { borderBottomWidth: 0, paddingBottom: 0 },
  rowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 13.5, fontWeight: '700' as TextStyle['fontWeight'], color: colors.txt },
  rowMeta: { fontSize: 11.5, color: colors.txt3, marginTop: 2 },
  rowValueWrap: { marginLeft: 'auto' },
  rowValue: {
    fontSize: 13.5,
    fontWeight: '750' as TextStyle['fontWeight'],
    color: colors.txt,
  },
});
