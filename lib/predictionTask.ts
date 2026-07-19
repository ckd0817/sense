import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { ensureDailyPrediction, PredictionRunResult } from './prediction';

const DAILY_PREDICTION_TASK = 'sense-daily-prediction';

TaskManager.defineTask(DAILY_PREDICTION_TASK, async () => {
  try {
    await ensureDailyPrediction();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerPredictionBackgroundTask(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
  const registered = await TaskManager.isTaskRegisteredAsync(DAILY_PREDICTION_TASK);
  if (registered) return;
  await BackgroundTask.registerTaskAsync(DAILY_PREDICTION_TASK, {
    minimumInterval: 60,
  });
}

export async function runForegroundPredictionCatchup(): Promise<PredictionRunResult> {
  return ensureDailyPrediction();
}
