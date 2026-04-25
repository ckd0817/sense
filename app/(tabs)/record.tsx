import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, FlatList, Keyboard, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getChatMessages, addChatMessage, clearChatMessages, getChatDate, ChatMessage } from '../../lib/db';
import { streamAgent, AgentMessage, StreamEvent } from '../../lib/agent';
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

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: { name: string; success: boolean }[];
  streaming?: boolean;
}

function msgToBubble(m: ChatMessage): Bubble | null {
  if (m.role === 'tool') return null;
  let tools: Bubble['tools'] = [];
  if (m.role === 'assistant' && m.tool_calls) {
    try {
      const tcs = JSON.parse(m.tool_calls);
      tools = tcs.map((tc: any) => ({ name: tc.function?.name || tc.name || '?', success: true }));
    } catch { /* ignore */ }
  }
  return { id: m.id, role: m.role, text: m.content || '', tools };
}

export default function RecordScreen() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const chatDateRef = useRef('');
  const historyRef = useRef<AgentMessage[]>([]);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      e => setKbOffset(Math.max(0, e.endCoordinates.height - 68))
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKbOffset(0)
    );
    return () => { show.remove(); hide.remove(); };
  }, []);

  const loadChat = useCallback(async () => {
    const date = getChatDate();
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
        const aMsg: AgentMessage = { role: 'assistant', content: m.content || undefined };
        if (m.tool_calls) {
          try { aMsg.tool_calls = JSON.parse(m.tool_calls); } catch { /* */ }
        }
        history.push(aMsg);
        const b = msgToBubble(m);
        if (b) bubbles.push(b);
        // Add tool messages to history
      } else if (m.role === 'tool') {
        history.push({ role: 'tool', tool_call_id: m.tool_call_id || undefined, content: m.content });
      }
    }
    setBubbles(bubbles);
    historyRef.current = history;
  }, []);

  useEffect(() => { loadChat(); }, [loadChat]);

  const scrollToBottom = () => {
    setTimeout(() => flatRef.current?.scrollToEnd?.({ animated: true }), 50);
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');

    // Reset reminder
    import('../../lib/notifications').then(m => m.resetReminderAfterRecord()).catch(() => {});

    // Save user message
    await addChatMessage({ chat_date: chatDateRef.current, role: 'user', content: t });

    const userBubble: Bubble = { id: `user-${Date.now()}`, role: 'user', text: t, tools: [] };
    setBubbles(prev => [...prev, userBubble]);
    scrollToBottom();

    // Add to history
    historyRef.current.push({ role: 'user', content: t });

    // Create placeholder assistant bubble
    const asstId = `asst-${Date.now()}`;
    const asstBubble: Bubble = { id: asstId, role: 'assistant', text: '', tools: [], streaming: true };
    setBubbles(prev => [...prev, asstBubble]);
    scrollToBottom();

    try {
      let fullContent = '';
      const toolResults: { name: string; success: boolean }[] = [];

      for await (const event of streamAgent(historyRef.current)) {
        if (event.type === 'text_delta') {
          fullContent += event.content;
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, text: fullContent } : b
          ));
        } else if (event.type === 'tool_call') {
          // Show tool call happening
        } else if (event.type === 'tool_result') {
          toolResults.push({ name: event.name, success: event.result.success });
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, tools: [...b.tools, { name: event.name, success: event.result.success }] } : b
          ));
        } else if (event.type === 'done') {
          setBubbles(prev => prev.map(b =>
            b.id === asstId ? { ...b, streaming: false } : b
          ));
        }
      }

      // Save assistant message
      const toolCallsJson = toolResults.length > 0 ? JSON.stringify(toolResults.map(tr => ({
        function: { name: tr.name }
      }))) : null;
      await addChatMessage({ chat_date: chatDateRef.current, role: 'assistant', content: fullContent, tool_calls: toolCallsJson });

      // Update history
      const asstMsg: AgentMessage = { role: 'assistant', content: fullContent || undefined };
      historyRef.current.push(asstMsg);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '未知错误';
      setBubbles(prev => prev.map(b =>
        b.id === asstId ? { ...b, text: `错误: ${errMsg}`, streaming: false } : b
      ));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  };

  const handleClear = () => {
    Alert.alert('清空对话', '确定清空今天的对话记录？', [
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
    create_todo: '创建待办',
    complete_todo: '完成待办',
  };

  const renderItem = ({ item }: { item: Bubble }) => (
    <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleAsst]}>
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
            <View key={i} style={[s.toolTag, tool.success ? s.toolOk : s.toolFail]}>
              <Text style={s.toolTagText}>{tool.success ? '✓' : '✗'} {toolLabel[tool.name] || tool.name}</Text>
            </View>
          ))}
        </View>
      )}
      {item.streaming && !item.text && <View style={s.cursor} />}
    </View>
  );

  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <View style={[s.inner, { paddingBottom: kbOffset }]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>对话</Text>
          {bubbles.length > 0 && (
            <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
              <Ionicons name="trash-outline" size={18} color={Colors.hint} />
            </TouchableOpacity>
          )}
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
      </View>
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
  clearBtn: { padding: S.sm },
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
  toolTagText: {
    fontSize: F.xs - 1,
    color: Colors.subtext,
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
});
