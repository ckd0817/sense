import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, F, S } from '../../constants/theme';
import { useRouter, usePathname } from 'expo-router';

function CustomTabBar() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={s.bar}>
      <TouchableOpacity style={s.tabBtn} onPress={() => router.navigate('/')} activeOpacity={0.7}>
        <Ionicons name="today-outline" size={24} color={pathname === '/' ? Colors.primary : Colors.hint} />
        <Text style={[s.tabLabel, pathname === '/' && s.tabLabelActive]}>今天</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.centerBtn} onPress={() => router.navigate('/record')} activeOpacity={0.7}>
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <TouchableOpacity style={s.tabBtn} onPress={() => router.navigate('/settings')} activeOpacity={0.7}>
        <Ionicons name="settings-outline" size={24} color={pathname === '/settings' ? Colors.primary : Colors.hint} />
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
    height: 80,
    paddingBottom: 28,
    paddingTop: 8,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
  },
  tabBtn: {
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
  centerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
});
