import * as Notifications from 'expo-notifications';
import { getReminderInterval } from './db';

export function initNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      android: { priority: Notifications.AndroidNotificationPriority.HIGH },
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
  await cancelReminders();
  const hours = await getReminderInterval();
  const triggerDate = new Date(Date.now() + hours * 3600 * 1000);
  await Notifications.scheduleNotificationAsync({
    content: { title: '记录一下', body: '记录你的活动和感受', channelId: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
  });
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function resetReminderAfterRecord(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (scheduled.length > 0) {
    await scheduleRecordReminder();
  }
}

export async function scheduleTodoReminder(todoId: string, title: string, scheduledTime: string, advanceMinutes: number = 10): Promise<void> {
  await cancelTodoReminder(todoId);
  const target = new Date(scheduledTime).getTime() - advanceMinutes * 60 * 1000;
  const now = Date.now();
  if (target <= now) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: '待办提醒', body: title, data: { todoId }, channelId: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(target) },
    identifier: `todo-${todoId}`,
  });
}

export async function cancelTodoReminder(todoId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`todo-${todoId}`);
}

export async function setupNotificationListener(_onPress?: () => void): Promise<() => void> {
  const sub = Notifications.addNotificationResponseReceivedListener(() => {
    _onPress?.();
  });
  return () => sub.remove();
}
