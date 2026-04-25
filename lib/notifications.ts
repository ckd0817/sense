// Notification stubs — expo-notifications not available in Expo Go.
// Will be implemented with a development build later.

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export async function schedulePeriodicReminder(): Promise<void> {
  // No-op in Expo Go
}

export async function cancelReminders(): Promise<void> {
  // No-op in Expo Go
}

export async function resetReminderAfterRecord(): Promise<void> {
  // No-op in Expo Go
}

export async function setupNotificationListener(_onPress?: () => void): Promise<() => void> {
  return () => {};
}

export async function scheduleTodoReminder(_todoId: string, _title: string, _scheduledTime: string): Promise<void> {
  // No-op in Expo Go
}

export async function cancelTodoReminder(_todoId: string): Promise<void> {
  // No-op in Expo Go
}
