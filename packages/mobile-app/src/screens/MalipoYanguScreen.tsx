import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatTZS } from '../format';
import type { Payment } from '../types';

const STATUS_STYLES: Record<Payment['status'], object> = {
  COMPLETED: { color: '#15803d' },
  PENDING: { color: '#b45309' },
  FAILED: { color: '#b91c1c' },
};

/**
 * Stage DM2. GET /payments is already narrowed to the caller's own driverId
 * server-side for a RIDER (PaymentService.listPayments) - a plain,
 * uncached read, no new endpoint. This is a history view only; recording a
 * payment and uploading a receipt both stay on Lipa.
 */
export function MalipoYanguScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await apiFetch<Payment[]>('/payments');
      setPayments(list);
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
      <Text style={styles.title}>Malipo yangu</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>No payments yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.paymentRow}>
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentAmount}>{formatTZS(item.amount)}</Text>
              <Text style={styles.paymentMeta}>
                {item.createdAt.slice(0, 10)}
                {item.paymentMethod ? ` · ${item.paymentMethod}` : ''}
              </Text>
            </View>
            <Text style={[styles.status, STATUS_STYLES[item.status]]}>{item.status}</Text>
          </View>
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
  paymentRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentInfo: { flex: 1, paddingRight: 8 },
  paymentAmount: { fontSize: 16, fontWeight: '600', color: '#111827' },
  paymentMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  status: { fontSize: 11, fontWeight: '700' },
  empty: { color: '#6b7280', fontSize: 14, marginTop: 8 },
});
