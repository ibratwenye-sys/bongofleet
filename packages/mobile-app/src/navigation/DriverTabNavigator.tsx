import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TodayScreen } from '../screens/TodayScreen';
import { SafariZanguScreen } from '../screens/SafariZanguScreen';
import { SafariJobDetailScreen } from '../screens/SafariJobDetailScreen';
import { ComingSoonScreen } from '../screens/ComingSoonScreen';
import { MimiScreen } from '../screens/MimiScreen';
import { MkatabaWanguScreen } from '../screens/MkatabaWanguScreen';
import { Icon, type IconName } from '../components/Icon';
import { colors } from '../theme';

// Stage DM4 - the car/truck-driver tab bar (Safari/Matumizi/Mimi, per the
// design doc's three-tab truck-driver layout). SafariDetail and Mkataba are
// hidden routes (tabBarButton: () => null), same convention as
// RiderTabNavigator's Lipa/Mkataba: a real navigable screen without a
// visible fourth/fifth icon. Matumizi (driver-submitted expenses) stays a
// ComingSoonScreen placeholder - genuinely Stage H scope, ExpenseController
// has no RIDER route today.
//
// Stage DM13 - per DESIGN_CANONICAL_DEMO_DATA.md's driver-app decision, the
// truck/car bottom bar is Today/Jobs/Expenses/Me in ENGLISH, deliberately
// distinct from rider mode's Swahili Leo/Lipa/Mkataba/Matumizi/Mimi bar.
// Route names are unchanged (Safari, SafariDetail, Matumizi, Mimi) so no
// navigation.navigate() call site elsewhere needed to change - only the
// tabBarLabel/tabBarIcon shown for each visible tab, plus a new Today route
// (Part 4's TodayScreen). Safari's own screen content (the plain job list,
// no mockup design for it yet) and Matumizi's ComingSoonScreen are
// otherwise untouched.
export type DriverTabParamList = {
  Today: undefined;
  Safari: undefined;
  Matumizi: undefined;
  Mimi: undefined;
  SafariDetail: { jobId: string };
  Mkataba: undefined;
};

const TAB_ICON: Record<'Today' | 'Safari' | 'Matumizi' | 'Mimi', IconName> = {
  Today: 'leo', // exact match for the mockup's "Today" tab glyph
  Safari: 'truck', // "Jobs"
  Matumizi: 'matumizi', // "Expenses"
  Mimi: 'mimi', // "Me"
};

const TAB_LABEL: Record<'Today' | 'Safari' | 'Matumizi' | 'Mimi', string> = {
  Today: 'Today',
  Safari: 'Jobs',
  Matumizi: 'Expenses',
  Mimi: 'Me',
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

export function DriverTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.txt3,
        tabBarStyle: {
          backgroundColor: '#0E1727',
          borderTopColor: colors.lineSoft,
          borderTopWidth: 1,
          height: 76,
          paddingTop: 9,
        },
        tabBarLabelStyle: {
          fontSize: 9.5,
          fontWeight: '700',
        },
        tabBarLabel: TAB_LABEL[route.name as keyof typeof TAB_LABEL],
        tabBarIcon: ({ color }) => (
          <Icon name={TAB_ICON[route.name as keyof typeof TAB_ICON]} size={21} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Safari" component={SafariZanguScreen} />
      <Tab.Screen name="Matumizi">{() => <ComingSoonScreen label="Matumizi" />}</Tab.Screen>
      <Tab.Screen name="Mimi" component={MimiScreen} />
      <Tab.Screen
        name="SafariDetail"
        component={SafariJobDetailScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Mkataba"
        component={MkatabaWanguScreen}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}
