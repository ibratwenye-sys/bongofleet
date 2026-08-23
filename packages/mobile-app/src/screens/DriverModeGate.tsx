import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useDriverData } from '../context/DriverDataContext';
import { RiderTabNavigator } from '../navigation/RiderTabNavigator';
import { ModeNotAvailableScreen } from './ModeNotAvailableScreen';

/**
 * Stage DM1. driverType decides rider vs car/truck-driver UI - missing (no
 * Driver row, e.g. OWNER/MANAGER testing the app) or RIDER gets the rider
 * tab bar; CAR_DRIVER/TRUCK_DRIVER gets an explicit "not available yet"
 * screen rather than the rider UI guessed onto a driver it wasn't built
 * for. Never crashes, never silently shows the wrong mode.
 */
export function DriverModeGate() {
  const { me, loading, logout } = useDriverData();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  if (me?.driverType === 'CAR_DRIVER' || me?.driverType === 'TRUCK_DRIVER') {
    return <ModeNotAvailableScreen driverType={me.driverType} onLogout={() => void logout()} />;
  }

  return (
    <NavigationContainer>
      <RiderTabNavigator />
    </NavigationContainer>
  );
}
