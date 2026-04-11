import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AI_MODE_ENABLED } from '@/lib/app-config';

const PRIMARY = '#17e86b';
const SURFACE_DARK = '#1a3324';
const SURFACE_HL = '#244732';
const SLATE_400 = '#94a3b8';
const AI_COLOR = '#f97316'; // orange highlight for AI tab

export default function TabLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: SLATE_400,
        tabBarStyle: {
          backgroundColor: SURFACE_DARK,
          borderTopColor: SURFACE_HL,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.groups'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="groups" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: t('tabs.friends'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t('tabs.ai'),
          href: AI_MODE_ENABLED ? undefined : null,
          tabBarActiveTintColor: AI_COLOR,
          tabBarInactiveTintColor: 'rgba(249, 115, 22, 0.45)',
          tabBarIcon: ({ size, focused }) => (
            <View style={[styles.aiIconWrapper, focused && styles.aiIconWrapperActive]}>
              <MaterialIcons name="auto-awesome" size={size - 2} color={AI_COLOR} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="history" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="account-circle" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  aiIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  aiIconWrapperActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
  },
});
