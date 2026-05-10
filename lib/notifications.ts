import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { getReminderTimes, getReminderEnabled } from './db';
import Constants from 'expo-constants';

export function initNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function setupNotificationChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync('default', {
    name: '默认',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4F46E5',
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleRecordReminder(): Promise<void> {
  // Cancel all existing record reminders
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.identifier.startsWith('record-reminder-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const times = await getReminderTimes();
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    await Notifications.scheduleNotificationAsync({
      content: { title: '记录一下', body: '记录你的活动和感受' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: m, channelId: 'default' },
      identifier: `record-reminder-${t}`,
    });
  }
}

export async function cancelReminders(): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.identifier.startsWith('record-reminder-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

export async function scheduleTodoReminder(todoId: string, title: string, scheduledTime: string, advanceMinutes: number = 10): Promise<void> {
  await cancelTodoReminder(todoId);
  const target = new Date(scheduledTime).getTime() - advanceMinutes * 60 * 1000;
  const now = Date.now();
  if (target <= now) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: '待办提醒', body: title, data: { todoId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(target), channelId: 'default' },
    identifier: `todo-${todoId}`,
  });
}

export async function cancelTodoReminder(todoId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`todo-${todoId}`);
}

export async function requestBatteryOptimization(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', {
      data: `package:${Constants.expoConfig?.android?.package || 'com.ckd0817.sense'}`,
    });
  } catch {
    // Fallback: open app battery settings
    try {
      await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
        data: `package:${Constants.expoConfig?.android?.package || 'com.ckd0817.sense'}`,
      });
    } catch { /* ignore */ }
  }
}

export async function setupNotificationListener(_onPress?: () => void): Promise<() => void> {
  const sub = Notifications.addNotificationResponseReceivedListener(() => {
    _onPress?.();
  });
  return () => sub.remove();
}
