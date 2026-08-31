import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { apiFetch } from '../api';
import { formatTZS, todayKey } from '../format';
import type { Assignment } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';
import {
  colors,
  radii,
  spacing,
  typography,
  gradients,
  owedTile,
  payButtonText,
  dayBarNeutral,
} from '../theme';

type Props = BottomTabScreenProps<RiderTabParamList, 'Leo'>;

type DayStatus = 'ok' | 'part' | 'no' | 'none';

interface DayCell {
  key: string;
  label: string;
  status: DayStatus;
  paid: number;
  target: number;
}

// Mockup's own Mon-Sat abbreviations (Jtt/Jnn/Jtn/Alh/Ijm/Jmo), indexed by
// Date#getDay() (0=Sunday). The mockup never shows Sunday's own
// abbreviation - its one example's "today" happens to fall on Sunday, so
// that cell always reads "Leo" instead. "Jpl" (Jumapili) is inferred here
// from the same Jumatatu/Jumanne/... -> Jtt/Jnn/... truncation pattern the
// other six already follow, for the case where today ISN'T Sunday and a
// real Sunday cell needs its own label.
const WEEKDAY_ABBR = ['Jpl', 'Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jmo'] as const;

function localDateDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Stage DM7 - the "Wiki hii" week strip. There's no backend endpoint for a
 * week summary, so this classifies each of the last 7 calendar days
 * (today back 6 days, a rolling window - not necessarily Mon-Sun) from
 * plain GET /assignments + the payments DriverDataContext already holds,
 * matched by dailyAssignmentId the same way Leo already computes today's
 * own paidToday. Kept local to this file per the task spec - not shared
 * infrastructure yet.
 */
function buildWeek(
  weekAssignments: Assignment[],
  payments: { dailyAssignmentId: string; amount: string; status: string }[],
): DayCell[] {
  const days: DayCell[] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const d = localDateDaysAgo(daysAgo);
    const key = dateKeyOf(d);
    const label = daysAgo === 0 ? 'Leo' : WEEKDAY_ABBR[d.getDay()];
    const a = weekAssignments.find((x) => x.assignedDate.slice(0, 10) === key);
    if (!a) {
      days.push({ key, label, status: 'none', paid: 0, target: 0 });
      continue;
    }
    const target = parseFloat(a.targetAmount);
    const paid = payments
      .filter((p) => p.dailyAssignmentId === a.id && p.status !== 'FAILED')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const status: DayStatus = paid <= 0 ? 'no' : paid >= target ? 'ok' : 'part';
    days.push({ key, label, status, paid, target });
  }
  return days;
}

const DAY_BAR_COLOR: Record<DayStatus, string> = {
  ok: colors.green,
  part: colors.amber,
  no: colors.red,
  none: dayBarNeutral,
};

/** Stage DM1 - the balance-display half of the old monolithic HomeScreen.
 *  Stage DM7 - rebuilt against the mockup's screen 1 ("Leo - Today") and
 *  screen 3 ("Umemaliza" cleared state) and the DM6 dark theme. Data shape
 *  (DriverDataContext), StatusBanners, navigation, and the offline/queue
 *  logic are all untouched - this is a visual rebuild plus the one new
 *  piece of client-side logic the week strip needs (buildWeek above). */
export function LeoScreen({ navigation }: Props) {
  const { me, assignment, noAssignment, plan, payments, loading, refreshing, refresh, logout } =
    useDriverData();

  const [weekAssignments, setWeekAssignments] = useState<Assignment[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);

  const loadWeek = useCallback(async () => {
    try {
      const list = await apiFetch<Assignment[]>('/assignments');
      setWeekAssignments(list);
    } catch {
      // Silently leave the week card showing nothing new - StatusBanners
      // already surfaces "offline" for the screen as a whole; a second,
      // week-card-specific error banner isn't worth building for this.
    } finally {
      setWeekLoading(false);
    }
    // Re-run whenever payments changes (login, a new payment, pull-to-
    // refresh all flow through DriverDataContext's own load()) so today's
    // cell reflects a just-recorded payment without a second effect.
  }, []);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek, payments]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const todaysPayments = assignment
    ? payments.filter((p) => p.dailyAssignmentId === assignment.id && p.status !== 'FAILED')
    : [];
  const paidToday = todaysPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const target = assignment ? parseFloat(assignment.targetAmount) : 0;
  const remaining = Math.max(0, target - paidToday);
  const cleared = assignment !== null && remaining === 0;

  const initials = me ? `${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase() : '';
  const regLine = assignment?.motorcycle?.registrationNumber
    ? `${assignment.motorcycle.registrationNumber} · ${todayKey()}`
    : todayKey();

  const week = buildWeek(weekAssignments, payments);
  const fullCount = week.filter((d) => d.status === 'ok').length;
  const halfCount = week.filter((d) => d.status === 'part').length;
  const weekPaid = week.reduce((sum, d) => sum + d.paid, 0);
  const weekTarget = week.reduce((sum, d) => sum + d.target, 0);

  const motorcycle = assignment?.motorcycle ?? null;
  const bikeLine = motorcycle
    ? `${[motorcycle.make, motorcycle.model].filter(Boolean).join(' ') || 'Not on file'} · ${motorcycle.currentMileage.toLocaleString()} km`
    : '';

  return (
    <View style={styles.container}>
      <View style={styles.greetRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.greetTextWrap}>
          <Text style={styles.greeting}>Habari, {me?.firstName ?? ''}</Text>
          <Text style={styles.subline}>{regLine}</Text>
        </View>
        <TouchableOpacity onPress={() => void logout()}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>

      <StatusBanners />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.green}
          />
        }
      >
        {assignment ? (
          <LinearGradient
            colors={cleared ? gradients.owedClear.colors : gradients.owedDue.colors}
            start={cleared ? gradients.owedClear.start : gradients.owedDue.start}
            end={cleared ? gradients.owedClear.end : gradients.owedDue.end}
            style={[
              styles.owedTile,
              { borderColor: cleared ? owedTile.clearBorder : owedTile.dueBorder },
            ]}
          >
            <Text
              style={[styles.owedLabel, { color: cleared ? owedTile.clearText : owedTile.dueText }]}
            >
              {cleared ? 'Umemaliza leo ✓' : 'Unadaiwa leo'}
            </Text>
            <Text
              style={[
                styles.owedValue,
                { color: cleared ? owedTile.clearAmount : owedTile.dueAmount },
              ]}
            >
              {cleared ? '0' : formatTZS(remaining)}
            </Text>
            <Text
              style={[styles.owedSub, { color: cleared ? owedTile.clearText : owedTile.dueText }]}
            >
              {cleared
                ? `Umelipa ${paidToday.toLocaleString()}` +
                  (plan && plan.daysAhead > 0 ? ` — uko siku ${plan.daysAhead} mbele` : '')
                : `You owe ${remaining.toLocaleString()} of today's ${target.toLocaleString()}`}
            </Text>
          </LinearGradient>
        ) : noAssignment ? (
          <View style={styles.noAssignmentCard}>
            <Text style={styles.noAssignmentText}>No assignment for today yet.</Text>
          </View>
        ) : null}

        {assignment && !cleared && (
          <>
            <TouchableOpacity style={styles.payButton} onPress={() => navigation.navigate('Lipa')}>
              <Text style={styles.payButtonText}>Lipa sasa · Pay now</Text>
            </TouchableOpacity>
            {/* Stage DM7 simplification: the mockup implies a quicker,
                cash-specific confirmation path for this button - building
                that is Lipa's own job (a later stage), so this just opens
                Lipa too, same as Pay now. */}
            <TouchableOpacity
              style={styles.payButtonAlt}
              onPress={() => navigation.navigate('Lipa')}
            >
              <Text style={styles.payButtonAltText}>Nimelipa kwa fedha taslimu — I paid cash</Text>
            </TouchableOpacity>
          </>
        )}

        {assignment && (
          <View style={styles.strip}>
            <View style={styles.stripStat}>
              <Text style={styles.stripLabel}>Lengo la leo</Text>
              <Text style={styles.stripValue}>{target.toLocaleString()}</Text>
            </View>
            <View style={styles.stripStat}>
              <Text style={styles.stripLabel}>Umelipa</Text>
              <Text style={[styles.stripValue, { color: colors.green }]}>
                {paidToday.toLocaleString()}
              </Text>
            </View>
            <View style={styles.stripStat}>
              <Text style={styles.stripLabel}>Imebaki</Text>
              <Text
                style={[styles.stripValue, { color: remaining > 0 ? colors.red : colors.green }]}
              >
                {remaining.toLocaleString()}
              </Text>
            </View>
          </View>
        )}

        {!weekLoading && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Wiki hii · This week</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Malipo')}>
                <Text style={styles.cardLink}>Historia</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dayRow}>
              {week.map((d) => (
                <View key={d.key} style={styles.dayCell}>
                  <View style={[styles.dayBar, { backgroundColor: DAY_BAR_COLOR[d.status] }]} />
                  <Text style={styles.dayLabel}>{d.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.weekSummaryRow}>
              <Text style={styles.weekSummaryText}>
                {fullCount} siku kamili · {halfCount} nusu
              </Text>
              <Text style={styles.weekSummaryText}>
                <Text style={styles.weekSummaryBold}>{weekPaid.toLocaleString()}</Text> /{' '}
                {weekTarget.toLocaleString()} TZS
              </Text>
            </View>
          </View>
        )}

        {motorcycle && (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Pikipiki')}>
            <Text style={styles.cardTitle}>Pikipiki yako</Text>
            <View style={styles.bikeRow}>
              <View style={styles.bikeAvatar} />
              <View>
                <Text style={styles.bikeReg}>{motorcycle.registrationNumber}</Text>
                <Text style={styles.bikeMeta}>{bikeLine}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.addExpenseButton}
          onPress={() => navigation.navigate('Matumizi')}
        >
          <Text style={styles.addExpenseButtonText}>Add expense</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  greetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.card2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.txt2, fontSize: 15, fontWeight: '800' },
  greetTextWrap: { flex: 1 },
  greeting: {
    color: colors.txt,
    fontSize: typography.greeting.fontSize,
    fontWeight: typography.greeting.fontWeight,
    letterSpacing: -0.4,
  },
  subline: { color: colors.txt3, fontSize: 12.5, marginTop: 2 },
  logout: { color: colors.red, fontSize: 13, fontWeight: '600' },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  owedTile: {
    borderRadius: radii.card + 4,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  owedLabel: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  owedValue: {
    fontSize: typography.bigNumber.fontSize,
    fontWeight: typography.bigNumber.fontWeight as TextStyle['fontWeight'],
    marginTop: 9,
    marginBottom: 4,
  },
  owedSub: { fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  noAssignmentCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  noAssignmentText: { color: colors.txt2, fontSize: 14 },
  payButton: {
    backgroundColor: colors.green,
    borderRadius: radii.cta,
    padding: 17,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  payButtonText: { color: payButtonText, fontSize: 16, fontWeight: '800' },
  payButtonAlt: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.cta,
    padding: 14,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  payButtonAltText: { color: colors.txt, fontSize: 14.5, fontWeight: '600' },
  strip: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  stripStat: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  stripLabel: {
    color: colors.txt3,
    fontSize: 10.5,
    fontWeight: '650' as TextStyle['fontWeight'],
  },
  stripValue: {
    color: colors.txt,
    fontSize: typography.statValue.fontSize,
    fontWeight: typography.statValue.fontWeight,
    marginTop: 5,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  cardTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
  },
  cardLink: { marginLeft: 'auto', color: colors.green, fontSize: 11.5, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  dayCell: { flex: 1, alignItems: 'center' },
  dayBar: { width: '100%', height: 30, borderRadius: 6 },
  dayLabel: {
    color: colors.txt3,
    fontSize: 9.5,
    fontWeight: '650' as TextStyle['fontWeight'],
    marginTop: 5,
  },
  weekSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 13,
  },
  weekSummaryText: { color: colors.txt3, fontSize: 11.5 },
  weekSummaryBold: { color: colors.txt2, fontWeight: '700' },
  bikeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  bikeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.greenSoft,
  },
  bikeReg: { color: colors.txt, fontSize: 13.5, fontWeight: '700' },
  bikeMeta: { color: colors.txt3, fontSize: 11.5, marginTop: 2 },
  addExpenseButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.cta,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addExpenseButtonText: { color: colors.txt2, fontSize: 15, fontWeight: '600' },
});
