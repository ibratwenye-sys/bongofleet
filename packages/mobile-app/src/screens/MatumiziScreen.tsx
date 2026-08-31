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
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { Icon } from '../components/Icon';
import { apiFetch, ApiError, NetworkError } from '../api';
import {
  enqueueExpense,
  flushExpenseQueue,
  flushPendingReceipts,
  retryPendingReceipt,
} from '../expenseQueue';
import { getExpenseQueue, getPendingReceipts } from '../storage';
import { formatDateSwahiliShort, formatTZS, todayKey } from '../format';
import type { PendingReceiptUpload, RiderExpense } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';
import { colors, radii, spacing, typography, payButtonText } from '../theme';

type Props = BottomTabScreenProps<RiderTabParamList, 'Matumizi'>;

// Stage H4 (DESIGN_RIDER_EXPENSES.md §6) - a fixed picker, not the free-text
// category CreateExpenseDto allows on the dashboard side. The design
// specifies this exact list for the driver's own form. Values sent to the
// backend are unchanged; CATEGORY_LABELS (Stage DM10) is purely the
// mockup's own Swahili display text layered on top.
const CATEGORIES = ['Fuel', 'Repairs', 'Spare parts', 'Puncture', 'Wash', 'Parking', 'Other'];

// Puncture/Wash/Parking keep their English label - no agreed Swahili term
// exists anywhere in the docs or mockup for these three, and the mockup's
// own claims-ledger example on this same screen labels an item plain
// "Puncture" with no Swahili gloss - same precedent DM7-DM9 followed for
// other undocumented gaps.
const CATEGORY_LABELS: Record<string, string> = {
  Fuel: 'Mafuta',
  Repairs: 'Matengenezo',
  'Spare parts': 'Vipuri',
  Puncture: 'Puncture',
  Wash: 'Wash',
  Parking: 'Parking',
  Other: 'Nyingine',
};

// Mockup only shows PENDING ("Inasubiri") and APPROVED ("Imekubaliwa") in
// its one example ledger. REJECTED's "Imekataliwa" is inferred to match
// the same single-Swahili-word convention, not sourced from the mockup.
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
 *
 * Stage DM10 - rebuilt against the mockup's screen 5 ("Matumizi mapya") and
 * the DM6-DM9 dark theme, reusing LipaScreen's field/amountInput/
 * methodGrid/infoCard patterns and MkatabaWanguScreen's ledger-row pattern
 * verbatim. All state, handlers, the offline queue, and receipt-retry
 * logic are unchanged - visual rebuild only.
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
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const pendingReceiptByExpenseId = new Map(pendingReceipts.map((p) => [p.expenseId, p]));

  return (
    <View style={styles.container}>
      <View style={styles.appbar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Leo')}>
          <Icon name="close" size={17} color={colors.txt2} />
        </TouchableOpacity>
        <Text style={styles.appbarTitle}>Matumizi mapya</Text>
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
              {/* LipaScreen's own amountInput (this exact reused style)
                  isn't actually TZS-suffixed either - only its
                  non-editable amountDisplay Text is. Matched to what's
                  really shipped there rather than inventing a suffix
                  mechanism a plain editable TextInput can't do cleanly. */}
              <TextInput
                style={styles.amountInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.txt3}
                value={amount}
                onChangeText={setAmount}
              />
            </View>

            {/* Flagged addition: the mockup has no date field, but
                incurredAt is real and required server-side. Styled as a
                plain .finput (background/border/radius only) rather than
                inventing a mockup treatment that doesn't exist. */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Tarehe · Date</Text>
              <TextInput
                style={styles.plainInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.txt3}
                value={incurredAt}
                onChangeText={setIncurredAt}
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
                    <Text style={[styles.photoText, styles.photoTextSelected]}>{photo.name}</Text>
                    {/* Not in the mockup (it never shows a photo-selected
                        state) - inferred to match the same green-selected
                        visual language already used for methodOptOn. */}
                    <Text style={styles.photoSubtextSelected}>Tap to change photo</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.photoText}>Piga picha ya risiti</Text>
                    <Text style={styles.photoSubtext}>Photograph the receipt</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                <Text style={styles.infoTextBold}>Inasubiri idhini.</Text> Mwenye meli lazima
                akubali kabla haijalipwa.
              </Text>
              <Text style={styles.infoTextMuted}>
                Pending approval — it does not touch the owner's profit until he approves it, and it
                does not reduce today's deposit.
              </Text>
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

            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Madai yako</Text>
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
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarTitle: {
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
  infoCard: {
    backgroundColor: colors.card2,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  infoText: { color: colors.txt2, fontSize: 11.5, lineHeight: 18 },
  infoTextBold: { color: colors.amber, fontWeight: '700' },
  infoTextMuted: { color: colors.txt3, fontSize: 11.5, lineHeight: 18 },
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
