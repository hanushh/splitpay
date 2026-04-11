import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const C = {
  primary: '#17e86b',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  bg: '#112117',
  white: '#ffffff',
};

interface Props {
  visible: boolean;
  value: string;
  loading: boolean;
  error: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function GroupRenameModal({ visible, value, loading, error, onChange, onSave, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={[s.iconWrap, { alignSelf: 'center', marginBottom: 16 }]}>
            <MaterialIcons name="drive-file-rename-outline" size={28} color={C.primary} />
          </View>
          <Text style={s.title}>{t('group.renameTitle')}</Text>
          <Text style={s.label}>{t('group.newGroupName')}</Text>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={onChange}
            placeholder={t('group.groupNamePlaceholder')}
            placeholderTextColor={C.slate500}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.saveBtn,
              !value.trim() && s.saveBtnDisabled,
              pressed && !!value.trim() && { opacity: 0.8 },
            ]}
            onPress={onSave}
            disabled={!value.trim() || loading}
          >
            <Text style={s.saveBtnText}>
              {loading ? t('group.renaming') : t('common.save')}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.cancelBtn, pressed && { opacity: 0.7 }]}
            onPress={onClose}
          >
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 24 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(23,232,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: C.white,
    fontWeight: '700',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  label: { color: C.slate400, fontSize: 13, marginBottom: 8 },
  input: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.white,
    fontSize: 15,
    marginBottom: 16,
  },
  error: { color: '#ff5252', fontSize: 13, marginBottom: 8 },
  saveBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  saveBtnDisabled: { backgroundColor: C.surfaceHL },
  saveBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: C.slate400, fontWeight: '600', fontSize: 15 },
});
