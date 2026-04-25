import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Switch, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAISettings, setAISettings, getReminderInterval, setReminderInterval, getGranularity, setGranularity, getSystemPrompt, setSystemPrompt, AISettings, exportAllRecords, importRecords } from '../../lib/db';
import { testConnection } from '../../lib/ai';
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/agent';
import { Colors, S, R, F, REMINDER_OPTIONS, GRANULARITY_OPTIONS } from '../../constants/theme';
import { Paths, File, Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

export default function SettingsScreen() {
  const [ai, setAi] = useState<AISettings>({ apiUrl: '', apiKey: '', model: '' });
  const [interval, setInterval_] = useState(60);
  const [gran, setGran] = useState(30);
  const [remindOn, setRemindOn] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [promptText, setPromptText] = useState(DEFAULT_SYSTEM_PROMPT);

  useEffect(() => { (async () => { setAi(await getAISettings()); setInterval_(await getReminderInterval()); setGran(await getGranularity()); const sp = await getSystemPrompt(); setPromptText(sp || DEFAULT_SYSTEM_PROMPT); })(); }, []);

  const save = async () => {
    if (!ai.apiUrl || !ai.apiKey || !ai.model) { Alert.alert('请填写完整'); return; }
    setSaving(true);
    try { await setAISettings(ai); Alert.alert('已保存'); } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!ai.apiUrl || !ai.apiKey || !ai.model) { Alert.alert('请先填写完整的 API 配置'); return; }
    setTesting(true);
    try {
      const msg = await testConnection(ai);
      Alert.alert('连接成功', msg);
    } catch (e) {
      Alert.alert('连接失败', e instanceof Error ? e.message : '未知错误');
    } finally { setTesting(false); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const json = await exportAllRecords();
      const file = new File(Paths.document, 'sense-export.json');
      file.write(json);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: '导出数据' });
      } else {
        Alert.alert('导出完成', `文件已保存到 ${file.uri}`);
      }
    } catch (e) {
      Alert.alert('导出失败', e instanceof Error ? e.message : '未知错误');
    } finally { setExporting(false); }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled || !result.assets?.[0]) return;
      const file = new File(result.assets[0].uri);
      const json = await file.text();
      Alert.alert(
        '确认导入',
        '导入将覆盖同 ID 的记录，是否继续？',
        [
          { text: '取消', style: 'cancel' },
          { text: '导入', onPress: async () => {
            try {
              const count = await importRecords(json);
              Alert.alert('导入成功', `已导入 ${count} 条记录`);
            } catch (e) {
              Alert.alert('导入失败', e instanceof Error ? e.message : '未知错误');
            }
          }},
        ]
      );
    } catch (e) {
      Alert.alert('选择文件失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const toggleRemind = async (on: boolean) => {
    setRemindOn(on);
    if (on) {
      const { requestNotificationPermission, schedulePeriodicReminder } = await import('../../lib/notifications');
      if (!(await requestNotificationPermission())) { Alert.alert('需要通知权限'); setRemindOn(false); return; }
      await schedulePeriodicReminder();
    } else { (await import('../../lib/notifications')).cancelReminders(); }
  };

  const changeInterval = async (m: number) => { setInterval_(m); await setReminderInterval(m); if (remindOn) (await import('../../lib/notifications')).schedulePeriodicReminder(); };
  const changeGran = async (m: number) => { setGran(m); await setGranularity(m); };

  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>设置</Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>AI 接口</Text>
          <Text style={s.label}>API URL</Text>
          <TextInput style={s.input} value={ai.apiUrl} onChangeText={v => setAi({ ...ai, apiUrl: v })} placeholder="https://api.openai.com/v1" placeholderTextColor={Colors.hint} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Text style={s.label}>API Key</Text>
          <View style={s.keyRow}>
            <TextInput style={[s.input, s.keyInput]} value={ai.apiKey} onChangeText={v => setAi({ ...ai, apiKey: v })} placeholder="sk-..." placeholderTextColor={Colors.hint} autoCapitalize="none" autoCorrect={false} secureTextEntry={!showKey} />
            <TouchableOpacity style={s.eye} onPress={() => setShowKey(!showKey)}><Text style={s.eyeText}>{showKey ? '隐藏' : '显示'}</Text></TouchableOpacity>
          </View>
          <Text style={s.label}>Model</Text>
          <TextInput style={s.input} value={ai.model} onChangeText={v => setAi({ ...ai, model: v })} placeholder="gpt-4o-mini" placeholderTextColor={Colors.hint} autoCapitalize="none" autoCorrect={false} />
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.testBtn, testing && s.saveOff]} onPress={handleTest} disabled={testing}>
              {testing ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={s.testText}>测试连接</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.saveBtn, saving && s.saveOff]} onPress={save} disabled={saving}><Text style={s.saveText}>{saving ? '...' : '保存'}</Text></TouchableOpacity>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>时间粒度</Text>
          <Text style={s.cardDesc}>活动的起止时间将按此粒度对齐</Text>
          <View style={s.chips}>
            {GRANULARITY_OPTIONS.map(o => (
              <TouchableOpacity key={o.value} style={[s.chip, gran === o.value && s.chipOn]} onPress={() => changeGran(o.value)}>
                <Text style={[s.chipText, gran === o.value && s.chipTextOn]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>数据管理</Text>
          <Text style={s.cardDesc}>导出或导入活动记录（JSON 格式）</Text>
          <View style={s.btnRow}>
            <TouchableOpacity style={s.outlineBtn} onPress={handleImport}>
              <Text style={s.outlineText}>导入</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.saveBtn, exporting && s.saveOff]} onPress={handleExport} disabled={exporting}>
              {exporting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveText}>导出</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.cardTitle}>定时提醒</Text>
            <View style={s.spacer} />
            <Switch value={remindOn} onValueChange={toggleRemind} trackColor={{ false: Colors.divider, true: Colors.primary }} thumbColor="#FFFFFF" />
          </View>
          {remindOn && (
            <View style={s.chips}>
              {REMINDER_OPTIONS.map(o => (
                <TouchableOpacity key={o.value} style={[s.chip, interval === o.value && s.chipOn]} onPress={() => changeInterval(o.value)}>
                  <Text style={[s.chipText, interval === o.value && s.chipTextOn]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.cardTitle}>系统提示词</Text>
            <View style={s.spacer} />
            <TouchableOpacity onPress={() => { setPromptText(DEFAULT_SYSTEM_PROMPT); setSystemPrompt(''); }}>
              <Text style={s.eyeText}>恢复默认</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.cardDesc}>自定义 Agent 的行为规则，动态数据（时间、待办等）会自动注入</Text>
          <TextInput
            style={s.promptInput}
            value={promptText}
            onChangeText={setPromptText}
            multiline
            textAlignVertical="top"
            placeholderTextColor={Colors.hint}
          />
          <TouchableOpacity style={s.saveBtn} onPress={async () => { await setSystemPrompt(promptText); Alert.alert('已保存'); }} activeOpacity={0.7}>
            <Text style={s.saveText}>保存</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: S.lg, paddingBottom: S.xxl },
  title: { paddingTop: S.xl, paddingBottom: S.lg, fontSize: F.xxl, fontWeight: '600', color: Colors.text, letterSpacing: -0.5 },
  card: { backgroundColor: Colors.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.lg },
  cardTitle: { fontSize: F.md, fontWeight: '600', color: Colors.text, marginBottom: S.xs },
  cardDesc: { fontSize: F.xs, color: Colors.hint, marginBottom: S.md },
  label: { fontSize: F.xs, color: Colors.hint, marginBottom: S.xs, fontWeight: '500' as const },
  input: { backgroundColor: Colors.surfaceAlt, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.md, fontSize: F.md, color: Colors.text, marginBottom: S.md, borderWidth: 1, borderColor: Colors.divider },
  keyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: R.md, borderWidth: 1, borderColor: Colors.divider, marginBottom: S.md, paddingRight: S.sm },
  keyInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', marginBottom: 0 },
  eye: { padding: S.sm },
  eyeText: { fontSize: F.xs, color: Colors.primary, fontWeight: '500' as const },
  btnRow: { flexDirection: 'row', gap: S.sm, marginTop: S.sm },
  saveBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: R.xl, height: 48, justifyContent: 'center', alignItems: 'center' },
  saveOff: { opacity: 0.4 },
  saveText: { fontSize: F.md, fontWeight: '600', color: '#FFFFFF' },
  testBtn: { flex: 1, borderRadius: R.xl, height: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.primary },
  testText: { fontSize: F.md, fontWeight: '600', color: Colors.primary },
  outlineBtn: { flex: 1, borderRadius: R.xl, height: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.divider },
  outlineText: { fontSize: F.md, fontWeight: '600', color: Colors.text },
  promptInput: { backgroundColor: Colors.surfaceAlt, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.md, fontSize: F.xs, color: Colors.text, marginBottom: S.md, borderWidth: 1, borderColor: Colors.divider, minHeight: 200, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: S.md },
  spacer: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: { paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.xl, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.divider },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: F.sm, color: Colors.subtext },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
});
