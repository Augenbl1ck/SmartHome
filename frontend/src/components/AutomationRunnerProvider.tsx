'use client';

import { useAutomationRunner } from '@/hooks/useAutomationRunner';

export default function AutomationRunnerProvider() {
  useAutomationRunner();
  return null;
}
