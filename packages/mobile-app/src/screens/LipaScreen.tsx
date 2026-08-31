import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextStyle,
  RefreshControl,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { Icon } from '../components/Icon';
import { formatTZS } from '../format';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';
import { colors, radii, spacing, typography, payButtonText } from '../theme';

type Props = BottomTabScreenProps<RiderTabParamList, 'Lipa'>;

type AmountPreset = 'remaining' | 'target' | 'other';
type Method = 'M-Pesa' | 'Airtel Money' | 'HaloPesa' | 'Mixx by Yas' | 'other' | null;

const METHOD_PRESETS: Exclude<Method, 'other' | null>[] = [
  'M-Pesa',
  'Airtel Money',
  'HaloPesa',
  'Mixx by Yas',
];

/**
 * Stage DM8 - rebuilt against the mockup's screen 2 ("Lipa - Pay") and the
 * DM6/DM7 dark theme. Two mockup elements deliberately NOT ported (see the
 * stage's own task notes): the "Namba yako"/"Kwenda kwa" info rows (no
 * RIDER-facing phone/tenant-name data exists) and the push-notification
 * footnote (there's no approval step - recordPayment is an immediate
 * self-report). recordPayment/uploadReceipt, the payment queue, and the
 * payment-history list's behaviour are all untouched.
 */
export function LipaScreen({ navigation }: Props) {
  const {
    assignment,
    plan,
    payments,
    submitting,
    uploadingId,
    recordPayment,
    uploadReceipt,
    loading,
    refreshing,
    refresh,
  } = useDriverData();

  const [preset, setPreset] = useState<AmountPreset>('remaining');
  const [customAmount, setCustomAmount] = useState('');
  const [method, setMethod] = useState<Method>(null);
  const [customMethod, setCustomMethod] = useState('');

  const todaysPayments = assignment
    ? payments.filter((p) => p.dailyAssignmentId === assignment.id && p.status !== 'FAILED')
    : [];
  const paidToday = todaysPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const target = assignment ? parseFloat(assignment.targetAmount) : 0;
  const remaining = Math.max(0, target - paidToday);
  const showTargetPreset = target !== remaining && target > 0;

  const resolvedAmount =
    preset === 'remaining' ? remaining : preset === 'target' ? target : Number(customAmount) || 0;
  const willClear = resolvedAmount >= remaining;
  const resultingRemaining = Math.max(0, remaining - resolvedAmount);

  async function handleRecord() {
    const amountStr = preset === 'other' ? customAmount : String(resolvedAmount);
    // Backend note (pre-existing, not introduced here): POST /payments'
    // paymentMethod is validated against a fixed 3-value enum (CASH/
    // MOBILE_MONEY/BANK_TRANSFER, create-payment.dto.ts), not free text -
    // despite the DB column's own doc comment calling it "free text,
    // unconstrained" and the old screen's placeholder suggesting "M-Pesa,
    // Cash" as example values. Neither would ever have actually been
    // accepted. The four mobile-money presets all map to the one enum
    // value that fits; "Nyingine" still submits raw text exactly as the
    // old free-text field did (same pre-existing risk of rejection for
    // anything that isn't literally one of the three enum strings).
    const methodStr = method === 'other' ? customMethod.trim() : method ? 'MOBILE_MONEY' : '';
    const cleared = await recordPayment(amountStr, methodStr);
    if (cleared) {
      setPreset('remaining');
      setCustomAmount('');
      setMethod(null);
      setCustomMethod('');
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.appbar}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Leo')}>
          <Icon name="back" size={17} color={colors.txt2} />
        </TouchableOpacity>
        <Text style={styles.appbarTitle}>Lipa · Pay</Text>
      </View>

      <StatusBanners />

      <FlatList
        data={payments.slice(0, 20)}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.green}
          />
        }
        ListHeaderComponent={
          <View>
            {assignment ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Kiasi · Amount</Text>
                  {preset === 'other' ? (
                    <TextInput
                      style={styles.amountInput}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.txt3}
                      value={customAmount}
                      onChangeText={setCustomAmount}
                    />
                  ) : (
                    <View style={styles.amountDisplay}>
                      <Text style={styles.amountDisplayText}>
                        {resolvedAmount.toLocaleString()} TZS
                      </Text>
                    </View>
                  )}
                  <View style={styles.chipsRow}>
                    <TouchableOpacity
                      style={[styles.chip, preset === 'remaining' && styles.chipOn]}
                      onPress={() => setPreset('remaining')}
                    >
                      <Text style={[styles.chipText, preset === 'remaining' && styles.chipTextOn]}>
                        {remaining.toLocaleString()}
                      </Text>
                      <Text style={[styles.chipSub, preset === 'remaining' && styles.chipTextOn]}>
                        deni lote
                      </Text>
                    </TouchableOpacity>
                    {showTargetPreset && (
                      <TouchableOpacity
                        style={[styles.chip, preset === 'target' && styles.chipOn]}
                        onPress={() => setPreset('target')}
                      >
                        <Text style={[styles.chipText, preset === 'target' && styles.chipTextOn]}>
                          {target.toLocaleString()}
                        </Text>
                        <Text style={[styles.chipSub, preset === 'target' && styles.chipTextOn]}>
                          lengo la leo
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.chip, preset === 'other' && styles.chipOn]}
                      onPress={() => setPreset('other')}
                    >
                      <Text style={[styles.chipText, preset === 'other' && styles.chipTextOn]}>
                        Nyingine
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {plan && <Text style={styles.hint}>Pay more to get ahead.</Text>}
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Njia · Method</Text>
                  <View style={styles.methodGrid}>
                    {METHOD_PRESETS.map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.methodOpt, method === m && styles.methodOptOn]}
                        onPress={() => setMethod(m)}
                      >
                        <View style={[styles.methodDot, method === m && styles.methodDotOn]} />
                        <Text style={[styles.methodText, method === m && styles.methodTextOn]}>
                          {m}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.methodOptWide, method === 'other' && styles.methodOptOn]}
                    onPress={() => setMethod('other')}
                  >
                    <View style={[styles.methodDot, method === 'other' && styles.methodDotOn]} />
                    <Text style={[styles.methodText, method === 'other' && styles.methodTextOn]}>
                      Nyingine
                    </Text>
                  </TouchableOpacity>
                  {method === 'other' && (
                    <TextInput
                      style={styles.customMethodInput}
                      placeholder="e.g. Bank transfer"
                      placeholderTextColor={colors.txt3}
                      value={customMethod}
                      onChangeText={setCustomMethod}
                    />
                  )}
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Baada ya malipo</Text>
                    {willClear ? (
                      <Text style={styles.infoValueGreen}>Umemaliza leo</Text>
                    ) : (
                      <Text style={styles.infoValue}>Itabaki {formatTZS(resultingRemaining)}</Text>
                    )}
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={() => void handleRecord()}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color={payButtonText} />
                  ) : (
                    <Text style={styles.confirmButtonText}>
                      Thibitisha · Confirm {resolvedAmount.toLocaleString()} TZS
                    </Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.footnote}>
                  Malipo yataandikwa mara moja · Recorded immediately
                </Text>
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.empty}>No assignment today - nothing to pay against yet.</Text>
              </View>
            )}

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
                  <ActivityIndicator size="small" color={colors.green} />
                  <Text style={styles.receiptUploadingText}>Uploading…</Text>
                </View>
              ) : (
                <TouchableOpacity onPress={() => void uploadReceipt(item.id)}>
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
  backButton: {
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
  amountDisplay: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: 13,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  amountDisplayText: {
    color: colors.green,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
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
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { color: colors.txt2, fontSize: 11.5, fontWeight: '700' },
  chipSub: { color: colors.txt2, fontSize: 9, fontWeight: '600', marginTop: 1 },
  chipTextOn: { color: payButtonText },
  hint: { color: colors.txt3, fontSize: 12, marginTop: spacing.sm },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
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
  methodOptWide: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 13,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  methodOptOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  methodDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.txt3 },
  methodDotOn: { backgroundColor: colors.green },
  methodText: { color: colors.txt, fontSize: 12.5, fontWeight: '700' },
  methodTextOn: { color: colors.green },
  customMethodInput: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.txt,
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: colors.card2,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { color: colors.txt3, fontSize: 12.5 },
  infoValue: { color: colors.txt, fontSize: 12.5, fontWeight: '750' as TextStyle['fontWeight'] },
  infoValueGreen: { color: colors.green, fontSize: 12.5, fontWeight: '800' },
  confirmButton: {
    backgroundColor: colors.green,
    borderRadius: radii.cta,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonText: { color: payButtonText, fontSize: 15, fontWeight: '800' },
  footnote: {
    color: colors.txt3,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  paymentRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentInfo: { flex: 1, paddingRight: spacing.sm },
  paymentAmount: { color: colors.txt, fontSize: 16, fontWeight: '700' },
  paymentMeta: { color: colors.txt3, fontSize: 12, marginTop: 2 },
  receiptAttached: { color: colors.green, fontSize: 12, fontWeight: '600', marginTop: 6 },
  uploadReceipt: { color: colors.blue, fontSize: 13, fontWeight: '600', marginTop: 6 },
  receiptUploading: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  receiptUploadingText: { color: colors.blue, fontSize: 12, marginLeft: 6 },
  status: { fontSize: 11, fontWeight: '700' },
  statusCompleted: { color: colors.green },
  statusPending: { color: colors.amber },
  statusFailed: { color: colors.red },
  empty: { color: colors.txt2, fontSize: 14 },
});
