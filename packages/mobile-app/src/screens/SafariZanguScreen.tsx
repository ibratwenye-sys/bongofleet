import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { apiFetch, ApiError, NetworkError } from '../api';
import type { TransportJob } from '../types';
import type { DriverTabParamList } from '../navigation/DriverTabNavigator';

const STATUS_LABELS: Record<TransportJob['status'], string> = {
  SCHEDULED: 'Scheduled',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const STATUS_STYLES: Record<TransportJob['status'], object> = {
  SCHEDULED: { color: '#1e40af' },
  IN_TRANSIT: { color: '#b45309' },
  DELIVERED: { color: '#15803d' },
  CANCELLED: { color: '#b91c1c' },
};

type Props = BottomTabScreenProps<DriverTabParamList, 'Safari'>;

/**
 * Stage DM4. GET /transport-jobs is RIDER-narrowed to the caller's own
 * driverId server-side (TransportService.listJobs) - a plain, uncached
 * read, same pattern as Malipo yangu. revenue/netProfit are never in this
 * response for a RIDER caller (see types.ts's TransportJob).
 */
export function SafariZanguScreen({ navigation }: Props) {
  const [jobs, setJobs] = useState<TransportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await apiFetch<TransportJob[]>('/transport-jobs');
      setJobs(list);
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

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Safari zangu</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>No safari yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.jobRow}
            onPress={() => navigation.navigate('SafariDetail', { jobId: item.id })}
          >
            <View style={styles.jobInfo}>
              <Text style={styles.route}>
                {item.origin} → {item.destination}
              </Text>
              <Text style={styles.meta}>{item.scheduledDate.slice(0, 10)}</Text>
            </View>
            <Text style={[styles.status, STATUS_STYLES[item.status]]}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginTop: 56, marginHorizontal: 16 },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  listContent: { padding: 16, paddingBottom: 40 },
  jobRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobInfo: { flex: 1, paddingRight: 8 },
  route: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  status: { fontSize: 11, fontWeight: '700' },
  empty: { color: '#6b7280', fontSize: 14, marginTop: 8 },
});
