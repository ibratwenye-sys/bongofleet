import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { formatTZS } from '../format';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

type Props = BottomTabScreenProps<RiderTabParamList, 'Lipa'>;

/** Stage DM1 - the payment-form half of the old monolithic HomeScreen
 *  (amount/method inputs, offline queueing, receipt upload, payment
 *  history), moved here unchanged and reached by tapping Pay on Leo. */
export function LipaScreen({ navigation }: Props) {
  const {
    assignment,
    payments,
    submitting,
    uploadingId,
    recordPayment,
    uploadReceipt,
    loading,
    refreshing,
    refresh,
  } = useDriverData();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');

  async function handleRecord() {
    const cleared = await recordPayment(amount, method);
    if (cleared) {
      setAmount('');
      setMethod('');
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('Leo')}>
          <Text style={styles.back}>{'‹ Leo'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Lipa</Text>
        <View style={styles.headerSpacer} />
      </View>

      <StatusBanners />

      <FlatList
        data={payments.slice(0, 20)}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          <View>
            {assignment ? (
              <View style={styles.card}>
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
                  onPress={() => void handleRecord()}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Record payment</Text>
                  )}
                </TouchableOpacity>
              </View>
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
                  <ActivityIndicator size="small" color="#2563eb" />
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
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
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
