/**
 * Global Jest setup file (runs after the test framework is installed).
 *
 * The default asyncUtilTimeout in @testing-library/react-native is 1000 ms.
 * On slow CI machines (3-10× slower than a dev laptop) that is not enough for
 * tests whose first render triggers multiple async Supabase mock round-trips
 * (loadMembers → profiles → edit-mode fetch).  10 000 ms provides a 24×
 * safety margin even on a 15× slower CI node.
 */
import { configure } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 10000 });
