import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LeoScreen } from '../screens/LeoScreen';
import { LipaScreen } from '../screens/LipaScreen';
import { MimiScreen } from '../screens/MimiScreen';
import { PikipikiScreen } from '../screens/PikipikiScreen';
import { MalipoYanguScreen } from '../screens/MalipoYanguScreen';
import { MkatabaWanguScreen } from '../screens/MkatabaWanguScreen';
import { MatumiziScreen } from '../screens/MatumiziScreen';
import { Icon, type IconName } from '../components/Icon';
import { colors } from '../theme';

// Stage DM6 - the rider tab bar restructured to match the mockup's 5-VISIBLE
// -tab layout (Leo/Lipa/Mkataba/Matumizi/Mimi, in that order - the mockup's
// own .tabs markup on every rider screen). Malipo (MalipoYanguScreen) and
// Pikipiki (PikipikiScreen) stay real, navigable routes via
// tabBarButton: () => null - same pattern Stage DM1 already used for
// Lipa/Mkataba/Matumizi before this restructure. The mockup folds "Pikipiki
// yako" into a Leo-screen card and reaches payment history via Leo's week
// card "Historia" link, not as separate tabs - that re-linking is the
// Leo-screen stage's job, not this one. This stage only moves the tab bar;
// screen content is untouched.
export type RiderTabParamList = {
  Leo: undefined;
  Lipa: undefined;
  Mkataba: undefined;
  Matumizi: undefined;
  Mimi: undefined;
  Malipo: undefined;
  Pikipiki: undefined;
};

const TAB_ICON: Record<'Leo' | 'Lipa' | 'Mkataba' | 'Matumizi' | 'Mimi', IconName> = {
  Leo: 'leo',
  Lipa: 'lipa',
  Mkataba: 'mkataba',
  Matumizi: 'matumizi',
  Mimi: 'mimi',
};

const Tab = createBottomTabNavigator<RiderTabParamList>();

export function RiderTabNavigator() {
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
        tabBarIcon: ({ color }) => (
          <Icon name={TAB_ICON[route.name as keyof typeof TAB_ICON]} size={21} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Leo" component={LeoScreen} />
      <Tab.Screen name="Lipa" component={LipaScreen} />
      <Tab.Screen name="Mkataba" component={MkatabaWanguScreen} />
      <Tab.Screen name="Matumizi" component={MatumiziScreen} />
      <Tab.Screen name="Mimi" component={MimiScreen} />
      <Tab.Screen
        name="Malipo"
        component={MalipoYanguScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Pikipiki"
        component={PikipikiScreen}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}
