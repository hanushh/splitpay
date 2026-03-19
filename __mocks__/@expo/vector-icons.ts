/**
 * Synchronous stub for @expo/vector-icons.
 *
 * The real Icon components load fonts asynchronously via expo-font, which
 * calls this.setState() outside of act() in tests. This causes act() warnings
 * and can make waitFor() time out in CI. Replacing every icon with a plain
 * <Text> eliminates all async font-loading state updates.
 */
import React from 'react';
import { Text } from 'react-native';

type IconProps = {
  name: string;
  size?: number;
  color?: string;
  style?: object;
  testID?: string;
};

function makeIconStub(family: string) {
  const IconStub = ({ name, testID, ...rest }: IconProps) =>
    React.createElement(Text, { testID: testID ?? `icon-${family}-${name}`, ...rest }, name);
  IconStub.displayName = `${family}Stub`;
  return IconStub;
}

export const MaterialIcons = makeIconStub('MaterialIcons');
export const MaterialCommunityIcons = makeIconStub('MaterialCommunityIcons');
export const Ionicons = makeIconStub('Ionicons');
export const FontAwesome = makeIconStub('FontAwesome');
export const FontAwesome5 = makeIconStub('FontAwesome5');
export const AntDesign = makeIconStub('AntDesign');
export const Feather = makeIconStub('Feather');
export const Entypo = makeIconStub('Entypo');
export const EvilIcons = makeIconStub('EvilIcons');
export const Octicons = makeIconStub('Octicons');
export const SimpleLineIcons = makeIconStub('SimpleLineIcons');
export const Zocial = makeIconStub('Zocial');
export const Foundation = makeIconStub('Foundation');
