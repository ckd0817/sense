import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Alert, Modal, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { getChatMessages, addChatMessage, clearChatMessages, getChatDate, ChatMessage } from '../../lib/db';
import { streamAgent, AgentMessage, AgentRequestContext } from '../../lib/agent';
import { Colors, S, R, F } from '../../constants/theme';

// --- Lightweight Markdown renderer ---

function renderMarkdown(md: string, baseStyle: any): React.ReactNode {
  if (!md) return null;

  const parts: React.ReactNode[] = [];
  let key = 0;
  const lines = md.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) parts.push(<Text key={`n${key++}`} style={baseStyle}>{'\n'}</Text>);

    let line = lines[i];

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      parts.push(<Text key={key++} style={[baseStyle, { fontWeight: '700', fontSize: level === 1 ? F.lg : level === 2 ? F.md : F.sm }]}>{hMatch[2]}</Text>);
      continue;
    }

    // Bullet list
    const bMatch = line.match(/^[-*]\s+(.*)/);
    if (bMatch) {
      parts.push(<Text key={key++} style={baseStyle}>{'• '}</Text>);
      line = bMatch[1];
    }

    // Numbered list
    const nMatch = line.match(/^\d+\.\s+(.*)/);
    if (nMatch) {
      const numMatch = line.match(/^(\d+)\./);
      parts.push(<Text key={key++} style={baseStyle}>{numMatch ? `${numMatch[1]}. ` : '• '}</Text>);
      line = nMatch[1];
    }

    // Inline formatting: **bold**, `code`, rest
    const inlineRegex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = inlineRegex.exec(line)) !== null) {
      if (m.index > lastIndex) {
        parts.push(<Text key={key++} style={baseStyle}>{line.slice(lastIndex, m.index)}</Text>);
      }
      if (m[2]) {
        // Bold
        parts.push(<Text key={key++} style={[baseStyle, { fontWeight: '600' }]}>{m[2]}</Text>);
      } else if (m[3]) {
        // Code
        parts.push(<Text key={key++} style={[baseStyle, { backgroundColor: 'rgba(0,0,0,0.06)', paddingHorizontal: 3, borderRadius: 3, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) }]}>{m[3]}</Text>);
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < line.length) {
      parts.push(<Text key={key++} style={baseStyle}>{line.slice(lastIndex)}</Text>);
    }
  }

  return <Text>{parts}</Text>;
}

interface ToolInfo {
  id: string;
  name: string;
  success?: boolean;
  args?: Record<string, unknown>;
  result?: { success: boolean; message?: string };
}

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  context?: AgentRequestContext;
  contextOpen?: boolean;
  reasoning?: string;
  status?: string;
  thinkingOpen?: boolean;
  tools: ToolInfo[];
  streaming?: boolean;
  error?: boolean;
  retryText?: string;
}

function parseArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
    } catch {
      return { arguments: value };
    }
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function msgToBubble(m: ChatMessage): Bubble | null {
  if (m.role === 'tool') return null;
  let tools: Bubble['tools'] = [];
  if (m.role === 'assistant' && m.tool_calls) {
    try {
      const tcs = JSON.parse(m.tool_calls);
      tools = tcs.map((tc: any, index: number) => ({
        id: tc.id || `saved-tool-${index}`,
        name: tc.function?.name || tc.name || '?',
        success: typeof tc.success === 'boolean' ? tc.success : tc.result?.success ?? true,
        args: parseArgs(tc.function?.arguments ?? tc.args),
        result: tc.result,
      }));
    } catch { /* ignore */ }
  }
  return {
    id: m.id,
    role: m.role,
    text: m.content || '',
    reasoning: m.reasoning || '',
    thinkingOpen: false,
    tools,
  };
}

export default function RecordScreen() {
  const { date: routeDate } = useLocalSearchParams<{ date?: string }>();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const chatDateRef = useRef('');
  const historyRef = useRef<AgentMessage[]>([]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const routeDateRef = useRef(routeDate);
  routeDateRef.current = routeDate;

  const loadChat = useCallback(async (targetDate?: string) => {
    const date = targetDate || getChatDate();
    chatDateRef.current = date;
    const msgs = await getChatMessages(date);
    const bubbles: Bubble[] = [];
    const history: AgentMessage[] = [];
    for (const m of msgs) {
      if (m.role === 'user') {
        history.push({ role: 'user', content: m.content });
        const b = msgToBubble(m);
        if (b) bubbles.push(b);
      } else if (m.role === 'assistant') {
        if (m.content) {
          history.push({ role: 'assistant', content: m.content });
        }
        const b = msgToBubble(m);
        if (b) bubbles.push(b);
      }
    }
    setBubbles(bubbles);
    historyRef.current = history;
  }, []);

  useFocusEffect(useCallback(() => {
    if (!busyRef.current) {
      loadChat(routeDate ? String(routeDate) : undefined);
    }
  }, [loadChat, routeDate]));

  useEffect(() => {
    const syncChatDate = () => {
      // 有进行中对话时不切换 chat_date，避免跨日打断上下文
      if (routeDateRef.current || busyRef.current || bubblesRef.current.length > 0) return;
      const currentDate = getChatDate();
      if (chatDateRef.current && chatDateRef.current !== currentDate) {
        loadChat(currentDate);
      }
    };

    const interval = setInterval(syncChatDate, 60 * 1000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncChatDate();
    });

    syncChatDate();
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadChat]);

  const scrollToBottom = () => {
    setTimeout(() => flatRef.current?.scrollToEnd?.({ animated: true }), 50);
  };

  const serializeToolCalls = (items: ToolInfo[]) => {
    if (items.length === 0) return null;
    return JSON.stringify(items.map(item => ({
      id: item.id,
      type: 'function',
      function: {
        name: item.name,
        arguments: JSON.stringify(item.args ?? {}),
      },
      success: item.success === true,
      result: item.result,
    })));
  };

  const upsertTool = (asstId: string, tool: ToolInfo) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== asstId) return b;
      const exists = b.tools.some(t => t.id === tool.id);
      const tools = exists
        ? b.tools.map(t => t.id === tool.id ? { ...t, ...tool } : t)
        : [...b.tools, tool];
      return { ...b, tools };
    }));
  };

  const runModelRequest = async (asstId: string, requestDate: string, requestHistory: AgentMessage[], retryText: string) => {
    try {
      let fullContent = '';
      let reasoningContent = '';
      let statusText = '正在连接模型...';
      const toolInfos: ToolInfo[] = [];
      const targetDate = requestDate !== getChatDate() ? requestDate : undefined;

      for await (const event of streamAgent(requestHistory, targetDate)) {
        if (event.type === 'request_context') {
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, context: event.context, contextOpen: true } : b
          ));
        } else if (event.type === 'text_delta') {
          fullContent += event.content;
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, text: fullContent } : b
          ));
        } else if (event.type === 'reasoning_delta') {
          reasoningContent += event.content;
          statusText = '模型正在思考...';
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, reasoning: reasoningContent, status: statusText, thinkingOpen: true } : b
          ));
        } else if (event.type === 'status') {
          statusText = event.content;
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, status: statusText } : b
          ));
        } else if (event.type === 'tool_call') {
          const tool: ToolInfo = { id: event.id, name: event.name, args: event.args };
          toolInfos.push(tool);
          statusText = `正在执行：${toolLabel[event.name] || event.name}`;
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, status: statusText, thinkingOpen: true } : b
          ));
          upsertTool(asstId, tool);
        } else if (event.type === 'tool_result') {
          const existing = toolInfos.find(t => t.id === event.id);
          const nextTool: ToolInfo = existing
            ? { ...existing, success: event.result.success, result: event.result }
            : { id: event.id, name: event.name, success: event.result.success, result: event.result };
          if (existing) {
            existing.success = event.result.success;
            existing.result = event.result;
          } else {
            toolInfos.push(nextTool);
          }
          statusText = event.result.success
            ? `已完成：${toolLabel[event.name] || event.name}`
            : `执行失败：${toolLabel[event.name] || event.name}`;
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, status: statusText } : b
          ));
          upsertTool(asstId, nextTool);
        } else if (event.type === 'done') {
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, status: '处理完成', streaming: false } : b
          ));
        }
      }

      const toolCallsJson = serializeToolCalls(toolInfos);
      if (fullContent || reasoningContent || toolCallsJson) {
        await addChatMessage({
          chat_date: requestDate,
          role: 'assistant',
          content: fullContent,
          reasoning: reasoningContent,
          tool_calls: toolCallsJson,
        });
      }

      historyRef.current = fullContent
        ? [...requestHistory, { role: 'assistant', content: fullContent }]
        : requestHistory;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '未知错误';
      setBubbles(prev => prev.map(b =>
        b.id === asstId
          ? {
              ...b,
              text: `错误: ${errMsg}`,
              status: '请求失败，可重试',
              streaming: false,
              error: true,
              retryText,
            }
          : b
      ));
    } finally {
      busyRef.current = false;
      setBusy(false);
      scrollToBottom();
    }
  };

  const beginRequest = async (prompt: string, options: { appendUser: boolean; removeBubbleId?: string }) => {
    const t = prompt.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    if (options.appendUser) setText('');

    try {
      if (!routeDate && chatDateRef.current !== getChatDate()) {
        await loadChat();
      }

      const requestDate = chatDateRef.current || (routeDate ? String(routeDate) : getChatDate());
      chatDateRef.current = requestDate;

      if (options.removeBubbleId) {
        setBubbles(prev => prev.filter(b => b.id !== options.removeBubbleId));
      }

      if (options.appendUser) {
        await addChatMessage({ chat_date: requestDate, role: 'user', content: t });
        const userBubble: Bubble = { id: `user-${Date.now()}`, role: 'user', text: t, tools: [] };
        setBubbles(prev => [...prev, userBubble]);
        historyRef.current = [...historyRef.current, { role: 'user', content: t }];
      }

      const requestHistory = [...historyRef.current];
      const asstId = `asst-${Date.now()}`;
      const asstBubble: Bubble = {
        id: asstId,
        role: 'assistant',
        text: '',
        reasoning: '',
        status: '正在准备上下文...',
        thinkingOpen: true,
        tools: [],
        streaming: true,
      };
      setBubbles(prev => [...prev, asstBubble]);
      scrollToBottom();

      await runModelRequest(asstId, requestDate, requestHistory, t);
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      Alert.alert('发送失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const send = async () => {
    await beginRequest(text, { appendUser: true });
  };

  const retryAssistant = async (item: Bubble) => {
    if (!item.retryText) return;
    await beginRequest(item.retryText, { appendUser: false, removeBubbleId: item.id });
  };

  const handleClear = () => {
    const isToday = chatDateRef.current === getChatDate();
    Alert.alert('清空对话', `确定清空${isToday ? '今天的' : '这段'}对话记录？`, [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: async () => {
        await clearChatMessages(chatDateRef.current);
        historyRef.current = [];
        setBubbles([]);
      }},
    ]);
  };

  const toolLabel: Record<string, string> = {
    create_activity: '记录活动',
    update_activity: '修改活动',
    delete_activity: '删除活动',
    create_todo: '创建待办',
    update_todo: '修改待办',
    delete_todo: '删除待办',
  };

  const fieldLabel: Record<string, string> = {
    activity: '活动', category: '分类', start_time: '开始时间', end_time: '结束时间',
    details: '详情', mood: '心情', social: '社交', location: '地点',
    title: '标题', recurring: '每日重复', scheduled_time: '计划时间',
    reminder_advance: '提前提醒', completed: '已完成', new_title: '新标题',
  };

  const formatFieldValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number') return key === 'reminder_advance' ? `${value} 分钟` : String(value);
    const str = String(value);
    if ((key.endsWith('_time') || key === 'scheduled_time') && str.includes('T')) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}-${dd} ${hh}:${mi}`;
      }
    }
    return str;
  };

  const [detailTool, setDetailTool] = useState<ToolInfo | null>(null);

  const toggleThinking = (id: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, thinkingOpen: !b.thinkingOpen } : b));
  };

  const toggleContext = (id: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, contextOpen: !b.contextOpen } : b));
  };

  const formatJson = (value: unknown): string => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const renderContext = (item: Bubble) => {
    if (item.role !== 'assistant' || !item.context) return null;
    const { context } = item;
    const preview = `${context.messages.length} 条消息 · ${context.tools.length} 个工具`;
    return (
      <View style={s.contextBox}>
        <TouchableOpacity style={s.contextHead} onPress={() => toggleContext(item.id)} activeOpacity={0.7}>
          <Ionicons name={item.contextOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.hint} />
          <Text style={s.contextTitle}>请求上下文</Text>
          <Text style={s.contextPreview} numberOfLines={1}>{preview}</Text>
        </TouchableOpacity>
        {item.contextOpen && (
          <View style={s.contextBody}>
            <View style={s.contextMeta}>
              <Text style={s.contextMetaText}>model: {context.model}</Text>
              <Text style={s.contextMetaText}>temperature: {context.temperature}</Text>
              <Text style={s.contextMetaText}>stream: {context.stream ? 'true' : 'false'}</Text>
            </View>

            <Text style={s.contextSectionTitle}>messages</Text>
            {context.messages.map((message, index) => (
              <View key={`${message.role}-${index}`} style={s.contextMessage}>
                <Text style={s.contextRole}>{index + 1}. {message.role}</Text>
                {message.tool_call_id ? <Text style={s.contextHint}>tool_call_id: {message.tool_call_id}</Text> : null}
                {message.content ? <Text style={s.contextText} selectable>{message.content}</Text> : null}
                {message.tool_calls && message.tool_calls.length > 0 ? (
                  <Text style={s.contextCode} selectable>{formatJson(message.tool_calls)}</Text>
                ) : null}
                {!message.content && !message.tool_calls?.length ? <Text style={s.contextHint}>空内容</Text> : null}
              </View>
            ))}

            <Text style={s.contextSectionTitle}>tools</Text>
            <Text style={s.contextCode} selectable>{formatJson(context.tools)}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderThinking = (item: Bubble) => {
    if (item.role !== 'assistant') return null;
    if (!item.reasoning && !item.status && !item.streaming) return null;
    const title = item.streaming ? '思考中' : '思考';
    const preview = item.status || (item.reasoning ? '已生成思考内容' : '等待模型返回');
    return (
      <View style={s.thinkingBox}>
        <TouchableOpacity style={s.thinkingHead} onPress={() => toggleThinking(item.id)} activeOpacity={0.7}>
          <Ionicons name={item.thinkingOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.hint} />
          <Text style={s.thinkingTitle}>{title}</Text>
          <Text style={s.thinkingPreview} numberOfLines={1}>{preview}</Text>
        </TouchableOpacity>
        {item.thinkingOpen && (
          <View style={s.thinkingBody}>
            {item.reasoning ? <Text style={s.thinkingText}>{item.reasoning}</Text> : null}
            {item.status ? <Text style={s.statusText}>{item.status}</Text> : null}
            {item.streaming && !item.reasoning ? <View style={s.thinkingCursor} /> : null}
          </View>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: Bubble }) => (
    <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleAsst]}>
      {renderContext(item)}
      {renderThinking(item)}
      {item.text ? (
        item.role === 'user' ? (
          <Text style={[s.bubbleText, s.bubbleTextUser]}>{item.text}</Text>
        ) : (
          renderMarkdown(item.text, s.bubbleText)
        )
      ) : null}
      {item.tools.length > 0 && (
        <View style={s.toolRow}>
          {item.tools.map((tool, i) => (
            <TouchableOpacity
              key={`${tool.id}-${i}`}
              style={[
                s.toolTag,
                tool.success === false ? s.toolFail : tool.success === true ? s.toolOk : s.toolRunning,
              ]}
              onPress={() => setDetailTool(tool)}
              activeOpacity={0.6}
            >
              <Text style={s.toolTagText}>{tool.success === undefined ? '…' : tool.success ? '✓' : '✗'} {toolLabel[tool.name] || tool.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {item.error && item.retryText ? (
        <TouchableOpacity style={[s.retryBtn, busy && s.retryOff]} onPress={() => retryAssistant(item)} disabled={busy} activeOpacity={0.7}>
          <Ionicons name="refresh" size={14} color={busy ? Colors.hint : Colors.primary} />
          <Text style={[s.retryText, busy && s.retryTextOff]}>重试这次请求</Text>
        </TouchableOpacity>
      ) : null}
      {item.streaming && !item.text && !item.reasoning && <View style={s.cursor} />}
    </View>
  );

  const router = useRouter();

  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <KeyboardAvoidingView style={s.inner} behavior="padding">
        <View style={s.header}>
          <Text style={s.headerTitle}>{routeDate && String(routeDate) !== getChatDate() ? (() => { const d = new Date(String(routeDate) + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日 对话`; })() : '对话'}</Text>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.headerBtn} onPress={() => router.navigate('/history')}>
              <Ionicons name="time-outline" size={20} color={Colors.hint} />
            </TouchableOpacity>
            {bubbles.length > 0 && (
              <TouchableOpacity style={s.headerBtn} onPress={handleClear}>
                <Ionicons name="trash-outline" size={18} color={Colors.hint} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {bubbles.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={Colors.divider} />
            <Text style={s.emptyText}>说点什么开始记录吧</Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={bubbles}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={s.list}
            onContentSizeChange={scrollToBottom}
          />
        )}

        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="说点什么..."
            placeholderTextColor={Colors.hint}
            multiline
            maxLength={2000}
            editable={!busy}
          />
          <TouchableOpacity style={[s.sendBtn, (!text.trim() || busy) && s.sendOff]} onPress={send} disabled={!text.trim() || busy} activeOpacity={0.7}>
            {busy ? <Text style={s.sendText}>...</Text> : <Ionicons name="arrow-up" size={20} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Modal visible={!!detailTool} transparent animationType="fade" onRequestClose={() => setDetailTool(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setDetailTool(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{detailTool ? (toolLabel[detailTool.name] || detailTool.name) : ''}</Text>
              <TouchableOpacity onPress={() => setDetailTool(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={Colors.hint} />
              </TouchableOpacity>
            </View>
            {detailTool && (
              (detailTool.args && Object.keys(detailTool.args).length > 0) || detailTool.result || detailTool.success !== undefined
            ) ? (
              <View style={s.modalBody}>
                {detailTool.args && Object.entries(detailTool.args).map(([key, value]) => (
                  <View key={key} style={s.fieldRow}>
                    <Text style={s.fieldLabel}>{fieldLabel[key] || key}</Text>
                    <Text style={s.fieldValue}>{formatFieldValue(key, value)}</Text>
                  </View>
                ))}
                <View style={[s.fieldRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.divider }]}>
                  <Text style={s.fieldLabel}>执行状态</Text>
                  <Text style={[
                    s.fieldValue,
                    detailTool.success === false ? { color: '#D32F2F' } : detailTool.success === true ? { color: Colors.success } : null,
                  ]}>
                    {detailTool.success === undefined ? '执行中' : detailTool.success ? '成功' : '失败'}
                  </Text>
                </View>
                {detailTool.result?.message ? (
                  <View style={s.fieldRow}>
                    <Text style={s.fieldLabel}>结果信息</Text>
                    <Text style={s.fieldValue}>{detailTool.result.message}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={s.modalEmpty}>无参数信息</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  inner: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.sm,
  },
  headerTitle: { fontSize: F.lg, fontWeight: '600', color: Colors.text },
  headerRight: { flexDirection: 'row', gap: S.xs },
  headerBtn: { padding: S.sm },
  list: {
    paddingHorizontal: S.lg,
    paddingBottom: S.lg,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: S.md,
  },
  emptyText: { fontSize: F.md, color: Colors.hint },
  bubble: {
    maxWidth: '85%',
    padding: S.md,
    borderRadius: R.lg,
    marginBottom: S.sm,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleAsst: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  bubbleText: {
    fontSize: F.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: '#fff',
  },
  contextBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.divider,
    borderRadius: R.md,
    overflow: 'hidden',
    marginBottom: S.sm,
    backgroundColor: '#FAFAFA',
  },
  contextHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
  },
  contextTitle: {
    fontSize: F.xs,
    fontWeight: '600',
    color: Colors.subtext,
    flexShrink: 0,
  },
  contextPreview: {
    flex: 1,
    fontSize: F.xs,
    color: Colors.hint,
  },
  contextBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
    paddingHorizontal: S.sm,
    paddingVertical: S.sm,
    gap: S.xs,
  },
  contextMeta: {
    gap: 2,
    paddingBottom: S.xs,
  },
  contextMetaText: {
    fontSize: F.xs,
    color: Colors.subtext,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  contextSectionTitle: {
    fontSize: F.xs,
    fontWeight: '700',
    color: Colors.text,
    marginTop: S.xs,
  },
  contextMessage: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.divider,
    borderRadius: R.sm,
    padding: S.xs,
    gap: 2,
    backgroundColor: Colors.surface,
  },
  contextRole: {
    fontSize: F.xs,
    fontWeight: '700',
    color: Colors.primary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  contextHint: {
    fontSize: F.xs,
    color: Colors.hint,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  contextText: {
    fontSize: F.xs,
    color: Colors.subtext,
    lineHeight: 17,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  contextCode: {
    fontSize: F.xs,
    color: Colors.subtext,
    lineHeight: 17,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  thinkingBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.divider,
    borderRadius: R.md,
    overflow: 'hidden',
    marginBottom: S.sm,
    backgroundColor: Colors.surfaceAlt,
  },
  thinkingHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
  },
  thinkingTitle: {
    fontSize: F.xs,
    fontWeight: '600',
    color: Colors.subtext,
    flexShrink: 0,
  },
  thinkingPreview: {
    flex: 1,
    fontSize: F.xs,
    color: Colors.hint,
  },
  thinkingBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
    gap: S.xs,
  },
  thinkingText: {
    fontSize: F.xs,
    color: Colors.subtext,
    lineHeight: 17,
  },
  statusText: {
    fontSize: F.xs,
    color: Colors.hint,
  },
  thinkingCursor: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    opacity: 0.5,
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
    marginTop: S.sm,
  },
  toolTag: {
    paddingHorizontal: S.sm,
    paddingVertical: 2,
    borderRadius: R.sm,
    overflow: 'hidden',
  },
  toolOk: {
    backgroundColor: '#E8F5E9',
  },
  toolFail: {
    backgroundColor: '#FFEBEE',
  },
  toolRunning: {
    backgroundColor: '#E3F2FD',
  },
  toolTagText: {
    fontSize: F.xs - 1,
    color: Colors.subtext,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    marginTop: S.sm,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: R.sm,
  },
  retryOff: {
    borderColor: Colors.divider,
  },
  retryText: {
    fontSize: F.xs,
    fontWeight: '600',
    color: Colors.primary,
  },
  retryTextOff: {
    color: Colors.hint,
  },
  cursor: {
    width: 2,
    height: 16,
    backgroundColor: Colors.primary,
    borderRadius: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: S.sm,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    fontSize: F.md,
    color: Colors.text,
    maxHeight: 100,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendOff: { opacity: 0.35 },
  sendText: { color: '#fff', fontSize: F.md, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: S.xl,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  modalTitle: {
    fontSize: F.md,
    fontWeight: '600',
    color: Colors.text,
  },
  modalBody: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
  },
  modalEmpty: {
    padding: S.xl,
    textAlign: 'center',
    color: Colors.hint,
    fontSize: F.sm,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: S.xs + 1,
    gap: S.md,
  },
  fieldLabel: {
    fontSize: F.sm,
    color: Colors.subtext,
    flexShrink: 0,
  },
  fieldValue: {
    fontSize: F.sm,
    color: Colors.text,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },
});
