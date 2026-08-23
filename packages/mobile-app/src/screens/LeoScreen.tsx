import { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { openPlanContract } from '../contract';
import { ApiError, NetworkError } from '../api';
import { formatDateHuman, formatTZS, todayKey } from '../format';
import type { OwnershipPlan } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

type Props = BottomTabScreenProps<RiderTabParamList, 'Leo'>;

/**
 * Stage G2 (DESIGN_HIRE_PURCHASE.md §8 "Driver app"). "Today's instalment"
 * deliberately reuses the SAME target/paidToday Leo already computes for
 * every driver (assignment.targetAmount, not plan.dailyAmount) - the
 * generator caps a plan day's target at whatever remains of totalOwed
 * (ownership-plan-generator.service.ts), so the final instalment of a plan
 * is smaller than dailyAmount and dailyAmount would be the wrong number on
 * that day. daysBehind/daysAhead/netPosition/nextDueDate are read as the
 * backend returns them, never recomputed here - that day-counting
 * arithmetic has a documented history of being easy to get wrong.
 */
function PlanCard({
  plan,
  target,
  paidToday,
}: {
  plan: OwnershipPlan;
  target: number;
  paidToday: number;
}) {
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  const remaining = Math.max(0, target - paidToday);
  const totalPrice = parseFloat(plan.totalPrice);
  const amountPaid = parseFloat(plan.amountPaid);
  const progress = totalPrice > 0 ? Math.min(1, Math.max(0, amountPaid / totalPrice)) : 0;
  const endDate = plan.contractEndDate ?? plan.derivedEndDate;

  async function handleViewContract() {
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

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Mkataba wangu</Text>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Today's instalment</Text>
          <Text style={styles.statValue}>{formatTZS(target)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Paid</Text>
          <Text style={[styles.statValue, { color: '#15803d' }]}>{formatTZS(paidToday)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Remaining</Text>
          <Text
            style={[styles.statValue, remaining > 0 ? { color: '#b91c1c' } : { color: '#15803d' }]}
          >
            {formatTZS(remaining)}
          </Text>
        </View>
      </View>

      {plan.daysBehind > 0 ? (
        <Text style={styles.positionBehind}>
          You are {plan.daysBehind} day{plan.daysBehind === 1 ? '' : 's'} behind —{' '}
          {formatTZS(Math.abs(parseFloat(plan.netPosition)))} owed
        </Text>
      ) : plan.daysAhead > 0 ? (
        <Text style={styles.positionAhead}>
          You are {plan.daysAhead} day{plan.daysAhead === 1 ? '' : 's'} ahead — nothing due until{' '}
          {plan.nextDueDate ? formatDateHuman(plan.nextDueDate) : 'further notice'}
        </Text>
      ) : null}

      <View style={styles.progressSection}>
        <Text style={styles.contractLine}>
          Started {formatDateHuman(plan.startDate)} · ends {formatDateHuman(endDate)} ·{' '}
          {plan.daysLeft} days left
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          {formatTZS(plan.amountPaid)} of {formatTZS(plan.totalPrice)} paid
        </Text>
      </View>

      {contractError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{contractError}</Text>
        </View>
      )}
      <TouchableOpacity
        style={styles.contractButton}
        onPress={() => void handleViewContract()}
        disabled={contractLoading}
      >
        {contractLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>View contract</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Stage DM1 - the balance-display half of the old monolithic HomeScreen,
 *  reusing the same today's-assignment lookup (via DriverDataContext) as-is.
 *  The payment form itself now lives on Lipa, reached from the Pay button
 *  below. */
export function LeoScreen({ navigation }: Props) {
  const { me, assignment, noAssignment, plan, payments, loading, refreshing, refresh, logout } =
    useDriverData();

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  const todaysPayments = assignment
    ? payments.filter((p) => p.dailyAssignmentId === assignment.id && p.status !== 'FAILED')
    : [];
  const paidToday = todaysPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const target = assignment ? parseFloat(assignment.targetAmount) : 0;
  const remaining = Math.max(0, target - paidToday);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Habari{me ? `, ${me.firstName}` : ''}!</Text>
          <Text style={styles.date}>{todayKey()}</Text>
        </View>
        <TouchableOpacity onPress={() => void logout()}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>

      <StatusBanners />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {plan && <PlanCard plan={plan} target={target} paidToday={paidToday} />}

        {assignment ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Today's assignment</Text>
            <Text style={styles.bike}>
              {assignment.motorcycle?.registrationNumber ?? 'Motorcycle'}
            </Text>
            {assignment.reference && (
              <View style={styles.rideBox}>
                <Text style={styles.rideLabel}>Ride number</Text>
                <Text style={styles.rideNumber}>{assignment.reference}</Text>
                <Text style={styles.rideHint}>
                  Quote this when you deposit, so your payment is matched to this ride.
                </Text>
              </View>
            )}
            <View style={styles.row}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Target</Text>
                <Text style={styles.statValue}>{formatTZS(target)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Paid</Text>
                <Text style={[styles.statValue, { color: '#15803d' }]}>{formatTZS(paidToday)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Remaining</Text>
                <Text
                  style={[
                    styles.statValue,
                    remaining > 0 ? { color: '#b91c1c' } : { color: '#15803d' },
                  ]}
                >
                  {formatTZS(remaining)}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Lipa')}>
              <Text style={styles.buttonText}>Pay</Text>
            </TouchableOpacity>
          </View>
        ) : noAssignment ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Today's assignment</Text>
            <Text style={styles.empty}>No assignment for today yet.</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.addExpenseButton}
          onPress={() => navigation.navigate('Matumizi')}
        >
          <Text style={styles.addExpenseButtonText}>Add expense</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#111827',
  },
  greeting: { color: '#fff', fontSize: 20, fontWeight: '700' },
  date: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  logout: { color: '#fca5a5', fontSize: 14, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6 },
  bike: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 12 },
  rideBox: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  rideLabel: { fontSize: 11, fontWeight: '600', color: '#1e40af', textTransform: 'uppercase' },
  rideNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e3a8a',
    letterSpacing: 1,
    marginTop: 2,
  },
  rideHint: { fontSize: 12, color: '#3b82f6', marginTop: 4 },
  row: { flexDirection: 'row', marginBottom: 16 },
  stat: { flex: 1 },
  statLabel: { fontSize: 12, color: '#6b7280' },
  statValue: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 2 },
  button: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { color: '#6b7280', fontSize: 14 },
  positionBehind: {
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  positionAhead: {
    color: '#15803d',
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  // The design calls this the single most prominent thing on the card -
  // biggest text, most vertical room of anything here.
  progressSection: { marginBottom: 16 },
  contractLine: { fontSize: 13, color: '#374151', marginBottom: 8 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#111827', borderRadius: 5 },
  progressLabel: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 8 },
  contractButton: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  // Stage H4 - reached from here, not a fifth tab; see RiderTabNavigator's
  // own comment. Outlined rather than filled dark: this button sits below
  // the card(s) it belongs to, and a second solid-dark button right under
  // Pay/the plan's "View contract" would compete with them for attention.
  addExpenseButton: {
    borderWidth: 1,
    borderColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addExpenseButtonText: { color: '#111827', fontSize: 15, fontWeight: '600' },
});
