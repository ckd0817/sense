import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, F, S } from '../../constants/theme';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function CustomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardVisible) return null;

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8), height: 52 + Math.max(insets.bottom, 8) }]}>
      <TouchableOpacity style={s.tabBtn} onPress={() => router.navigate('/')} activeOpacity={0.7}>
        <Ionicons name={pathname === '/' ? 'today' : 'today-outline'} size={24} color={pathname === '/' ? Colors.primary : Colors.hint} />
        <Text style={[s.tabLabel, pathname === '/' && s.tabLabelActive]}>今天</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.tabBtn} onPress={() => router.navigate('/settings')} activeOpacity={0.7}>
        <Ionicons name={pathname === '/settings' ? 'settings' : 'settings-outline'} size={24} color={pathname === '/settings' ? Colors.primary : Colors.hint} />
        <Text style={[s.tabLabel, pathname === '/settings' && s.tabLabelActive]}>设置</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={() => <CustomTabBar />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="record" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="history" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopColor: Colors.divider,
    borderTopWidth: 0.5,
    paddingTop: 8,
    alignItems: 'center',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: F.xs,
    color: Colors.hint,
    marginTop: 2,
  },
  tabLabelActive: {
    color: Colors.primary,
  },
});
