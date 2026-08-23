import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { apiFetch, ApiError, NetworkError } from '../api';
import {
  enqueueExpense,
  flushExpenseQueue,
  flushPendingReceipts,
  retryPendingReceipt,
} from '../expenseQueue';
import { getExpenseQueue, getPendingReceipts } from '../storage';
import { formatTZS, todayKey } from '../format';
import type { PendingReceiptUpload, RiderExpense } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

type Props = BottomTabScreenProps<RiderTabParamList, 'Matumizi'>;

// Stage H4 (DESIGN_RIDER_EXPENSES.md §6) - a fixed picker, not the free-text
// category CreateExpenseDto allows on the dashboard side. The design
// specifies this exact list for the driver's own form.
const CATEGORIES = ['Fuel', 'Repairs', 'Spare parts', 'Puncture', 'Wash', 'Parking', 'Other'];

const STATUS_STYLES: Record<RiderExpense['status'], object> = {
  PENDING: { color: '#b45309' },
  APPROVED: { color: '#15803d' },
  REJECTED: { color: '#b91c1c' },
};

interface PickedPhoto {
  uri: string;
  mimeType: string;
  name: string;
}

/**
 * Stage H4. Hidden route, same as Lipa/Mkataba - reached via "Add expense"
 * on Leo, not a fifth visible tab (DM1's rider tab bar is fixed to
 * Leo/Malipo/Pikipiki/Mimi per that stage's own task spec). Self-contained
 * (its own local fetch/state), not folded into DriverDataContext - same
 * precedent Pikipiki/Malipo yangu/Mkataba wangu already set in Stage DM2:
 * only cross-screen-critical data (today's balance) lives in the shared
 * context. showBanner is the one piece pulled from there, so this screen
 * uses the same notice-banner pattern as everywhere else rather than
 * inventing its own.
 *
 * The offline path is two-phase, per the design's own note that the photo
 * is the awkward part: a network failure at submission time queues the
 * text fields only (expenseQueue.ts), carrying the photo's local file URI
 * as a passenger, never the image bytes. Once that expense syncs and the
 * server hands back a real id, the receipt is uploaded separately - and if
 * THAT specific step fails, the row shows "Receipt pending upload" (from
 * the persisted pending-receipts list, not React state, so it survives the
 * app being closed and reopened) with a tap-to-retry that reuses the same
 * local file, no re-picking needed.
 */
export function MatumiziScreen({ navigation }: Props) {
  const { showBanner } = useDriverData();

  const [expenses, setExpenses] = useState<RiderExpense[]>([]);
  const [pendingReceipts, setPendingReceiptsState] = useState<PendingReceiptUpload[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState(todayKey());
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<RiderExpense[]>('/expenses/mine');
      setExpenses(data);
    } catch (err) {
      if (!(err instanceof NetworkError)) {
        setError('Could not load your expenses. Please try again.');
      }
    }
  }, []);

  const refreshLocalQueueState = useCallback(async () => {
    const [queue, pending] = await Promise.all([getExpenseQueue(), getPendingReceipts()]);
    setQueueCount(queue.length);
    setPendingReceiptsState(pending);
  }, []);

  const syncOffline = useCallback(async () => {
    const queueResult = await flushExpenseQueue();
    if (queueResult.sent > 0) {
      showBanner(`${queueResult.sent} queued expense(s) synced.`, 'success');
    }
    if (queueResult.rejected.length > 0) {
      showBanner(
        'Some queued expenses were rejected:\n' +
          queueResult.rejected.map((r) => `${r.item.category}: ${r.reason}`).join('\n'),
        'error',
      );
    }

    const receiptResult = await flushPendingReceipts();
    if (receiptResult.uploaded > 0) {
      showBanner(`${receiptResult.uploaded} receipt(s) uploaded.`, 'success');
    }
    if (receiptResult.rejected.length > 0) {
      showBanner(
        'Some receipts could not be attached:\n' +
          receiptResult.rejected.map((r) => r.reason).join('\n'),
        'error',
      );
    }

    await refreshLocalQueueState();
    if (queueResult.sent > 0) {
      await loadList();
    }
  }, [loadList, refreshLocalQueueState, showBanner]);

  const load = useCallback(async () => {
    await loadList();
    await refreshLocalQueueState();
    setLoading(false);
    setRefreshing(false);
  }, [loadList, refreshLocalQueueState]);

  useEffect(() => {
    void load().then(() => syncOffline());
    // Mount-only, matching DriverDataContext's own load-then-sync pattern.
    // eslint-disable-next-line
  }, []);

  function resetForm() {
    setCategory('');
    setAmount('');
    setIncurredAt(todayKey());
    setDescription('');
    setPhoto(null);
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showBanner('Allow photo access to attach a receipt.', 'error');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? `receipt-${Date.now()}.jpg`,
    });
  }

  async function handleSubmit() {
    if (!category) {
      showBanner('Choose a category.', 'error');
      return;
    }
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      showBanner('Enter a positive amount.', 'error');
      return;
    }
    if (!incurredAt) {
      showBanner('Choose a date.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiFetch<RiderExpense>('/expenses/submissions', {
        method: 'POST',
        body: JSON.stringify({
          category,
          amount: value,
          incurredAt,
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      showBanner('Expense recorded.', 'success');
      resetForm();
      await loadList();

      if (photo) {
        const outcome = await retryPendingReceipt({
          expenseId: created.id,
          photoUri: photo.uri,
          photoMimeType: photo.mimeType,
          photoName: photo.name,
        });
        if (outcome.status === 'network') {
          showBanner(
            'No connection - the receipt will upload automatically once you are back online.',
            'success',
          );
        } else if (outcome.status === 'rejected') {
          showBanner(`Receipt could not be attached: ${outcome.reason}`, 'error');
        }
        await refreshLocalQueueState();
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        await enqueueExpense({
          clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          category,
          amount: value,
          incurredAt,
          description: description.trim() || undefined,
          photoUri: photo?.uri,
          photoMimeType: photo?.mimeType,
          photoName: photo?.name,
          queuedAt: new Date().toISOString(),
        });
        showBanner(
          'No connection - expense saved on this phone and will sync automatically.',
          'success',
        );
        resetForm();
        await refreshLocalQueueState();
      } else if (err instanceof ApiError) {
        // Not cleared - e.g. "You had no assignment on that date." is worth
        // fixing and resubmitting without retyping everything.
        showBanner(err.message, 'error');
      } else {
        showBanner('Something went wrong. Please try again.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryReceipt(item: PendingReceiptUpload) {
    setRetryingId(item.expenseId);
    try {
      const outcome = await retryPendingReceipt(item);
      if (outcome.status === 'uploaded') {
        showBanner('Receipt uploaded.', 'success');
      } else if (outcome.status === 'rejected') {
        showBanner(`Receipt could not be attached: ${outcome.reason}`, 'error');
      } else {
        showBanner('Still no connection - will try again automatically.', 'error');
      }
      await refreshLocalQueueState();
    } finally {
      setRetryingId(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  const pendingReceiptByExpenseId = new Map(pendingReceipts.map((p) => [p.expenseId, p]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('Leo')}>
          <Text style={styles.back}>{'‹ Leo'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Matumizi</Text>
        <View style={styles.headerSpacer} />
      </View>

      <StatusBanners />

      {queueCount > 0 && (
        <TouchableOpacity style={styles.queueBanner} onPress={() => void syncOffline()}>
          <Text style={styles.queueBannerText}>
            {queueCount} expense(s) queued - tap to sync now
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={expenses}
        keyExtractor={(e) => e.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().then(() => syncOffline());
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.card}>
              <Text style={styles.formLabel}>Record an expense</Text>

              <View style={styles.categoryRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCategory(c)}
                    style={[styles.categoryChip, category === c && styles.categoryChipSelected]}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        category === c && styles.categoryChipTextSelected,
                      ]}
                    >
                      {c}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.input}
                placeholder="Amount (TZS)"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <TextInput
                style={styles.input}
                placeholder="Date (YYYY-MM-DD)"
                value={incurredAt}
                onChangeText={setIncurredAt}
              />
              <TextInput
                style={styles.input}
                placeholder="Note (optional)"
                value={description}
                onChangeText={setDescription}
              />

              <TouchableOpacity style={styles.photoButton} onPress={() => void handlePickPhoto()}>
                <Text style={styles.photoButtonText}>
                  {photo ? 'Change receipt photo' : 'Add receipt photo (optional)'}
                </Text>
              </TouchableOpacity>
              {photo && <Text style={styles.photoName}>{photo.name}</Text>}

              <TouchableOpacity
                style={styles.button}
                onPress={() => void handleSubmit()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Save expense</Text>
                )}
              </TouchableOpacity>
            </View>

            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Matumizi yangu</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No expenses yet.</Text>}
        renderItem={({ item }) => {
          const pending = pendingReceiptByExpenseId.get(item.id);
          return (
            <View style={styles.expenseRow}>
              <View style={styles.expenseInfo}>
                <Text style={styles.expenseCategory}>{item.category}</Text>
                <Text style={styles.expenseMeta}>{item.incurredAt.slice(0, 10)}</Text>
                {item.description && (
                  <Text style={styles.expenseDescription}>{item.description}</Text>
                )}
                {item.status === 'REJECTED' && item.rejectionReason && (
                  <Text style={styles.rejectionReason}>Reason: {item.rejectionReason}</Text>
                )}
                {pending ? (
                  <TouchableOpacity
                    onPress={() => void handleRetryReceipt(pending)}
                    disabled={retryingId === item.id}
                  >
                    <Text style={styles.receiptPending}>
                      {retryingId === item.id
                        ? 'Uploading…'
                        : 'Receipt pending upload - tap to retry'}
                    </Text>
                  </TouchableOpacity>
                ) : item.receiptUploadedAt ? (
                  <Text style={styles.receiptAttached}>✓ Receipt attached</Text>
                ) : null}
              </View>
              <View style={styles.expenseRight}>
                <Text style={styles.expenseAmount}>{formatTZS(item.amount)}</Text>
                <Text style={[styles.status, STATUS_STYLES[item.status]]}>{item.status}</Text>
              </View>
            </View>
          );
        }}
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
  back: { color: '#93c5fd', fontSize: 15, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSpacer: { width: 44 },
  queueBanner: {
    backgroundColor: '#fef3c7',
    paddingVertical: 8,
    alignItems: 'center',
  },
  queueBannerText: { color: '#92400e', fontSize: 13, fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  formLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  categoryChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChipSelected: { backgroundColor: '#111827', borderColor: '#111827' },
  categoryChipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  categoryChipTextSelected: { color: '#fff' },
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
  photoButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 4,
  },
  photoButtonText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  photoName: { fontSize: 12, color: '#6b7280', marginBottom: 10, textAlign: 'center' },
  button: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  expenseRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  expenseInfo: { flex: 1, paddingRight: 8 },
  expenseCategory: { fontSize: 15, fontWeight: '600', color: '#111827' },
  expenseMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  expenseDescription: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  rejectionReason: { fontSize: 12, color: '#b91c1c', marginTop: 6 },
  receiptAttached: { fontSize: 12, color: '#15803d', fontWeight: '600', marginTop: 6 },
  receiptPending: { fontSize: 12, color: '#b45309', fontWeight: '600', marginTop: 6 },
  expenseRight: { alignItems: 'flex-end' },
  expenseAmount: { fontSize: 15, fontWeight: '600', color: '#111827' },
  status: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  empty: { color: '#6b7280', fontSize: 14, marginTop: 8 },
});
