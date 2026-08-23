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
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatTZS } from '../format';
import type { TransportJobDetail } from '../types';
import type { DriverTabParamList } from '../navigation/DriverTabNavigator';

const STATUS_LABELS: Record<TransportJobDetail['status'], string> = {
  SCHEDULED: 'Scheduled',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

type Props = BottomTabScreenProps<DriverTabParamList, 'SafariDetail'>;

/**
 * Stage DM4. GET /transport-jobs/:id 404s (not 403) for a RIDER on another
 * driver's job (TransportService.getJob) - not re-implemented client-side.
 * revenue/netProfit are never in this response for a RIDER caller (see
 * types.ts's TransportJobDetail) - there is no field to hide here, the
 * server already omits both.
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
      <TouchableOpacity onPress={() => navigation.navigate('Safari')}>
        <Text style={styles.back}>{'‹ Safari zangu'}</Text>
      </TouchableOpacity>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {job && (
        <>
          <View style={styles.card}>
            <Text style={styles.route}>
              {job.origin} → {job.destination}
            </Text>
            <Text style={styles.statusBadge}>{STATUS_LABELS[job.status] ?? job.status}</Text>

            {job.reference && <Row label="Safari number" value={job.reference} />}
            <Row label="Scheduled" value={job.scheduledDate.slice(0, 10)} />
            {job.cargo && <Row label="Cargo" value={job.cargo} />}
            <Row
              label="Picked up"
              value={job.pickedUpAt ? job.pickedUpAt.slice(0, 10) : 'Not yet'}
            />
            <Row
              label="Delivered"
              value={job.deliveredAt ? job.deliveredAt.slice(0, 10) : 'Not yet'}
            />
            <Row label="Expenses" value={formatTZS(job.expensesTotal)} />
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
            <Row label="Colour" value={job.motorcycle.colour ?? 'Not on file'} />
          </View>

          {job.expenses.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Matumizi ya safari</Text>
              <View style={styles.card}>
                {job.expenses.map((e) => (
                  <Row
                    key={e.id}
                    label={`${e.category} · ${e.incurredAt.slice(0, 10)}`}
                    value={formatTZS(e.amount)}
                  />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingTop: 56, paddingBottom: 40 },
  back: { color: '#2563eb', fontSize: 15, fontWeight: '600', marginBottom: 16 },
  errorBanner: { backgroundColor: '#fee2e2', borderRadius: 8, padding: 10, marginBottom: 16 },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  route: { fontSize: 18, fontWeight: '700', color: '#111827' },
  plate: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginBottom: 16,
    fontSize: 12,
    fontWeight: '600',
    color: '#1e40af',
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowLabel: { fontSize: 13, color: '#6b7280' },
  rowValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
});
