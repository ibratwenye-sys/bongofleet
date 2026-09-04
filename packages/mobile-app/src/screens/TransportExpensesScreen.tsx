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
  type TextStyle,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { Icon } from '../components/Icon';
import { apiFetch, ApiError, NetworkError } from '../api';
import {
  enqueueJobExpense,
  flushJobExpenseQueue,
  flushPendingJobReceipts,
  retryPendingJobReceipt,
} from '../jobExpenseQueue';
import { getJobExpenseQueue, getPendingJobReceipts } from '../storage';
import { formatDateSwahiliShort, formatTZS, todayKey } from '../format';
import type { PendingReceiptUpload, RiderExpense, TransportJob } from '../types';
import { colors, radii, spacing, typography, payButtonText } from '../theme';

// Stage DM16 - own copy of MatumiziScreen.tsx's CATEGORIES/CATEGORY_LABELS,
// duplicated rather than imported, matching this codebase's existing
// per-screen-constant convention (e.g. Icon.tsx's own STROKE_WIDTH map).
const CATEGORIES = ['Fuel', 'Repairs', 'Spare parts', 'Puncture', 'Wash', 'Parking', 'Other'];

const CATEGORY_LABELS: Record<string, string> = {
  Fuel: 'Mafuta',
  Repairs: 'Matengenezo',
  'Spare parts': 'Vipuri',
  Puncture: 'Puncture',
  Wash: 'Wash',
  Parking: 'Parking',
  Other: 'Nyingine',
};

const STATUS_LABELS: Record<RiderExpense['status'], string> = {
  PENDING: 'Inasubiri',
  APPROVED: 'Imekubaliwa',
  REJECTED: 'Imekataliwa',
};

const STATUS_COLORS: Record<RiderExpense['status'], string> = {
  PENDING: colors.amber,
  APPROVED: colors.green,
  REJECTED: colors.red,
};

interface PickedPhoto {
  uri: string;
  mimeType: string;
  name: string;
}

/**
 * Stage DM16 - closes the last gap in truck/car-driver mode: the
 * "Matumizi"/Expenses tab, a ComingSoonScreen placeholder since DM4. No
 * mockup screen exists for this (the 9-screen mockup only covers rider mode
 * plus Today/Job detail/Proof of delivery for truck/car mode) - built to
 * match TodayScreen.tsx/SafariJobDetailScreen.tsx/ProofOfDeliveryScreen.tsx's
 * own visual language (theme.ts tokens, card/button styles, bilingual
 * Swahili-first phrasing) rather than against a design.
 *
 * A TRUCK_DRIVER/CAR_DRIVER never has a DailyAssignment (that's rental-
 * only), so POST /expenses/submissions (MatumiziScreen's own endpoint) is
 * permanently unreachable for them - this screen posts to the separate
 * POST /expenses/job-submissions instead, which resolves motorcycleId/
 * transportJobId from the caller's own current TransportJob server-side.
 *
 * Self-contained (own load, own offline queue via jobExpenseQueue.ts),
 * flushing on mount + pull-to-refresh only - not wired into
 * DriverDataContext's lifecycle, same "only cross-screen-critical data
 * lives in the shared context" rule MatumiziScreen.tsx already follows.
 * showBanner is the one piece pulled from there, same as MatumiziScreen.
 */
// No navigation/route param is read - this screen is a plain tab
// destination, unlike SafariJobDetailScreen/ProofOfDeliveryScreen which are
// pushed with a jobId - so, unlike those, it takes no props.
export function TransportExpensesScreen() {
  const { showBanner } = useDriverData();

  const [jobs, setJobs] = useState<TransportJob[]>([]);
  const [expenses, setExpenses] = useState<RiderExpense[]>([]);
  const [pendingReceipts, setPendingReceiptsState] = useState<PendingReceiptUpload[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadExpenses = useCallback(async () => {
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

  // Best-effort: a failure here only means the current-job card shows
  // nothing extra - loadExpenses' own error banner above is the one that
  // matters for this screen's main purpose (the ledger/form).
  const loadJobs = useCallback(async () => {
    try {
      const list = await apiFetch<TransportJob[]>('/transport-jobs');
      setJobs(list);
    } catch {
      // ignore - see comment above
    }
  }, []);

  const refreshLocalQueueState = useCallback(async () => {
    const [queue, pending] = await Promise.all([getJobExpenseQueue(), getPendingJobReceipts()]);
    setQueueCount(queue.length);
    setPendingReceiptsState(pending);
  }, []);

  const syncOffline = useCallback(async () => {
    const queueResult = await flushJobExpenseQueue();
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

    const receiptResult = await flushPendingJobReceipts();
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
      await loadExpenses();
    }
  }, [loadExpenses, refreshLocalQueueState, showBanner]);

  const load = useCallback(async () => {
    await Promise.all([loadJobs(), loadExpenses()]);
    await refreshLocalQueueState();
    setLoading(false);
    setRefreshing(false);
  }, [loadJobs, loadExpenses, refreshLocalQueueState]);

  useEffect(() => {
    void load().then(() => syncOffline());
    // Mount-only, matching MatumiziScreen.tsx's own load-then-sync pattern.
    // eslint-disable-next-line
  }, []);

  function resetForm() {
    setCategory('');
    setAmount('');
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

    // Captured now, at record time - never a fabricated backend-side "now"
    // that would silently postdate an offline-queued item to whenever it
    // happens to flush.
    const incurredAt = todayKey();

    setSubmitting(true);
    try {
      const created = await apiFetch<RiderExpense>('/expenses/job-submissions', {
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
      await loadExpenses();

      if (photo) {
        const outcome = await retryPendingJobReceipt({
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
        await enqueueJobExpense({
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
        // Not cleared - e.g. "You have no active or upcoming job right
        // now." is worth fixing (or just waiting out) and resubmitting
        // without retyping everything.
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
      const outcome = await retryPendingJobReceipt(item);
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
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const pendingReceiptByExpenseId = new Map(pendingReceipts.map((p) => [p.expenseId, p]));

  const currentJob = jobs.find((j) => j.status === 'IN_TRANSIT') ?? null;
  const scheduledJobs = jobs
    .filter((j) => j.status === 'SCHEDULED')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const upcomingJob = currentJob ? null : (scheduledJobs[0] ?? null);
  const activeJob = currentJob ?? upcomingJob;

  return (
    <View style={styles.container}>
      <View style={styles.appbar}>
        <Text style={styles.appbarTitle}>Matumizi · Expenses</Text>
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
            tintColor={colors.green}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.card}>
              <View style={styles.chead}>
                <Text style={styles.cardTitle}>Kazi ya sasa · Current job</Text>
                {activeJob && (
                  <View
                    style={[
                      styles.pill,
                      {
                        backgroundColor:
                          activeJob.status === 'IN_TRANSIT' ? colors.blueSoft : colors.amberSoft,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        { color: activeJob.status === 'IN_TRANSIT' ? colors.blue : colors.amber },
                      ]}
                    >
                      {activeJob.status === 'IN_TRANSIT' ? 'Njiani' : 'Ijayo'}
                    </Text>
                  </View>
                )}
              </View>
              {activeJob ? (
                <>
                  <Text style={styles.route}>
                    {activeJob.origin} → {activeJob.destination}
                  </Text>
                  {activeJob.reference && <Text style={styles.refLine}>{activeJob.reference}</Text>}
                </>
              ) : (
                <Text style={styles.emptyJobText}>
                  You have no active or upcoming job right now.
                </Text>
              )}
            </View>

            {activeJob && (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Aina · Type</Text>
                  <View style={styles.methodGrid}>
                    {CATEGORIES.map((c) => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setCategory(c)}
                        style={[styles.methodOpt, category === c && styles.methodOptOn]}
                      >
                        <View style={[styles.methodDot, category === c && styles.methodDotOn]} />
                        <Text style={[styles.methodText, category === c && styles.methodTextOn]}>
                          {CATEGORY_LABELS[c]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Kiasi · Amount</Text>
                  <TextInput
                    style={styles.amountInput}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.txt3}
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>

                <View style={styles.field}>
                  <TextInput
                    style={styles.plainInput}
                    placeholder="Note (optional)"
                    placeholderTextColor={colors.txt3}
                    value={description}
                    onChangeText={setDescription}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Risiti · Receipt</Text>
                  <TouchableOpacity
                    style={[styles.photoBox, photo && styles.photoBoxSelected]}
                    onPress={() => void handlePickPhoto()}
                  >
                    <Icon name="camera" size={26} color={photo ? colors.green : colors.txt3} />
                    {photo ? (
                      <>
                        <Text style={[styles.photoText, styles.photoTextSelected]}>
                          {photo.name}
                        </Text>
                        <Text style={styles.photoSubtextSelected}>Tap to change photo</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.photoText}>Chagua picha ya risiti</Text>
                        <Text style={styles.photoSubtext}>Choose a receipt photo</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={() => void handleSubmit()}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color={payButtonText} />
                  ) : (
                    <Text style={styles.submitButtonText}>Tuma dai · Submit claim</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Madai yako · Your claims</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No expenses yet.</Text>}
        renderItem={({ item }) => {
          const pending = pendingReceiptByExpenseId.get(item.id);
          return (
            <View style={styles.claimRow}>
              <View style={styles.claimInfo}>
                <Text style={styles.claimCategory}>{item.category}</Text>
                <Text style={styles.claimDate}>{formatDateSwahiliShort(item.incurredAt)}</Text>
                {item.description && (
                  <Text style={styles.claimDescription}>{item.description}</Text>
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
              <View style={styles.claimRight}>
                <Text style={styles.claimAmount}>{formatTZS(item.amount)}</Text>
                <Text style={[styles.claimStatus, { color: STATUS_COLORS[item.status] }]}>
                  {STATUS_LABELS[item.status]}
                </Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  appbarTitle: {
    flex: 1,
    color: colors.txt,
    fontSize: 17.5,
    fontWeight: '750' as TextStyle['fontWeight'],
    letterSpacing: -0.4,
  },
  queueBanner: {
    backgroundColor: colors.amberSoft,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  queueBannerText: { color: colors.amber, fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  chead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: spacing.sm },
  cardTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
  },
  pill: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.pill },
  pillText: { fontSize: 10.5, fontWeight: '750' as TextStyle['fontWeight'] },
  route: {
    fontSize: 16,
    fontWeight: '800' as TextStyle['fontWeight'],
    letterSpacing: -0.3,
    color: colors.txt,
    marginBottom: 3,
  },
  refLine: { fontSize: 12, color: colors.txt3 },
  emptyJobText: { color: colors.txt3, fontSize: 12.5 },
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    color: colors.txt3,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  methodOpt: {
    width: '48%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 13,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  methodOptOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  methodDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.txt3 },
  methodDotOn: { backgroundColor: colors.green },
  methodText: { color: colors.txt, fontSize: 12.5, fontWeight: '700' },
  methodTextOn: { color: colors.green },
  amountInput: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: 13,
    paddingVertical: 18,
    paddingHorizontal: 14,
    textAlign: 'center',
    color: colors.green,
    fontSize: 30,
    fontWeight: '800',
  },
  plainInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    padding: 14,
    color: colors.txt,
    fontSize: 14,
    fontWeight: '650' as TextStyle['fontWeight'],
  },
  photoBox: {
    backgroundColor: colors.card2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 14,
    padding: 26,
    alignItems: 'center',
  },
  photoBoxSelected: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  photoText: {
    color: colors.txt3,
    fontSize: 12,
    fontWeight: '650' as TextStyle['fontWeight'],
    marginTop: 9,
    textAlign: 'center',
  },
  photoTextSelected: { color: colors.green },
  photoSubtext: { color: colors.txt3, fontSize: 10.5, fontWeight: '500', marginTop: 2 },
  photoSubtextSelected: { color: colors.green, fontSize: 10.5, fontWeight: '500', marginTop: 2 },
  submitButton: {
    backgroundColor: colors.green,
    borderRadius: radii.cta,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  submitButtonText: { color: payButtonText, fontSize: 15, fontWeight: '800' },
  sectionTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  claimRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  claimInfo: { flex: 1, paddingRight: spacing.sm },
  claimCategory: { color: colors.txt, fontSize: 12.5, fontWeight: '700' },
  claimDate: { color: colors.txt3, fontSize: 11.5, marginTop: 2 },
  claimDescription: { color: colors.txt3, fontSize: 11.5, marginTop: 2 },
  rejectionReason: { color: colors.red, fontSize: 11.5, marginTop: 6 },
  receiptAttached: { color: colors.green, fontSize: 11.5, fontWeight: '600', marginTop: 6 },
  receiptPending: { color: colors.amber, fontSize: 11.5, fontWeight: '600', marginTop: 6 },
  claimRight: { alignItems: 'flex-end' },
  claimAmount: { color: colors.txt, fontSize: 13.5, fontWeight: '750' as TextStyle['fontWeight'] },
  claimStatus: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  empty: { color: colors.txt2, fontSize: 14, marginTop: spacing.sm },
});
