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
import Svg, { Path, Circle } from 'react-native-svg';
import { useDriverData } from '../context/DriverDataContext';
import { StatusBanners } from '../components/StatusBanners';
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatDateHuman, formatMonthYearSwahili, formatTZS } from '../format';
import { Icon, type IconName } from '../components/Icon';
import { colors, radii, spacing, typography } from '../theme';
import type { Assignment, DriverType, MyDocument, Payment } from '../types';

// Stage DM13 - exported so TodayScreen's greeting header ("T 908 ZAP ·
// Truck driver") can reuse it rather than redeclaring the same map.
export const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

function monthsSince(dateStr: string): number {
  const start = new Date(dateStr);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

function daysUntil(iso: string): number {
  const expiry = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

function documentPill(doc: MyDocument): { label: string; bg: string; color: string } {
  if (doc.status === 'EXPIRED') {
    return { label: 'Imeisha', bg: colors.redSoft, color: colors.red };
  }
  if (doc.status === 'EXPIRING_SOON') {
    const days = doc.expiryDate ? daysUntil(doc.expiryDate) : 0;
    return { label: `Siku ${days}`, bg: colors.amberSoft, color: colors.amber };
  }
  return { label: 'Sawa', bg: colors.greenSoft, color: colors.green };
}

// Shared row shape for both "Nyaraka zangu" and the settings card below -
// covers every row variant the mockup shows: a pill (documents), a
// trailing static word (Arifa/Lugha), a chevron (Mkataba wangu/Historia),
// or none of those (Toka). Rows with no onPress render as a plain View,
// not a TouchableOpacity - the mockup gives license/insurance rows no
// chevron, meaning nothing to tap them into; inventing a dead tap target
// would be worse than a static row.
function SettingsRow({
  icon,
  iconColor = colors.txt2,
  iconBg = colors.card2,
  label,
  labelColor = colors.txt,
  sub,
  trailingText,
  pill,
  showChevron = false,
  showBorder = true,
  onPress,
}: {
  icon: IconName;
  iconColor?: string;
  iconBg?: string;
  label: string;
  labelColor?: string;
  sub?: string;
  trailingText?: string;
  pill?: { label: string; bg: string; color: string };
  showChevron?: boolean;
  showBorder?: boolean;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={[styles.row, showBorder && styles.rowBorder]} {...(onPress ? { onPress } : {})}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={17} color={iconColor} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
        {sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {pill && (
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
        </View>
      )}
      {trailingText && <Text style={styles.rowTrailing}>{trailingText}</Text>}
      {showChevron && <Icon name="chevron" size={15} color={colors.txt3} />}
    </Wrapper>
  );
}

// Stage DM4 - typed against just the two routes Mimi actually navigates to,
// not a specific tab navigator's full ParamList. Mimi is shared verbatim
// between RiderTabNavigator and the new DriverTabNavigator (both host a
// hidden 'Mkataba' route, per Mimi's Mkataba wangu link - ownership plans
// are driverType-generic, confirmed via schema/service read, not RIDER-only,
// see DM4 report), and a ParamList-specific BottomTabScreenProps type from
// one navigator isn't assignable to the other's screen slot. Stage DM11
// adds 'Malipo' for the new Historia ya malipo row - RIDER-only in practice
// (see isRider below), but the type stays shared since DriverTabNavigator
// never renders that row at all.
interface Props {
  navigation: { navigate: (screen: 'Mkataba' | 'Malipo') => void };
}

/**
 * Stage DM11 - rebuilt against the mockup's screen 6 ("Mimi - Me") and the
 * DM6-DM10 dark theme, plus a new real data source (GET /documents/mine,
 * Part A of this stage). me/monthsOnFleet/lifetimePaid/the Mkataba wangu
 * link/logout are all unchanged data - only how they're drawn, and the new
 * documents card, changes.
 *
 * Deliberately NOT built (same "don't fabricate" principle as DM7-DM10):
 * a phone-number row (Me has no phone field anywhere in the schema, same
 * reasoning as DM8's "Namba yako" omission on Lipa), a signed-date subtext
 * on the Mkataba wangu row (would need a second network fetch - plan.
 * startDate - just for a subtitle; the row's own destination already shows
 * the full plan detail), and settings/report-a-problem/notifications/
 * language screens (none exist - wired to the same honest
 * showBanner('Not available yet.') placeholder used for every other
 * not-yet-built feature in this app).
 */
export function MimiScreen({ navigation }: Props) {
  const { me, showBanner, logout } = useDriverData();
  const category = me?.driverType ? CATEGORY_LABELS[me.driverType] : 'Rider';
  const isRider = me?.driverType === 'RIDER';

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plain, uncached reads - same pattern as Pikipiki/Malipo yangu (Stage
  // DM2), not folded into DriverDataContext: this data isn't shared with
  // any other screen.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [assignmentList, paymentList, documentList] = await Promise.all([
        apiFetch<Assignment[]>('/assignments'),
        apiFetch<Payment[]>('/payments'),
        apiFetch<MyDocument[]>('/documents/mine'),
      ]);
      setAssignments(assignmentList);
      setPayments(paymentList);
      setDocuments(documentList);
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

  // Earliest assignedDate is the proxy for when the rider joined - no
  // "joined" field exists, or is needed, elsewhere.
  const earliestAssignedDate = assignments.reduce<string | null>(
    (earliest, a) => (earliest === null || a.assignedDate < earliest ? a.assignedDate : earliest),
    null,
  );
  const monthsOnFleet = earliestAssignedDate ? monthsSince(earliestAssignedDate) : null;

  // Same "paid" convention as Leo/Lipa: everything but FAILED counts,
  // matching the rest of the app rather than inventing a stricter rule
  // just for this stat.
  const lifetimePaid = payments
    .filter((p) => p.status !== 'FAILED')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const initials = me ? `${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase() : '';
  const tenureLine =
    `Dereva · ${category}` +
    (earliestAssignedDate ? ` · tangu ${formatMonthYearSwahili(earliestAssignedDate)}` : '');

  const licenseDoc = documents.find((d) => d.docType === 'DRIVERS_LICENSE');
  const insuranceDoc = documents.find((d) => d.docType === 'INSURANCE');
  const notAvailable = () => showBanner('Not available yet.', 'success');

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
        <Text style={styles.appbarTitle}>Mimi</Text>
        <TouchableOpacity style={styles.iconButton} onPress={notAvailable}>
          <Icon name="settings" size={17} color={colors.txt2} />
        </TouchableOpacity>
      </View>

      <StatusBanners />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.green}
          />
        }
      >
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.profileTextWrap}>
              <Text style={styles.name}>{me ? `${me.firstName} ${me.lastName}` : ''}</Text>
              <Text style={styles.tenure}>{tenureLine}</Text>
            </View>
          </View>

          <View style={styles.strip}>
            <View style={styles.stripStat}>
              <Text style={styles.stripLabel}>Months on fleet</Text>
              <Text style={styles.stripValue}>{monthsOnFleet !== null ? monthsOnFleet : '—'}</Text>
            </View>
            <View style={styles.stripStat}>
              <Text style={styles.stripLabel}>Lifetime paid</Text>
              <Text style={styles.stripValue}>{formatTZS(lifetimePaid)}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.reportButton} onPress={notAvailable}>
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
            <Path d="M12 8v5" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={12} cy={16.5} r={1} stroke="#fff" strokeWidth={2.4} />
            <Circle cx={12} cy={12} r={9} stroke="#fff" strokeWidth={2.4} />
          </Svg>
          <Text style={styles.reportButtonText}>Ripoti tatizo · Report a problem</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nyaraka zangu</Text>
          {licenseDoc && (
            <SettingsRow
              icon="idcard"
              label="Leseni ya udereva"
              sub={
                licenseDoc.expiryDate
                  ? `Inaisha ${formatDateHuman(licenseDoc.expiryDate)}`
                  : undefined
              }
              pill={documentPill(licenseDoc)}
            />
          )}
          {isRider && insuranceDoc && (
            <SettingsRow
              icon="shield"
              label="Bima ya pikipiki"
              sub={
                insuranceDoc.expiryDate
                  ? `Inaisha ${formatDateHuman(insuranceDoc.expiryDate)}`
                  : undefined
              }
              pill={documentPill(insuranceDoc)}
            />
          )}
          <SettingsRow
            icon="contractfile"
            label="Mkataba wangu"
            showChevron
            showBorder={false}
            onPress={() => navigation.navigate('Mkataba')}
          />
        </View>

        <View style={styles.card}>
          {isRider && (
            <SettingsRow
              icon="history"
              label="Historia ya malipo"
              showChevron
              onPress={() => navigation.navigate('Malipo')}
            />
          )}
          <SettingsRow
            icon="bell"
            label="Arifa"
            trailingText="Washa"
            showChevron
            onPress={notAvailable}
          />
          <SettingsRow
            icon="language"
            label="Lugha"
            trailingText="Kiswahili"
            showChevron
            onPress={notAvailable}
          />
          <SettingsRow
            icon="logout"
            iconBg={colors.redSoft}
            iconColor={colors.red}
            label="Toka"
            labelColor={colors.red}
            showBorder={false}
            onPress={() => void logout()}
          />
        </View>
      </ScrollView>
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
  content: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Flat colors.card2 avatar, not the mockup's own gradient - same
  // simplification DM7 already made for Leo's avatar, kept consistent
  // here rather than reintroducing a gradient for one screen only.
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: colors.card2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.txt2, fontSize: 16, fontWeight: '800' },
  profileTextWrap: { flex: 1, minWidth: 0 },
  name: { color: colors.txt, fontSize: 15.5, fontWeight: '750' as TextStyle['fontWeight'] },
  tenure: { color: colors.txt3, fontSize: 11.5, marginTop: 3 },
  strip: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stripStat: {
    flex: 1,
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  stripLabel: { color: colors.txt3, fontSize: 10.5, fontWeight: '650' as TextStyle['fontWeight'] },
  stripValue: {
    color: colors.txt,
    fontSize: typography.statValue.fontSize,
    fontWeight: typography.statValue.fontWeight as TextStyle['fontWeight'],
    marginTop: 5,
  },
  reportButton: {
    backgroundColor: colors.red,
    borderRadius: radii.card,
    paddingVertical: 17,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  reportButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 13.5, fontWeight: '650' as TextStyle['fontWeight'] },
  rowSub: { color: colors.txt3, fontSize: 11.5, marginTop: 2 },
  rowTrailing: {
    color: colors.txt3,
    fontSize: 11.5,
    fontWeight: '650' as TextStyle['fontWeight'],
    marginRight: 4,
  },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  pillText: { fontSize: 10.5, fontWeight: '750' as TextStyle['fontWeight'] },
});
