import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch, ApiError, NetworkError } from '../api';
import type { Assignment, AssignmentDetail } from '../types';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  MAINTENANCE: 'In maintenance',
  RETIRED: 'Retired',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * Stage DM2. Two calls, deliberately: GET /assignments (RIDER-narrowed,
 * sorted assignedDate desc server-side - the first row is the most recent)
 * to find which assignment is current, then GET /assignments/:id for the
 * full record with the motorcycle relation. The list endpoint's shape never
 * grows a motorcycle field for this - it's cached for OWNER/MANAGER
 * (TenantCacheService, Stage 2 of the security work) and widening a cached
 * shape here would be exactly the kind of change that needs to invalidate
 * correctly everywhere, for a field only this one rider-facing screen needs.
 */
export function PikipikiScreen() {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [noAssignment, setNoAssignment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const assignments = await apiFetch<Assignment[]>('/assignments');
      if (assignments.length === 0) {
        setDetail(null);
        setNoAssignment(true);
        return;
      }
      // Server-sorted assignedDate desc (assignment.service.ts) - the first
      // row is the most recent, not necessarily today's.
      const mostRecent = assignments[0];
      const full = await apiFetch<AssignmentDetail>(`/assignments/${mostRecent.id}`);
      setDetail(full);
      setNoAssignment(false);
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
      <Text style={styles.title}>Pikipiki</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {detail?.motorcycle ? (
        <View style={styles.card}>
          <Text style={styles.plate}>{detail.motorcycle.registrationNumber}</Text>
          <Text style={styles.statusBadge}>
            {STATUS_LABELS[detail.motorcycle.status] ?? detail.motorcycle.status}
          </Text>

          <Row label="Make" value={detail.motorcycle.make ?? 'Not on file'} />
          <Row label="Model" value={detail.motorcycle.model ?? 'Not on file'} />
          <Row
            label="Year"
            value={detail.motorcycle.year ? String(detail.motorcycle.year) : 'Not on file'}
          />
          <Row label="Chassis number" value={detail.motorcycle.chassisNumber ?? 'Not on file'} />
          <Row label="Colour" value={detail.motorcycle.colour ?? 'Not on file'} />

          <Text style={styles.sectionTitle}>Current assignment</Text>
          <Row label="Assigned" value={detail.assignedDate.slice(0, 10)} />
          {detail.reference && <Row label="Ride number" value={detail.reference} />}
        </View>
      ) : noAssignment ? (
        <View style={styles.card}>
          <Text style={styles.empty}>
            No assignment yet - your bike will show here once assigned.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingTop: 56, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  errorBanner: { backgroundColor: '#fee2e2', borderRadius: 8, padding: 10, marginBottom: 16 },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
  },
  plate: { fontSize: 24, fontWeight: '700', color: '#111827' },
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
    marginTop: 16,
    marginBottom: 4,
  },
  empty: { color: '#6b7280', fontSize: 14 },
});
