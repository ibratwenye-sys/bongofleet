import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, ApiError, NetworkError } from '../api';
import { clearTokens, getQueue } from '../storage';
import { enqueuePayment, flushQueue } from '../queue';
import type { Assignment, AssignmentDetail, Me, Payment } from '../types';

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTZS(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `TZS ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString()}`;
}

export function HomeScreen({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [noAssignment, setNoAssignment] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const refreshQueueCount = useCallback(async () => {
    setQueueCount((await getQueue()).length);
  }, []);

  const load = useCallback(async () => {
    try {
      const today = todayKey();
      const [meRes, assignments, paymentList] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        apiFetch<Assignment[]>(`/assignments?dateFrom=${today}&dateTo=${today}`),
        apiFetch<Payment[]>('/payments'),
      ]);
      setMe(meRes);
      setPayments(paymentList);
      setOffline(false);

      if (assignments.length > 0) {
        const detail = await apiFetch<AssignmentDetail>(`/assignments/${assignments[0].id}`);
        setAssignment(detail);
        setNoAssignment(false);
      } else {
        setAssignment(null);
        setNoAssignment(true);
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        setOffline(true); // keep whatever we already have on screen
      }
    } finally {
      await refreshQueueCount();
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshQueueCount]);

  const trySync = useCallback(async () => {
    const result = await flushQueue();
    if (result.sent > 0) {
      setBanner(`${result.sent} queued payment(s) synced.`);
      await load();
    }
    if (result.rejected.length > 0) {
      Alert.alert(
        'Some queued payments were rejected',
        result.rejected.map((r) => `${formatTZS(r.item.amount)}: ${r.reason}`).join('\n'),
      );
    }
    await refreshQueueCount();
  }, [load, refreshQueueCount]);

  useEffect(() => {
    void load().then(() => trySync());
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        setOffline(false);
        void trySync();
      } else {
        setOffline(true);
      }
    });
    return unsubscribe;
    // Intentionally run once on mount - load/trySync are stable enough here.
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  async function handleLogout() {
    await clearTokens();
    onLoggedOut();
  }

  async function handleRecord() {
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount.');
      return;
    }
    if (!assignment) return;

    setSubmitting(true);
    try {
      await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          dailyAssignmentId: assignment.id,
          driverId: assignment.driverId,
          amount: value,
          ...(method.trim() ? { paymentMethod: method.trim() } : {}),
        }),
      });
      setAmount('');
      setMethod('');
      setBanner('Payment recorded.');
      await load();
    } catch (err) {
      if (err instanceof NetworkError) {
        await enqueuePayment({
          clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dailyAssignmentId: assignment.id,
          driverId: assignment.driverId,
          amount: value,
          paymentMethod: method.trim() || undefined,
          queuedAt: new Date().toISOString(),
        });
        setAmount('');
        setMethod('');
        setBanner('No connection - payment saved on this phone and will sync automatically.');
        await refreshQueueCount();
      } else if (err instanceof ApiError) {
        Alert.alert('Could not record payment', err.message);
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadReceipt(paymentId: string) {
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Allow photo access to attach a receipt.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      const form = new FormData();
      const name = asset.fileName ?? `receipt-${Date.now()}.jpg`;
      if (Platform.OS === 'web') {
        const blob = await (await fetch(asset.uri)).blob();
        form.append('file', blob, name);
      } else {
        form.append('file', {
          uri: asset.uri,
          name,
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      }

      setUploadingId(paymentId);
      await apiFetch(`/payments/${paymentId}/receipt`, { method: 'POST', body: form });
      setBanner('Receipt uploaded.');
      await load();
    } catch (err) {
      if (err instanceof NetworkError) {
        Alert.alert(
          'No connection',
          'Cannot upload the receipt while offline. Try again when connected.',
        );
      } else if (err instanceof ApiError) {
        Alert.alert('Upload failed', err.message);
      } else {
        Alert.alert('Error', 'Could not upload the receipt. Please try again.');
      }
    } finally {
      setUploadingId(null);
    }
  }

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
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>

      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Offline{queueCount > 0 ? ` - ${queueCount} payment(s) waiting to sync` : ''}
          </Text>
        </View>
      )}
      {!offline && queueCount > 0 && (
        <TouchableOpacity style={styles.queueBanner} onPress={() => void trySync()}>
          <Text style={styles.queueText}>{queueCount} payment(s) queued - tap to sync now</Text>
        </TouchableOpacity>
      )}
      {banner && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{banner}</Text>
        </View>
      )}

      <FlatList
        data={payments.slice(0, 20)}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().then(() => trySync());
            }}
          />
        }
        ListHeaderComponent={
          <View>
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
                    <Text style={[styles.statValue, { color: '#15803d' }]}>
                      {formatTZS(paidToday)}
                    </Text>
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

                <Text style={styles.formLabel}>Record a payment</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Amount (TZS)"
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={setAmount}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Method (optional, e.g. M-Pesa, Cash)"
                  value={method}
                  onChangeText={setMethod}
                />
                <TouchableOpacity
                  style={styles.button}
                  onPress={handleRecord}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Record payment</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : noAssignment ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Today's assignment</Text>
                <Text style={styles.empty}>No assignment for today yet.</Text>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Recent payments</Text>
          </View>
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
              {item.receiptUploadedAt ? (
                <Text style={styles.receiptAttached}>✓ Receipt attached</Text>
              ) : uploadingId === item.id ? (
                <View style={styles.receiptUploading}>
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text style={styles.receiptUploadingText}>Uploading…</Text>
                </View>
              ) : (
                <TouchableOpacity onPress={() => void handleUploadReceipt(item.id)}>
                  <Text style={styles.uploadReceipt}>Upload receipt</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text
              style={[
                styles.status,
                item.status === 'COMPLETED'
                  ? styles.statusCompleted
                  : item.status === 'FAILED'
                    ? styles.statusFailed
                    : styles.statusPending,
              ]}
            >
              {item.status}
            </Text>
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
  offlineBanner: { backgroundColor: '#fef3c7', padding: 10 },
  offlineText: { color: '#92400e', textAlign: 'center', fontSize: 13 },
  queueBanner: { backgroundColor: '#dbeafe', padding: 10 },
  queueText: { color: '#1e40af', textAlign: 'center', fontSize: 13, fontWeight: '600' },
  successBanner: { backgroundColor: '#dcfce7', padding: 10 },
  successText: { color: '#166534', textAlign: 'center', fontSize: 13 },
  listContent: { padding: 16, paddingBottom: 40 },
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
  formLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
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
  receiptAttached: { fontSize: 12, color: '#15803d', fontWeight: '600', marginTop: 6 },
  uploadReceipt: { fontSize: 13, color: '#2563eb', fontWeight: '600', marginTop: 6 },
  receiptUploading: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  receiptUploadingText: { fontSize: 12, color: '#2563eb', marginLeft: 6 },
  status: { fontSize: 11, fontWeight: '700', overflow: 'hidden' },
  statusCompleted: { color: '#15803d' },
  statusPending: { color: '#b45309' },
  statusFailed: { color: '#b91c1c' },
  empty: { color: '#6b7280', fontSize: 14 },
});
