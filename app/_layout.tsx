import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Colors } from '../constants/theme';

export default function RootLayout() {
  useEffect(() => {
    (async () => {
      const { initNotificationHandler, setupNotificationChannel, scheduleRecordReminder, scheduleTodoReminder } = await import('../lib/notifications');
      initNotificationHandler();
      await setupNotificationChannel();

      const { getReminderEnabled, getAllTodos } = await import('../lib/db');

      // Restore record reminder
      if (await getReminderEnabled()) {
        await scheduleRecordReminder();
      }

      // Restore todo reminders
      const todos = await getAllTodos();
      const now = Date.now();
      for (const t of todos) {
        if (t.scheduled_time && !t.last_completed) {
          const target = new Date(t.scheduled_time).getTime() - (t.reminder_advance ?? 10) * 60 * 1000;
          if (target > now) {
            await scheduleTodoReminder(t.id, t.title, t.scheduled_time, t.reminder_advance ?? 10);
          }
        }
      }
    })().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={s.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: Colors.bg }}>
          <Slot />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
