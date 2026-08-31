import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { apiFetch, ApiError, NetworkError } from '../api';
import { openPlanContract } from '../contract';
import { formatDateHuman, formatTZS } from '../format';
import { Icon } from '../components/Icon';
import { colors, radii, spacing, typography, gradients, dayBarNeutral } from '../theme';
import type { Assignment, OwnershipPlan, OwnershipPlanLedgerEntry } from '../types';

// Stage DM4 - decoupled from RiderTabParamList for the same reason as
// MimiScreen: this screen is now hosted as a hidden route on both
// RiderTabNavigator and the new DriverTabNavigator. Stage DM9 keeps this
// loose typing and the 'Mimi' destination unchanged - DriverTabNavigator
// has no 'Leo' route at all, so retyping this to navigate there would
// break the truck-driver mode's use of the same screen.
interface Props {
  navigation: { navigate: (screen: 'Mimi') => void };
}

/**
 * Stage DM2. There is no "my plan" endpoint - the rider's ownershipPlanId is
 * discovered off their own DailyAssignment rows (GET /assignments is
 * already RIDER-narrowed; ownershipPlanId is nullable, set per Stage D's
 * vehicle-lock rule). No non-null id anywhere in the rider's assignments
 * means a genuine daily-rental driver, not an error.
 *
 * GET /ownership-plans/:id and /:id/ledger both 404 a RIDER who isn't the
 * driver on that plan (OwnershipPlanService.assertCanView) - not
 * re-implemented client-side, per the task's own instruction. Since the id
 * used here was read off the caller's OWN assignment, that 404 path is
 * never actually exercised in normal use; it exists as backend
 * defense-in-depth, verified in ownership-plan.e2e-spec.ts.
 *
 * Stage DM9 - rebuilt against the mockup's screen 4 ("Mkataba wangu") and
 * the DM6-DM8 dark theme. Data fetching, contract download, and the ledger
 * list's behaviour are all unchanged - visual rebuild only.
 */
export function MkatabaWanguScreen({ navigation }: Props) {
  const [plan, setPlan] = useState<OwnershipPlan | null>(null);
  const [ledger, setLedger] = useState<OwnershipPlanLedgerEntry[]>([]);
  const [noPlan, setNoPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const assignments = await apiFetch<Assignment[]>('/assignments');
      const withPlan = assignments.find((a) => a.ownershipPlanId);
      if (!withPlan?.ownershipPlanId) {
        setPlan(null);
        setLedger([]);
        setNoPlan(true);
        return;
      }

      const [planRes, ledgerRes] = await Promise.all([
        apiFetch<OwnershipPlan>(`/ownership-plans/${withPlan.ownershipPlanId}`),
        apiFetch<OwnershipPlanLedgerEntry[]>(`/ownership-plans/${withPlan.ownershipPlanId}/ledger`),
      ]);
      setPlan(planRes);
      setLedger(ledgerRes);
      setNoPlan(false);
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

  async function handleViewContract() {
    if (!plan) return;
    setContractError(null);
    setContractLoading(true);
    try {
      await openPlanContract(plan.id);
    } catch (err) {
      if (err instanceof NetworkError) {
        setContractError('Cannot reach the server. Check your connection.');
      } else if (err instanceof ApiError) {
        setContractError(err.message);
      } else {
        setContractError('Could not open the contract. Please try again.');
      }
    } finally {
      setContractLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const totalPrice = plan ? parseFloat(plan.totalPrice) : 0;
  const amountPaid = plan ? parseFloat(plan.amountPaid) : 0;
  const progress = totalPrice > 0 ? Math.min(1, Math.max(0, amountPaid / totalPrice)) : 0;
  const completed = plan?.status === 'COMPLETED';

  return (
    <FlatList
      style={styles.container}
      data={ledger}
      keyExtractor={(entry) => entry.assignedDate}
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
      ListHeaderComponent={
        <View>
          <View style={styles.appbar}>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Mimi')}>
              <Icon name="back" size={17} color={colors.txt2} />
            </TouchableOpacity>
            <Text style={styles.appbarTitle}>Mkataba wangu</Text>
            {plan && (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => void handleViewContract()}
                disabled={contractLoading}
              >
                {contractLoading ? (
                  <ActivityIndicator size="small" color={colors.txt2} />
                ) : (
                  <Icon name="contract" size={17} color={colors.txt2} />
                )}
              </TouchableOpacity>
            )}
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {contractError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{contractError}</Text>
            </View>
          )}

          {plan ? (
            <>
              <LinearGradient
                colors={gradients.planHero.colors}
                start={gradients.planHero.start}
                end={gradients.planHero.end}
                style={styles.heroCard}
              >
                <Text style={styles.heroLabel}>Zimebaki</Text>
                <Text style={styles.heroNumber}>{plan.daysLeft}</Text>
                <Text style={styles.heroUnit}>siku · days</Text>
                <View style={styles.track}>
                  <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={styles.heroFooterRow}>
                  <Text style={styles.heroFooterText}>Umelipa {formatTZS(plan.amountPaid)}</Text>
                  <Text style={styles.heroFooterText}>Bei {formatTZS(plan.totalPrice)}</Text>
                </View>
              </LinearGradient>

              <View style={styles.strip}>
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>Kila siku</Text>
                  <Text style={styles.stripValue}>{formatTZS(plan.dailyAmount)}</Text>
                </View>
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>Imebaki</Text>
                  <Text style={styles.stripValue}>{formatTZS(plan.remainingToOwn)}</Text>
                </View>
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>Umeanza</Text>
                  <Text style={styles.stripValue}>{formatDateHuman(plan.startDate)}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Itakapokamilika</Text>

                {/* Judgment call (task spec leaves the exact dot styling to
                    us): done = filled green; "next" = the single nearest
                    milestone, green outline, unfilled - only step 1 when
                    not completed; "plain" = every other not-done step,
                    muted gray outline. Step 2 never goes done - nothing in
                    the schema tracks document transfer. */}
                <View style={styles.step}>
                  <View style={styles.stepIndicator}>
                    <View
                      style={[styles.stepDot, completed ? styles.stepDotDone : styles.stepDotNext]}
                    />
                    <View style={styles.stepLine} />
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepTitle}>Malipo ya mwisho</Text>
                    <Text style={styles.stepSub}>{formatDateHuman(plan.projectedCompletion)}</Text>
                  </View>
                </View>

                <View style={styles.step}>
                  <View style={styles.stepIndicator}>
                    <View style={styles.stepDot} />
                    <View style={styles.stepLine} />
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepTitle}>Hati za umiliki</Text>
                    <Text style={styles.stepSub}>Ownership documents transferred to your name</Text>
                  </View>
                </View>

                <View style={[styles.step, styles.stepLast]}>
                  <View style={styles.stepIndicator}>
                    <View style={[styles.stepDot, completed && styles.stepDotDone]} />
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepTitle}>Pikipiki ni yako</Text>
                    <Text style={styles.stepSub}>
                      The motorcycle is yours. Tracking and service history stay in BongoFleet.
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.noteCard}>
                <Text style={styles.noteText}>
                  <Text style={styles.noteTextBold}>Ukilipa zaidi, unamaliza mapema.</Text> Kila
                  shilingi ya ziada inapunguza siku.
                </Text>
                <Text style={styles.noteTextMuted}>
                  Every extra shilling shortens the plan — you can never be billed more than the
                  price of the bike.
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Ledger</Text>
            </>
          ) : noPlan ? (
            <View style={styles.card}>
              <Text style={styles.empty}>
                No ownership plan on file - you're on a daily-rental assignment.
              </Text>
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.ledgerRow}>
          <Text style={styles.ledgerDate}>{item.assignedDate.slice(0, 10)}</Text>
          <View style={styles.ledgerFigures}>
            <Text style={styles.ledgerOwed}>Owed {formatTZS(item.owed)}</Text>
            <Text style={styles.ledgerPaid}>Paid {formatTZS(item.paid)}</Text>
          </View>
          <Text
            style={[
              styles.ledgerPosition,
              { color: parseFloat(item.runningPosition) < 0 ? colors.red : colors.green },
            ]}
          >
            {formatTZS(item.runningPosition)}
          </Text>
        </View>
      )}
      contentContainerStyle={styles.listContent}
    />
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
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  heroCard: {
    borderRadius: radii.card,
    padding: 16,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroLabel: { color: colors.txt2, fontSize: 11.5, fontWeight: '650' as TextStyle['fontWeight'] },
  heroNumber: {
    color: colors.green,
    fontSize: 46,
    fontWeight: '850' as TextStyle['fontWeight'],
    marginTop: 6,
    marginBottom: 2,
    letterSpacing: -0.8,
  },
  heroUnit: { color: colors.green, fontSize: 14, fontWeight: '700' },
  track: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: dayBarNeutral,
    overflow: 'hidden',
    marginTop: 16,
  },
  trackFill: { height: '100%', borderRadius: 5, backgroundColor: colors.green },
  heroFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 9,
  },
  heroFooterText: { color: colors.txt3, fontSize: 11.5 },
  strip: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  stripStat: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  stripLabel: { color: colors.txt3, fontSize: 10.5, fontWeight: '650' as TextStyle['fontWeight'] },
  stripValue: {
    color: colors.txt,
    fontSize: typography.statValue.fontSize,
    fontWeight: typography.statValue.fontWeight as TextStyle['fontWeight'],
    marginTop: 5,
  },
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
  stepSub: { color: colors.txt3, fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  noteCard: {
    backgroundColor: colors.card2,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  noteText: { color: colors.txt2, fontSize: 11.5, lineHeight: 18 },
  noteTextBold: { color: colors.txt, fontWeight: '700' },
  noteTextMuted: { color: colors.txt3, fontSize: 11.5, lineHeight: 18 },
  sectionTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  ledgerRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ledgerDate: { fontSize: 13, color: colors.txt2, width: 90 },
  ledgerFigures: { flex: 1 },
  ledgerOwed: { fontSize: 12, color: colors.txt3 },
  ledgerPaid: { fontSize: 12, color: colors.green, marginTop: 2 },
  ledgerPosition: { fontSize: 13, fontWeight: '700' },
  empty: { color: colors.txt2, fontSize: 14 },
});
