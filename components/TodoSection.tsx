import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F } from '../constants/theme';
import { Todo, deleteTodo, completeTodo, uncompleteTodo, addTodo } from '../lib/db';
import { scheduleTodoReminder, cancelTodoReminder } from '../lib/notifications';
import EditTodoModal from './EditTodoModal';

interface Props {
  todos: Todo[];
  currentDate: string;
  onChanged: () => void;
}

export default function TodoSection({ todos, currentDate, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [habitMode, setHabitMode] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const swipeRef = React.useRef<Swipeable>(null);

  const pending = todos.filter(t => !t.last_completed);
  const completed = todos.filter(t => !!t.last_completed);

  const toggle = async (todo: Todo) => {
    if (todo.last_completed) {
      await uncompleteTodo(todo.id);
      if (todo.scheduled_time) {
        await scheduleTodoReminder(todo.id, todo.title, todo.scheduled_time, todo.reminder_advance ?? 10);
      }
    } else {
      await completeTodo(todo.id, currentDate);
      await cancelTodoReminder(todo.id);
    }
    onChanged();
  };

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await addTodo(title, habitMode);
    setNewTitle('');
    setAdding(false);
    onChanged();
  };

  const handleEdit = (todo: Todo) => {
    swipeRef.current?.close();
    setEditingTodo(todo);
  };

  const renderRightActions = (todo: Todo) => (
    <View style={s.swipeActions}>
      <TouchableOpacity style={s.swipeEditBtn} onPress={() => handleEdit(todo)}>
        <Ionicons name="create-outline" size={18} color="#fff" />
        <Text style={s.swipeBtnText}>编辑</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.swipeDelBtn} onPress={async () => { await deleteTodo(todo.id); onChanged(); }}>
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={s.swipeBtnText}>删除</Text>
      </TouchableOpacity>
    </View>
  );

  const renderItem = (todo: Todo) => (
    <Swipeable key={todo.id} ref={todo.id === editingTodo?.id ? swipeRef : undefined} renderRightActions={() => renderRightActions(todo)} overshootRight={false} friction={2}>
      <TouchableOpacity style={s.item} onPress={() => toggle(todo)} activeOpacity={0.7}>
        <View style={[s.check, todo.last_completed && s.checked]}>
          {todo.last_completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
        <Text style={[s.title, todo.last_completed && s.titleDone]}>{todo.title}</Text>
        {todo.recurring ? <Text style={s.tag}>习惯</Text> : <Text style={s.tagTemp}>临时</Text>}
        {todo.scheduled_time ? (
          <Text style={s.time}>
            {new Date(todo.scheduled_time).getHours().toString().padStart(2, '0')}:{new Date(todo.scheduled_time).getMinutes().toString().padStart(2, '0')}
          </Text>
        ) : null}
      </TouchableOpacity>
    </Swipeable>
  );

  if (todos.length === 0 && !adding) {
    return (
      <View style={s.wrapper}>
        <View style={s.header}>
          <Text style={s.headerTitle}>待办</Text>
          <TouchableOpacity style={s.headerAction} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="添加待办">
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={s.emptyAdd} onPress={() => setAdding(true)}>
          <Ionicons name="add-circle-outline" size={18} color={Colors.hint} />
          <Text style={s.emptyText}>添加待办或习惯</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.wrapper}>
      <View style={s.header}>
        <Text style={s.headerTitle}>
          待办
          {pending.length > 0 && <Text style={s.count}> {pending.length}</Text>}
        </Text>
        <TouchableOpacity style={s.headerAction} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="添加待办">
          <Ionicons name="add" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {pending.map(renderItem)}

      {completed.length > 0 && (
        <>
          <View style={s.divider} />
          <TouchableOpacity
            style={s.completedToggle}
            onPress={() => setCompletedOpen(open => !open)}
            activeOpacity={0.65}
            accessibilityRole="button"
            accessibilityLabel={`${completedOpen ? '收起' : '展开'}已完成待办，共 ${completed.length} 项`}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={Colors.hint} />
            <Text style={s.completedLabel}>已完成 {completed.length}</Text>
            <Ionicons name={completedOpen ? 'chevron-up' : 'chevron-down'} size={17} color={Colors.hint} />
          </TouchableOpacity>
          {completedOpen ? completed.map(renderItem) : null}
        </>
      )}

      {adding && (
        <View style={s.addRow}>
          <TextInput
            style={s.addInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="待办名称..."
            placeholderTextColor={Colors.hint}
            autoFocus
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={[s.typeToggle, habitMode && s.typeToggleOn]}
            onPress={() => setHabitMode(!habitMode)}
          >
            <Text style={[s.typeText, habitMode && s.typeTextOn]}>{habitMode ? '习惯' : '临时'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.addBtn} onPress={handleAdd}>
            <Ionicons name="checkmark" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { setAdding(false); setNewTitle(''); }}>
            <Ionicons name="close" size={18} color={Colors.hint} />
          </TouchableOpacity>
        </View>
      )}

      {editingTodo && (
        <EditTodoModal
          todo={editingTodo}
          visible={true}
          onClose={() => setEditingTodo(null)}
          onSaved={onChanged}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.sm,
  },
  headerTitle: {
    fontSize: F.md,
    fontWeight: '600',
    color: Colors.text,
  },
  headerAction: {
    width: 40,
    height: 40,
    marginVertical: -S.sm,
    marginRight: -S.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontSize: F.sm,
    fontWeight: '400',
    color: Colors.hint,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.sm,
    gap: S.sm,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  title: {
    flex: 1,
    fontSize: F.sm,
    color: Colors.text,
  },
  titleDone: {
    color: Colors.hint,
    textDecorationLine: 'line-through',
  },
  tag: {
    fontSize: F.xs - 1,
    color: Colors.primary,
    backgroundColor: '#E3F2FD',
    paddingHorizontal: S.xs + 2,
    paddingVertical: 1,
    borderRadius: R.sm,
    overflow: 'hidden',
  },
  tagTemp: {
    fontSize: F.xs - 1,
    color: Colors.subtext,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 1,
    borderRadius: R.sm,
    overflow: 'hidden',
  },
  time: {
    fontSize: F.xs,
    color: Colors.hint,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.divider,
    marginVertical: S.xs,
  },
  completedToggle: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  completedLabel: {
    flex: 1,
    fontSize: F.sm,
    color: Colors.hint,
  },
  emptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs,
    paddingVertical: S.md,
  },
  emptyText: {
    fontSize: F.sm,
    color: Colors.hint,
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: S.sm,
  },
  swipeEditBtn: {
    width: 56,
    height: 44,
    borderRadius: R.md,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: S.sm,
  },
  swipeDelBtn: {
    width: 56,
    height: 44,
    borderRadius: R.md,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeBtnText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
    marginTop: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    marginTop: S.sm,
    paddingTop: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  addInput: {
    flex: 1,
    fontSize: F.sm,
    color: Colors.text,
    paddingVertical: S.sm,
    paddingHorizontal: S.sm,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: R.md,
  },
  typeToggle: {
    paddingHorizontal: S.sm,
    paddingVertical: S.xs + 1,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  typeToggleOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeText: {
    fontSize: F.xs,
    color: Colors.subtext,
  },
  typeTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    padding: S.xs,
  },
});
