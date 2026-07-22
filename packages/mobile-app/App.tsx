import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { setOnSessionExpired } from './src/api';
import { getAccessToken } from './src/storage';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';

type Screen = 'loading' | 'login' | 'home';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');

  useEffect(() => {
    setOnSessionExpired(() => setScreen('login'));
    void getAccessToken().then((token) => setScreen(token ? 'home' : 'login'));
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={screen === 'home' ? 'light' : 'dark'} />
      {screen === 'loading' && (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      )}
      {screen === 'login' && <LoginScreen onLoggedIn={() => setScreen('home')} />}
      {screen === 'home' && <HomeScreen onLoggedOut={() => setScreen('login')} />}
    </View>
  );
}
