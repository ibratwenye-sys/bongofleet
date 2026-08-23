import { useCallback, useEffect, useState } from 'react';
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
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatTZS } from '../format';
import type { Assignment, DriverType, Payment } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

// Stage DM3 - deliberately NOT built here, not approximated either:
// - On-time rate / days-behind needs the same daysBehind/
//   consecutiveMissedDays logic the dashboard uses, and there is no
//   RIDER-facing endpoint exposing it yet. That's a real backend gap, not
//   something to guess at client-side - a wrong number on a screen a
//   driver reads about their own standing is worse than no number.
// - Licence/insurance expiry: Driver has licenseNumber only, no expiry
//   date field anywhere in the schema. Nothing to read.
// Both stay explicitly deferred rather than invented.

function monthsSince(dateStr: string): number {
  const start = new Date(dateStr);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

type Props = BottomTabScreenProps<RiderTabParamList, 'Mimi'>;

export function MimiScreen({ navigation }: Props) {
  const { me, logout } = useDriverData();
  const category = me?.driverType ? CATEGORY_LABELS[me.driverType] : 'Rider';

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plain, uncached reads - same pattern as Pikipiki/Malipo yangu (Stage
  // DM2), not folded into DriverDataContext: this data isn't shared with
  // any other screen.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [assignmentList, paymentList] = await Promise.all([
        apiFetch<Assignment[]>('/assignments'),
        apiFetch<Payment[]>('/payments'),
      ]);
      setAssignments(assignmentList);
      setPayments(paymentList);
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

  // Earliest assignedDate is the proxy for when the rider joined - no
  // "joined" field exists, or is needed, elsewhere.
  const earliestAssignedDate = assignments.reduce<string | null>(
    (earliest, a) => (earliest === null || a.assignedDate < earliest ? a.assignedDate : earliest),
    null,
  );
  const monthsOnFleet = earliestAssignedDate ? monthsSince(earliestAssignedDate) : null;

  // Same "paid" convention as Leo/Lipa: everything but FAILED counts,
  // matching the rest of the app rather than inventing a stricter rule
  // just for this stat.
  const lifetimePaid = payments
    .filter((p) => p.status !== 'FAILED')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      <Text style={styles.name}>{me ? `${me.firstName} ${me.lastName}` : ''}</Text>
      <Text style={styles.category}>{category}</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Months on fleet</Text>
          <Text style={styles.statValue}>{monthsOnFleet !== null ? monthsOnFleet : '—'}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Lifetime paid</Text>
          <Text style={styles.statValue}>{formatTZS(lifetimePaid)}</Text>
        </View>
      </View>

      {/* Stage DM2 - Mkataba wangu isn't a tab of its own (see
          RiderTabNavigator); Mimi is its natural home. */}
      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Mkataba')}>
        <Text style={styles.linkText}>Mkataba wangu</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={() => void logout()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  content: { alignItems: 'center', padding: 16, paddingTop: 72, paddingBottom: 40 },
  name: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  category: { fontSize: 14, color: '#6b7280' },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  statsRow: {
    flexDirection: 'row',
    marginTop: 24,
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
  },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 12, color: '#6b7280' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 4 },
  link: { marginTop: 24 },
  linkText: { fontSize: 15, color: '#2563eb', fontWeight: '600' },
  signOutButton: { marginTop: 32 },
  signOutText: { fontSize: 15, color: '#dc2626', fontWeight: '600' },
});
