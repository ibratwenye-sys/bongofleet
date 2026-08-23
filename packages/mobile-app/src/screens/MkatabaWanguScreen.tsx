import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { apiFetch, apiFetchBlob, ApiError, NetworkError } from '../api';
import { formatTZS } from '../format';
import type { Assignment, OwnershipPlan, OwnershipPlanLedgerEntry } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

type Props = BottomTabScreenProps<RiderTabParamList, 'Mkataba'>;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * Verified live against the web preview: Chrome refuses to navigate a new
 * tab to a data: URI at all (blocked outright, since ~Chrome 88, as a
 * security restriction on data: as a top-level navigation target) - a
 * data-URI-only approach silently opened a blank tab, not the contract.
 * blob: URLs are exempt from that restriction, so web gets one, kept alive
 * deliberately (never revoked) since the opened tab reads it asynchronously
 * and revoking on a timer would be a guess at how long that takes.
 *
 * React Native has no URL.createObjectURL, so native keeps the data: URI +
 * Linking.openURL path - not blocked there, and contracts are small enough
 * (a few KB - tens of KB of PDF) that the encoding overhead doesn't matter.
 * Untested on native (this app is only verified via the web preview per
 * this project's established method) - flagging that rather than claiming
 * a platform I have no way to check.
 */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the contract file'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * Stage DM2. There is no "my plan" endpoint - the rider's ownershipPlanId is
 * discovered off their own DailyAssignment rows (GET /assignments is
 * already RIDER-narrowed; ownershipPlanId is nullable, set per Stage D's
 * vehicle-lock rule). No non-null id anywhere in the rider's assignments
 * means a genuine daily-rental driver, not an error.
 *
 * GET /ownership-plans/:id and /:id/ledger both 404 a RIDER who isn't the
 * driver on that plan (OwnershipPlanService.assertCanView) - not
 * re-implemented client-side, per the task's own instruction. Since the id
 * used here was read off the caller's OWN assignment, that 404 path is
 * never actually exercised in normal use; it exists as backend
 * defense-in-depth, verified in ownership-plan.e2e-spec.ts.
 */
export function MkatabaWanguScreen({ navigation }: Props) {
  const [plan, setPlan] = useState<OwnershipPlan | null>(null);
  const [ledger, setLedger] = useState<OwnershipPlanLedgerEntry[]>([]);
  const [noPlan, setNoPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const assignments = await apiFetch<Assignment[]>('/assignments');
      const withPlan = assignments.find((a) => a.ownershipPlanId);
      if (!withPlan?.ownershipPlanId) {
        setPlan(null);
        setLedger([]);
        setNoPlan(true);
        return;
      }

      const [planRes, ledgerRes] = await Promise.all([
        apiFetch<OwnershipPlan>(`/ownership-plans/${withPlan.ownershipPlanId}`),
        apiFetch<OwnershipPlanLedgerEntry[]>(`/ownership-plans/${withPlan.ownershipPlanId}/ledger`),
      ]);
      setPlan(planRes);
      setLedger(ledgerRes);
      setNoPlan(false);
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

  async function handleViewContract() {
    if (!plan) return;
    setContractError(null);
    setContractLoading(true);
    try {
      const blob = await apiFetchBlob(`/ownership-plans/${plan.id}/contract`);
      if (Platform.OS === 'web') {
        // Intentionally never revoked - see the comment above blobToDataUri.
        await Linking.openURL(URL.createObjectURL(blob));
      } else {
        const dataUri = await blobToDataUri(blob);
        await Linking.openURL(dataUri);
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        setContractError('Cannot reach the server. Check your connection.');
      } else if (err instanceof ApiError) {
        setContractError(err.message);
      } else {
        setContractError('Could not open the contract. Please try again.');
      }
    } finally {
      setContractLoading(false);
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
    <FlatList
      style={styles.container}
      data={ledger}
      keyExtractor={(entry) => entry.assignedDate}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      ListHeaderComponent={
        <View>
          <TouchableOpacity onPress={() => navigation.navigate('Mimi')}>
            <Text style={styles.back}>{'‹ Mimi'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Mkataba wangu</Text>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {plan ? (
            <>
              <View style={styles.card}>
                <Row label="Daily amount" value={formatTZS(plan.dailyAmount)} />
                <Row label="Instalments" value={String(plan.instalmentCount)} />
                <Row label="Start date" value={plan.startDate.slice(0, 10)} />
                <Row label="Status" value={plan.status} />
                <Row label="Paid so far" value={formatTZS(plan.amountPaid)} />
                <Row label="Remaining to own" value={formatTZS(plan.remainingToOwn)} />
                <Row label="Days left" value={String(plan.daysLeft)} />
                <Row label="Projected completion" value={plan.projectedCompletion} />

                {contractError && (
                  <View style={[styles.errorBanner, { marginTop: 12, marginHorizontal: 0 }]}>
                    <Text style={styles.errorText}>{contractError}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => void handleViewContract()}
                  disabled={contractLoading}
                >
                  {contractLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>View contract</Text>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>Ledger</Text>
            </>
          ) : noPlan ? (
            <View style={styles.card}>
              <Text style={styles.empty}>
                No ownership plan on file - you're on a daily-rental assignment.
              </Text>
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.ledgerRow}>
          <Text style={styles.ledgerDate}>{item.assignedDate}</Text>
          <View style={styles.ledgerFigures}>
            <Text style={styles.ledgerOwed}>Owed {formatTZS(item.owed)}</Text>
            <Text style={styles.ledgerPaid}>Paid {formatTZS(item.paid)}</Text>
          </View>
          <Text
            style={[
              styles.ledgerPosition,
              parseFloat(item.runningPosition) < 0 ? { color: '#b91c1c' } : { color: '#15803d' },
            ]}
          >
            {formatTZS(item.runningPosition)}
          </Text>
        </View>
      )}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { justifyContent: 'center', alignItems: 'center' },
  back: { color: '#2563eb', fontSize: 15, fontWeight: '600', marginTop: 56 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginTop: 8, marginBottom: 16 },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
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
  button: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  ledgerRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ledgerDate: { fontSize: 13, color: '#374151', width: 90 },
  ledgerFigures: { flex: 1 },
  ledgerOwed: { fontSize: 12, color: '#6b7280' },
  ledgerPaid: { fontSize: 12, color: '#15803d', marginTop: 2 },
  ledgerPosition: { fontSize: 13, fontWeight: '700' },
  empty: { color: '#6b7280', fontSize: 14 },
});
