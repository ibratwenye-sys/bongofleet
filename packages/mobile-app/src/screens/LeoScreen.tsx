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
import { formatTZS, todayKey } from '../format';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

type Props = BottomTabScreenProps<RiderTabParamList, 'Leo'>;

/** Stage DM1 - the balance-display half of the old monolithic HomeScreen,
 *  reusing the same today's-assignment lookup (via DriverDataContext) as-is.
 *  The payment form itself now lives on Lipa, reached from the Pay button
 *  below. */
export function LeoScreen({ navigation }: Props) {
  const { me, assignment, noAssignment, payments, loading, refreshing, refresh, logout } =
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
});
